import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import type { Express } from 'express';

const entries = new Map<string, any>(), deleted: string[] = [], patterns: string[] = [], seo: string[] = [];
const handlers = new Map<string, any>();
const id = 'a'.repeat(24), uuid = 'fixture-station-uuid';
const identifiers = [id, uuid, 'radio', 'old-radio', 'merged-id', 'merged-uuid'];
let station: any, mutationStatus = 'updated', failSeo = false, failKey = '';
mock.module('../src/cache', { defaultExport: {
  get: async (key: string) => entries.get(key) ?? null,
  set: async (key: string, value: unknown) => { entries.set(key, value); },
  del: async (key: string) => {
    deleted.push(key); if (key === failKey) throw new Error('Private cache details'); entries.delete(key);
  },
  clearByPattern: async (pattern: string) => {
    patterns.push(pattern); for (const key of entries.keys()) if (key.includes(pattern)) entries.delete(key);
  },
  getSWR: async () => null, delSWR: async () => {},
} });
mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  invalidateStationCache: (slug: string) => { seo.push(slug); if (failSeo) throw new Error('Private SEO cache details'); },
} } });
mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => ({
  findById: async () => station,
  patchDescriptions: async () => ({ status: mutationStatus, station }),
  recoverStreamHealth: async () => ({ status: mutationStatus, station }),
}) } });
mock.module('../src/utils/station-health-recovery', { namedExports: {
  getStreamRecoverySnapshot: (value: any) => ({ slug: value.slug }), assertRecoverableStation() {},
  probeStationStream: async () => ({ checkedAt: '2026-11-04T00:00:00Z', contentType: 'audio/mpeg', bytesRead: 1024 }),
} });
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => { throw new Error('No database permitted'); } } });
mock.module('../src/data/postgres-station-redirect', { namedExports: { pgSetStationRedirect: async () => ({
  stationId: id, slug: station.slug, redirectToSlug: 'new-target', changed: true,
  cacheKeys: [...identifiers, 'old-target', 'new-target'],
}) } });
const { publicStationCache } = await import('../src/public-station-cache');
const { registerAdminDescriptionRoutes } = await import('../src/routes/admin-description-routes');
const { registerAdminStreamHealthRoutes } = await import('../src/routes/admin-stream-health-routes');
const { registerAdminStationRedirectRoutes } = await import('../src/routes/admin-station-redirect-routes');
const { invalidateLogoVariantCaches } = await import('../src/services/logo-variant-cache');
const detailCache = await import('../src/services/station-detail-cache');
const { stationDetailIdentifiers, invalidatePublicStationDetails } = detailCache;
const app: any = {};
for (const method of ['get', 'post', 'put', 'patch']) app[method] = (path: string, ...callbacks: any[]) => {
  handlers.set(`${method}:${path}`, callbacks.findLast(callback => callback.length !== 4));
};
registerAdminDescriptionRoutes(app as Express, () => {});
registerAdminStreamHealthRoutes(app as Express, () => {});
registerAdminStationRedirectRoutes(app as Express, () => {});
const key = (identifier: string) => `station:detail:editorial-v3-taxonomy:${identifier}`;
async function invoke(method: string, path: string, body: unknown) {
  const response: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; },
    set() { return this; }, json(body: unknown) { this.body = body; return this; } };
  await handlers.get(`${method}:${path}`)({ params: { id }, query: {}, body }, response);
  return response;
}
beforeEach(async () => {
  entries.clear(); deleted.length = patterns.length = seo.length = 0; mutationStatus = 'updated'; failSeo = false; failKey = '';
  station = { _id: id, stationuuid: uuid, slug: 'radio', slugAliases: ['old-radio'],
    mergedStationIds: ['merged-id'], mergedStationUuids: ['merged-uuid'], descriptions: { en: { meta: 'Edited' } } };
  for (const identifier of [...identifiers, 'old-target', 'new-target', 'unrelated']) {
    await publicStationCache.set(key(identifier), { name: 'Old payload' }, { ttl: 60 });
  }
});
after(() => mock.restoreAll());
const descriptionBody = { slug: 'radio', changes: [{ locale: 'en', field: 'meta', value: 'Edited',
  expectedCurrentValue: 'Original', expectedLocaleObject: { meta: 'Original' } }] };
const paths = [
  ['patch', '/api/admin/stations/:id/descriptions', () => descriptionBody],
  ['post', '/api/admin/stations/:id/recover-stream-health', () => ({ confirmRecovery: true, expected: { slug: 'radio' } })],
  ['put', '/api/admin/stations/:id/redirect', () => ({ targetSlug: 'new-target', expectedRedirectToSlug: 'old-target' })],
] as const;
for (const [method, path, body] of paths) {
  test(`${path} removes the real public detail keys for every supplied identity`, async () => {
    const response = await invoke(method, path, body());
    assert.equal(response.statusCode, 200); assert.equal(response.body.cacheInvalidated, true);
    for (const identifier of identifiers) assert.equal(await publicStationCache.get(key(identifier)), null, identifier);
    assert.ok(await publicStationCache.get(key('unrelated')));
    assert.ok(patterns.includes('admin_stations:'));
    if (method === 'put') for (const target of ['old-target', 'new-target']) assert.equal(await publicStationCache.get(key(target)), null);
  });
  test(`${path} attempts detail invalidation even when the separate SEO cache fails`, async () => {
    failSeo = true;
    const response = await invoke(method, path, body());
    assert.equal(response.statusCode, 200); assert.equal(response.body.success, true);
    assert.equal(response.body.cacheInvalidated, false);
    for (const identifier of identifiers) assert.equal(await publicStationCache.get(key(identifier)), null, identifier);
    assert.ok(patterns.includes('admin_stations:'));
    assert.doesNotMatch(JSON.stringify(response.body), /Private/);
  });
}
test('description CAS conflict does not invalidate an unchanged station', async () => {
  mutationStatus = 'conflict';
  const response = await invoke(paths[0][0], paths[0][1], descriptionBody);
  assert.equal(response.statusCode, 409); assert.equal(deleted.length, 0); assert.ok(await publicStationCache.get(key(id)));
});
test('logo invalidation targets the current detail namespace and known aliases without clearing unrelated details', async () => {
  await invalidateLogoVariantCaches({ ...station, id, favicon: null, logoAssets: {}, country: 'Germany' });
  for (const identifier of identifiers) assert.equal(await publicStationCache.get(key(identifier)), null, identifier);
  assert.ok(await publicStationCache.get(key('unrelated')));
});
test('one rejected detail delete does not prevent attempts for the other identities', async () => {
  failKey = `public-health:v2:${key(id)}`;
  const response = await invoke(paths[0][0], paths[0][1], descriptionBody);
  assert.equal(response.statusCode, 200); assert.equal(response.body.cacheInvalidated, false);
  for (const identifier of identifiers.slice(1)) assert.equal(await publicStationCache.get(key(identifier)), null, identifier);
  assert.ok(await publicStationCache.get(key('unrelated')));
});

test('identity collection covers old and new records without emitting empty or duplicate keys', async () => {
  const keys = stationDetailIdentifiers(station, { id, stationuuid: uuid, slug: 'new-radio', slugAliases: ['', 'old-radio'] });
  assert.deepEqual(keys, [...identifiers, 'new-radio']);
  deleted.length = 0;
  await invalidatePublicStationDetails([...keys, ...keys]);
  assert.equal(deleted.length, keys.length);
});

test('malformed archived identity lists cannot throw or turn strings into character keys', () => {
  for (const malformed of [42, 'archived-alias', {}, true]) {
    const input = { _id: id, stationuuid: uuid, slug: 'radio', slugAliases: malformed,
      mergedStationIds: malformed, mergedStationUuids: malformed } as any;
    assert.deepEqual(stationDetailIdentifiers(input), [id, uuid, 'radio']);
  }
  assert.deepEqual(stationDetailIdentifiers({ _id: id, mergedStationIds: [null, 5, '', 'merged-id'] } as any), [id, 'merged-id']);
});

test('the detail reader and invalidator can share one versioned key builder', () => {
  assert.equal(typeof detailCache.stationDetailCacheKey, 'function');
  assert.equal(detailCache.stationDetailCacheKey('old-radio'), key('old-radio'));
});
