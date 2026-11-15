import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createNativePostgresFixture } from './helpers/native-postgres-fixture';

const directory = new URL('../../../lib/db/migrations/', import.meta.url);
const preflight = await readFile(new URL('0057_verified_oe3_official_homepage.sql', directory), 'utf8');
const canonical = await readFile(new URL('0058_verified_oe3_canonical_recovery.sql', directory), 'utf8');
const id = '68a8c483bd66579311ab2ffe', original = '68a8c483bd66579311ab2ffa';
const key = 'verifiedOe3HomepageHttpsRecovery20261115';

test('raw HTTP homepage preflight recovers the proven deployment failure without changing 0058',
  { skip: !process.env.PG_TEST_DATABASE_URL }, async t => {
    const url = new URL(process.env.PG_TEST_DATABASE_URL!);
    assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/radiohub_test');
    const f = await createNativePostgresFixture('oe3_homepage_preflight');
    const row = async () => (await f.pool.query('SELECT * FROM stations WHERE id=$1', [id])).rows[0];
    const reset = async () => {
      await f.clear('stations', 'radiohub_schema_migrations');
      await f.insert('stations', { _id: id, stationuuid: 'e723f7f8-0db1-4bc5-a64c-64d8377f9f9a',
        name: 'ORF Hitradio Ö3 | HQ', slug: 'orf-hitradio-o3-hq', slugAliases: ['orf-hitradio-o3'],
        homepage: 'http://oe3.orf.at/', country: 'Austria', countryCode: 'AT',
        url: 'https://orf-live.ors-shoutcast.at/oe3-q2a', urlResolved: 'https://orf-live.ors-shoutcast.at/oe3-q2a',
        noIndex: false, isListVisible: true, mergedStationIds: [original],
        descriptions: { de: { full: 'Retained text', meta: 'Retained meta' } }, manualEditFields: { descriptions: true } });
      await f.pool.query('INSERT INTO station_merge_aliases(alias,station_id) VALUES($1,$2)', [original,id]);
    };
    try {
      await f.pool.query('CREATE TABLE IF NOT EXISTS radiohub_schema_migrations(name text PRIMARY KEY,checksum text)');
      await t.test('exact raw HTTP state fails first, preflight upgrades only one homepage, unchanged canonical migration succeeds', async () => {
        await reset(); const before = await row();
        await assert.rejects(f.pool.query(canonical), /reviewed identity or merge evidence changed/);
        assert.deepEqual(await row(), before);
        await f.pool.query(preflight); const upgraded = await row();
        assert.equal(upgraded.homepage, 'https://oe3.orf.at/');
        for (const field of Object.keys(before).filter(field => !['homepage','updated_at','no_index_recovery_journal'].includes(field))) {
          assert.deepEqual(upgraded[field], before[field], field);
        }
        assert.equal(upgraded.no_index_recovery_journal[key].previous.homepage, before.homepage);
        assert.equal(upgraded.source.homepage, 'http://oe3.orf.at/');
        await f.pool.query(preflight); assert.deepEqual(await row(), upgraded);
        await f.pool.query(canonical); const restored = await row();
        assert.equal(restored.slug, 'orf-hitradio-o3');
        assert.ok(restored.slug_aliases.includes('orf-hitradio-o3-hq'));
        assert.equal(Object.keys(restored.no_index_recovery_journal).length, 2);
        await f.pool.query(preflight); await f.pool.query(canonical);
        assert.deepEqual(await row(), restored);
      });
      await t.test('missing survivor is harmless and does not invent a radio', async () => {
        await f.clear('stations'); await f.pool.query(preflight);
        assert.equal((await f.pool.query('SELECT count(*)::int n FROM stations')).rows[0].n, 0);
      });
      await t.test('manual homepage ownership, a different identity and unreviewed receipt states fail without edits', async () => {
        for (const sql of ["manual_edit_fields=manual_edit_fields||'{\"homepage\":true}'", "homepage='https://other.invalid/'",
          "station_uuid='changed'", "source=source-'mergedStationIds'", "no_index_recovery_journal='[]'",
          `no_index_recovery_journal='{"${key}":{}}'`]) {
          await reset(); await f.pool.query(`UPDATE stations SET ${sql} WHERE id=$1`, [id]); const before = await row();
          await assert.rejects(f.pool.query(preflight), /oe3 homepage recovery/);
          assert.deepEqual(await row(), before);
        }
      });
      await t.test('a prior correctly applied 0058 is preserved without fabricating a preflight receipt', async () => {
        await reset(); await f.pool.query("UPDATE stations SET homepage='https://oe3.orf.at/' WHERE id=$1", [id]);
        await f.pool.query(canonical);
        await f.pool.query("INSERT INTO radiohub_schema_migrations VALUES('0058_verified_oe3_canonical_recovery.sql','prior-verified-checksum')");
        const before = await row(); await f.pool.query(preflight);
        assert.deepEqual(await row(), before);
        assert.equal(Object.hasOwn(before.no_index_recovery_journal, key), false);
      });
    } finally { await f.close(); }
  });
