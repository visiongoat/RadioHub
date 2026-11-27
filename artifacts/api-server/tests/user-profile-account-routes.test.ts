import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';

const ownerId = '507f1f77bcf86cd799439011';
const otherId = '507f1f77bcf86cd799439012';
let users: Map<string, any>;
const writes: Array<{ id: string; patch: any }> = [];
const signups: any[] = [];
const invalidations: string[] = [];
const discoveryQueries: Record<string, any>[] = [];
const followingQueries: any[] = [];
let discoveryUsers: Record<string, any>[] = [];
let databaseFails = false;
let revokeFails = false;
let revokeFinished = false;
let deletedKeys: string[] = [];
let invalidImage = false;
let uploadFailure = false;
let resetAvailable = false;
let passwordLink: { id: string; email: string; tokenHash: string; expires: Date; purpose: string } | null;
const passwordMails: Array<{ to: string; subject: string; text: string }> = [];
let mailFails = false;
let repairedHandle: string | null = null;
const source = (id = ownerId) => ({ _id: id, id, username: id === ownerId ? 'listener' : 'other', fullName: 'Listener',
  email: id === ownerId ? 'owner@example.test' : 'other@example.test', emailVerified: true, status: 'active',
  followersCount: 0, followingCount: 0, preferences: { language: 'de', unrelated: true }, isPublicProfile: true,
  passwordHash: 'stored-hash', notificationSettings: { pushEnabled: true, messages: true, followers: true, favorites: true, nowPlaying: true, newStations: false, recommendations: false } });
const findUser = async (id: string) => { if (databaseFails) throw new Error('private-db-detail'); return users.get(id) || null; };
const cache = { get: async () => null, set: async () => {}, del: async (key: string) => { invalidations.push(key); }, clearByPattern: async (key: string) => { invalidations.push(key); } };
mock.module('../src/cache', { defaultExport: cache, namedExports: { CacheKeys: { userSocial: (email: string) => `social:${email}` } } });
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({query: async (sql: string, params: any[]) => { if (!sql.startsWith('SELECT following_id FROM user_follows')) throw new Error('No real DB access allowed'); followingQueries.push({sql,params}); return {rows: [{following_id: otherId}]}; }}) } });
mock.module('../src/data/postgres-listening-store', { namedExports: {
  pgListeningTotalMinutes: async (id: string) => (await findUser(id))?.totalListeningTime ?? 0,
} });
mock.module('../src/utils/logger', { namedExports: { logger: { log() {}, error() {}, warn() {} } } });
mock.module('../src/auth/auth-event-logger', { namedExports: { logAuthEvent: async () => {} } });
mock.module('../src/data/postgres-api-access-store', { namedExports: { pgListAuthEvents: async () => [] } });
mock.module('../src/data/auth-token-store', { namedExports: {
  deleteUserAuthTokens: async () => {}, findActiveAuthToken: async () => { if (databaseFails) throw new Error('token-db'); return { userId: ownerId }; },
  revokeAuthToken: async () => { await new Promise(r => setTimeout(r, 8)); if (revokeFails) throw new Error('revoke-failed'); revokeFinished = true; },
} });
mock.module('../src/data/postgres-user-store', { namedExports: {
  userStore: 'postgres', newPublicUserId: () => ownerId, pgCreateUser: async (input: any) => {
    signups.push(input); return { ...input, _id: ownerId, username: input.username || 'server_allocated_name' };
  }, pgFindUserById: findUser,
  pgFindUserByEmail: async (email: string) => [...users.values()].find(u => u.email.toLowerCase() === email.toLowerCase()) || null,
  pgFindUserByIdentity: async () => null, pgFindUserByResetToken: async () => resetAvailable ? source() : null,
  pgResetUserPassword: async () => { if (!resetAvailable) return false; resetAvailable = false; return true; },
  pgStorePasswordResetToken: async (input: NonNullable<typeof passwordLink>) => { passwordLink = input; return true; },
  pgChangeUserPassword: async (id: string, previousHash: string, nextHash: string) => {
    const user = users.get(id);
    if (user?.passwordHash !== previousHash) return false;
    user.passwordHash = nextHash; return true;
  },
  pgListUsers: async (options: Record<string, any>) => {
    discoveryQueries.push(options);
    if (databaseFails) throw new Error('private-db-detail');
    return { users: discoveryUsers, total: discoveryUsers.length };
  }, pgRecentUserActivity: async () => [],
  pgUserManagementDetail: async () => null, pgUserManagementStats: async () => ({}), pgUserSlugExists: async () => false,
  pgUserFollowState: async () => ({ following: [], followersCount: 0 }), pgUserSocialByEmail: async () => ({ followers: [{ email: 'private@example.test' }], following: [] }),
  pgDeleteUser: async (id: string) => { if (databaseFails) throw new Error('delete-db'); return users.delete(id); },
  pgUpdateUser: async (id: string, patch: any) => {
    if (databaseFails) throw new Error('update-db');
    const previous = users.get(id); if (!previous) return null;
    if (patch.username === 'taken_name') throw Object.assign(new Error('Username is already in use'), {code:'23505'});
    writes.push({ id, patch });
    const next = { ...previous, ...patch, ...(repairedHandle ? { username: repairedHandle } : {}), preferences: { ...previous.preferences, ...patch.preferences },
      notificationSettings: { ...previous.notificationSettings, ...patch.notificationSettings } };
    users.set(id, next); return next;
  },
} });
mock.module('../src/services/user-engagement-service', { namedExports: { engagementStore: 'postgres', UserEngagementService: class {} } });
mock.module('../src/services/community-profiles', { namedExports: {
  invalidateCommunityProfiles: async () => { invalidations.push('community-profiles:recent:v1:'); },
} });
mock.module('../src/data/postgres-engagement-store', { namedExports: { pgFollowPage: async () => ({}), pgIsFollowing: async () => false } });
mock.module('../src/data/postgres-notification-store', { namedExports: { notificationStore: 'postgres', pgCreateNotification: async () => {} } });
mock.module('bcrypt', { defaultExport: {
  hash: async (password: string) => `hashed:${password}`,
  compare: async (password: string, hash: string) => password === 'CurrentPassword' && hash === 'stored-hash',
} });
mock.module('@sendgrid/mail', { defaultExport: { setApiKey() {}, send: async (mail: typeof passwordMails[number]) => {
  if (mailFails) throw new Error('fixture provider unavailable');
  passwordMails.push(mail); return [{ statusCode: 202 }];
} } });
mock.module('../src/services/s3-storage', { namedExports: {
  uploadToS3: async (key: string) => { if (uploadFailure) throw new Error('upload-network'); return `https://fixture-bucket.s3.eu-north-1.amazonaws.com/${key}`; },
  deleteFromS3: async (key: string) => { deletedKeys.push(key); },
} });
const multer = Object.assign(() => ({ single: () => (req: any, _res: any, callback: any) => { req.file = { buffer: Buffer.from('fixture') }; callback(null); } }), { memoryStorage: () => ({}) });
mock.module('multer', { defaultExport: multer });
mock.module('sharp', { defaultExport: () => ({
  metadata: async () => { if (invalidImage) throw new Error('bad-image'); return { width: 400, height: 400 }; },
  resize: () => ({ webp: () => ({ toBuffer: async () => Buffer.from('webp') }) }),
}) });
let server: Server; let base: string;
before(async () => {
  const { registerUserAuthRoutes } = await import('../src/routes/user-auth-routes.ts');
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => {
    const id = req.headers['x-fixture-user'];
    req.session = { ...(id ? { userId: id, user: { userId: id } } : {}),
      ...(req.headers['x-fixture-admin'] ? { adminAuth: { role: req.headers['x-fixture-admin'] } } : {}),
      save: (done: any) => done(), destroy: (done: any) => done() };
    if (id) req.user = users.get(String(id)); next();
  });
  const auth = (req: any, res: any, next: any) => req.session.userId ? next() : res.status(401).json({ error: 'Authentication required' });
  registerUserAuthRoutes(app, { requireAuth: auth, requireAdmin: auth, generateAuthToken: async () => 'test-token', passport: {} });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
beforeEach(() => {
  users = new Map([[ownerId, source()], [otherId, source(otherId)]]); writes.length = 0; invalidations.length = 0; followingQueries.length = 0;
  discoveryQueries.length = 0; discoveryUsers = [];
  databaseFails = false; revokeFails = false; revokeFinished = false; deletedKeys = []; invalidImage = false; uploadFailure = false;
  resetAvailable = false;
  passwordLink = null; passwordMails.length = 0; mailFails = false;
  repairedHandle = null;
  signups.length = 0;
  process.env.AWS_BUCKET_NAME = 'fixture-bucket'; process.env.AWS_REGION = 'eu-north-1';
});
async function request(path: string, method = 'GET', body?: any, user: string | null = ownerId, extra = {}) {
  return fetch(`${base}${path}`, { method, headers: { ...(user ? { 'x-fixture-user': user } : {}), 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test('signup accepts the public name without a client-generated username and returns the server handle', async () => {
  const response = await request('/api/auth/signup', 'POST', { fullName: 'Şahin Yoğurtcu', email: 'new@example.test', password: 'fixture-password' }, null);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).user.username, 'server_allocated_name');
  assert.equal(signups.length, 1); assert.equal(signups[0].username, undefined);
  assert.equal(signups[0].fullName, 'Şahin Yoğurtcu');
});

test('signup preserves a chosen username and rejects invalid optional username or missing public name', async () => {
  const input = { fullName: 'Şahin Yoğurtcu', username: 'chosen.name', email: 'new@example.test', password: 'fixture-password' };
  const response = await request('/api/auth/signup', 'POST', input, null);
  assert.equal(response.status, 201); assert.equal((await response.json()).user.username, 'chosen.name');
  for (const patch of [{ username: {} }, { username: 'ab' }, { username: 'unsafe@name' }, { fullName: '   ' }]) {
    assert.equal((await request('/api/auth/signup', 'POST', { ...input, ...patch }, null)).status, 400);
  }
  assert.equal(signups.length, 1);
});

test('an existing authenticated session receives the repaired server handle before auth/me responds', async () => {
  users.get(ownerId).username = 'user_1755000000000_abc123456';
  repairedHandle = 'sahin_yogurtcu';
  const response = await request('/api/auth/me');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user._id, ownerId); assert.equal(body.user.username, repairedHandle);
  assert.equal(writes.length, 1); assert.deepEqual(writes[0], { id: ownerId, patch: {} });
  await request('/api/auth/me');
  assert.equal(writes.length, 1, 'the canonical handle does not generate repeated writes');
});

test('auth/me repairs the proven native generator on an existing session but preserves a similarly shaped custom handle', async () => {
  const user = users.get(ownerId);
  Object.assign(user, { username: 'yogurtcusahin5me_mv748druv2w7', email: 'yogurtcusahin5me@example.invalid', createdAt: '2026-10-13T20:10:35.322Z', fullName: 'Yoğurtcu Şahin' });
  repairedHandle = 'yogurtcu_sahin';
  const body = await (await request('/api/auth/me')).json();
  assert.equal(body.user.username, 'yogurtcu_sahin'); assert.equal(writes.length, 1);
  writes.length = 0; repairedHandle = null;
  Object.assign(users.get(ownerId), { username: 'yogurtcusahin5me_mv748druv2w7', createdAt: '2026-10-20T00:00:00Z' });
  assert.equal((await (await request('/api/auth/me')).json()).user.username, 'yogurtcusahin5me_mv748druv2w7');
  assert.equal(writes.length, 0);
});

for (const [path, sortBy] of [
  ['/api/users/search', 'newest'],
  ['/api/users/search?page=1&limit=20&sortBy=recent_favorites', 'recent_favorites'],
]) {
  test(`anonymous discovery stays public/active and exposes only the public DTO: ${path}`, async () => {
    discoveryUsers = [{ ...source(), fullName: 'Public Listener', username: 'public-listener',
      avatar: 'https://example.invalid/avatar.webp', profileImageUrl: 'https://example.invalid/legacy.webp',
      location: 'Public location', bio: 'Public biography', slug: 'public-listener',
      followersCount: 4, followingCount: 2, favoriteStationsCount: 7,
      lastFavoritedAt: '2026-10-26T10:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
      password: 'private-password', password_hash: 'private-hash', authToken: 'private-auth-token',
      accessToken: 'private-access-token', refreshToken: 'private-refresh-token',
      resetPasswordToken: 'private-reset-token', verificationToken: 'private-verification-token',
      googleId: 'private-google-id', appleId: 'private-apple-id', facebookId: 'private-facebook-id',
      tokens: { access: 'private-nested-token' }, source: { email: 'private-source@example.invalid', token: 'private-source-token' },
    }];
    const response = await request(path, 'GET', undefined, null);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^application\/json/);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    for (const header of ['cache-control', 'cdn-cache-control', 'cloudflare-cdn-cache-control']) {
      assert.equal(response.headers.get(header), 'no-store', header);
    }
    assert.deepEqual(discoveryQueries, [{ query: '', status: 'active', publicOnly: true, sortBy, page: 1, limit: 20 }]);
    const body = await response.json();
    assert.deepEqual(body, { users: [{
      _id: ownerId, name: 'Public Listener', fullName: 'Public Listener', displayName: 'Public Listener',
      username: 'public-listener', avatar: 'https://example.invalid/avatar.webp', profileImageUrl: 'https://example.invalid/avatar.webp',
      location: 'Public location', bio: 'Public biography', followersCount: 4, followingCount: 2,
      favoriteStationsCount: 7, lastFavoritedAt: '2026-10-26T10:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z', slug: 'public-listener',
    }], pagination: { page: 1, limit: 20, total: 1, pages: 1, hasMore: false } });
    assert.doesNotMatch(JSON.stringify(body), /private-|@example\.test|stored-hash/);
    assert.equal(writes.length, 0);
    assert.equal(invalidations.length, 0);
  });
}

test('anonymous discovery errors retain JSON noindex/nofollow without leaking driver details', async () => {
  databaseFails = true;
  const response = await request('/api/users/search?page=1&limit=20&sortBy=recent_favorites', 'GET', undefined, null);
  assert.equal(response.status, 500);
  assert.match(response.headers.get('content-type') || '', /^application\/json/);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.deepEqual(await response.json(), { error: 'Failed to search users' });
  assert.deepEqual(discoveryQueries, [{ query: '', status: 'active', publicOnly: true, sortBy: 'recent_favorites', page: 1, limit: 20 }]);
  assert.equal(writes.length, 0);
});

test('profile save writes only submitted safe fields and invalidates personal caches', async () => {
  const response = await request('/api/auth/profile', 'PUT', { fullName: ' Updated ', role: 'admin', subscription: { isActive: true } });
  assert.equal(response.status, 200); assert.deepEqual(writes[0], { id: ownerId, patch: { fullName: 'Updated' } });
  const body = await response.json(); assert.equal(body.user.fullName, 'Updated'); assert.equal(body.user.passwordHash, undefined);
  assert.ok(invalidations.some(x => x.startsWith('user-engagement-full:')));
});
test('profile validation rejects invalid types, weak/oversize passwords and preferences without writes', async () => {
  for (const body of [{ fullName: {} }, { email: 'wrong' }, { isPublicProfile: 'false' }, { password: 'short' }, { password: 'é'.repeat(40) }, { preferences: { autoplay: 'true' } }]) {
    assert.equal((await request('/api/auth/profile', 'PUT', body)).status, 400);
  }
  assert.equal(writes.length, 0);
});
test('profile cannot set a password without the dedicated ownership check', async () => {
  assert.equal((await request('/api/auth/profile', 'PUT', { password: '   ', fullName: 'Listener' })).status, 200);
  assert.equal(writes[0].patch.passwordHash, undefined);
  assert.equal((await request('/api/auth/profile', 'PUT', { password: 'LongEnough123' })).status, 400);
  assert.equal(writes.length, 1);
  assert.equal(users.get(ownerId).passwordHash, 'stored-hash');
});
test('a Google-only account creates a password through its verified inbox', async () => {
  const previousKey = process.env.SENDGRID_API_KEY;
  process.env.SENDGRID_API_KEY = 'SG.test';
  Object.assign(users.get(ownerId), { passwordHash: null, googleId: 'google-fixture' });
  try {
    assert.equal((await request('/api/auth/password', 'GET', undefined, null)).status, 401);
    assert.deepEqual(await (await request('/api/auth/password')).json(), {
      hasPassword: false, canSetPassword: true, email: 'owner@example.test',
    });
    assert.equal((await request('/api/auth/change-password', 'POST', { newPassword: 'NewPassword123' })).status, 409);
    const response = await request('/api/auth/password/setup', 'POST', { language: 'tr-TR', email: 'other@example.test' });
    assert.equal(response.status, 200);
    assert.equal(passwordMails[0].to, 'owner@example.test');
    assert.equal(passwordMails[0].subject, 'MegaRadio şifreni oluştur');
    const link = new URL(passwordMails[0].text.match(/https:\/\/\S+/)![0]);
    assert.equal(link.pathname, '/reset-password');
    assert.equal(link.searchParams.get('mode'), 'setup');
    const token = link.searchParams.get('token')!;
    assert.equal(passwordLink?.tokenHash, createHash('sha256').update(token).digest('hex'));
    assert.equal(passwordLink?.purpose, 'setup');
    assert.equal(users.get(ownerId).passwordHash, null);
    mailFails = true;
    assert.equal((await request('/api/auth/password/setup', 'POST', {})).status, 503);
    users.get(ownerId).emailVerified = false;
    assert.equal((await request('/api/auth/password/setup', 'POST', {})).status, 403);
    assert.equal(passwordMails.length, 1);
  } finally {
    if (previousKey === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = previousKey;
  }
});
test('a Google-linked account with a password must verify its current password to change it', async () => {
  users.get(ownerId).googleId = 'google-fixture';
  assert.deepEqual(await (await request('/api/auth/password')).json(), {
    hasPassword: true, canSetPassword: false, email: 'owner@example.test',
  });
  assert.equal((await request('/api/auth/password/setup', 'POST', {})).status, 409);
  const change = { currentPassword: 'CurrentPassword', newPassword: 'NewPassword123' };
  assert.equal((await request('/api/auth/change-password', 'POST', { ...change, currentPassword: 'wrong' })).status, 403);
  assert.equal(users.get(ownerId).passwordHash, 'stored-hash');
  assert.equal((await request('/api/auth/change-password', 'POST', change)).status, 200);
  assert.equal(users.get(ownerId).passwordHash, 'hashed:NewPassword123');
});
test('email changes normalize and revoke stale verification, duplicate email is409', async () => {
  assert.equal((await request('/api/auth/profile', 'PUT', { email: ' New@Example.Test ' })).status, 200);
  assert.equal(writes[0].patch.email, 'new@example.test'); assert.equal(writes[0].patch.emailVerified, false);
  const response = await request('/api/auth/profile', 'PUT', { email: 'other@example.test' });
  assert.equal(response.status, 409); assert.equal(writes.length, 1);
});
test('generic profile write enforces owner/admin role, prevents public privileged assignment', async () => {
  assert.equal((await request(`/api/users/${otherId}`, 'PUT', { fullName: 'Hacked' })).status, 403);
  assert.equal((await request(`/api/users/${otherId}`, 'PUT', { fullName: 'Hacked' }, ownerId, { 'x-fixture-admin': 'moderator' })).status, 403);
  assert.equal((await request(`/api/users/${ownerId}`, 'PUT', { role: 'admin', emailVerified: true })).status, 400);
  assert.equal(writes.length, 0);
});
test('social graph prevents another signed-in user from reading private emails', async () => {
  assert.equal((await request('/api/user/social/other%40example.test')).status, 403);
  assert.equal((await request('/api/user/social/owner%40example.test')).status, 200);
});
test('auth/me returns503 for DB outage,403 inactive and preserves healthy anonymous200', async () => {
  databaseFails = true; assert.equal((await request('/api/auth/me')).status, 503);
  assert.equal((await request('/api/auth/me', 'GET', undefined, null, { authorization: 'Bearer fixture-token-long-enough' })).status, 503);
  databaseFails = false; users.get(ownerId).status = 'suspended'; assert.equal((await request('/api/auth/me')).status, 403);
  const anonymous = await request('/api/auth/me', 'GET', undefined, null); assert.equal(anonymous.status, 200); assert.equal((await anonymous.json()).authenticated, false);
});
test('auth/me exposes the recorded total in minutes for the authenticated account', async () => {
  users.get(ownerId).totalListeningTime = 91.5;
  users.get(otherId).totalListeningTime = 3;
  const body = await (await request('/api/auth/me')).json();
  assert.equal(body.authenticated, true);
  assert.equal(body.user.totalListeningTime, 91.5);
  const other = await (await request('/api/auth/me', 'GET', undefined, otherId)).json();
  assert.equal(other.user.totalListeningTime, 3);
});
test('notification settings GET/PATCH/PUT require auth, boolean allowlist and preserve unrelated settings', async () => {
  assert.equal((await request('/api/user/notification-settings', 'GET', undefined, null)).status, 401);
  assert.deepEqual((await (await request('/api/user/notification-settings')).json()).notificationSettings, source().notificationSettings);
  for (const body of [{ favorites: 'false' }, { favorites: false, role: 'admin' }, {}]) assert.equal((await request('/api/user/notification-settings', 'PATCH', body)).status, 400);
  assert.equal((await request('/api/user/notification-settings', 'PATCH', { favorites: false })).status, 200);
  assert.equal((await request('/api/user/notification-settings', 'PUT', { recommendations: true })).status, 200);
  const body = await (await request('/api/auth/me')).json();
  assert.deepEqual(body.user.notificationSettings, { pushEnabled: true, messages: true, followers: true, favorites: false, nowPlaying: true, newStations: false, recommendations: true });
});
test('mobile push preference survives a later web notification patch', async () => {
  assert.equal((await request('/api/user/notification-settings', 'PATCH', { pushEnabled: false })).status, 200);
  assert.equal((await request('/api/user/notification-settings', 'PATCH', { favorites: false })).status, 200);
  const body = await (await request('/api/user/notification-settings')).json();
  assert.equal(body.notificationSettings.pushEnabled, false);
  assert.equal(body.notificationSettings.messages, true);
});
test('logout waits for token revocation and does not claim success on failure', async () => {
  const headers = { authorization: 'Bearer fixture-token-long-enough' };
  const success = await request('/api/auth/logout', 'POST', {}, ownerId, headers); assert.equal(success.status, 200); assert.equal(revokeFinished, true);
  revokeFails = true; assert.equal((await request('/api/auth/logout', 'POST', {}, ownerId, headers)).status, 500);
});
test('invalid image and upload service failures are handled inside async multipart callback', async () => {
  invalidImage = true; assert.equal((await request('/api/user/avatar', 'POST', {})).status, 400);
  invalidImage = false; uploadFailure = true; assert.equal((await request('/api/user/avatar', 'POST', {})).status, 500);
  assert.equal(writes.length, 0);
});
test('avatar deletion never deletes another user or external bucket object', async () => {
  users.get(ownerId).avatar = `https://fixture-bucket.s3.eu-north-1.amazonaws.com/avatars/user_${otherId}_123.webp`;
  assert.equal((await request('/api/user/avatar', 'DELETE')).status, 200); assert.deepEqual(deletedKeys, []);
  users.get(ownerId).avatar = `https://fixture-bucket.s3.eu-north-1.amazonaws.com/avatars/user_${ownerId.slice(-8)}_123.webp`;
  assert.equal((await request('/api/user/avatar', 'DELETE')).status, 200); assert.deepEqual(deletedKeys, [`avatars/user_${ownerId.slice(-8)}_123.webp`]);
});
test('account deletion clears profile caches and cookie, never deletes S3 object before failed DB delete', async () => {
  users.get(ownerId).avatar = `https://fixture-bucket.s3.eu-north-1.amazonaws.com/avatars/user_${ownerId}_123.webp`;
  databaseFails = true; assert.equal((await request('/api/user/delete-account', 'DELETE')).status, 500); assert.deepEqual(deletedKeys, []);
  databaseFails = false; const response = await request('/api/user/delete-account', 'DELETE');
  assert.equal(response.status, 200); assert.equal(users.has(ownerId), false); assert.equal(deletedKeys.length, 1); assert.match(response.headers.get('set-cookie') || '', /connect\.sid=/);
});
test('reset rejects weak passwords and a successfully consumed token cannot be replayed', async () => {
  resetAvailable = true;
  assert.equal((await request('/api/auth/reset-password', 'POST', { token: 'fixture-reset-token', newPassword: 'short' }, null)).status, 400);
  assert.equal((await request('/api/auth/reset-password', 'POST', { token: 'fixture-reset-token', newPassword: 'ValidPassword123' }, null)).status, 200);
  assert.equal((await request('/api/auth/reset-password', 'POST', { token: 'fixture-reset-token', newPassword: 'OtherPassword123' }, null)).status, 400);
});

test('optional discovery fields save to the owner preferences and round-trip without changing language or privacy', async () => {
  const response = await request('/api/auth/profile','PUT',{preferences:{profileGender:'female',profileCountryCode:'at'}});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.user.preferences.profileGender,'female');
  assert.equal(body.user.preferences.profileCountryCode,'AT');
  assert.equal(body.user.preferences.language,'de');
  assert.equal(body.user.isPublicProfile,true);
  assert.equal(users.get(otherId).preferences.profileGender,undefined);
  const current=await request('/api/auth/me');
  assert.equal((await current.json()).user.preferences.profileCountryCode,'AT');
  const cleared=await request('/api/auth/profile','PUT',{preferences:{profileGender:'undisclosed',profileCountryCode:null}});
  assert.equal(cleared.status,200);
  assert.equal((await cleared.json()).user.preferences.profileCountryCode,null);
});
test('invalid discovery values are rejected without a profile write', async () => {
  for (const preferences of [{profileGender:'guessed'},{profileCountryCode:'Global'},{profileCountryCode:42}]) {
    assert.equal((await request('/api/auth/profile','PUT',{preferences})).status,400);
  }
  assert.equal(writes.length,0);
});


test('username edit normalizes and persists only the chosen handle; conflicts and malformed names cannot succeed', async () => {
  const response = await request('/api/auth/profile', 'PUT', {username:' Alex_White '});
  assert.equal(response.status,200); assert.equal((await response.json()).user.username,'alex_white');
  assert.deepEqual(writes[0],{id:ownerId,patch:{username:'alex_white'}});
  for (const username of ['ab','bad name','@name','a'.repeat(31),'şahin']) assert.equal((await request('/api/auth/profile','PUT',{username})).status,400);
  const conflict=await request('/api/auth/profile','PUT',{username:'taken_name'});
  assert.equal(conflict.status,409); assert.equal((await conflict.json()).code,'USERNAME_TAKEN');
  assert.equal(writes.length,1); assert.equal(users.get(ownerId).username,'alex_white');
});

test('directory follow state is authenticated, bounded and fetched once for the current viewer', async () => {
  const path='/api/user/following-status?ids='+[ownerId,otherId,otherId].join(',');
  assert.equal((await request(path,'GET',undefined,null)).status,401);
  const response=await request(path); assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await response.json(),{statuses:{[ownerId]:false,[otherId]:true}});
  assert.equal(followingQueries.length,1); assert.deepEqual(followingQueries[0].params,[ownerId,[ownerId,otherId]]);
  for (const ids of ['', 'not-an-id', Array.from({length:101},(_,i)=>i.toString(16).padStart(24,'0')).join(',')]) assert.equal((await request('/api/user/following-status?ids='+ids)).status,400);
  assert.equal(followingQueries.length,1);
});
