import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import type { Express } from 'express';

const entries = new Map<string, any>();
const clears: string[] = [];
const handlers = new Map<string, any>();
let rows: any[], reads: string[], legacyRefreshes = 0, writeFailure = false, cacheFailure = false, readFailure = false;
const whitelist = new Set(['rock', 'pop', 'jazz']);
mock.module('../src/cache', { defaultExport: {
  get: async (key: string) => entries.get(key) ?? null,
  set: async (key: string, value: unknown) => { entries.set(key, value); },
  del: async (key: string) => { entries.delete(key); },
  clearByPattern: async (pattern: string) => {
    clears.push(pattern);
    if (cacheFailure) throw new Error('Fixture cache failure');
    for (const key of entries.keys()) if (key.includes(pattern)) entries.delete(key);
  },
}, namedExports: { CacheKeys: { genres: (...parts: any[]) => `genres:${JSON.stringify(parts)}` } } });
mock.module('../src/seo/genre-whitelist-store', { namedExports: { getMergedWhitelist: () => whitelist } });
mock.module('../src/data/postgres-taxonomy-store', { namedExports: {
  pgGenres: async () => structuredClone(rows),
  pgPublicGenres: async (country?: string) => {
    reads.push(country || 'global'); if (readFailure) throw new Error('Fixture read failure'); return structuredClone(rows);
  },
  pgCountryCounts: async () => [], pgDiscoverableGenres: async () => [], pgGenreBySlug: async () => null,
  pgStoredGenreBySlug: async (slug: string) => rows.find(row => row.slug === slug) ?? null,
  pgCreateGenre: async (input: any) => {
    if (writeFailure) throw new Error('Fixture write failure');
    const row = { ...input, _id: 'new-genre', stationCount: 3 }; rows.push(row); return row;
  },
  pgUpdateGenre: async (id: string, input: any) => {
    if (writeFailure) throw new Error('Fixture write failure');
    const row = rows.find(row => row._id === id); if (!row) return null;
    Object.assign(row, input); return row;
  },
  pgDeleteGenre: async (id: string) => {
    if (writeFailure) throw new Error('Fixture write failure');
    const row = rows.find(row => row._id === id); rows = rows.filter(row => row._id !== id); return row ?? null;
  },
} });
mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => ({}) } });
mock.module('../src/data/postgres-recommendation-store', { namedExports: {
  pgRecommendationProfile: async () => null, pgRecentSessionListening: async () => [],
} });
mock.module('../src/data/station-read-store', { namedExports: { listStationsFromPostgres: async () => ({ stations: [] }) } });
mock.module('../src/services/recommendation-engine', { namedExports: { RecommendationEngine: {} } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {
  refreshAll: async () => { legacyRefreshes++; },
} } });
mock.module('../src/routes/shared-utils', { namedExports: {
  tvSlimGenre: (value: unknown) => value, tvValidateParams: () => ({ page: 1, limit: 9 }),
} });
mock.module('../src/utils/logger', { namedExports: { logger: { warn() {}, error() {}, log() {} } } });
const { getCachedPublicGenres, publicGenreWhitelistVersion } = await import('../src/services/public-genre-navigation');
const { publicStationDeadlineContext } = await import('../src/utils/public-station-deadline');
const { registerGenresCountriesRoutes } = await import('../src/routes/genres-countries-routes');
const app: any = { use() {} };
for (const method of ['get', 'post', 'put', 'delete']) app[method] = (path: string, ...callbacks: any[]) => {
  handlers.set(`${method}:${path}`, callbacks.findLast(callback => callback.length !== 4));
};
registerGenresCountriesRoutes(app as Express, { requireAdmin() {} });

async function invoke(method = 'get', path = '/api/genres/precomputed', input: any = {}) {
  const response: any = { statusCode: 200, headers: {},
    status(code: number) { this.statusCode = code; return this; },
    set(key: string, value: string) { this.headers[key] = value; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  await handlers.get(`${method}:${path}`)({ query: {}, params: {}, body: {}, ...input }, response);
  return response;
}
beforeEach(() => {
  entries.clear(); clears.length = 0; reads = []; legacyRefreshes = 0; writeFailure = cacheFailure = readFailure = false;
  whitelist.clear(); for (const slug of ['rock', 'pop', 'jazz']) whitelist.add(slug);
  rows = [{ _id: 'rock-id', slug: 'rock', name: 'Rock', stationCount: 20 },
    { _id: 'pop-id', slug: 'pop', name: 'Pop', stationCount: 30 }];
});
after(() => mock.restoreAll());

test('computedAt belongs to the cached generation, not the HTTP response time', async () => {
  let now = 1_000_000;
  const clock = mock.method(Date, 'now', () => now);
  try {
    const first = await invoke(); now += 500;
    const second = await invoke();
    assert.equal(first.body.computedAt, 1_000_000);
    assert.deepEqual(second.body, first.body);
    assert.equal(reads.length, 1);
    now += 60_000; rows[0].name = 'Updated Rock';
    const refreshed = await invoke();
    assert.equal(refreshed.body.computedAt, now); assert.equal(reads.length, 2);
    assert.equal(refreshed.body.data[1].name, 'Updated Rock');
  } finally { clock.mock.restore(); }
});

test('array consumers share one generation across page/search while countries stay isolated', async () => {
  const native = await getCachedPublicGenres();
  assert.ok(Array.isArray(native)); const original = structuredClone(native);
  const first = await invoke('get', undefined, { query: { limit: '1' } });
  const second = await invoke('get', undefined, { query: { page: '2', limit: '1', search: 'rock' } });
  assert.equal(first.body.computedAt, second.body.computedAt);
  assert.equal(reads.length, 1); assert.deepEqual(native, original);
  await invoke('get', undefined, { query: { country: 'Germany' } });
  assert.deepEqual(reads, ['global', 'Germany']);
});

test('snapshot metadata survives serialization and does not consume former array-only cache entries', async () => {
  entries.set(`public-health:v2:genres:precomputed:native-v1:global:whitelist-${publicGenreWhitelistVersion()}`,
    { value: ['legacy'], expiresAt: Infinity });
  const first = await invoke();
  for (const [key, value] of entries) if (key.includes('native-v2:')) entries.set(key, JSON.parse(JSON.stringify(value)));
  const second = await invoke();
  assert.deepEqual(second.body, first.body); assert.equal(reads.length, 1);
  assert.ok((await getCachedPublicGenres()).every(genre => typeof genre.slug === 'string'));
});

test('inherited health deadlines are not renewed by snapshot hits or array consumers', async () => {
  let now = 1_000_000;
  const clock = mock.method(Date, 'now', () => now);
  try {
    await publicStationDeadlineContext.run({ expiresAt: now + 10_000 }, () => getCachedPublicGenres());
    now += 9_000; await invoke(); assert.equal(reads.length, 1);
    now += 1_001; await getCachedPublicGenres(); assert.equal(reads.length, 2);
  } finally { clock.mock.restore(); }
});

test('whitelist revisions replace the generation and concurrent array consumers coalesce', async () => {
  await Promise.all(Array.from({ length: 12 }, () => getCachedPublicGenres()));
  assert.equal(reads.length, 1);
  whitelist.delete('rock'); await invoke(); assert.equal(reads.length, 2);
});

test('failed reads do not publish a synthetic snapshot and the next request retries', async () => {
  readFailure = true;
  const failed = await invoke(); assert.equal(failed.statusCode, 503); assert.equal(entries.size, 0);
  readFailure = false; assert.equal((await invoke()).statusCode, 200); assert.equal(reads.length, 2);
});

for (const [method, path, input] of [
  ['post', '/api/genres', { body: { name: 'Jazz', slug: 'jazz' } }],
  ['put', '/api/genres/:id', { params: { id: 'rock-id' }, body: { name: 'Edited Rock', slug: 'jazz' } }],
  ['delete', '/api/genres/:id', { params: { id: 'rock-id' } }],
] as const) {
  test(`${method} invalidates active public genre families instead of rebuilding the unused legacy cache`, async () => {
    await invoke(); await invoke('get', undefined, { query: { country: 'Germany' } });
    for (const key of ['genres:1:9:filters', 'genres:discoverable:country:13', 'genre-slug:membership-v2:rock',
      'genre-stations:slug-v2:rock:all:1:20']) entries.set(`public-health:v2:${key}`, 'old');
    entries.set('translations:en', 'keep'); entries.set('public-health:v2:stations:linked:other', 'keep');
    const response = await invoke(method, path, input);
    assert.equal(response.statusCode, method === 'post' ? 201 : 200);
    assert.equal(legacyRefreshes, 0);
    assert.deepEqual(clears.sort(), ['public-health:v2:genre-slug:', 'public-health:v2:genre-stations:', 'public-health:v2:genres:']);
    assert.deepEqual([...entries.keys()].sort(), ['public-health:v2:stations:linked:other', 'translations:en']);
    const refreshed = await invoke(); assert.equal(reads.length, 3);
    assert.deepEqual(refreshed.body.data.map((row: any) => row.slug).sort(), rows.map(row => row.slug).sort());
  });
  test(`${method} preserves the committed response when cache invalidation fails`, async () => {
    cacheFailure = true;
    const response = await invoke(method, path, input);
    assert.equal(response.statusCode, method === 'post' ? 201 : 200);
    assert.equal(clears.length, 3);
  });
  test(`${method} does not invalidate on a failed write`, async () => {
    writeFailure = true;
    assert.equal((await invoke(method, path, input)).statusCode, 500);
    assert.equal(clears.length, 0); assert.equal(legacyRefreshes, 0);
  });
}

test('validation and missing genre responses do not invalidate any cache', async () => {
  assert.equal((await invoke('post', '/api/genres', { body: { name: 'Bad', slug: 'Not Valid' } })).statusCode, 400);
  assert.equal((await invoke('put', '/api/genres/:id', { params: { id: 'missing' }, body: { name: 'Missing' } })).statusCode, 404);
  assert.equal((await invoke('delete', '/api/genres/:id', { params: { id: 'missing' } })).statusCode, 404);
  assert.equal(clears.length, 0);
});
