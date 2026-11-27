import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { facebookHash } from '../src/auth/facebook-oauth-policy';

const fixtureUser = { _id: 'fixture', status: 'active', fullName: 'Fixture', username: 'fixture', email: 'fixture@example.test', role: 'user', passwordHash: 'never-return', facebookId: '123' };
const states = new Set<string>();
const handoffs = new Map<string, { user_id: string; challenge: string }>();
let facebookIdentity: any, emailIdentity: any, profile: any, created: any[], updates: any[], providerCalls: number, tokens: number;
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => ({ query: async (sql: string, params: any[] = []) => {
  if (sql.startsWith('INSERT INTO facebook_oauth_states')) { states.add(params[0]); return { rows: [] }; }
  if (sql.includes('RETURNING state_hash')) { return { rows: states.delete(params[0]) ? [{ state_hash: params[0] }] : [] }; }
  if (sql.startsWith('INSERT INTO oauth_mobile_handoffs')) { handoffs.set(params[0], { user_id: params[1], challenge: params[2] }); return { rows: [] }; }
  if (sql.includes('RETURNING user_id')) {
    const row = handoffs.get(params[0]);
    if (!row || row.challenge !== params[1]) return { rows: [] };
    handoffs.delete(params[0]); return { rows: [row] };
  }
  return { rows: [] };
} }) } });
mock.module('../src/data/postgres-user-store', { namedExports: {
  pgFindUserByIdentity: async (input: any) => input.facebookId ? facebookIdentity : emailIdentity,
  pgFindUserById: async () => facebookIdentity || { ...fixtureUser },
  pgCreateUser: async (input: any) => { created.push(input); return { ...input, _id: input.id }; },
  pgUpdateUser: async (id: string, patch: any) => { updates.push({ id, patch }); return { ...facebookIdentity, ...patch }; },
  newPublicUserId: () => '507f1f77bcf86cd799439011',
} });
let server: any, base: string, fixtureIp = 1;
const savedFetch = globalThis.fetch;
const old = { FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID, FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET, FRONTEND_URL: process.env.FRONTEND_URL, FACEBOOK_CALLBACK_URL: process.env.FACEBOOK_CALLBACK_URL };
before(async () => {
  process.env.FACEBOOK_APP_ID = 'fixture-id'; process.env.FACEBOOK_APP_SECRET = 'fixture-secret';
  process.env.FRONTEND_URL = 'https://themegaradio.com'; delete process.env.FACEBOOK_CALLBACK_URL;
  globalThis.fetch = (async (input: any, init: any) => {
    if (String(input).startsWith('https://graph.facebook.com/')) {
      providerCalls++;
      assert.equal(new URL(String(input)).searchParams.has('access_token'), false);
      if (String(input).includes('/oauth/access_token')) {
        assert.equal(init.method, 'POST');
        assert.equal(init.body.get('client_secret'), 'fixture-secret');
        return new Response(JSON.stringify({ access_token: 'fixture-provider-token' }), { status: 200 });
      }
      assert.equal(init.headers.Authorization, 'Bearer fixture-provider-token');
      return new Response(JSON.stringify(profile), { status: 200 });
    }
    return savedFetch(input, init);
  }) as any;
  const { registerFacebookAuthRoutes } = await import('../src/routes/facebook-auth-routes');
  const { registerDesktopAuthRoutes } = await import('../src/routes/desktop-auth-routes');
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { Object.defineProperty(req, 'ip', { value: `127.0.0.${fixtureIp}` }); next(); });
  app.use(session({ secret: 'fixture-session-secret', resave: false, saveUninitialized: false }));
  app.use((req: any, _res, next) => { req.login = (_user: any, cb: any) => cb(); next(); });
  registerFacebookAuthRoutes(app, { generateAuthToken: async () => { tokens++; return 'fixture-mobile-token'; } });
  registerDesktopAuthRoutes(app, async (id, type, name) => {
    assert.deepEqual([id, type, name], [fixtureUser._id, 'desktop', 'MegaRadio Desktop']);
    return 'fixture-desktop-token';
  });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  fixtureIp++; states.clear(); handoffs.clear(); created = []; updates = []; providerCalls = 0; tokens = 0;
  facebookIdentity = { ...fixtureUser }; emailIdentity = null;
  profile = { id: '123', name: 'Fixture' };
});
after(async () => {
  globalThis.fetch = savedFetch; server.closeAllConnections(); await new Promise<void>(r => server.close(r));
  for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
async function begin(query = '') {
  const response = await fetch(base + '/api/auth/facebook' + query, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const url = new URL(response.headers.get('location')!);
  assert.equal(url.searchParams.has('client_secret'), false);
  return { state: url.searchParams.get('state'), cookie: response.headers.get('set-cookie')!.split(';')[0], url };
}
const callback = (flow: Awaited<ReturnType<typeof begin>>, query = 'code=fixture') => fetch(base + `/api/auth/facebook/callback?state=${flow.state}&${query}`, { redirect: 'manual', headers: { Cookie: flow.cookie } });

test('web/TV return path stays local and callback state is single use', async () => {
  const flow = await begin('?returnTo=' + encodeURIComponent('/tr/tv?code=123456'));
  assert.equal(flow.url.searchParams.get('redirect_uri'), 'https://api.themegaradio.com/api/auth/facebook/callback');
  const response = await callback(flow);
  const result = new URL(response.headers.get('location')!);
  assert.equal(result.pathname, '/tr/tv'); assert.equal(result.searchParams.get('code'), '123456');
  assert.equal(result.searchParams.get('auth_token'), null);
  assert.equal((await callback(flow)).status, 400);
});
test('parallel callbacks across API replicas consume state before provider side effects', async () => {
  const flow = await begin();
  const responses = await Promise.all([callback(flow), callback(flow)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [302, 400]);
  assert.equal(providerCalls, 2); assert.equal(updates.length, 1);
});
test('missing session and mismatched state never reach the provider or consume legitimate state', async () => {
  const flow = await begin();
  assert.equal((await fetch(base + `/api/auth/facebook/callback?state=${'b'.repeat(64)}&code=fixture`, { headers: { Cookie: flow.cookie } })).status, 400);
  assert.equal((await fetch(base + `/api/auth/facebook/callback?state=${flow.state}&code=fixture`)).status, 400);
  assert.equal(providerCalls, 0); assert.equal(states.size, 1);
});
test('mobile handoff is proof bound, atomic, single use and contains no provider or session tokens', async () => {
  const verifier = 'z'.repeat(64), challenge = facebookHash(verifier);
  const flow = await begin('?platform=mobile&code_challenge=' + challenge);
  const response = await callback(flow), redirect = response.headers.get('location')!;
  const url = new URL(redirect); assert.equal(url.protocol, 'megaradio:'); assert.equal(url.hostname, 'facebook-auth');
  const code = url.searchParams.get('code'); assert.ok(code);
  assert.equal(redirect.includes('token'), false); assert.equal(redirect.includes('fixture'), false);
  assert.equal(handoffs.has(code!), false); assert.ok(handoffs.has(facebookHash(code!)));
  const exchange = (proof: string) => fetch(base + '/api/auth/facebook/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, codeVerifier: proof }) });
  assert.equal((await exchange('x'.repeat(64))).status, 401);
  const results = await Promise.all([exchange(verifier), exchange(verifier)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401]); assert.equal(tokens, 1);
  const payload = await results.find(r => r.status === 200)!.json() as any;
  assert.equal(payload.user.username, 'fixture'); assert.equal(payload.user.passwordHash, undefined); assert.equal(payload.user.facebookId, undefined);
});
test('mobile cancellation consumes state and returns no identity or code', async () => {
  const flow = await begin('?platform=mobile&code_challenge=' + facebookHash('c'.repeat(64)));
  const result = new URL((await callback(flow, 'error=access_denied')).headers.get('location')!);
  assert.equal(result.href, 'megaradio://facebook-auth?error=facebook_cancelled');
  assert.equal(providerCalls, 0); assert.equal(handoffs.size, 0); assert.equal((await callback(flow)).status, 400);
});
test('cancelling Facebook keeps the TV pairing code on a reachable retry page', async () => {
  const flow = await begin('?returnTo=' + encodeURIComponent('/tr/tv?code=654321'));
  const url = new URL((await callback(flow, 'error=access_denied')).headers.get('location')!);
  assert.equal(url.pathname, '/tr/login'); assert.equal(url.searchParams.get('returnTo'), '/tr/tv?code=654321');
});
test('an existing email cannot silently link a new Facebook identity', async () => {
  facebookIdentity = null; emailIdentity = { ...fixtureUser, facebookId: null };
  profile = { id: '456', name: 'New identity', email: fixtureUser.email };
  const flow = await begin('?platform=mobile&code_challenge=' + facebookHash('d'.repeat(64)));
  const result = new URL((await callback(flow)).headers.get('location')!);
  assert.equal(result.searchParams.get('error'), 'facebook_account_link_required');
  assert.equal(created.length, 0); assert.equal(updates.length, 0); assert.equal(tokens, 0); assert.equal(handoffs.size, 0);
});
test('Facebook without email creates a private placeholder and valid required username', async () => {
  facebookIdentity = null;
  profile = { id: '789', name: '  Şahin Yoğurtcu  ', picture: { data: { url: 'https://example.test/avatar.jpg' } } };
  await callback(await begin('?platform=mobile&code_challenge=' + facebookHash('e'.repeat(64))));
  assert.equal(created.length, 1); const user = created[0];
  assert.equal(user.username, 'fb_507f1f77bcf86cd799439011'); assert.equal(user.fullName, 'Şahin Yoğurtcu');
  assert.equal(user.email, 'facebook-789@oauth.invalid'); assert.equal(user.emailVerified, false);
  assert.equal(user.facebookId, '789'); assert.equal(user.role, 'user'); assert.equal(handoffs.size, 1);
});
test('inactive accounts never receive a mobile handoff', async () => {
  facebookIdentity.status = 'suspended';
  const flow = await begin('?platform=mobile&code_challenge=' + facebookHash('f'.repeat(64)));
  assert.equal(new URL((await callback(flow)).headers.get('location')!).searchParams.get('error'), 'account_inactive');
  assert.equal(updates.length, 0); assert.equal(handoffs.size, 0);
});
test('malformed mobile challenge is rejected before redirecting to Facebook', async () => {
  const response = await fetch(base + '/api/auth/facebook?platform=mobile&code_challenge=short', { redirect: 'manual' });
  assert.equal(response.status, 400); assert.equal(response.headers.get('location'), null); assert.equal(states.size, 0);
});

test('untrusted return URLs and provider error details never enter the callback URL', async () => {
  const flow = await begin('?returnTo=' + encodeURIComponent('https://outside.test/steal'));
  profile = { error: { message: 'fixture-provider-token private detail' } };
  const response = await callback(flow);
  const url = new URL(response.headers.get('location')!);
  assert.equal(url.hostname, 'themegaradio.com');
  assert.equal(url.searchParams.get('error'), 'facebook_auth_failed');
  assert.equal(url.href.includes('fixture'), false); assert.equal(url.href.includes('outside.test'), false);
});

test('desktop Facebook returns a proof-bound single-use code without changing the mobile flow', async () => {
  const verifier = 'v'.repeat(64);
  const state = 's'.repeat(43);
  const redirect = 'http://127.0.0.1:49271/desktop-auth/callback';
  const query = new URLSearchParams({ provider: 'facebook', redirect_uri: redirect, state, code_challenge: facebookHash(verifier) });
  const start = await fetch(base + '/api/auth/desktop/start?' + query, { redirect: 'manual' });
  assert.equal(start.status, 303);
  const cookie = start.headers.get('set-cookie')!.split(';')[0];
  const authorize = await fetch(base + start.headers.get('location'), { redirect: 'manual', headers: { Cookie: cookie } });
  const providerState = new URL(authorize.headers.get('location')!).searchParams.get('state');
  const response = await callback({ state: providerState, cookie, url: new URL(authorize.headers.get('location')!) });
  assert.equal(response.status, 303);
  const returned = new URL(response.headers.get('location')!);
  assert.equal(returned.origin + returned.pathname, redirect);
  assert.equal(returned.searchParams.get('desktop_state'), state);
  assert.equal(returned.searchParams.get('auth_token'), null);
  const code = returned.searchParams.get('desktop_code');
  assert.match(code || '', /^[A-Za-z0-9_-]{43}$/);
  const exchange = (codeVerifier: string) => fetch(base + '/api/auth/desktop/exchange', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, codeVerifier }),
  });
  assert.equal((await exchange('x'.repeat(64))).status, 401);
  const results = await Promise.all([exchange(verifier), exchange(verifier)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401]);
  const session = await results.find(r => r.ok)!.json();
  assert.equal(session.token, 'fixture-desktop-token');
  assert.equal(session.user._id, fixtureUser._id);
  assert.equal(session.user.passwordHash, undefined);
});
