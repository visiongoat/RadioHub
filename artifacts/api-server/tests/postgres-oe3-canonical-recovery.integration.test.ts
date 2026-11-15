import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getStationByIdentifier } from '../src/data/station-read-store';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';

const migration = await readFile(new URL('../../../lib/db/migrations/0058_verified_oe3_canonical_recovery.sql', import.meta.url), 'utf8');
const survivor = '68a8c483bd66579311ab2ffe';
const original = '68a8c483bd66579311ab2ffa';
const canonical = 'orf-hitradio-o3';
const oldSlug = canonical + '-hq';
const auditKey = 'verifiedOe3CanonicalRecovery20261115';

test('verified Ö3 canonical recovery on an explicit disposable PostgreSQL database',
  { skip: !process.env.PG_TEST_DATABASE_URL }, async t => {
    const url = new URL(process.env.PG_TEST_DATABASE_URL!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/radiohub_test');
    const fixture = await createNativePostgresFixture('oe3_canonical_recovery');
    const { pool } = fixture;
    const snapshot = async () => ({
      stations: (await pool.query('SELECT * FROM stations ORDER BY id')).rows,
      aliases: (await pool.query('SELECT * FROM station_merge_aliases ORDER BY alias')).rows,
      favorites: (await pool.query('SELECT * FROM user_favorites ORDER BY user_id,station_id')).rows,
      votes: (await pool.query('SELECT * FROM station_votes ORDER BY user_id,station_id')).rows,
      ratings: (await pool.query('SELECT * FROM station_ratings ORDER BY id')).rows,
      manifests: (await pool.query('SELECT * FROM sitemap_manifests ORDER BY id')).rows,
    });
    const reset = async () => {
      await fixture.clear('stations', 'users', 'genres', 'sitemap_manifests');
      await fixture.insert('stations', {
        _id: survivor, stationuuid: 'e723f7f8-0db1-4bc5-a64c-64d8377f9f9a',
        name: 'ORF Hitradio Ö3 | HQ', slug: oldSlug,
        slugAliases: ['orf-hitradio-3-hq', canonical, 'orf-hitradio-o3-1'],
        url: 'https://orf-live.ors-shoutcast.at/oe3-q2a',
        urlResolved: 'https://orf-live.ors-shoutcast.at/oe3-q2a',
        homepage: 'https://oe3.orf.at/', country: 'Austria', countryCode: 'AT',
        noIndex: false, isListVisible: true, redirectToSlug: null,
        mergedStationIds: [original, '68a8c483bd66579311ab2ffc', '68a8c483bd66579311ab2ffd'],
        descriptions: { de: { full: 'Retained original text', meta: 'Retained meta' } },
        manualEditFields: { descriptions: true }, votes: 416,
        updatedAt: new Date('2026-11-14T12:00:00Z'),
      });
      await fixture.insert('stations', { _id: 'french-pilot', stationuuid: 'french-uuid',
        name: 'Radio Couleur Chartreuse', slug: 'radio-couleur-chartreuse', url: 'https://stream.invalid/fr' });
      await pool.query('INSERT INTO station_merge_aliases(alias,station_id) VALUES($1,$2)', [original, survivor]);
      await fixture.insert('users', { _id: 'listener', username: 'listener', email: 'listener@example.invalid', fullName: 'Listener' });
      await pool.query("INSERT INTO user_favorites(user_id,station_id) VALUES('listener',$1)", [survivor]);
      await pool.query("INSERT INTO station_votes(user_id,station_id) VALUES('listener',$1)", [survivor]);
      await pool.query("INSERT INTO station_ratings(id,user_id,station_id,rating) VALUES('rating','listener',$1,5)", [survivor]);
      await fixture.insert('sitemap_manifests', { _id: 'active-de', type: 'stations', language: 'de',
        version: 'membership-unchanged', status: 'active', qualifiedLanguagesHash: 'langs', qualifiedLanguages: ['de'],
        chunks: [{ chunk: 1, stationIds: [survivor], urlCount: 1, maxUpdatedAt: '2026-11-14T12:00:00Z' },
          { chunk: 2, stationIds: ['french-pilot'], urlCount: 1, maxUpdatedAt: '2026-11-14T12:00:00Z' }],
        totalUrls: 2, chunkCount: 2, generatedAt: new Date('2026-11-14T12:00:00Z'), expiresAt: new Date('2027-01-01') });
    };
    const rejectsWithoutChange = async () => {
      const before = await snapshot();
      await assert.rejects(pool.query(migration), /oe3 canonical recovery/);
      assert.deepEqual(await snapshot(), before);
    };
    try {
      await t.test('rename preserves source, stream, identities and user data; HQ/ID aliases resolve the canonical survivor', async () => {
        await reset();
        const before = await snapshot();
        await pool.query(migration);
        const after = await snapshot();
        const old = before.stations.find(row => row.id === survivor)!;
        const current = after.stations.find(row => row.id === survivor)!;
        assert.equal(current.slug, canonical);
        assert.deepEqual(current.slug_aliases, ['orf-hitradio-3-hq', 'orf-hitradio-o3-1', oldSlug]);
        for (const key of Object.keys(old).filter(key => !['slug', 'slug_aliases', 'updated_at', 'no_index_recovery_journal'].includes(key))) {
          assert.deepEqual(current[key], old[key], `preserve ${key}`);
        }
        const receipt = current.no_index_recovery_journal[auditKey];
        assert.equal(receipt.previous.slug, oldSlug);
        assert.deepEqual(receipt.previous.slugAliases, old.slug_aliases);
        assert.equal(receipt.previous.journalWasNull, true);
        for (const key of ['aliases', 'favorites', 'votes', 'ratings'] as const) assert.deepEqual(after[key], before[key]);
        assert.deepEqual(after.stations.find(row => row.id === 'french-pilot'), before.stations.find(row => row.id === 'french-pilot'));
        const manifest = after.manifests[0], previous = before.manifests[0];
        assert.notEqual(manifest.chunks[0].maxUpdatedAt, previous.chunks[0].maxUpdatedAt);
        assert.deepEqual(manifest.chunks[1], previous.chunks[1]);
        assert.deepEqual({ ...manifest, chunks: previous.chunks }, previous);
        assert.deepEqual({ ...manifest.chunks[0], maxUpdatedAt: previous.chunks[0].maxUpdatedAt }, previous.chunks[0]);
        for (const identifier of [canonical, oldSlug, original, survivor]) {
          const station = await getStationByIdentifier(identifier);
          assert.equal(station._id, survivor);
          assert.equal(station.slug, canonical);
          assert.equal(station.url, old.url);
          assert.equal(station.noIndex, false);
          assert.equal(Object.hasOwn(station, 'noIndexRecoveryJournal'), false);
          assert.equal(Object.hasOwn(station, auditKey), false);
        }
        await pool.query(migration);
        assert.deepEqual(await snapshot(), after, 'rerun does not touch receipts, timestamps or manifests');
      });

      await t.test('an absent reviewed survivor is harmless on fresh databases', async () => {
        await reset();
        await pool.query('DELETE FROM stations WHERE id=$1', [survivor]);
        const before = await snapshot();
        await pool.query(migration);
        assert.deepEqual(await snapshot(), before);
      });

      await t.test('NULL alias members cannot bypass identity or prior-receipt validation', async () => {
        for (const aliases of [[null], [canonical, null], [oldSlug, null]]) {
          await reset();
          await pool.query('UPDATE stations SET slug_aliases=$2::text[] WHERE id=$1', [survivor, aliases]);
          await rejectsWithoutChange();
          await pool.query('UPDATE stations SET slug=$2,no_index_recovery_journal=$3 WHERE id=$1',
            [survivor, canonical, { [auditKey]: { appliedAt: '2026-11-15' } }]);
          await rejectsWithoutChange();
        }
      });

      await t.test('a same-millisecond cache timestamp still creates a different Date.getTime key', async () => {
        await reset();
        const oldTime = '2026-11-15T12:00:00.123789Z';
        await pool.query("UPDATE sitemap_manifests SET chunks=jsonb_set(chunks,'{0,maxUpdatedAt}',to_jsonb($1::text))", [oldTime]);
        const fixedClockSql = migration.replace('clock_timestamp()', "'2026-11-15T12:00:00.123456Z'::timestamptz");
        assert.notEqual(fixedClockSql, migration);
        await pool.query(fixedClockSql);
        const chunk = (await snapshot()).manifests[0].chunks[0];
        assert.equal(new Date(chunk.maxUpdatedAt).getTime(), new Date(oldTime).getTime() + 1);
      });

      await t.test('changed identity, stream, visibility, private state or merge evidence cannot be overwritten', async () => {
        for (const sql of [
          "station_uuid='changed'", "name='Another Radio'", "slug='changed'", "homepage='https://other.invalid/'",
          "country='Germany'", "country_code='DE'", "url='https://other.invalid/live'", "url_resolved='https://other.invalid/live'",
          'no_index=true', 'is_list_visible=false', "redirect_to_slug='elsewhere'", "source='[]'",
          "source=source-'mergedStationIds'", "source=source||'{\"stationPageMode\":\"information\"}'",
          "manual_edit_fields='[]'", "no_index_recovery_journal='[]'", 'slug_aliases=ARRAY[]::text[]',
        ]) {
          await reset();
          await pool.query(`UPDATE stations SET ${sql} WHERE id=$1`, [survivor]);
          await rejectsWithoutChange();
        }
        await reset();
        await pool.query('DELETE FROM station_merge_aliases WHERE alias=$1', [original]);
        await rejectsWithoutChange();
      });

      await t.test('conflicting live, merged, genre, user ownership and incoming redirects stop the entire repair', async () => {
        for (const slug of [canonical, oldSlug]) {
          for (const sql of ['slug=$1', 'slug_aliases=ARRAY[$1]', 'redirect_to_slug=$1', "source=jsonb_build_object('redirectToSlug',$1::text)"]) {
            await reset();
            await pool.query(`UPDATE stations SET ${sql} WHERE id='french-pilot'`, [slug]);
            await rejectsWithoutChange();
          }
          await reset();
          await pool.query("INSERT INTO station_merge_aliases(alias,station_id) VALUES($1,'french-pilot')", [slug]);
          await rejectsWithoutChange();
          await reset();
          await pool.query("UPDATE users SET slug=$1 WHERE id='listener'", [slug]);
          await rejectsWithoutChange();
          await reset();
          await fixture.insert('genres', { _id: 'collision', name: 'Collision', slug });
          await rejectsWithoutChange();
        }
      });

      await t.test('an overlapping writer fails fast rather than waiting or making partial changes', async () => {
        await reset();
        const writer = await pool.connect();
        try {
          await writer.query('BEGIN');
          await writer.query('SELECT id FROM stations WHERE id=$1 FOR UPDATE', [survivor]);
          const before = await snapshot();
          await assert.rejects(pool.query(migration), (error: any) => error.code === '55P03');
          assert.deepEqual(await snapshot(), before);
        } finally { await writer.query('ROLLBACK'); writer.release(); }
      });

      await t.test('failure to update an affected sitemap chunk rolls back the slug and private receipt too', async () => {
        await reset();
        await pool.query(`CREATE FUNCTION reject_oe3_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'simulated cache invalidation failure'; END $$;
          CREATE TRIGGER reject_oe3_manifest BEFORE UPDATE ON sitemap_manifests
          FOR EACH ROW EXECUTE FUNCTION reject_oe3_manifest();`);
        const before = await snapshot();
        await assert.rejects(pool.query(migration), /simulated cache invalidation failure/);
        assert.deepEqual(await snapshot(), before);
      });
    } finally { await fixture.close(); }
  });
