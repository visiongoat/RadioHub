import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const queries: any[] = [], cacheCalls: any[] = [];
const entries = new Map<string, any>();
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({ query: async (query: any) => {
  queries.push(query);
  return { rows: [{ id: 'a', name: 'Radio A', country: 'Austria', logo_assets: { webp96: '/a.webp' }, source: { genre: 'rock', privateNotes: 'not public' }, is_list_visible: true }] };
} }) } });
mock.module('../src/public-station-cache', { namedExports: { publicStationCache: { getOrSetSingleFlight: async (key: string, loader: () => Promise<any>, options: any) => {
  cacheCalls.push({ key, options });
  if (!entries.has(key)) entries.set(key, await loader());
  return entries.get(key);
} } } });
const { getRecommendationPool, recommendationPoolScope } = await import('../src/services/recommendation-pool');
beforeEach(() => { queries.length = 0; cacheCalls.length = 0; entries.clear(); });

test('normalizes global, ISO and localized countries and deduplicates exact genre slugs', () => {
  assert.deepEqual(recommendationPoolScope('Global', ''), { country: null, genres: [] });
  assert.deepEqual(recommendationPoolScope('at', 'rock,jazz,rock'), { country: 'Austria', genres: ['jazz', 'rock'] });
  assert.equal(recommendationPoolScope('Deutschland', '').country, 'Germany');
  assert.throws(() => recommendationPoolScope([], ''), /Invalid country/);
  assert.throws(() => recommendationPoolScope('Austria', 'rock%'), /Invalid genres/);
  assert.throws(() => recommendationPoolScope('Austria', Array(2).fill('rock')), /Invalid genres/);
  assert.throws(() => recommendationPoolScope('Austria', 'a,b,c,d,e,f,g,h,i'), /Invalid genres/);
});
test('uses a bounded quality order, native visibility and exact indexed genre membership, with no SQL random', async () => {
  const result = await getRecommendationPool(recommendationPoolScope('Austria', 'rock,jazz'));
  assert.deepEqual(queries[0].values, ['austria', ['jazz', 'rock']]);
  assert.match(queries[0].text, /LIMIT 100/);
  assert.match(queries[0].text, /WITH candidates AS MATERIALIZED/);
  const [candidateSql, projectionSql] = queries[0].text.split(')\n        SELECT');
  assert.doesNotMatch(candidateSql, /s\.source|jsonb_build_object/);
  assert.match(candidateSql, /LIMIT 100/);
  assert.match(projectionSql, /jsonb_build_object/);
  assert.match(projectionSql, /FROM candidates c JOIN stations s ON s.id=c.id/);
  assert.match(projectionSql, /ORDER BY c.votes DESC NULLS LAST,c.click_count DESC NULLS LAST,c.id/);
  assert.match(queries[0].text, /s\.votes DESC/);
  assert.match(queries[0].text, /s\.is_list_visible IS TRUE/);
  assert.match(queries[0].text, /station_genres/);
  assert.doesNotMatch(queries[0].text, /random\(/i);
  assert.equal(queries[0].query_timeout, 8000);
  assert.equal(result.total, 1);
  assert.deepEqual(result.stations[0].logoAssets, { webp96: '/a.webp' });
  assert.equal(result.stations[0].genre, 'rock');
  assert.ok(!JSON.stringify(result).includes('not public'));
});
test('reuses health-bounded shared pools and isolates country/genre scopes', async () => {
  await getRecommendationPool(recommendationPoolScope('at', 'jazz,rock'));
  await getRecommendationPool(recommendationPoolScope('Austria', 'rock,jazz'));
  assert.equal(queries.length, 1);
  assert.equal(cacheCalls[0].options.ttl, 60);
  await getRecommendationPool(recommendationPoolScope('Germany', 'rock,jazz'));
  await getRecommendationPool(recommendationPoolScope('Austria', 'jazz'));
  assert.equal(queries.length, 3);
  await getRecommendationPool(recommendationPoolScope('all', ''));
  assert.deepEqual(queries[3].values, []);
  assert.doesNotMatch(queries[3].text, /lower\(s.country\)=/);
});
