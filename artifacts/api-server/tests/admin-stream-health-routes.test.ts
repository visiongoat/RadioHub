import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { getStreamRecoverySnapshot, assertRecoverableStation } from '../src/utils/station-health-recovery';

const id = 'a'.repeat(24);
let station: any, calls: any[], dbFailure: boolean, probeFailure: boolean, cacheFailure: boolean, saveStatus: string;
let server: Server, base: string;
const evidence = () => ({ checkedAt: new Date().toISOString(), contentType: 'audio/mpeg', bytesRead: 1024 });
before(async () => {
  mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool:()=>({query:async()=>{
    calls.push(['status']);if(dbFailure)throw new Error('secret DB URL');
    return {rows:[{tracked:40,due:2,hidden_from_lists:3,summary:{checked:12}}]};
  }})}});
  mock.module('../src/utils/station-health-recovery', { namedExports: { getStreamRecoverySnapshot, assertRecoverableStation,
    probeStationStream: async (url: string) => { calls.push(['probe', url]); if (probeFailure) throw new Error('secret stream URL'); return evidence(); } } });
  mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => ({
    findById: async (value: string) => { calls.push(['read', value]); if (dbFailure) throw new Error('secret database URL'); return station; },
    recoverStreamHealth: async (...args: any[]) => { calls.push(['save', ...args]); if (saveStatus === 'throw') throw new Error('secret DB');
      return saveStatus === 'updated' ? { status: 'updated', station: { ...station, noIndex: false, lastCheckOk: true } } : { status: saveStatus }; },
  }) } });
  mock.module('../src/performance-cache', { namedExports: { performanceCache: { invalidateStationCache: (slug: string) => { calls.push(['seo-cache', slug]); if (cacheFailure) throw new Error('secret cache'); } } } });
  mock.module('../src/cache', { defaultExport: { del: async (key: string) => calls.push(['cache', key]), clearByPattern: async (key: string) => calls.push(['pattern', key]) } });
  const { registerAdminStreamHealthRoutes } = await import('../src/routes/admin-stream-health-routes');
  const app = express(); app.use(express.json({ limit: '1mb' }));
  registerAdminStreamHealthRoutes(app, (req, res, next) => req.get('x-test-admin') === '1' ? next() : void res.status(401).json({ error: 'Admin required' }));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = 'http://127.0.0.1:' + (server.address() as any).port;
});
beforeEach(() => {
  station = { _id: id, name: 'NRJ Oriental', slug: 'nrj-oriental', slugAliases: ['old-nrj'], url: 'https://example.invalid/raw', urlResolved: 'https://example.invalid/resolved',
    noIndex: true, lastCheckOk: false, lastCheckTime: '2025-01-01T00:00:00Z', lastCheckOkTime: '2024-01-01T00:00:00Z', manualEditFields: {} };
  calls = []; dbFailure = probeFailure = cacheFailure = false; saveStatus = 'updated';
});
after(async () => { server?.closeAllConnections(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); mock.restoreAll(); });
const body = () => ({ expected: getStreamRecoverySnapshot(station), confirmRecovery: true });
const post = (payload: any = body(), authorized = true, target = id) => fetch(`${base}/api/admin/stations/${target}/recover-stream-health`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { 'x-test-admin': '1' } : {}) }, body: JSON.stringify(payload),
});

test('admin authentication occurs before any read, probe or mutation', async () => {
  assert.equal((await post(body(), false)).status, 401); assert.deepEqual(calls, []);
});
test('automatic health status is admin-only, bounded, uncached and contains no stream URLs',async()=>{
  assert.equal((await fetch(`${base}/api/admin/stream-health/status`)).status,401);assert.deepEqual(calls,[]);
  const response=await fetch(`${base}/api/admin/stream-health/status`,{headers:{'x-test-admin':'1'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const value=await response.json();assert.equal(value.batchLimit,12);assert.equal(value.concurrency,2);
  assert.equal(value.hidden_from_lists,3);assert.ok(!JSON.stringify(value).includes('https://'));
  dbFailure=true;const failure=await fetch(`${base}/api/admin/stream-health/status`,{headers:{'x-test-admin':'1'}});
  assert.equal(failure.status,503);assert.ok(!(await failure.text()).includes('secret'));
});
test('only persisted raw and resolved candidates are probed and committed result invalidates same-station keys', async () => {
  const response = await post(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json(); assert.equal(result.success, true); assert.equal(result.noIndex, false); assert.equal(result.cacheInvalidated, true);
  assert.deepEqual(calls.find(call => call[0] === 'probe')[1], [station.urlResolved,station.url]);
  assert.deepEqual(calls.find(call => call[0] === 'save').slice(1, 3), [id, body().expected]);
  assert.ok(calls.some(call => call[1] === 'public-health:v2:station:detail:editorial-v3-taxonomy:old-nrj'));
  assert.ok(calls.some(call => call[1] === `public-health:v2:station:detail:editorial-v3-taxonomy:${id}`));
  assert.ok(!JSON.stringify(result).includes('https://'));
});
test('strict confirmation/body/id and32KiB bound survive an earlier global JSON parser', async () => {
  for (const payload of [null, [], { expected: {} }, { ...body(), confirmRecovery: 'true' }, { ...body(), url: 'http://localhost' },
    { expected: [], confirmRecovery: true }, { expected: { extra: 'x'.repeat(33000) }, confirmRecovery: true }]) {
    assert.equal((await post(payload)).status, 400);
  }
  assert.equal((await post(body(), true, 'not-an-id')).status, 400); assert.deepEqual(calls, []);
});
test('snapshot conflict is rejected before outbound probe', async () => {
  const expected = body(); station.urlResolved = 'https://example.invalid/changed';
  assert.equal((await post(expected)).status, 409); assert.deepEqual(calls.map(call => call[0]), ['read']);
});
test('manual/redirect/quality exclusions cannot be repaired', async () => {
  for (const patch of [{ manualEditFields: { noIndex: true } }, { manualEditFields: {}, redirectToSlug: 'other' }, { redirectToSlug: null, slug: 'test-stream' }]) {
    Object.assign(station, patch); calls = []; assert.equal((await post()).status, 422); assert.deepEqual(calls.map(call => call[0]), ['read']);
  }
});
test('probe failure returns generic422 and never writes', async () => {
  probeFailure = true; const response = await post(); assert.equal(response.status, 422); assert.ok(!(await response.text()).includes('secret'));
  assert.ok(!calls.some(call => call[0] === 'save'));
});
test('native CAS conflict/rejected/missing and database failure stay distinct', async () => {
  for (const [status, http] of [['conflict', 409], ['rejected', 422], ['missing', 404], ['throw', 503]] as const) {
    saveStatus = status; const response = await post(); assert.equal(response.status, http); assert.ok(!(await response.text()).includes('secret'));
  }
  dbFailure = true; calls = []; assert.equal((await post()).status, 503); assert.deepEqual(calls.map(call => call[0]), ['read']);
});
test('committed recovery remains success when a cache refresh fails and attempts remaining keys', async () => {
  cacheFailure = true; const response = await post(); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.success, true); assert.equal(result.cacheInvalidated, false); assert.ok(result.cacheWarning);
  assert.ok(calls.some(call => call[1] === `public-health:v2:station:detail:editorial-v3-taxonomy:${id}`)); assert.ok(!JSON.stringify(result).includes('secret'));
});
