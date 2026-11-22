import { publicStationCache } from '../public-station-cache';

interface StationDetailIdentity {
  _id?: string; id?: string; stationuuid?: string | null; slug?: string | null;
  slugAliases?: readonly string[] | null;
  mergedStationIds?: readonly string[] | null;
  mergedStationUuids?: readonly string[] | null;
}

export function stationDetailIdentifiers(...stations: StationDetailIdentity[]): string[] {
  return [...new Set(stations.flatMap(station => [station._id, station.id, station.stationuuid, station.slug,
    ...(Array.isArray(station.slugAliases) ? station.slugAliases : []),
    ...(Array.isArray(station.mergedStationIds) ? station.mergedStationIds : []),
    ...(Array.isArray(station.mergedStationUuids) ? station.mergedStationUuids : []),
  ]).filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

export const stationDetailCacheKey = (identifier: string): string => `station:detail:editorial-v3-taxonomy:${identifier}`;

// Exact detail keys only; derived lists and other replicas retain their bounded TTL.
export async function invalidatePublicStationDetails(identifiers: readonly string[]): Promise<void> {
  const results = await Promise.allSettled([...new Set(identifiers)]
    .map(identifier => Promise.resolve().then(() => publicStationCache.del(stationDetailCacheKey(identifier)))));
  if (results.some(result => result.status === 'rejected')) throw new Error('Some station detail caches could not be invalidated');
}
