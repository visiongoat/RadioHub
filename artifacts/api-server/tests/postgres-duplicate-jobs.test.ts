import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import { createNativePostgresFixture, type NativePostgresFixture } from './helpers/native-postgres-fixture';
import { PostgresCatalogStore, pgSyncBlacklist, pgBlacklistAdd, pgBlacklistFind } from '../src/data/postgres-catalog-store';
import { DUPLICATE_AUTO_DISCOVERY_BACKOFF_MS, DUPLICATE_MERGE_FAILURE_BACKOFF_MS, PostgresDuplicateJobsStore } from '../src/data/postgres-duplicate-jobs-store';
import { buildSyncBlacklist } from '../src/utils/sync-blacklist';

const url = process.env.PG_TEST_DATABASE_URL;
if (url && !/^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost):\d+\/[^?]*test[^?]*$/.test(url)) throw new Error('Duplicate tests require an explicit loopback test database');

describe('durable duplicate preview/apply worker', { skip: !url }, () => {
  let fixture: NativePostgresFixture, store: PostgresDuplicateJobsStore, catalog: PostgresCatalogStore, now: Date;
  let sequence = 0;
  before(async () => {
    fixture = await createNativePostgresFixture('duplicate_jobs');
    store = new PostgresDuplicateJobsStore(fixture.pool);
    catalog = new PostgresCatalogStore(fixture.pool);
  });
  after(async () => { await fixture?.close(); });
  beforeEach(async () => {
    await fixture.clear('station_duplicate_jobs', 'stations', 'station_blacklist', 'catalog_sync_runs');
    now = new Date(); sequence = 0;
    await fixture.pool.query("UPDATE station_duplicate_merge_control SET next_cycle_at=$1,next_auto_at=$1::timestamptz+interval '24 hours',last_run_at=NULL,summary='{}'", [now]);
  });
  const add = async (name: string, patch: Record<string, any> = {}) => {
    const id = (++sequence).toString(16).padStart(24, '0');
    // Seed legacy duplicates directly; the ordinary catalog insert guard now
    // prevents creating these same-name/URL duplicates in the first place.
    return fixture.insert('stations', { _id: id, stationuuid: 'fixture-' + id, slug: 'station-' + id,
      name, country: 'Austria', countryCode: 'AT', city: 'Vienna',
      url: 'https://example.invalid/' + encodeURIComponent(name), votes: sequence, ...patch });
  };
  const advance = () => { now = new Date(+now + 16_000); return now; };
  const interceptCycle = (query: (client: pg.PoolClient, sql: string, values?: unknown[]) => Promise<pg.QueryResult>,
    onRelease?: (destroy?: boolean | Error) => void) => new PostgresDuplicateJobsStore({
    get waitingCount() { return fixture.pool.waitingCount; },
    async connect() {
      const client = await fixture.pool.connect();
      return {
        query: (sql: string, values?: unknown[]) => query(client, sql, values),
        release: (destroy?: boolean | Error) => { onRelease?.(destroy); client.release(destroy); },
      };
    },
  } as pg.Pool);
  const controlRow = async () => (await fixture.pool.query('SELECT * FROM station_duplicate_merge_control WHERE id=1')).rows[0];
  const finish = async (jobId: string, max = 40) => {
    for (let index = 0; index < max; index++) {
      const job = await store.getJob(jobId);
      if (job?.status !== 'running') return job!;
      await store.runCycle(advance());
    }
    throw new Error('Fixture job did not finish');
  };

  it('preview persists eligible/skipped reasons without merging or hydrating source payloads', async () => {
    await add('Safe station'); await add('Safe station');
    await add('Different stream'); await add('Different stream', { url: 'https://other.invalid/live' });
    await add('Different city'); await add('Different city', { city: 'Graz' });
    const id = await store.createPreview();
    const job = await finish(id);
    assert.equal(job.status, 'completed'); assert.equal(job.dryRun, true);
    assert.equal(job.results.totalGroups, 3); assert.equal(job.results.eligibleGroups, 1); assert.equal(job.results.skippedGroups, 2);
    assert.equal(job.results.totalStationsToDelete, 1); assert.equal(job.results.totalStationsDeleted, 0);
    assert.equal(await catalog.count(), 6);
    assert.ok(job.results.skippedReasons.some(item => item.reason.includes('city')));
    assert.equal((await fixture.pool.query('SELECT station_ids FROM station_duplicate_job_groups WHERE job_id=$1 AND status=$2', [id,'eligible'])).rows[0].station_ids.length, 2);
  });

  it('automatic stream prefilter retains Unicode/whitespace matches without accepting same-stream different identities', async () => {
    await add('ＦＭ  Radio', { url: ' https://fixture.invalid/shared ' });
    await add('fm Radio', { url: 'https://fixture.invalid/shared' });
    const different = await add('Another station', { url: 'https://fixture.invalid/shared' });
    const unique = await add('fm Radio', { url: 'https://fixture.invalid/unique' });
    const emptyA = await add('Empty', { url: '' });
    const emptyB = await add('Empty', { url: '  ' });
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    await store.runCycle(advance());
    const job = (await store.getStatus()).latestApply!;
    const done = await finish(job.jobId);
    assert.equal(done.results.totalGroups, 1);
    assert.equal(done.results.totalStationsDeleted, 1);
    for (const station of [different, unique, emptyA, emptyB]) assert.ok(await catalog.findById(station._id));
  });

  it('requires a completed preview, applies immutable IDs once, and preserves added stations', async () => {
    await add('Safe station'); await add('Safe station');
    await assert.rejects(store.createApply(undefined), { status: 400 });
    const preview = await store.createPreview();
    await assert.rejects(store.createApply(preview), { status: 409 });
    await finish(preview);
    const extra = await add('Safe station');
    const apply = await store.createApply(preview);
    assert.equal(await store.createApply(preview), apply);
    const job = await finish(apply);
    assert.equal(job.status, 'completed'); assert.equal(job.previewJobId, preview);
    assert.equal(job.results.mergedGroups, 1); assert.equal(job.results.totalStationsDeleted, 1);
    assert.equal(await catalog.count(), 2);
    assert.ok(await catalog.findOne({ _id: extra._id }));
    assert.equal(await store.createApply(preview), apply);
  });
  it('cancels only active previews, never a merge, and cannot apply partial results', async () => {
    await add('Cancel'); await add('Cancel');
    const cancelled = await store.createPreview(); await store.cancelPreview(cancelled);
    assert.equal((await store.getJob(cancelled))!.status, 'failed');
    await assert.rejects(store.createApply(cancelled), { status: 409 });
    await assert.rejects(store.cancelPreview(cancelled), { status: 409 });
    await assert.rejects(store.cancelPreview('invalid'), { status: 400 });
    const preview = await store.createPreview(); await finish(preview);
    await assert.rejects(store.cancelPreview(preview), { status: 409 });
    const apply = await store.createApply(preview);
    await assert.rejects(store.cancelPreview(apply), { status: 409 });
    assert.equal((await finish(apply)).results.totalStationsDeleted, 1);
  });

  it('previews and applies disjoint safe subsets inside a mixed name group, leaving unmatched IDs untouched', async () => {
    const a = await add('Mixed'); const b = await add('Mixed');
    const c = await add('Mixed', { url: 'https://other.invalid/live' }); const d = await add('Mixed', { url: 'https://other.invalid/live' });
    const leftover = await add('Mixed', { url: 'https://unmatched.invalid/live' });
    const preview = await store.createPreview(), planned = await finish(preview);
    assert.equal(planned.results.totalGroups, 3); assert.equal(planned.results.eligibleGroups, 2);
    assert.equal(planned.results.skippedGroups, 1); assert.equal(planned.results.totalStationsToDelete, 2);
    const rows = (await fixture.pool.query('SELECT station_ids FROM station_duplicate_job_groups WHERE job_id=$1', [preview])).rows;
    assert.equal(new Set(rows.flatMap(row => row.station_ids)).size, 5);
    assert.equal(rows.reduce((sum, row) => sum + row.station_ids.length, 0), 5);
    const applied = await finish(await store.createApply(preview));
    assert.equal(applied.results.mergedGroups, 2); assert.equal(applied.results.totalStationsDeleted, 2);
    assert.equal(await catalog.count(), 3); assert.ok(await catalog.findOne({ _id: leftover._id }));
    for (const [loser, survivor] of [[a,b],[c,d]]) {
      const alias = (await fixture.pool.query('SELECT station_id FROM station_merge_aliases WHERE alias=$1', [loser._id])).rows[0];
      assert.equal(alias.station_id, survivor._id);
    }
  });

  it('a fully partitioned mixed group has no duplicate or phantom skipped members', async () => {
    await add('Two streams'); await add('Two streams');
    await add('Two streams', { url: 'https://other.invalid/live' }); await add('Two streams', { url: 'https://other.invalid/live' });
    const planned = await finish(await store.createPreview());
    assert.equal(planned.results.totalGroups, 2); assert.equal(planned.results.eligibleGroups, 2);
    assert.equal(planned.results.skippedGroups, 0); assert.equal(planned.progress.groupsProcessed, 2);
  });

  it('automatic discovery merges exact subsets even when the same name has other endpoints', async () => {
    await add('Mixed auto'); await add('Mixed auto');
    await add('Mixed auto', { url: 'https://other.invalid/live' }); await add('Mixed auto', { url: 'https://other.invalid/live' });
    const unrelated = await add('Mixed auto', { url: 'https://unmatched.invalid/live' });
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    await store.runCycle(advance());
    const applied = await finish((await store.getStatus()).latestApply!.jobId);
    assert.equal(applied.results.totalGroups, 2); assert.equal(applied.results.mergedGroups, 2);
    assert.equal(applied.results.totalStationsDeleted, 2); assert.equal(await catalog.count(), 3);
    assert.ok(await catalog.findOne({ _id: unrelated._id }));
  });
  it('retains the open canonical even when an excluded clone has more votes; manual exclusions and redirects stay separate', async () => {
    const open = await add('Open canonical', { noIndex: false, votes: 1 });
    const excluded = await add('Open canonical', { noIndex: true, votes: 9999 });
    await add('Manual exclusion'); await add('Manual exclusion', { noIndex: true, manualEditFields: { noIndex: true } });
    await add('Existing redirect'); await add('Existing redirect', { noIndex: true, redirectToSlug: 'different-target' });
    const preview = await store.createPreview(), planned = await finish(preview);
    assert.equal(planned.results.eligibleGroups, 1); assert.equal(planned.results.skippedGroups, 2);
    const applied = await finish(await store.createApply(preview));
    assert.equal(applied.results.totalStationsDeleted, 1);
    const survivor = await catalog.findOne({ _id: open._id });
    assert.equal(survivor?.noIndex, false); assert.equal(survivor?.votes, 10000);
    assert.equal(await catalog.findOne({ _id: excluded._id }), null);
    assert.equal((await fixture.pool.query('SELECT station_id FROM station_merge_aliases WHERE alias=$1', [excluded._id])).rows[0].station_id, open._id);
  });
  it('revalidates a newly protected SEO decision between preview and apply', async () => {
    await add('New manual fence'); const changed = await add('New manual fence');
    const preview = await store.createPreview(); await finish(preview);
    await fixture.pool.query(`UPDATE stations SET no_index=true,manual_edit_fields='{"noIndex":true}' WHERE id=$1`, [changed._id]);
    const job = await finish(await store.createApply(preview));
    assert.equal(job.results.skippedGroups, 1); assert.equal(job.results.totalStationsDeleted, 0);
    assert.equal(await catalog.count(), 2);
  });

  it('revalidates changed URLs and missing preview members before merging', async () => {
    await add('Changed'); const changed = await add('Changed');
    await add('Missing'); const missing = await add('Missing');
    const preview = await store.createPreview(); await finish(preview);
    await fixture.pool.query('UPDATE stations SET url=$2 WHERE id=$1', [changed._id, 'https://different.invalid/live']);
    await fixture.pool.query('DELETE FROM stations WHERE id=$1', [missing._id]);
    const apply = await store.createApply(preview), job = await finish(apply);
    assert.equal(job.status, 'completed'); assert.equal(job.results.skippedGroups, 2);
    assert.equal(job.results.totalStationsDeleted, 0); assert.equal(await catalog.count(), 3);
  });

  it('shares max10 group quota between replicas and resumes after restart', async () => {
    for (let i = 0; i < 21; i++) { await add('Group ' + i); await add('Group ' + i); }
    const id = await store.createPreview();
    const results = await Promise.all([store.runCycle(now), new PostgresDuplicateJobsStore(fixture.pool).runCycle(now)]);
    assert.ok(results.reduce((sum,result) => sum + result.processed, 0) <= 10);
    const first = await store.getJob(id);
    assert.equal(first?.status, 'running'); assert.ok(first!.progress.groupsProcessed <= 10);
    assert.equal((await store.runCycle(now)).processed, 0);
    store = new PostgresDuplicateJobsStore(fixture.pool);
    const complete = await finish(id);
    assert.equal(complete.results.eligibleGroups, 21); assert.equal(complete.progress.groupsProcessed, 21);
  });

  it('persists separate automatic discovery and cycle cooldowns across replicas and restart', async () => {
    await add('Slow seed'); await add('Slow seed');
    await fixture.pool.query(`UPDATE station_duplicate_merge_control SET next_auto_at=$1,
      next_cycle_at=$1::timestamptz-interval '1 millisecond'+interval '123 microseconds',summary=$2::jsonb`,
    [now, JSON.stringify({ automaticCursor: { name: 'a', country: 'a', stream: 'https://example.invalid/previous' }, retained: true })]);
    const before = await controlRow();
    await fixture.pool.query(`CREATE FUNCTION slow_duplicate_seed() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$;
      CREATE TRIGGER slow_duplicate_seed BEFORE INSERT ON station_duplicate_job_groups FOR EACH ROW EXECUTE FUNCTION slow_duplicate_seed()`);
    try {
      await assert.rejects(store.runCycle(advance()), { code: '57014' });
    } finally {
      await fixture.pool.query('DROP TRIGGER slow_duplicate_seed ON station_duplicate_job_groups; DROP FUNCTION slow_duplicate_seed()');
    }
    const deferred = await controlRow(), retryAt = +new Date(deferred.next_cycle_at);
    const autoRetryAt = +new Date(deferred.next_auto_at);
    assert.ok(retryAt >= +now + DUPLICATE_MERGE_FAILURE_BACKOFF_MS);
    assert.ok(retryAt <= +now + DUPLICATE_MERGE_FAILURE_BACKOFF_MS + 1_000);
    assert.ok(autoRetryAt >= +now + DUPLICATE_AUTO_DISCOVERY_BACKOFF_MS);
    assert.ok(autoRetryAt <= +now + DUPLICATE_AUTO_DISCOVERY_BACKOFF_MS + 1_000);
    const { automaticDiscoveryRetryAt, ...summary } = deferred.summary;
    assert.ok(Math.abs(+new Date(automaticDiscoveryRetryAt) - autoRetryAt) <= 1);
    assert.deepEqual({ ...deferred, next_cycle_at: before.next_cycle_at, next_auto_at: before.next_auto_at, summary }, before);
    assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM station_duplicate_jobs')).rows[0].n, 0);
    assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM station_duplicate_job_groups')).rows[0].n, 0);
    assert.equal(await catalog.count(), 2);
    for (const offset of [5_000, 15_000, DUPLICATE_MERGE_FAILURE_BACKOFF_MS - 1]) {
      const result = await new PostgresDuplicateJobsStore(fixture.pool).runCycle(new Date(+now + offset));
      assert.equal(result.deferred, true); assert.equal(result.deleted, 0);
    }
    assert.deepEqual(await controlRow(), deferred);
    for (const cycleAt of [retryAt + 1, autoRetryAt - 16_000]) {
      const result = await new PostgresDuplicateJobsStore(fixture.pool).runCycle(new Date(cycleAt));
      assert.equal(result.deleted, 0); assert.equal(result.completed, false);
      assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM station_duplicate_jobs')).rows[0].n, 0);
      assert.equal(+new Date((await controlRow()).next_auto_at), autoRetryAt);
    }
    now = new Date(autoRetryAt + 1);
    const result = await new PostgresDuplicateJobsStore(fixture.pool).runCycle(now);
    assert.equal(result.deferred, false); assert.equal(result.deleted, 1); assert.equal(result.refreshCounts, true);
    assert.equal(await catalog.count(), 1);
    assert.equal((await controlRow()).summary.automaticDiscoveryRetryAt, undefined);
    assert.equal((await controlRow()).summary.retained, true);
    assert.equal(+new Date((await controlRow()).next_auto_at), +now + 86_400_000);
  });

  for (const existing of [false, true]) {
    it(`runs queued manual work during discovery cooldown and retries a ${existing ? 'persisted' : 'new'} automatic scan`, async () => {
      await add('Manual during cooldown'); await add('Manual during cooldown');
      const preview = await store.createPreview(); await finish(preview);
      const automaticId = 'a'.repeat(24);
      if (existing) await fixture.pool.query("INSERT INTO station_duplicate_jobs(id,kind) VALUES($1,'automatic')", [automaticId]);
      const scheduledAutoAt = new Date(+now + (existing ? 86_400_000 : 0));
      await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [scheduledAutoAt]);
      const before = await controlRow(), original = Object.assign(new Error('simulated discovery timeout'), { code: '57014' });
      let apply = '', automaticScans = 0;
      const failing = interceptCycle(async (client, sql, values) => {
        if (sql.startsWith('WITH grouped AS') && sql.includes('AND bool_and')) {
          automaticScans++;
          if (automaticScans === 1) {
            apply = await store.createApply(preview);
            throw original;
          }
        }
        return client.query(sql, values);
      });
      await assert.rejects(failing.runCycle(advance()), error => error === original);
      const deferred = await controlRow(), discoveryRetryAt = +new Date(deferred.summary.automaticDiscoveryRetryAt);
      assert.ok(discoveryRetryAt >= +now + DUPLICATE_AUTO_DISCOVERY_BACKOFF_MS);
      assert.equal(deferred.last_run_at.getTime(), before.last_run_at.getTime());
      assert.equal((await store.getJob(apply))?.progress.groupsProcessed, 0);
      if (existing) {
        assert.equal(+new Date(deferred.next_auto_at), +scheduledAutoAt);
        const job = (await fixture.pool.query('SELECT * FROM station_duplicate_jobs WHERE id=$1', [automaticId])).rows[0];
        assert.equal(job.phase, 'scan'); assert.equal(job.status, 'queued'); assert.equal(job.started_at, null);
      }
      now = new Date(+new Date(deferred.next_cycle_at) + 1);
      assert.ok(+now < discoveryRetryAt);
      const manualResult = await failing.runCycle(now);
      assert.equal(manualResult.deleted, 1); assert.equal(manualResult.completed, true);
      assert.equal((await store.getJob(apply))?.status, 'completed');
      const nextPreview = await store.createPreview();
      await failing.runCycle(advance());
      assert.equal((await store.getJob(nextPreview))?.status, 'completed');
      await failing.runCycle(new Date(discoveryRetryAt - 16_000));
      assert.equal(automaticScans, 1);
      assert.deepEqual((await controlRow()).next_auto_at, deferred.next_auto_at);
      const result = await new PostgresDuplicateJobsStore(fixture.pool).runCycle(new Date(discoveryRetryAt + 1));
      assert.equal(result.completed, true);
      const automatic = (await fixture.pool.query("SELECT * FROM station_duplicate_jobs WHERE kind='automatic'")).rows;
      assert.equal(automatic.length, 1); assert.equal(automatic[0].status, 'completed');
      if (existing) assert.equal(automatic[0].id, automaticId);
      assert.equal((await controlRow()).summary.automaticDiscoveryRetryAt, undefined);
    });
  }

  it('does not delay an automatic job already evaluating frozen groups during discovery cooldown', async () => {
    const id = 'b'.repeat(24), retryAt = new Date(+now + DUPLICATE_AUTO_DISCOVERY_BACKOFF_MS);
    await fixture.pool.query("INSERT INTO station_duplicate_jobs(id,kind,phase) VALUES($1,'automatic','evaluate')", [id]);
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET summary=$1::jsonb',
      [JSON.stringify({ automaticDiscoveryRetryAt: retryAt.toISOString() })]);
    const before = await controlRow();
    const result = await store.runCycle(now);
    assert.equal(result.completed, true); assert.equal(result.deleted, 0);
    assert.equal((await store.getJob(id))?.status, 'completed');
    assert.deepEqual((await controlRow()).next_auto_at, before.next_auto_at);
    assert.equal((await controlRow()).summary.automaticDiscoveryRetryAt, retryAt.toISOString());
  });

  it('renews only automatic discovery cooldown on repeated simulated timeouts without recording success', async () => {
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    for (let attempt = 0; attempt < 2; attempt++) {
      const original = Object.assign(new Error('simulated discovery timeout'), { code: '57014' });
      const failing = interceptCycle(async (client, sql, values) => {
        if (sql.startsWith('WITH grouped AS')) throw original;
        return client.query(sql, values);
      });
      const before = await controlRow();
      await assert.rejects(failing.runCycle(now), error => error === original);
      const deferred = await controlRow();
      assert.equal(deferred.last_run_at, before.last_run_at);
      assert.equal(deferred.lease_owner, null);
      assert.ok(+new Date(deferred.next_auto_at) >= +now + DUPLICATE_AUTO_DISCOVERY_BACKOFF_MS);
      assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM station_duplicate_jobs')).rows[0].n, 0);
      now = new Date(+new Date(deferred.summary.automaticDiscoveryRetryAt) + 1);
    }
  });

  for (const scenario of [
    { kind: 'preview', phase: 'seed', code: '57014' },
    { kind: 'automatic', phase: 'seed', code: '55P03' },
    { kind: 'automatic', phase: 'checkpoint', code: '57014' },
  ]) {
    it(`keeps the normal cooldown for ${scenario.kind} ${scenario.phase} ${scenario.code}`, async () => {
      if (scenario.kind === 'preview') await store.createPreview();
      await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
      const before = await controlRow(), original = Object.assign(new Error('simulated cycle failure'), { code: scenario.code });
      const failing = interceptCycle(async (client, sql, values) => {
        if (sql.startsWith(scenario.phase === 'seed' ? 'WITH grouped AS' : 'UPDATE station_duplicate_merge_control SET lease_owner=NULL')) throw original;
        return client.query(sql, values);
      });
      await assert.rejects(failing.runCycle(now), error => error === original);
      const deferred = await controlRow();
      assert.deepEqual({ ...deferred, next_cycle_at: before.next_cycle_at }, before);
      assert.ok(+new Date(deferred.next_cycle_at) >= +now + DUPLICATE_MERGE_FAILURE_BACKOFF_MS);
      assert.ok(+new Date(deferred.next_cycle_at) <= +now + DUPLICATE_MERGE_FAILURE_BACKOFF_MS + 1_000);
    });
  }

  for (const kind of ['preview', 'automatic']) it(`does not overwrite a replica advancing after ${kind} timeout rollback`, async () => {
    await add('Replica race'); await add('Replica race');
    const preview = kind === 'preview' ? await store.createPreview() : undefined;
    if (kind === 'automatic') await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    const original = Object.assign(new Error('fixture seed failure'), { code: '57014' });
    let advanced: Record<string, unknown> | undefined;
    const failing = interceptCycle(async (client, sql, values) => {
      if (sql.startsWith('WITH grouped AS')) throw original;
      const result = await client.query(sql, values);
      if (sql === 'ROLLBACK' && !advanced) {
        const completed = await new PostgresDuplicateJobsStore(fixture.pool).runCycle(now);
        assert.equal(completed.completed, true);
        advanced = await controlRow();
      }
      return result;
    });
    await assert.rejects(failing.runCycle(now), error => error === original);
    assert.ok(advanced);
    assert.deepEqual(await controlRow(), advanced);
    if (preview) assert.equal((await store.getJob(preview))?.status, 'completed');
    assert.equal(+new Date((await controlRow()).next_cycle_at), +now + 15_000);
  });

  it('does not wait for a replica holding the advisory lock during deferral', async () => {
    const original = new Error('fixture seed failure'), blocker = await fixture.pool.connect();
    await store.createPreview(); const before = await controlRow();
    let deferralUpdates = 0;
    const failing = interceptCycle(async (client, sql, values) => {
      if (sql.startsWith('WITH grouped AS')) throw original;
      if (sql.includes('GREATEST')) deferralUpdates++;
      const result = await client.query(sql, values);
      if (sql === 'ROLLBACK') {
        await blocker.query('BEGIN');
        await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':station-duplicate-merge',0))");
      }
      return result;
    });
    try {
      await assert.rejects(failing.runCycle(now), error => error === original);
      assert.equal(deferralUpdates, 0); assert.deepEqual(await controlRow(), before);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

  for (const failure of ['statement', 'lock', 'commit', 'rollback'] as const) {
    it(`preserves the original error and releases an unusable client when deferral ${failure} fails`, async () => {
      const preview = await store.createPreview(), before = await controlRow();
      const original = new Error('fixture original seed failure'), cleanupError = new Error('fixture cleanup failure');
      const blocker = failure === 'lock' ? await fixture.pool.connect() : undefined;
      let begins = 0, deferralUpdates = 0, releases = 0, discarded: boolean | Error | undefined;
      let limits: { statement: string; lock: string } | undefined;
      const failing = interceptCycle(async (client, sql, values) => {
        if (sql === 'BEGIN') begins++;
        if (sql.startsWith('WITH grouped AS')) throw original;
        if (failure === 'rollback' && sql === 'ROLLBACK') throw cleanupError;
        if (sql.includes('GREATEST')) {
          deferralUpdates++;
          limits = (await client.query("SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock")).rows[0];
          if (failure === 'statement') return client.query('SELECT pg_sleep(1)');
        }
        if (failure === 'commit' && begins === 2 && sql === 'COMMIT') throw cleanupError;
        const result = await client.query(sql, values);
        if (blocker && sql === 'ROLLBACK') {
          await blocker.query('BEGIN');
          await blocker.query('SELECT id FROM station_duplicate_merge_control WHERE id=1 FOR UPDATE');
        }
        return result;
      }, destroy => { releases++; discarded = destroy; });
      try {
        await assert.rejects(failing.runCycle(now), error => error === original);
        assert.equal(releases, 1); assert.equal(discarded, true);
        assert.equal(begins, failure === 'rollback' ? 1 : 2);
        assert.equal(deferralUpdates, failure === 'rollback' ? 0 : 1);
        assert.deepEqual(limits, failure === 'rollback' ? undefined : { statement: '600ms', lock: '50ms' });
        assert.deepEqual(await controlRow(), before);
        assert.equal((await store.getJob(preview))?.status, 'running');
      } finally {
        if (blocker) { await blocker.query('ROLLBACK'); blocker.release(); }
      }
      assert.equal((await new PostgresDuplicateJobsStore(fixture.pool).runCycle(now)).completed, true);
    });
  }

  it('retains a queued apply and rolls back merged work if the final cycle checkpoint fails', async () => {
    await add('Final checkpoint'); await add('Final checkpoint');
    const preview = await store.createPreview(); await finish(preview);
    const apply = await store.createApply(preview), original = new Error('fixture final checkpoint failure');
    const failing = interceptCycle(async (client, sql, values) => {
      if (sql.startsWith('UPDATE station_duplicate_merge_control SET lease_owner=NULL')) throw original;
      return client.query(sql, values);
    });
    await assert.rejects(failing.runCycle(advance()), error => error === original);
    assert.equal(await catalog.count(), 2);
    assert.equal((await store.getJob(apply))?.progress.groupsProcessed, 0);
    assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM station_merge_aliases')).rows[0].n, 0);
    now = new Date(+new Date((await controlRow()).next_cycle_at) + 1);
    const retried = await new PostgresDuplicateJobsStore(fixture.pool).runCycle(now);
    assert.equal(retried.deleted, 1); assert.equal(retried.refreshCounts, true);
    assert.equal(await catalog.count(), 1);
  });

  it('rolls back a merge when its checkpoint fails, then safely retries on restart', async () => {
    await add('Atomic'); await add('Atomic');
    const preview = await store.createPreview(); await finish(preview);
    const apply = await store.createApply(preview);
    await fixture.pool.query(`CREATE FUNCTION fail_duplicate_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='merged' THEN RAISE EXCEPTION 'fixture checkpoint failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_duplicate_checkpoint BEFORE UPDATE ON station_duplicate_job_groups FOR EACH ROW EXECUTE FUNCTION fail_duplicate_checkpoint()`);
    try {
      await store.runCycle(advance());
      assert.equal(await catalog.count(), 2);
      assert.equal((await store.getJob(apply))!.progress.groupsProcessed, 0);
      assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM station_blacklist')).rows[0].n, 0);
      assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM station_merge_aliases')).rows[0].n, 0);
    } finally {
      await fixture.pool.query('DROP TRIGGER fail_duplicate_checkpoint ON station_duplicate_job_groups; DROP FUNCTION fail_duplicate_checkpoint()');
    }
    store = new PostgresDuplicateJobsStore(fixture.pool);
    const job = await finish(apply);
    assert.equal(job.results.totalStationsDeleted, 1); assert.equal(await catalog.count(), 1);
  });

  it('yields on row contention without changing the group or losing its checkpoint', async () => {
    const locked = await add('Contended'); await add('Contended');
    const preview = await store.createPreview(); await finish(preview);
    const apply = await store.createApply(preview), blocker = await fixture.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM stations WHERE id=$1 FOR UPDATE', [locked._id]);
      await store.runCycle(advance());
      assert.equal((await store.getJob(apply))!.progress.groupsProcessed, 0);
      assert.equal(await catalog.count(), 2);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    assert.equal((await finish(apply)).results.totalStationsDeleted, 1);
  });

  it('does not auto-merge on deployment and limits each due daily job to100 groups', async () => {
    for (let i = 0; i < 105; i++) { await add('Auto ' + i); await add('Auto ' + i); }
    await store.runCycle(now);
    assert.equal((await store.getStatus()).latestApply, null);
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    await store.runCycle(advance());
    const automatic = (await store.getStatus()).latestApply!;
    assert.equal(automatic.kind, 'automatic'); assert.equal(automatic.results.totalGroups, 100);
    const job = await finish(automatic.jobId, 110);
    assert.equal(job.results.mergedGroups, 100); assert.equal(job.results.totalStationsDeleted, 100);
    assert.equal(job.results.mergedStations.length, 20); assert.equal(job.results.summariesTruncated, true);
    assert.equal(await catalog.count(), 110);
    await store.runCycle(advance());
    assert.equal((await store.getStatus()).latestApply!.jobId, automatic.jobId);
    assert.ok(new Date((await store.getStatus()).nextRunAt).getTime() > +now);
  });

  it('automatic mode never merges review-only or oversized groups', async () => {
    await add('Review city'); await add('Review city', { city: 'Salzburg' });
    for (let i = 0; i < 51; i++) await add('Oversized');
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    await store.runCycle(advance());
    const id = (await store.getStatus()).latestApply!.jobId;
    const job = await finish(id);
    assert.equal(job.results.skippedGroups, 2); assert.equal(job.results.totalStationsDeleted, 0);
    assert.equal(await catalog.count(), 53);
  });

  it('rotates the daily cursor so100 review-only groups cannot starve later safe groups', async () => {
    for (let i = 0; i < 100; i++) { await add('A review ' + i); await add('A review ' + i, { city: 'Graz' }); }
    await add('Z safe'); await add('Z safe');
    await fixture.pool.query('UPDATE station_duplicate_merge_control SET next_auto_at=$1', [now]);
    await store.runCycle(advance());
    const first = await finish((await store.getStatus()).latestApply!.jobId);
    assert.equal(first.results.skippedGroups, 100); assert.equal(first.results.totalStationsDeleted, 0);
    now = new Date(+now + 86_400_000);
    await store.runCycle(now);
    const secondId = (await store.getStatus()).latestApply!.jobId;
    assert.notEqual(secondId, first.jobId);
    const second = await finish(secondId);
    assert.equal(second.results.totalGroups, 1); assert.equal(second.results.totalStationsDeleted, 1);
    assert.equal(await catalog.count(), 201);
  });

  it('a repeatedly timed-out group is deferred for review without starving the next group', async () => {
    await add('A blocked'); await add('A blocked'); await add('Z passes'); await add('Z passes');
    const preview = await store.createPreview();
    await fixture.pool.query(`CREATE FUNCTION slow_duplicate_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='eligible' AND NEW.group_name='a blocked' THEN PERFORM pg_sleep(1); END IF; RETURN NEW; END $$;
      CREATE TRIGGER slow_duplicate_checkpoint BEFORE UPDATE ON station_duplicate_job_groups FOR EACH ROW EXECUTE FUNCTION slow_duplicate_checkpoint()`);
    try {
      const job = await finish(preview, 8);
      assert.equal(job.status, 'completed'); assert.equal(job.results.eligibleGroups, 1); assert.equal(job.results.skippedGroups, 1);
      assert.ok(job.results.skippedReasons.some(item => item.reason === 'deferred_timeout_requires_review'));
      assert.equal(await catalog.count(), 4);
    } finally { await fixture.pool.query('DROP TRIGGER slow_duplicate_checkpoint ON station_duplicate_job_groups; DROP FUNCTION slow_duplicate_checkpoint()'); }
  });

  it('short and Unicode-normalized exact names are not silently excluded from previews', async () => {
    await add('FM'); await add('FM');
    await add('Ｒａｄｉｏ', { url: 'https://example.invalid/shared' }); await add('Radio', { url: 'https://example.invalid/shared' });
    const job = await finish(await store.createPreview());
    assert.equal(job.results.eligibleGroups, 2); assert.equal(job.results.totalGroups, 2);
  });

  it('merge archives ban loser UUIDs but never block survivor sync; explicit URL bans still win', async () => {
    await add('Shared stream'); await add('Shared stream');
    const preview = await store.createPreview(); await finish(preview);
    await finish(await store.createApply(preview));
    const survivor = (await catalog.find())[0], snapshot = await pgSyncBlacklist();
    const loserUuid = snapshot[0].stationUuid;
    assert.equal(snapshot[0].blocksUrl, false);
    const lists = buildSyncBlacklist(snapshot);
    assert.equal(lists.blacklistedUuids.has(loserUuid), true);
    assert.equal(lists.blacklistedUuids.has(survivor.stationuuid), false);
    assert.equal(lists.blacklistedUrls.has(survivor.url), false);
    await fixture.pool.query("INSERT INTO catalog_sync_runs(id,sync_type,status) VALUES('merge-sync-run','incremental','running')");
    const input = { name:'Another valid station',stationuuid:'different-provider-uuid',url:survivor.url,country:'Austria',countryCode:'AT' };
    assert.equal((await catalog.insertMany([{...input,stationuuid:loserUuid}],{syncRunId:'merge-sync-run'})).length,0);
    assert.equal((await catalog.insertMany([input],{syncRunId:'merge-sync-run'})).length,1);
    assert.equal(await pgBlacklistFind(survivor.url,survivor.stationuuid),null);
    const ban = await pgBlacklistAdd({ name:survivor.name,url:survivor.url,stationUuid:survivor.stationuuid,reason:'Explicit manual ban',
      mergeAudit:{survivorId:'old-restored-archive'} });
    assert.equal(ban.reason,'Explicit manual ban');
    assert.equal(ban.mergeAudit,undefined);
    assert.equal(buildSyncBlacklist(await pgSyncBlacklist()).blacklistedUrls.has(survivor.url),true);
    assert.equal((await catalog.insertMany([{...input,name:'One more',stationuuid:'yet-another-uuid'}],{syncRunId:'merge-sync-run'})).length,0);
    assert.equal((await pgBlacklistFind(survivor.url))?.reason,'Explicit manual ban');
  });
});
