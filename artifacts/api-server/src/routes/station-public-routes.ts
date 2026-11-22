import type { Express } from "express";
import { stripPlaceholders, tvValidateParams, tvSlimStation } from './shared-utils';
import { normalizeCountryFilter, resolveToDbName } from '../utils/normalize-country';
import { publicStationCache as CacheManager } from '../public-station-cache';
import { publicStationResponseCache } from '../middleware/public-station-cache';
import { logger } from '../utils/logger';
import { withPilotEditorial } from '../seo/indexing-pilot';
import { stationDetailCacheKey } from '../services/station-detail-cache';





import { slugifyStationName, evaluateJunkStation } from '../seo/junk-station-rules';
import {
  getStationByIdentifier,
  getGeoStationsFromPostgres,
  getNearbyStationsFromPostgres,
  getPopularStationsFromPostgres,
  getRandomCountryStationFromPostgres,
  getRelatedStationsFromPostgres,
  getStationStatsFromPostgres,
  listStationsFromPostgres,
  stationSlugExists,
  updateStationDerivedFields,
} from '../data/station-read-store';

function escapeRegex(input: any, maxLen: number = 80): string {
  if (typeof input !== 'string') return '';
  const s = input.length > maxLen ? input.slice(0, maxLen) : input;
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nearbyCacheKey(query: Record<string, any>): string | null {
  if (!query.lat || !query.lng) return null;
  return `nearby:v2:${JSON.stringify([
    Math.round(parseFloat(query.lat)*100)/100,Math.round(parseFloat(query.lng)*100)/100,
    parseFloat(query.radius ?? '100'),query.country && query.country!=='all' ? String(query.country) : 'global',
    query.excludeBroken ?? 'false',Number(query.limit ?? 12),String(query.userCountry || ''),query.slim==='1',
  ])}`;
}

// Sanitise a raw user string for use in MongoDB $text search.
// $text tokenises on whitespace/punctuation and ignores most special chars,
// so we only strip characters that break the parser ($, ", \).
function sanitiseForTextSearch(term: string): string {
  return term.replace(/[$"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

// Helper: generate unique slug inline
async function generateUniqueSlug(name: string, type: string, id: string): Promise<string> {
  const base = slugifyStationName(name);
  let slug = base || id;
  let counter = 0;
  while (true) {
    const candidate = counter === 0 ? slug : `${slug}-${counter}`;
    if (!(await stationSlugExists(candidate, id))) return candidate;
    counter++;
  }
}

export function registerPublicStationRoutes(app: Express, deps: any) {
  app.use(['/api/station','/api/stations'], publicStationResponseCache);
  const { requireAdmin } = deps;

  // SINGLE STATION BY SLUG OR ID - Used by all station detail pages
  app.get("/api/station/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;

      const cacheKey = stationDetailCacheKey(identifier);
      const cached = await CacheManager.get(cacheKey);
      if (cached) return void res.json(cached);

      const station: any = await getStationByIdentifier(identifier);

      if (!station) {
        return void res.status(404).json({ error: 'Station not found' });
      }

      if (!station.slug) {
        const newSlug = await generateUniqueSlug(station.name, 'station', station._id.toString());
        // Re-evaluate actual test-feed rules against the persisted slug.
        const update: { slug: string; noIndex?: true } = { slug: newSlug };
        const verdict = evaluateJunkStation({
          stationPageMode: station.stationPageMode,
          name: station.name,
          slug: newSlug,
          url: station.url,
          homepage: station.homepage,
          tags: station.tags,
          bitrate: station.bitrate,
          lastCheckOk: station.lastCheckOk,
          lastCheckOkTime: station.lastCheckOkTime,
          lastCheckTime: station.lastCheckTime,
        });
        if (verdict.isJunk && station.noIndex !== true) {
          update.noIndex = true;
          station.noIndex = true;
        }
        await updateStationDerivedFields(String(station._id), update);
        station.slug = newSlug;
      }

      const result = withPilotEditorial(stripPlaceholders(station));
      const { manualEditFields: _manualEditFields, ...publicResult } = result;
      await CacheManager.set(cacheKey, publicResult, { ttl: 60 });
      res.json(publicResult);
    } catch (error: any) {
      logger.error(`❌ /api/station/:identifier failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try { stale = await CacheManager.get(stationDetailCacheKey(req.params.identifier)); } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // POPULAR STATIONS API - With duplicate detection and icon-only filtering
  app.get("/api/stations/popular", async (req, res) => {
    const { country, state, limit = 12, excludeBroken = 'false' } = req.query;
    const isTV = req.query.tv === '1';
    const compact = req.query.slim === '1';
    const resolvedCountry = resolveToDbName(country as string) || (country as string) || 'all';
    const normalizedState = (state as string) || 'all';
    const cacheKey = `popular_stations:${resolvedCountry}:${normalizedState}:${limit}:${excludeBroken}:${isTV ? 'tv' : 'web'}:${compact ? 'compact' : 'full'}:v3`;
    const popularRequestStart = Date.now();
    try {
      {
        const stations = await CacheManager.getOrSetSWR<any[]>(cacheKey, () =>
          getPopularStationsFromPostgres({
            country: country && !['all', 'null', 'undefined'].includes(String(country)) ? resolvedCountry : undefined,
            state: state && !['all', 'null', 'undefined'].includes(String(state)) ? String(state) : undefined,
            limit: Number(limit),
            requireLogo: isTV,
            compact,
          }),
          { freshTtl: 3600, staleTtl: 21600 },
        );
        res.set('Cache-Control', 'public, max-age=0, s-maxage=0, must-revalidate');
        return void res.json(isTV ? stations.map(tvSlimStation) : stripPlaceholders(stations));
      }
      // INCIDENT 2026-05-15 v10 — wrapped compute in single-flight so 100
      // concurrent cold misses (typical SSR fanout when CDN expires the
      // homepage) coalesce into one database query. Previously each
      // miss spawned its own pair of aggregates, draining the M10 pool.
      // INCIDENT 2026-05-15 v10.2 — upgraded to true SWR (1h fresh /
      // 6h stale) so a stressed cluster keeps serving last-known-good
      // popular stations during refresh windows instead of waiting
      // 5-15s on the aggregate.
      
    } catch (error: any) {
      // SOFT-FAIL (2026-05-15 v10): never 500 a public read endpoint.
      // SWR fallback: try the cache key one last time — a parallel
      // request may have populated it before we threw. If still empty,
      // serve []. Use no-store so the failure response is NEVER cached
      // by the CDN/browser (a stale empty would lock users out for
      // minutes after the cluster recovers).
      logger.error(
        `❌ /api/stations/popular failed (country=${req.query.country || 'all'}, limit=${req.query.limit || '?'}): ` +
        `code=${error?.code || error?.codeName || 'unknown'} msg=${error?.message || error}`
      );
      // INCIDENT 2026-05-15 v10.2 — read SWR envelope (`<key>:swr`),
      // not the dead base key, so we actually surface last-known-good.
      let stale: any = null;
      try { stale = await CacheManager.getSWR(cacheKey); } catch {}
      res.set('Cache-Control', 'no-store');
      // Apply the same response shaping as the success path so the
      // payload contract is identical on stale fallback (TV gets slim
      // shape; web strips placeholder logos).
      if (!Array.isArray(stale)) return void res.status(503).json({ error: 'Station data is temporarily unavailable' });
      res.set('X-Data-Stale', 'true');
      const staleArr: any[] = stale;
      if (isTV) {
        return void res.json(staleArr.map(tvSlimStation));
      }
      res.json(stripPlaceholders(staleArr));
    }
  });

  // STATIONS WITH GEO COORDINATES API
  app.get("/api/stations/with-geo", async (req, res) => {
    try {
      // Hard-cap limit to prevent memory spikes (40k+ stations)
      const WITH_GEO_MAX_LIMIT = 5000;
      const WITH_GEO_DEFAULT = 1000;
      const rawLimit = parseInt((req.query.limit as string) || String(WITH_GEO_DEFAULT), 10);
      const safeLimit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : WITH_GEO_DEFAULT,
        WITH_GEO_MAX_LIMIT
      );
      // Cache key uses the clamped value so attackers can't pollute cache with arbitrary limits
      const cacheKey = `stations:with_geo:${safeLimit}`;
      const cached = await CacheManager.get(cacheKey);
      if (cached) return void res.json(cached);

      {
        const result = stripPlaceholders(await getGeoStationsFromPostgres(safeLimit));
        await CacheManager.set(cacheKey, result, { ttl: 1800 });
        return void res.json(result);
      }

      
    } catch (error: any) {
      logger.error(`❌ /api/stations/with-geo failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try {
        const rawLimit = parseInt((req.query.limit as string) || '1000', 10);
        const safeLimit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 1000, 5000);
        stale = await CacheManager.get(`stations:with_geo:${safeLimit}`);
      } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // NEARBY STATIONS API - GPS-based proximity detection
  app.get("/api/stations/nearby", async (req, res) => {
    try {
      const { lat, lng, radius = 100, limit = 12, country, excludeBroken = 'false', userCountry } = req.query;
      
      const cacheKey = nearbyCacheKey(req.query);
      if (cacheKey) {
        const cachedResult = await CacheManager.get(cacheKey);
        if (cachedResult) {
          return void res.json(stripPlaceholders(cachedResult));
        }
      }
      
      let filter: any = {};
      let stations: any[] = [];

      {
        stations = await getNearbyStationsFromPostgres({
          latitude: lat ? parseFloat(lat as string) : undefined,
          longitude: lng ? parseFloat(lng as string) : undefined,
          radiusKm: parseFloat(radius as string),
          limit: Number(limit),
          country: country && !['all', 'null', 'undefined'].includes(String(country))
            ? (resolveToDbName(country as string) || String(country)) : undefined,
          excludeBroken: excludeBroken === 'true',
          userCountry: userCountry ? String(userCountry) : undefined,
          compact: req.query.slim === '1',
        });
        if (cacheKey && stations.length > 0) {
          await CacheManager.set(cacheKey, stations, { ttl: 1800 });
        }
        return void res.json(stripPlaceholders(stations));
      }


    } catch (error: any) {
      logger.error(`❌ /api/stations/nearby failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try {
        const key = nearbyCacheKey(req.query);
        if (key) stale = await CacheManager.get(key);
      } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // STATION STATISTICS API - Shows breakdown of working vs broken stations
  app.get("/api/stations/stats", async (req, res) => {
    try {
      const cacheKey = 'station_stats';
      const cachedStats = await CacheManager.get(cacheKey);
      if (cachedStats) {
        return void res.json(cachedStats);
      }
      {
        const result = await getStationStatsFromPostgres();
        await CacheManager.set(cacheKey, result, { ttl: 1800 });
        return void res.json(result);
      }
      
      
    } catch (error: any) {
      logger.error(`❌ /api/stations/stats failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try { stale = await CacheManager.get('station_stats'); } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // SIMILAR STATIONS API
  app.get("/api/stations/similar/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const limitNum = Math.min(Math.max(Number(req.query.limit ?? 6), 1), 20);
      const cacheKey = `similar_stations:${id}:${limitNum}`;

      // Single-flight: concurrent cold-misses for the same station coalesce
      // into one DB call instead of spawning N parallel RecommendationEngine runs.
      const result = await CacheManager.getOrSetSingleFlight<any[] | null>(cacheKey, async () => {
        {
          return getRelatedStationsFromPostgres(id, limitNum);
        }

      }, { ttl: 3600 });

      if (result === null) return void res.status(404).json({ error: 'Station not found' });

      // Let the Tizen app / CDN cache the response — similar stations change rarely.
      res.set('Cache-Control', 'public, max-age=0, s-maxage=0, must-revalidate');
      res.json(stripPlaceholders(result));
    } catch (error: any) {
      logger.error(`❌ /api/stations/similar/:id failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try {
        stale = await CacheManager.get(`similar_stations:${req.params.id}:${Math.min(Math.max(Number(req.query.limit ?? 6), 1), 20)}`);
      } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // RANDOM COUNTRY STATION
  app.get("/api/stations/country-random", async (req, res) => {
    try {
      const { country } = req.query;
      if (!country) return void res.status(400).json({ error: 'Country parameter is required' });

      const filter = normalizeCountryFilter(country as string);
      {
        const station = await getRandomCountryStationFromPostgres(
          resolveToDbName(country as string) || String(country),
        );
        if (!station) return void res.status(404).json({ error: 'No stations found for this country' });
        return void res.json(stripPlaceholders(station));
      }

    } catch (error: any) {
      logger.error(`❌ /api/stations/country-random failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // PostgreSQL station browsing. Compact cards have a bounded 60-second cache;
  // full responses keep their existing live contract for external clients.
  app.get("/api/stations/precomputed", async (req, res) => {
    try {
      const { countryCode, countryName, page = '1', limit = '33', genre, language, search, hasLogo, codec, bitrate, sort } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(parseInt(limit as string) || 33, 500);

      const identifier = (countryName as string) || (countryCode as string);
      const isGlobal = !identifier || identifier === 'global' || identifier === 'all';
      const compact = req.query.slim === '1';

      {
        const listOptions = {
          country: isGlobal ? undefined : (
            resolveToDbName(((countryName as string) || (countryCode as string))) ||
            (countryName as string) || (countryCode as string)
          ),
          genre: genre as string | undefined,
          language: language as string | undefined,
          search: search as string | undefined,
          page: pageNum,
          limit: limitNum,
          sort: sort as string | undefined,
          hasLogo: hasLogo === 'true' ? true : hasLogo === 'false' ? false : undefined,
          codec: typeof codec === 'string' ? codec : undefined,
          minBitrate: bitrate ? parseInt(String(bitrate)) : undefined,
          compact,
        };
        // Public card pages only: coalesce concurrent visitors and retain the
        // small read for one minute. Details/full API responses remain live.
        const pgResult = compact
          ? await CacheManager.getOrSetSingleFlight(
            `stations:cards:sort-v2:${search ? 'search-v2' : 'v1'}:${JSON.stringify(listOptions)}`,
            () => listStationsFromPostgres(listOptions), { ttl: 60 })
          : await listStationsFromPostgres(listOptions);
        const stations = pgResult.stations;
        return void res.json({
          success: true, data: stations, stations, total: pgResult.totalCount,
          count: pgResult.totalCount, page: pageNum,
          totalPages: pgResult.pagination.pages, cached: false,
          pagination: pgResult.pagination,
        });
      }

    } catch (error: any) {
      // INCIDENT 2026-05-14 round 8: this catch was emitting `logger.error`
      // (with full stack trace) once per failed request — during the failover
      // storm it printed 200+ stack traces in 10 minutes. Downgrade to a
      // single-line warn + return an empty payload so a transient cluster
      // blip degrades gracefully instead of looking like an outage in logs.
      // INCIDENT 2026-05-15 v10.2 — structured code/codeName + no-store
      // on the failure response so a transient cluster blip doesn't
      // get cached as an empty payload by upstream CDN.
      logger.warn(`[/api/stations/precomputed] failed: code=${error?.code || 'unknown'} codeName=${error?.codeName || 'unknown'} msg=${error?.message || 'unknown'}`);
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ success: false, error: 'Station data is temporarily unavailable' });
    }
  });

  app.get("/api/now-playing/:id", async (req, res) => {
    // A last known song is not a cacheable document. Native/browser caches
    // must revalidate against the active upstream observation, including errors.
    res.set('Cache-Control', 'no-store');
    try {
      const { id } = req.params;

      const station = (await getStationByIdentifier(id));

      if (!station) {
        return void res.status(404).json({ error: 'Station not found' });
      }

      const streamUrl = station.urlResolved || station.url;
      if (!streamUrl) {
        return void res.json({ title: '', artist: '', station: station.name });
      }

      const { getStreamMetadataService } = await import('../services/stream-metadata');
      const metadataService = getStreamMetadataService();
      const metadata = await metadataService.getStationMetadata(station);

      res.json({
        title: metadata.title || '',
        artist: metadata.artist || '',
        station: metadata.station || station.name,
        genre: metadata.genre || '',
        observedAt: metadata.observedAt ?? null,
        titleChangedAt: metadata.titleChangedAt ?? null,
        metadataSource: metadata.observedAt ? 'stream-icy' : null,
      });
    } catch (error: any) {
      if (error?.message !== 'metadata-unavailable') {
        console.error('Error fetching now-playing:', error?.message || error);
      }
      res.json({
        title: '',
        artist: '',
        station: '',
        genre: ''
      });
    }
  });

  // LINKED STATIONS - Related stations for station detail page
  app.get("/api/stations/:stationId/linked", async (req, res) => {
    const { stationId } = req.params;
    const compact = req.query.slim === '1';
    const cacheKey = `stations:linked:${compact ? 'cards-v1:' : ''}${stationId}`;
    try {
      const cached = await CacheManager.get(cacheKey);
      if (cached) return void res.json(cached);

      {
        const linked = await getRelatedStationsFromPostgres(stationId, 12, compact);
        if (linked === null) return void res.status(404).json({ error: 'Station not found' });
        const result = { stations: linked };
        await CacheManager.set(cacheKey, result, { ttl: 1800 });
        return void res.json(result);
      }


    } catch (error: any) {
      logger.error(`❌ /api/stations/:stationId/linked failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      try { stale = await CacheManager.get(cacheKey); } catch {}
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });

  // MAIN STATIONS LIST API - Full filter/sort/search/pagination
  app.get("/api/stations", async (req, res) => {
    const isTV = req.query.tv === '1';
    // Existing API/admin clients keep full records; card-only consumers opt in.
    const compact = req.query.slim === '1';
    const {
      country,
      state,
      genre,
      tags,
      language,
      search,
      sort = 'votes',
      order = 'desc',
      excludeBroken = 'false',
      excludeStationIds = '',
      minVotes = 0,
      timePeriod = 'all'
    } = req.query;

    const safeParams = isTV ? tvValidateParams(req.query) : {
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 25
    };
    const { page, limit } = safeParams;

    const webCacheKey = !search && !excludeStationIds
      ? `stations:list:sort-v2:${country || 'all'}:${state || 'all'}:${genre || 'all'}:${tags || 'all'}:${language || 'all'}:${sort}:${page}:${limit}:${excludeBroken}:${minVotes}:${timePeriod}:${isTV ? 'tv' : 'web'}${compact ? ':cards:v1' : ''}`
      : null;

    // Country-only LKG cache key — last successful payload for this
    // country regardless of filter/sort/page. Used as second-tier
    // fallback in the catch block when the exact webCacheKey is cold.

    const computeStationsList = async () => {
      {
        let createdAfter: Date | undefined;
        if (timePeriod && timePeriod !== 'all') {
          const milliseconds = timePeriod === '24h' ? 86400000 : timePeriod === '7d' ? 604800000 : timePeriod === '30d' ? 2592000000 : 0;
          if (milliseconds) createdAfter = new Date(Date.now() - milliseconds);
        }
        return listStationsFromPostgres({
          country: country && country !== 'all' ? (resolveToDbName(country as string) || String(country)) : undefined,
          state: state && state !== 'all' ? String(state) : undefined,
          genre: genre && genre !== 'all' ? String(genre) : undefined,
          tags: tags && tags !== 'all' ? String(tags) : undefined,
          language: language && language !== 'all' ? String(language) : undefined,
          search: search ? String(search).trim() : undefined,
          sort: String(sort), excludeBroken: excludeBroken === 'true',
          excludeIds: typeof excludeStationIds === 'string' ? excludeStationIds.split(',').map((value) => value.trim()).filter(Boolean) : [],
          minVotes: Number(minVotes) || 0, createdAfter, page: Number(page), limit: Number(limit),
          compact,
        });
      }

    };

    try {
      // INCIDENT 2026-05-16 v11 — single-flight wrap for the cacheable
      // path. When webCacheKey is set (no search, no excludeStationIds),
      // 50 concurrent SSR misses on the same key coalesce to ONE
      // aggregate. The non-cacheable path (admin search, exclude lists)
      // still runs directly because the cache key is request-specific.
      const response = webCacheKey
        ? await CacheManager.getOrSetSingleFlight(webCacheKey, computeStationsList, { ttl: 300 })
        : await computeStationsList();

      res.json(response);
    } catch (error: any) {
      logger.error(`❌ /api/stations failed: code=${error?.code || 'unknown'} msg=${error?.message || error}`);
      let stale: any = null;
      // Stale fallback is ONLY used for cacheable requests (no search,
      // no excludeStationIds). For search / exclude requests, returning
      // a country-level LKG would surface unrelated stations (e.g. a
      // failed `?search=jazz` would return ALL of Germany's stations).
      // Tier 1: exact webCacheKey (may already be populated by a
      // parallel successful caller before we threw).
      // Do not renew country-level last-known-good data on every cache hit:
      // that could keep a now-unavailable station visible indefinitely.
      if (webCacheKey) {
        try { stale = await CacheManager.get(webCacheKey); } catch {}
      }
      res.set('Cache-Control', 'no-store');
      if (stale != null) { res.set('X-Data-Stale', 'true'); return void res.json(stale); }
      res.status(503).json({ error: 'Station data is temporarily unavailable' });
    }
  });
}
