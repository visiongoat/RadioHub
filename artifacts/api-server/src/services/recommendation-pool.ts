import { getPostgresPool } from '../postgres-runtime';
import { catalogShape } from '../data/postgres-catalog-store';
import { publicStationCache } from '../public-station-cache';
import { resolveToDbName } from '../utils/normalize-country';
import { stationVisibilitySql } from '../utils/station-visibility';

export function recommendationPoolScope(country: unknown, genres: unknown) {
  if (country !== undefined && (typeof country !== 'string' || country.length > 100)) throw new Error('Invalid country');
  if (genres !== undefined && (typeof genres !== 'string' || genres.length > 500)) throw new Error('Invalid genres');
  const name = String(country || '').trim();
  const global = !name || ['all', 'global'].includes(name.toLowerCase());
  const genreSlugs = [...new Set(String(genres || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))].sort();
  if (genreSlugs.length > 8 || genreSlugs.some(value => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 60)) throw new Error('Invalid genres');
  return { country: global ? null : (resolveToDbName(name) || name), genres: genreSlugs };
}

/** One indexed, bounded quality pool per country/genre filter. Visit rotation is
 * client-side, so every visitor shares the same health-aware origin cache. */
export async function getRecommendationPool(scope: ReturnType<typeof recommendationPoolScope>) {
  // v2 carries native indexing eligibility; v1 entries cannot inform SSR.
  const key = `recommendations:pool:v2:${JSON.stringify(scope)}`;
  return publicStationCache.getOrSetSingleFlight(key, async () => {
    const values: unknown[] = [];
    const conditions = [stationVisibilitySql('s')];
    if (scope.country) { values.push(scope.country.toLowerCase()); conditions.push(`lower(s.country)=$${values.length}`); }
    if (scope.genres.length) {
      values.push(scope.genres);
      conditions.push(`EXISTS(SELECT 1 FROM station_genres sg WHERE sg.station_id=s.id AND sg.genre_slug=ANY($${values.length}::text[]))`);
    }
    const query = {
      // Source contains large editorial JSON. Rank only compact native columns
      // before projecting those JSON fields for at most one hundred stations.
      text: `WITH candidates AS MATERIALIZED (
        SELECT s.id,s.votes,s.click_count FROM stations s WHERE ${conditions.join(' AND ')}
        ORDER BY s.votes DESC NULLS LAST,s.click_count DESC NULLS LAST,s.id LIMIT 100
      )
        SELECT s.id,s.name,s.slug,s.url,s.url_resolved,s.homepage,s.favicon,s.country,s.country_code,s.state,
        s.language,s.tags_raw,s.votes,s.click_count,s.codec,s.bitrate,s.logo_assets,s.has_logo,s.last_check_ok,
        s.is_list_visible,s.visibility_expires_at,s.availability_outcome,s.availability_checked_at,s.no_index,
        jsonb_build_object('genre',s.source->'genre','localImagePath',s.source->'localImagePath') source
        FROM candidates c JOIN stations s ON s.id=c.id
        ORDER BY c.votes DESC NULLS LAST,c.click_count DESC NULLS LAST,c.id`,
      values,
      query_timeout: 8000,
    };
    const result = await getPostgresPool().query(query);
    // Do not return station.source wholesale (descriptions/admin metadata are large).
    const fields = ['_id','name','slug','url','urlResolved','homepage','favicon','country','countryCode','state',
      'language','tags','genre','votes','clickCount','codec','bitrate','logoAssets','hasLogo','localImagePath',
      'lastCheckOk','isListVisible','availabilityStatus','noIndex'];
    const stations = result.rows.map(row => {
      const station = catalogShape(row);
      return Object.fromEntries(fields.map(field => [field, station[field]]));
    });
    return { stations, total: stations.length };
  }, { ttl: 60 });
}
