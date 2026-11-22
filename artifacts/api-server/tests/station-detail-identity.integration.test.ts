import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import type { Express } from 'express';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';
import { assertRecoverableStation, getStreamRecoverySnapshot } from '../src/utils/station-health-recovery';

describe('station detail invalidation through native identity projections and warmed readers', { skip: !process.env.PG_TEST_DATABASE_URL }, () => {
  let fixture: Awaited<ReturnType<typeof createNativePostgresFixture>>;
  let cache: typeof import('../src/public-station-cache').publicStationCache;
  let catalog: ReturnType<typeof import('../src/data/postgres-catalog-store').pgCatalog>;
  let store: InstanceType<typeof import('../src/data/postgres-logo-variant-store').PostgresLogoVariantStore>;
  let invalidateLogo: typeof import('../src/services/logo-variant-cache').invalidateLogoVariantCaches;
  let detailKey: typeof import('../src/services/station-detail-cache').stationDetailCacheKey;
  const callbacks = new Map<string, any>();
  const id = 'a'.repeat(24), otherId = 'b'.repeat(24), mergedId = 'c'.repeat(24);
  const identities = [id, 'native-radio-uuid', 'vienna-jazz', 'old-vienna-jazz', mergedId, 'merged-radio-uuid'];
  const assets = { status: 'completed', folder: 'vienna-jazz', original: 'original.png', webp256: '256.webp' };
  const source = { marker: 'keep-source', mergedStationIds: [mergedId], mergedStationUuids: ['merged-radio-uuid'] };
  const descriptionBody = { slug: 'vienna-jazz', changes: [{ locale: 'en', field: 'meta', value: 'Edited meta',
    expectedCurrentValue: 'Original meta', expectedLocaleObject: { full: 'Retained article', meta: 'Original meta' } }] };
  before(async () => {
    mock.module('../src/utils/station-health-recovery', { namedExports: { assertRecoverableStation, getStreamRecoverySnapshot,
      probeStationStream: async () => ({ checkedAt: new Date().toISOString(), contentType: 'audio/mpeg', bytesRead: 2048 }),
    } });
    fixture = await createNativePostgresFixture('detail_identities');
    cache = (await import('../src/public-station-cache')).publicStationCache;
    detailKey = (await import('../src/services/station-detail-cache')).stationDetailCacheKey;
    catalog = (await import('../src/data/postgres-catalog-store')).pgCatalog();
    const { PostgresLogoVariantStore } = await import('../src/data/postgres-logo-variant-store');
    store = new PostgresLogoVariantStore(fixture.pool);
    invalidateLogo = (await import('../src/services/logo-variant-cache')).invalidateLogoVariantCaches;
    const app: any = { use() {} };
    for (const method of ['get', 'post', 'put', 'patch']) app[method] = (path: string, ...handlers: any[]) => {
      callbacks.set(`${method}:${path}`, handlers.findLast(handler => handler.length !== 4));
    };
    const requireAdmin = () => {};
    (await import('../src/routes/station-public-routes')).registerPublicStationRoutes(app as Express, { requireAdmin });
    (await import('../src/routes/admin-description-routes')).registerAdminDescriptionRoutes(app as Express, requireAdmin);
    (await import('../src/routes/admin-stream-health-routes')).registerAdminStreamHealthRoutes(app as Express, requireAdmin);
    (await import('../src/routes/admin-station-redirect-routes')).registerAdminStationRedirectRoutes(app as Express, requireAdmin);
  });
  beforeEach(async () => {
    await cache.clearByPattern('station:detail:');
    await fixture.clear('stations');
    await fixture.insert('stations', { _id: id, stationuuid: identities[1], name: 'Vienna Jazz', slug: identities[2],
      slugAliases: [identities[3]], url: 'https://stream.invalid/live', country: 'Austria', countryCode: 'AT', tags: 'jazz', bitrate: 128,
      noIndex: false, lastCheckOk: true, isListVisible: true, logoAssets: assets,
      descriptions: { en: { full: 'Retained article', meta: 'Original meta' } }, source });
    await fixture.insert('stations', { _id: otherId, stationuuid: 'other-native-uuid', name: 'Other Radio', slug: 'other-radio',
      url: 'https://stream.invalid/other', noIndex: false, isListVisible: true });
    for (const alias of [mergedId, identities[5]]) await fixture.insert('station_merge_aliases', { alias, station_id: id });
  });
  after(async () => { await cache?.clearByPattern('station:detail:'); await fixture?.close(); mock.restoreAll(); });
  async function invoke(method: string, path: string, input: any = {}) {
    const response: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; },
      set() { return this; }, json(body: unknown) { this.body = body; return this; } };
    await callbacks.get(`${method}:${path}`)({ params: { id }, query: {}, body: {}, ...input }, response);
    return response;
  }
  const read = (identifier: string) => invoke('get', '/api/station/:identifier', { params: { identifier } });
  async function warm() {
    for (const identifier of [...identities, otherId]) {
      const response = await read(identifier); assert.equal(response.statusCode, 200, identifier);
      assert.ok(await cache.get(detailKey(identifier)), `actual detail reader warmed ${identifier}`);
    }
  }
  async function assertUpdated(check: (body: any) => void) {
    for (const identifier of identities) {
      assert.equal(await cache.get(detailKey(identifier)), null, `invalidated ${identifier}`);
      const response = await read(identifier); assert.equal(response.statusCode, 200); check(response.body);
    }
    assert.ok(await cache.get(detailKey(otherId)), 'unrelated detail remains warm');
  }

  it('returns real taxonomy for raw-null station detail through every canonical/legacy identity without writes', async () => {
    await fixture.pool.query("UPDATE stations SET tags_raw=NULL,source=source-'genres'-'genre' WHERE id=$1", [id]);
    await fixture.insert('station_genres', { station_id: id, genre_slug: 'dance', position: 2 });
    await fixture.insert('station_genres', { station_id: id, genre_slug: 'pop', position: 1 });
    await fixture.insert('station_genres', { station_id: otherId, genre_slug: 'religious', position: 0 });
    const before = (await fixture.pool.query('SELECT * FROM stations WHERE id=$1', [id])).rows[0];
    await cache.set(`station:detail:editorial-v2:${id}`, { _id: id, tags: null }, { ttl: 60 });
    for (const identifier of identities) {
      const response = await read(identifier);
      assert.equal(response.statusCode, 200, identifier); assert.equal(response.body._id, id);
      assert.equal(response.body.tags, null); assert.deepEqual(response.body.genres, ['pop', 'dance']);
      assert.equal(response.body.genre, undefined); assert.equal(response.body._catalog_genres, undefined);
    }
    const { getStationByIdentifier } = await import('../src/data/station-read-store');
    const runtime = await import('../src/postgres-runtime');
    const pool = runtime.getPostgresPool(), query = pool.query.bind(pool), calls: string[] = [];
    const spy = mock.method(pool, 'query', ((text: string, ...args: any[]) => {
      calls.push(text); return (query as any)(text, ...args);
    }) as any);
    try {
      const station = await getStationByIdentifier(mergedId);
      assert.deepEqual(station.genres, ['pop', 'dance']); assert.equal(calls.length, 1, 'one detail query, no N+1 genre request');
      assert.match(calls[0], /WHERE sg\.station_id=resolved\.id ORDER BY sg\.position,sg\.genre_slug LIMIT 20/);
    } finally { spy.mock.restore(); }
    assert.deepEqual((await fixture.pool.query('SELECT * FROM stations WHERE id=$1', [id])).rows[0], before);
    assert.deepEqual((await fixture.pool.query('SELECT genre_slug FROM station_genres WHERE station_id=$1 ORDER BY position', [id])).rows.map(row=>row.genre_slug), ['pop', 'dance']);
    assert.ok(await cache.get(`station:detail:editorial-v2:${id}`), 'old payload is ignored through a new detail-only namespace');
  });
  it('keeps authoritative memberships and faith boundaries while case-deduplicating legacy genres and leaving raw tags untouched', async () => {
    await fixture.pool.query("UPDATE stations SET source=source||$2::jsonb,tags_raw='raw source remains' WHERE id=$1", [id,
      JSON.stringify({genre:'Jazz',genres:[' Pop ','Ｒ－Ｂ','rnb','QURAN','Legacy Mix','',5]})]);
    await fixture.insert('station_genres', { station_id: id, genre_slug: 'r-b', position: 0 });
    await fixture.insert('station_genres', { station_id: id, genre_slug: 'pop', position: 1 });
    await fixture.insert('station_genres', { station_id: id, genre_slug: 'quran', position: 2 });
    await fixture.insert('station_genres', { station_id: id, genre_slug: 'christian', position: 3 });
    await fixture.insert('station_genres', { station_id: id, genre_slug: 'religious', position: 4 });
    const response = await read(id);
    assert.deepEqual(response.body.genres, ['r-b','pop','quran','christian','religious','rnb','Legacy Mix']);
    assert.equal(response.body.genre, 'Jazz'); assert.equal(response.body.tags, 'raw source remains');
    assert.deepEqual((await fixture.pool.query('SELECT source FROM stations WHERE id=$1', [id])).rows[0].source.genres, [' Pop ','Ｒ－Ｂ','rnb','QURAN','Legacy Mix','',5]);
    const legacy = await read(otherId); assert.deepEqual(legacy.body.genres, [], 'genuinely unclassified sources remain unclassified');
  });
  it('caps the indexed canonical membership projection at twenty stable position-ordered genres', async () => {
    for (let i=0;i<25;i++) await fixture.insert('station_genres', {station_id:id,genre_slug:`style-${String(i).padStart(2,'0')}`,position:24-i});
    const response = await read(id);
    assert.equal(response.body.genres.length,20);
    assert.deepEqual(response.body.genres,Array.from({length:20},(_,i)=>`style-${String(24-i).padStart(2,'0')}`));
  });

  it('logo store projection invalidates UUID and merged aliases used by the actual detail reader', async () => {
    await warm();
    const [station] = await store.findByIds([id]);
    assert.equal(station.stationuuid, identities[1]); assert.deepEqual(station.mergedStationIds, [mergedId]);
    assert.deepEqual(station.mergedStationUuids, [identities[5]]);
    assert.equal(await store.appendVariants(station, { webp96: '96.webp' }), true);
    await invalidateLogo(station);
    await assertUpdated(body => assert.equal(body.logoAssets.webp96, '96.webp'));
    const stored = (await fixture.pool.query('SELECT source FROM stations WHERE id=$1', [id])).rows[0].source;
    assert.equal(stored.marker, source.marker); assert.deepEqual(stored.mergedStationIds, source.mergedStationIds);
  });
  it('redirect projection clears warmed merged aliases while the native mutation remains redirect-only', async () => {
    await fixture.pool.query("UPDATE stations SET redirect_to_slug='old-target' WHERE id=$1", [id]);
    await warm();
    const before = (await fixture.pool.query('SELECT * FROM stations WHERE id=$1', [id])).rows[0];
    const response = await invoke('put', '/api/admin/stations/:id/redirect', {
      body: { targetSlug: null, expectedRedirectToSlug: 'old-target' },
    });
    assert.equal(response.statusCode, 200); assert.equal(response.body.cacheInvalidated, true);
    await assertUpdated(body => assert.equal(body.redirectToSlug, null));
    const after = (await fixture.pool.query('SELECT * FROM stations WHERE id=$1', [id])).rows[0];
    assert.deepEqual({ ...after, redirect_to_slug: before.redirect_to_slug, updated_at: before.updated_at, source: before.source }, before);
    assert.deepEqual(after.source, { ...before.source, redirectToSlug: null });
  });
  it('description RETURNING * retains source identities for warmed alias invalidation', async () => {
    await warm();
    const response = await invoke('patch', '/api/admin/stations/:id/descriptions', { body: descriptionBody });
    assert.equal(response.statusCode, 200); assert.equal(response.body.cacheInvalidated, true);
    await assertUpdated(body => assert.equal(body.descriptions.en.meta, 'Edited meta'));
  });
  it('health recovery RETURNING * retains source identities for warmed alias invalidation', async () => {
    await fixture.pool.query('UPDATE stations SET no_index=true,last_check_ok=false WHERE id=$1', [id]);
    await warm();
    const station = await catalog.findById(id);
    const response = await invoke('post', '/api/admin/stations/:id/recover-stream-health', {
      body: { confirmRecovery: true, expected: getStreamRecoverySnapshot(station) },
    });
    assert.equal(response.statusCode, 200); assert.equal(response.body.cacheInvalidated, true);
    await assertUpdated(body => assert.equal(body.noIndex, false));
  });
  it('malformed archived merge lists cannot convert a committed description edit into 503', async () => {
    await fixture.pool.query("UPDATE stations SET source=source||'{\"mergedStationIds\":123,\"mergedStationUuids\":\"not-an-array\"}'::jsonb WHERE id=$1", [id]);
    await warm();
    const response = await invoke('patch', '/api/admin/stations/:id/descriptions', { body: descriptionBody });
    assert.equal(response.statusCode, 200); assert.equal(response.body.cacheInvalidated, true);
    assert.equal((await read(id)).body.descriptions.en.meta, 'Edited meta');
    const [projected] = await store.findByIds([id]);
    assert.deepEqual(projected.mergedStationIds, []); assert.deepEqual(projected.mergedStationUuids, []);
    const stored = (await fixture.pool.query('SELECT source FROM stations WHERE id=$1', [id])).rows[0].source;
    assert.equal(stored.mergedStationIds, 123); assert.equal(stored.mergedStationUuids, 'not-an-array');
  });
});
