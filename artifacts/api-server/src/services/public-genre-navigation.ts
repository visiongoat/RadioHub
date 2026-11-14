import { createHash } from 'node:crypto';
import { pgPublicGenres, pgGenres } from '../data/postgres-taxonomy-store';
import { publicStationCache } from '../public-station-cache';
import { getMergedWhitelist } from '../seo/genre-whitelist-store';

// Whitelist edits select a new cache entry without flushing unrelated public data.
export const publicGenreWhitelistVersion = () => 'navigation-v2:' + createHash('sha256')
  .update([...getMergedWhitelist()].sort().join('\0')).digest('hex').slice(0, 16);

/** Share the native membership aggregate between the public API and home SSR.
 * Keep the health-aware absolute deadline: expired station visibility must not
 * survive through a second response/page cache or a stale fallback. */
export interface PublicGenreSnapshot { genres: any[]; computedAt: number }

export function getCachedPublicGenreSnapshot(country?: string): Promise<PublicGenreSnapshot> {
  const cacheKey = `genres:precomputed:native-v2:${country || 'global'}:whitelist-${publicGenreWhitelistVersion()}`;
  return publicStationCache.getOrSetSingleFlight(cacheKey,
    async () => ({ genres: await pgPublicGenres(country, true), computedAt: Date.now() }), { ttl: 60 });
}

export async function getCachedPublicGenres(country?: string): Promise<any[]> {
  return (await getCachedPublicGenreSnapshot(country)).genres;
}

export async function invalidatePublicGenreCaches(): Promise<void> {
  const results = await Promise.allSettled(['genres:', 'genre-slug:', 'genre-stations:']
    .map(pattern => Promise.resolve().then(() => publicStationCache.clearByPattern(pattern))));
  if (results.some(result => result.status === 'rejected')) throw new Error('Some public genre caches could not be invalidated');
}


/** Group interests use the full populated catalog shown by the app's picker,
 * not the smaller SEO/home navigation whitelist. Keep admin demotions excluded. */
export function getCachedGroupMusicGenres(): Promise<any[]> {
  return publicStationCache.getOrSetSingleFlight('genres:group-music:full-v1',
    async () => (await pgGenres(undefined, true)).filter(genre =>
      !genre.cleanupDemotion && genre.stationCount > 0), {ttl:60});
}
