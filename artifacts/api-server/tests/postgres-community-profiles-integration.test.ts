import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';

// Explicit disposable test database only; never fall back to production DATABASE_URL.
const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL community identity, privacy and favorite activity', { skip: !connectionString }, () => {
  const schema = `community_profiles_${process.pid}_${randomBytes(6).toString('hex')}`;
  const ssl = process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, POSTGRES_SSL: process.env.POSTGRES_SSL };
  let pool: pg.Pool;
  let runtime: typeof import('../src/postgres-runtime');
  let engagement: typeof import('../src/data/postgres-engagement-store');
  let users: typeof import('../src/data/postgres-user-store');
  let created = false;
  const rankedIds = ['a-recent', 'b-recent', 'legacy-avatar', 'expired', 'older-many'];

  before(async () => {
    assert.match(schema, /^community_profiles_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const scoped = new URL(connectionString!);
    scoped.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = scoped.toString();
    process.env.POSTGRES_SSL = ssl ? 'require' : 'disable';
    runtime = await import('../src/postgres-runtime');
    pool = runtime.getPostgresPool();
    const migrations = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    for (const file of (await readdir(migrations)).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), 'utf8'));
    }
    engagement = await import('../src/data/postgres-engagement-store');
    users = await import('../src/data/postgres-user-store');
  });

  after(async () => {
    if (runtime) await runtime.closePostgres();
    try {
      if (created) {
        assert.match(schema, /^community_profiles_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {
      await admin.end();
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await pool.query('DELETE FROM stations');
    await pool.query(`INSERT INTO stations(id,station_uuid,name,url,is_list_visible,visibility_expires_at) VALUES
      ('visible-1','uuid-1','Visible 1','https://example.invalid/1',true,null),
      ('visible-2','uuid-2','Visible 2','https://example.invalid/2',true,null),
      ('visible-3','uuid-3','Visible 3','https://example.invalid/3',true,null),
      ('hidden','uuid-hidden','Hidden','https://example.invalid/hidden',false,'2099-01-01'),
      ('expired-hidden','uuid-expired','Expired suppression','https://example.invalid/expired',false,'2020-01-01')`);
    for (const id of [...rankedIds, 'hidden-only', 'empty', 'private', 'suspended']) {
      await pool.query(`INSERT INTO users(id,username,email,full_name,avatar,slug,is_public_profile,status,source,created_at)
        VALUES($1,$2,$3,$4,$5,$1,$6,$7,$8,'2020-01-01')`, [
        id, id === 'legacy-avatar' ? 'legacy-listener' : `${id}-username`, `${id}@example.invalid`,
        id === 'a-recent' ? '  Alice Weber  ' : id === 'legacy-avatar' ? '   ' : `${id} Full Name`,
        id === 'a-recent' ? 'https://example.invalid/current-avatar.webp' : id === 'legacy-avatar' ? '  ' : null,
        id !== 'private', id === 'suspended' ? 'suspended' : 'active',
        { profileImageUrl: `https://example.invalid/${id}-legacy.webp`, email: 'private-source@example.invalid', passwordHash: 'never-public' },
      ]);
    }
    for (const [id, station, at] of [
      ['a-recent', 'visible-1', '2026-01-04'], ['b-recent', 'visible-1', '2026-01-04'],
      ['legacy-avatar', 'visible-1', '2026-01-03'], ['expired', 'expired-hidden', '2026-01-02'],
      ['older-many', 'visible-1', '2026-01-01'], ['older-many', 'visible-2', '2026-01-01'],
      ['older-many', 'visible-3', '2026-01-01'], ['older-many', 'hidden', '2099-01-01'],
      ['hidden-only', 'hidden', '2099-01-01'], ['private', 'visible-1', '2099-01-01'],
      ['suspended', 'visible-1', '2099-01-01'],
    ]) await pool.query('INSERT INTO user_favorites(user_id,station_id,created_at) VALUES($1,$2,$3)', [id, station, `${at}T00:00:00Z`]);
  });

  it('finds a new public profile without favorites, excludes private/inactive users and treats wildcard input literally', async()=>{
    await pool.query("UPDATE users SET full_name='Halil Haydar Telci',username='halil.telci' WHERE id='empty'");
    const result=await engagement.pgSearchPublicProfiles('halil haydar telci');
    assert.deepEqual(result.map(person=>person._id),['empty']);
    assert.equal(result[0].email,undefined);assert.equal(result[0].source,undefined);
    assert.equal((await engagement.pgSearchPublicProfiles('private')).length,0);
    assert.equal((await engagement.pgSearchPublicProfiles('suspended')).length,0);
    assert.equal((await engagement.pgSearchPublicProfiles('%%')).length,0);
    await pool.query("UPDATE users SET full_name='Şahin Yoğurtcu' WHERE id='empty'");
    assert.equal((await engagement.pgSearchPublicProfiles('sahin yogurtcu'))[0]._id,'empty');
    assert.equal((await engagement.pgSearchPublicProfiles('a')).length,0);
    assert.equal((await engagement.pgSearchPublicProfiles('username',1)).length,1);
  });

  it('discovery alternates favorite-rich and new profiles with stable non-overlapping pages and live privacy', async()=>{
    await pool.query("UPDATE users SET created_at=now() WHERE id='empty'");
    const {getCommunityDiscovery}=await import('../src/services/community-discovery');
    const first=await getCommunityDiscovery(2,1),again=await getCommunityDiscovery(2,1),second=await getCommunityDiscovery(2,2);
    assert.deepEqual(first.data.map(p=>p._id),['older-many','empty']);
    assert.deepEqual(first.data.map(p=>p._id),again.data.map(p=>p._id));
    assert.ok(first.pagination.hasMore);
    assert.ok(second.data.every(p=>!first.data.some(q=>q._id===p._id)));
    assert.ok([...first.data,...second.data].every(p=>p.email===undefined&&p.source===undefined));
    await pool.query("UPDATE users SET is_public_profile=false WHERE id='older-many'");
    assert.ok(!(await getCommunityDiscovery(2,1)).data.some(p=>p._id==='older-many'));
    assert.equal((await getCommunityDiscovery(24,100)).pagination.hasMore,false);
    const search1=await engagement.pgSearchPublicProfiles('username',2,1,1),search2=await engagement.pgSearchPublicProfiles('username',2,2,1);
    assert.ok(search1.length&&search2.length);assert.notEqual(search1[0]._id,search2[0]._id);
  });

  it('returns real public names and canonical/legacy avatars with compatible numeric count aliases, never email', async () => {
    const profiles = await engagement.pgPopularProfiles(20);
    const current = profiles.find(profile => profile._id === 'a-recent')!;
    assert.equal(current.id, current._id);
    assert.equal(current.name, 'Alice Weber');
    assert.equal(current.fullName, 'Alice Weber');
    assert.equal(current.displayName, 'Alice Weber');
    assert.equal(current.username, 'a-recent-username');
    assert.equal(current.avatar, 'https://example.invalid/current-avatar.webp');
    assert.equal(current.profileImageUrl, current.avatar);
    const legacy = profiles.find(profile => profile._id === 'legacy-avatar')!;
    assert.equal(legacy.name, 'legacy-listener');
    assert.equal(legacy.displayName, 'legacy-listener');
    assert.equal(legacy.avatar, 'https://example.invalid/legacy-avatar-legacy.webp');
    assert.equal(legacy.profileImageUrl, legacy.avatar);
    for (const profile of profiles) {
      assert.equal(typeof profile.favoriteCount, 'number');
      assert.equal(profile.favorites_count, profile.favoriteCount);
      assert.equal(profile.favoriteStationsCount, profile.favoriteCount);
      for (const key of ['email', 'passwordHash', 'password_hash', 'source']) assert.equal(Object.hasOwn(profile, key), false);
    }
    assert.equal(JSON.stringify(profiles).includes('@example.invalid'), false);
  });

  it('ranks the latest visible favorite, not lifetime counts, with stable ties and visibility/privacy filters', async () => {
    const profiles = await engagement.pgPopularProfiles(20);
    assert.deepEqual(profiles.map(profile => profile._id), rankedIds);
    assert.equal(profiles.find(profile => profile._id === 'older-many')!.favoriteCount, 3);
    assert.equal(new Date(profiles[0].lastFavoritedAt).toISOString(), '2026-01-04T00:00:00.000Z');
    assert.deepEqual((await engagement.pgPopularProfiles(2)).map(profile => profile._id), rankedIds.slice(0, 2));
  });

  it('keeps public community pagination activity-ordered and places empty/hidden-only accounts last', async () => {
    const options = { publicOnly: true, status: 'active', sortBy: 'recent_favorites', page: 1, limit: 20 };
    const listing = await users.pgListUsers(options);
    assert.equal(listing.total, 7);
    assert.deepEqual(listing.users.map(user => user.id), [...rankedIds, 'empty', 'hidden-only']);
    for (const id of ['empty', 'hidden-only']) {
      const user = listing.users.find(user => user.id === id)!;
      assert.equal(user.favoriteStationsCount, 0);
      assert.equal(user.lastFavoritedAt, null);
    }
    const secondPage = await users.pgListUsers({ ...options, page: 2, limit: 2 });
    assert.equal(secondPage.total, 7);
    assert.deepEqual(secondPage.users.map(user => user.id), ['legacy-avatar', 'expired']);
    const adminListing = await users.pgListUsers({ status: 'active', sortBy: 'most_radios', page: 1, limit: 20 });
    assert.equal(adminListing.users.find(user => user.id === 'older-many')!.favoriteStationsCount, 4);
  });

  it('refreshes cached profile identity and removes newly private, suspended or empty profiles immediately', async () => {
    const cached = await engagement.pgPopularProfiles(20);
    await pool.query("UPDATE users SET is_public_profile=false WHERE id='a-recent'");
    await pool.query("UPDATE users SET status='suspended' WHERE id='b-recent'");
    await pool.query("UPDATE users SET full_name='Updated Listener',avatar='https://example.invalid/new.webp' WHERE id='legacy-avatar'");
    await pool.query("DELETE FROM user_favorites WHERE user_id='expired'");
    const refreshed = await engagement.pgRefreshPublicProfiles(cached);
    assert.deepEqual(refreshed.map(profile => profile._id), ['legacy-avatar', 'older-many']);
    assert.equal(refreshed[0].name, 'Updated Listener');
    assert.equal(refreshed[0].profileImageUrl, 'https://example.invalid/new.webp');
    assert.deepEqual(await engagement.pgRefreshPublicProfiles([]), []);
    assert.equal(JSON.stringify(refreshed).includes('@example.invalid'), false);
  });

  it('does not manufacture activity for duplicate favorite writes but ranks genuine new additions first', async () => {
    const favoriteTime = async () => (await pool.query("SELECT created_at FROM user_favorites WHERE user_id='older-many' AND station_id='visible-1'")).rows[0].created_at;
    const originalTime = await favoriteTime();
    await engagement.pgSetFavorite('older-many', 'visible-1', true);
    assert.deepEqual(await favoriteTime(), originalTime);
    assert.deepEqual((await engagement.pgPopularProfiles(20)).map(profile => profile._id), rankedIds);
    await engagement.pgSetFavorite('empty', 'visible-1', true);
    let profiles = await engagement.pgPopularProfiles(20);
    assert.equal(profiles[0]._id, 'empty');
    assert.equal(profiles[0].favoriteCount, 1);
    await engagement.pgSetFavorite('empty', 'visible-1', false);
    profiles = await engagement.pgPopularProfiles(20);
    assert.deepEqual(profiles.map(profile => profile._id), rankedIds);
  });
});
