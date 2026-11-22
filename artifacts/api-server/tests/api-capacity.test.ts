import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { Server } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import { apiConnectionSnapshot, createAuthApiLimiter, createGlobalApiLimiter, readApiCapacityConfig } from '../src/lib/api-capacity';

async function fixture(requestsPerMinute = 600) {
  const app = express();
  // Railway is the closest trusted proxy. Never trust every supplied hop or
  // turn arbitrary CF-Connecting-IP/X-Real-IP values into quota identities.
  app.set('trust proxy', 1);
  app.use('/api', createGlobalApiLimiter({ maxConnections: 300, requestsPerMinute }));
  app.use('/api/auth/login', createAuthApiLimiter());
  app.get('/api/stations', (req, res) => res.json({ ip: req.ip }));
  app.post('/api/auth/login', (req, res) => res.status(req.headers['x-fixture-success'] ? 200 : 401).json({ fixture: true }));
  app.get(['/healthz', '/readyz', '/api/health', '/api/healthz', '/api/readyz'], (_req, res) => res.json({ ready: true }));
  app.get('/api/health/private', (_req, res) => res.json({ private: true }));
  const server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  return {
    server, base,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

test('capacity environment values are bounded complete decimal integers; zero never disables protection', () => {
  assert.deepEqual(readApiCapacityConfig({}), { maxConnections: 300, requestsPerMinute: 600 });
  assert.deepEqual(readApiCapacityConfig({ API_MAX_CONNECTIONS: ' 1500 ', API_RATE_LIMIT_MAX: '1200' }), { maxConnections: 1500, requestsPerMinute: 1200 });
  assert.deepEqual(readApiCapacityConfig({ API_MAX_CONNECTIONS: '20000', API_RATE_LIMIT_MAX: '6000' }), { maxConnections: 20000, requestsPerMinute: 6000 });
  for (const value of ['', '0', '-1', '2.5', '2e3', '30junk', 'Infinity', '9007199254740993']) {
    assert.deepEqual(readApiCapacityConfig({ API_MAX_CONNECTIONS: value, API_RATE_LIMIT_MAX: value }), { maxConnections: 300, requestsPerMinute: 600 }, value);
  }
  assert.deepEqual(readApiCapacityConfig({ API_MAX_CONNECTIONS: '20001', API_RATE_LIMIT_MAX: '6001' }), { maxConnections: 300, requestsPerMinute: 600 });
});

test('the /api mount is actually limited; forged crawler UA and untrusted IP headers do not rotate a NAT bucket', async () => {
  const f = await fixture(2);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(f.base + '/api/stations', { headers: {
        'x-forwarded-for': `198.51.100.${attempt + 1}, 203.0.113.44`,
        'x-real-ip': `198.51.100.${attempt + 20}`,
        'cf-connecting-ip': `198.51.100.${attempt + 40}`,
        'user-agent': attempt ? 'Googlebot/2.1' : 'MegaRadioFixture',
      } });
      assert.equal(response.status, attempt < 2 ? 200 : 429);
      assert.equal(response.headers.get('ratelimit-limit'), '2');
      if (attempt < 2) assert.equal((await response.json() as any).ip, '203.0.113.44');
      else {
        assert.ok(response.headers.get('retry-after'));
        assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
        assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
      }
    }
    // A different closest-hop client gets its own bounded bucket.
    const other = await fetch(f.base + '/api/stations', { headers: { 'x-forwarded-for': '203.0.113.45' } });
    assert.equal(other.status, 200);
  } finally { await f.close(); }
});

test('IPv6 host rotation stays in the existing express-rate-limit /56 quota', async () => {
  const f = await fixture(2);
  try {
    for (const [index, ip] of ['2001:db8:1234:ab01::1', '2001:db8:1234:ab02::2', '2001:db8:1234:abff::3'].entries()) {
      const response = await fetch(f.base + '/api/stations', { headers: { 'x-forwarded-for': ip } });
      assert.equal(response.status, index < 2 ? 200 : 429);
      await response.arrayBuffer();
    }
  } finally { await f.close(); }
});

test('exact operational probes remain available after a quota is exhausted; similarly named paths do not', async () => {
  const f = await fixture(1), headers = { 'x-forwarded-for': '203.0.113.60' };
  try {
    assert.equal((await fetch(f.base + '/api/stations', { headers })).status, 200);
    for (const path of ['/healthz', '/readyz', '/api/health', '/api/healthz', '/api/readyz']) {
      assert.equal((await fetch(f.base + path, { headers })).status, 200, path);
    }
    assert.equal((await fetch(f.base + '/api/health/private', { headers })).status, 429);
  } finally { await f.close(); }
});

test('auth keeps ten failed attempts per fifteen minutes, discounts success and never trusts bot UA', async () => {
  const f = await fixture(), headers = { 'x-forwarded-for': '203.0.113.70', 'user-agent': 'Googlebot/2.1' };
  try {
    for (let index = 0; index < 15; index++) {
      const response = await fetch(f.base + '/api/auth/login', { method: 'POST', headers: { ...headers, 'x-fixture-success': '1' } });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    for (let index = 0; index < 11; index++) {
      const response = await fetch(f.base + '/api/auth/login', { method: 'POST', headers });
      assert.equal(response.status, index < 10 ? 401 : 429);
      assert.equal(response.headers.get('ratelimit-limit'), '10');
      if (response.status === 429) assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
      await response.arrayBuffer();
    }
  } finally { await f.close(); }
});

test('health reports actual aggregate TCP/WS counts without exposing private peer data', async () => {
  const f = await fixture(), server = Object.assign(f.server, {
    maxConnections: 321,
    metadataWss: { clients: new Set(['private-metadata-user']) },
    castWss: { clients: new Set(['private-cast-ticket']) },
    chatWss: { clients: new Set(['private-chat-session', 'private-other-session']) },
  });
  const connected = once(server, 'connection');
  const socket = createConnection({ host: '127.0.0.1', port: (server.address() as any).port });
  await connected;
  try {
    const result = await apiConnectionSnapshot(server, { maxConnections: 300, requestsPerMinute: 600 });
    assert.equal(result.active, 1);
    assert.equal(result.limit, 321);
    assert.deepEqual(result.websocket, { metadata: 1, cast: 1, chat: 2 });
    assert.doesNotMatch(JSON.stringify(result), /private-/);
    assert.deepEqual(await apiConnectionSnapshot(undefined, { maxConnections: 300, requestsPerMinute: 600 }), {
      active: null, limit: 300, perIpRequestsPerMinute: 600, websocket: { metadata: 0, cast: 0, chat: 0 },
    });
  } finally { socket.destroy(); await f.close(); }
});

test('connection count errors stay non-sensitive and do not fail the health response', async () => {
  const server = { getConnections: (callback: (error: Error, count: number) => void) => callback(new Error('credential-fixture'), 9) } as any;
  const snapshot = await apiConnectionSnapshot(server, { maxConnections: 300, requestsPerMinute: 600 });
  assert.equal(snapshot.active, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /credential/);
});

test('the production entrypoint applies the same tested limits and preserves the trusted-proxy boundary', async () => {
  const source = await readFile(new URL('../src/index-api.ts', import.meta.url), 'utf8');
  assert.match(source, /app\.set\('trust proxy', 1\)/);
  assert.match(source, /app\.use\('\/api', globalApiLimiter\)/);
  assert.match(source, /app\.use\('\/api\/auth\/login', authLimiter\)/);
  assert.match(source, /server\.maxConnections = apiCapacity\.maxConnections/);
  assert.match(source, /connections: await apiConnectionSnapshot/);
  assert.doesNotMatch(source, /SEARCH_BOT_RE/);
});
