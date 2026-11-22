import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const entries = new Map<string, any>();
const cacheKeys: string[] = [];
const queries: string[] = [];
let rows: Record<string, any>[] = [];
const scope = { country: null, genres: [] };
const row = (id: string, nativeFlag: boolean | null | undefined, sourceFlag?: boolean) => ({
  id, slug: id, name: id, url: 'https://stream.invalid/live', country: 'Germany',
  no_index: nativeFlag, is_list_visible: true, votes: 1, total_favorites: 1, trending_score: 1,
  source: { ...(sourceFlag === undefined ? {} : { noIndex: sourceFlag }), privateNotes: 'PRIVATE_SOURCE' },
});

mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({
  query: async (query: string | { text: string }) => {
    const sql = typeof query === 'string' ? query : query.text;
    queries.push(sql);
    assert.match(sql.trim(), /^(?:SELECT|WITH)\b/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i, 'Discovery only reads the catalogue');
    const visibilityConditions = sql.match(/\bWHERE\s+([\s\S]*?)(?:\bORDER BY\b|\bGROUP BY\b|$)/i)?.[1] || '';
    assert.doesNotMatch(visibilityConditions, /\bno_index\b/, 'Noindex is not a public playback visibility filter');
    // A raw-row fixture must not supply a column the real SQL omitted.
    assert.match(sql, /SELECT s\.\*|s\.no_index/);
    return { rows, rowCount: rows.length };
  },
}) } });
mock.module('../src/public-station-cache', { namedExports: { publicStationCache: {
  getOrSetSingleFlight: async (key: string, loader: () => Promise<any>) => {
    cacheKeys.push(key);
    if (!entries.has(key)) entries.set(key, await loader());
    return entries.get(key);
  },
} } });

// Keep the actual SQL, native row mappers, DTO projections and SSR filter.
const { getRecommendationPool } = await import('../src/services/recommendation-pool');
const { pgTrendingStations } = await import('../src/data/postgres-engagement-store');
const { loadPublicDiscoveryStations } = await import('../src/seo/public-discovery');
beforeEach(() => { entries.clear(); cacheKeys.length = 0; queries.length = 0; rows = []; });

for (const kind of ['recommendations', 'trending'] as const) {
  test(`${kind}: native no_index survives real row projection without removing playable UI entries`, async () => {
    rows = [row('eligible-radio', false, true), row('excluded-radio', true, false),
      row('native-only-excluded', true), row('unknown-radio', null, false), row('missing-radio', undefined, false)];
    const ui = kind === 'recommendations' ? (await getRecommendationPool(scope)).stations
      : (await pgTrendingStations(undefined, 24)).trending.map((item: any) => item.station);
    assert.equal(ui.length, rows.length, 'The public UI still receives every playable station');
    assert.deepEqual(ui.map((station: any) => station.noIndex), [false, true, true, null, undefined]);
    assert.equal(ui[1].url, rows[1].url, 'Noindex does not disable playback');
    for (let pass = 0; pass < 2; pass++) {
      const seo = await loadPublicDiscoveryStations(kind);
      assert.deepEqual(seo.map(station => station.slug), ['eligible-radio']);
      assert.doesNotMatch(JSON.stringify(seo), /PRIVATE_SOURCE|excluded|unknown-radio|missing-radio/);
    }
  });

  test(`${kind}: old cached cards without native eligibility cannot bypass the SSR filter after deployment`, async () => {
    rows = [row('excluded-radio', true, false)];
    const legacy = { _id: rows[0].id, slug: rows[0].slug, name: rows[0].name,
      url: rows[0].url, isListVisible: true };
    const oldKey = kind === 'recommendations' ? `recommendations:pool:v1:${JSON.stringify(scope)}` : 'seo:trending:24';
    entries.set(oldKey, kind === 'recommendations' ? { stations: [legacy] }
      : { trending: [{ stationId: legacy._id, station: legacy }] });
    assert.deepEqual(await loadPublicDiscoveryStations(kind), []);
    assert.equal(queries.length, 1, 'Read the native flag instead of trusting the legacy cache');
    assert.equal(cacheKeys.includes(oldKey), false);
    assert.equal(entries.has(oldKey), true, 'Do not purge unrelated rolling-deployment caches');
    assert.deepEqual(await loadPublicDiscoveryStations(kind), []);
    assert.equal(queries.length, 1, 'The new projection is reusable');
  });
}
