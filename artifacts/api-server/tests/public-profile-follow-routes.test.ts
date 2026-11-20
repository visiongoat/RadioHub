import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const cache = new Map<string, any>();
const relationships = new Set<string>();
const favorites = new Map<string, any[]>();
let writeFails = false;
let targetPublic = true;
const aliases = new Map([
  ['target', 'target'], ['target-slug', 'target'], ['target-name', 'target'],
  ['viewer', 'viewer'], ['viewer-slug', 'viewer'], ['other', 'other'],
]);
const cleared: string[] = [];
mock.module('../src/cache', { defaultExport: {
  get: async (key: string) => cache.get(key) ?? null,
  set: async (key: string, value: any) => { cache.set(key, value); },
  clearByPattern: async (prefix: string) => {
    cleared.push(prefix);
    for (const key of cache.keys()) if (key.includes(prefix)) cache.delete(key);
  },
} });
mock.module('../src/postgres-runtime', { namedExports: {
  getPostgresPool: () => { throw new Error('No real database access allowed'); },
} });
mock.module('../src/data/postgres-engagement-store', { namedExports: {
  pgFollowPage: async (id: string, direction: string, page: number, limit: number) => {
    const rows = [...relationships].filter(pair => direction === 'followers' ? pair.endsWith(`:${id}`) : pair.startsWith(`${id}:`))
      .map(pair => ({ user: { _id: pair.split(':')[direction === 'followers' ? 0 : 1] } }));
    return { [direction]: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: rows.length, pages: Math.ceil(rows.length / limit) } };
  },
  pgResolveUserId: async (value: string) => aliases.get(value) ?? null,
  pgPublicProfileCacheIdentity: async (value: string) => {
    const id = aliases.get(value);
    return id && (id !== 'target' || targetPublic) ? `${id}:revision-1` : null;
  },
  pgPublicProfile: async (value: string, viewer?: string) => {
    const id = aliases.get(value);
    return {
      _id: id, slug: `${id}-slug`, isPublic: true,
      followersCount: [...relationships].filter(pair => pair.endsWith(`:${id}`)).length,
      followingCount: [...relationships].filter(pair => pair.startsWith(`${id}:`)).length,
      isFollowing: relationships.has(`${viewer}:${id}`),
      favoriteStationsCount: (favorites.get(id || '') || []).length,
    };
  },
  pgSetFollow: async (follower: string, target: string, enabled: boolean) => {
    if (writeFails) throw new Error('Fixture write failed');
    if (enabled) relationships.add(`${follower}:${target}`);
    else relationships.delete(`${follower}:${target}`);
    return { success: true };
  },
  pgUserFavorites: async (value: string, page: number, limit: number) => {
    const rows = (favorites.get(aliases.get(value) || '') || []).filter(station => station.isListVisible !== false);
    return { favorites: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
  },
  pgRecentlyPlayed: async () => [],
  pgCommunityFavorites: async () => [], pgRateStation: async () => ({}),
  pgSetFavorite: async (id: string, stationId: string, enabled: boolean) => {
    if (writeFails) throw new Error('Fixture write failed');
    const rows = (favorites.get(id) || []).filter(station => station._id !== stationId);
    favorites.set(id, enabled ? [{ _id: stationId, name: stationId }, ...rows] : rows);
    return { success: true };
  },
  pgStationRatings: async () => [], pgTrendingStations: async () => [],
} });
mock.module('../src/services/community-profiles', { namedExports: {
  getCommunityProfiles: async () => [], invalidateCommunityProfiles: async () => {},
} });
mock.module('../src/data/auth-token-store', { namedExports: {
  findActiveAuthToken: async (token: string) => token === 'viewer-token' ? { userId: 'viewer' }
    : token === 'other-token' ? { userId: 'other' } : null,
  ensurePostgresUser: async () => {},
} });
mock.module('../src/data/postgres-user-store', { namedExports: {
  pgFindUserById: async (id: string) => ({ _id: id, fullName: 'Fixture listener', slug: `${id}-slug` }),
  pgUserFollowCounts: async (id:string) => ({followersCount:[...relationships].filter(pair=>pair.endsWith(':'+id)).length,followingCount:[...relationships].filter(pair=>pair.startsWith(id+':')).length}),
  newPublicUserId: () => 'notification', userStore: 'postgres',
} });
mock.module('../src/services/pushNotificationService', { namedExports: {
  PushNotificationService: { sendFollowNotification: async () => {} },
} });
mock.module('../src/data/postgres-notification-store', { namedExports: {
  notificationStore: 'postgres', pgCreateNotification: async () => {},
} });
mock.module('../src/utils/quota-guard', { namedExports: {
  isQuotaExceeded: () => false, handleQuotaError() {}, isQuotaError: () => false, safeWrite() {},
} });

let server: Server;
let base: string;
before(async () => {
  const { userEngagementRouter } = await import('../src/routes/user-engagement');
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const kind = req.headers['x-fixture-session'];
    req.session = kind === 'direct' ? { userId: 'viewer' }
      : kind === 'nested' ? { user: { userId: 'viewer' } }
        : kind === 'passport' ? { passport: { user: 'viewer' } } : {};
    if (kind === 'attached') req.user = { _id: 'viewer' };
    next();
  });
  app.use('/engagement', userEngagementRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/engagement`;
});
beforeEach(() => { cache.clear(); relationships.clear(); favorites.clear(); cleared.length = 0; writeFails = false; targetPublic = true; });
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  mock.restoreAll();
});
const bearer = { authorization: 'Bearer viewer-token' };
async function getProfile(value = 'target-slug', full = false, headers: Record<string, string> = bearer) {
  const response = await fetch(`${base}/profile/${value}${full ? '/full' : ''}`, { headers });
  assert.equal(response.status, 200);
  const body = await response.json();
  return full ? body.profile : body;
}

test('profile and full reads identify bearer and every supported session without mixing viewer caches', async () => {
  relationships.add('viewer:target');
  for (const full of [false, true]) {
    assert.equal((await getProfile('target-slug', full, {})).isFollowing, false);
    assert.equal((await getProfile('target-slug', full)).isFollowing, true);
    for (const kind of ['direct', 'nested', 'passport', 'attached']) {
      assert.equal((await getProfile('target-name', full, { 'x-fixture-session': kind })).isFollowing, true);
    }
    assert.equal((await getProfile('target', full, { authorization: 'Bearer other-token' })).isFollowing, false);
    assert.equal((await getProfile('target', full, {})).isFollowing, false);
  }
});

test('follow and unfollow refresh warm alias caches for both users and all viewers while preserving unrelated profiles', async () => {
  for (const full of [false, true]) {
    assert.equal((await getProfile('target-slug', full)).isFollowing, false);
    assert.equal((await getProfile('target-name', full, {})).followersCount, 0);
    assert.equal((await getProfile('viewer-slug', full)).followingCount, 0);
    await getProfile('other', full);
  }
  const unrelatedKeys = [...cache.keys()].filter(key => key.includes(':other:revision-1:'));
  assert.equal(unrelatedKeys.length, 2);
  assert.equal((await fetch(`${base}/follow/target-name`, { method: 'POST', headers: bearer })).status, 200);
  for (const full of [false, true]) {
    assert.equal((await getProfile('target', full)).isFollowing, true);
    assert.equal((await getProfile('target-slug', full, {})).followersCount, 1);
    assert.equal((await getProfile('viewer-slug', full)).followingCount, 1);
  }
  assert.equal((await fetch(`${base}/unfollow/target-slug`, { method: 'POST', headers: bearer })).status, 200);
  for (const full of [false, true]) {
    assert.equal((await getProfile('target-name', full)).isFollowing, false);
    assert.equal((await getProfile('target', full, {})).followersCount, 0);
    assert.equal((await getProfile('viewer', full)).followingCount, 0);
  }
  assert.ok(unrelatedKeys.every(key => cache.has(key)));
  assert.equal(cleared.filter(key=>!key.startsWith('notifications:postgres:')).length,8);
  assert.ok(cleared.includes('notifications:postgres:target:'));
});

test('failed or unauthenticated follows do not change follow state or evict warm profiles', async () => {
  await getProfile();
  const before = [...cache.entries()];
  assert.equal((await fetch(`${base}/follow/target`, { method: 'POST' })).status, 401);
  writeFails = true;
  assert.equal((await fetch(`${base}/follow/target`, { method: 'POST', headers: bearer })).status, 500);
  assert.equal(relationships.size, 0);
  assert.deepEqual([...cache.entries()], before);
  assert.deepEqual(cleared, []);
});

test('canonical cache keys retain live privacy checks on every profile request', async () => {
  await getProfile('target-slug');
  await getProfile('target-name', true);
  targetPublic = false;
  for (const path of ['target', 'target-slug/full']) {
    assert.equal((await fetch(`${base}/profile/${path}`, { headers: bearer })).status, 404);
  }
});

test('own favorite changes refresh warm profile summaries, full content and paged favorites without evicting another user', async () => {
  favorites.set('viewer', [{ _id: 'first', name: 'first' }, { _id: 'second', name: 'second' }]);
  favorites.set('target', [{ _id: 'unrelated', name: 'unrelated' }]);
  const readFavorites = async (alias: string, query = '') => {
    const response = await fetch(`${base}/profile/${alias}/favorites${query}`, { headers: bearer });
    assert.equal(response.status, 200); return response.json();
  };
  const readFull = async () => {
    const response = await fetch(`${base}/profile/viewer-slug/full`, { headers: bearer });
    assert.equal(response.status, 200); return response.json();
  };
  assert.equal((await getProfile('viewer')).favoriteStationsCount, 2);
  assert.equal((await readFull()).favorites.length, 2);
  assert.equal((await readFavorites('viewer-slug', '?page=2&limit=1')).favorites[0]._id, 'second');
  await readFavorites('target-slug');
  const unrelatedKeys = [...cache.keys()].filter(key => key.includes(':target:revision-1:'));
  assert.equal(unrelatedKeys.length, 1);

  for (const [action, total, expected] of [['remove', 1, ['second']], ['add', 2, ['first', 'second']]] as const) {
    const response = await fetch(`${base}/stations/first/favorite`, {
      method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify({ action }),
    });
    assert.equal(response.status, 200);
    assert.equal((await getProfile('viewer')).favoriteStationsCount, total);
    const full = await readFull();
    assert.equal(full.profile.favoriteStationsCount, total);
    assert.deepEqual(full.favorites.map((station: any) => station._id), expected);
    const result = await readFavorites('viewer-slug', '?page=2&limit=1');
    assert.equal(result.total, total);
    assert.deepEqual(result.favorites.map((station: any) => station._id), action === 'remove' ? [] : ['second']);
  }
  assert.ok(unrelatedKeys.every(key => cache.has(key)));
});

test('full profile reports the visible favorites total consistently with subsequent pages', async () => {
  favorites.set('viewer', Array.from({ length: 37 }, (_, index) => ({
    _id: `station-${index}`, name: `Station ${index}`, isListVisible: index < 21,
  })));
  const fullResponse = await fetch(`${base}/profile/viewer-slug/full`, { headers: bearer });
  assert.equal(fullResponse.status, 200);
  const full = await fullResponse.json();
  assert.equal(full.profile.favoriteStationsCount, 37);
  assert.equal(full.favorites.length, 20);
  assert.equal(full.total, 21);
  const nextResponse = await fetch(`${base}/profile/viewer-slug/favorites?page=2&limit=20`, { headers: bearer });
  assert.equal(nextResponse.status, 200);
  const next = await nextResponse.json();
  assert.equal(next.favorites.length, 1);
  assert.equal(next.total, full.total);
  const cached = await (await fetch(`${base}/profile/viewer/full`, { headers: bearer })).json();
  assert.equal(cached.total, 21);
});


test('connections are authenticated, account-scoped, paginated and never publicly cached', async () => {
  relationships.add('target:viewer'); relationships.add('other:viewer'); relationships.add('viewer:target');
  assert.equal((await fetch(`${base}/connections/followers`)).status, 401);
  for (const headers of [bearer, { 'x-fixture-session': 'direct' }]) {
    const response = await fetch(`${base}/connections/followers?page=2&limit=1&userId=other`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
    const result = await response.json();
    assert.deepEqual(result.followers.map((x: any) => x.user._id), ['other']);
    assert.deepEqual(result.pagination, { page: 2, limit: 1, total: 2, pages: 2 });
  }
  const result = await (await fetch(`${base}/connections/following`, { headers: bearer })).json();
  assert.deepEqual(result.following.map((x: any) => x.user._id), ['target']);
  for (const suffix of ['unknown', 'followers?page=-1', 'followers?page=1.2', 'followers?limit=101', 'followers?limit=bad']) {
    assert.equal((await fetch(`${base}/connections/${suffix}`, { headers: bearer })).status, 400);
  }
});

test('removing a follower deletes only their incoming edge and refreshes both users counts', async () => {
  for (const pair of ['target:viewer', 'viewer:target', 'target:other']) relationships.add(pair);
  await getProfile('viewer'); await getProfile('target');
  const response = await fetch(`${base}/remove-follower/target-slug`, { method: 'POST', headers: bearer });
  assert.equal(response.status, 200);
  assert.deepEqual([...relationships].sort(), ['target:other', 'viewer:target']);
  assert.equal((await getProfile('viewer')).followersCount, 0);
  assert.equal((await getProfile('target')).followingCount, 1);
  const result = await (await fetch(`${base}/connections/followers`, { headers: bearer })).json();
  assert.deepEqual(result.followers, []);
  assert.equal((await fetch(`${base}/remove-follower/target`, { method: 'POST', headers: bearer })).status, 200);
});

test('failed, unauthenticated and invalid follower removals preserve every relationship', async () => {
  relationships.add('target:viewer');
  assert.equal((await fetch(`${base}/remove-follower/target`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${base}/remove-follower/missing`, { method: 'POST', headers: bearer })).status, 404);
  assert.equal((await fetch(`${base}/remove-follower/viewer-slug`, { method: 'POST', headers: bearer })).status, 400);
  writeFails = true;
  assert.equal((await fetch(`${base}/remove-follower/target`, { method: 'POST', headers: bearer })).status, 500);
  assert.deepEqual([...relationships], ['target:viewer']);
  assert.deepEqual(cleared, []);
});
