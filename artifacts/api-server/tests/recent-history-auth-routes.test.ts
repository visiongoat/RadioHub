import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const histories = new Map<string, any[]>();
const writes: Array<[string, string]> = [];
const favoriteReads: unknown[][]=[];
const entries = new Map<string, any>();
mock.module('../src/postgres-runtime', { namedExports: {
  getPostgresPool: () => { throw new Error('No real database access allowed'); },
  getPostgresCoordinationPool: () => { throw new Error('No real database access allowed'); },
} });
mock.module('../src/cache', { defaultExport: {
  get: async (key: string) => entries.get(key) ?? null,
  set: async (key: string, value: any) => { entries.set(key, value); },
  clearByPattern: async (prefix: string) => {
    for (const key of entries.keys()) if (key.includes(prefix)) entries.delete(key);
  },
}, namedExports: { CacheKeys: {} } });
mock.module('../src/data/auth-token-store', { namedExports: {
  findActiveAuthToken: async (token: string) => token === 'viewer-token' ? { userId: 'viewer' }
    : token === 'other-token' ? { userId: 'other' } : null,
  ensurePostgresUser: async () => {},
} });
mock.module('../src/data/postgres-engagement-store', { namedExports: {
  pgRecentlyPlayedStations: async (id: string) => histories.get(id) || [],
  pgAddRecentlyPlayed: async (id: string, stationId: string) => {
    writes.push([id, stationId]); histories.set(id, [{ _id: stationId, name: 'New station' }]); return true;
  },
  pgFavoriteStationsForUser: async (...args:unknown[]) => {favoriteReads.push(args);return {stations:[{_id:'favorite',name:'Favorite',urlBackup:'https://stream.invalid/backup',favoritedAt:'2026-11-24T10:00:00Z'}],total:1};}, pgFindStationRating: async () => null,
  pgIsFavorite: async () => false, pgRateStationIdentity: async () => ({}), pgStationRatingsDetailed: async () => ({}),
} });
mock.module('../src/services/user-engagement-service', { namedExports: { UserEngagementService: class {} } });
mock.module('../src/services/community-profiles', { namedExports: { getCommunityProfiles: async () => [] } });
mock.module('../src/services/sync', { namedExports: { syncService: {} } });
const userStore=await import('../src/data/postgres-user-store');
mock.module('../src/data/postgres-user-store',{namedExports:{...userStore,
 pgFindUserByIdOrSlug:async(id:string)=>['public','private'].includes(id)?{_id:id,isPublicProfile:id==='public'}:null,
}});
mock.module('../src/routes/cache-refresh-utils', { namedExports: {
  refreshCommunityFavoritesCache: async () => {}, fetchTranslationsForLanguage: async () => ({}), refreshTranslationsCache: async () => {},
} });

let server: Server;
let base: string;
before(async () => {
  const { registerTranslationAdminRoutes } = await import('../src/routes/translation-admin-routes');
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = req.headers['x-fixture-user'] ? { userId: String(req.headers['x-fixture-user']) } : {};
    next();
  });
  const reject = (_req: any, res: any) => res.status(401).end();
  registerTranslationAdminRoutes(app, { requireAuth:(req:any,res:any,next:any)=>req.session?.userId?next():reject(req,res), requireAdmin: reject });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/recently-played`;
});
beforeEach(() => {
  entries.clear(); writes.length = 0; histories.clear();favoriteReads.length=0;
  histories.set('viewer', [{ _id: 'viewer-station', name: 'Viewer station' }]);
  histories.set('other', [{ _id: 'other-station', name: 'Other station' }]);
});

test('favorites compact mode is strict opt-in and retains legacy authentication/envelopes',async()=>{
 const url=base.replace('/api/recently-played','/api/user/favorites');
 assert.equal((await fetch(url+'?slim=1')).status,401);assert.equal(favoriteReads.length,0);
 const headers={'x-fixture-user':'viewer'};
 const legacy=await fetch(url,{headers});assert.equal(legacy.status,200);assert.ok(Array.isArray(await legacy.json()));assert.deepEqual(favoriteReads.at(-1),['viewer','newest',0,0,false]);
 const compact=await fetch(url+'?slim=1&page=1&limit=2&sort=oldest',{headers});assert.equal(compact.status,200);const body=await compact.json();assert.equal(body.stations[0].favoritedAt,'2026-11-24T10:00:00Z');assert.equal(body.pagination.total,1);assert.deepEqual(favoriteReads.at(-1),['viewer','oldest',1,2,true]);
 await fetch(url+'?slim=true',{headers});assert.equal(favoriteReads.at(-1)![4],false);
});

test('profile favorites isolate compact cache from legacy fields and keep private-profile checks before warm cache',async()=>{
 const url=base.replace('/api/recently-played','/api/users/public/favorites');
 const legacy=await(await fetch(url)).json();assert.equal(legacy[0].urlBackup,undefined);assert.equal(favoriteReads.at(-1)![4],false);
 const compact=await(await fetch(url+'?slim=1')).json();assert.equal(compact[0].urlBackup,'https://stream.invalid/backup');assert.equal(favoriteReads.at(-1)![4],true);
 assert.equal((await(await fetch(url)).json())[0].urlBackup,undefined,'a compact response cannot poison the legacy cache');
 const privateUrl=url.replace('/public/','/private/')+'?slim=1';const before=favoriteReads.length;
 assert.equal((await fetch(privateUrl)).status,404);assert.equal(favoriteReads.length,before);
 assert.equal((await fetch(privateUrl,{headers:{'x-fixture-user':'private'}})).status,200);
 assert.equal((await fetch(privateUrl)).status,404,'a warmed owner response stays private');
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  mock.restoreAll();
});

test('recent history recognizes bearer sessions and isolates cached account histories', async () => {
  for (const [headers, expected] of [
    [{ authorization: 'Bearer viewer-token' }, 'viewer-station'],
    [{ authorization: 'Bearer other-token' }, 'other-station'],
    [{ 'x-fixture-user': 'viewer' }, 'viewer-station'],
  ] as const) {
    const response = await fetch(base, { headers });
    assert.equal(response.status, 200); assert.equal((await response.json())[0]._id, expected);
  }
  for (const headers of [{}, { authorization: 'Bearer invalid-token' }]) {
    const response = await fetch(base, { headers });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), []);
  }
});

test('bearer playback updates only the current history and invalidates its warm cache', async () => {
  const headers = { authorization: 'Bearer viewer-token', 'content-type': 'application/json' };
  await fetch(base, { headers });
  const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ stationId: 'latest-station' }) });
  assert.equal(response.status, 200); assert.deepEqual(writes, [['viewer', 'latest-station']]);
  assert.equal((await (await fetch(base, { headers })).json())[0]._id, 'latest-station');
  assert.equal((await (await fetch(base, { headers: { authorization: 'Bearer other-token' } })).json())[0]._id, 'other-station');
  const anonymous = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stationId: 'anonymous-station' }) });
  assert.equal(anonymous.status, 204); assert.equal(writes.length, 1);
});
