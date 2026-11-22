import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';

const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL public user handles and legacy identity', { skip: !connectionString }, () => {
  const schema = `user_handles_${process.pid}_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool; let pool: pg.Pool;
  let runtime: typeof import('../src/postgres-runtime');
  let users: typeof import('../src/data/postgres-user-store');
  let engagement: typeof import('../src/data/postgres-engagement-store');
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
});
