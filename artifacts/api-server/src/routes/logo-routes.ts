import type { Express } from "express";
import { pgCatalog } from '../data/postgres-catalog-store';
import { logger } from "../utils/logger";
import { normalizeCountryFilter } from "../utils/normalize-country";
import { syncService } from "../services/sync";
import { PrecomputedStationsService } from "../services/precomputed-stations";
import { logoProcessor } from "../services/logo-processor";
import { scheduledLogoProcessor } from "../services/scheduled-logo-processor";
import { isS3Configured } from "../services/s3-storage";
import { IndexNowService } from "../services/indexnow";
import CacheManager from "../cache";
import { backfillLogoVariants, parseLogoVariantRequest, LogoVariantRequestError } from '../services/logo-variant-backfill';

interface RouteDeps {
  requireAuth: any;
  requireAdmin: any;
  stripPlaceholders: (obj: any) => any;
}

export function registerLogoRoutes(app: Express, deps: RouteDeps) {
  const { requireAdmin } = deps;

  // Explicit, bounded migration of completed 256-only logos. Unlike reprocess,
  // this preserves every working asset and never downloads external favicons.
  app.post('/api/admin/logos/backfill-variants', requireAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const request = parseLogoVariantRequest(req.body);
      res.json(await backfillLogoVariants(request));
    } catch (error: any) {
      const status = error instanceof LogoVariantRequestError ? 400 : [409, 503].includes(error?.status) ? error.status : 500;
      res.status(status).json({ error: status === 500 ? 'Logo variant backfill failed' : error.message });
    }
  });

  // ===== BULK LOGO PROCESSING ENDPOINTS =====
  
  // In-memory logo processing job tracking with per-station results
  interface StationResult {
    stationId: string;
    stationName: string;
    status: 'success' | 'failed';
    error?: string;
  }
  
  const logoProcessingJobs = new Map<string, {
    jobId: string;
    status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    total: number;
    processed: number;
    successful: number;
    failed: number;
    startedAt: Date;
    completedAt?: Date;
    error?: string;
    results: StationResult[];
  }>();

  // Evict terminal-state jobs older than 1 hour — prevents map from growing forever
  // across many admin bulk-processing invocations. Also caps per-job results array
  // size at 2000 so a single job cannot use unbounded memory.
  const LOGO_JOB_RESULTS_MAX = 2000;
  const LOGO_JOB_RETENTION_MS = 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of logoProcessingJobs) {
      const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
      const completedAt = job.completedAt ? job.completedAt.getTime() : 0;
      if (terminal && completedAt > 0 && (now - completedAt) > LOGO_JOB_RETENTION_MS) {
        logoProcessingJobs.delete(jobId);
      }
    }
  }, 10 * 60 * 1000).unref();
  
  // Get logo processing statistics
  app.get("/api/admin/logos/stats", requireAdmin, async (req, res) => {
    try {
      const [
        totalStations,
        stationsWithFavicon,
        stationsWithSlug,
        stationsWithLogoAssets,
        stationsFailed,
        stationsNotProcessed,
        stationsWithoutLogo,
        stationsNoFavicon,
      ] = await Promise.all([
        pgCatalog().count(),
        pgCatalog().count({ favicon: { $exists: true, $nin: ['', null, 'null'] } }),
        pgCatalog().count({ slug: { $exists: true, $ne: null } }),
        pgCatalog().count({ 'logoAssets.status': 'completed' }),
        pgCatalog().count({ 'logoAssets.status': 'failed' }),
        pgCatalog().count({
          favicon: { $exists: true, $nin: ['', null, 'null'] },
          $or: [
            { 'logoAssets.status': { $exists: false } },
            { logoAssets: { $exists: false } },
            { 'logoAssets.status': 'pending' },
            { 'logoAssets.status': 'processing' },
          ]
        }),
        // ANY station that does not currently serve from S3 ("logo eksik").
        // Includes failed processing, not-yet-processed, and stations without
        // a favicon URL at all. The frontend modal lets admin filter further.
        pgCatalog().count({
          $or: [
            { logoAssets: { $exists: false } },
            { 'logoAssets.status': { $exists: false } },
            { 'logoAssets.status': { $ne: 'completed' } },
          ]
        }),
        // Subset: stations that have NO favicon URL — backfill cannot help
        // these without manually entering a logo URL.
        pgCatalog().count({
          $or: [
            { favicon: { $exists: false } },
            { favicon: { $in: ['', null, 'null'] } },
          ]
        }),
      ]);

      res.json({
        totalStations,
        stationsWithFavicon,
        stationsWithSlug,
        stationsWithLogoAssets,
        stationsFailed,
        stationsNeedingProcessing: stationsNotProcessed,
        stationsWithoutLogo,
        stationsNoFavicon,
        processingComplete: stationsNotProcessed === 0,
        s3Configured: isS3Configured(),
      });
    } catch (error: any) {
      console.error('Error getting logo stats:', error);
      res.status(500).json({ error: 'Failed to get logo statistics' });
    }
  });

  // List stations WITHOUT an S3-optimized logo (for SEO/QA review). Supports
  // pagination + status filter (any | failed | pending | no_favicon) +
  // optional ISO country filter. Used by the admin "Logo eksik istasyonlar"
  // modal so SEO ops can spot-check + decide whether to fix favicon URLs by
  // hand or blacklist the station.
  app.get("/api/admin/logos/missing", requireAdmin, async (req, res) => {
    try {
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      const skip = (page - 1) * limit;
      const status = String(req.query.status || 'any').toLowerCase();
      const countryCode = typeof req.query.countryCode === 'string'
        ? req.query.countryCode.trim().toUpperCase()
        : '';

      const filter: any = {};
      if (status === 'failed') {
        filter['logoAssets.status'] = 'failed';
      } else if (status === 'pending') {
        filter.$or = [
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': { $exists: false } },
          { 'logoAssets.status': 'pending' },
          { 'logoAssets.status': 'processing' },
        ];
        filter.favicon = { $exists: true, $nin: ['', null, 'null'] };
      } else if (status === 'no_favicon') {
        filter.$or = [
          { favicon: { $exists: false } },
          { favicon: { $in: ['', null, 'null'] } },
        ];
      } else {
        filter.$or = [
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': { $exists: false } },
          { 'logoAssets.status': { $ne: 'completed' } },
        ];
      }

      if (countryCode && /^[A-Z]{2}$/.test(countryCode)) {
        filter.countryCode = countryCode;
      }

      const [stations, total] = await Promise.all([
        pgCatalog().find(filter, { fields: ["_id","name","slug","favicon","country","countryCode","logoAssets","updatedAt"], sort: { updatedAt: -1 }, offset: skip, limit: limit }),
        pgCatalog().count(filter),
      ]);

      res.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        stations: stations.map((s: any) => ({
          _id: String(s._id),
          name: s.name,
          slug: s.slug,
          favicon: s.favicon || null,
          country: s.country || null,
          countryCode: s.countryCode || null,
          logoStatus: s.logoAssets?.status || (s.favicon ? 'pending' : 'no_favicon'),
          logoError: s.logoAssets?.error || null,
          updatedAt: s.updatedAt,
        })),
      });
    } catch (error: any) {
      console.error('Error listing missing-logo stations:', error);
      res.status(500).json({ error: 'Failed to list missing-logo stations' });
    }
  });

  // Failed-logo audit log: per-station error message + failureType. Admin
  // surfaces this at the bottom of /admin/logos so failures can be debugged
  // without grepping production logs.
  app.get("/api/admin/logos/failed", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) || '200', 10)));
      const failureType = String(req.query.failureType || 'any');

      const filter: any = { 'logoAssets.status': 'failed' };
      if (failureType !== 'any') {
        filter['logoAssets.failureType'] = failureType;
      }

      const [rows, byType] = await Promise.all([
        pgCatalog().find(filter, { sort: { 'logoAssets.lastAttempt': -1 }, limit: limit, fields: ["_id","name","countryCode","favicon","logoAssets.error","logoAssets.failureType","logoAssets.lastAttempt"] }),
        pgCatalog().groupCount('logoAssets.failureType', { 'logoAssets.status': 'failed' }),
      ]);

      const counts: Record<string, number> = {
        http_error: 0,
        timeout: 0,
        invalid_format: 0,
        download_failed: 0,
        processing_failed: 0,
        unknown: 0,
      };
      let totalFailed = 0;
      for (const row of byType as Array<{ _id: string | null; count: number }>) {
        const key = row._id ?? 'unknown';
        counts[key] = (counts[key] ?? 0) + row.count;
        totalFailed += row.count;
      }

      res.json({
        totalFailed,
        countsByType: counts,
        rows: (rows as any[]).map(s => ({
          _id: String(s._id),
          name: s.name,
          countryCode: s.countryCode || null,
          favicon: s.favicon || null,
          error: s.logoAssets?.error || null,
          failureType: s.logoAssets?.failureType || 'unknown',
          lastAttempt: s.logoAssets?.lastAttempt || null,
        })),
      });
    } catch (error: any) {
      console.error('Error listing failed logos:', error);
      res.status(500).json({ error: 'Failed to list failed logos' });
    }
  });

  // Storage health: shows whether processed logos are served from S3 or local
  // disk. Important sanity check after any deploy that toggles AWS_* env vars.
  app.get("/api/admin/logos/storage-health", requireAdmin, async (_req, res) => {
    try {
      const s3Configured = isS3Configured();
      const [s3Count, localCount, sampleS3, sampleLocal] = await Promise.all([
        pgCatalog().count({
          'logoAssets.status': 'completed',
          'logoAssets.webp256': { $regex: '^https://', $options: 'i' },
        }),
        pgCatalog().count({
          'logoAssets.status': 'completed',
          'logoAssets.webp256': { $exists: true, $nin: [null, ''] },
          $nor: [{ 'logoAssets.webp256': { $regex: '^https://', $options: 'i' } }],
        }),
        pgCatalog().findOne({
          'logoAssets.status': 'completed',
          'logoAssets.webp256': { $regex: '^https://', $options: 'i' },
        }, { fields: ["logoAssets.webp256"] }) as any,
        pgCatalog().findOne({
          'logoAssets.status': 'completed',
          'logoAssets.webp256': { $exists: true, $nin: [null, ''] },
          $nor: [{ 'logoAssets.webp256': { $regex: '^https://', $options: 'i' } }],
        }, { fields: ["logoAssets.folder","logoAssets.webp256"] }) as any,
      ]);

      let s3Reachable: boolean | null = null;
      if (sampleS3?.logoAssets?.webp256) {
        try {
          const probe = await fetch(sampleS3.logoAssets.webp256, { method: 'HEAD' });
          s3Reachable = probe.ok;
        } catch {
          s3Reachable = false;
        }
      }

      res.json({
        s3Configured,
        s3Reachable,
        s3Count,
        localCount,
        mismatch: s3Count > 0 && localCount > 0,
        sampleS3Url: sampleS3?.logoAssets?.webp256 || null,
        sampleLocalPath: sampleLocal?.logoAssets
          ? `/station-logos/${sampleLocal.logoAssets.folder}/${sampleLocal.logoAssets.webp256}`
          : null,
      });
    } catch (error: any) {
      console.error('Error checking logo storage health:', error);
      res.status(500).json({ error: 'Failed to check storage health' });
    }
  });

  // Retry a single failed station's logo processing (called from the failed
  // audit log "Retry" button).
  app.post("/api/admin/logos/retry/:stationId", requireAdmin, async (req, res) => {
    try {
      const stationId = String(req.params.stationId);
      const station = await pgCatalog().findOne({ _id: stationId }, { fields: ["_id","name","slug","favicon","logoAssets"] }) as any;
      if (!station) {
        return void res.status(404).json({ error: 'Station not found' });
      }
      if (!station.favicon) {
        return void res.status(400).json({ error: 'Station has no favicon URL to process' });
      }
      const result = await logoProcessor.processFromUrl(
        String(station._id),
        station.slug || String(station._id),
        station.favicon,
      );
      res.json({
        success: result.success,
        error: result.error || null,
        failureType: result.failureType || null,
      });
    } catch (error: any) {
      console.error('Logo retry failed:', error);
      res.status(500).json({ error: error.message || 'Retry failed' });
    }
  });

  // Get list of optimized stations with pagination
  app.get("/api/admin/logos/optimized", requireAdmin, async (req, res) => {
    try {
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = 50;
      const skip = (page - 1) * limit;
      
      const stations = await pgCatalog().find({ 'logoAssets.status': 'completed' }, { fields: ["name","slug","logoAssets"], offset: skip, limit: limit });
      
      const total = await pgCatalog().count({ 'logoAssets.status': 'completed' });
      
      res.json({
        stations: stations.map((s: any) => ({
          _id: s._id,
          name: s.name,
          slug: s.slug,
          logoAssets: s.logoAssets
        })),
        total
      });
    } catch (error: any) {
      console.error('Error fetching optimized stations:', error);
      res.status(500).json({ error: 'Failed to fetch optimized stations' });
    }
  });
  
  // Start bulk logo processing job
  app.post("/api/admin/logos/process-all", requireAdmin, async (req, res) => {
    try {
      const { limit = 500 } = (req.body ?? {}) as { limit?: number };
      
      // Check for existing running job
      for (const [id, job] of logoProcessingJobs.entries()) {
        if (job.status === 'running') {
          return void res.json({ 
            success: false, 
            message: 'A logo processing job is already running',
            jobId: id
          });
        }
      }
      
      const stationsNeedingProcessing = await pgCatalog().count({
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null },
        $or: [
          { 'logoAssets.status': { $exists: false } },
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': 'pending' },
          { 'logoAssets.status': 'processing' },
        ]
      });
      
      if (stationsNeedingProcessing === 0) {
        return void res.json({ 
          success: true, 
          message: 'All logos are already processed',
          processed: 0
        });
      }
      
      // Create job - will process ALL stations continuously
      const jobId = `logo-${Date.now()}`;
      
      logoProcessingJobs.set(jobId, {
        jobId,
        status: 'running',
        total: stationsNeedingProcessing, // Process ALL stations
        processed: 0,
        successful: 0,
        failed: 0,
        startedAt: new Date(),
        results: []  // Initialize empty results array for per-station tracking
      });
      
      // Return immediately with job ID
      res.json({
        success: true,
        message: 'Logo processing started - will process ALL stations',
        jobId,
        totalToProcess: stationsNeedingProcessing
      });
      
      // Only pick stations that genuinely haven't been attempted yet, or
      // have a retryable pending state. Explicitly EXCLUDE 'processing' so
      // stations that got stuck in that state from a previous crashed job
      // are not re-fetched in an infinite loop.
      // Permanent failures (http_error, invalid_format) are also excluded —
      // a separate "retry" action handles those intentionally.
      const needsProcessingFilter = {
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        $or: [
          { 'logoAssets.status': { $exists: false } },
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': 'pending' as const },
        ]
      };

      // Rescue stations left in 'processing' by a previous crashed job:
      // anything still 'processing' after 10 minutes is definitively stuck.
      const staleProcessingCutoff = new Date(Date.now() - 10 * 60 * 1000);
      const staleReset = await pgCatalog().update({
          'logoAssets.status': 'processing',
          'logoAssets.lastAttempt': { $lt: staleProcessingCutoff },
        }, {
          $set: {
            'logoAssets.status': 'failed',
            'logoAssets.error': 'Processing timed out — reset by bulk job',
            'logoAssets.failureType': 'processing_failed',
          },
        }, { many: true });
      if (staleReset.modifiedCount > 0) {
        logger.log(`🔧 Reset ${staleReset.modifiedCount} stale 'processing' stations to 'failed' before bulk run`);
      }
      
      const MAX_RECENT_RESULTS = 50;
      const CONCURRENT_SIZE = 5;
      const BATCH_FETCH_SIZE = 100;
      const DELAY_BETWEEN_BATCHES_MS = 300;
      const DELAY_BETWEEN_ROUNDS_MS = 500;

      setImmediate(async () => {
        const job = logoProcessingJobs.get(jobId)!;
        let totalProcessedOverall = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        let roundNumber = 0;
        
        try {
          while (true) {
            const currentJob = logoProcessingJobs.get(jobId);
            if (currentJob?.status === 'cancelled' || currentJob?.status === 'paused') {
              logger.log(`⏹️ Logo processing stopped by user after ${totalProcessedOverall} stations`);
              break;
            }
            
            roundNumber++;
            const stations = await pgCatalog().find(needsProcessingFilter, { fields: ["_id","name","slug","favicon"], limit: BATCH_FETCH_SIZE });
            
            if (stations.length === 0) {
              logger.log(`🎉 ALL LOGOS PROCESSED! Total: ${totalProcessedOverall} (${totalSuccessful} successful, ${totalFailed} failed)`);
              break;
            }
            
            logger.log(`📦 Round ${roundNumber}: Processing ${stations.length} stations...`);
            
            for (let i = 0; i < stations.length; i += CONCURRENT_SIZE) {
              const checkJob = logoProcessingJobs.get(jobId);
              if (checkJob?.status === 'cancelled' || checkJob?.status === 'paused') break;
              
              const batch = stations.slice(i, i + CONCURRENT_SIZE);
              const batchPromises = batch.map(async (station) => {
                try {
                  if (!station.favicon || !station.slug) {
                    await pgCatalog().update({ _id: station._id }, { $set: { 'logoAssets.status': 'failed', 'logoAssets.error': 'Missing favicon or slug', 'logoAssets.failureType': 'invalid_format' } });
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: 'Missing favicon or slug' };
                  }
                  const result = await logoProcessor.processFromUrl(station._id.toString(), station.slug, station.favicon);
                  if (result.success) {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'success' as const };
                  } else {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: result.error };
                  }
                } catch (error: any) {
                  return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: error.message };
                }
              });
              
              const results = await Promise.allSettled(batchPromises);
              for (let ri = 0; ri < results.length; ri++) {
                const result = results[ri];
                totalProcessedOverall++;
                job.processed = totalProcessedOverall;
                if (result.status === 'fulfilled') {
                  if (job.results.length >= MAX_RECENT_RESULTS) job.results.shift();
                  job.results.push(result.value);
                  if (job.results.length > LOGO_JOB_RESULTS_MAX) job.results.shift();
                  if (result.value.status === 'success') {
                    totalSuccessful++;
                    job.successful = totalSuccessful;
                  } else {
                    totalFailed++;
                    job.failed = totalFailed;
                  }
                } else {
                  // Unhandled rejection — must reset station from 'processing'
                  // to 'failed' so it is never re-fetched in an infinite loop.
                  totalFailed++;
                  job.failed = totalFailed;
                  const stationId = batch[ri]?._id;
                  if (stationId) {
                    try {
                      await pgCatalog().update({ _id: stationId }, {
                          $set: {
                            'logoAssets.status': 'failed',
                            'logoAssets.error': result.reason?.message ?? 'Unhandled rejection',
                            'logoAssets.failureType': 'processing_failed',
                            'logoAssets.lastAttempt': new Date(),
                          },
                        });
                    } catch { /* best-effort */ }
                  }
                }
              }
              logoProcessingJobs.set(jobId, job);
              await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
            }

            if (roundNumber % 5 === 0) {
              const remaining = await pgCatalog().count(needsProcessingFilter);
              const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
              logger.log(`📊 Round ${roundNumber}: ${totalProcessedOverall} done, ${remaining} remaining, heap: ${heapMB}MB`);
              if (typeof global.gc === 'function') global.gc();
            }
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ROUNDS_MS));
          }
          
          job.status = 'completed';
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          logger.log(`✅ Logo processing COMPLETE: ${totalSuccessful} successful, ${totalFailed} failed out of ${totalProcessedOverall} total`);
          
        } catch (error: any) {
          job.status = 'failed';
          job.error = error.message;
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          logger.log(`❌ Logo processing job ${jobId} failed: ${error.message}`);
        }
      });
    } catch (error: any) {
      console.error('Error starting logo processing:', error);
      res.status(500).json({ error: 'Failed to start logo processing' });
    }
  });
  
  // Retry EVERY failed station's logo right now — including the ones the
  // nightly processor treats as "permanent" (http_error / invalid_format) and
  // would otherwise only re-attempt after the 30-day self-healing window.
  // `$unset`-ing logoAssets on the failed rows turns them back into
  // "unprocessed", which the scheduled processor's filter picks up immediately;
  // triggering runOnce sweeps them now (single-flight — no-op if a run is
  // already in progress). Unlike /reprocess-all this does NOT touch already-
  // completed logos, so it is cheap and safe to press repeatedly.
  app.post("/api/admin/logos/retry-all-failed", requireAdmin, async (_req, res) => {
    try {
      const resetResult = await pgCatalog().update({
          favicon: { $exists: true, $nin: ['', null, 'null'] },
          slug: { $exists: true, $ne: null },
          'logoAssets.status': 'failed',
        }, { $unset: { logoAssets: '' } }, { many: true });
      const reset = (resetResult as any).modifiedCount ?? (resetResult as any).nModified ?? 0;

      scheduledLogoProcessor.runOnce('admin:retry-all-failed').catch((err) => {
        logger.error('❌ retry-all-failed sweep crashed:', err);
      });

      res.json({
        success: true,
        reset,
        message: `Reset ${reset} failed logo(s) and started reprocessing now (incl. previously-permanent http_error / invalid_format failures).`,
      });
    } catch (error: any) {
      logger.error('retry-all-failed failed:', error?.message ?? error);
      res.status(500).json({ success: false, error: error?.message || 'retry-all-failed failed' });
    }
  });

  app.post("/api/admin/logos/reprocess-all", requireAdmin, async (req, res) => {
    try {
      for (const [id, job] of logoProcessingJobs.entries()) {
        if (job.status === 'running') {
          return void res.json({
            success: false,
            message: 'A logo processing job is already running',
            jobId: id
          });
        }
      }

      const totalWithFavicon = await pgCatalog().count({
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null }
      });

      if (totalWithFavicon === 0) {
        return void res.json({ success: true, message: 'No stations with favicons found', processed: 0 });
      }

      const RESET_BATCH = 5000;
      let resetSkip = 0;
      let totalReset = 0;
      while (true) {
        const stationIds = await pgCatalog().find({ favicon: { $exists: true, $nin: ['', null, 'null'] } }, { offset: resetSkip, limit: RESET_BATCH, fields: ["_id"] });
        if (stationIds.length === 0) break;
        await pgCatalog().update({ _id: { $in: stationIds.map((s: any) => s._id) } }, { $unset: { logoAssets: '' } }, { many: true });
        totalReset += stationIds.length;
        resetSkip += RESET_BATCH;
        await new Promise(r => setTimeout(r, 100));
      }

      logger.log(`🔄 REPROCESS ALL: Reset logoAssets for ${totalReset} stations. Starting fresh processing...`);

      const jobId = `logo-reprocess-${Date.now()}`;

      logoProcessingJobs.set(jobId, {
        jobId,
        status: 'running',
        total: totalWithFavicon,
        processed: 0,
        successful: 0,
        failed: 0,
        startedAt: new Date(),
        results: []
      });

      res.json({
        success: true,
        message: `Reprocessing ALL ${totalWithFavicon} station logos from scratch`,
        jobId,
        totalToProcess: totalWithFavicon
      });

      const needsProcessingFilter = {
        favicon: { $exists: true, $nin: ['', null, 'null'] },
        slug: { $exists: true, $ne: null },
        $or: [
          { 'logoAssets.status': { $exists: false } },
          { logoAssets: { $exists: false } },
          { 'logoAssets.status': 'pending' as const },
          { 'logoAssets.status': 'processing' as const },
        ]
      };

      const MAX_RECENT_RESULTS = 50;
      const CONCURRENT_SIZE = 5;
      const BATCH_FETCH_SIZE = 100;
      const DELAY_BETWEEN_BATCHES_MS = 300;
      const DELAY_BETWEEN_ROUNDS_MS = 500;

      setImmediate(async () => {
        const job = logoProcessingJobs.get(jobId)!;
        let totalProcessedOverall = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        let roundNumber = 0;

        try {
          while (true) {
            const currentJob = logoProcessingJobs.get(jobId);
            if (currentJob?.status === 'cancelled' || currentJob?.status === 'paused') {
              logger.log(`⏹️ Logo reprocessing stopped by user after ${totalProcessedOverall} stations`);
              break;
            }

            roundNumber++;
            const stations = await pgCatalog().find(needsProcessingFilter, { fields: ["_id","name","slug","favicon"], limit: BATCH_FETCH_SIZE });

            if (stations.length === 0) {
              logger.log(`🎉 ALL LOGOS REPROCESSED! Total: ${totalProcessedOverall} (${totalSuccessful} successful, ${totalFailed} failed)`);
              break;
            }

            logger.log(`📦 Reprocess Round ${roundNumber}: Processing ${stations.length} stations...`);

            for (let i = 0; i < stations.length; i += CONCURRENT_SIZE) {
              const checkJob = logoProcessingJobs.get(jobId);
              if (checkJob?.status === 'cancelled' || checkJob?.status === 'paused') break;

              const batch = stations.slice(i, i + CONCURRENT_SIZE);
              const batchPromises = batch.map(async (station) => {
                try {
                  if (!station.favicon || !station.slug) {
                    await pgCatalog().update({ _id: station._id }, { $set: { 'logoAssets.status': 'failed', 'logoAssets.error': 'Missing favicon or slug', 'logoAssets.failureType': 'invalid_format' } });
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: 'Missing favicon or slug' };
                  }
                  const result = await logoProcessor.processFromUrl(station._id.toString(), station.slug, station.favicon);
                  if (result.success) {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'success' as const };
                  } else {
                    return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: result.error };
                  }
                } catch (error: any) {
                  return { stationId: station._id.toString(), stationName: station.name, status: 'failed' as const, error: error.message };
                }
              });

              const results = await Promise.allSettled(batchPromises);
              for (let ri = 0; ri < results.length; ri++) {
                const result = results[ri];
                totalProcessedOverall++;
                job.processed = totalProcessedOverall;
                if (result.status === 'fulfilled') {
                  if (job.results.length >= MAX_RECENT_RESULTS) job.results.shift();
                  job.results.push(result.value);
                  if (job.results.length > LOGO_JOB_RESULTS_MAX) job.results.shift();
                  if (result.value.status === 'success') {
                    totalSuccessful++;
                    job.successful = totalSuccessful;
                  } else {
                    totalFailed++;
                    job.failed = totalFailed;
                  }
                } else {
                  totalFailed++;
                  job.failed = totalFailed;
                  const stationId = batch[ri]?._id;
                  if (stationId) {
                    try {
                      await pgCatalog().update({ _id: stationId }, {
                          $set: {
                            'logoAssets.status': 'failed',
                            'logoAssets.error': result.reason?.message ?? 'Unhandled rejection',
                            'logoAssets.failureType': 'processing_failed',
                            'logoAssets.lastAttempt': new Date(),
                          },
                        });
                    } catch { /* best-effort */ }
                  }
                }
              }
              logoProcessingJobs.set(jobId, job);
              await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
            }

            if (roundNumber % 5 === 0) {
              const remaining = await pgCatalog().count(needsProcessingFilter);
              const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
              logger.log(`📊 Reprocess Round ${roundNumber}: ${totalProcessedOverall} done, ${remaining} remaining, heap: ${heapMB}MB`);
              if (typeof global.gc === 'function') global.gc();
            }
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ROUNDS_MS));
          }

          job.status = 'completed';
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          logger.log(`✅ Logo REPROCESSING COMPLETE: ${totalSuccessful} successful, ${totalFailed} failed out of ${totalProcessedOverall} total`);
        } catch (error: any) {
          job.status = 'failed';
          job.error = error.message;
          job.completedAt = new Date();
          logoProcessingJobs.set(jobId, job);
          logger.log(`❌ Logo reprocessing job ${jobId} failed: ${error.message}`);
        }
      });
    } catch (error: any) {
      console.error('Error starting logo reprocessing:', error);
      res.status(500).json({ error: 'Failed to start logo reprocessing' });
    }
  });

  app.get("/api/admin/logos/active-job", requireAdmin, async (req, res) => {
    for (const [id, job] of logoProcessingJobs.entries()) {
      if (job.status === 'running') {
        return void res.json({ hasActiveJob: true, job });
      }
    }
    return void res.json({ hasActiveJob: false });
  });

  app.get("/api/admin/logos/job-status/:jobId", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = logoProcessingJobs.get(jobId);
    
    if (!job) {
      const completedCount = await pgCatalog().count({ 'logoAssets.status': 'completed' });
      const failedCount = await pgCatalog().count({ 'logoAssets.status': 'failed' });
      return void res.json({
        jobId,
        status: 'lost',
        message: 'Job lost after server restart. Check stats for current progress.',
        processed: completedCount + failedCount,
        successful: completedCount,
        failed: failedCount,
        total: completedCount + failedCount,
        results: []
      });
    }
    
    res.json(job);
  });
  
  // Cancel logo processing job
  app.post("/api/admin/logos/job/:jobId/cancel", requireAdmin, async (req, res) => {
    const jobId = req.params.jobId;
    const job = logoProcessingJobs.get(jobId);
    
    if (!job) {
      return void res.status(404).json({ error: 'Job not found' });
    }
    
    job.status = 'cancelled';
    job.completedAt = new Date();
    logoProcessingJobs.set(jobId, job);
    
    logger.log(`🛑 Logo processing job ${jobId} cancelled`);
    
    res.json({ 
      success: true, 
      message: 'Job cancelled',
      processed: job.processed,
      successful: job.successful,
      failed: job.failed
    });
  });
}
