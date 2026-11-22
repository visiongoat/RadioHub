import { stationSearchSql } from '../utils/station-search';
import { getPostgresPool } from "../postgres-runtime";
import { stationVisibilityFields } from '../utils/station-visibility';
import { matchesVerifiedLegacyStationTarget, verifiedLegacyStationAlias } from '../seo/verified-legacy-station-alias';

export type StationReadMode = "postgres";
export const stationReadMode: StationReadMode = "postgres";
export const isPostgresStationReadMode = (): boolean => true;

// List cards/player need these fields, not every station's 14-language SEO
// article or duplicated archival source. Detailed station reads stay full.
const CARD_COLUMNS = `id,station_uuid,name,slug,redirect_to_slug,url,url_resolved,
  homepage,favicon,country,country_code,state,language,language_codes,tags_raw,codec,
  bitrate,hls,votes,click_count,click_trend,average_rating,total_ratings,last_check_ok,
  last_check_time,is_list_visible,visibility_expires_at,availability_outcome,availability_checked_at,
  latitude,longitude,has_logo,logo_assets,is_featured,
  show_in_global_popular,no_index,created_at,updated_at`;
const CARD_SOURCE_KEYS = ['localImagePath','logo','genre','genres','sslError','mood','countrycode'];
const CARD_SELECTION = `${CARD_COLUMNS},COALESCE((SELECT jsonb_object_agg(k,source->k)
  FROM unnest(ARRAY[${CARD_SOURCE_KEYS.map(key => `'${key}'`).join(',')}]::text[]) AS k
  WHERE source ? k),'{}'::jsonb) AS source`;

const boundedInteger = (value: number, fallback: number, max: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.min(Math.trunc(value), max)) : fallback;
const containsPattern = (value: string): string => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
const genreSlug = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160);

function fromPostgres(row: Record<string, any> | undefined): any | null {
  if (!row) return null;
  return {
    ...(row.source && typeof row.source === "object" ? row.source : {}),
    _id: row.id, stationuuid: row.station_uuid, changeUuid: row.change_uuid,
    name: row.name, slug: row.slug, slugAliases: row.slug_aliases || [],
    redirectToSlug: row.redirect_to_slug, url: row.url, urlResolved: row.url_resolved,
    homepage: row.homepage, favicon: row.favicon, country: row.country,
    countryCode: row.country_code, state: row.state, language: row.language,
    languageCodes: row.language_codes, tags: row.tags_raw, codec: row.codec,
    bitrate: row.bitrate, hls: row.hls, votes: row.votes,
    clickCount: row.click_count, clickTrend: row.click_trend,
    averageRating: row.average_rating, totalRatings: row.total_ratings,
    lastCheckOk: row.last_check_ok, lastCheckTime: row.last_check_time,
    ...stationVisibilityFields(row),
    geoLat: row.latitude, geoLong: row.longitude, hasLogo: row.has_logo,
    logoAssets: row.logo_assets, descriptions: row.descriptions || {},
    manualEditFields: row.manual_edit_fields, mediaGroupId: row.media_group_id,
    isFeatured: row.is_featured, showInGlobalPopular: row.show_in_global_popular,
    noIndex: row.no_index, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function postgresStation(identifier: string, allowHistoricalRepair = true): Promise<any | null> {
  const result = await getPostgresPool().query(
    // OR-ing the unindexed alias array with slug/id makes every direct hit
    // scan the complete catalog. Retain precedence in one snapshot, but only
    // evaluate the legacy fallback when the indexed direct lookup is empty.
    `WITH direct AS MATERIALIZED (
       SELECT * FROM stations WHERE slug=$1 OR id=$1 OR station_uuid=$1
       ORDER BY CASE WHEN slug=$1 THEN 0 WHEN id=$1 THEN 1 ELSE 2 END LIMIT 1
     ), merged AS MATERIALIZED (
       SELECT s.* FROM station_merge_aliases a JOIN stations s ON s.id=a.station_id
       WHERE a.alias=$1 AND NOT EXISTS (SELECT 1 FROM direct)
     ) SELECT * FROM direct UNION ALL SELECT * FROM merged
     UNION ALL (SELECT * FROM stations
       WHERE NOT EXISTS (SELECT 1 FROM direct) AND NOT EXISTS (SELECT 1 FROM merged)
       AND $1=ANY(slug_aliases) LIMIT 1)`,
    [identifier],
  );
  if (result.rows[0]) return fromPostgres(result.rows[0]);
  const repairedAlias = allowHistoricalRepair && verifiedLegacyStationAlias(identifier);
  if (!repairedAlias) return null;
  // One fallback only: an allowlist mistake must never recurse or form a cycle.
  const target = await postgresStation(repairedAlias, false);
  return target && matchesVerifiedLegacyStationTarget(identifier, target._id, target.redirectToSlug) ? target : null;
}

export async function getPopularStationsFromPostgres(options: {
  country?: string;
  state?: string;
  limit: number;
  requireLogo?: boolean;
  compact?: boolean;
}): Promise<any[]> {
  const limit = boundedInteger(options.limit, 12, 500);
  const result = await getPostgresPool().query(
    `SELECT ${options.compact ? CARD_SELECTION : '*'} FROM stations
     WHERE (is_list_visible IS TRUE OR COALESCE(visibility_expires_at<=now(),false))
       AND ($1='' OR lower(country)=lower($1))
       AND ($2='%%' OR state ILIKE $2)
       AND (NOT $3 OR (logo_assets->>'status'='completed' OR NULLIF(favicon,'') IS NOT NULL))
     ORDER BY is_featured DESC,show_in_global_popular DESC,votes DESC,click_count DESC
     LIMIT $4`,
    [options.country || "", containsPattern(options.state || ""), options.requireLogo || false, limit * 4],
  );
  const seenNames = new Set<string>();
  const seenFavicons = new Set<string>();
  const output: any[] = [];
  for (const row of result.rows) {
    const station = fromPostgres(row);
    const nameKey = String(station?.name || "").toLowerCase()
      .replace(/\s*(radio|fm|am|digital|online|live|stream|web|internet|music|hits?)\s*/gi, "")
      .replace(/[^a-z0-9\u00C0-\u024F]/gi, "");
    const faviconKey = String(station?.favicon || "").toLowerCase().replace(/\?.*$/, "");
    if ((nameKey && seenNames.has(nameKey)) || (faviconKey && seenFavicons.has(faviconKey))) continue;
    if (nameKey) seenNames.add(nameKey);
    if (faviconKey) seenFavicons.add(faviconKey);
    output.push(station);
    if (output.length >= limit) break;
  }
  return output;
}

export async function getGeoStationsFromPostgres(limit: number): Promise<any[]> {
  const result = await getPostgresPool().query(
    `SELECT * FROM stations WHERE (is_list_visible IS TRUE OR COALESCE(visibility_expires_at<=now(),false)) AND latitude IS NOT NULL AND longitude IS NOT NULL
     ORDER BY votes DESC LIMIT $1`,
    [boundedInteger(limit, 1000, 5_000)],
  );
  return result.rows.map(fromPostgres);
}

export async function getNearbyStationsFromPostgres(options: {
  latitude?: number; longitude?: number; radiusKm: number; limit: number;
  country?: string; excludeBroken?: boolean; userCountry?: string;
  compact?: boolean;
}): Promise<any[]> {
  const hasCoordinates = options.latitude !== undefined || options.longitude !== undefined;
  if (!hasCoordinates) {
    if (!options.country) return [];
    return (await listStationsFromPostgres({
      country: options.country, excludeBroken: options.excludeBroken,
      page: 1, limit: boundedInteger(options.limit,12,50),sort: 'votes',
      compact: options.compact,
    })).stations.map((station) => ({ ...station,distance: null }));
  }
  const lat = options.latitude!, lng = options.longitude!;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) {
    throw new TypeError('Valid latitude (-90..90) and longitude (-180..180) are required');
  }
  const radius = Number.isFinite(options.radiusKm) ? Math.min(Math.max(options.radiusKm,1),150) : 100;
  const deltaLat = radius/111;
  const deltaLng = Math.min(180,radius/Math.max(0.01,111*Math.cos(lat*Math.PI/180)));
  const result = await getPostgresPool().query(
    `WITH candidates AS (
       SELECT ${options.compact ? CARD_SELECTION : '*'},6371*2*asin(sqrt(LEAST(1.0,GREATEST(0.0,
         power(sin(radians(latitude-$1)/2),2)+cos(radians($1))*cos(radians(latitude))*
         power(sin(radians(longitude-$2)/2),2))))) AS distance
       FROM stations
       WHERE latitude BETWEEN $1-$3 AND $1+$3
         AND abs(mod((longitude-$2+540)::numeric,360)-180)<=$4
         AND ($5='' OR lower(country)=lower($5)) AND (is_list_visible IS TRUE OR COALESCE(visibility_expires_at<=now(),false)) AND $6::boolean
     ) SELECT * FROM candidates WHERE distance<=$9
       ORDER BY COALESCE(country ILIKE $7,false) DESC,
       (NULLIF(btrim(favicon),'') IS NOT NULL AND favicon NOT IN ('null','undefined')) DESC,
       distance ASC,votes DESC,id ASC LIMIT $8`,
    [lat,lng,deltaLat,deltaLng,options.country || '',true,
      containsPattern(options.userCountry || ''),boundedInteger(options.limit,12,50),radius],
  );
  if (!result.rows.length && radius<100) return getNearbyStationsFromPostgres({ ...options,radiusKm:100,limit:Math.min(boundedInteger(options.limit,12,50),10) });
  return result.rows.map((row) => ({ ...fromPostgres(row),distance:Math.round(Number(row.distance)*10)/10 }));
}

export async function getStationStatsFromPostgres(): Promise<{
  total: number; working: number; broken: number; workingPercentage: number; lastUpdated: string;
}> {
  const result = await getPostgresPool().query<{
    total: string; working: string; broken: string;
  }>(
    `SELECT count(*)::text total,
       count(*) FILTER (WHERE last_check_ok)::text working,
       count(*) FILTER (WHERE NOT last_check_ok)::text broken FROM stations`,
  );
  const total = Number(result.rows[0]?.total || 0);
  const working = Number(result.rows[0]?.working || 0);
  return {
    total, working, broken: Number(result.rows[0]?.broken || 0),
    workingPercentage: total ? Math.round(working / total * 100) : 0,
    lastUpdated: new Date().toISOString(),
  };
}

export async function getRelatedStationsFromPostgres(stationId: string, limit: number, compact = false): Promise<any[] | null> {
  const source = await postgresStation(stationId);
  if (!source) return null;
  const result = await getPostgresPool().query(
    `SELECT ${compact ? CARD_SELECTION : '*'} FROM stations WHERE id<>$1 AND (is_list_visible IS TRUE OR COALESCE(visibility_expires_at<=now(),false))
       AND ($2='' OR country=$2)
       AND ($3='' OR tags_raw ILIKE '%' || $3 || '%')
     ORDER BY votes DESC LIMIT $4`,
    [String(source._id), source.country || "", String(source.tags || "").split(",")[0]?.trim() || "", boundedInteger(limit, 12, 500)],
  );
  return result.rows.map(fromPostgres);
}

export async function getRandomCountryStationFromPostgres(country: string): Promise<any | null> {
  const result = await getPostgresPool().query(
    "SELECT * FROM stations WHERE (is_list_visible IS TRUE OR COALESCE(visibility_expires_at<=now(),false)) AND lower(country)=lower($1) ORDER BY random() LIMIT 1",
    [country],
  );
  return fromPostgres(result.rows[0]);
}

export interface PostgresStationListOptions {
  country?: string; state?: string; genre?: string; tags?: string; language?: string;
  search?: string; sort?: string; excludeBroken?: boolean; excludeIds?: string[];
  minVotes?: number; createdAfter?: Date; page: number; limit: number;
  hasLogo?: boolean; codec?: string; minBitrate?: number;
  compact?: boolean;
  /** Internal SSR fallback only; public browsing retains its existing order. */
  seoQualitySample?: boolean;
}

export async function listStationsFromPostgres(options: PostgresStationListOptions,
  query = (text: string, values: any[]) => getPostgresPool().query(text, values),
): Promise<{
  stations: any[]; totalCount: number; count: number;
  pagination: { page: number; limit: number; total: number; pages: number };
}> {
  const values: unknown[] = [];
  // This is a public catalog reader. excludeBroken=false is a legacy client
  // preference, not permission to bypass current native health visibility.
  const conditions: string[] = ['(is_list_visible IS TRUE OR COALESCE(visibility_expires_at<=now(),false))'];
  if (options.seoQualitySample) conditions.push('no_index IS NOT TRUE', "slug IS NOT NULL AND slug<>''");
  let genreCandidates = '';
  const bind = (value: unknown): string => { values.push(value); return `$${values.length}`; };
  if (options.country) conditions.push(`lower(country)=lower(${bind(options.country)})`);
  if (options.state) {
    const names = /^(wien|vienna)$/i.test(options.state) ? ['Wien', 'Vienna'] : [options.state];
    conditions.push(`state ILIKE ANY(${bind(names.map(containsPattern))}::text[])`);
  }
  if (options.tags) conditions.push(`tags_raw ILIKE ${bind(containsPattern(options.tags))}`);
  if (options.genre) {
    const normalized = bind(genreSlug(options.genre));
    const name = bind(options.genre);
    // Keep all three historical match paths, but collect indexed IDs once.
    // OR-ing the source fallback into every station row forced decompression
    // of the complete archived JSON (including every translated article).
    const pattern = bind(containsPattern(options.genre));
    genreCandidates = `genre_matches AS MATERIALIZED (
      SELECT station_id AS id FROM station_genres WHERE genre_slug=${normalized}
      UNION SELECT id FROM stations WHERE lower(source->>'genre')=lower(${name})
      UNION SELECT id FROM stations WHERE tags_raw ILIKE ${pattern}
        AND EXISTS (SELECT 1 FROM unnest(string_to_array(tags_raw,',')) AS tag WHERE lower(btrim(tag))=lower(${name}))
    ),`;
    conditions.push('id IN (SELECT id FROM genre_matches)');
  }
  if (options.language) conditions.push(`language ILIKE ${bind(containsPattern(options.language))}`);
  let searchOrder = '';
  if (options.search) {
    const search=stationSearchSql(options.search,bind);
    conditions.push(search.where);
    searchOrder=search.order;
  }
  if (options.excludeIds?.length) conditions.push(`NOT (id=ANY(${bind(options.excludeIds)}::text[]))`);
  if (Number.isFinite(options.minVotes) && options.minVotes! > 0) conditions.push(`votes>=${bind(options.minVotes)}`);
  if (options.createdAfter) {
    const date = bind(options.createdAfter);
    conditions.push(`(created_at>=${date} OR CASE WHEN source->>'lastChangeTime' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN (source->>'lastChangeTime')::timestamptz>=${date} ELSE false END
      OR CASE WHEN source->>'clickTimestamp' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN (source->>'clickTimestamp')::timestamptz>=${date} ELSE false END)`);
  }
  if (options.hasLogo !== undefined) conditions.push(`(has_logo OR NULLIF(btrim(favicon),'') IS NOT NULL)=${bind(options.hasLogo)}`);
  if (options.codec) conditions.push(`lower(codec)=lower(${bind(options.codec)})`);
  if (Number.isFinite(options.minBitrate)) conditions.push(`bitrate>=${bind(options.minBitrate)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortMap: Record<string, string> = { az:'name ASC',za:'name DESC',newest:'created_at DESC',oldest:'created_at ASC',votes:'votes DESC,click_count DESC' };
  const numericNamesLast = ['az','za'].includes(options.sort || '') ? "(btrim(name) ~ '^[0-9]') ASC," : '';
  const order = options.seoQualitySample ? 'votes DESC,id ASC'
    : searchOrder + numericNamesLast + `${sortMap[options.sort || 'votes'] || sortMap.votes},(btrim(COALESCE(favicon,'')) ~* '^(https?://.+|data:image/.+)') DESC,id ASC`;
  const page = boundedInteger(options.page, 1, 1_000_000);
  const limit = boundedInteger(options.limit, 25, 500);
  // Select the bounded ID page before loading wide station/source columns.
  // This permits a narrow top-N sort instead of sorting full catalog rows
  // for the window. Reapply the identical order only to the selected page.
  // One statement gives count and page the same MVCC snapshot, including empty pages.
  const result = await query(
    `WITH ${genreCandidates} page_ids AS MATERIALIZED (SELECT id FROM stations ${where}
       ORDER BY ${order} LIMIT ${bind(limit)} OFFSET ${bind((page-1)*limit)}),
     selected AS (SELECT ${options.compact ? CARD_SELECTION : '*'},row_number() OVER (ORDER BY ${order}) AS _position
       FROM stations WHERE id IN (SELECT id FROM page_ids))
     SELECT selected.*,(SELECT count(*)::integer FROM stations ${where}) AS _total
     FROM (SELECT 1) anchor LEFT JOIN selected ON true ORDER BY selected._position`, values,
  );
  const total = result.rows[0]?._total || 0;
  return {
    stations: result.rows.filter((row) => row.id != null).map(fromPostgres),totalCount: total,count: total,
    pagination: { page,limit,total,pages: Math.ceil(total/limit) },
  };
}

export async function stationSlugExists(candidate: string, excludedId: string): Promise<boolean> {
  const result = await getPostgresPool().query("SELECT 1 FROM stations WHERE slug=$1 AND id<>$2 LIMIT 1", [candidate, excludedId]);
  return Boolean(result.rowCount);
}

export async function updateStationDerivedFields(stationId: string, update: { slug: string; noIndex?: true }): Promise<void> {
  await getPostgresPool().query(
    "UPDATE stations SET slug=$2,no_index=COALESCE($3,no_index),updated_at=now() WHERE id=$1",
    [stationId,update.slug,update.noIndex ?? null],
  );
}

export async function getStationByIdentifier(identifier: string): Promise<any | null> {
  return postgresStation(identifier);
}

export async function getPublicStationByIdentifier(identifier: string): Promise<any | null> {
  const station = await postgresStation(identifier);
  return station?.isListVisible !== false ? station : null;
}
