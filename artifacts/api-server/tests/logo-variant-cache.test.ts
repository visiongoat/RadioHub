import assert from 'node:assert/strict';
import { beforeEach, it, mock } from 'node:test';
const deleted: string[] = [], patterns: string[] = [], seo: string[] = [], pools = new Map<string, any>();
let fail = false;
mock.module('../src/cache', { defaultExport: {
  del: async (key: string) => { deleted.push(key); if (fail) throw new Error('offline'); },
  clearByPattern: async (key: string) => { patterns.push(key); },
  getSWR: async (key: string) => pools.get(key),
  delSWR: async (key: string) => { deleted.push(key + ':swr'); },
} });
mock.module('../src/performance-cache', { namedExports: { performanceCache: { invalidateStationCache: (key: string) => seo.push(key) } } });
const { invalidateLogoVariantCaches } = await import('../src/services/logo-variant-cache');
const station = { id: '1234567890abcdef12345678', slug: 'radio', slugAliases: ['old-radio'], favicon: null, logoAssets: {}, country: 'Germany', countryCode: 'DE' };
beforeEach(() => { deleted.length = patterns.length = seo.length = 0; pools.clear(); fail = false; });
it('invalidates exact details/aliases and only matching global or country card pools, not unrelated data', async () => {
  pools.set('precomputed_popular:v1:global:limit:12', [{ _id: station.id }]);
  pools.set('precomputed_popular:v1:global:limit:24', [{ _id: 'other' }]);
  pools.set('precomputed_stations:germany', { stations: [{ id: station.id }] });
  await invalidateLogoVariantCaches(station);
  assert.ok(deleted.includes('public-health:v2:station:detail:editorial-v3-taxonomy:old-radio'));
  assert.ok(deleted.includes('public-health:v2:station:detail:editorial-v3-taxonomy:' + station.id));
  assert.ok(deleted.includes('precomputed_popular:v1:global:limit:12:swr'));
  assert.ok(deleted.includes('precomputed_stations:germany:swr'));
  assert.ok(!deleted.includes('precomputed_popular:v1:global:limit:24:swr'));
  assert.ok(patterns.includes('precomputed_stations:catalog:v1:Germany:'));
  assert.ok(patterns.includes('popular_stations:Germany:'));
  assert.ok(!patterns.some(key => ['stations', 'popular_stations', 'seo', 'translations', 'genres', '*'].includes(key)));
  assert.deepEqual(seo, [station.id, 'radio', 'old-radio']);
});
it('attempts remaining targeted invalidations after one cache failure and reports the warning', async () => {
  fail = true; await assert.rejects(invalidateLogoVariantCaches(station));
  assert.ok(patterns.includes('popular_stations:Germany:'));
});
