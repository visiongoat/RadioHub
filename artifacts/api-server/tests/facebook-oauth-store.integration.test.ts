import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import session from 'express-session';
import pg from 'pg';
import { facebookHash } from '../src/auth/facebook-oauth-policy';

// Never use DATABASE_URL as the fixture fallback, or accept a remote test target.
const connectionString = process.env.PG_TEST_DATABASE_URL;
if (connectionString) {
  const target = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
    || target.pathname !== '/radiohub_test' || target.search || target.hash) {
    throw new Error('Facebook OAuth fixtures require the explicit loopback radiohub_test database without URL options');
  }
}

describe('PostgreSQL Facebook state and mobile handoff isolation', { skip: !connectionString }, () => {
  const schema = `facebook_oauth_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
  const originalEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_SSL: process.env.POSTGRES_SSL,
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
  };
  let created = false;
  let pool: pg.Pool;
  let runtime: typeof import('../src/postgres-runtime');
  let store: typeof import('../src/data/facebook-oauth-store');
  let users: typeof import('../src/data/postgres-user-store');
  const userId = 'facebook-store-fixture';

  before(async () => {
    assert.match(schema, /^facebook_oauth_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const scoped = new URL(connectionString!);
    scoped.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = scoped.toString();
    process.env.POSTGRES_SSL = 'disable';
    runtime = await import('../src/postgres-runtime');
    pool = runtime.getPostgresPool();
    const directory = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    const files = (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
    assert.ok(files.includes('0071_facebook_mobile_handoffs.sql'));
    for (const file of files) await pool.query(await readFile(path.join(directory, file), 'utf8'));
    store = await import('../src/data/facebook-oauth-store');
    users = await import('../src/data/postgres-user-store');
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM facebook_oauth_states');
    await pool.query('DELETE FROM oauth_mobile_handoffs');
    await pool.query('DELETE FROM users');
    await users.pgCreateUser({ id: userId, username: 'fb_fixture', email: 'fixture@example.invalid' });
  });

  after(async () => {
    if (runtime) await runtime.closePostgres();
    try {
      if (created) {
        assert.match(schema, /^facebook_oauth_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {
      await admin.end();
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  it('claims browser state once across eight concurrent callbacks', async () => {
    const state = randomBytes(32).toString('hex');
    await store.createFacebookState(state);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.consumeFacebookState(state)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await store.consumeFacebookState(state), false);
  });

  it('rejects expired browser state and stores only its hash', async () => {
    const state = randomBytes(32).toString('hex');
    await store.createFacebookState(state);
    const rows = (await pool.query('SELECT * FROM facebook_oauth_states')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state_hash, facebookHash(state));
    assert.ok(!JSON.stringify(rows).includes(state));
    await pool.query("UPDATE facebook_oauth_states SET expires_at=now()-interval '1 second'");
    assert.equal(await store.consumeFacebookState(state), false);
  });

  it('does not consume a handoff for the wrong proof, then permits one parallel exchange', async () => {
    const code = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('hex');
    await store.createFacebookMobileHandoff(code, userId, facebookHash(verifier));
    assert.equal(await store.consumeFacebookMobileHandoff(code, randomBytes(32).toString('hex')), undefined);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM oauth_mobile_handoffs')).rows[0].count, 1);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.consumeFacebookMobileHandoff(code, verifier)));
    assert.equal(results.filter(value => value === userId).length, 1);
    assert.equal(results.filter(value => value === undefined).length, 7);
    assert.equal(await store.consumeFacebookMobileHandoff(code, verifier), undefined);
  });

  it('stores neither the raw mobile code nor the verifier', async () => {
    const code = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('hex');
    await store.createFacebookMobileHandoff(code, userId, facebookHash(verifier));
    const rows = (await pool.query('SELECT * FROM oauth_mobile_handoffs')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].code_hash, facebookHash(code));
    assert.equal(rows[0].challenge, facebookHash(verifier));
    assert.equal(rows[0].user_id, userId);
    assert.ok(!JSON.stringify(rows).includes(code));
    assert.ok(!JSON.stringify(rows).includes(verifier));
  });

  it('rejects expired mobile codes even with the correct proof', async () => {
    const code = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('hex');
    await store.createFacebookMobileHandoff(code, userId, facebookHash(verifier));
    await pool.query("UPDATE oauth_mobile_handoffs SET expires_at=now()-interval '1 second'");
    assert.equal(await store.consumeFacebookMobileHandoff(code, verifier), undefined);
  });

  it('deletes pending handoffs when the associated user is deleted', async () => {
    const code = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('hex');
    await store.createFacebookMobileHandoff(code, userId, facebookHash(verifier));
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM oauth_mobile_handoffs')).rows[0].count, 0);
    assert.equal(await store.consumeFacebookMobileHandoff(code, verifier), undefined);
  });

  it('creates a real PostgreSQL user without email permission and exchanges the browser handoff', async () => {
    const savedFetch = globalThis.fetch;
    let server: Server | undefined;
    process.env.FACEBOOK_APP_ID = 'fixture-facebook-app';
    process.env.FACEBOOK_APP_SECRET = 'fixture-facebook-secret';
    globalThis.fetch = (async (input: any, init: any) => {
      if (String(input).startsWith('https://graph.facebook.com/')) {
        const value = String(input).includes('/oauth/access_token')
          ? { access_token: 'fixture-provider-token' }
          : { id: '123456789012345', name: 'New Facebook Listener' };
        return new Response(JSON.stringify(value), { status: 200 });
      }
      return savedFetch(input, init);
    }) as typeof fetch;
    try {
      const { registerFacebookAuthRoutes } = await import('../src/routes/facebook-auth-routes');
      const app = express();
      app.use(express.json());
      app.use(session({ secret: 'fixture-facebook-session-secret', resave: false, saveUninitialized: false }));
      registerFacebookAuthRoutes(app, { generateAuthToken: async id => `fixture-mobile-token-${id}` });
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>(resolve => server!.once('listening', resolve));
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const base = `http://127.0.0.1:${address.port}`;
      const verifier = randomBytes(32).toString('hex');
      const start = await fetch(`${base}/api/auth/facebook?platform=mobile&code_challenge=${facebookHash(verifier)}`, { redirect: 'manual' });
      assert.equal(start.status, 302);
      const state = new URL(start.headers.get('location')!).searchParams.get('state');
      const cookie = start.headers.get('set-cookie')!.split(';')[0];
      const returned = await fetch(`${base}/api/auth/facebook/callback?state=${state}&code=fixture-provider-code`, {
        redirect: 'manual', headers: { Cookie: cookie },
      });
      assert.equal(returned.status, 302);
      const callback = new URL(returned.headers.get('location')!);
      assert.equal(callback.protocol, 'megaradio:');
      assert.equal(callback.hostname, 'facebook-auth');
      assert.equal(callback.searchParams.has('token'), false);
      const code = callback.searchParams.get('code');
      assert.ok(code);
      const exchange = await fetch(`${base}/api/auth/facebook/exchange`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier: verifier }),
      });
      assert.equal(exchange.status, 200);
      const result = await exchange.json() as any;
      const persisted = await users.pgFindUserByIdentity({ facebookId: '123456789012345' });
      assert.ok(persisted);
      assert.equal(persisted.email, 'facebook-123456789012345@oauth.invalid');
      assert.equal(persisted.emailVerified, false);
      assert.match(persisted.username, /^fb_[a-f0-9]{24}$/);
      assert.equal(persisted.fullName, 'New Facebook Listener');
      assert.equal(result.user._id, persisted._id);
      assert.equal(result.token, `fixture-mobile-token-${persisted._id}`);
      assert.equal(await store.consumeFacebookMobileHandoff(code, verifier), undefined);
    } finally {
      globalThis.fetch = savedFetch;
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      }
    }
  });
});
