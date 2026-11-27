import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const user = { _id: '507f1f77bcf86cd799439011', email: 'oauth-test@example.test', role: 'user', appleId: 'apple-fixture', status: 'active' };
const testSessions = new Map<string, any>();
const handoffs = new Map<string, { user_id: string; challenge: string }>();
const noop = async () => undefined;
const cache = { get: noop, set: noop, del: noop, clearByPattern: noop };
mock.module('../src/cache', { defaultExport: cache, namedExports: { CacheKeys: { userSocial: () => 'fixture' } } });
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({ query: async (sql: string, parameters: string[] = []) => {
  if (sql.startsWith('DELETE FROM oauth_mobile_handoffs WHERE expires_at')) return { rows: [] };
  if (sql.startsWith('INSERT INTO oauth_mobile_handoffs')) {
    handoffs.set(parameters[0], { user_id: parameters[1], challenge: parameters[2] });
    return { rows: [] };
  }
  if (sql.includes('RETURNING user_id')) {
    const code = handoffs.get(parameters[0]);
    if (code?.challenge !== parameters[1]) return { rows: [] };
    handoffs.delete(parameters[0]);
    return { rows: [code] };
  }
  throw new Error('Unexpected OAuth query');
} }) } });
mock.module('../src/utils/logger', { namedExports: { logger: { log() {}, error() {}, warn() {} } } });
mock.module('../src/auth/auth-event-logger', { namedExports: { logAuthEvent: noop } });
mock.module('../src/data/postgres-api-access-store', { namedExports: { pgListAuthEvents: noop } });
mock.module('../src/data/auth-token-store', { namedExports: { deleteUserAuthTokens: noop, findActiveAuthToken: noop, revokeAuthToken: noop } });
mock.module('../src/data/postgres-user-store', { namedExports: {
  userStore: 'postgres', newPublicUserId: () => user._id,
  pgCreateUser: noop, pgDeleteUser: noop, pgFindUserByEmail: noop, pgFindUserById: async () => user,
  pgFindUserByIdentity: async () => ({ ...user }), pgFindUserByResetToken: noop, pgResetUserPassword: noop,
  pgListUsers: noop, pgRecentUserActivity: noop, pgUpdateUser: noop, pgUserManagementDetail: noop,
  pgUserManagementStats: noop, pgUserSocialByEmail: noop, pgUserFollowState: noop, pgUserSlugExists: noop,
} });
mock.module('../src/services/user-engagement-service', { namedExports: { engagementStore: 'postgres', UserEngagementService: class {} } });
mock.module('../src/services/community-profiles', { namedExports: { invalidateCommunityProfiles: noop } });
mock.module('../src/data/postgres-engagement-store', { namedExports: { pgFollowPage: noop, pgIsFollowing: noop } });
mock.module('../src/data/postgres-notification-store', { namedExports: { notificationStore: 'postgres', pgCreateNotification: noop } });
mock.module('jose', { namedExports: { createRemoteJWKSet: () => ({}), jwtVerify: async () => ({ payload: { sub: 'apple-fixture', email: user.email } }) } });

const oldFrontend = process.env.FRONTEND_URL;
const oldSecret = process.env.SESSION_SECRET;
const oldCallback = process.env.GOOGLE_CALLBACK_URL;
const site = 'https://themegaradio.com';
const secret = 'fixture-oauth-state-secret';
let mode: 'success' | 'cancel' | 'error' = 'success';
let tokenFailure = false;
let lastSession: any;
let server: Server;
let base: string;
before(async () => {
  process.env.FRONTEND_URL = site;
  process.env.SESSION_SECRET = secret;
  const { registerUserAuthRoutes } = await import('../src/routes/user-auth-routes');
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = lastSession = {
      oauthReturnTo: req.headers['x-fixture-return'], oauthReturnLang: 'de', appleOAuthState: 'valid-state',
      save: (done: any) => done(), destroy: (done: any) => done(),
    };
    const sessionKey = req.headers['x-desktop-fixture'];
    if (sessionKey) {
      if (!testSessions.has(sessionKey)) testSessions.set(sessionKey, lastSession);
      req.session = lastSession = testSessions.get(sessionKey);
    }
    req.login = (_user: any, done: any) => done();
    next();
  });
  const auth = (_req: any, _res: any, next: any) => next();
  registerUserAuthRoutes(app, {
    requireAuth: auth, requireAdmin: auth,
    generateAuthToken: async (_id: string, type: string) => {
      if (tokenFailure) throw new Error('fixture token failure');
      return type === 'desktop' ? 'fixture-desktop-token' : 'fixture-token';
    },
    getSocialAuthStatus: () => ({ google: true, apple: true }),
    passport: { authenticate: (_provider: string, _options: any, callback: any) => async (req: any, res: any) => {
      if (!callback) {
        if (req.headers['x-desktop-fixture']) return res.redirect('https://accounts.google.com/?state=' + encodeURIComponent(_options.state));
        return res.status(200).end();
      }
      await callback(mode === 'error' ? new Error('fixture provider error') : null, mode === 'success' ? user : null);
    } },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (oldFrontend === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = oldFrontend;
  if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret;
  if (oldCallback === undefined) delete process.env.GOOGLE_CALLBACK_URL; else process.env.GOOGLE_CALLBACK_URL = oldCallback;
});
beforeEach(() => {
  mode = 'success'; tokenFailure = false;
  process.env.FRONTEND_URL = site;
  delete process.env.GOOGLE_CALLBACK_URL;
});
async function request(path: string, returnTo?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(returnTo ? { 'x-fixture-return': returnTo } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { res, url: new URL(res.headers.get('location') || '/', site) };
}

test('callback diagnostics use the configured OAuth target rather than incoming proxy hosts', async () => {
  for (const callback of [undefined, 'https://api.example/api/auth/google/callback']) {
    if (callback) process.env.GOOGLE_CALLBACK_URL = callback; else delete process.env.GOOGLE_CALLBACK_URL;
    const response = await fetch(`${base}/api/auth/debug/callback-url`, { headers: { 'x-forwarded-host': 'untrusted.example' } });
    assert.equal(response.status, 200);
    const data = await response.json();
    const expected = new URL(callback || `${site}/api/auth/google/callback`);
    assert.equal(data.callbackUrl, expected.href);
    assert.equal(data.currentDomain, expected.origin);
    assert.deepEqual(data.allDomains, [expected.host]);
  }
});

test('real Google and Apple entry routes reject an external-looking returnTo before session storage', async () => {
  await request('/api/auth/google?returnTo=' + encodeURIComponent('/\\outside.example'));
  assert.equal(lastSession.oauthReturnTo, undefined);
  await request('/api/auth/apple?returnTo=' + encodeURIComponent('/%5Coutside.example'));
  assert.equal(lastSession.oauthReturnTo, undefined);
});

test('real Google cancellation/error routes preserve the TV pairing target for retry', async () => {
  for (const scenario of ['cancel', 'error'] as const) {
    mode = scenario;
    const { res, url } = await request('/api/auth/google/callback', '/tr/tv?code=123456');
    assert.equal(res.status, 302);
    assert.equal(url.pathname, '/tr/login');
    assert.equal(url.searchParams.get('returnTo'), '/tr/tv?code=123456');
    assert.equal(url.searchParams.has('auth_token'), false);
  }
});

test('Google cancelled sign-in still recovers the TV destination from signed state without a session return path', async () => {
  mode = 'cancel';
  const payload = Buffer.from(JSON.stringify({ r: '/en/tv?code=654321' })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 16);
  const { url } = await request(`/api/auth/google/callback?state=${payload}.${signature}`);
  assert.equal(url.pathname, '/en/login');
  assert.equal(url.searchParams.get('returnTo'), '/en/tv?code=654321');
});

test('real Google success and cookie-session fallback both retain code and locale', async () => {
  for (const failing of [false, true]) {
    tokenFailure = failing;
    const { res, url } = await request('/api/auth/google/callback', '/de/tv?code=123456');
    assert.equal(res.status, 302);
    assert.equal(url.pathname, '/de/tv');
    assert.equal(url.searchParams.get('code'), '123456');
    assert.equal(url.searchParams.get(failing ? 'success' : 'auth_token'), failing ? 'google_login' : 'fixture-token');
  }
});

test('real Apple cancel/state-error/token-error routes all retain a reachable TV login', async () => {
  for (const body of [{ error: 'user_cancelled_authorize' }, { id_token: 'fake', state: 'wrong' }, { id_token: 'fake', state: 'valid-state' }]) {
    tokenFailure = 'id_token' in body && body.state === 'valid-state';
    const { res, url } = await request('/api/auth/apple/callback', '/fr/tv?code=123456', body);
    assert.equal(res.status, 302);
    assert.equal(url.pathname, '/fr/login');
    assert.equal(url.searchParams.get('returnTo'), '/fr/tv?code=123456');
    assert.equal(url.searchParams.has('auth_token'), false);
  }
});

test('real token redirects from both providers cannot escape origin through a legacy session return path', async () => {
  for (const path of ['/api/auth/google/callback', '/api/auth/apple/callback']) {
    const { res, url } = await request(path, '/\\outside.example', path.includes('apple') ? { id_token: 'fake', state: 'valid-state' } : undefined);
    assert.equal(res.status, 302);
    assert.equal(url.origin, site);
    assert.equal(url.pathname, '/de/');
    assert.equal(url.searchParams.get('auth_token'), 'fixture-token');
  }
});

test('Apple and Google desktop sign-in return a short-lived code and exchange it for a desktop session', async () => {
  const added = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_SERVICE_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'] as const;
  const previous = added.map(key => process.env[key]);
  try {
    for (const key of added) process.env[key] = 'fixture';
    for (const provider of ['apple', 'google']) {
      const headers = { 'x-desktop-fixture': provider, 'Content-Type': 'application/json' };
      const verifier = 'v'.repeat(43);
      const state = 's'.repeat(43);
      const redirect = 'http://127.0.0.1:49271/desktop-auth/callback';
      const query = new URLSearchParams({
        provider, state, redirect_uri: redirect, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      });
      const fetchLocal = (path: string, body?: unknown, sessionHeaders = headers) => fetch(base + path, {
        redirect: 'manual', headers: sessionHeaders, method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
      });
      const start = await fetchLocal('/api/auth/desktop/start?' + query);
      assert.equal(start.status, 303);
      const auth = await fetchLocal(start.headers.get('location')!);
      assert.equal(auth.status, 302);
      const providerState = new URL(auth.headers.get('location')!).searchParams.get('state');
      assert.ok(providerState);
      const callback = provider === 'apple'
        ? await fetchLocal('/api/auth/apple/callback', { id_token: 'fixture-id', state: providerState })
        : await fetchLocal('/api/auth/google/callback?state=' + encodeURIComponent(providerState));
      assert.equal(callback.status, 303);
      const target = new URL(callback.headers.get('location')!);
      assert.equal(target.origin + target.pathname, redirect);
      assert.equal(target.searchParams.get('desktop_state'), state);
      assert.equal(target.searchParams.has('auth_token'), false);
      const code = target.searchParams.get('desktop_code');
      assert.ok(code);
      assert.equal(testSessions.get(provider).oauthReturnTo, undefined);
      const exchange = await fetchLocal('/api/auth/desktop/exchange', { code, codeVerifier: verifier });
      assert.equal(exchange.status, 200);
      assert.equal((await exchange.json()).token, 'fixture-desktop-token');
      assert.equal((await fetchLocal('/api/auth/desktop/exchange', { code, codeVerifier: verifier })).status, 401);
    }
  } finally {
    for (const [index, key] of added.entries()) {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    }
  }
});
