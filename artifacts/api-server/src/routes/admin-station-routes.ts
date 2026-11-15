import { pgCoverage } from '../data/postgres-coverage-store';
import { getAdminSetting } from '../data/postgres-admin-settings-store';
import crypto from 'node:crypto';
import { pgAdminAux } from '../data/postgres-admin-auxiliary-store';
import { pgCatalog, pgBlacklistAdd, pgBlacklistGet, pgBlacklistPage } from '../data/postgres-catalog-store';
import { pgAdminCatalogPage, pgAdminStationFilterOptions, pgDuplicateCityGroups, pgDuplicateStationGroups, pgDatabaseSizeReport, pgPurgeOperationalData } from '../data/postgres-admin-catalog-store';
import type { Express } from "express";
import express from "express";
import multer from "multer";
import { logger } from "../utils/logger";
import { normalizeCountryFilter, resolveToDbName, dbNameToIso } from "../utils/normalize-country";
import { syncService } from "../services/sync";
import { PrecomputedStationsService } from "../services/precomputed-stations";
import { logoProcessor } from "../services/logo-processor";
import { isS3Url, isS3Configured } from "../services/s3-storage";
import { IndexNowService } from "../services/indexnow";
import CacheManager from "../cache";
import { publicStationCache } from "../public-station-cache";
import { publicStationResponseCache } from '../middleware/public-station-cache';
import { getQuotaStatus } from "../utils/quota-guard";
import { performanceCache } from "../performance-cache";
import { stripPlaceholders } from "./shared-utils";
import { triggerGenreStationCountsRecompute } from "../services/genre-station-counts";
import {
  runCoverageBackfill,
  type RunCoverageBackfillProgress,
} from "../services/coverage-snapshot-backfill";
import { runCoverageBackfillNow } from "../services/coverage-backfill-on-boot";
import {
  clearAdminSettingWithHistory,
  listAdminSettingHistory,
  parseHistoryLimit,
  upsertAdminSettingWithHistory,
} from "../services/admin-setting-audit";
import { pgUserManagementStats } from "../data/postgres-user-store";
import { registerAdminDescriptionRoutes } from './admin-description-routes';
import { registerAdminStreamHealthRoutes } from './admin-stream-health-routes';
import { registerAdminStationRedirectRoutes } from './admin-station-redirect-routes';
import { registerAdminOperationsStatusRoutes } from './admin-operations-status-routes';
import { slugifyStationName } from '../seo/junk-station-rules';
import { SITEMAP_PRIORITY_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { registerAdminDuplicateJobRoutes } from './admin-duplicate-job-routes';
import { registerAdminSafeDedupRoutes } from './admin-safe-dedup-routes';

// AdminSetting key used to record the most recent coverage drop alert
// acknowledgement (Task #238). The stored value is keyed by snapshotDate
// so a newer alert automatically un-suppresses the banner.
const COVERAGE_DROP_ACK_KEY = 'coverage-drop-alert-ack';
const isCatalogId = (value:unknown):value is string => typeof value==='string' && /^[a-f0-9]{24}$/i.test(value);
// Admin list inputs are text filters, not a regular-expression editor. Escape
// metacharacters before handing the pattern to the native catalog compiler.
const literalListPattern = (value: unknown): RegExp =>
  new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// Convert a lowercased city name (e.g. "new york", "san josé") to a
// title-cased canonical spelling ("New York", "San José"). Used by the
// admin "merge duplicate cities" endpoints (Task #488). Uses Unicode-aware
// boundaries so non-ASCII letters (Turkish "İ"/"ı", accented vowels, etc.)
// are upper-cased correctly. Splits keep separators (spaces, hyphens,
// apostrophes) so we can rejoin without losing the original layout.
function toTitleCaseCity(lower: string): string {
  if (!lower) return '';
  return lower
    .toLocaleLowerCase()
    .split(/(\s+|[-'’])/)
    .map((part) => {
      if (!part) return part;
      const first = part.charAt(0);
      // Only upper-case actual letters; skip separators like "-" or spaces.
      const upper = first.toLocaleUpperCase();
      if (upper === first && first !== first.toLocaleLowerCase()) {
        // Already non-letter; return unchanged.
        return part;
      }
      return upper + part.slice(1);
    })
    .join('');
}

const faviconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if ((file.mimetype && file.mimetype.startsWith('image/')) || (/\.svg$/i.test(file.originalname||'') && (!file.mimetype || file.mimetype==='application/octet-stream'))) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// In-memory progress tracker for bulk tag re-check jobs. Keyed by a
// generated jobId, with periodic cleanup of finished jobs so the map
// can't grow unbounded.
type RecheckTagsJob = {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
  cleared: number;
  matched: number;
  scope?: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  cancelRequested?: boolean;
  cancellable?: boolean;
};
const recheckTagsJobs = new Map<string, RecheckTagsJob>();
const RECHECK_TAGS_JOB_TTL_MS = 60 * 60 * 1000; // 1h after completion

function cleanupRecheckTagsJobs() {
  const now = Date.now();
  for (const [jobId, job] of recheckTagsJobs) {
    if (job.finishedAt && now - job.finishedAt > RECHECK_TAGS_JOB_TTL_MS) {
      recheckTagsJobs.delete(jobId);
      recheckTagsJobSubscribers.delete(jobId);
    }
  }
}

// SSE subscribers for live recheck-job progress. Each entry holds the
// callbacks attached by an open `/recheck-tags-job-stream/:jobId`
// connection; they are invoked whenever the job's snapshot changes
// (per-batch progress or terminal status transition) so clients see
// updates instantly.
type RecheckTagsJobSubscriber = (job: RecheckTagsJob) => void;
const recheckTagsJobSubscribers = new Map<string, Set<RecheckTagsJobSubscriber>>();
function notifyRecheckTagsJobSubscribers(jobId: string) {
  const subs = recheckTagsJobSubscribers.get(jobId);
  if (!subs || subs.size === 0) return;
  const job = recheckTagsJobs.get(jobId);
  if (!job) return;
  for (const sub of Array.from(subs)) {
    try {
      sub(job);
    } catch (err) {
      logger.warn(`recheck-tags SSE subscriber threw: ${(err as Error)?.message}`);
    }
  }
}

// In-memory progress tracker for per-country coverage backfill jobs (the
// "Re-enqueue" buttons on the coverage page). Each job tracks the logo
// pipeline (driven by the scheduled-logo-processor sweeping the stations
// we just $unset) and the tags pipeline (the in-process Radio-Browser
// hydration). Logo progress is computed lazily on each status poll by
// counting how many of the originally-enqueued station IDs still lack a
// completed `logoAssets`. Tags progress is streamed from the helper's
// `onProgress` callback.
type CoverageBackfillJob = {
  jobId: string;
  countryCode: string;
  scope: 'logos' | 'tags' | 'both';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  error?: string;
  cancelRequested?: boolean;
  cancellable?: boolean;
  // Task #342: when this job was kicked off as a Resume of a previous
  // cancelled run for the same country, this is that cancelled run's
  // jobId. Lets the UI history panel draw a "resumed from …" link
  // between the two rows.
  resumedFromJobId?: string;
  logos?: {
    matched: number;
    enqueuedIds: string[];
    completed: number;
    remaining: number;
    done: boolean;
  };
  tags?: {
    total: number;
    processed: number;
    hydrated: number;
    emptyUpstream: number;
    failed: number;
    done: boolean;
    // Counters carried over from a recently-cancelled run for this same
    // country (Task #252). Present only on a resumed run so the UI / API
    // consumer can tell that `processed`/`hydrated` already include work
    // done by the cancelled predecessor instead of being a fresh 0/total.
    resumedFrom?: {
      processed: number;
      hydrated: number;
      emptyUpstream: number;
      failed: number;
      total: number;
    };
  };
};
const coverageBackfillJobs = new Map<string, CoverageBackfillJob>();
const COVERAGE_BACKFILL_JOB_TTL_MS = 60 * 60 * 1000; // 1h after completion

// Task #342: capped per-country ring buffer of finished backfill runs so
// admins can see which countries repeatedly stall (cancel → resume → cancel
// loops) instead of only the last toast. Kept in-process — same lifetime
// as `coverageBackfillJobs`. A fresh server boot starts with an empty
// history, which is fine: the page only needs short-term context to
// surface "this country keeps cancelling".
type CoverageBackfillRunRecord = {
  jobId: string;
  countryCode: string;
  scope: 'logos' | 'tags' | 'both';
  status: 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt: number;
  error?: string;
  // Same shape as the public job-status payload (no internal id arrays).
  logos?: {
    matched: number;
    enqueued: number;
    completed: number;
    remaining: number;
  };
  tags?: {
    total: number;
    processed: number;
    hydrated: number;
    emptyUpstream: number;
    failed: number;
  };
  // jobId of the cancelled run this one continued from (when applicable).
  resumedFromJobId?: string;
};
const COVERAGE_BACKFILL_HISTORY_MAX = 10;
const coverageBackfillHistory = new Map<string, CoverageBackfillRunRecord[]>();

function recordCoverageBackfillHistory(job: CoverageBackfillJob): void {
  if (
    job.status !== 'completed' &&
    job.status !== 'cancelled' &&
    job.status !== 'failed'
  ) {
    return;
  }
  const key = job.countryCode.toUpperCase();
  const existing = coverageBackfillHistory.get(key) ?? [];
  // Idempotent on repeated terminal recordings (e.g. logo poll +
  // maybeFinishCoverageJob both calling in).
  if (existing.some((r) => r.jobId === job.jobId)) return;
  const entry: CoverageBackfillRunRecord = {
    jobId: job.jobId,
    countryCode: key,
    scope: job.scope,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt ?? Date.now(),
    error: job.error,
    logos: job.logos
      ? {
          matched: job.logos.matched,
          enqueued: job.logos.enqueuedIds.length,
          completed: job.logos.completed,
          remaining: job.logos.remaining,
        }
      : undefined,
    tags: job.tags
      ? {
          total: job.tags.total,
          processed: job.tags.processed,
          hydrated: job.tags.hydrated,
          emptyUpstream: job.tags.emptyUpstream,
          failed: job.tags.failed,
        }
      : undefined,
    resumedFromJobId: job.resumedFromJobId,
  };
  const next = [entry, ...existing].slice(0, COVERAGE_BACKFILL_HISTORY_MAX);
  coverageBackfillHistory.set(key, next);
}

// Task #318: in-process tracker for the "Reconstruct sparkline history"
// runs. The seeder used to execute synchronously inside the HTTP request
// which timed out the UI on multi-month windows; it now runs in the
// background and the UI polls this map for per-day progress.
type CoverageReconstructionJob = {
  jobId: string;
  days: number;
  dryRun: boolean;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  // Latest streamed progress (kept up to date inside the seeder's
  // onProgress callback).
  daysProcessed: number;
  daysTotal: number;
  daysSeeded: number;
  inserted: number;
  preserved: number;
  wouldWrite: number;
  currentDay: string | null;
  skippedReason?: 'no-stations';
  cancelRequested?: boolean;
  error?: string;
};
const coverageReconstructionJobs = new Map<string, CoverageReconstructionJob>();
const COVERAGE_RECONSTRUCTION_JOB_TTL_MS = 60 * 60 * 1000;
function cleanupCoverageReconstructionJobs() {
  const now = Date.now();
  for (const [id, job] of coverageReconstructionJobs) {
    if (
      job.finishedAt &&
      now - job.finishedAt > COVERAGE_RECONSTRUCTION_JOB_TTL_MS
    ) {
      coverageReconstructionJobs.delete(id);
    }
  }
}

// Task #252: when a coverage tags subjob is cancelled we stash its final
// counters (and the country it ran against) so a follow-up enqueue for the
// same country — typically fired by the Undo toast — can resume display
// from where the cancelled run left off instead of restarting at 0/total.
// The actual already-hydrated stations are skipped naturally by
// `hydrateMissingTagsInBackground`'s candidate filter (rows with non-empty
// `tags` or a recent `tagsCheckedAt` are excluded), so the hint is purely
// about carrying the visible progress / final totals across the gap.
type CoverageTagsResumeHint = {
  cancelledAt: number;
  total: number;
  processed: number;
  hydrated: number;
  emptyUpstream: number;
  failed: number;
  // Task #342: jobId of the cancelled run this hint was stashed from, so
  // a resumed run can record `resumedFromJobId` and the history panel
  // can chain rows together.
  cancelledJobId?: string;
};
const COVERAGE_TAGS_RESUME_TTL_MS = 5 * 60 * 1000;
const coverageTagsResumeHints = new Map<string, CoverageTagsResumeHint>();

function stashCoverageTagsResumeHint(
  countryCode: string,
  tags: {
    total: number;
    processed: number;
    hydrated: number;
    emptyUpstream: number;
    failed: number;
  },
  cancelledJobId?: string,
) {
  // Nothing to resume from if the cancelled run hadn't actually moved
  // the needle yet.
  if ((tags.processed ?? 0) <= 0 && (tags.hydrated ?? 0) <= 0) return;
  coverageTagsResumeHints.set(countryCode.toUpperCase(), {
    cancelledAt: Date.now(),
    total: tags.total ?? 0,
    processed: tags.processed ?? 0,
    hydrated: tags.hydrated ?? 0,
    emptyUpstream: tags.emptyUpstream ?? 0,
    failed: tags.failed ?? 0,
    cancelledJobId,
  });
}

function consumeCoverageTagsResumeHint(
  countryCode: string,
): CoverageTagsResumeHint | null {
  const key = countryCode.toUpperCase();
  const hint = coverageTagsResumeHints.get(key);
  if (!hint) return null;
  coverageTagsResumeHints.delete(key);
  if (Date.now() - hint.cancelledAt > COVERAGE_TAGS_RESUME_TTL_MS) return null;
  return hint;
}
function cleanupCoverageBackfillJobs() {
  const now = Date.now();
  for (const [jobId, job] of coverageBackfillJobs) {
    if (job.finishedAt && now - job.finishedAt > COVERAGE_BACKFILL_JOB_TTL_MS) {
      coverageBackfillJobs.delete(jobId);
    }
  }
}
function maybeFinishCoverageJob(job: CoverageBackfillJob) {
  const logosDone = !job.logos || job.logos.done;
  const tagsDone = !job.tags || job.tags.done;
  const wasRunning = job.status === 'running';
  if (logosDone && tagsDone && wasRunning) {
    // Task #185: a country backfill that touched tags can shift which
    // genres have stations under them — refresh Genre.stationCount so
    // the admin Genre Whitelist page doesn't show stale "thin" badges.
    if (job.tags) {
      triggerGenreStationCountsRecompute(`coverage-backfill:${job.countryCode ?? 'unknown'}`);
    }
    job.status = job.cancelRequested
      ? 'cancelled'
      : job.error
        ? 'failed'
        : 'completed';
    job.finishedAt = Date.now();
    // Task #342: snapshot the terminal run into the per-country history
    // ring buffer so the coverage page can show a short audit trail of
    // recent backfills (cancel → resume → cancel patterns, etc.).
    recordCoverageBackfillHistory(job);
  }
}

const STATION_UPDATE_ALLOWED_FIELDS = [
  'name', 'url', 'urlResolved', 'homepage', 'favicon', 'country', 'countryCode', 'state',
  'language', 'tags', 'bitrate', 'codec', 'hls', 'noIndex', 'isFeatured', 'showInGlobalPopular'
] as const;

function pickAllowedStationFields(body: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of STATION_UPDATE_ALLOWED_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  if (out.bitrate !== undefined && out.bitrate !== null && out.bitrate !== '') {
    const n = Number(out.bitrate);
    out.bitrate = Number.isFinite(n) ? n : undefined;
    if (out.bitrate === undefined) delete out.bitrate;
  } else if (out.bitrate === '') {
    delete out.bitrate;
  }
  if (typeof out.favicon === 'string') out.favicon = out.favicon.trim();
  if (typeof out.url === 'string') out.url = out.url.trim();
  if (typeof out.urlResolved === 'string') out.urlResolved = out.urlResolved.trim();
  if (typeof out.homepage === 'string') out.homepage = out.homepage.trim();
  if (typeof out.name === 'string') out.name = out.name.trim();
  return out;
}

interface RouteDeps {
  requireAuth: any;
  requireAdmin: any;
  stripPlaceholders?: (obj: any) => any;
}

export function registerAdminStationRoutes(app: Express, deps: RouteDeps) {
  const { requireAdmin } = deps;
  registerAdminDescriptionRoutes(app, requireAdmin);
  registerAdminDuplicateJobRoutes(app, requireAdmin);
  registerAdminStreamHealthRoutes(app, requireAdmin);
  registerAdminStationRedirectRoutes(app, requireAdmin);
  registerAdminOperationsStatusRoutes(app, requireAdmin);

  // 2026-05-15: manual on-demand trigger for the nightly Radio-Browser sync.
  // Same code path as the 03:00 Berlin cron (`scheduledStationSync.runOnce`)
  // — pulls the full station dump, updates whitelisted fields including
  // `votes` and `clickCount`, then rebuilds sitemap manifests and pings
  // IndexNow. Use this when votes look stale (e.g. Power Pop showing 9.6k
  // locally vs 10450 on Radio-Browser) without waiting until 03:00.
  app.post("/api/admin/sync/run-now", requireAdmin, async (_req, res) => {
    try {
      const { scheduledStationSync } = await import('../services/scheduled-station-sync');
      const status = scheduledStationSync.getStatus();
      if (status.isRunning) {
        return res.status(409).json({
          ok: false,
          message: 'Station sync already in progress',
          status,
        });
      }
      // Fire-and-forget: full sync takes minutes. Return 202 immediately so
      // the admin UI doesn't hang on the request.
      scheduledStationSync.runOnce('admin-trigger').catch((err) => {
        logger.error('Manual station sync (admin-trigger) crashed:', err);
      });
      return res.status(202).json({
        ok: true,
        message: 'Station sync triggered. Poll GET /api/admin/sync/status for completion.',
      });
    } catch (err: any) {
      logger.error('admin/sync/run-now failed:', err);
      return res.status(500).json({ ok: false, message: err?.message ?? 'unknown_error' });
    }
  });

  // Status of the most recent (or in-progress) Radio-Browser sync.
  app.get("/api/admin/sync/status", requireAdmin, async (_req, res) => {
    try {
      const { scheduledStationSync } = await import('../services/scheduled-station-sync');
      return res.json({ ok: true, status: scheduledStationSync.getStatus() });
    } catch (err: any) {
      return res.status(500).json({ ok: false, message: err?.message ?? 'unknown_error' });
    }
  });

  // DATA SYNC UTILITY - Fix follower counts for all users
  app.post("/api/admin/sync-follower-counts", requireAdmin, async (req, res) => {
    try {
      const stats = await pgUserManagementStats();
      return void res.json({ success:true,message:'PostgreSQL follower counts are relational and require no denormalized sync',
        totalUsers:stats.totalUsers,syncedUsers:0,errors:0 });
    } catch (error) {
      res.status(500).json({ error: 'Failed to sync follower counts' });
    }
  });

  // ADMIN STATIONS API - Paginated stations for admin interface
  app.get('/api/admin/stations/filter-options', requireAdmin, async (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const key = 'admin-station-filter-options:v1';
      const cached = await CacheManager.get(key);
      if (cached) return void res.json(cached);
      const result = await pgAdminStationFilterOptions();
      await CacheManager.set(key, result, { ttl: 300 });
      res.json(result);
    } catch {
      res.status(503).json({ error: 'Station filter options are temporarily unavailable' });
    }
  });

  app.get('/api/admin/stations', requireAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      // Never log session identifiers or unbounded free-text admin searches.
      if (Object.values(req.query).some(value => typeof value !== 'string' || value.length > 300)) {
        return void res.status(400).json({ error: 'Filters must be single text values of at most 300 characters' });
      }
      const { 
        page = 1, 
        limit = 50, 
        search = '', 
        country = '', 
        language = '', 
        genre = '',
        codec = '',
        healthStatus = 'all',
        hasDescriptions = 'all',
        tagsStatus = 'all',
        hasLogo = 'all',
        sortBy = 'name',
        sortOrder = 'asc'
      } = req.query;
      if (!['all','working','unavailable','unverified','source-offline'].includes(String(healthStatus))) {
        return void res.status(400).json({ error: 'Invalid station health filter' });
      }

      const cacheKey = `admin_stations:v2:${JSON.stringify({
        page: String(page),
        limit: String(limit),
        search: String(search),
        country: String(country),
        language: String(language),
        genre: String(genre),
        codec: String(codec),
        healthStatus: String(healthStatus),
        hasDescriptions: String(hasDescriptions),
        tagsStatus: String(tagsStatus),
        hasLogo: String(hasLogo),
        sortBy: String(sortBy),
        sortOrder: String(sortOrder)
      })}`;
      
      const cachedResult = await CacheManager.get(cacheKey);
      if (cachedResult) {
        return void res.json(cachedResult);
      }
      
      const filter: any = {};
      
      if (search && search !== '') {
        const pattern = literalListPattern(search);
        filter.$or = [
          { name: { $regex: pattern } },
          { country: { $regex: pattern } },
          { tags: { $regex: pattern } },
          { url: { $regex: pattern } },
          { urlResolved: { $regex: pattern } },
          { _id: String(search) },
          { stationuuid: String(search) }
        ];
      }
      
      if (country && country !== '' && country !== 'all') {
        (filter.$and ||= []).push(normalizeCountryFilter(country as string));
      }
      
      if (language && language !== '' && language !== 'all') {
        filter.language = { $regex: literalListPattern(language) };
      }
      
      if (genre && genre !== '' && genre !== 'all') {
        filter.tags = { $regex: literalListPattern(genre) };
      }
      if (codec && codec !== 'all') filter.codec = { $regex: new RegExp('^' + literalListPattern(codec).source + '$', 'i') };
      
      if (tagsStatus && tagsStatus !== '' && tagsStatus !== 'all') {
        // Empty-tags predicate: tags missing, null, or empty/whitespace-only string
        const emptyTagsPredicate = {
          $or: [
            { tags: { $exists: false } },
            { tags: null },
            { tags: '' },
            { tags: { $regex: /^\s*$/ } },
          ],
        };
        const tagsAndConds: any[] = filter.$and || [];
        if (tagsStatus === 'empty-cooldown') {
          // Stations whose Radio-Browser re-check returned empty AND are still
          // inside the 30-day cooldown window — i.e. stuck waiting for the
          // upstream to publish tags before the background hydration job will
          // re-query them.
          const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          tagsAndConds.push(emptyTagsPredicate);
          tagsAndConds.push({ tagsCheckedAt: { $gte: cooldownCutoff } });
          filter.$and = tagsAndConds;
        } else if (tagsStatus === 'never-checked') {
          // Tagless stations the background job has never re-checked yet.
          tagsAndConds.push(emptyTagsPredicate);
          tagsAndConds.push({
            $or: [
              { tagsCheckedAt: { $exists: false } },
              { tagsCheckedAt: null },
            ],
          });
          filter.$and = tagsAndConds;
        }
      }

      
      if (hasLogo && hasLogo !== 'all') {
        if (hasLogo === 'yes') {
          // A station genuinely "has a logo" only when our processor completed
          // and produced a real webp256 asset (S3 URL or local filename).
          // The legacy `hasLogo` boolean is unreliable — it was set by a one-time
          // migration that counted any non-empty `favicon` field as a logo.
          filter['logoAssets.status'] = 'completed';
          filter['logoAssets.webp256'] = { $exists: true, $nin: [null, ''] };
        } else if (hasLogo === 'no') {
          (filter.$and ||= []).push({ $or: [
            { 'logoAssets.status': { $ne: 'completed' } },
            { 'logoAssets.webp256': { $exists: false } },
            { 'logoAssets.webp256': null },
            { 'logoAssets.webp256': '' },
          ] });
        }
      }

      const pageNumber = Math.max(1,Math.min(1_000_000,Number.parseInt(String(page),10) || 1));
      const pageSize = Math.max(1,Math.min(500,Number.parseInt(String(limit),10) || 50));
      const { total,stations } = await pgAdminCatalogPage(filter,{
        descriptionState:String(hasDescriptions),healthStatus:String(healthStatus),sortBy:String(sortBy),direction:sortOrder==='asc' ? 1 : -1,
        limit:pageSize,offset:(pageNumber-1)*pageSize,
      });
      
      const result = {
        stations: stripPlaceholders(stations),
        total,
        page: pageNumber,
        totalPages: Math.ceil(total / pageSize)
      };
      
      await CacheManager.set(cacheKey, result, { ttl: 15 });
      res.json(result);
    } catch (error: any) {
      logger.error(`Error in /api/admin/stations: ${error?.message || error}`);
      if (error?.stack) logger.error(error.stack.split('\n').slice(0, 5).join('\n'));
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });

  // Legacy maintenance URLs keep their dry-run contracts and guarded writes.
  registerAdminSafeDedupRoutes(app, requireAdmin);

  // TAGS-STATUS SUMMARY - Count stations stuck in the 30-day Radio-Browser
  // empty-tag cooldown (and the never-checked tagless bucket) so the admin UI
  // can surface a live KPI without applying the filter manually.
  app.get('/api/admin/stations/tags-status-summary', requireAdmin, async (req, res) => {
    try {
      const cacheKey = 'admin:stations:tags-status-summary';
      const cached = await CacheManager.get(cacheKey);
      if (cached) {
        return void res.json(cached);
      }

      const emptyTagsPredicate = {
        $or: [
          { tags: { $exists: false } },
          { tags: null },
          { tags: '' },
          { tags: { $regex: /^\s*$/ } },
        ],
      };
      const cooldownCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [emptyCooldown, neverChecked] = await Promise.all([
        pgCatalog().count({
          $and: [emptyTagsPredicate, { tagsCheckedAt: { $gte: cooldownCutoff } }],
        }),
        pgCatalog().count({
          $and: [
            emptyTagsPredicate,
            {
              $or: [
                { tagsCheckedAt: { $exists: false } },
                { tagsCheckedAt: null },
              ],
            },
          ],
        }),
      ]);

      const result = { emptyCooldown, neverChecked };
      await CacheManager.set(cacheKey, result, { ttl: 300 });
      res.json(result);
    } catch (error: any) {
      logger.error(`Error in /api/admin/stations/tags-status-summary: ${error?.message || error}`);
      res.status(500).json({ error: 'Failed to fetch tags status summary' });
    }
  });

  // PRECOMPUTED ADMIN API - Status and triggers
  app.get('/api/admin/precomputed/status', requireAdmin, async (req, res) => {
    try {
      const status = PrecomputedStationsService.getCacheStats();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch precomputed status' });
    }
  });

  app.post('/api/admin/precomputed/refresh', requireAdmin, async (req, res) => {
    try {
      const { countryCode } = req.body;
      if (!countryCode) return void res.status(400).json({ error: 'countryCode is required' });
      
      res.json({ success: true, message: `Refresh started for ${countryCode}` });
      
      setImmediate(async () => {
        try {
          await PrecomputedStationsService.computeCountryStations(countryCode);
        } catch (err) {
          logger.error(`Error refreshing precomputed for ${countryCode}:`, err);
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start refresh' });
    }
  });

  // WORKING STATIONS API - Admin only diagnostic
  app.get("/api/admin/working-stations", requireAdmin, async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const stations = await pgCatalog().find({ lastCheckOk: true }, { limit: Number(limit), fields: ["name","url","lastCheckOk"] });
      res.json(stations);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch working stations' });
    }
  });

  // STATION FAVICON UPLOAD - Direct multipart upload → AWS S3 via logoProcessor
  // POST /api/admin/stations/:id/upload-favicon (multipart/form-data, field: 'favicon')
  app.post(
    "/api/admin/stations/:id/upload-favicon",
    requireAdmin,
    (req, res, next) => {
      faviconUpload.single('favicon')(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return void res.status(413).json({ error: 'File too large. Max 5MB.' });
          }
          return void res.status(400).json({ error: err.message || 'Invalid upload' });
        }
        next();
      });
    },
    async (req: any, res) => {
      try {
        const { id } = req.params;
        if (!isCatalogId(id)) {
          return void res.status(400).json({ error: 'Invalid station id' });
        }
        if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
          return void res.status(400).json({ error: 'No favicon file uploaded (field name: favicon)' });
        }

        const station = await pgCatalog().findOne({ _id: id }, { fields: ["_id","slug","name"] });
        if (!station) return void res.status(404).json({ error: 'Station not found' });

        const slug = (station as any).slug || (station as any).name?.toLowerCase().replace(/\s+/g, '-') || String(station._id);

        const result = await logoProcessor.processFromBuffer(
          String(station._id),
          slug,
          req.file.buffer,
          req.file.originalname || 'upload.png'
        );

        if (!result.success) {
          return void res.status(422).json({ error: result.error || 'Logo processing failed' });
        }

        const updated = await pgCatalog().findOne({ _id: id }, { fields: ["_id","slug","favicon","logoAssets"] });
        const newFaviconUrl = (updated as any)?.logoAssets?.webp256
          || (updated as any)?.logoAssets?.original
          || (updated as any)?.favicon
          || '';

        // The processor commits the mirrored favicon together with its claim.
        // Never write this read-back snapshot: a later edit may already exist.

        if ((station as any).slug) {
          performanceCache.invalidateStationCache((station as any).slug);
        }

        // Surface S3 configuration status so admin UI can warn when logo
        // landed only on Railway's ephemeral disk (lost on next redeploy).
        const s3Ok = isS3Configured();
        const warning = s3Ok ? undefined : 'S3 not configured — logo stored on ephemeral Railway disk and will be lost on next redeploy. Configure AWS_BUCKET_NAME / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.';
        if (!s3Ok) {
          logger.warn(`⚠️ Favicon upload for station ${id} (${slug}) used local-disk fallback (S3 not configured)`);
        }

        return void res.json({
          success: true,
          favicon: newFaviconUrl,
          logoAssets: (updated as any)?.logoAssets || null,
          folder: result.folder,
          backedUpToS3: s3Ok && !!newFaviconUrl && isS3Url(newFaviconUrl),
          warning,
        });
      } catch (error: any) {
        logger.error(`Favicon upload failed: ${error.message}`);
        return void res.status(500).json({ error: error.message || 'Upload failed' });
      }
    }
  );

  // Manual creation is deliberately separate from provider import: identity,
  // counters and availability evidence are server-owned, never accepted from
  // the form. No stream, logo, AI or provider request is made during this write.
  app.post('/api/stations', requireAdmin, express.json({ limit: '512kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Buffer.byteLength(JSON.stringify(req.body)) > 512 * 1024) {
      return void res.status(400).json({ error: 'Station fields must be a bounded object' });
    }
    const allowed = new Set<string>([...STATION_UPDATE_ALLOWED_FIELDS, 'descriptions']);
    if (Object.keys(req.body).some(key => !allowed.has(key))) {
      return void res.status(400).json({ error: 'Unsupported station fields; identity and health evidence are assigned by the server' });
    }
    for (const field of ['hls', 'noIndex', 'isFeatured', 'showInGlobalPopular']) {
      if (req.body[field] !== undefined && typeof req.body[field] !== 'boolean') return void res.status(400).json({ error: `${field} must be a boolean` });
    }
    for (const field of ['name', 'url', 'urlResolved', 'homepage', 'favicon', 'country', 'countryCode', 'state', 'language', 'tags', 'codec']) {
      if (req.body[field] !== undefined && (typeof req.body[field] !== 'string' || req.body[field].length > 4096)) {
        return void res.status(400).json({ error: `${field} must be text of at most 4096 characters` });
      }
    }
    if (req.body.bitrate !== undefined && req.body.bitrate !== null &&
      (typeof req.body.bitrate !== 'number' || !Number.isInteger(req.body.bitrate) || req.body.bitrate < 0 || req.body.bitrate > 100000)) {
      return void res.status(400).json({ error: 'Bitrate must be an integer between 0 and 100000, or null' });
    }
    const fields = pickAllowedStationFields(req.body);
    for (const [key, value] of Object.entries(fields)) if (typeof value === 'string') fields[key] = value.trim();
    if (!fields.name || !fields.url) return void res.status(400).json({ error: 'Station name and stream URL are required' });
    for (const field of ['url', 'urlResolved', 'homepage', 'favicon']) {
      if (!fields[field] || (field === 'favicon' && /^\/(?!\/)/.test(fields[field]))) continue;
      try { if (!['http:', 'https:'].includes(new URL(fields[field]).protocol)) throw new Error(); }
      catch { return void res.status(400).json({ error: `${field} must be a valid HTTP or HTTPS URL` }); }
    }
    if (fields.countryCode) {
      if (!/^[a-z]{2}$/i.test(fields.countryCode)) return void res.status(400).json({ error: 'Country code must contain two letters' });
      fields.countryCode = fields.countryCode.toUpperCase();
    }
    const descriptions = req.body.descriptions === undefined ? {} : req.body.descriptions;
    const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(descriptions) || Object.keys(descriptions).some(locale => !SITEMAP_PRIORITY_LANGUAGES.universal14.includes(locale as any)) ||
      Object.values(descriptions).some(value => !object(value) || !Object.keys(value).length || Object.entries(value).some(([key, text]) =>
        !['full', 'meta'].includes(key) || typeof text !== 'string' || !text.trim() || text.length > (key === 'full' ? 20000 : 1000)))) {
      return void res.status(400).json({ error: 'Descriptions must contain supported website languages and non-empty full/meta text' });
    }
    try {
      const id = crypto.randomBytes(12).toString('hex');
      const slugBase = slugifyStationName(fields.name).slice(0, 180).replace(/-+$/, '') || 'station';
      const manualEditFields = Object.fromEntries([...Object.keys(fields), ...(Object.keys(descriptions).length ? ['descriptions'] : [])].map(key => [key, true]));
      const [station] = await pgCatalog().insertMany([{
        ...fields, _id: id, stationuuid: crypto.randomUUID(), slug: `${slugBase}-${id}`, descriptions, manualEditFields,
        lastCheckOk: false, lastCheckTime: null, availabilityOutcome: 'inconclusive', availabilityCheckedAt: null,
        isListVisible: true, visibilityExpiresAt: null, healthSource: 'manual-unchecked',
      }]);
      if (!station) return void res.status(409).json({ error: 'A station with this name, stream URL and country already exists' });
      const cacheResults = await Promise.allSettled([
        Promise.resolve().then(() => performanceCache.invalidateStationCache(station.slug)),
        ...['admin_stations:', 'stations', 'popular_stations', 'community_favorites', 'genres'].map(pattern =>
          Promise.resolve().then(() => CacheManager.clearByPattern(pattern))),
        Promise.resolve().then(() => CacheManager.del('admin-station-filter-options:v1')),
      ]);
      return void res.status(201).json({ success: true, station, cacheInvalidated: cacheResults.every(result => result.status === 'fulfilled') });
    } catch (error: any) {
      logger.error('Manual station creation failed', { code: error?.code || 'unknown' });
      return void res.status(error?.code === '23505' ? 409 : 500).json({ error: error?.code === '23505' ? 'Station identity already exists; retry creating the station' : 'Station creation failed' });
    }
  });

  // STATION UPDATE - Edit station metadata (Admin only)
  // PUT /api/stations/:stationId   (frontend updateMutation hits this exact path)
  app.put("/api/stations/:stationId", requireAdmin, express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const { stationId } = req.params;
      if (!isCatalogId(stationId)) {
        return void res.status(400).json({ error: 'Invalid station id' });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return void res.status(400).json({ error: 'Station fields must be an object' });
      }
      for (const field of ['hls','noIndex','isFeatured','showInGlobalPopular']) {
        if (req.body[field] !== undefined && typeof req.body[field] !== 'boolean') {
          return void res.status(400).json({ error: `${field} must be a boolean` });
        }
      }
      for (const field of ['name','url','urlResolved','homepage','favicon','country','countryCode','state','language','tags','codec']) {
        if (req.body[field] !== undefined && (typeof req.body[field] !== 'string' || req.body[field].length>4096)) {
          return void res.status(400).json({ error: `${field} must be text of at most 4096 characters` });
        }
      }
      const update = pickAllowedStationFields(req.body);
      if (update.name === '' || update.url === '') return void res.status(400).json({ error: 'Station name and stream URL cannot be empty' });
      for (const field of ['url','urlResolved','homepage']) {
        if (!update[field]) continue;
        try { if (!['http:','https:'].includes(new URL(update[field]).protocol)) throw new Error(); }
        catch { return void res.status(400).json({ error: `${field} must be a valid HTTP or HTTPS URL` }); }
      }
      if (req.body.bitrate !== undefined && req.body.bitrate !== '' && req.body.bitrate !== null &&
        (!Number.isInteger(Number(req.body.bitrate)) || Number(req.body.bitrate)<0 || Number(req.body.bitrate)>100000)) {
        return void res.status(400).json({ error: 'Bitrate must be a non-negative number' });
      }
      if (Object.hasOwn(req.body || {}, 'descriptions')) {
        return void res.status(400).json({ error: 'Save descriptions through PATCH /api/admin/stations/:id/descriptions with expected current values' });
      }
      if (Object.keys(update).length === 0) {
        return void res.status(400).json({ error: 'No editable fields provided' });
      }

      const before = await pgCatalog().findOne({ _id: stationId }, { fields: ["_id","slug","favicon","logoAssets"] });
      if (!before) return void res.status(404).json({ error: 'Station not found' });

      for (const field of Object.keys(update)) update['manualEditFields.'+field] = true;
      const updated = await pgCatalog().patchById(stationId,{ $set:update });
      if (!updated) return void res.status(404).json({ error:'Station not found' });

      // If favicon URL changed AND it's not already an S3 URL → mirror it to S3 in background.
      // ALSO retry the mirror when the URL is unchanged but the previous mirror
      // attempt failed (logoAssets.status === 'failed') — otherwise admins have
      // no way to retry a failed logo without first changing the URL.
      // The mirror also atomically swaps station.favicon → S3 URL on success
      // (see logo-processor.ts processFromUrl), so the dış URL only ever lives
      // in the DB for the few seconds it takes to download + resize + upload.
      const newFavicon = (updated as any)?.favicon;
      const oldFavicon = (before as any)?.favicon;
      const previousLogoStatus = (before as any)?.logoAssets?.status;
      const shouldRetryFailedMirror =
        newFavicon === oldFavicon && previousLogoStatus === 'failed';
      if (
        newFavicon &&
        typeof newFavicon === 'string' &&
        newFavicon.startsWith('http') &&
        (newFavicon !== oldFavicon || shouldRetryFailedMirror) &&
        !isS3Url(newFavicon)
      ) {
        const slug = (updated as any).slug || String((updated as any)._id);
        const stationIdStr = String((updated as any)._id);
        // Fire-and-forget mirror to S3 — log failures so admin can re-trigger
        // by saving again. logoAssets.status='failed' is also persisted by the
        // processor itself for UI visibility.
        logoProcessor.processFromUrl(stationIdStr, slug, newFavicon)
          .then((r) => {
            if (!r.success) {
              logger.warn(`⚠️ S3 mirror failed for station ${stationIdStr} (${slug}): ${r.error || 'unknown'} (failureType=${r.failureType || 'unknown'}); favicon kept as external URL`);
            }
          })
          .catch((err: any) => {
            logger.error(`❌ S3 mirror exception for station ${stationIdStr} (${slug}): ${err?.message || err}`);
          });
      }

      const cacheResults = await Promise.allSettled([
        Promise.resolve().then(()=>performanceCache.invalidateStationCache(updated.slug)),
        CacheManager.clearByPattern('admin_stations:'),
        CacheManager.del('admin-station-filter-options:v1'),
      ]);
      // A cache failure after a committed write must not invite a duplicate save.
      return void res.json({ success: true, station: updated, cacheInvalidated:cacheResults.every(r=>r.status==='fulfilled') });
    } catch (error: any) {
      logger.error(`Station update failed: ${error.message}`);
      return void res.status(500).json({ error: 'Station update failed' });
    }
  });

  // BATCH STATION LOADING ENDPOINT - Performance Optimization
  app.post("/api/stations/batch", publicStationResponseCache, async (req, res) => {
    try {
      const { stationIds } = req.body;
      if (!Array.isArray(stationIds) || stationIds.length === 0) {
        return void res.status(400).json({ error: 'stationIds array is required' });
      }
      if (stationIds.length > 50) {
        return void res.status(400).json({ error: 'Maximum 50 stations per batch request' });
      }
      if (stationIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)) {
        return void res.status(400).json({ error: 'Station IDs must be non-empty strings' });
      }

      const sortedIds = [...stationIds].sort();
      const slim = req.body.slim === true || req.query.slim === '1';
      const cacheKey = `stations:batch:v2:${slim ? 'slim:' : ''}${sortedIds.join(',')}`;
      const cached = await publicStationCache.get(cacheKey);
      if (cached) return void res.json(cached);

      const { resolveStationIds } = await import('../data/station-identity-store');
      const identities = await resolveStationIds(stationIds);
      const stations = await pgCatalog().find({ _id: { $in: [...new Set(identities.values())] }, isListVisible: true }, slim ? {
        fields: ['_id','stationuuid','name','slug','url','urlResolved','favicon','country','countryCode','state','language',
          'tags','codec','bitrate','hls','votes','clickCount','averageRating','totalRatings','lastCheckOk','lastCheckTime',
          'hasLogo','logoAssets','isFeatured','noIndex','isListVisible','availabilityStatus'], limit: 50,
      } : { limit: 50 });
      const byId = new Map(stations.map(station => [String(station._id), station]));
      // Keep the requested keys so older mobile/local-history IDs still hydrate.
      const stationMap = Object.fromEntries(stationIds.flatMap((id: string) => {
        const station = byId.get(identities.get(id) || '');
        return station ? [[id, station]] : [];
      }));

      await publicStationCache.set(cacheKey, stationMap, { ttl: 60 });
      res.json(stationMap);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stations' });
    }
  });

  // BULK IMPORT ENDPOINT - Import stations from Radio Browser API (Admin Only)
  app.post("/api/admin/bulk-import-stations", express.json({ limit: '50mb' }), requireAdmin, async (req, res) => {
    try {
      logger.log('🔄 Starting bulk station import...');
      const { stations, append = false, skipIndexes = false } = req.body;
      if (!stations || !Array.isArray(stations)) {
        return void res.status(400).json({ error: 'Invalid stations array' });
      }
      
      if (!stations.length && !req.body.clearOnly) return void res.status(400).json({ error:'Empty import requires clearOnly=true' });
      const imported = await pgCatalog().importSnapshot(req.body.clearOnly ? [] : stations,req.body.clearOnly || !append);
      if (req.body.clearOnly) return void res.json({ success:true,message:'Station catalog cleared',deletedCount:imported.removed });
      await Promise.all(['stations','popular_stations','community_favorites'].map(pattern=>CacheManager.clearByPattern(pattern)));
      
      // Task #185: a bulk import flips most genres' station counts at once.
      // Refresh Genre.stationCount in the background so the admin Genre
      // Whitelist page reflects the new totals on its next poll instead of
      // showing pre-import "thin" / "no matching stations" badges.
      triggerGenreStationCountsRecompute('bulk-import-stations');

      const finalCount = await pgCatalog().count();
      const hlsCount = await pgCatalog().count({ hls: true });
      const mp3Count = await pgCatalog().count({ format: 'MP3' });
      const aacCount = await pgCatalog().count({ format: 'AAC' });
      const oggCount = await pgCatalog().count({ format: 'OGG' });
      const otherCount = await pgCatalog().count({ format: 'Other' });
      
      res.json({
        success: true,
        totalImported: finalCount,
        formatBreakdown: { HLS: hlsCount, MP3: mp3Count, AAC: aacCount, OGG: oggCount, Other: otherCount },
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Bulk import failed', details: error.message });
    }
  });

  // DELETE STATION ENDPOINT (Admin Only)
  app.delete("/api/stations/:stationId", requireAdmin, async (req, res) => {
    try {
      const { stationId } = req.params;
      const station = await pgCatalog().findOne({ _id: stationId });
      if (!station) return void res.status(404).json({ error: 'Station not found' });
      
      const deleted = await pgCatalog().remove({ _id:stationId },{ reason:'Admin deletion',deletedBy:'admin' });
      if (!deleted.deletedCount) return void res.status(404).json({ error:'Station not found' });
      const blacklisted = true;
      if (station.slug) performanceCache.invalidateStationCache(station.slug);
      
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('genres');
      await CacheManager.clearByPattern('community_favorites');

      if (blacklisted) {
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        void import('../services/admin-audit-email')
          .then(({ emailBlacklistChangesCsv }) =>
            emailBlacklistChangesCsv({
              action: 'add',
              source: 'single deletion',
              rows: [
                {
                  name: station.name ?? '',
                  url: station.url ?? '',
                  stationUuid: station.stationuuid,
                  country: (station as any).country ?? '',
                  countryCode: (station as any).countrycode ?? '',
                  reason: 'Admin deletion',
                },
              ],
              actorEmail,
            }),
          )
          .catch((err) => {
            logger.error({ err }, 'Failed to send blacklist audit email');
          });
      }

      res.json({ success: true, message: 'Station deleted successfully and added to blacklist' });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to delete station' });
    }
  });

  // DUPLICATES DETECTION ENDPOINT (Admin Only)
  // Task #485: the admin "Detect Duplicates" page calls this endpoint to
  // group stations that share the same normalized name + country (or the
  // same stream URL) so they can be merged or bulk-deleted. The previous
  // build had no handler, so the SPA catch-all returned the index.html
  // shell — which the page tried to JSON.parse and then walked through
  // `new URL(station.favicon)`, surfacing the Safari "The string did not
  // match the expected pattern" error to the user.
  //
  // Response shape (matches duplicates.tsx expectations):
  //   { duplicates: [{ _id: {name, country} | string, count, stations: [...] }],
  //     total: number, totalStations: number }
  //
  // Public read soft-fail rule does NOT apply here (admin-only, behind
  // requireAdmin) — surface real errors so the admin can act on them.
  app.get("/api/admin/stations/duplicates", requireAdmin, async (req, res) => {
    try {
      const thresholdRaw = parseFloat(String(req.query.threshold ?? '0.85'));
      const threshold = Number.isFinite(thresholdRaw)
        ? Math.min(1, Math.max(0, thresholdRaw))
        : 0.85;
      const minLen = threshold >= 0.95 ? 1 : threshold >= 0.85 ? 3 : 4;
      // Allow caller to raise/lower the cap. Default 10 000 so "Select All"
      // in the admin UI captures every duplicate group in one request.
      const limitRaw = parseInt(String(req.query.limit ?? '10000'), 10);
      const groupLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50000) : 10000;

      const totalStations = await pgCatalog().count();

      // Group by normalized name + country. We deliberately stay on the
      // simple, deterministic name-equality strategy (case + whitespace
      // insensitive) instead of full fuzzy matching: it's fast, predictable,
      // and matches what the merge UI already does. The threshold knob still
      // gates the minimum normalized-name length so very short names ("FM",
      // "Mix") don't dominate the result.
      const groups = await pgDuplicateStationGroups(minLen,groupLimit);

      // Strip null/empty favicons so the frontend never tries to
      // `new URL("")` (the actual source of the Safari pattern-mismatch
      // error). The frontend already tolerates a missing favicon.
      const sanitized = groups.map((g: any) => ({
        _id: { name: g._id?.name ?? '', country: g._id?.country ?? '' },
        count: g.count,
        stations: (g.stations || []).map((s: any) => ({
          ...s,
          favicon:
            typeof s.favicon === 'string' && /^https?:\/\//i.test(s.favicon.trim())
              ? s.favicon.trim()
              : undefined,
        })),
      }));

      res.set('Cache-Control', 'no-store');
      res.json({
        duplicates: sanitized,
        total: sanitized.length,
        totalStations,
        threshold,
      });
    } catch (error: any) {
      logger.error(
        `❌ /api/admin/stations/duplicates failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`,
      );
      res.status(500).json({
        error: 'Failed to detect duplicates',
        details: error?.message || String(error),
      });
    }
  });

  // CITY DUPLICATES DETECTION (Admin Only)
  // Task #488: the admin Cities cleanup page calls these endpoints to find
  // stations whose `city` field differs only by capitalization / whitespace
  // (e.g. "ankara", "ANKARA", "Ankara") and merge them onto a single
  // canonical spelling. Without these handlers the SPA catch-all returned
  // the index.html shell, the JSON parse failed, and the page silently did
  // nothing.
  //
  // Response shape (matches cities.tsx expectations):
  //   {
  //     totalCityGroups: number,
  //     totalStationsAffected: number,
  //     duplicates: [{
  //       canonical: string,        // proper-cased target spelling
  //       lowerCity: string,        // normalised key (lowercase, trimmed)
  //       variations: [{ name, count, countries: string[] }],
  //       totalStations: number,
  //       countries: string[],
  //     }],
  //   }
  app.get("/api/admin/cities/duplicates", requireAdmin, async (_req, res) => {
    try {
      const groups = await pgDuplicateCityGroups();

      const duplicates = groups.map((g: any) => {
        const lowerCity: string = g._id ?? '';
        const variations: Array<{ name: string; count: number; countries: string[] }> = (
          g.variations || []
        ).map((v: any) => ({
          name: String(v.name ?? ''),
          count: Number(v.count ?? 0),
          countries: Array.isArray(v.countries)
            ? Array.from(new Set(v.countries.filter((c: any) => typeof c === 'string' && c)))
            : [],
        }));
        // Pick the canonical spelling. Preference order:
        //   1. An existing variation that already matches proper title-case.
        //   2. The most popular variation by station count.
        //   3. A computed title-case from the lowerCity.
        const titleCase = toTitleCaseCity(lowerCity);
        const titleCaseMatch = variations.find((v) => v.name === titleCase);
        const mostPopular = [...variations].sort((a, b) => b.count - a.count)[0];
        const canonical = titleCaseMatch
          ? titleCaseMatch.name
          : mostPopular
            ? mostPopular.name
            : titleCase;
        const countries = Array.from(
          new Set(
            (g.allCountries || [])
              .flat()
              .filter((c: any) => typeof c === 'string' && c),
          ),
        ) as string[];
        return {
          canonical,
          lowerCity,
          variations,
          totalStations: Number(g.totalStations ?? 0),
          countries,
        };
      });

      const totalStationsAffected = duplicates.reduce(
        (sum, d) => sum + d.totalStations,
        0,
      );

      res.set('Cache-Control', 'no-store');
      res.json({
        totalCityGroups: duplicates.length,
        totalStationsAffected,
        duplicates,
      });
    } catch (error: any) {
      logger.error(
        `❌ /api/admin/cities/duplicates failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`,
      );
      res.status(500).json({
        error: 'Failed to detect city duplicates',
        details: error?.message || String(error),
      });
    }
  });

  // MERGE CITY DUPLICATES (Admin Only)
  // Walks the same detection pipeline and, for every group, rewrites the
  // `city` field of every station whose spelling differs from the chosen
  // canonical. Stations are never deleted — only the `city` string is
  // standardised.
  app.post("/api/admin/cities/merge-duplicates", requireAdmin, async (_req, res) => {
    try {
      const groups = await pgDuplicateCityGroups();
      let totalStationsUpdated = 0;
      let cityGroupsProcessed = 0;
      const mergeOperations: Array<{ canonical:string; merged:string[]; stationsUpdated:number }> = [];

      for (const g of groups) {
        const lowerCity: string = g._id ?? '';
        const variations: Array<{ name: string; count: number }> = (g.variations || []).map(
          (v: any) => ({ name: String(v.name ?? ''), count: Number(v.count ?? 0) }),
        );
        const titleCase = toTitleCaseCity(lowerCity);
        const titleCaseMatch = variations.find((v) => v.name === titleCase);
        const mostPopular = [...variations].sort((a, b) => b.count - a.count)[0];
        const canonical = titleCaseMatch
          ? titleCaseMatch.name
          : mostPopular
            ? mostPopular.name
            : titleCase;

        const toRewrite = variations
          .map((v) => v.name)
          .filter((name) => name !== canonical);
        if (toRewrite.length === 0) continue;

        const result = await pgCatalog().update({ city: { $in: toRewrite } }, { $set: { city: canonical } }, { many: true });
        const updated =
          typeof (result as any).modifiedCount === 'number'
            ? (result as any).modifiedCount
            : typeof (result as any).nModified === 'number'
              ? (result as any).nModified
              : 0;
        totalStationsUpdated += updated;
        cityGroupsProcessed += 1;
        mergeOperations.push({
          canonical,
          merged: toRewrite,
          stationsUpdated: updated,
        });
      }

      // Sort merge ops by impact so the UI's "top 5" preview is meaningful.
      mergeOperations.sort((a, b) => b.stationsUpdated - a.stationsUpdated);

      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        stationsUpdated: totalStationsUpdated,
        cityGroupsProcessed,
        mergeOperations,
      });
    } catch (error: any) {
      logger.error(
        `❌ /api/admin/cities/merge-duplicates failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`,
      );
      res.status(500).json({
        success: false,
        error: 'Failed to merge city duplicates',
        details: error?.message || String(error),
      });
    }
  });

  // BULK DELETE STATIONS ENDPOINT (Admin Only) - For duplicates management
  app.post("/api/admin/delete-stations", requireAdmin, async (req, res) => {
    try {
      const { stationIds } = req.body;
      if (!Array.isArray(stationIds) || stationIds.length === 0) {
        return void res.status(400).json({ success: false, error: 'stationIds must be a non-empty array' });
      }

      const invalidIds = stationIds.filter(id => !isCatalogId(id));
      if (invalidIds.length > 0) {
        return void res.status(400).json({ success: false, error: `Invalid station IDs: ${invalidIds.join(', ')}` });
      }

      let deletedCount = 0;
      let blacklistedCount = 0;
      const errors: string[] = [];
      const SAMPLE_CAP = 500;
      const blacklistSamples: Array<{
        name: string;
        url: string;
        stationUuid?: string;
        country?: string;
        countryCode?: string;
        reason?: string;
      }> = [];

      for (const stationId of stationIds) {
        try {
          const station = await pgCatalog().findOne({ _id: stationId });
          if (!station) {
            errors.push(`Station ${stationId} not found`);
            continue;
          }

          const removed = await pgCatalog().remove({ _id:stationId },{ reason:'Admin bulk deletion from duplicates management',deletedBy:'admin' });
          deletedCount += removed.deletedCount; blacklistedCount += removed.deletedCount;
          if (station.slug) performanceCache.invalidateStationCache(station.slug);
          if (removed.deletedCount && blacklistSamples.length<SAMPLE_CAP) blacklistSamples.push({
            name:station.name,url:station.url,stationUuid:station.stationuuid,country:station.country || '',
            countryCode:station.countryCode || '',reason:'Admin bulk deletion from duplicates management' });

        } catch (stationError: any) {
          errors.push(`Error deleting station ${stationId}: ${stationError.message}`);
        }
      }

      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');
      await CacheManager.clearByPattern('community_favorites');

      // Task #185: bulk deletes can drop a slug below the indexable
      // threshold or to zero — refresh Genre.stationCount so the admin
      // page doesn't keep showing the pre-delete "live" badge.
      if (deletedCount > 0) {
        triggerGenreStationCountsRecompute('bulk-delete-stations');
      }

      if (blacklistSamples.length > 0) {
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        void import('../services/admin-audit-email')
          .then(({ emailBlacklistChangesCsv }) =>
            emailBlacklistChangesCsv({
              action: 'add',
              source: `bulk deletion (${blacklistedCount} station${blacklistedCount === 1 ? '' : 's'})`,
              rows: blacklistSamples,
              actorEmail,
            }),
          )
          .catch((err) => {
            logger.error({ err }, 'Failed to send blacklist audit email');
          });
      }

      res.json({
        success: true,
        deletedCount,
        blacklistedCount,
        message: `Successfully deleted ${deletedCount} station(s) and blacklisted ${blacklistedCount}`,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to delete stations', details: error.message });
    }
  });

  // Cleanup stations with URLs as names (Admin Only)
  app.post("/api/admin/cleanup-url-names", requireAdmin, async (req, res) => {
    try {
      // DB-side filter using case-insensitive regex for URL prefixes (avoids loading 40k+ docs into memory)
      const urlPrefixRegex = /^(https?:\/\/|www\.|ftps?:\/\/|rtmps?:\/\/|rtsps?:\/\/)/i;
      const filter = { name: { $regex: urlPrefixRegex } };

      let deletedCount = 0;
      let blacklistedCount = 0;
      const errors: string[] = [];
      const SAMPLE_CAP = 500;
      const blacklistSamples: Array<{
        name: string;
        url: string;
        stationUuid?: string;
        country?: string;
        countryCode?: string;
        reason?: string;
      }> = [];

      // Stream matching stations via cursor — bounded memory regardless of match count
      const cursor = pgCatalog().iterate(filter,{ batchSize:500,fields:['_id','name','url','stationuuid','slug','country','countryCode'] });

      for await (const station of cursor as any) {
        try {
          const removed = await pgCatalog().remove({ _id:station._id },{ reason:'Station name is a URL - auto-cleanup',deletedBy:'admin' });
          deletedCount += removed.deletedCount; blacklistedCount += removed.deletedCount;
          if (station.slug) performanceCache.invalidateStationCache(station.slug);
          if (removed.deletedCount && blacklistSamples.length<SAMPLE_CAP) blacklistSamples.push({
            name:station.name,url:station.url,stationUuid:station.stationuuid,country:station.country || '',
            countryCode:station.countryCode || '',reason:'Station name is a URL - auto-cleanup' });
        } catch (stationError: any) {
          errors.push(`Error deleting station ${station._id}: ${stationError.message}`);
        }
      }

      if (deletedCount === 0) {
        return void res.json({ success: true, deletedCount: 0, blacklistedCount: 0, message: 'No stations with URL names found' });
      }
      
      await CacheManager.clearByPattern('popular_stations');
      await CacheManager.clearByPattern('stations');

      if (blacklistSamples.length > 0) {
        const actorEmail =
          (req.user as { email?: string } | undefined)?.email ?? undefined;
        void import('../services/admin-audit-email')
          .then(({ emailBlacklistChangesCsv }) =>
            emailBlacklistChangesCsv({
              action: 'add',
              source: `URL-name cleanup (${blacklistedCount} station${blacklistedCount === 1 ? '' : 's'})`,
              rows: blacklistSamples,
              actorEmail,
            }),
          )
          .catch((err) => {
            logger.error({ err }, 'Failed to send blacklist audit email');
          });
      }

      res.json({
        success: true,
        deletedCount,
        blacklistedCount,
        message: `Successfully deleted ${deletedCount} station(s) with URL names and blacklisted ${blacklistedCount}`,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to cleanup URL-named stations', details: error.message });
    }
  });

  // BLACKLISTED STATIONS ENDPOINTS (Admin Only)
  // Pre-emptively add a station URL/UUID to the blacklist without first
  // having to import then delete it. Reuses the same audit-email pipeline
  // as the deletion-side blacklist additions so admins still get a CSV
  // record of every manual block. (Task #260)
  app.post("/api/admin/blacklisted-stations", requireAdmin, async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        stationUuid?: unknown;
        url?: unknown;
        name?: unknown;
        reason?: unknown;
      };
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const stationUuid = typeof body.stationUuid === 'string' ? body.stationUuid.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!url) return void res.status(400).json({ error: 'url is required' });
      if (!name) return void res.status(400).json({ error: 'name is required' });

      const actorEmail = (req.user as { email?: string } | undefined)?.email ?? undefined;
      const created = await pgBlacklistAdd({
        stationUuid: stationUuid || undefined,
        url,
        name,
        reason: reason || 'Manual blacklist',
        deletedBy: actorEmail || (req.session as any)?.adminAuth?.username || 'admin',
      }, { adminReban: true });

      void import('../services/admin-audit-email')
        .then(({ emailBlacklistChangesCsv }) =>
          emailBlacklistChangesCsv({
            action: 'add',
            source: 'manual blacklist',
            rows: [
              {
                name,
                url,
                stationUuid: stationUuid || undefined,
                reason: reason || 'Manual blacklist',
              },
            ],
            actorEmail,
          }),
        )
        .catch((err) => {
          logger.error({ err }, 'Failed to send blacklist audit email');
        });

      res.status(201).json({ success: true, blacklistedStation: created });
    } catch (error: any) {
      if (error?.code === 'STATION_ALREADY_BLACKLISTED') {
        return void res.status(409).json({
          error: 'Station is already blacklisted',
          blacklistedStation: error.blacklistedStation,
        });
      }
      logger.error(`Error in POST /api/admin/blacklisted-stations: ${error?.message || error}`);
      res.status(500).json({ error: 'Failed to add station to blacklist' });
    }
  });

  app.get("/api/admin/blacklisted-stations", requireAdmin, async (req, res) => {
    try {
      const page = Math.max(1,Number.parseInt(String(req.query.page),10) || 1);
      const limit = Math.max(1,Math.min(500,Number.parseInt(String(req.query.limit),10) || 50));
      const { total,rows:blacklistedStations } = await pgBlacklistPage(String(req.query.search || ''),limit,(page-1)*limit);
      
      res.json({
        stations: blacklistedStations,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch blacklisted stations' });
    }
  });

  app.post("/api/admin/blacklisted-stations/:blacklistId/restore", requireAdmin, async (req, res) => {
    const sendUnblacklistEmail = (
      bl: { name?: string; url?: string; stationUuid?: string; reason?: string },
    ) => {
      const actorEmail =
        (req.user as { email?: string } | undefined)?.email ?? undefined;
      void import('../services/admin-audit-email')
        .then(({ emailBlacklistChangesCsv }) =>
          emailBlacklistChangesCsv({
            action: 'remove',
            source: 'restore from blacklist',
            rows: [
              {
                name: bl.name ?? '',
                url: bl.url ?? '',
                stationUuid: bl.stationUuid,
                reason: bl.reason ?? '',
              },
            ],
            actorEmail,
          }),
        )
        .catch((err) => {
          logger.error({ err }, 'Failed to send blacklist audit email');
        });
    };
    try {
      const { blacklistId } = req.params;
      const blacklistedStation = await pgBlacklistGet(blacklistId);
      if (!blacklistedStation) return void res.status(404).json({ error:'Blacklisted station not found' });
      let fresh: Record<string,any> | undefined;
      if (blacklistedStation.stationUuid) {
        try {
          const response = await fetch('https://de1.api.radio-browser.info/json/stations/byuuid/'+encodeURIComponent(blacklistedStation.stationUuid),{ signal:AbortSignal.timeout(15000) });
          if (response.ok) {
            const data = await response.json() as any[];
            if (Array.isArray(data) && data[0]) fresh = data[0];
          }
        } catch(error) { logger.warn('Fresh station data unavailable; restoring cached record',error instanceof Error ? error.message : String(error)); }
      }
      const restoredStation = await pgCatalog().restoreBlacklisted(blacklistId,fresh);
      if (!restoredStation) return void res.status(404).json({ error:'Blacklisted station not found' });
      await Promise.all(['stations','popular_stations'].map(pattern=>CacheManager.clearByPattern(pattern)));
      sendUnblacklistEmail(blacklistedStation);
      res.json({ success:true,message:fresh ? 'Station restored successfully with fresh data' : 'Station restored successfully with cached data',station:restoredStation });
    } catch (error) {
      res.status(500).json({ error: 'Failed to restore station' });
    }
  });

  app.get("/api/admin/db-status", requireAdmin, async (req, res) => {
    try {
      res.json({ ...await pgDatabaseSizeReport(),quotaStatus:getQuotaStatus() });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to get DB status', details: error.message });
    }
  });

  app.post("/api/admin/db-cleanup", requireAdmin, async (req, res) => {
    try {
      const targets = req.body.collections;
      if (targets !== undefined && (!Array.isArray(targets) || targets.some((value:unknown)=>typeof value!=='string'))) return void res.status(400).json({ error:'collections must be an array of names' });
      const results = await pgPurgeOperationalData(targets);
      res.json({ success:results.every(row=>row.status==='cleaned'),results });
    } catch (error: any) {
      res.status(500).json({ error: 'Cleanup failed', details: error.message });
    }
  });

  app.post("/api/admin/db-drop-collection", requireAdmin, async (req, res) => {
    try {
      const { collection } = req.body;
      if (!collection) return void res.status(400).json({ error: 'Collection name required' });

      const droppable = ['applogs', 'analyticsevents', 'stationdebuglogs', 'bulkdescriptionjobs'];
      if (!droppable.includes(collection.toLowerCase())) {
        return void res.status(400).json({ error: `Collection "${collection}" cannot be dropped. Allowed: ${droppable.join(', ')}` });
      }

      const results = await pgPurgeOperationalData([collection],true);
      if (results.some(row=>row.status==='error')) return void res.status(500).json({ success:false,results });
      res.json({ success:true,message:'Operational records cleared; PostgreSQL schema and indexes preserved',results });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to drop collection', details: error.message });
    }
  });

  // Re-check tags from Radio-Browser for a single station (admin override).
  // Bypasses the `tagsCheckedAt` cooldown that the background hydration job
  // honours, so admins can force a refresh on stations stamped as
  // upstream-empty.
  app.post(
    "/api/admin/stations/:stationId/recheck-tags",
    requireAdmin,
    async (req, res) => {
      try {
        const { stationId } = req.params;
        const result = await syncService.recheckStationTags(stationId);
        if (!result.success) {
          return void res.status(400).json(result);
        }
        return void res.json(result);
      } catch (error: any) {
        logger.error('recheck-tags single failed', error);
        return void res
          .status(500)
          .json({ success: false, error: error?.message || 'Failed to re-check tags' });
      }
    },
  );

  // Bulk re-check tags. Clears `tagsCheckedAt` for the targeted stations
  // (so the next hydration sweep re-queries them) and immediately kicks off
  // the hydration job in the background. Targeting is via either
  // `stationIds` (specific stations) or `countryCode` (all empty-tag
  // stations in that country). At least one must be provided.
  app.post(
    "/api/admin/stations/recheck-tags-bulk",
    express.json({ limit: '1mb' }),
    requireAdmin,
    async (req, res) => {
      try {
        const {
          stationIds,
          countryCode,
          tagsStatus,
          search,
          language,
          genre,
        } = (req.body || {}) as {
          stationIds?: unknown;
          countryCode?: unknown;
          tagsStatus?: unknown;
          search?: unknown;
          language?: unknown;
          genre?: unknown;
        };

        const ids = Array.isArray(stationIds)
          ? (stationIds.filter(
              (id) => typeof id === 'string' && isCatalogId(id),
            ) as string[])
          : [];
        const rawCountry =
          typeof countryCode === 'string' && countryCode.trim()
            ? countryCode.trim()
            : undefined;
        const rawTagsStatus =
          typeof tagsStatus === 'string' && tagsStatus.trim()
            ? tagsStatus.trim()
            : undefined;
        const rawSearch =
          typeof search === 'string' && search.trim() ? search.trim() : undefined;
        const rawLanguage =
          typeof language === 'string' && language.trim() && language !== 'all'
            ? language.trim()
            : undefined;
        const rawGenre =
          typeof genre === 'string' && genre.trim() && genre !== 'all'
            ? genre.trim()
            : undefined;

        const isFilterMode =
          rawTagsStatus === 'empty-cooldown' || rawTagsStatus === 'never-checked';

        if (ids.length === 0 && !rawCountry && !isFilterMode) {
          return void res.status(400).json({
            success: false,
            error: 'Provide stationIds, countryCode, or tagsStatus',
          });
        }

        // Country input may arrive as either an ISO code (e.g. "DE")
        // or a full DB country name (e.g. "Germany") — the admin
        // filters dropdown sends the latter via `/api/filters/countries`.
        // Resolve both forms so the bulk path matches reliably.
        let resolvedIso: string | undefined;
        let countryFilter: Record<string, unknown> = {};
        if (rawCountry) {
          const dbName = resolveToDbName(rawCountry);
          if (dbName) {
            const iso = dbNameToIso(dbName);
            if (iso) {
              resolvedIso = iso.toUpperCase();
              countryFilter = {
                $or: [
                  { countryCode: resolvedIso },
                  { country: { $regex: new RegExp(`^${dbName}$`, 'i') } },
                ],
              };
            } else {
              countryFilter = {
                country: { $regex: new RegExp(`^${dbName}$`, 'i') },
              };
            }
          } else {
            // Fall back to a regex match on the raw input.
            countryFilter = normalizeCountryFilter(rawCountry);
          }
        }

        const filter: Record<string, unknown> = {};
        if (ids.length > 0) {
          filter._id = { $in: ids.map((id) => id) };
        } else if (isFilterMode) {
          // Filter-driven bulk: target every station matching the
          // current admin "tagsStatus" filter (and any additional
          // search/country/language/genre filters), not just the
          // visible page. Mirrors the predicate used by the GET
          // /api/admin/stations endpoint. We compose every constraint
          // inside `$and` so independent `$or` clauses (country
          // alternatives, search alternatives, empty-tags alternatives)
          // never clobber each other.
          const emptyTagsPredicate: Record<string, unknown> = {
            $or: [
              { tags: { $exists: false } },
              { tags: null },
              { tags: '' },
              { tags: { $regex: /^\s*$/ } },
            ],
          };
          const andConds: Record<string, unknown>[] = [emptyTagsPredicate];
          if (rawTagsStatus === 'empty-cooldown') {
            const cooldownCutoff = new Date(
              Date.now() - 30 * 24 * 60 * 60 * 1000,
            );
            andConds.push({ tagsCheckedAt: { $gte: cooldownCutoff } });
          } else {
            andConds.push({
              $or: [
                { tagsCheckedAt: { $exists: false } },
                { tagsCheckedAt: null },
              ],
            });
          }
          if (Object.keys(countryFilter).length > 0) {
            andConds.push(countryFilter);
          }
          if (rawSearch) {
            andConds.push({
              $or: [
                { name: { $regex: new RegExp(rawSearch, 'i') } },
                { country: { $regex: new RegExp(rawSearch, 'i') } },
                { tags: { $regex: new RegExp(rawSearch, 'i') } },
              ],
            });
          }
          if (rawLanguage) {
            andConds.push({
              language: { $regex: new RegExp(rawLanguage, 'i') },
            });
          }
          if (rawGenre) {
            andConds.push({ tags: { $regex: new RegExp(rawGenre, 'i') } });
          }
          filter.$and = andConds;
        } else {
          Object.assign(filter, countryFilter);
          filter.$and = [
            {
              $or: [
                { tags: { $exists: false } },
                { tags: null },
                { tags: '' },
              ],
            },
          ];
        }

        // Resolve every matching station for filter-mode so the
        // background re-check targets exactly the cleared rows. We
        // page through the cursor (no fixed cap) so requests with
        // tens of thousands of stuck stations are still fully covered.
        let filterModeIds: string[] = [];
        if (isFilterMode) {
          const cursor = pgCatalog().iterate(filter,{ fields:['_id'] });
          for await (const doc of cursor) {
            const id = (doc as { _id: string })._id;
            if (id) filterModeIds.push(id.toString());
          }
        }

        let cleared = 0;
        let matched = 0;
        if (isFilterMode) {
          matched = filterModeIds.length;
          const updateChunkSize = 5000;
          for (let i = 0; i < filterModeIds.length; i += updateChunkSize) {
            const chunk = filterModeIds.slice(i, i + updateChunkSize);
            const chunkResult = await pgCatalog().update({
                _id: {
                  $in: chunk.map((id) => id),
                },
              }, { $unset: { tagsCheckedAt: '' } }, { many: true });
            cleared += chunkResult.modifiedCount ?? 0;
          }
        } else {
          const updateResult = await pgCatalog().update(filter, { $unset: { tagsCheckedAt: '' } }, { many: true });
          cleared = updateResult.modifiedCount ?? 0;
          matched = updateResult.matchedCount ?? cleared;
        }

        // Create an in-memory job so the admin UI can stream progress
        // (over SSE) while the background hydration runs. Only
        // ID-scoped paths produce per-station progress; the country
        // hydration sweep runs as a fire-and-forget background scan
        // that doesn't expose progress, so we leave the job in
        // `running` until we detect it has nothing to track and mark
        // it completed.
        cleanupRecheckTagsJobs();
        const jobId = crypto.randomBytes(12).toString('hex');
        const scopeBits: string[] = [];
        if (ids.length > 0) scopeBits.push(`${ids.length} selected`);
        if (rawTagsStatus) scopeBits.push(rawTagsStatus);
        if (resolvedIso ?? rawCountry) scopeBits.push(`country ${resolvedIso ?? rawCountry}`);
        if (rawLanguage) scopeBits.push(`language ${rawLanguage}`);
        if (rawGenre) scopeBits.push(`genre ${rawGenre}`);
        if (rawSearch) scopeBits.push(`search "${rawSearch}"`);
        const job: RecheckTagsJob = {
          jobId,
          status: 'running',
          total: 0,
          processed: 0,
          hydrated: 0,
          emptyUpstream: 0,
          failed: 0,
          cleared,
          matched,
          scope: scopeBits.join(', ') || undefined,
          startedAt: Date.now(),
          cancelRequested: false,
          cancellable: false,
        };
        recheckTagsJobs.set(jobId, job);

        const isCancelled = () => recheckTagsJobs.get(jobId)?.cancelRequested === true;

        const onProgress = (p: {
          processed: number;
          hydrated: number;
          emptyUpstream: number;
          failed: number;
          total: number;
        }) => {
          const current = recheckTagsJobs.get(jobId);
          if (!current) return;
          current.total = p.total;
          current.processed = p.processed;
          current.hydrated = p.hydrated;
          current.emptyUpstream = p.emptyUpstream;
          current.failed = p.failed;
          recheckTagsJobs.set(jobId, current);
          notifyRecheckTagsJobSubscribers(jobId);
        };
        const finish = (err?: unknown) => {
          const current = recheckTagsJobs.get(jobId);
          if (!current) return;
          // Task #185: a tag re-check can move stations into/out of slugs.
          // Refresh Genre.stationCount so the admin Genre Whitelist page
          // doesn't keep showing pre-recheck totals.
          if ((current.hydrated ?? 0) > 0 || (current.processed ?? 0) > 0) {
            triggerGenreStationCountsRecompute(`recheck-tags-bulk:${jobId}`);
          }
          // If cancellation was requested but the loop had already finished
          // every station before observing the flag, prefer the truthful
          // 'completed' status so admins don't see a misleading "cancelled"
          // label on a run that actually processed everything.
          const fullyProcessed =
            current.total > 0 && current.processed >= current.total;
          if (current.cancelRequested && !fullyProcessed) {
            current.status = 'cancelled';
          } else {
            current.status = err ? 'failed' : 'completed';
          }
          current.finishedAt = Date.now();
          if (err && current.status === 'failed') {
            current.error = err instanceof Error ? err.message : String(err);
          }
          recheckTagsJobs.set(jobId, current);
          notifyRecheckTagsJobSubscribers(jobId);
        };

        // Kick off the actual re-query in the background so the admin
        // gets immediate feedback. Targeted ID requests use the
        // ID-scoped helper so we re-query exactly those stations;
        // country requests use the country-scoped hydration sweep
        // (which itself filters on `countryCode` ISO).
        if (ids.length > 0) {
          job.total = ids.length;
          job.cancellable = true;
          void syncService
            .recheckStationsTagsByIds(ids, onProgress, isCancelled)
            .then(() => finish())
            .catch((err) => {
              logger.error('bulk tags recheck (ids) failed', err);
              finish(err);
            });
        } else if (isFilterMode) {
          if (filterModeIds.length > 0) {
            job.total = filterModeIds.length;
            job.cancellable = true;
            void syncService
              .recheckStationsTagsByIds(filterModeIds, onProgress, isCancelled)
              .then(() => finish())
              .catch((err) => {
                logger.error('bulk tags recheck (filter) failed', err);
                finish(err);
              });
          } else {
            finish();
          }
        } else if (resolvedIso) {
          job.total = matched;
          job.cancellable = true;
          void syncService
            .hydrateMissingTagsInBackground({
              countryCode: resolvedIso,
              limit: Math.max(matched, 1000),
              isCancelled,
              onProgress,
            })
            .then((result) => {
              // Fold the final tallies back into the job tracker before
              // finish() decides between completed / cancelled. The
              // per-batch onProgress stream already keeps the UI live,
              // but this guarantees the final numbers (and the
              // `fullyProcessed` safeguard in finish()) line up even if
              // the last progress tick was missed.
              const current = recheckTagsJobs.get(jobId);
              if (current) {
                current.processed = result.processed;
                current.hydrated = result.hydrated;
                current.emptyUpstream = result.emptyUpstream;
                current.failed = result.failed;
                recheckTagsJobs.set(jobId, current);
                notifyRecheckTagsJobSubscribers(jobId);
              }
              finish();
            })
            .catch((err) => {
              logger.error('bulk tags recheck (country) failed', err);
              finish(err);
            });
        } else if (rawCountry) {
          // No ISO code resolvable — fall back to ID-scoped sweep
          // over the matched stations so we still re-query them.
          const matchedDocs = (await pgCatalog().find(filter, { fields: ["_id"], limit: 5000 })) as unknown as Array<{ _id: string }>;
          const matchedIds = matchedDocs.map((d) => d._id.toString());
          if (matchedIds.length > 0) {
            job.total = matchedIds.length;
            job.cancellable = true;
            void syncService
              .recheckStationsTagsByIds(matchedIds, onProgress, isCancelled)
              .then(() => finish())
              .catch((err) => {
                logger.error('bulk tags recheck (country fallback) failed', err);
                finish(err);
              });
          } else {
            finish();
          }
        } else {
          finish();
        }

        return void res.json({
          success: true,
          jobId,
          cleared,
          matched,
          countryCode: resolvedIso ?? rawCountry,
          stationIdsCount: ids.length,
          tagsStatus: rawTagsStatus,
          message: `Cleared tagsCheckedAt for ${cleared} station(s) (${matched} matched); re-check job started`,
        });
      } catch (error: any) {
        logger.error('recheck-tags bulk failed', error);
        return void res
          .status(500)
          .json({ success: false, error: error?.message || 'Failed to bulk re-check tags' });
      }
    },
  );

  // Cancel a running bulk tag re-check job. The background loops in
  // `recheckStationsTagsByIds` and `hydrateMissingTagsInBackground` both
  // poll the job's `cancelRequested` flag between batches and exit
  // cleanly, after which `finish()` will mark the job as `cancelled`.
  app.post(
    '/api/admin/stations/recheck-tags-job-cancel/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      const job = recheckTagsJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.status !== 'running') {
        return void res.json({ success: true, job, alreadyFinished: true });
      }
      if (!job.cancellable) {
        return void res
          .status(409)
          .json({ success: false, error: 'Job is not cancellable' });
      }
      job.cancelRequested = true;
      recheckTagsJobs.set(jobId, job);
      notifyRecheckTagsJobSubscribers(jobId);
      logger.log(`🛑 Bulk tag re-check job ${jobId} cancellation requested`);
      return void res.json({ success: true, job });
    },
  );

  // Live progress stream for a bulk tag re-check job. Admins see
  // processed/hydrated/failed counts the moment each batch finishes,
  // and the header tagless badge updates as soon as the server reports
  // progress. The stream emits an initial `snapshot`, one `progress`
  // event per change while the job is running, and a final `done`
  // event on terminal status before closing. Unknown jobs (e.g.
  // evicted after the 1-hour TTL) get a `not-found` event so the
  // client can stop reconnecting and clear the persisted job id.
  app.get(
    '/api/admin/stations/recheck-tags-job-stream/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      cleanupRecheckTagsJobs();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Disable proxy buffering so each event flushes immediately.
        'X-Accel-Buffering': 'no',
      });
      // Express 5 doesn't always flush headers eagerly for SSE.
      res.flushHeaders?.();

      const send = (event: string, payload: unknown) => {
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch {
          // socket likely already closed; cleanup happens via 'close'
        }
      };

      const job = recheckTagsJobs.get(jobId);
      if (!job) {
        send('not-found', { jobId });
        return void res.end();
      }

      send('snapshot', job);
      if (job.status !== 'running') {
        send('done', job);
        return void res.end();
      }

      let closed = false;
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          res.write(': ping\n\n');
        } catch {
          // ignore; 'close' will clean up
        }
      }, 15000);

      const sub: RecheckTagsJobSubscriber = (j) => {
        if (closed) return;
        if (j.status === 'running') {
          send('progress', j);
        } else {
          send('done', j);
          cleanup();
          try {
            res.end();
          } catch {
            // ignore
          }
        }
      };

      let subs = recheckTagsJobSubscribers.get(jobId);
      if (!subs) {
        subs = new Set();
        recheckTagsJobSubscribers.set(jobId, subs);
      }
      subs.add(sub);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        const s = recheckTagsJobSubscribers.get(jobId);
        if (s) {
          s.delete(sub);
          if (s.size === 0) recheckTagsJobSubscribers.delete(jobId);
        }
      };

      req.on('close', cleanup);
      return;
    },
  );

  app.get(
    '/api/admin/coverage/by-country',
    requireAdmin,
    async (_req, res) => {
      try {
        const rows = await pgCoverage().coverage().then(rows=>rows.map(row=>({...row,_id:row.countryCode})));

        const decorated = rows
          .map((row) => {
            const code = String(row._id || '').toUpperCase();
            const total = Number(row.total) || 0;
            const withLogo = Number(row.withLogo) || 0;
            const withTags = Number(row.withTags) || 0;
            const dbName = resolveToDbName(code) || code;
            return {
              countryCode: code,
              countryName: dbName,
              total,
              withLogo,
              withTags,
              missingLogo: Math.max(total - withLogo, 0),
              missingTags: Math.max(total - withTags, 0),
              logoCoveragePct:
                total > 0 ? Math.round((withLogo / total) * 1000) / 10 : 0,
              tagCoveragePct:
                total > 0 ? Math.round((withTags / total) * 1000) / 10 : 0,
            };
          })
          .sort((a, b) => b.total - a.total);

        return void res.json({ countries: decorated });
      } catch (error: any) {
        logger.error('coverage by-country failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to compute country coverage',
        });
      }
    },
  );

  app.get(
    '/api/admin/coverage/backfill-status',
    requireAdmin,
    async (_req, res) => {
      try {
        type BackfillStatusDoc = {
          outcome: string;
          message: string;
          observedAt: Date;
          startedAt?: Date;
          finishedAt?: Date;
          durationMs?: number;
          thresholdDays?: number;
          historicalDayCount?: number;
          seedDays?: number;
          daysSeeded?: number;
          inserted?: number;
          preserved?: number;
          error?: string;
          updatedAt?: Date;
        };
        const [doc, historyDocs] = await Promise.all([
          pgCoverage().status(),
          // Task #316: small bounded list of past boot evaluations so
          // the UI can render a "Previous boot runs" panel under the
          // latest status. Sorted newest-first; capped writes-side to
          // ~20 rows so this is always a tiny query.
          pgCoverage().statusHistory(20),
        ]);
        const serializeRun = (d: BackfillStatusDoc) => ({
          outcome: d.outcome,
          message: d.message,
          observedAt:
            d.observedAt instanceof Date
              ? d.observedAt.toISOString()
              : d.observedAt,
          startedAt:
            d.startedAt instanceof Date
              ? d.startedAt.toISOString()
              : (d.startedAt ?? null),
          finishedAt:
            d.finishedAt instanceof Date
              ? d.finishedAt.toISOString()
              : (d.finishedAt ?? null),
          durationMs: d.durationMs ?? null,
          thresholdDays: d.thresholdDays ?? null,
          historicalDayCount: d.historicalDayCount ?? null,
          seedDays: d.seedDays ?? null,
          daysSeeded: d.daysSeeded ?? null,
          inserted: d.inserted ?? null,
          preserved: d.preserved ?? null,
          error: d.error ?? null,
        });
        const history = historyDocs.map(serializeRun);
        if (!doc) {
          return void res.json({ status: null, history });
        }
        return void res.json({
          status: serializeRun(doc),
          history,
        });
      } catch (error: any) {
        logger.error('coverage backfill-status failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to load coverage backfill status',
        });
      }
    },
  );

  // COVERAGE TRENDS — return per-country daily coverage snapshots from the
  // last N days (default 30) so the admin coverage page can render a small
  // sparkline and a 30-day delta beside today's numbers. Snapshots are
  // populated nightly by `services/scheduled-coverage-snapshot.ts`.
  app.get(
    '/api/admin/coverage/trends',
    requireAdmin,
    async (req, res) => {
      try {
        const rawDays = Number(req.query.days);
        const days = Number.isFinite(rawDays)
          ? Math.min(Math.max(Math.floor(rawDays), 1), 180)
          : 30;
        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        since.setUTCDate(since.getUTCDate() - (days - 1));

        // Optional countryCode filter — when the per-country trend page asks
        // for a single market we don't need to ship every other country's
        // snapshots over the wire. The compare view passes a comma-separated
        // list (e.g. `TR,DE,US`) to overlay several markets on one chart, so
        // accept either a single ISO-2 code or a CSV of them. Anything that
        // isn't a valid ISO-2 code is silently dropped, and an empty result
        // means "no filter" (return everything).
        const rawCountry =
          typeof req.query.countryCode === 'string'
            ? req.query.countryCode.trim().toUpperCase()
            : '';
        const countryList = rawCountry
          ? Array.from(
              new Set(
                rawCountry
                  .split(',')
                  .map((c) => c.trim())
                  .filter((c) => /^[A-Z]{2}$/.test(c)),
              ),
            )
          : [];
        const countryFilter =
          countryList.length === 1
            ? countryList[0]
            : countryList.length > 1
              ? { $in: countryList }
              : null;

        type SnapshotRow = {
          countryCode: string;
          snapshotDate: Date;
          logoCoveragePct: number;
          tagCoveragePct: number;
          total: number;
          withLogo: number;
          withTags: number;
          source?: 'cron' | 'backfill';
        };
        type TrendPoint = Omit<SnapshotRow, 'countryCode' | 'snapshotDate'> & {
          date: string;
          // Always present in the response (legacy rows missing the DB
          // field default to 'cron'), so the UI can render reconstructed
          // backfill points distinctly from real cron snapshots.
          source: 'cron' | 'backfill';
        };

        const rows = await pgCoverage().snapshots({since,countries:countryList});

        const byCountry = new Map<string, TrendPoint[]>();
        for (const r of rows) {
          const code = String(r.countryCode || '').toUpperCase();
          if (!code) continue;
          const date =
            r.snapshotDate instanceof Date
              ? r.snapshotDate.toISOString().slice(0, 10)
              : String(r.snapshotDate).slice(0, 10);
          const list = byCountry.get(code) || [];
          list.push({
            date,
            logoCoveragePct: Number(r.logoCoveragePct) || 0,
            tagCoveragePct: Number(r.tagCoveragePct) || 0,
            total: Number(r.total) || 0,
            withLogo: Number(r.withLogo) || 0,
            withTags: Number(r.withTags) || 0,
            source: r.source === 'backfill' ? 'backfill' : 'cron',
          });
          byCountry.set(code, list);
        }

        const trends: Record<string, TrendPoint[]> = {};
        for (const [code, list] of byCountry) {
          trends[code] = list;
        }

        return void res.json({
          days,
          since: since.toISOString(),
          trends,
        });
      } catch (error: any) {
        logger.error('coverage trends failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to fetch coverage trends',
        });
      }
    },
  );

  // COVERAGE DROP ALERTS — surface nightly coverage drop alerts (written
  // by `services/coverage-drop-notifier.ts` as admin `UserNotification`
  // rows with `data.kind === 'coverage_drop'`) so the admin coverage
  // page can highlight which countries triggered the alert without
  // forcing admins to dig through the generic notifications UI.
  //
  // Default response (no query params) preserves the original shape:
  //   { alert: <latestAlert | null> }
  //
  // When `history=1` is passed, the response also includes a paginated
  // tail of older alerts (Task #239) so admins can spot chronically
  // flaky countries straight from the coverage page:
  //   { alert, history: <Alert[]>, hasMore: boolean, nextBefore: string|null }
  // Use `before=<isoTimestamp>` to fetch the next page (cursor on the
  // alert's snapshotDate, fallback createdAt). `limit` defaults to 10
  // and is clamped to [1, 50].
  //
  // Acknowledgement (Task #238): admins can dismiss the banner for the
  // current alert via POST /api/admin/coverage/drop-alerts/acknowledge.
  // The acknowledgement is keyed by snapshotDate and stored in
  // `AdminSetting` under `coverage-drop-alert-ack`, so it is shared
  // across admins and survives reloads. Once a newer alert (different
  // snapshotDate) arrives the banner shows again automatically. Only
  // the alert whose `snapshotDate` matches the stored ack carries
  // `acknowledged: true` — historical alerts in the `history` array
  // always render with `acknowledged: false`.
  app.get(
    '/api/admin/coverage/drop-alerts',
    requireAdmin,
    async (req, res) => {
      try {
        type RawDrop = {
          countryCode: string;
          metric: 'logo' | 'tag';
          todayPct: number;
          weekAgoPct: number;
          deltaPp: number;
          total: number;
        };
        type RawAlertData = {
          kind?: string;
          snapshotDate?: string;
          thresholdPp?: number;
          drops?: RawDrop[];
        };
        // Look up any acknowledgement (Task #238) once per request and
        // annotate the alert whose snapshotDate matches it. We always
        // resolve `acknowledged` so the client can decide whether to
        // render the banner. In history mode only the matching alert
        // (typically the latest) carries `acknowledged: true`; older
        // alerts in the list always come back as `acknowledged: false`.
        const ackDoc = await getAdminSetting(COVERAGE_DROP_ACK_KEY);
        const ackValue = (ackDoc?.value ?? null) as {
          snapshotDate?: string | null;
          acknowledgedAt?: string | null;
          acknowledgedBy?: string | null;
        } | null;
        const ackSnapshotDate =
          ackValue && typeof ackValue.snapshotDate === 'string'
            ? ackValue.snapshotDate
            : null;

        const shapeAlert = (doc: {
          createdAt?: Date | string | null;
          message?: string | null;
          data?: unknown;
        }) => {
          const data = (doc.data ?? {}) as RawAlertData;
          const drops = Array.isArray(data.drops) ? data.drops : [];
          const snapshotDate = data.snapshotDate ?? null;
          const ackMatches =
            !!ackSnapshotDate && ackSnapshotDate === snapshotDate;
          return {
            createdAt:
              doc.createdAt instanceof Date
                ? doc.createdAt.toISOString()
                : typeof doc.createdAt === 'string'
                  ? doc.createdAt
                  : new Date().toISOString(),
            snapshotDate,
            thresholdPp:
              typeof data.thresholdPp === 'number' ? data.thresholdPp : null,
            message: doc.message ?? '',
            drops: drops.map((d) => ({
              countryCode: String(d.countryCode || '').toUpperCase(),
              metric: d.metric,
              todayPct: Number(d.todayPct) || 0,
              weekAgoPct: Number(d.weekAgoPct) || 0,
              deltaPp: Number(d.deltaPp) || 0,
              total: Number(d.total) || 0,
            })),
            acknowledged: ackMatches,
            acknowledgedAt: ackMatches
              ? ackValue?.acknowledgedAt ?? null
              : null,
            acknowledgedBy: ackMatches
              ? ackValue?.acknowledgedBy ?? null
              : null,
          };
        };

        const wantHistory =
          req.query.history === '1' ||
          req.query.history === 'true' ||
          req.query.history === 'yes';

        // Sort by `data.snapshotDate` first (the date the alert is *about*)
        // and fall back to `createdAt` so historical replays / backfills
        // don't misorder. In normal nightly operation the two correlate.
        if (!wantHistory) {
          const latest = await pgCoverage().alerts(1).then(rows=>rows[0]??null);

          if (!latest) {
            return void res.json({ alert: null });
          }
          return void res.json({ alert: shapeAlert(latest) });
        }

        const rawLimit = Number(req.query.limit);
        const limit =
          Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(50, Math.max(1, Math.floor(rawLimit)))
            : 10;

        const filter: Record<string, unknown> = {
          type: 'system',
          'data.kind': 'coverage_drop',
        };
        const beforeParam =
          typeof req.query.before === 'string' ? req.query.before.trim() : '';
        if (beforeParam) {
          // Cursor: only return alerts strictly older than the supplied
          // snapshot date. We use the same date string the client got
          // back in the previous page's `nextBefore` (a YYYY-MM-DD or an
          // ISO timestamp).
          filter['data.snapshotDate'] = { $lt: beforeParam };
        }

        // Fetch one extra row to determine `hasMore` without a count.
        const rows = await pgCoverage().alerts(limit+1,beforeParam);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const history = pageRows.map((r) => shapeAlert(r));
        const last = history[history.length - 1];
        const nextBefore =
          hasMore && last && last.snapshotDate ? last.snapshotDate : null;

        return void res.json({
          alert: history[0] ?? null,
          history,
          hasMore,
          nextBefore,
        });
      } catch (error: any) {
        logger.error('coverage drop-alerts failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to fetch coverage drop alerts',
        });
      }
    },
  );

  // Acknowledge the most recent coverage drop alert (Task #238). The
  // client passes the `snapshotDate` of the alert it currently sees so
  // we don't accidentally suppress a newer alert that arrived between
  // page load and the click. Acknowledgement is shared across admins
  // and persists until a newer alert (different snapshotDate) shows up.
  app.post(
    '/api/admin/coverage/drop-alerts/acknowledge',
    express.json(),
    requireAdmin,
    async (req, res) => {
      try {
        const body = (req.body ?? {}) as { snapshotDate?: unknown };
        const snapshotDate =
          typeof body.snapshotDate === 'string' && body.snapshotDate.trim().length > 0
            ? body.snapshotDate.trim()
            : null;
        if (!snapshotDate) {
          return void res
            .status(400)
            .json({ error: 'snapshotDate is required' });
        }

        // Confirm the latest alert actually has the snapshotDate the
        // client is acknowledging — otherwise an out-of-date client
        // could silence a freshly-arrived alert.
        const latest = await pgCoverage().alerts(1).then(rows=>rows[0]??null);
        const latestSnapshotDate =
          (latest?.data as { snapshotDate?: string } | undefined)?.snapshotDate ?? null;
        if (!latest || latestSnapshotDate !== snapshotDate) {
          return void res.status(409).json({
            error:
              'A newer coverage drop alert is available; refresh before acknowledging.',
            latestSnapshotDate,
          });
        }

        const adminUsername =
          ((req.session as any)?.adminAuth?.username as string | undefined) ?? null;
        const acknowledgedAt = new Date().toISOString();
        // Task #327: route the upsert through the shared audit helper so
        // the ack also leaves a row in `AdminSettingHistory`. Lets the
        // coverage page show "who silenced this alert, when" the same
        // way it already does for the alert thresholds themselves.
        await upsertAdminSettingWithHistory({
          key: COVERAGE_DROP_ACK_KEY,
          value: {
            snapshotDate,
            acknowledgedAt,
            acknowledgedBy: adminUsername,
          },
          changedBy: adminUsername,
          logTag: 'coverage-drop-ack',
        });

        return void res.json({
          acknowledged: true,
          snapshotDate,
          acknowledgedAt,
          acknowledgedBy: adminUsername,
        });
      } catch (error: any) {
        logger.error('coverage drop-alerts acknowledge failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to acknowledge coverage drop alert',
        });
      }
    },
  );

  // Un-acknowledge the most recent coverage drop alert (Task #321). Clears
  // the stored `coverage-drop-alert-ack` AdminSetting row so the banner
  // and per-row badges reappear for everyone. Used by the toast "Undo"
  // affordance and the "Reopen alert" button on the coverage page when an
  // admin dismissed the banner by accident.
  app.delete(
    '/api/admin/coverage/drop-alerts/acknowledge',
    requireAdmin,
    async (req, res) => {
      try {
        // Task #327: route the delete through the shared audit helper so
        // the un-acknowledge also leaves a `clear` row in
        // `AdminSettingHistory`. Skip the history write when no ack was
        // present so the audit log doesn't fill with no-op DELETEs.
        const adminUsername =
          ((req.session as any)?.adminAuth?.username as string | undefined) ?? null;
        const { existed } = await clearAdminSettingWithHistory({
          key: COVERAGE_DROP_ACK_KEY,
          changedBy: adminUsername,
          logTag: 'coverage-drop-ack',
          skipHistoryWhenAbsent: true,
        });
        return void res.json({
          acknowledged: false,
          cleared: existed,
        });
      } catch (error: any) {
        logger.error('coverage drop-alerts un-acknowledge failed', error);
        return void res.status(500).json({
          error:
            error?.message || 'Failed to un-acknowledge coverage drop alert',
        });
      }
    },
  );

  // Task #327: append-only audit trail of every acknowledge / reopen of
  // the coverage drop banner. Mirrors the response shape of the other
  // `AdminSettingHistory`-backed endpoints so the frontend can render
  // the entries with the same row layout (collapsible "Recent
  // acknowledgements" panel on the Coverage page).
  app.get(
    '/api/admin/coverage/drop-alerts/acknowledge/history',
    requireAdmin,
    async (req, res) => {
      try {
        const entries = await listAdminSettingHistory(
          COVERAGE_DROP_ACK_KEY,
          parseHistoryLimit(req.query.limit),
        );
        return void res.json({ entries });
      } catch (error: any) {
        logger.error('coverage drop-alerts ack history failed', error);
        return void res.status(500).json({
          error: error?.message || 'Failed to read acknowledgement history',
        });
      }
    },
  );

  // Re-enqueue the same logo / tag backfill that
  // `scripts/backfill-tr-logos.ts` and `scripts/backfill-tr-tags.ts` run from
  // the CLI, but for any country and from the admin UI. `scope` selects which
  // pipeline(s) to kick off; defaults to running both.
  app.post(
    '/api/admin/coverage/enqueue/:countryCode',
    express.json(),
    requireAdmin,
    async (req, res) => {
      try {
        const rawCode = String(req.params.countryCode || '').trim().toUpperCase();
        if (!rawCode) {
          return void res
            .status(400)
            .json({ success: false, error: 'countryCode is required' });
        }

        const scopeInput =
          typeof req.body?.scope === 'string' ? req.body.scope : 'both';
        const wantLogos = scopeInput === 'logos' || scopeInput === 'both';
        const wantTags = scopeInput === 'tags' || scopeInput === 'both';
        if (!wantLogos && !wantTags) {
          return void res.status(400).json({
            success: false,
            error: "scope must be one of 'logos', 'tags', 'both'",
          });
        }

        cleanupCoverageBackfillJobs();
        const jobId = crypto.randomBytes(12).toString('hex');
        const job: CoverageBackfillJob = {
          jobId,
          countryCode: rawCode,
          scope: scopeInput as 'logos' | 'tags' | 'both',
          status: 'running',
          startedAt: Date.now(),
          cancellable: true,
          cancelRequested: false,
        };
        coverageBackfillJobs.set(jobId, job);

        // Logo enqueue — mirror `backfill-tr-logos.ts` exactly (same filter,
        // same `$unset` so the next scheduled-logo-processor sweep picks the
        // station up). Idempotent: completed assets are excluded. We resolve
        // the matching `_id`s up front so the status endpoint can later
        // count how many of *those specific* stations now have a completed
        // logoAssets record (instead of conflating with unrelated traffic).
        let logoMatched = 0;
        let logoEnqueued = 0;
        let logoEnqueuedIds: string[] = [];
        if (wantLogos) {
          const STALE_PROCESSING_MS = 60 * 60 * 1000;
          const stalePivot = new Date(Date.now() - STALE_PROCESSING_MS);
          const logoFilter: Record<string, unknown> = {
            countryCode: rawCode,
            favicon: { $exists: true, $nin: ['', null, 'null'] },
            slug: { $exists: true, $ne: null },
            $or: [
              { logoAssets: { $exists: false } },
              { 'logoAssets.status': { $exists: false } },
              { 'logoAssets.status': 'pending' },
              {
                'logoAssets.status': 'failed',
                'logoAssets.failureType': {
                  $nin: ['http_error', 'invalid_format'],
                },
              },
              {
                'logoAssets.status': 'failed',
                'logoAssets.failureType': { $exists: false },
              },
              {
                'logoAssets.status': 'processing',
                $or: [
                  { 'logoAssets.lastAttempt': { $lt: stalePivot } },
                  {
                    'logoAssets.lastAttempt': { $exists: false },
                    'logoAssets.processedAt': { $lt: stalePivot },
                  },
                  {
                    'logoAssets.lastAttempt': { $exists: false },
                    'logoAssets.processedAt': { $exists: false },
                  },
                ],
              },
            ],
          };
          const queued=await pgCoverage().enqueueLogos(logoFilter,null);
          logoMatched=queued.candidates;
          logoEnqueued=queued.enqueued;
          logoEnqueuedIds=queued.sampleStations.map(station=>station._id);
          job.logos = {
            matched: logoMatched,
            enqueuedIds: logoEnqueuedIds,
            completed: 0,
            remaining: logoEnqueuedIds.length,
            // Nothing to track → already done so the job can complete
            // immediately rather than sit "running" forever.
            done: logoEnqueuedIds.length === 0,
          };
        }

        // Tags enqueue — fire-and-forget call into the same hydration helper
        // used by `backfill-tr-tags.ts`. The job runs in the background; we
        // return immediately so the admin UI stays responsive.
        let tagsStarted = false;
        // Task #252: if a tags subjob for this same country was cancelled
        // within the last few minutes, carry its final counters forward so
        // the resumed run shows continuous progress (and its final totals
        // include the work the cancelled predecessor already did) instead
        // of restarting the displayed bar at 0/total. The actual
        // already-hydrated stations are skipped naturally by the candidate
        // filter inside `hydrateMissingTagsInBackground`.
        let resumeHint: CoverageTagsResumeHint | null = null;
        if (wantTags) {
          tagsStarted = true;
          resumeHint = consumeCoverageTagsResumeHint(rawCode);
          const baseProcessed = resumeHint?.processed ?? 0;
          const baseHydrated = resumeHint?.hydrated ?? 0;
          const baseEmptyUpstream = resumeHint?.emptyUpstream ?? 0;
          const baseFailed = resumeHint?.failed ?? 0;
          const baseTotal = resumeHint?.total ?? 0;
          job.tags = {
            total: baseTotal,
            processed: baseProcessed,
            hydrated: baseHydrated,
            emptyUpstream: baseEmptyUpstream,
            failed: baseFailed,
            done: false,
            resumedFrom: resumeHint
              ? {
                  processed: baseProcessed,
                  hydrated: baseHydrated,
                  emptyUpstream: baseEmptyUpstream,
                  failed: baseFailed,
                  total: baseTotal,
                }
              : undefined,
          };
          // Task #342: thread the cancelled jobId we just resumed from
          // onto the job itself so the history snapshot can chain rows.
          if (resumeHint?.cancelledJobId) {
            job.resumedFromJobId = resumeHint.cancelledJobId;
          }
          void syncService
            .hydrateMissingTagsInBackground({
              countryCode: rawCode,
              // Mirror the default in scripts/backfill-tr-tags.ts so an
              // admin-triggered run produces the same Radio-Browser load
              // shape as the CLI backfill.
              limit: 2000,
              isCancelled: () =>
                coverageBackfillJobs.get(jobId)?.cancelRequested === true,
              onProgress: (p) => {
                const current = coverageBackfillJobs.get(jobId);
                if (!current?.tags) return;
                // The new run's `p.total` is just the remaining-candidate
                // count (the candidate filter excludes stations the
                // cancelled run already hydrated / cooled down). Stations
                // counted in `baseProcessed` are NOT in `p.total`, so the
                // continuous denominator is the larger of the original
                // baseline total and the live carried-forward processed
                // count + the remaining work — never the sum of both
                // totals (that would double-count the denominator).
                current.tags.total = Math.max(
                  baseTotal,
                  baseProcessed + p.total,
                );
                current.tags.processed = baseProcessed + p.processed;
                current.tags.hydrated = baseHydrated + p.hydrated;
                current.tags.emptyUpstream = baseEmptyUpstream + p.emptyUpstream;
                current.tags.failed = baseFailed + p.failed;
                coverageBackfillJobs.set(jobId, current);
              },
            })
            .then((result) => {
              const current = coverageBackfillJobs.get(jobId);
              if (!current?.tags) return;
              // Same continuity rule as onProgress above — never inflate
              // the displayed denominator by adding the baseline total
              // to the new run's total. The new run only saw the
              // remaining (non-hydrated, non-cooled-down) candidates.
              current.tags.total = Math.max(
                current.tags.total,
                baseTotal,
                baseProcessed + result.processed,
              );
              current.tags.processed = baseProcessed + result.processed;
              current.tags.hydrated = baseHydrated + result.hydrated;
              current.tags.emptyUpstream =
                baseEmptyUpstream + result.emptyUpstream;
              current.tags.failed = baseFailed + result.failed;
              current.tags.done = true;
              // Task #252: if this run itself got cancelled, stash a fresh
              // resume hint so a follow-up Undo can keep chaining instead
              // of losing the carried-forward progress on every cancel.
              if (result.cancelled || current.cancelRequested) {
                stashCoverageTagsResumeHint(
                  current.countryCode,
                  current.tags,
                  current.jobId,
                );
              }
              maybeFinishCoverageJob(current);
              coverageBackfillJobs.set(jobId, current);
            })
            .catch((err) => {
              logger.error(
                `coverage tags enqueue (${rawCode}) failed`,
                err,
              );
              const current = coverageBackfillJobs.get(jobId);
              if (current?.tags) {
                current.tags.done = true;
                current.error =
                  err instanceof Error ? err.message : String(err);
                maybeFinishCoverageJob(current);
                coverageBackfillJobs.set(jobId, current);
              }
            });
        }

        // If both subjobs ended up no-ops (e.g. nothing matched and
        // nothing was started), close the job out immediately.
        maybeFinishCoverageJob(job);
        coverageBackfillJobs.set(jobId, job);

        return void res.json({
          success: true,
          jobId,
          countryCode: rawCode,
          scope: scopeInput,
          logos: wantLogos
            ? { matched: logoMatched, enqueued: logoEnqueued }
            : null,
          tags: wantTags
            ? {
                started: tagsStarted,
                resumedFrom: resumeHint
                  ? {
                      processed: resumeHint.processed,
                      hydrated: resumeHint.hydrated,
                      emptyUpstream: resumeHint.emptyUpstream,
                      failed: resumeHint.failed,
                      total: resumeHint.total,
                    }
                  : null,
              }
            : null,
        });
      } catch (error: any) {
        logger.error('coverage enqueue failed', error);
        return void res.status(500).json({
          success: false,
          error: error?.message || 'Failed to enqueue country backfill',
        });
      }
    },
  );

  // Poll status for a coverage backfill job. The logo subjob has no
  // in-process callback we can hook (the actual processing is done by the
  // scheduled-logo-processor sweeping `logoAssets`-less rows), so we
  // recompute "remaining" lazily here by counting how many of the
  // originally-enqueued station IDs still don't have a completed
  // `logoAssets` record.
  app.get(
    '/api/admin/coverage/enqueue-job-status/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      cleanupCoverageBackfillJobs();
      const job = coverageBackfillJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.logos && !job.logos.done && job.logos.enqueuedIds.length > 0) {
        try {
          const completed = await pgCatalog().count({
            _id: {
              $in: job.logos.enqueuedIds.map(
                (id) => id,
              ),
            },
            'logoAssets.status': 'completed',
          });
          job.logos.completed = completed;
          job.logos.remaining = Math.max(
            job.logos.enqueuedIds.length - completed,
            0,
          );
          if (job.logos.remaining === 0) {
            job.logos.done = true;
            maybeFinishCoverageJob(job);
          }
          coverageBackfillJobs.set(jobId, job);
        } catch (err) {
          logger.error('coverage logo progress recompute failed', err);
        }
      }
      // Sanity ceiling: if a job has been "running" for >2h it almost
      // certainly missed a finish signal (e.g. logo processor lagged or a
      // station was deleted). Mark it complete so the UI doesn't spin
      // forever and the row goes back to its normal coverage display.
      const MAX_RUN_MS = 2 * 60 * 60 * 1000;
      if (job.status === 'running' && Date.now() - job.startedAt > MAX_RUN_MS) {
        if (job.logos) job.logos.done = true;
        if (job.tags) job.tags.done = true;
        maybeFinishCoverageJob(job);
        coverageBackfillJobs.set(jobId, job);
      }
      // Don't ship the full enqueuedIds array on every poll — it can be
      // a few thousand strings per country.
      const { logos, ...rest } = job;
      return void res.json({
        success: true,
        job: {
          ...rest,
          logos: logos
            ? {
                matched: logos.matched,
                enqueued: logos.enqueuedIds.length,
                completed: logos.completed,
                remaining: logos.remaining,
                done: logos.done,
              }
            : undefined,
        },
      });
    },
  );

  // Cancel a running country backfill. The tags subjob's
  // `hydrateMissingTagsInBackground` polls `cancelRequested` between
  // batches and exits cleanly; the logo subjob's actual processing is
  // handled out-of-process by the scheduled-logo-processor, so we can't
  // truly abort an in-flight favicon download — but we mark the logo
  // bucket done so the job can transition to `cancelled` and the UI
  // indicator clears, matching the recheck-tags cancel flow.
  app.post(
    '/api/admin/coverage/enqueue-job-cancel/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      const job = coverageBackfillJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.status !== 'running') {
        return void res.json({ success: true, alreadyFinished: true });
      }
      if (!job.cancellable) {
        return void res
          .status(409)
          .json({ success: false, error: 'Job is not cancellable' });
      }
      job.cancelRequested = true;
      // Task #252: stash the current tags counters now so an Undo that
      // arrives before the loop's `.then` has a chance to run still has
      // resume data to pick up. The `.then` will overwrite this hint with
      // the post-final-batch numbers if it gets there first; either way
      // the next enqueue for this country picks up the freshest values.
      if (job.tags && (job.tags.processed > 0 || job.tags.hydrated > 0)) {
        stashCoverageTagsResumeHint(job.countryCode, job.tags, job.jobId);
      }
      // Logo processing happens in the out-of-process scheduled sweeper —
      // we can't pull stations back off its queue, so the most we can do
      // is stop tracking remaining work and let the job transition.
      if (job.logos && !job.logos.done) {
        job.logos.done = true;
      }
      // If tags weren't started or already finished, the cancel flag has
      // nothing to poll; transition immediately.
      if (!job.tags || job.tags.done) {
        maybeFinishCoverageJob(job);
      }
      coverageBackfillJobs.set(jobId, job);
      logger.log(
        `🛑 Coverage backfill ${jobId} (${job.countryCode}) cancellation requested`,
      );
      return void res.json({ success: true });
    },
  );

  // Task #342: short audit trail of recent backfill runs for one country
  // so admins can spot countries that repeatedly cancel / resume / stall.
  // Newest-first, capped at COVERAGE_BACKFILL_HISTORY_MAX entries. Lives
  // alongside the in-process job map; a server restart starts the buffer
  // empty (acceptable for short-term operational triage).
  app.get(
    '/api/admin/coverage/backfill-history/:countryCode',
    requireAdmin,
    async (req, res) => {
      const rawCode = String(req.params.countryCode || '')
        .trim()
        .toUpperCase();
      if (!rawCode) {
        return void res
          .status(400)
          .json({ success: false, error: 'countryCode is required' });
      }
      const runs = coverageBackfillHistory.get(rawCode) ?? [];
      const resumedCount = runs.filter((r) => !!r.resumedFromJobId).length;
      const cancelledCount = runs.filter((r) => r.status === 'cancelled').length;
      return void res.json({
        success: true,
        countryCode: rawCode,
        runs,
        summary: {
          total: runs.length,
          cancelled: cancelledCount,
          resumed: resumedCount,
        },
      });
    },
  );

  // Re-run the historical sparkline reconstruction (Task #237). Mirrors
  // `scripts/backfill-coverage-snapshots.ts` but invokable from the
  // admin coverage page so admins can re-seed history after a bulk
  // import without shell access. Idempotent: real cron-written rows are
  // preserved by `$setOnInsert`. Reconstructed rows are tagged with
  // `source: 'backfill'` and the nightly cron promotes them to `'cron'`
  // as days roll over.
  app.post(
    '/api/admin/coverage/reconstruct-history',
    express.json(),
    requireAdmin,
    async (req, res) => {
      try {
        const rawDays = req.body?.days;
        const daysNum = rawDays === undefined ? 30 : Number(rawDays);
        if (!Number.isFinite(daysNum) || !Number.isInteger(daysNum) || daysNum < 1 || daysNum > 365) {
          return void res.status(400).json({
            success: false,
            error: 'days must be an integer between 1 and 365',
          });
        }
        const dryRun = req.body?.dryRun === true;

        // Task #318: kick the seeder off in the background and return a
        // jobId immediately so the request doesn't sit open for the
        // (potentially long) duration of a 365-day reconstruction. Per-day
        // progress is reported via the seeder's onProgress callback into a
        // shared in-process map; the UI polls
        // /reconstruct-history-status/:jobId for updates.
        cleanupCoverageReconstructionJobs();
        const leader=await pgCoverage().acquireJob('coverage-history-backfill');
        if(!leader)return void res.status(409).json({success:false,error:'A coverage history backfill is already running'});
        const jobId = crypto.randomBytes(12).toString('hex');
        const job: CoverageReconstructionJob = {
          jobId,
          days: daysNum,
          dryRun,
          status: 'running',
          startedAt: Date.now(),
          daysProcessed: 0,
          daysTotal: daysNum,
          daysSeeded: 0,
          inserted: 0,
          preserved: 0,
          wouldWrite: 0,
          currentDay: null,
          cancelRequested: false,
        };
        coverageReconstructionJobs.set(jobId, job);

        const onProgress = (p: RunCoverageBackfillProgress) => {
          const current = coverageReconstructionJobs.get(jobId);
          if (!current) return;
          current.daysProcessed = p.daysProcessed;
          current.daysTotal = p.daysTotal;
          current.daysSeeded = p.daysSeeded;
          current.inserted = p.inserted;
          current.preserved = p.preserved;
          current.wouldWrite = p.wouldWrite;
          current.currentDay = p.day || current.currentDay;
          coverageReconstructionJobs.set(jobId, current);
        };

        void runCoverageBackfill({
          days: daysNum,
          dryRun,
          onProgress,
          isCancelled: () => {
            leader.assertOwned();
            return coverageReconstructionJobs.get(jobId)?.cancelRequested === true;
          },
        })
          .then((result) => {
            const current = coverageReconstructionJobs.get(jobId);
            if (!current) return;
            current.daysSeeded = result.daysSeeded;
            current.inserted = result.inserted;
            current.preserved = result.preserved;
            current.wouldWrite = result.wouldWrite;
            current.skippedReason = result.skippedReason;
            current.daysProcessed = current.daysTotal;
            current.status = result.cancelled
              ? 'cancelled'
              : 'completed';
            current.finishedAt = Date.now();
            coverageReconstructionJobs.set(jobId, current);
          })
          .catch((err) => {
            logger.error('coverage reconstruct-history job failed', err);
            const current = coverageReconstructionJobs.get(jobId);
            if (!current) return;
            current.status = 'failed';
            current.error = err instanceof Error ? err.message : String(err);
            current.finishedAt = Date.now();
            coverageReconstructionJobs.set(jobId, current);
          })
          .finally(()=>leader.release())
          .catch(error=>logger.error('Coverage reconstruction leader release failed',error));

        return void res.json({
          success: true,
          jobId,
          days: daysNum,
          dryRun,
        });
      } catch (error: any) {
        logger.error('coverage reconstruct-history failed', error);
        return void res.status(500).json({
          success: false,
          error: error?.message || 'Failed to reconstruct sparkline history',
        });
      }
    },
  );

  // Poll status for a reconstruction job (Task #318). Returns the latest
  // streamed per-day progress so the UI can render a progress bar similar
  // to the per-country backfills.
  app.get(
    '/api/admin/coverage/reconstruct-history-status/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      cleanupCoverageReconstructionJobs();
      const job = coverageReconstructionJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      return void res.json({ success: true, job });
    },
  );

  // Cancel a running reconstruction job (Task #318). The seeder polls
  // `cancelRequested` between days and exits cleanly; partial progress is
  // preserved (idempotent $setOnInsert means re-running just resumes from
  // the days that weren't reached).
  app.post(
    '/api/admin/coverage/reconstruct-history-cancel/:jobId',
    requireAdmin,
    async (req, res) => {
      const { jobId } = req.params as { jobId: string };
      const job = coverageReconstructionJobs.get(jobId);
      if (!job) {
        return void res
          .status(404)
          .json({ success: false, error: 'Job not found' });
      }
      if (job.status !== 'running') {
        return void res.json({ success: true, alreadyFinished: true });
      }
      job.cancelRequested = true;
      coverageReconstructionJobs.set(jobId, job);
      logger.log(
        `🛑 Coverage reconstruction ${jobId} cancellation requested`,
      );
      return void res.json({ success: true });
    },
  );

  // ====================================================================
    // Shared coverage-compare presets (Task #306)
    //
    // Lets one admin pin a saved comparison so every other admin sees the
    // same quick-pick chip on /admin/coverage/compare. Personal presets
    // continue to live in AdminPreference; this collection only holds the
    // ones explicitly shared with the team.
    //
    // Edit/delete is restricted to the original owner. An optional
    // `SUPER_ADMIN_USERNAMES` env var (comma-separated usernames) lets a
    // designated admin override that restriction without changing schema.
    // ====================================================================
    const SHARED_PRESET_NAME_MAX = 60;
    const SHARED_PRESET_COUNTRIES_MAX = 8;
    const SHARED_PRESET_TOTAL_MAX = 100;

    function getCallerAdminUsername(req: any): string | null {
      const adminAuth = req.session?.adminAuth;
      const username = adminAuth?.username;
      return typeof username === 'string' && username.length > 0 ? username : null;
    }

    function isSuperAdminUsername(username: string): boolean {
      const raw = process.env.SUPER_ADMIN_USERNAMES || '';
      if (!raw.trim()) return false;
      const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
      return list.includes(username);
    }

    function normalizeSharedPresetCountries(raw: unknown): string[] | null {
      if (!Array.isArray(raw)) return null;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item !== 'string') continue;
        const code = item.trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) continue;
        if (seen.has(code)) continue;
        seen.add(code);
        out.push(code);
        if (out.length >= SHARED_PRESET_COUNTRIES_MAX) break;
      }
      return out.length > 0 ? out : null;
    }

    function serializeSharedPreset(doc: any) {
      return {
        id: String(doc._id),
        name: doc.name,
        countries: doc.countries ?? [],
        ownerUsername: doc.ownerUsername,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    }

    app.get('/api/admin/shared-presets', requireAdmin, async (req, res) => {
      try {
        const callerUsername = getCallerAdminUsername(req);
        const docs = await pgAdminAux().presets();
        const callerCanManageAll =
          callerUsername !== null && isSuperAdminUsername(callerUsername);
        return void res.json({
          callerUsername,
          callerIsSuperAdmin: callerCanManageAll,
          presets: docs.map(serializeSharedPreset),
        });
      } catch (error: any) {
        logger.error('Error listing shared comparison presets:', error);
        return void res
          .status(500)
          .json({ error: 'Failed to list shared comparison presets' });
      }
    });

    app.post(
      '/api/admin/shared-presets',
      express.json(),
      requireAdmin,
      async (req, res) => {
        try {
          const ownerUsername = getCallerAdminUsername(req);
          if (!ownerUsername) {
            return void res
              .status(401)
              .json({ error: 'Admin identity unavailable' });
          }
          const body = (req.body ?? {}) as { name?: unknown; countries?: unknown };
          const name =
            typeof body.name === 'string'
              ? body.name.trim().slice(0, SHARED_PRESET_NAME_MAX)
              : '';
          if (!name) {
            return void res.status(400).json({ error: 'Preset name is required' });
          }
          const countries = normalizeSharedPresetCountries(body.countries);
          if (!countries) {
            return void res
              .status(400)
              .json({ error: 'At least one valid country code is required' });
          }
          const now = new Date();
          try {
            const doc = await pgAdminAux().presetCreate({ name,countries,ownerUsername },SHARED_PRESET_TOTAL_MAX);
            return void res.status(201).json(serializeSharedPreset(doc));
          } catch (err: any) {
            if (err?.code === '23505' || err?.code === 'PRESET_LIMIT') {
              return void res
                .status(409)
                .json({ error: 'A shared preset with that name already exists' });
            }
            throw err;
          }
        } catch (error: any) {
          logger.error('Error creating shared comparison preset:', error);
          return void res
            .status(500)
            .json({ error: 'Failed to create shared comparison preset' });
        }
      },
    );

    app.put(
      '/api/admin/shared-presets/:id',
      express.json(),
      requireAdmin,
      async (req, res) => {
        try {
          const callerUsername = getCallerAdminUsername(req);
          if (!callerUsername) {
            return void res
              .status(401)
              .json({ error: 'Admin identity unavailable' });
          }
          const { id } = req.params;
          if (!isCatalogId(id)) {
            return void res.status(400).json({ error: 'Invalid preset id' });
          }
          const existing = await pgAdminAux().preset(id);
          if (!existing) {
            return void res.status(404).json({ error: 'Preset not found' });
          }
          if (
            existing.ownerUsername !== callerUsername &&
            !isSuperAdminUsername(callerUsername)
          ) {
            return void res.status(403).json({
              error: 'Only the owner can edit this shared preset',
            });
          }
          const body = (req.body ?? {}) as { name?: unknown; countries?: unknown };
          if (body.name !== undefined) {
            const name =
              typeof body.name === 'string'
                ? body.name.trim().slice(0, SHARED_PRESET_NAME_MAX)
                : '';
            if (!name) {
              return void res
                .status(400)
                .json({ error: 'Preset name is required' });
            }
            existing.name = name;
          }
          if (body.countries !== undefined) {
            const countries = normalizeSharedPresetCountries(body.countries);
            if (!countries) {
              return void res
                .status(400)
                .json({ error: 'At least one valid country code is required' });
            }
            existing.countries = countries;
          }
          existing.updatedAt = new Date();
          try {
            await pgAdminAux().presetUpdate(id,callerUsername,isSuperAdminUsername(callerUsername),{ ...(body.name !== undefined ? { name:existing.name } : {}),...(body.countries !== undefined ? { countries:existing.countries } : {}) });
          } catch (err: any) {
            if (err?.code === '23505' || err?.code === 'PRESET_LIMIT') {
              return void res
                .status(409)
                .json({ error: 'A shared preset with that name already exists' });
            }
            throw err;
          }
          return void res.json(serializeSharedPreset(await pgAdminAux().preset(id)));
        } catch (error: any) {
          logger.error('Error updating shared comparison preset:', error);
          return void res
            .status(500)
            .json({ error: 'Failed to update shared comparison preset' });
        }
      },
    );

    app.delete(
      '/api/admin/shared-presets/:id',
      requireAdmin,
      async (req, res) => {
        try {
          const callerUsername = getCallerAdminUsername(req);
          if (!callerUsername) {
            return void res
              .status(401)
              .json({ error: 'Admin identity unavailable' });
          }
          const { id } = req.params;
          if (!isCatalogId(id)) {
            return void res.status(400).json({ error: 'Invalid preset id' });
          }
          const existing = await pgAdminAux().preset(id);
          if (!existing) {
            return void res.json({ id, deleted: 0 });
          }
          if (
            existing.ownerUsername !== callerUsername &&
            !isSuperAdminUsername(callerUsername)
          ) {
            return void res.status(403).json({
              error: 'Only the owner can delete this shared preset',
            });
          }
          await pgAdminAux().presetDelete(id,callerUsername,isSuperAdminUsername(callerUsername));
          return void res.json({ id, deleted: 1 });
        } catch (error: any) {
          logger.error('Error deleting shared comparison preset:', error);
          return void res
            .status(500)
            .json({ error: 'Failed to delete shared comparison preset' });
        }
      },
    );

    // RUN-BACKFILL-NOW (Task #315) — admin-triggered re-run of the same
    // first-deploy historical seeder that `services/coverage-backfill-on-boot.ts`
    // kicks off automatically on boot. The boot path skips when
    // `SKIP_COVERAGE_BACKFILL_ON_BOOT=true` or when historical rows already
    // exist above the threshold; if either condition leaves the sparkline
    // empty, an admin can press "Run backfill now" on the boot-status card
    // instead of restarting the API or running the CLI script.
    //
    // Reuses the singleton `coveragebackfillstatuses` doc so the same card
    // flips through 'running' → 'done'/'done-no-stations'/'failed' without
    // any extra UI surface. Dry runs return inline and do not touch the
    // status doc (we don't want to overwrite real boot history with a
    // synthetic "done — 0 inserted" line).
    app.post(
      '/api/admin/coverage/run-backfill-now',
      express.json(),
      requireAdmin,
      async (req, res) => {
        try {
          const rawDays = req.body?.days;
          let days: number | undefined;
          if (rawDays !== undefined && rawDays !== null && rawDays !== '') {
            const n = Number(rawDays);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 365) {
              return void res.status(400).json({
                success: false,
                error: 'days must be an integer between 1 and 365',
              });
            }
            days = n;
          }
          const dryRun = req.body?.dryRun === true;
          const result = await runCoverageBackfillNow({ days, dryRun });
          if (result.kind === 'busy') {
            return void res.status(409).json({
              success: false,
              error:
                'A manual coverage backfill is already running on this server. Wait for it to finish before starting another.',
            });
          }
          return void res.json({ success: true, ...result });
        } catch (error: any) {
          logger.error('coverage run-backfill-now failed', error);
          return void res.status(500).json({
            success: false,
            error: error?.message || 'Failed to start coverage backfill',
          });
        }
      },
    );
  }
