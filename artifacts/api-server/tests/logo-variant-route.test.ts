import assert from 'node:assert/strict';
import { after, before, beforeEach, it, mock } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { parseLogoVariantRequest, LogoVariantRequestError } from '../src/services/logo-variant-backfill';
let calls: any[] = [], failure: any;
mock.module('../src/services/logo-variant-backfill', { namedExports: {
  parseLogoVariantRequest, LogoVariantRequestError,
  backfillLogoVariants: async (request: any) => { calls.push(request); if (failure) throw failure; return { ...request, updated: 0, results: [] }; },
} });
mock.module('../src/data/postgres-catalog-store', { namedExports: { pgCatalog: () => { throw new Error('Unrelated catalog access forbidden'); } } });
mock.module('../src/services/sync', { namedExports: { syncService: {} } });
mock.module('../src/services/precomputed-stations', { namedExports: { PrecomputedStationsService: {} } });
mock.module('../src/services/logo-processor', { namedExports: { logoProcessor: {} } });
mock.module('../src/services/scheduled-logo-processor', { namedExports: { scheduledLogoProcessor: {} } });
mock.module('../src/services/indexnow', { namedExports: { IndexNowService: {} } });
mock.module('../src/cache', { defaultExport: {} });
const { registerLogoRoutes } = await import('../src/routes/logo-routes');
let server: Server, base: string;
before(async () => {
  const app = express(); app.use(express.json());
  registerLogoRoutes(app, { requireAuth: () => {}, stripPlaceholders: value => value,
    requireAdmin: (req: any, res: any, next: any) => req.headers['x-offline-admin'] === 'allowed' ? next() : res.status(401).json({ error: 'Admin authentication required' }) });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/logos/backfill-variants`;
});
beforeEach(() => { calls = []; failure = undefined; });
after(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
const id = '1234567890abcdef12345678';
const post = (body: unknown, admin = true) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-offline-admin': 'allowed' } : {}) }, body: JSON.stringify(body) });
it('requires admin authentication before any source/storage operation', async () => {
  assert.equal((await post({ stationIds: [id], dryRun: false }, false)).status, 401); assert.equal(calls.length, 0);
});
it('defaults to preview and never caches the authenticated response', async () => {
  const res = await post({ stationIds: [id] }); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, [{ stationIds: [id], dryRun: true }]);
});
it('only explicit boolean false enables the bounded apply operation', async () => {
  assert.equal((await post({ stationIds: [id], dryRun: false })).status, 200); assert.equal(calls[0].dryRun, false);
});
for (const body of [{ stationIds: [id, id] }, { stationIds: [id], dryRun: 'false' }, { stationIds: [id], limit: 1000 }, { stationIds: [] }]) {
  it(`rejects invalid request at HTTP boundary ${JSON.stringify(body)}`, async () => { assert.equal((await post(body)).status, 400); assert.equal(calls.length, 0); });
}
it('returns a bounded busy response and hides unexpected internal error details', async () => {
  failure = Object.assign(new Error('A logo variant batch is already running'), { status: 409 });
  assert.equal((await post({ stationIds: [id] })).status, 409);
  failure = new Error('private diagnostic detail'); const res = await post({ stationIds: [id] });
  assert.equal(res.status, 500); assert.ok(!(await res.text()).includes('private diagnostic detail'));
});
