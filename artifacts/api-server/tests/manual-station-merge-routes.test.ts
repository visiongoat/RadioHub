import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { buildManualStationMergePreview, parseManualStationMerge } from '../src/utils/manual-station-merge-review';

const a = 'a'.repeat(24), b = 'b'.repeat(24);
let documents: any[], calls: any[], invalidations: string[], failCache: boolean, hangCache: boolean, failStore: any;
mock.module('../src/postgres-runtime', { namedExports: {
  getPostgresPool: () => { throw new Error('Real database forbidden'); },
  getPostgresCoordinationPool: () => { throw new Error('Real database forbidden'); }, closePostgres: async () => {},
} });
mock.module('../src/data/postgres-catalog-store', { namedExports: {
  pgSyncLogs: async () => [], PostgresCatalogStore: class {}, pgCatalog: () => ({
    find: async (filter: any) => { calls.push(['find', filter]); return structuredClone(documents); },
    mergeDuplicates: async (ids: any, options: any) => {
      calls.push(['merge', ids, options]); if (failStore) throw failStore;
      return { primary: documents[0], duplicates: documents.slice(1), deletedCount: 1 };
    },
  }),
} });
mock.module('../src/cache', { defaultExport: {
  get: async () => null, set: async () => {}, del: async () => {},
  clearByPattern: async (pattern: string) => { invalidations.push(`raw:${pattern}`); },
}, namedExports: { CacheKeys: {}, invalidateSocialCacheForUser: async () => {} } });
mock.module('../src/public-station-cache', { namedExports: { PUBLIC_STATION_CACHE_MAX_TTL: 60,
  publicStationCacheKey: (key: string) => `public-health:v2:${key}`, publicStationCache: {
  clearByPattern: async (pattern: string) => { invalidations.push(`public:${pattern}`); },
  del: async (key: string) => { invalidations.push(key); if (failCache) throw new Error('Cache failure'); if (hangCache) await new Promise(() => {}); },
} } });
mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  clearSeoAndQuickCaches: () => { invalidations.push('local:seo-quick'); },
  clearSimilarStationPools: () => { invalidations.push('local:similar'); },
} } });
mock.module('../src/services/genre-station-counts', { namedExports: {
  triggerGenreStationCountsRecompute: () => { invalidations.push('counts'); },
} });
mock.module('../src/services/sync', { namedExports: { syncService: {} } });
mock.module('../src/services/user-engagement-service', { namedExports: { UserEngagementService: class {} } });
mock.module('../src/routes/cache-refresh-utils', { namedExports: {
  refreshCommunityFavoritesCache: async () => {}, fetchTranslationsForLanguage: async () => ({}), refreshTranslationsCache: async () => {},
} });

const { registerTranslationAdminRoutes } = await import('../src/routes/translation-admin-routes');
const handlers = new Map<string, any[]>(), app: any = { use() {} };
for (const method of ['get', 'post', 'put', 'patch', 'delete']) app[method] = (path: string, ...callbacks: any[]) => handlers.set(`${method}:${path}`, callbacks);
const requireAdmin = () => {}, requireAuth = () => {};
registerTranslationAdminRoutes(app, { requireAdmin, requireAuth });
const body = () => ({ primaryStationId: a, duplicateStationIds: [b] });
const applyBody = () => ({ ...body(), confirm: true, expectedFingerprint: buildManualStationMergePreview(parseManualStationMerge(body()), documents).fingerprint });
async function invoke(path: string, body: any) {
  const response: any = { statusCode: 200, headers: {}, status(value: number) { this.statusCode = value; return this; },
    set(key: string, value: string) { this.headers[key.toLowerCase()] = value; return this; },
    json(value: any) { this.body = value; return this; } };
  await handlers.get(`post:/api/admin/stations/${path}`)!.at(-1)({ body }, response);
  return response;
}
beforeEach(() => {
  calls = []; invalidations = []; failCache = false; hangCache = false; failStore = undefined;
  documents = [a, b].map((_id, i) => ({ _id, stationuuid: `uuid-${i}`, slug: `radio-${i}`, slugAliases: [`old-${i}`],
    mergedStationIds: [`merged-${i}`], mergedStationUuids: [`merged-uuid-${i}`], name: 'Radio', country: 'Germany',
    countryCode: 'DE', url: 'https://example.invalid/live', noIndex: false, descriptions: { en: 'Must not leak in preview' } }));
});

test('both manual merge endpoints register requireAdmin; preview is read-only, uncached and facts-only', async () => {
  for (const path of ['merge', 'merge-preview']) assert.equal(handlers.get(`post:/api/admin/stations/${path}`)![0], requireAdmin);
  const response = await invoke('merge-preview', { ...body(), mergeData: { name: ' Renamed ' } });
  assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(calls, [['find', { _id: { $in: [a, b] } }]]); assert.equal(invalidations.length, 0);
  assert.equal(response.body.success, true); assert.equal(response.body.preview.primaryStationId, a);
  assert.deepEqual(response.body.preview.changes, { name: 'Renamed' });
  assert.equal(JSON.stringify(response.body).includes('Must not leak'), false);
});
test('malformed selection/patch, missing confirmation or fingerprint never reach the mutation', async () => {
  for (const invalid of [body(), { ...body(), confirm: true }, { ...applyBody(), confirm: false },
    { ...applyBody(), duplicateStationIds: [a] }, { ...applyBody(), mergeData: { noIndex: false } }]) {
    assert.equal((await invoke('merge', invalid)).statusCode, 400);
  }
  assert.equal(calls.length, 0);
});
test('preview rejects missing members and protected primaries without mutation', async () => {
  documents.pop(); assert.equal((await invoke('merge-preview', body())).statusCode, 409);
  documents.push({ _id: b }); documents[0].noIndex = true;
  assert.equal((await invoke('merge-preview', body())).statusCode, 422);
  documents[0].noIndex = false; documents[0].redirectToSlug = 'target';
  assert.equal((await invoke('merge-preview', body())).statusCode, 422);
  assert.equal(calls.some(call => call[0] === 'merge'), false);
});
test('apply forwards the exact sanitized selection and reviewed override without loosening automatic policy', async () => {
  documents[1].name = 'Different name';
  const request = { ...applyBody(), confirmIdentityOverride: true };
  const response = await invoke('merge', request);
  assert.equal(response.statusCode, 200); assert.equal(response.body.deletedCount, 1); assert.equal(response.body.cacheInvalidated, true);
  assert.equal(response.body.async, undefined);
  assert.deepEqual(calls[0], ['merge', [a, b], { primaryId: a, validateGroup: false, patch: {},
    manualReview: { expectedFingerprint: request.expectedFingerprint, confirmIdentityOverride: true } }]);
  for (const identifier of [a, b, 'uuid-0', 'uuid-1', 'radio-0', 'radio-1', 'old-0', 'old-1', 'merged-0', 'merged-1', 'merged-uuid-0', 'merged-uuid-1']) {
    assert.ok(invalidations.includes(`station:detail:editorial-v3-taxonomy:${identifier}`), identifier);
  }
  for (const pattern of ['public:stations:', 'public:precomputed_stations:', 'public:similar_stations:', 'raw:admin_stations:', 'local:seo-quick', 'local:similar', 'counts']) assert.ok(invalidations.includes(pattern), pattern);
});
test('one cache failure after commit is 200 false and does not prevent other invalidations', async () => {
  failCache = true;
  const response = await invoke('merge', applyBody());
  assert.equal(response.statusCode, 200); assert.equal(response.body.success, true); assert.equal(response.body.cacheInvalidated, false);
  assert.equal(calls.filter(call => call[0] === 'merge').length, 1);
  assert.ok(invalidations.includes('public:stations:')); assert.ok(invalidations.includes('raw:admin_stations:'));
  assert.ok(invalidations.includes('local:similar')); assert.ok(invalidations.includes('counts'));
});
test('cache wait is bounded after commit even if one adapter never resolves', async () => {
  hangCache = true; const started = Date.now();
  const response = await invoke('merge', applyBody());
  assert.equal(response.statusCode, 200); assert.equal(response.body.cacheInvalidated, false);
  assert.ok(Date.now() - started < 1500);
});
test('guard status/code stays explicit; infrastructure failure is sanitized 503 with no cache work', async () => {
  const { ManualStationMergeError } = await import('../src/utils/manual-station-merge-review');
  for (const status of [409, 422] as const) {
    failStore = new ManualStationMergeError('Review required', status, 'MANUAL_MERGE_STALE_REVIEW');
    const response = await invoke('merge', applyBody()); assert.equal(response.statusCode, status);
    assert.equal(response.body.code, 'MANUAL_MERGE_STALE_REVIEW');
  }
  failStore = new Error('private connection data');
  const response = await invoke('merge', applyBody()); assert.equal(response.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(response.body), /private connection/); assert.equal(invalidations.length, 0);
});
