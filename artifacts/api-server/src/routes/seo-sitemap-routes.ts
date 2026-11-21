import type { Express, Request, Response } from "express";
import { registerLlmsTxtRoutes } from '../seo/llms-txt-routes';
import { mobileAppLinkPaths } from '../seo/mobile-app-links';
import { isStationDirectoryPath } from '@workspace/seo-shared/station-directory';
import crypto from 'crypto';
import { buildBlogSitemap } from '../seo/blog-sitemap';
import { getLegacyStationGuideRoute } from '@workspace/seo-shared/legacy-station-guide-routes';
import { BLOG_SITEMAP_UPDATED } from '@workspace/seo-shared/blog-manifest';
import { SITEMAP_STYLESHEET, withSitemapStylesheet } from '../seo/sitemap-presentation';
import { INDEXING_PILOT, matchingPilotProfile, type IndexingPilotProfile } from '../seo/indexing-pilot';
import { pgReportStationDebugLog, pgListStationDebugLogs } from '../data/postgres-station-debug-store';
import { pgActiveManifests, pgSeoGenres, pgTouchSitemapStations, pgSitemapStationDiagnostics, pgSitemapStationBatch, SITEMAP_STATION_READ_BATCH_SIZE } from '../data/postgres-seo-indexing-store';
import { markSeoTemporarilyUnavailable } from '../seo/temporary-unavailable';
import { manualSitemapRebuildTimeout } from '../middleware/manual-sitemap-rebuild-timeout';
import { logger } from "../utils/logger";
import { SeoRenderer, buildLocalizedUrl } from "../seo-renderer";
import { SITEMAP_CONFIG, ACTIVE_SITEMAP_LANGUAGES, REQUIRED_STATION_SEO_KEYS, hasCompleteSeoTranslations, SEO_LANGUAGES, LOCALIZED_LOGO_WORD, LOCALIZED_RADIO_STATION_WORD, normalizeSeoTitleTags, getRetiredLocaleFromPath } from '@workspace/seo-shared/seo-config';

// Map a SEO language code (e.g. "nb") to its BCP47/hreflang tag (e.g. "nb-NO")
// so XML sitemap alternates match the HTML <link rel="alternate"> tags emitted
// by lib/seo-shared/src/seo-config.ts. Without this mapping Google sees a
// HTML/sitemap mismatch and ignores the entire alternate cluster.
function toHreflangTag(code: string): string {
  const lang = SEO_LANGUAGES.find((l) => l.code === code);
  return lang?.iso || code;
}

// Task #349: every <url> entry must carry a self-referential alternate that
// uses the bare SEO code (`it`, `tr`, …) in addition to the BCP47 tag
// (`it-IT`, `tr-TR`). The bare code is what Google's hreflang validator
// surfaces as the canonical "this page targets language X" signal — without
// it the sitemap fails the contract that "every URL must list itself among
// the alternates" for the SEO language code, even if the BCP47 form is
// present. Returns the unique list of hreflang attribute values to emit
// for a single language alternate (preserves order: bare code first, then
// regional/script subtag if it differs).
function hreflangTagsForCode(code: string): string[] {
  const iso = toHreflangTag(code);
  return iso === code ? [code] : [code, iso];
}

// Emit one or two <xhtml:link rel="alternate"> entries for a single
// alternate language, sharing the same href. Centralised so the main /
// genres / stations sitemap handlers stay in lockstep.
function buildHreflangLinks(code: string, href: string): string {
  return hreflangTagsForCode(code)
    .map((tag) => `
    <xhtml:link rel="alternate" hreflang="${tag}" href="${escapeXml(href)}"/>`)
    .join('');
}
import { performanceCache } from "../performance-cache";
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import CacheManager, { CacheKeys } from "../cache";
import { readCachedStationSitemapXml, storeStationSitemapXml } from '../seo/station-sitemap-cache';
import { getBaseUrl } from "./shared-utils";
import { loadSitemapTranslations } from "../utils/sitemap-translations";
import { sendSitemapGone } from "../seo/send-sitemap-gone";
import { AZ_INDEX_KEYS, AZ_KEY_RE } from "../seo/az-station-index";
import { canonicalizeCountry, countrySlug, getRegionSlugForCountry } from "@workspace/seo-shared/country-regions";
import {
  getCachedQualifiedLanguages,
  getQualifiedLanguagesState,
  invalidateQualifiedLanguages,
  QualifiedLanguagesUnavailableError,
} from "../seo/qualified-languages";
import {
  buildAllSitemapManifests,
  getActiveManifest,
  getActiveStationChunk,
  extractTopCountriesFromChunk,
} from "../seo/sitemap-manifest-builder";
import {
  loadDatabaseUrlTranslations,
  loadDatabaseCountryLanguageMappings,
} from "../seo/load-database-mappings";
import { IndexNowService } from "../services/indexnow";

// Centralized XML escape helper (Architect B P0)
// Escapes the 5 XML predefined entities for safe inclusion in <loc>, <image:loc>,
// <xhtml:link href>, station name fields, etc. Use everywhere instead of ad-hoc replace chains.
// Task #127: extracted to `utils/escape-xml.ts` so the integration test suite can
// import & assert that every <loc> URL is escaped.
import { escapeXml } from '../utils/escape-xml';
import { normalizePublicStationLogoUrl } from '@workspace/seo-shared/station-logo-url';

/** A4 fix: image:image emit eligibility — only owned/verified hosts.
 * Architect 4 mandate: no arbitrary external favicon URLs. Allowed hosts:
 *   - AWS S3 buckets (anything under amazonaws.com)
 *   - themegaradio.com / *.themegaradio.com
 * Rejects placeholder default-station.* and non-http(s) schemes. */
function parseStationImageUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return null;
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { return null; }
  if (parsed.username || parsed.password) return null;
  if (/(?:^|\/)(?:default-station|no-image)\.(png|webp|jpg|jpeg|svg)$/i.test(parsed.pathname)) return null;
  return parsed;
}

function isVerifiedImageHost(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  return (
    host.endsWith('.amazonaws.com') ||
    host === 'amazonaws.com' ||
    host === 'themegaradio.com' ||
    host.endsWith('.themegaradio.com')
  );
}

/** Prefer owned logos; external favicons use the same owned image proxy as
 * SSR. Missing or placeholder logos never become sitemap image entries. */
function pickStationImage(station: any, baseUrl: string): string | null {
  const candidates = [
    station?.logoAssets?.webp256,
    station?.logoAssets?.webp96,
    station?.favicon,
  ];
  for (const candidate of candidates) {
    const parsed = parseStationImageUrl(candidate);
    if (parsed && isVerifiedImageHost(parsed)) {
      const owned = normalizePublicStationLogoUrl(candidate);
      return owned.startsWith('/station-logos/') ? `${baseUrl}${owned}` : parsed.href;
    }
  }
  const favicon = parseStationImageUrl(station?.favicon);
  if (favicon) {
    const encoded = Buffer.from(favicon.href, 'utf8').toString('base64url');
    return `${baseUrl}/api/image/${encoded}?w=256`;
  }
  return null;
}

/** Send 503 Service Unavailable when qualified-languages cannot be resolved.
 * Cloudflare/CDN MUST NOT cache this. */
function send503QualifiedLangs(res: any, route: string): void {
  logger.error(`🔴 ${route}: qualified-languages unavailable — returning 503`);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Retry-After', '300');
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).send('Sitemap temporarily unavailable — qualified-languages cache cold. Retry in 5 minutes.');
}

/** Active manifest metadata alone is not proof that a sitemap has children.
 * During an initial build/rolling replacement, empty manifests must not turn
 * into a successful empty index (or 304) that search engines retain. */
function hasPublishableSitemapChildren(manifests: Iterable<any>): boolean {
  for (const manifest of manifests) {
    if ((manifest.type === 'main' || manifest.type === 'genres') && manifest.chunkCount > 0) return true;
    if (manifest.type === 'stations' && Array.isArray(manifest.chunks) && manifest.chunks.some((chunk: any) =>
      chunk && Number.isInteger(chunk.chunk) && chunk.chunk >= 1 && chunk.chunk <= 9999 && chunk.urlCount > 0)) return true;
  }
  return false;
}

/** Empty manifests are valid for a type with no eligible pages. Missing
 * manifests mean a build is incomplete, so do not publish a partial index. */
function hasCompleteManifestCoverage(manifests: any[], languages: readonly string[]): boolean {
  const slots = new Set(manifests.map(manifest => `${manifest.type}:${manifest.language}`));
  return languages.every(language => ['main', 'genres', 'stations'].every(type => slots.has(`${type}:${language}`)));
}

function send503EmptySitemapIndex(res: any): void {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Retry-After', '120');
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).send('Sitemap manifest building — retry shortly');
}

/** Validators describe the XML representation, including lastmod and image
 * changes. A station's max updatedAt is not a safe HTTP date validator: URL
 * removal or locale changes can alter XML without advancing that timestamp. */
interface CachedSitemapXml { xml: string; etag: string; byteLength: number }

function cacheSitemapXml(xml: string): CachedSitemapXml {
  xml = withSitemapStylesheet(xml);
  return { xml, etag: `"${crypto.createHash('sha256').update(xml).digest('hex')}"`, byteLength: Buffer.byteLength(xml) };
}

function matchesSitemapEtag(req: Request, etag: string): boolean {
  const validators = req.headers['if-none-match'];
  return typeof validators === 'string' && validators.split(',').some(value => {
    const tag = value.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}

function setSitemapHeaders(res: Response, etag: string, cacheControl: string, lastModified?: Date | null): void {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cacheControl);
  setLastModifiedHeader(res, lastModified);
}

/** A small metadata entry shares the XML TTL. Conditional hits need neither
 * a full Redis XML read nor regeneration when a leaf exceeds the memory cap. */
async function sendCachedSitemap304(req: Request, res: Response, cacheKey: string, cacheControl: string, lastModified?: Date | null): Promise<boolean> {
  if (!req.headers['if-none-match']) return false;
  const metadata = await CacheManager.get<{ etag: string }>(`${cacheKey}:validator`);
  if (!metadata || !matchesSitemapEtag(req, metadata.etag)) return false;
  setSitemapHeaders(res, metadata.etag, cacheControl, lastModified);
  res.status(304).end();
  return true;
}

async function storeSitemapXml(cacheKey: string, sitemap: CachedSitemapXml): Promise<void> {
  const options = { ttl: SITEMAP_CONFIG.childCacheTtlSeconds };
  await CacheManager.set(cacheKey, sitemap, options);
  await CacheManager.set(`${cacheKey}:validator`, { etag: sitemap.etag }, options);
}

function sendSitemapXml(req: Request, res: Response, sitemap: CachedSitemapXml, cacheControl: string, lastModified?: Date | null): void {
  const { xml, etag, byteLength } = sitemap;
  setSitemapHeaders(res, etag, cacheControl, lastModified);
  if (matchesSitemapEtag(req, etag)) {
    res.status(304).end();
    return;
  }
  // res.send() would run Express's date-only freshness check again and could
  // turn a changed XML body into an incorrect 304. ETag is our sole validator.
  res.setHeader('Content-Length', byteLength);
  res.status(200).end(xml);
}

/** Format a Date as ISO 8601 (YYYY-MM-DD) for sitemap <lastmod>. Returns empty
 * string if input is not a valid Date — caller should omit <lastmod> entirely
 * (CRITICAL LASTMOD RULE: never use today as fallback). */
function formatLastmod(date?: Date | null): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  // W3C Datetime full ISO 8601 with timezone (UTC) — Google/Bing prefer
  // millisecond-precise lastmod when re-crawl decisions matter, and the
  // bare YYYY-MM-DD form was flagged in the SEO audit as too coarse.
  return date.toISOString();
}

/** Expose the known content date without inventing a current timestamp.
 * Conditional responses use the XML ETag, not this aggregate content date. */
function setLastModifiedHeader(res: any, date?: Date | null): void {
  if (!(date instanceof Date) || isNaN(date.getTime())) return;
  try {
    res.setHeader('Last-Modified', date.toUTCString());
  } catch { /* best-effort */ }
}

// Top-countries for sitemap-main-{lang}.xml are computed during the
// SitemapManifest build (see sitemap-manifest-builder.buildMainChunks) and
// baked into the active 'main' manifest's chunks[0].stationIds. The route
// reads them back via extractTopCountriesFromChunk() so:
//   - cache invalidation is deterministic (manifest content-version changes
//     when the country leaderboard shifts → ETag flips automatically),
//   - operational station updates invalidate the cache without inventing dates,
//   - admins can force-refresh via POST /api/admin/sitemap/rebuild.

export async function registerSeoSitemapRoutes(app: Express, deps: any, options?: { apiOnly?: boolean }) {
  const { requireAdmin } = deps;
  const seoRenderer = new SeoRenderer();

  // CLIENT-SIDE ERROR LOGGING ENDPOINT
  app.post("/api/stations/report-error", async (req, res) => {
    try {
      const {
        stationId,
        stationName,
        stationUrl,
        errorType,
        errorMessage,
        errorDetails,
        stationMeta,
        browserInfo,
        streamInfo
      } = req.body;

      // Get client info
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      // Create comprehensive error log; persistence groups concurrent reports atomically.
      const errorLog = {
        stationId: stationId || 'unknown',
        stationName: stationName || 'Unknown Station',
        stationUrl: stationUrl || 'unknown',
        errorType: errorType === 'USER_REPORT' ? 'STREAM_UNAVAILABLE' : errorType || 'AUDIO_ERROR',
        errorMessage: errorMessage || 'Unknown error',
        errorDetails: {
          ...errorDetails,
          occurrenceCount: 1,
          audioProperties: errorDetails?.audioProperties || {},
          browserInfo: {
            userAgent,
            platform: browserInfo?.platform || 'unknown',
            language: browserInfo?.language || 'unknown',
            cookieEnabled: browserInfo?.cookieEnabled !== false,
            onLine: browserInfo?.onLine !== false,
            ...browserInfo
          },
          connectionInfo: browserInfo?.connectionInfo || {},
          streamAnalysis: {
            detectedFormat: streamInfo?.detectedFormat || 'unknown',
            contentType: streamInfo?.contentType || 'unknown',
            isHLS: streamInfo?.isHLS || false,
            isPlaylist: streamInfo?.isPlaylist || false,
            ...streamInfo
          }
        },
        stationMeta: stationMeta || {},
        userAgent,
        clientIP,
        timestamp: new Date(),
        isResolved: false,
        reportingUsers: [{
          userAgent,
          clientIP,
          timestamp: new Date()
        }],
        uniqueUserCount: 1,
        totalOccurrences: 1
      };
      const { row, created } = await pgReportStationDebugLog(errorLog,errorDetails || {});
      res.json(created
        ? { success: true, message: 'Error logged successfully', errorId: row._id }
        : { success: true, message: 'Error updated in existing log', errorId: row._id, totalOccurrences: row.totalOccurrences });
    } catch (error) {
      console.error('Error saving playback error log:', error);
      res.status(500).json({ error: 'Failed to log error' });
    }
  });

  // GET endpoint to retrieve error logs for debugging
  app.get("/api/admin/error-logs", requireAdmin, async (req, res) => {
    try {
      const page = Math.max(1,parseInt(req.query.page as string) || 1);
      const limit = Math.max(1,Math.min(500,parseInt(req.query.limit as string) || 50));
      const skip = (page - 1) * limit;
      
      const stationId = req.query.stationId as string;
      const errorType = req.query.errorType as string;
      const resolved = req.query.resolved as string;

      let query: any = {};
      
      if (stationId) query.stationId = stationId;
      if (errorType) query.errorType = errorType;
      if (resolved !== undefined) query.isResolved = resolved === 'true';

      const { errors, total } = await pgListStationDebugLogs(query,limit,skip);

      res.json({
        errors,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      console.error('Error fetching error logs:', error);
      res.status(500).json({ error: 'Failed to fetch error logs' });
    }
  });

  // === URL TRANSLATION HELPERS FOR SITEMAP ===
  
  /**
   * Ensures URL translations are loaded from database and merged with static translations
   * Returns forward and reverse Maps for fast lookup
   */
  async function ensureUrlTranslationsLoaded(): Promise<{
    forwardMap: Map<string, string>;
    reverseMap: Map<string, string>;
  }> {
    try {
      logger.log('🗺️ SITEMAP: Loading URL translations...');
      
      // Load database translations using performance cache
      const dbTranslations = await performanceCache.getUrlTranslations();
      logger.log(`🗺️ SITEMAP: Loaded ${dbTranslations.size} database translations`);
      
      // Create forward map: "languageCode:englishPath" -> translatedPath
      const forwardMap = new Map<string, string>(dbTranslations);
      
      // Merge with static translations from URL_TRANSLATIONS
      let staticCount = 0;
      for (const [lang, translations] of Object.entries(URL_TRANSLATIONS)) {
        for (const [english, translated] of Object.entries(translations)) {
          const key = `${lang}:${english}`;
          // Database translations take priority over static translations
          if (!forwardMap.has(key)) {
            forwardMap.set(key, translated);
            staticCount++;
          }
        }
      }
      logger.log(`🗺️ SITEMAP: Merged ${staticCount} static translations, total ${forwardMap.size} translations`);
      
      // Log a few sample translations for debugging
      logger.log('🗺️ SITEMAP: Sample translations:');
      logger.log('  de:stations →', forwardMap.get('de:stations'));
      logger.log('  sq:genres →', forwardMap.get('sq:genres'));
      logger.log('  de:genres →', forwardMap.get('de:genres'));
      
      // Build reverse map: "languageCode:translatedPath" -> englishPath
      const reverseMap = new Map<string, string>();
      for (const [key, translatedPath] of forwardMap.entries()) {
        const [languageCode, englishPath] = key.split(':');
        if (languageCode && englishPath) {
          const reverseKey = `${languageCode}:${translatedPath}`;
          reverseMap.set(reverseKey, englishPath);
        }
      }
      
      logger.log(`🗺️ SITEMAP: Built ${reverseMap.size} reverse translations`);
      return { forwardMap, reverseMap };
    } catch (error) {
      console.error('❌ SITEMAP: Failed to load URL translations:', error);
      // Return empty maps as fallback
      return {
        forwardMap: new Map<string, string>(),
        reverseMap: new Map<string, string>()
      };
    }
  }

  // ==================== Deep Links: iOS Universal Links & Android App Links ====================

  app.get("/.well-known/apple-app-site-association", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    res.removeHeader("Expires");
    res.json({
      applinks: {
        apps: [],
        details: [
          {
            appID: "M6T85HP76P.com.visiongo.megaradio",
            paths: mobileAppLinkPaths()
          }
        ]
      }
    });
  });

  app.get("/.well-known/assetlinks.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    res.removeHeader("Expires");
    res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.visiongo.megaradio",
          sha256_cert_fingerprints: [
            "15:46:3D:5C:AA:67:5D:BE:80:80:09:53:28:E0:9A:24:1F:93:30:CE:D0:8E:96:F2:91:E0:EF:84:2B:FC:D3:CB"
          ]
        }
      },
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.megaradio",
          sha256_cert_fingerprints: [
            "B7:D7:BD:6A:A9:DA:2F:B8:FA:D1:71:B1:E3:11:77:F4:A4:7E:02:0D:36:5A:56:5C:8B:D1:62:52:0A:7F:55:3F"
          ]
        }
      }
    ]);
  });

  // SEO ENDPOINTS: Page Data, Sitemap and Robots.txt
  
  // API endpoint for SEO page data with translated canonical URLs
  app.get("/api/seo/page-data", async (req, res) => {
    try {
      const url = req.query.url as string || '/';
      if (getLegacyStationGuideRoute(url)) res.set('Cache-Control', 'no-store');
      
      // CRITICAL SEO FIX: Always use themegaradio.com as the PRIMARY domain
      const getProductionDomain = (requestHost: string = ''): string => {
        return 'https://themegaradio.com';
      };
      
      const fullDomain = getProductionDomain(req.get('host'));

      const seoData = await seoRenderer.renderStaticPage(url, fullDomain);
      if (seoData.pageData?.stationDbError || seoData.pageData?.hubReadFailed) {
        markSeoTemporarilyUnavailable(res);
        res.json({ error: 'SEO metadata temporarily unavailable' });
        return;
      }
      if (seoData.pageData?.httpNotFound) res.status(404).set('Cache-Control', 'no-store');
      if (getLegacyStationGuideRoute(url) && !seoData.pageData?.httpNotFound && (seoData.pageData?.notFound || seoData.pageData?.stationIsJunk)) {
        res.status(410).set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, follow' }).json({
          legacyGuideId: null,
          seoTags: { title: seoData.language === 'ar' ? 'الصفحة غير متوفرة | MegaRadio' : 'Page unavailable | MegaRadio', description: '',
            noIndex: true, robots: 'noindex, follow', hreflangs: [] },
          structuredData: { global: [], page: [] },
        });
        return;
      }
      const retiredStation = getRetiredLocaleFromPath(url) && seoData.pageData?.pageType === 'station';
      if (retiredStation && (seoData.pageData?.notFound || seoData.pageData?.stationIsJunk)) {
        res.status(410).set('Cache-Control', 'no-store').json({ error: 'Station unavailable' });
        return;
      }
      // The SPA needs page metadata and the same structured-data objects as
      // SSR, not duplicate translation dictionaries or full station records.
      // The admin SEO preview retains the full response without slim=1.
      if (String(req.query.slim || '') === '1') {
        const stationDirectory = seoRenderer.buildStationDirectoryData(seoData);
        if (seoData.pageData?.pageType === 'stations' && isStationDirectoryPath(seoData.cleanPath)
            && !seoData.pageData.httpNotFound && !stationDirectory) {
          markSeoTemporarilyUnavailable(res);
          res.json({ error: 'Station directory temporarily unavailable' });
          return;
        }
        res.json({
          language: (seoData as any).language,
          cleanPath: (seoData as any).cleanPath,
          ...(getLegacyStationGuideRoute(url) ? { legacyGuideId: seoData.pageData?.legacyGuide?.id ?? null } : {}),
          ...(getLegacyStationGuideRoute(url) && seoData.pageData?.redirectTo ? { redirectTo: seoData.pageData.redirectTo } : {}),
          // SPA entry without SSR bootstrap must resolve the same verified
          // station before enrichment; do not expose the archived/source row.
          ...(retiredStation && seoData.pageData?.station?._id
            ? { stationIdentity: String(seoData.pageData.station._id) } : {}),
          ...(stationDirectory ? { stationDirectory } : {}),
          seoTags: normalizeSeoTitleTags(seoData.seoTags),
          structuredData: seoRenderer.generateStructuredData(
            seoData.seoTags, seoData.language, seoData.translations || {},
            seoData.cleanPath, seoData.pageData?.station, seoData.urlTranslations, seoData.pageData,
          ),
        });
        return;
      }
      res.json(seoData);
    } catch (error) {
      console.error('SEO Page Data error:', error);
      markSeoTemporarilyUnavailable(res);
      res.json({ error: 'SEO metadata temporarily unavailable' });
    }
  });

  // Task #154: admin manual cache-bust / rebuild trigger.
  // Forces a full SitemapManifest rebuild (stations + genres + main). Use after
  // bulk station imports/deletions when you need the published sitemap to
  // refresh before the next 6-hour scheduled refresh — including the top-30
  // country list embedded in /sitemap-main-{lang}.xml.
  app.post("/api/admin/sitemap/rebuild", requireAdmin, manualSitemapRebuildTimeout, async (_req, res) => {
    try {
      // FRESHNESS FIX (2026-05-09): full cache-invalidation chain BEFORE the
      // rebuild. Without this, buildAllSitemapManifests({ force: true }) reads
      // stale data from three independent layers and commits it back into the
      // manifest with a fresh `generatedAt` — admin sees "lastmod updated" in
      // /sitemap-index.xml but the URL list inside is unchanged.
      //
      //  1. performanceCache.translationsCache (1h TTL) — feeds
      //     hasCompleteSeoTranslations → drives qualifiedLanguages.
      //  2. qualified-languages memoryCache (10min TTL) + LKG document —
      //     LKG resetLkg=true is REQUIRED to defeat shrink-protection
      //     (the 50% guard locks us into the previous 30-language list).
      //  3. URL/country mapping caches — drive sitemap URL slug generation.
      // Best-effort: in-memory cache clears can never fail.
      performanceCache.clearTranslations();
      performanceCache.clearUrlTranslations();
      performanceCache.clearCountryLanguageMappings();
      // CRITICAL: LKG reset MUST succeed — without it the shrink-protection
      // guard (qualified-languages.ts ~L206) will keep serving the stale
      // 30-language LKG, defeating the whole point of "Sitemap'i Yenile".
      // Surface the failure to the admin instead of silently completing.
      try {
        await invalidateQualifiedLanguages({ resetLkg: true });
      } catch (err: any) {
        logger.error('admin/sitemap/rebuild: LKG reset FAILED — aborting (would keep zombie languages):', err);
        res.status(500).json({
          ok: false,
          error: 'lkg_reset_failed',
          message: `Yenileme iptal edildi: shrink-protection kilidi açılamadı (${err?.message ?? err}). Lütfen tekrar deneyin.`,
        });
        return;
      }
      // Mapping reloads are best-effort — empty maps just mean fewer slugs,
      // not stale ones, so allSettled is fine here.
      await Promise.allSettled([
        loadDatabaseUrlTranslations(),
        loadDatabaseCountryLanguageMappings(),
      ]);
      const result = await buildAllSitemapManifests({ force: true });
      if (!result.built) {
        const busy = result.skippedReason === 'build-in-progress';
        res.set('Retry-After', '60');
        res.status(busy ? 409 : 503).json({
          ok: false,
          error: busy ? 'sitemap_build_in_progress' : 'sitemap_build_unavailable',
          message: busy
            ? 'Başka bir sitemap derlemesi sürüyor. Bu istek tamamlanmadı; işlem bittikten sonra yeniden deneyin.'
            : 'Sitemap derlemesi tamamlanamadı. Mevcut sitemap korundu; dil bilgisi ve sunucu durumunu kontrol edin.',
        });
        return;
      }
      // FRESHNESS BUG FIX (2026-05-09): nuke the per-XML response cache so
      // the admin rebuild button takes effect immediately. Without this,
      // the in-process / Redis cache (1h TTL) keeps serving the previous
      // XML body — admins click rebuild, manifest gets fresh
      // chunks[].maxUpdatedAt, but the served XML still shows old per-URL
      // <lastmod> values until cache TTL expires. clearByPattern is safe:
      // worst case all sitemap URLs see one cache miss in the next minute.
      try {
        await CacheManager.clearByPattern('sitemap:');
        await CacheManager.clearByPattern('precomputed_');
      } catch (err: any) {
        logger.warn(`admin/sitemap/rebuild: cache clear failed (non-fatal): ${err?.message ?? err}`);
      }
      // SEO AUDIT FIX (2026-05-09): also purge Cloudflare's edge cache for
      // every published sitemap URL. Even after the in-process cache is
      // cleared (above), Cloudflare keeps serving the stale XML body for up
      // to its s-maxage window (1h for child sitemaps, 10min for the index)
      // — which means an admin clicks "rebuild" but sees no change in the
      // public XML for an hour. The Cloudflare API caps each purge call at
      // 30 URLs, so we batch (index + main per lang + genres per lang +
      // stations per lang/chunk all together is roughly 35-40 URLs for the
      // current 10-lang setup; 2 batches comfortably covers it).
      // Fire-and-forget: failures (missing CF credentials, transient API
      // errors, etc.) must NOT fail the rebuild response.
      void (async () => {
        try {
          const { scheduledCacheClearService } = await import('../services/scheduled-cache-clear');
          // Pull the actual published sitemap URL list straight from the
          // freshly-rebuilt manifest set so we never hard-code which langs
          // / chunks exist (the qualifiedLanguages set changes over time).
          const baseUrl = process.env.PUBLIC_BASE_URL || 'https://themegaradio.com';
          const urls: string[] = [`${baseUrl}/sitemap-index.xml`, `${baseUrl}/sitemap.xml`, `${baseUrl}/robots.txt`];
          const langs: string[] = Array.isArray((result as any)?.qualifiedLanguages) ? (result as any).qualifiedLanguages : [];
          for (const lang of langs) {
            urls.push(`${baseUrl}/sitemap-main-${lang}.xml`);
            urls.push(`${baseUrl}/sitemap-genres-${lang}.xml`);
          }
          // Stations chunks vary per language. Probe the manifest builder's
          // active manifests for chunk counts (best-effort — if the lookup
          // fails we still purge index + main + genres which is the
          // highest-value set for crawler freshness).
          try {
            const { getActiveManifest } = await import('../seo/sitemap-manifest-builder');
            for (const lang of langs) {
              const m: any = await getActiveManifest('stations', lang);
              const chunkCount: number = m?.chunkCount ?? 0;
              for (let c = 1; c <= chunkCount; c++) {
                urls.push(`${baseUrl}/sitemap-stations-${lang}-${c}.xml`);
              }
            }
          } catch (probeErr: any) {
            logger.warn(`admin/sitemap/rebuild: stations-chunk probe failed (purging index + main + genres only): ${probeErr?.message ?? probeErr}`);
          }
          // Cloudflare API hard-caps at 30 URLs per purge call — batch.
          const BATCH = 30;
          for (let i = 0; i < urls.length; i += BATCH) {
            const slice = urls.slice(i, i + BATCH);
            const resp = await scheduledCacheClearService.purgeCloudflareUrls(slice);
            if (!resp.success) {
              logger.warn(`admin/sitemap/rebuild: CF purge batch ${i / BATCH + 1} failed: ${resp.message}`);
            }
          }
          logger.log(`☁️ admin/sitemap/rebuild: requested Cloudflare purge for ${urls.length} sitemap URLs`);
        } catch (err: any) {
          logger.error(`admin/sitemap/rebuild: Cloudflare purge orchestration failed (non-fatal): ${err?.message ?? err}`);
        }
      })();
      // Task #201: ping IndexNow with the sitemap index so Google/Bing pick
      // up the freshly-rebuilt sitemap immediately (matches the
      // genre-whitelist admin routes' triggerSearchEnginePush pattern).
      // Fire-and-forget — admins shouldn't wait on an outbound HTTP call,
      // and failures must not fail the rebuild response.
      void (async () => {
        try {
          await IndexNowService.submitSitemaps(undefined, 'sitemap-regen');
        } catch (err: any) {
          logger.error('admin/sitemap/rebuild: IndexNow sitemap ping failed:', err?.message ?? err);
        }
      })();
      res.json({ ok: true, ...result });
    } catch (error: any) {
      logger.error('admin/sitemap/rebuild failed:', error);
      res.status(500).json({ ok: false, error: error?.message || 'rebuild_failed' });
    }
  });

  app.post("/api/admin/sitemap/touch-stations", requireAdmin, async (_req, res) => {
    const t0 = Date.now();
    try {
      // Concurrency guard (architect 2026-05-09): if the nightly sync is
      // already running, the bulk updateMany would race with its bulkWrite
      // batch and could overwrite the carefully-bumped per-station updatedAt
      // values mid-flight. Bail out with 409 Conflict so the admin retries
      // after the sync finishes (~5-10 min).
      try {
        const { scheduledStationSync } = await import('../services/scheduled-station-sync');
        const status = scheduledStationSync.getStatus();
        if (status.isRunning) {
          return void res.status(409).json({
            ok: false,
            error: 'sync_in_progress',
            message: 'Nightly station sync is currently running — please retry in a few minutes.',
            sinceMs: status.lastRunAt ? Date.now() - status.lastRunAt.getTime() : null,
          });
        }
      } catch {
        // If the module fails to import for any reason, don't block the
        // touch — the architect guard is best-effort.
      }
      const now = new Date();
      // Shares the provider-sync advisory lock across workers. The SQL update
      // changes only lastmod metadata; catalogue content/counters are untouched.
      const updateRes = await pgTouchSitemapStations(now);
      const matched = (updateRes as any).matchedCount ?? 0;
      const modified = (updateRes as any).modifiedCount ?? 0;
      logger.warn(`🕐 admin/sitemap/touch-stations: bumped updatedAt on ${modified}/${matched} stations to ${now.toISOString()}`);
      if (matched === 0) {
        logger.error(
          '🔴 admin/sitemap/touch-stations: PostgreSQL stations has no rows with a non-empty slug. Check DATABASE_URL and the imported catalog.',
        );
      }

      // Now force a rebuild so the manifest's chunks[].maxUpdatedAt picks up
      // the new timestamps. We run the same cache-flush chain as
      // /api/admin/sitemap/rebuild so the served XML refreshes immediately.
      performanceCache.clearTranslations();
      performanceCache.clearUrlTranslations();
      performanceCache.clearCountryLanguageMappings();
      try {
        await invalidateQualifiedLanguages();
      } catch (err: any) {
        logger.error('admin/sitemap/touch-stations: cache invalidate failed:', err);
      }
      const result = await buildAllSitemapManifests({ force: true });
      try {
        await CacheManager.clearByPattern('sitemap:');
        await CacheManager.clearByPattern('precomputed_');
      } catch (err: any) {
        logger.warn(`admin/sitemap/touch-stations: cache clear failed: ${err?.message ?? err}`);
      }

      // ARCHITECT FIX (2026-05-10): purge Cloudflare edge cache for every
      // sitemap URL. Without this, even a successful rebuild leaves CF
      // serving the stale XML body (and stale Last-Modified header) for up
      // to its s-maxage window — admin clicks the button, manifest rebuilds,
      // but Googlebot still sees the old `<lastmod>` for ~1 hour.
      // Mirrors the same logic block already in /api/admin/sitemap/rebuild.
      void (async () => {
        try {
          const { scheduledCacheClearService } = await import('../services/scheduled-cache-clear');
          const baseUrl = process.env.PUBLIC_BASE_URL || 'https://themegaradio.com';
          const urls: string[] = [`${baseUrl}/sitemap-index.xml`, `${baseUrl}/sitemap.xml`, `${baseUrl}/robots.txt`];
          const langs: string[] = Array.isArray((result as any)?.qualifiedLanguages) ? (result as any).qualifiedLanguages : [];
          for (const lang of langs) {
            urls.push(`${baseUrl}/sitemap-main-${lang}.xml`);
            urls.push(`${baseUrl}/sitemap-genres-${lang}.xml`);
          }
          try {
            const { getActiveManifest } = await import('../seo/sitemap-manifest-builder');
            for (const lang of langs) {
              const m: any = await getActiveManifest('stations', lang);
              const chunkCount: number = m?.chunkCount ?? 0;
              for (let c = 1; c <= chunkCount; c++) {
                urls.push(`${baseUrl}/sitemap-stations-${lang}-${c}.xml`);
              }
            }
          } catch (probeErr: any) {
            logger.warn(`admin/sitemap/touch-stations: stations-chunk probe failed: ${probeErr?.message ?? probeErr}`);
          }
          const BATCH = 30;
          for (let i = 0; i < urls.length; i += BATCH) {
            const slice = urls.slice(i, i + BATCH);
            const resp = await scheduledCacheClearService.purgeCloudflareUrls(slice);
            if (!resp.success) {
              logger.warn(`admin/sitemap/touch-stations: CF purge batch ${i / BATCH + 1} failed: ${resp.message}`);
            }
          }
          logger.log(`☁️ admin/sitemap/touch-stations: requested Cloudflare purge for ${urls.length} sitemap URLs`);
        } catch (err: any) {
          logger.error(`admin/sitemap/touch-stations: Cloudflare purge orchestration failed (non-fatal): ${err?.message ?? err}`);
        }
      })();

      // Async: IndexNow ping (non-blocking) — same path as /rebuild
      (async () => {
        try {
          await IndexNowService.submitSitemaps(undefined, 'sitemap-touch-stations');
        } catch (err: any) {
          logger.error('admin/sitemap/touch-stations: IndexNow ping failed:', err?.message ?? err);
        }
      })();

      // ARCHITECT FIX (2026-05-10): surface "why nothing happened" reasons
      // explicitly so admin doesn't silently see "0/0, 0 langs" without a clue.
      const warnings: string[] = [];
      if (matched === 0) {
        warnings.push(
          `PostgreSQL stations update matched 0 rows. ` +
          `DB connection may point to wrong cluster/db, OR no station has a non-empty slug.`,
        );
      }
      if (result.qualifiedLanguages.length === 0) {
        warnings.push(
          'qualifiedLanguages computed to 0 — manifest builder early-exited without writing any new manifests. ' +
          'Translation cache may be cold; check api-server logs for "qualified-languages" lines.',
        );
      }
      res.json({
        ok: warnings.length === 0,
        touchedAt: now.toISOString(),
        matchedStations: matched,
        modifiedStations: modified,
        collectionName: 'stations',
        rebuild: {
          built: result.built,
          qualifiedLanguages: result.qualifiedLanguages.length,
          activatedCount: result.activatedCount ?? 0,
          retiredZombies: result.retiredZombies ?? 0,
        },
        warnings,
        elapsedMs: Date.now() - t0,
      });
    } catch (err: any) {
      logger.error('admin/sitemap/touch-stations failed:', err);
      res.status(err?.statusCode === 409 ? 409 : 500).json({ ok: false, error: err?.code ?? err?.message ?? 'touch_failed', message: err?.message });
    }
  });

  // ADMIN OBSERVABILITY (2026-05-09): live snapshot of every active
  // SitemapManifest doc — admins need this to verify that "Sitemap'i Yenile"
  // actually refreshed content (not just bumped lastmod). Returns one row per
  // (type, language) so the frontend can colour-code freshness and surface
  // chunkCount / totalUrls / maxUpdatedAt without having to curl the live XML.
  app.get("/api/admin/sitemap/manifest-stats", requireAdmin, async (_req, res) => {
    try {
      let qualifiedLanguages: string[] = [];
      let qualifiedLanguagesHash = '';
      try {
        const state = await getQualifiedLanguagesState();
        qualifiedLanguages = [...state.languages];
        qualifiedLanguagesHash = state.hash;
      } catch (err) {
        if (!(err instanceof QualifiedLanguagesUnavailableError)) throw err;
      }

      const docs = await pgActiveManifests();

      const stats = docs.map((d: any) => {
        const dates: number[] = (d.chunks || [])
          .map((c: any) => c?.maxUpdatedAt instanceof Date ? c.maxUpdatedAt.getTime() : (c?.maxUpdatedAt ? new Date(c.maxUpdatedAt).getTime() : NaN))
          .filter((t: number) => Number.isFinite(t));
        const maxUpdatedAt = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;
        return {
          type: d.type,
          language: d.language,
          version: typeof d.version === 'string' ? d.version.slice(0, 12) : '',
          qualifiedLanguagesHash: typeof d.qualifiedLanguagesHash === 'string' ? d.qualifiedLanguagesHash.slice(0, 12) : '',
          chunkCount: d.chunkCount ?? (Array.isArray(d.chunks) ? d.chunks.length : 0),
          totalUrls: d.totalUrls ?? 0,
          generatedAt: d.generatedAt ? new Date(d.generatedAt).toISOString() : null,
          maxUpdatedAt,
          isQualified: qualifiedLanguages.length === 0 ? null : qualifiedLanguages.includes(d.language),
        };
      });

      const generatedAtList = stats
        .map((s) => s.generatedAt ? new Date(s.generatedAt).getTime() : NaN)
        .filter((t) => Number.isFinite(t));
      const oldestGeneratedAt = generatedAtList.length > 0
        ? new Date(Math.min(...generatedAtList)).toISOString()
        : null;
      const newestGeneratedAt = generatedAtList.length > 0
        ? new Date(Math.max(...generatedAtList)).toISOString()
        : null;

      const zombieLanguages = qualifiedLanguages.length > 0
        ? Array.from(new Set(stats.filter((s) => s.isQualified === false).map((s) => s.language))).sort()
        : [];

      // ARCHITECT FIX (2026-05-10): expose Station collection diagnostics so
      // admin can see WHY touch-stations might match 0 (wrong DB? empty
      // collection? all slugs blank?) without needing shell access.
      let stationDiag: Record<string, unknown> = {};
      try {
        stationDiag = await pgSitemapStationDiagnostics();
      } catch (diagErr: any) {
        stationDiag = { error: diagErr?.message ?? 'station_diag_failed' };
      }

      res.json({
        qualifiedLanguages,
        qualifiedLanguagesHash,
        stats,
        oldestGeneratedAt,
        newestGeneratedAt,
        zombieLanguages,
        totalActive: stats.length,
        stationDiag,
      });
    } catch (err: any) {
      logger.error('admin/sitemap/manifest-stats failed:', err?.message ?? err);
      res.status(500).json({ ok: false, error: err?.message ?? 'manifest_stats_failed' });
    }
  });

  // NOTE: the apiOnly early-return used to sit HERE, which skipped the
  // /robots.txt route below. That made api.themegaradio.com/robots.txt return
  // 404 (GSC "robots.txt could not be fetched" error) — and because
  // index-api.ts removed its own fallback "Disallow: /" handler (S1 fix,
  // 2026-05-08) on the assumption THIS handler would respond, the api host
  // ended up with no robots.txt at all. /robots.txt and /llms.txt are safe and
  // useful on the API host (they only advertise crawl directives + canonical
  // entry points on themegaradio.com), so the guard now sits AFTER them.

  registerLlmsTxtRoutes(app, { homeDiscovery: !options?.apiOnly });

  // One common policy for search, retrieval and training crawlers. HTML pages
  // remain crawlable so their index/noindex directives can be read; API
  // authentication, not robots.txt, protects personal data.
  app.get("/robots.txt", async (req, res) => {
    const baseUrl = getBaseUrl(req);
    const robots = `User-agent: *
Disallow: /api/admin
Disallow: /api/auth
Disallow: /api/user/
Disallow: /api/users/
Allow: /api/users/search$
Allow: /api/users/search?page=1&limit=20&sortBy=recent_favorites$
Disallow: /api/sync/
Disallow: /api/test/
Disallow: /api/payments/
Disallow: /api/iap/
Disallow: /api/push/
Disallow: /api/stream/
Disallow: /api/stream-analysis
Disallow: /api/stream-https-analysis
Disallow: /api/tv/
Disallow: /api/analytics
Disallow: /api/messages/
Disallow: /api/cast/
Disallow: /api/ml/
Disallow: /api/internal/
Disallow: /api/cache/
Disallow: /api/logs/

Sitemap: ${baseUrl}/sitemap-index.xml
Sitemap: ${baseUrl}/sitemap-blog.xml`;

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(robots);
  });

  // api-only deployments (api.themegaradio.com) serve /robots.txt + /llms.txt
  // above, but NOT the SSR sitemap routes below (those belong to the web host).
  if (options?.apiOnly) {
    return;
  }

  app.get('/sitemap.css', (_req, res) => {
    res.removeHeader('Expires');
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.send(SITEMAP_STYLESHEET);
  });

  // The qualified-language cache has been hoisted to
  // `server/seo/qualified-languages.ts` so the SSR renderer can consult the
  // same source of truth. Sitemap uses the shared helper below.

  // Language-specific main sitemap route — manifest-driven (refactored 2026-04-30)
  const blogSitemap = cacheSitemapXml(buildBlogSitemap());
  app.get('/sitemap-blog.xml', (req, res) => {
    sendSitemapXml(req, res, blogSitemap, 'public, max-age=600, s-maxage=600', new Date(BLOG_SITEMAP_UPDATED));
  });

  app.get("/sitemap-main-:lang.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    const childCacheControl = `public, max-age=${SITEMAP_CONFIG.childCacheTtlSeconds}, s-maxage=${SITEMAP_CONFIG.childCacheTtlSeconds}, stale-while-revalidate=${SITEMAP_CONFIG.childStaleWhileRevalidateSec}`;

    try {
      let state;
      try { state = await getQualifiedLanguagesState(); }
      catch (err) {
        if (err instanceof QualifiedLanguagesUnavailableError) return send503QualifiedLangs(res, `sitemap-main-${lang}`);
        throw err;
      }
      const qualifiedLanguages = state.languages;
      if (!qualifiedLanguages.includes(lang)) {
        // Manifest-driven 410: lang not qualified -> permanently gone (Bing/Google removal signal)
        return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
      }

      const manifest = await getActiveManifest('main', lang);
      // No manifest yet (cold boot before warm-up complete) -> 503 retry
      if (!manifest) {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Retry-After', '120');
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(503).send('Manifest building — retry shortly');
      }

      // Task #154: top countries are part of the manifest now — reading them
      // from chunks[0].stationIds keeps the country list, the manifest
      // content-version hash, and the ETag in lockstep. No separate cache
      // sig is needed because the manifest version already covers it.
      const topCountries = manifest.chunks.length > 0
        ? extractTopCountriesFromChunk(manifest.chunks[0].stationIds)
        : [];

      // The main manifest aggregates operational station timestamps, not
      // page content revisions. Keep invalidation, but do not publish dates.
      const cacheKey = `sitemap:main:xml-v4-css:${lang}:${state.hash}:${manifest.version}:${manifest.maxUpdatedAt instanceof Date ? manifest.maxUpdatedAt.getTime() : 0}`;
      if (await sendCachedSitemap304(req, res, cacheKey, childCacheControl)) return;
      const cached = await CacheManager.get<CachedSitemapXml>(cacheKey);
      if (cached) {
        return sendSitemapXml(req, res, cached, childCacheControl);
      }

      const baseUrl = getBaseUrl(req);
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      // Static main pages — must mirror MAIN_STATIC_PAGES in
      // sitemap-manifest-builder.ts so urlCount/maxUpdatedAt stay in sync.
      // Task #128: expanded to include FAQ/Contact/Privacy/Terms/Applications
      // so Google has a discovery path to those previously-orphaned pages.
      const mainPages = ['', '/stations', '/genres', '/about', '/regions',
        '/regions/europe', '/regions/asia', '/regions/africa',
        '/regions/north-america', '/regions/south-america', '/regions/oceania',
        '/faq', '/contact', '/privacy-policy', '/terms-and-conditions', '/applications',
        // A-Z station index pages (Task #11, 2026-07-03). The letter key is
        // never translated (buildLocalizedUrl skips the second segment of
        // /stations paths), so these localize to /tr/istasyonlar/a etc.
        ...AZ_INDEX_KEYS.map((k) => `/stations/${k}`)];

      // topCountries was computed above for ETag/cache-key purposes; reuse it.

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`);

      for (const page of mainPages) {
        const localizedPath = buildLocalizedUrl(page, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;
        const priority = page === '' ? '1.0' : (page === '/stations' || page === '/genres' ? '0.9' : '0.8');
        const changefreq = page === '' || page === '/stations' ? 'daily' : 'weekly';

        parts.push(`
  <url>
    <loc>${escapeXml(fullUrl)}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>`);

        // Self-reference is REQUIRED by Google — the current language must
        // appear in its own xhtml:link list. Iterating qualifiedLanguages
        // already includes `lang`, so no need to dedupe.
        for (const altLang of qualifiedLanguages) {
          const altPath = buildLocalizedUrl(page, altLang, undefined, urlTranslations);
          parts.push(`
${buildHreflangLinks(altLang, baseUrl + altPath).slice(1)}`);
        }
        const enPath = buildLocalizedUrl(page, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl + enPath)}"/>
  </url>`);
      }
      // Top-country region pages (e.g. /<lang>/regions/europe/germany).
      for (const { regionSlug, countrySlug: cSlug } of topCountries) {
        const enginePath = `/regions/${regionSlug}/${cSlug}`;
        const localizedPath = buildLocalizedUrl(enginePath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;
        parts.push(`
  <url>
    <loc>${escapeXml(fullUrl)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>`);
        for (const altLang of qualifiedLanguages) {
          const altPath = buildLocalizedUrl(enginePath, altLang, undefined, urlTranslations);
          parts.push(`
${buildHreflangLinks(altLang, baseUrl + altPath).slice(1)}`);
        }
        const enPath = buildLocalizedUrl(enginePath, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl + enPath)}"/>
  </url>`);
      }

      parts.push(`
</urlset>`);
      const xml = parts.join('');

      const sitemap = cacheSitemapXml(xml);
      await storeSitemapXml(cacheKey, sitemap);
      sendSitemapXml(req, res, sitemap, childCacheControl);

      logger.log(`✅ sitemap-main-${lang}.xml (${mainPages.length + topCountries.length} URLs) ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error(`❌ Error generating sitemap-main-${lang}.xml:`, error);
      res.setHeader('Retry-After', '120');
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).send('Sitemap temporarily unavailable — retry shortly');
    }
  });

  async function loadPilotProfiles(qualifiedLanguages: string[], countryCode?: string): Promise<IndexingPilotProfile[]> {
    if (!qualifiedLanguages.includes('en')) return [];
    const profiles = INDEXING_PILOT.filter(profile => !countryCode || profile.countryCode === countryCode);
    const rows = await pgSitemapStationBatch(profiles.map(profile => profile.id));
    const { getIndexableLanguagesForStation } = await import('../seo/junk-station-rules');
    const eligible = new Set(rows.filter(station => matchingPilotProfile(station)
      && getIndexableLanguagesForStation(station, qualifiedLanguages, station.completeDescriptionLanguages).includes('en')).map(station => String(station._id)));
    return profiles.filter(profile => eligible.has(profile.id));
  }

  // Separate measurement cohorts, not replacements for the existing catalogue.
  app.get('/sitemap-pilot-en-:country.xml', async (req, res) => {
    const countryCode = String(req.params.country).toUpperCase();
    if (!['AT', 'TR'].includes(countryCode)) return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
    try {
      const state = await getQualifiedLanguagesState();
      const profiles = await loadPilotProfiles(state.languages, countryCode);
      if (profiles.length === 0) return send503EmptySitemapIndex(res);
      const baseUrl = getBaseUrl(req);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${profiles.map(profile => `\n  <url><loc>${escapeXml(`${baseUrl}/en/station/${profile.slug}`)}</loc></url>`).join('')}\n</urlset>`;
      sendSitemapXml(req, res, cacheSitemapXml(xml), 'public, max-age=300, s-maxage=300');
    } catch (error) {
      logger.error('Indexing pilot sitemap unavailable:', error);
      send503EmptySitemapIndex(res);
    }
  });

  // Language-specific station sitemap route — manifest-driven (refactored 2026-04-30)
  // Reads station _ids from active SitemapManifest, returns 410 Gone for chunks
  // not present in the manifest (Bing/Google clear-removal signal vs 404 ambiguity).
  app.get("/sitemap-stations-:lang-:chunk.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    // S26 FIX (2026-05-08): strict chunk parsing. `parseInt('abc') || 1`
    // silently coerced any garbage (including `0`, `-5`, `99999`) to chunk 1,
    // returning a 200 OK XML for URLs Google would later flag as duplicate
    // content. Reject anything that isn't a positive integer ≤ 9999 with a
    // 410 Gone so the bad URL drops out of the index cleanly.
    if (!/^[1-9]\d{0,3}$/.test(req.params.chunk)) {
      return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
    }
    const chunk = parseInt(req.params.chunk, 10);
    const childCacheControl = `public, max-age=${SITEMAP_CONFIG.childCacheTtlSeconds}, s-maxage=${SITEMAP_CONFIG.childCacheTtlSeconds}, stale-while-revalidate=${SITEMAP_CONFIG.childStaleWhileRevalidateSec}`;

    try {
      let state;
      try { state = await getQualifiedLanguagesState(); }
      catch (err) {
        if (err instanceof QualifiedLanguagesUnavailableError) return send503QualifiedLangs(res, `sitemap-stations-${lang}-${chunk}`);
        throw err;
      }
      const qualifiedLanguages = state.languages;
      if (!qualifiedLanguages.includes(lang)) {
        return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
      }

      // Manifest lookup — fail early if no active manifest yet (cold boot).
      const chunkInfo = await getActiveStationChunk(lang, chunk);
      if (!chunkInfo) {
        // Distinguish: do we have ANY manifest at all? If yes, this chunk is
        // permanently retired -> 410. If no manifest at all, manifest is still
        // building -> 503.
        const manifest = await getActiveManifest('stations', lang);
        if (manifest) {
          return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
        }
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Retry-After', '120');
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(503).send('Manifest building — retry shortly');
      }

      // Keep operational writes as cache invalidators, not public content dates.
      // Station.updatedAt also changes on health checks; there is no separate
      // editorial timestamp yet. v6 also versions the CSS processing instruction;
      // directory identity exclusions and owned image URLs remain unchanged.
      const cacheKey = `sitemap:stations:xml-v6-css-az-safe-owned-images:${lang}:${chunk}:${state.hash}:${chunkInfo.version}:${chunkInfo.maxUpdatedAt instanceof Date ? chunkInfo.maxUpdatedAt.getTime() : 0}`;
      if (await sendCachedSitemap304(req, res, cacheKey, childCacheControl)) return;
      const cached = await readCachedStationSitemapXml(cacheKey);
      if (cached) {
        return sendSitemapXml(req, res, cached, childCacheControl);
      }

      const baseUrl = getBaseUrl(req);
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();
      const { getIndexableLanguagesForStation } = await import('../seo/junk-station-rules');

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`);

      let stationCount = 0;
      for (let offset = 0; offset < chunkInfo.stationIds.length; offset += SITEMAP_STATION_READ_BATCH_SIZE) {
        const batchIds = chunkInfo.stationIds.slice(offset, offset + SITEMAP_STATION_READ_BATCH_SIZE).map(String);
        const stationDocs = await pgSitemapStationBatch(batchIds);
        // SQL ANY does not promise input ordering; retain the manifest's
        // deterministic order while keeping only one bounded batch of rows.
        const byId = new Map(stationDocs.map((station) => [String(station._id), station]));
      for (const objId of batchIds) {
        const station = byId.get(String(objId));
        if (!station || !station.slug) continue; // station deleted between build and serve — skip
        if (AZ_KEY_RE.test(station.slug.toLowerCase())) continue;

        // Defensive double-check: re-run the indexability gate at serve time
        // so a freshly-flagged junk/noIndex station never leaks into XML.
        const indexable = getIndexableLanguagesForStation(station as any, qualifiedLanguages, station.completeDescriptionLanguages);
        if (!indexable.includes(lang)) continue;

        stationCount++;
        const stationPath = `/station/${station.slug}`;
        const localizedPath = buildLocalizedUrl(stationPath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;
        parts.push(`
  <url>
    <loc>${escapeXml(fullUrl)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>`);

        // Real owned logos or the same favicon proxy used by the visible SSR
        // image. Never substitute a shared no-image placeholder.
        const stationImg = pickStationImage(station, baseUrl);
        if (stationImg) {
          const logoWord = LOCALIZED_LOGO_WORD[lang] || 'logo';
          const radioStationWord = LOCALIZED_RADIO_STATION_WORD[lang] || 'radio station';
          const imgTitle = station.name ? `${station.name} ${logoWord}` : `${radioStationWord} ${logoWord}`;
          const imgCaption = station.name && station.country
            ? `${station.name} — ${station.country} ${radioStationWord} ${logoWord}`
            : (station.name || `${radioStationWord} ${logoWord}`);
          parts.push(`
    <image:image>
      <image:loc>${escapeXml(stationImg)}</image:loc>
      <image:title>${escapeXml(imgTitle)}</image:title>
      <image:caption>${escapeXml(imgCaption)}</image:caption>
    </image:image>`);
        }

        for (const altLang of indexable) {
          const altPath = buildLocalizedUrl(stationPath, altLang, undefined, urlTranslations);
          parts.push(`
${buildHreflangLinks(altLang, baseUrl + altPath).slice(1)}`);
        }
        const enPath = buildLocalizedUrl(stationPath, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl + enPath)}"/>
  </url>`);
      }
      }
      if (stationCount === 0) {
        send503EmptySitemapIndex(res);
        return;
      }
      parts.push(`
</urlset>`);
      const xml = parts.join('');

      const sitemap = cacheSitemapXml(xml);
      await storeStationSitemapXml(cacheKey, sitemap, SITEMAP_CONFIG.childCacheTtlSeconds);
      sendSitemapXml(req, res, sitemap, childCacheControl);

      logger.log(`✅ sitemap-stations-${lang}-${chunk}.xml (${stationCount}/${chunkInfo.stationIds.length}) ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error(`❌ Error generating sitemap-stations-${lang}-${chunk}.xml:`, error);
      res.setHeader('Retry-After', '120');
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).send('Sitemap temporarily unavailable — retry shortly');
    }
  });

  // Language-specific genre sitemap route
  // Genres sitemap — manifest-driven (refactored 2026-04-30)
  app.get("/sitemap-genres-:lang.xml", async (req, res) => {
    const startTime = Date.now();
    const lang = req.params.lang;
    const childCacheControl = `public, max-age=${SITEMAP_CONFIG.childCacheTtlSeconds}, s-maxage=${SITEMAP_CONFIG.childCacheTtlSeconds}, stale-while-revalidate=${SITEMAP_CONFIG.childStaleWhileRevalidateSec}`;

    try {
      let state;
      try { state = await getQualifiedLanguagesState(); }
      catch (err) {
        if (err instanceof QualifiedLanguagesUnavailableError) return send503QualifiedLangs(res, `sitemap-genres-${lang}`);
        throw err;
      }
      const qualifiedLanguages = state.languages;
      if (!qualifiedLanguages.includes(lang)) {
        return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
      }

      const manifest = await getActiveManifest('genres', lang);
      if (!manifest) {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Retry-After', '120');
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(503).send('Manifest building — retry shortly');
      }

      // Nightly station-count refreshes also advance Genre.updatedAt. Until
      // editorial dates exist, v3 excludes those operational dates from XML.
      const cacheKey = `sitemap:genres:xml-v4-css:${lang}:${state.hash}:${manifest.version}:${manifest.maxUpdatedAt instanceof Date ? manifest.maxUpdatedAt.getTime() : 0}`;
      if (await sendCachedSitemap304(req, res, cacheKey, childCacheControl)) return;
      const cached = await CacheManager.get<CachedSitemapXml>(cacheKey);
      if (cached) {
        return sendSitemapXml(req, res, cached, childCacheControl);
      }

      const baseUrl = getBaseUrl(req);
      const { forwardMap: urlTranslations } = await ensureUrlTranslationsLoaded();

      const genreIds = manifest.chunks.flatMap((c) => c.stationIds);
      const genreDocs = genreIds.length > 0 ? await pgSeoGenres(genreIds) : [];
      const genreById = new Map<string, any>();
      for (const g of genreDocs) genreById.set(String((g as any)._id), g);

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`);

      let genreCount = 0;
      // Task #102: Some legacy Genre.slug values were derived directly from
      // station tag strings and contain XML-unsafe characters (notably `"`),
      // producing malformed <loc> entries like `/en/genres/bassline"/>` that
      // Google indexed as soft-404 thin pages. Restrict slugs to the safe
      // URL/SEO charset (lowercase letters, digits, dash) before emitting.
      // escapeXml(fullUrl) below remains as defense-in-depth.
      const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      for (const objId of genreIds) {
        const genre = genreById.get(String(objId));
        if (!genre || !genre.slug) continue;
        if (!SAFE_SLUG_RE.test(String(genre.slug))) continue;
        genreCount++;
        const genrePath = `/genres/${genre.slug}`;
        const localizedPath = buildLocalizedUrl(genrePath, lang, undefined, urlTranslations);
        const fullUrl = `${baseUrl}${localizedPath}`;

        parts.push(`
  <url>
    <loc>${escapeXml(fullUrl)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>`);

        for (const altLang of qualifiedLanguages) {
          const altPath = buildLocalizedUrl(genrePath, altLang, undefined, urlTranslations);
          parts.push(`
${buildHreflangLinks(altLang, baseUrl + altPath).slice(1)}`);
        }
        const enPath = buildLocalizedUrl(genrePath, 'en', undefined, urlTranslations);
        parts.push(`
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(baseUrl + enPath)}"/>
  </url>`);
      }
      if (genreCount === 0) {
        send503EmptySitemapIndex(res);
        return;
      }
      parts.push(`
</urlset>`);
      const xml = parts.join('');

      const sitemap = cacheSitemapXml(xml);
      await storeSitemapXml(cacheKey, sitemap);
      sendSitemapXml(req, res, sitemap, childCacheControl);

      logger.log(`✅ sitemap-genres-${lang}.xml (${genreCount}) ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error(`❌ Error generating sitemap-genres-${lang}.xml:`, error);
      res.setHeader('Retry-After', '120');
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).send('Sitemap temporarily unavailable — retry shortly');
    }
  });

  // sitemap-main.xml: Redirect to the English language-specific sitemap.
  app.get("/sitemap-main.xml", (req, res) => {
    const baseUrl = getBaseUrl(req);
    res.redirect(301, `${baseUrl}/sitemap-main-en.xml`);
  });

  // 410 Gone for deprecated/removed sitemaps — prevents "soft 404" from SPA catch-all
  app.get("/sitemap-news.xml", (_req, res) => {
    sendSitemapGone(res);
  });
  app.get("/sitemap-videos.xml", (_req, res) => {
    sendSitemapGone(res);
  });
  app.get("/sitemap-images-:i.xml", (_req, res) => {
    sendSitemapGone(res);
  });
  // DALGA 1 W1.2: digit'siz /sitemap-images.xml de SPA fallback yerine 410 dönmeli;
  // aksi halde Google bunu geçerli sitemap sanıp parse hatası / soft-404 raporluyor.
  app.get("/sitemap-images.xml", (_req, res) => {
    sendSitemapGone(res);
  });
  app.get(/^\/sitemap-stations-(\d+)\.xml$/, (_req, res) => {
    sendSitemapGone(res);
  });


  // Sitemap Index — single entry point for Google to discover all sitemaps.
  // References ONLY routes that exist and return valid XML.
  // Architecture:
  //   sitemap-main-{lang}.xml    → main pages per language (home, genres, regions, etc.)
  //   sitemap-genres-{lang}.xml  → genre pages per language
  //   sitemap-stations-{lang}-{chunk}.xml → station pages per language, paginated
  // Sitemap-index — manifest-driven (refactored 2026-04-30)
  // Reads active PostgreSQL manifests and emits only nonempty child sitemaps.
  // Operational manifest dates are not content dates; only the editorial
  // blog sitemap has a trustworthy lastmod.
  //
  // Cache: 600s (indexCacheTtlSeconds) — short so manifest swaps propagate
  // through Cloudflare within ~10min instead of 24h.
  // Task #128: /sitemap.xml is Google's default probe path. Serve the same
  // sitemap-index XML directly (rather than 301) so the response satisfies
  // GSC's strict "must be a sitemap document" check on the literal URL.
  app.get(["/sitemap-index.xml", "/sitemap.xml"], async (req, res) => {
    const indexCacheControl = `public, max-age=${SITEMAP_CONFIG.indexCacheTtlSeconds}, s-maxage=${SITEMAP_CONFIG.indexCacheTtlSeconds}`;

    try {
      const baseUrl = getBaseUrl(req);

      let state;
      try { state = await getQualifiedLanguagesState(); }
      catch (err) {
        if (err instanceof QualifiedLanguagesUnavailableError) return send503QualifiedLangs(res, 'sitemap-index');
        throw err;
      }
      const qualifiedLanguages = state.languages;

      // Fetch active manifests for all qualified langs, all 3 types.
      const allActiveManifests = (await pgActiveManifests())
        .filter(row => qualifiedLanguages.includes(row.language));

      // If no manifests at all, manifest-builder hasn't run yet (cold boot).
      if (allActiveManifests.length === 0) {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Retry-After', '120');
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(503).send('Sitemap manifest building — retry shortly');
      }

      // Each child reads its own active manifest, regardless of cohort hash.
      // Keep all those serving snapshots during the per-language rolling swap.
      // Filtering to the first new hash used to hide every unfinished locale.
      const manifests = allActiveManifests;
      if (!hasCompleteManifestCoverage(manifests, qualifiedLanguages) || !hasPublishableSitemapChildren(manifests)) {
        send503EmptySitemapIndex(res);
        return;
      }

      const manifestByKey = new Map(manifests.map(m => [`${m.type}:${m.language}`, m]));

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);

      const emitEntry = (loc: string, lastmod?: string) => {
        parts.push(`
  <sitemap>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
  </sitemap>`);
      };

      emitEntry(`${baseUrl}/sitemap-blog.xml`, BLOG_SITEMAP_UPDATED);
      // Pilot station reads must not add a failure to the main index.
      if (qualifiedLanguages.includes('en')) {
        for (const country of ['at', 'tr']) emitEntry(`${baseUrl}/sitemap-pilot-en-${country}.xml`);
      }

      // 1. Main sitemaps (one per qualified lang, only if manifest exists)
      for (const lang of qualifiedLanguages) {
        const m = manifestByKey.get(`main:${lang}`);
        if (!m || m.chunkCount === 0) continue;
        emitEntry(`${baseUrl}/sitemap-main-${lang}.xml`);
      }

      // 2. Genres sitemaps
      for (const lang of qualifiedLanguages) {
        const m = manifestByKey.get(`genres:${lang}`);
        if (!m || m.chunkCount === 0) continue;
        emitEntry(`${baseUrl}/sitemap-genres-${lang}.xml`);
      }

      // 3. Station sitemaps — emit ONLY existing chunks per language (no
      // global Math.ceil). Sparse languages emit 0-3 chunks instead of 50.
      //
      // Task #344 guard: chunk numbers MUST be 1-based positive integers ≤ 9999
      // because the per-chunk route's `:chunk` regex (`[1-9]\d{0,3}`) responds
      // with 410 Gone for anything outside that range. If a manifest writer
      // ever regresses to 0-based numbering (or stores a negative / 5-digit
      // value), advertising it here would tell Google to fetch a URL that
      // immediately 410s, silently dropping the entire chunk's stations from
      // the index. Skip-and-warn instead so the index stays consistent with
      // what the per-chunk route can actually serve.
      let totalChildSitemaps = 0;
      for (const lang of qualifiedLanguages) {
        const m = manifestByKey.get(`stations:${lang}`);
        if (!m || !Array.isArray(m.chunks) || m.chunks.length === 0) continue;
        for (const chunk of m.chunks) {
          if (!chunk || chunk.urlCount === 0) continue;
          if (
            !Number.isInteger(chunk.chunk) ||
            chunk.chunk < 1 ||
            chunk.chunk > 9999
          ) {
            logger.error(
              `🔴 sitemap-index: refusing to advertise station chunk lang=${lang} chunk=${chunk.chunk} ` +
              `(must be 1..9999 to match the per-chunk route regex; would otherwise serve 410 Gone)`,
            );
            continue;
          }
          // Station chunks have no trustworthy content-update date either.
          emitEntry(`${baseUrl}/sitemap-stations-${lang}-${chunk.chunk}.xml`);
          totalChildSitemaps++;
        }
      }
      parts.push(`
</sitemapindex>`);
      const xml = parts.join('');

      sendSitemapXml(req, res, cacheSitemapXml(xml), indexCacheControl);

      logger.log(`✅ sitemap-index.xml: ${qualifiedLanguages.length} langs, ${totalChildSitemaps} station chunks, ${manifests.length} total entries`);
    } catch (error) {
      console.error('❌ Error generating sitemap index:', error);
      res.setHeader('Retry-After', '120');
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).send('Sitemap temporarily unavailable — retry shortly');
    }
  });

  // ── Per-language sitemap index (GSC submission endpoint) ─────────────────
  // /sitemap-en.xml, /sitemap-tr.xml, … → one sitemapindex per language.
  // Users submit these directly to Google Search Console so each language's
  // crawl budget is tracked independently. Contains main + genres + all
  // station chunk sitemaps for a single language.
  //
  // Must be registered LAST so all specific routes above are tried first
  // (e.g. /sitemap-index.xml, /sitemap-main-en.xml, /sitemap-news.xml …).
  const UNIVERSAL14_SET = new Set(ACTIVE_SITEMAP_LANGUAGES as readonly string[]);
  app.get("/sitemap-:lang.xml", async (req, res) => {
    const lang = (req.params.lang || '').toLowerCase();

    // Only serve the 14 universal languages; anything else (e.g. "index",
    // "news", "images") should have been caught by a more-specific route
    // above but gets 410 here as a safe fallback.
    if (!UNIVERSAL14_SET.has(lang)) {
      return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
    }

    const cacheControl = `public, max-age=${SITEMAP_CONFIG.indexCacheTtlSeconds}, s-maxage=${SITEMAP_CONFIG.indexCacheTtlSeconds}`;

    try {
      const baseUrl = getBaseUrl(req);

      let state;
      try { state = await getQualifiedLanguagesState(); }
      catch (err) {
        if (err instanceof QualifiedLanguagesUnavailableError) return send503QualifiedLangs(res, `sitemap-${lang}`);
        throw err;
      }
      if (!state.languages.includes(lang)) {
        return sendSitemapGone(res, SITEMAP_CONFIG.indexCacheTtlSeconds);
      }

      const langManifests = (await pgActiveManifests()).filter(row => row.language === lang);

      if (langManifests.length === 0) {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Retry-After', '120');
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(503).send('Sitemap manifest building — retry shortly');
      }
      if (!hasCompleteManifestCoverage(langManifests, [lang]) || !hasPublishableSitemapChildren(langManifests)) {
        send503EmptySitemapIndex(res);
        return;
      }

      const byType = new Map(langManifests.map(m => [m.type, m]));

      const parts: string[] = [];
      parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);

      const emitLangEntry = (loc: string, lastmod?: string) => {
        parts.push(`
  <sitemap>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
  </sitemap>`);
      };

      if (lang === 'en') {
        for (const country of ['at', 'tr']) emitLangEntry(`${baseUrl}/sitemap-pilot-en-${country}.xml`);
      }

      // 1. Main pages (homepage, genres, regions, countries)
      const mainM = byType.get('main');
      if (mainM && mainM.chunkCount > 0) {
        emitLangEntry(`${baseUrl}/sitemap-main-${lang}.xml`);
      }

      // 2. Genre pages
      const genresM = byType.get('genres');
      if (genresM && genresM.chunkCount > 0) {
        emitLangEntry(`${baseUrl}/sitemap-genres-${lang}.xml`);
      }

      // 3. Station chunks (paginated)
      const stationsM = byType.get('stations');
      if (stationsM && Array.isArray(stationsM.chunks)) {
        for (const chunk of stationsM.chunks) {
          if (!chunk || chunk.urlCount === 0) continue;
          if (
            !Number.isInteger(chunk.chunk) ||
            chunk.chunk < 1 ||
            chunk.chunk > 9999
          ) continue;
          emitLangEntry(
            `${baseUrl}/sitemap-stations-${lang}-${chunk.chunk}.xml`,
          );
        }
      }

      parts.push(`
</sitemapindex>`);
      const xml = parts.join('');

      sendSitemapXml(req, res, cacheSitemapXml(xml), cacheControl);

      logger.log(`✅ sitemap-${lang}.xml: main=${!!(mainM?.chunkCount > 0)} genres=${!!(genresM?.chunkCount > 0)} stationChunks=${stationsM?.chunks?.length ?? 0}`);
    } catch (error) {
      logger.error(`❌ Error generating sitemap-${lang}.xml:`, error);
      res.setHeader('Retry-After', '120');
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).send('Sitemap temporarily unavailable — retry shortly');
    }
  });
}
