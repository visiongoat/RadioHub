import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL public user handles and legacy identity', { skip: !connectionString }, () => {
  const schema = `user_handles_${process.pid}_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool; let pool: pg.Pool;
  let runtime: typeof import('../src/postgres-runtime');
  let users: typeof import('../src/data/postgres-user-store');
  let engagement: typeof import('../src/data/postgres-engagement-store');
  let repair: typeof import('../src/data/legacy-user-handle-repair');
  let created = false;
  const original = { DATABASE_URL: process.env.DATABASE_URL, POSTGRES_SSL: process.env.POSTGRES_SSL };
  before(async () => {
    const url = new URL(connectionString!);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only disposable loopback PostgreSQL is allowed');
    assert.equal(url.pathname, '/radiohub_test');
    admin = new pg.Pool({ connectionString, ssl: false, max: 1 });
    assert.match(schema, /^user_handles_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString(); process.env.POSTGRES_SSL = 'disable';
    runtime = await import('../src/postgres-runtime'); pool = runtime.getPostgresPool();
    const migrations = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(migrations)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), 'utf8'));
    }
    users = await import('../src/data/postgres-user-store');
    engagement = await import('../src/data/postgres-engagement-store');
    repair = await import('../src/data/legacy-user-handle-repair');
  });
  after(async () => {
    if (runtime) await runtime.closePostgres();
    if (created) { assert.match(schema, /^user_handles_\d+_[a-f0-9]{12}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    await admin?.end();
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  beforeEach(async () => { await pool.query('DELETE FROM users'); });

  const create = (id: string, extra = {}) => users.pgCreateUser({ id, email: `${id}@example.invalid`, fullName: 'Şahin Yoğurtcu', ...extra });
  const legacy = async (id = 'legacy', username = 'user_1755000000000_abc123456') => {
    await pool.query(`INSERT INTO users(id,username,email,full_name,slug,is_public_profile,status,source)
      VALUES($1,$2,$3,'Şahin Yoğurtcu','old-profile-url',true,'active',$4)`, [id, username, `${id}@example.invalid`, { unrelated: 'retained', preferences: { untouched: true } }]);
    return username;
  };

  it('allocates unique bounded name handles under concurrent signup, reserving custom usernames and profile slugs case insensitively', async () => {
    await create('custom', { username: 'Sahin_Yogurtcu', slug: 'sahin_yogurtcu_1' });
    const created = await Promise.all(Array.from({ length: 12 }, (_, index) => create(`new-${index}`)));
    assert.equal(new Set(created.map(user => user.username)).size, 12);
    assert.equal(new Set(created.map(user => user.slug)).size, 12);
    for (const user of created) {
      assert.match(user.username, /^sahin_yogurtcu_\d+$/);
      assert.notEqual(user.username, 'sahin_yogurtcu_1');
      assert.equal(user.id, user._id); assert.ok(user.username.length <= 30);
    }
    assert.equal((await users.pgFindUserById('custom')).username, 'Sahin_Yogurtcu');
    await assert.rejects(create('duplicate', { username: 'SAHIN_YOGURTCU' }), { code: '23505' });
  });

  it('upgrades proven legacy handles atomically while preserving ID, slug, source, concurrent preferences and old links', async () => {
    const old = await legacy();
    const [first] = await Promise.all([users.pgUpdateUser('legacy', { preferences: { language: 'tr' } }), users.pgUpdateUser('legacy', { preferences: { autoplay: true } })]);
    const current = await users.pgFindUserById('legacy');
    assert.equal(first.username, 'sahin_yogurtcu');
    assert.equal(current._id, 'legacy'); assert.equal(current.slug, 'old-profile-url');
    assert.equal(current.unrelated, 'retained');
    assert.equal(current.preferences.language, 'tr'); assert.equal(current.preferences.autoplay, true);
    assert.deepEqual(current.profileAliases, [old]);
    for (const value of ['legacy', 'old-profile-url', 'sahin_yogurtcu', old]) {
      assert.equal(await engagement.pgResolveUserId(value), 'legacy');
      assert.equal((await users.pgFindUserByIdOrSlug(value))._id, 'legacy');
      assert.equal((await engagement.pgPublicProfile(value)).username, 'sahin_yogurtcu');
      assert.ok(await engagement.pgPublicProfileCacheIdentity(value));
    }
    const updated = await users.pgUpdateUser('legacy', { profileAliases: ['forged'], source: { profileAliases: ['forged'] }, fullName: 'Updated Name' });
    assert.equal(updated.username, 'sahin_yogurtcu'); assert.deepEqual(updated.profileAliases, [old]);
    assert.equal(updated.unrelated, 'retained');
    await assert.rejects(create('takeover', { username: old.toUpperCase() }), { code: '23505' });
    await users.pgUpdateUser('legacy', { isPublicProfile: false });
    assert.equal(await engagement.pgPublicProfile(old), null);
    assert.equal(await engagement.pgPublicProfileCacheIdentity(old), null);
    assert.deepEqual(await engagement.pgRecentlyPlayed(old, 10), []);
  });

  it('repairs Facebook and blank handles without reassigning existing custom or ambiguous historic usernames', async () => {
    await legacy('facebook', 'fb_507f1f77bcf86cd799439011');
    assert.equal((await users.pgUpdateUser('facebook', {})).username, 'sahin_yogurtcu');
    for (const username of ['chosen.name', 'email_m4ab12xy', 'sahin123']) {
      const user = await create(username, { username });
      assert.equal((await users.pgUpdateUser(user.id, { fullName: 'Changed Name' })).username, username);
    }
    const blank = await create('blank', { username: 'temporary' });
    await pool.query("UPDATE users SET username='' WHERE id=$1", [blank.id]);
    assert.match((await users.pgUpdateUser(blank.id, {})).username, /^sahin_yogurtcu_\d+$/);
    const safe = await create('no-name', { fullName: '', source: { profileAliases: ['forged'] } });
    assert.equal(safe.username, 'listener'); assert.equal(safe.profileAliases, undefined);
    assert.equal(safe.username.includes('no-name'), false);
  });

  it('finds @handles, Turkish names and reversed name order through both public directory endpoints without wildcard expansion', async () => {
    await create('public');
    await create('private', { isPublicProfile: false });
    for (const query of ['@sahin_yogurtcu', 'Şahin Yoğurtcu', 'yogurtcu sahin', '@yogurtcu_sahin']) {
      const searched = await engagement.pgSearchPublicProfiles(query);
      assert.deepEqual(searched.map(user => user._id), ['public'], query);
      assert.equal(searched[0].email, undefined); assert.equal(searched[0].profileAliases, undefined);
      const directory = await users.pgListUsers({ query, publicOnly: true, status: 'active', page: 1, limit: 20 });
      assert.deepEqual(directory.users.map(user => user._id), ['public']);
    }
    assert.deepEqual(await engagement.pgSearchPublicProfiles('%%'), []);
    assert.equal((await users.pgListUsers({ query: '%%', publicOnly: true, page: 1, limit: 20 })).total, 0);
  });

  it('repairs proven native email handles, preserving old URLs, reserved aliases, search and short collision suffixes', async () => {
    const old = 'yogurtcusahin5me_mv748druv2w7';
    await pool.query(`INSERT INTO users(id,username,email,full_name,slug,is_public_profile,status,created_at)
      VALUES('native-old',$1,'yogurtcusahin5me@example.invalid','Yoğurtcu Şahin','unchanged-old-profile',true,'active','2026-10-13T20:10:35.322Z')`, [old]);
    const repaired = await users.pgUpdateUser('native-old', {});
    assert.equal(repaired.username, 'yogurtcu_sahin'); assert.equal(repaired.slug, 'unchanged-old-profile');
    assert.deepEqual(repaired.profileAliases, [old]);
    assert.equal((await users.pgFindUserByIdOrSlug(old))._id, 'native-old');
    assert.equal(await engagement.pgResolveUserId(old), 'native-old');
    assert.equal((await engagement.pgPublicProfile(old)).username, 'yogurtcu_sahin');
    for (const query of [`@${old}`, '@yogurtcu_sahin', 'Yoğurtcu Şahin']) {
      assert.deepEqual((await engagement.pgSearchPublicProfiles(query)).map(user => user._id), ['native-old']);
      assert.deepEqual((await users.pgListUsers({ query, publicOnly: true, status: 'active', page: 1, limit: 20 })).users.map(user => user._id), ['native-old']);
    }
    await assert.rejects(create('old-handle-takeover', { username: old.toUpperCase() }), { code: '23505' });
    assert.equal((await create('collision-2', { fullName: 'Yoğurtcu Şahin' })).username, 'yogurtcu_sahin_2');
    assert.equal((await create('collision-3', { fullName: 'Yoğurtcu Şahin' })).username, 'yogurtcu_sahin_3');
    await users.pgUpdateUser('native-old', { isPublicProfile: false });
    assert.equal(await engagement.pgPublicProfile(old), null);
    assert.deepEqual(await engagement.pgSearchPublicProfiles(`@${old}`), []);
    assert.equal((await users.pgListUsers({ query: old, publicOnly: true, status: 'active', page: 1, limit: 20 })).total, 0);
  });

  it('keeps custom generated-looking handles when the stored email or creation time does not prove the former generator', async () => {
    const old = 'yogurtcusahin5me_mv748druv2w7';
    for (const [id, email, createdAt] of [
      ['different-email', 'chosen@example.invalid', '2026-10-13T20:10:35.322Z'],
      ['different-time', 'yogurtcusahin5me@example.invalid', '2026-10-20T00:00:00Z'],
    ]) {
      await pool.query(`INSERT INTO users(id,username,email,full_name,status,created_at) VALUES($1,$2,$3,'Custom Listener','active',$4)`, [id, old, email, createdAt]);
      const unchanged = await users.pgUpdateUser(id, { preferences: { language: 'tr' } });
      assert.equal(unchanged.username, old); assert.equal(unchanged.profileAliases, undefined);
      await pool.query('DELETE FROM users WHERE id=$1', [id]);
    }
    const createdAt = Date.now();
    const submittedByOldClient = `native_${createdAt.toString(36)}abcd`;
    const newAccount = await create('old-client', { email: 'native@example.invalid', username: submittedByOldClient, fullName: 'Native Listener' });
    assert.equal(newAccount.username, 'native_listener');
  });

  it('repairs every proven legacy account in bounded batches, preserving private/disabled accounts and skipping unproven custom lookalikes', async () => {
    const native = 'yogurtcusahin5me_mv748druv2w7';
    const oauth = 'user_1755000000000_abc123456';
    const facebook = 'fb_507f1f77bcf86cd799439011';
    const custom = 'custom_mv748druv2w7';
    await create('00-reserved', { username: 'yogurtcu_sahin', slug: 'yogurtcu_sahin_2' });
    for (const [id, username, email, fullName, privacy, status] of [
      ['01-native', native, 'yogurtcusahin5me@example.invalid', 'Yoğurtcu Şahin', true, 'active'],
      ['02-oauth', oauth, 'oauth@example.invalid', 'Yoğurtcu Şahin', false, 'suspended'],
      ['03-facebook', facebook, 'facebook@example.invalid', 'Yoğurtcu Şahin', false, 'active'],
      ['04-custom', custom, 'different@example.invalid', 'Custom Listener', true, 'active'],
    ]) await pool.query(`INSERT INTO users(id,username,email,full_name,slug,is_public_profile,status,role,source,created_at)
      VALUES($1,$2,$3,$4,$1,$5,$6,'admin',$7,'2026-10-13T20:10:35.322Z')`, [id, username, email, fullName, privacy, status, { unrelated: { retained: true }, username, slug: id }]);
    const before = (await pool.query('SELECT * FROM users ORDER BY id')).rows;
    const dryRun = await repair.repairLegacyUserHandles({ batchSize: 1, pauseMs: 0 });
    assert.deepEqual(dryRun, { mode: 'dry-run', scanned: 5, matched: 4, eligible: 3, changed: 0, unproven: 1, alreadyRepaired: 0 });
    assert.deepEqual((await pool.query('SELECT * FROM users ORDER BY id')).rows, before);
    const result = await repair.repairLegacyUserHandles({ apply: true, batchSize: 2, pauseMs: 0 });
    assert.equal(result.changed, 3); assert.equal(result.unproven, 1);
    const after = (await pool.query('SELECT * FROM users ORDER BY id')).rows;
    for (const [index, old] of before.entries()) {
      const updated = after[index];
      if (index === 0 || old.id === '04-custom') { assert.deepEqual(updated, old); continue; }
      const { username: _oldUsername, source: oldSource, updated_at: _oldTime, ...oldFields } = old;
      const { username, source, updated_at: _time, ...fields } = updated;
      assert.deepEqual(fields, oldFields, 'only the handle/source aliases/update time may change');
      assert.equal(source.unrelated.retained, true); assert.equal(source.slug, oldSource.slug);
      assert.deepEqual(source.profileAliases, [old.username]); assert.equal(source.username, username);
      assert.equal(username, `yogurtcu_sahin_${index + 2}`);
      assert.equal((await users.pgFindUserByIdOrSlug(old.username))._id, old.id);
    }
    assert.equal(await engagement.pgPublicProfile(oauth), null, 'suspended/private account stays hidden');
    assert.equal(await engagement.pgPublicProfile(facebook), null, 'private account stays hidden');
    assert.deepEqual((await engagement.pgSearchPublicProfiles('@' + native)).map(user => user._id), ['01-native']);
    await assert.rejects(create('alias-takeover', { username: native }), { code: '23505' });
    assert.equal((await repair.repairLegacyUserHandles({ apply: true, batchSize: 1, pauseMs: 0 })).changed, 0);
    assert.deepEqual((await pool.query('SELECT * FROM users ORDER BY id')).rows, after, 'repeat apply has no data writes');
  });

  it('rechecks a concurrent custom edit under the shared allocator lock and rolls back a failed repair', async () => {
    const old = await legacy();
    const writer = await pool.connect();
    const { lockUserHandles } = await import('../src/data/user-handle-store');
    await writer.query('BEGIN'); await lockUserHandles(writer);
    await writer.query(`UPDATE users SET username='chosen_by_user',source=source||$2::jsonb WHERE id=$1`, ['legacy', JSON.stringify({ username: 'chosen_by_user', profileAliases: [old] })]);
    const pending = repair.repairLegacyUserHandle('legacy');
    await writer.query('COMMIT'); writer.release();
    const custom = (await pool.query("SELECT * FROM users WHERE id='legacy'")).rows[0];
    assert.equal(await pending, false);
    assert.deepEqual((await pool.query("SELECT * FROM users WHERE id='legacy'")).rows[0], custom);
    await pool.query('DELETE FROM users'); await legacy();
    await pool.query("ALTER TABLE users ADD CONSTRAINT reject_repair_test CHECK (username LIKE 'user_%') NOT VALID");
    await assert.rejects(repair.repairLegacyUserHandle('legacy'), { code: '23514' });
    const unchanged = await users.pgFindUserById('legacy');
    assert.equal(unchanged.username, old); assert.equal(unchanged.profileAliases, undefined);
    await pool.query('ALTER TABLE users DROP CONSTRAINT reject_repair_test');
    assert.equal(await repair.repairLegacyUserHandle('legacy'), true, 'rollback also releases the allocator lock');
  });

  it('ships a dry-run-first command that verifies apply, is repeatable and never logs account data', async () => {
    await legacy();
    const runFile = (script: string, args: string[] = []) => promisify(execFile)(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env }, timeout: 30000,
    });
    const run = (...args: string[]) => runFile('src/scripts/repair-legacy-user-handles.ts', args);
    const dry = await run();
    assert.equal(JSON.parse(dry.stdout.trim().split('\n').at(-1)!).mode, 'dry-run');
    assert.equal((await users.pgFindUserById('legacy')).username, 'user_1755000000000_abc123456');
    const directory = await mkdtemp(path.join(tmpdir(), 'radiohub-repair-link-'));
    try {
      const link = path.join(directory, 'repair.ts');
      await symlink(path.resolve(import.meta.dirname, '../src/scripts/repair-legacy-user-handles.ts'), link);
      assert.equal(JSON.parse((await runFile(link)).stdout.trim().split('\n').at(-1)!).mode, 'dry-run', 'symlink invocation must execute the command rather than silently succeeding');
    } finally { await rm(directory, { recursive: true, force: true }); }
    const applied = await run('--apply', '--batch-size=1', '--pause-ms=0');
    const summary = JSON.parse(applied.stdout.trim().split('\n').at(-1)!);
    assert.equal(summary.changed, 1); assert.equal(summary.remainingEligible, 0);
    assert.equal((await users.pgFindUserById('legacy')).username, 'sahin_yogurtcu');
    assert.equal(JSON.parse((await run('--apply')).stdout.trim().split('\n').at(-1)!).changed, 0);
    for (const value of [dry.stdout, applied.stdout, dry.stderr, applied.stderr]) {
      assert.equal(value.includes('legacy@example.invalid'), false);
      assert.equal(value.includes('1755000000000'), false);
      assert.equal(value.includes('Şahin'), false);
      assert.equal(value.includes(connectionString!), false);
    }
  });
});
