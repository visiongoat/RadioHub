import { pgGenres } from '../data/postgres-taxonomy-store';
import { publicStationCache } from '../public-station-cache';

/** Group interests use the full populated catalog shown by the app's picker,
 * not the smaller SEO/home navigation whitelist. Keep admin demotions excluded. */
export function getCachedGroupMusicGenres(): Promise<any[]> {
  return publicStationCache.getOrSetSingleFlight('genres:group-music:full-v1',
    async () => (await pgGenres(undefined, true)).filter(genre =>
      !genre.cleanupDemotion && genre.stationCount > 0), {ttl:60});
}
