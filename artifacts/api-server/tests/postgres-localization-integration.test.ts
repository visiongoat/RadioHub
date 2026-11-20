import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { PostgresLocalizationStore } from '../src/data/postgres-localization-store';

// This test mutates only its randomly named schema on the explicitly supplied
// test database. DATABASE_URL is deliberately not used as an implicit fallback.
const connectionString = process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL localization integration', { skip: !connectionString }, () => {
  const schema = `localization_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const ssl = process.env.PG_TEST_SSL === 'require' ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  const pool = new pg.Pool({ connectionString, ssl, max: 8, options: `-c search_path=${schema},public` });
  const store = new PostgresLocalizationStore(pool);
  let schemaCreated = false;

  before(async () => {
    assert.match(schema, /^localization_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migrations = path.resolve(import.meta.dirname, '../../../lib/db/migrations');
    const files = (await readdir(migrations)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
    for (const file of files) await pool.query(await readFile(path.join(migrations, file), 'utf8'));
  });

  after(async () => {
    await pool.end();
    try {
      if (schemaCreated) {
        assert.match(schema, /^localization_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally {
      await admin.end();
    }
  });

  it('initializes metadata once and retains every simultaneous version bump', async () => {
    const initial = await Promise.all(Array.from({ length: 8 }, () => store.getMetadata()));
    assert.ok(initial.every((row) => row.languagesVersion === 1));
    const bumps = await Promise.all(Array.from({ length: 24 }, (_, index) => store.bumpVersion(`batch ${index}`)));
    assert.equal(new Set(bumps.map((row) => row.version)).size, 24);
    assert.equal((await store.getMetadata()).languagesVersion, 25);
    assert.deepEqual(await store.bumpVersion('new scope', 'second-scope'), { success: true, version: 2 });
  });

  it('boot seed failure rolls back both gap-filled values and the required metadata change', async () => {
    await pool.query("ALTER TABLE translation_metadata ADD CONSTRAINT reject_seed_metadata CHECK (notes <> 'Seeded rejected-seed translation gaps')");
    try {
      await assert.rejects(store.seedTranslationBundle([{ key: 'seed_must_rollback', defaultValue: 'Source' }],
        { tr: { seed_must_rollback: 'Çeviri' } }, 'rejected-seed', { bumpVersion: true }), /reject_seed_metadata/);
      assert.equal(await store.findKey('seed_must_rollback'), null);
    } finally { await pool.query('ALTER TABLE translation_metadata DROP CONSTRAINT reject_seed_metadata'); }
  });

  it('upserts URL paths without changing public IDs and returns consistent statistics', async () => {
    const saved = await store.saveUrlTranslations([
      { languageCode: 'tr', englishPath: 'about', translatedPath: 'hakkinda' },
      { languageCode: 'de', englishPath: 'about', translatedPath: 'uber' },
      { languageCode: 'tr', englishPath: 'contact', translatedPath: 'iletisim' },
    ]);
    assert.deepEqual(saved, { upsertedCount: 3, modifiedCount: 0 });
    const previous = (await store.listUrlTranslations('de'))[0];
    assert.match(previous._id, /^[a-f0-9]{24}$/);
    assert.deepEqual(await store.saveUrlTranslations([
      { languageCode: 'de', englishPath: 'about', translatedPath: 'ueber-uns', notes: "Editor's correction" },
    ]), { upsertedCount: 0, modifiedCount: 1 });
    const current = (await store.listUrlTranslations('de'))[0];
    assert.equal(current._id, previous._id);
    assert.equal(current.translatedPath, 'ueber-uns');
    assert.equal(current.notes, "Editor's correction");
    assert.deepEqual(await store.urlTranslationStats(), {
      totalTranslations: 3, totalLanguages: 2,
      byLanguage: [{ _id: 'de', count: 1 }, { _id: 'tr', count: 2 }],
      byPath: [{ _id: 'about', count: 2 }, { _id: 'contact', count: 1 }],
    });
    assert.equal((await store.deleteUrlTranslation(previous._id))?._id, previous._id);
    assert.equal(await store.deleteUrlTranslation(previous._id), null);
    assert.deepEqual(await store.listUrlTranslations('de'), []);
  });

  it('rolls back every row if one entry violates a database constraint', async () => {
    await pool.query("ALTER TABLE url_translations ADD CONSTRAINT test_reject_path CHECK (translated_path <> '__reject')");
    await assert.rejects(store.saveUrlTranslations([
      { languageCode: 'xx', englishPath: 'a', translatedPath: 'allowed' },
      { languageCode: 'xx', englishPath: 'z', translatedPath: '__reject' },
    ]), (error: any) => error.code === '23514');
    assert.deepEqual(await store.listUrlTranslations('xx'), []);
  });

  it('joins translation keys and filters language without requiring a MongoDB connection', async () => {
    await pool.query("INSERT INTO translation_keys(id,key,default_value,category) VALUES ('k1','welcome','Welcome','general'),('k2','goodbye','Goodbye','general')");
    await pool.query("INSERT INTO translations(id,key_id,language,value,last_modified) VALUES ('t1','k1','tr','Merhaba',now()),('t2','k2','tr','Gule gule',now()),('t3','k1','de','Hallo',now())");
    assert.deepEqual(await store.getTranslations('tr'), { welcome: 'Merhaba', goodbye: 'Gule gule' });
    assert.deepEqual(await store.getTranslations('tr', ['welcome']), { welcome: 'Merhaba' });
    assert.deepEqual(await store.getTranslations('tr', []), {});
    assert.deepEqual(await store.getTranslations('fr'), {});
  });

  it('preserves key identity, falls back to defaults and atomically rejects invalid translation batches', async () => {
    const key = await store.createKey({ key: 'new_key', defaultValue: 'Default', category: 'test', context: 'Preserve me' });
    const row = await store.upsertTranslation({ keyId: key._id, language: 'tr', value: 'Ceviri', isCompleted: true });
    assert.deepEqual(await store.upsertKey({ key: 'new_key', defaultValue: 'Changed' }, true), { ...key, updatedAt: (await store.findKey('new_key')).updatedAt });
    assert.equal((await store.findKey('new_key')).context, 'Preserve me');
    const updated = await store.updateKey(key._id, { defaultValue: 'New default' });
    assert.equal(updated._id, key._id);
    assert.equal((await store.getTranslationsWithDefaults('fr')).new_key, 'New default');
    assert.equal((await store.getTranslationsWithDefaults('tr')).new_key, 'Ceviri');
    assert.equal(await store.upsertTranslation({ keyId: key._id, language: 'tr', value: 'Do not overwrite' }, true), null);
    await assert.rejects(store.bulkUpsertTranslations([
      { keyId: key._id, language: 'tr', value: 'Must roll back', isCompleted: true },
      { keyId: 'zz-missing-key', language: 'tr', value: 'Invalid FK' },
    ]), (error: any) => error.code === '23503');
    assert.equal((await store.findTranslation(key._id, 'tr'))._id, row._id);
    assert.equal((await store.findTranslation(key._id, 'tr')).value, 'Ceviri');
    assert.equal((await store.deleteKey(key._id))._id, key._id);
    assert.equal(await store.findTranslation(key._id, 'tr'), null);
  });

  it('serializes default-language changes and moves translations on language-code rename', async () => {
    const languages = await Promise.all([
      store.saveTranslationLanguage({ code: 'aa', name: 'Language A', isDefault: true }),
      store.saveTranslationLanguage({ code: 'bb', name: 'Language B', isDefault: true }),
    ]);
    const current = await store.getTranslationLanguages();
    assert.equal(current.filter((language) => language.isDefault).length, 1);
    const defaultLanguage = current.find((language) => language.isDefault);
    await assert.rejects(store.deleteTranslationLanguage(defaultLanguage._id), (error: any) => error.code === 'default_language');
    const other = languages.find((language) => language._id !== defaultLanguage._id);
    await store.upsertTranslation({ keyId: 'k1', language: other.code, value: 'Move this text', isCompleted: true });
    await store.saveTranslationLanguage({ code: 'renamed' }, other._id);
    assert.equal(await store.findTranslation('k1', other.code), null);
    assert.equal((await store.findTranslation('k1', 'renamed')).value, 'Move this text');
    assert.equal((await store.translationLanguagesWithCompletion()).find((language) => language.code === 'renamed').completionPercentage, 50);
    await store.deleteTranslationLanguage(other._id);
    assert.equal(await store.findTranslation('k1', 'renamed'), null);
  });

  it('commits country mapping changes with their audit records and filters audit text literally', async () => {
    const actorEmail = "admin+test_100%@example.test";
    const saved = await store.saveCountryLanguageMappings([
      { countryCode: 'TR', countryName: 'Turkey', languageCode: 'de' },
      { countryCode: 'DE', countryName: 'Germany', languageCode: 'de' },
    ], 'bulk-save', actorEmail);
    assert.equal(saved.length, 2);
    const audit = await store.listMappingAudit({ actorEmail: '+test_100%', country: 'turk' });
    assert.equal(audit.total, 1);
    assert.equal(audit.entries[0].changes[0].previousLanguageCode, null);
    const deletion = await store.deleteCountryLanguageMappings('overrides', { TR: 'tr', DE: 'de' }, actorEmail);
    assert.equal(deletion.deletedCount, 1);
    assert.equal(deletion.snapshot[0].countryCode, 'TR');
    assert.equal((await store.getCountryLanguageMappings(false)).length, 1);
    const cleared = await store.listMappingAudit({ action: 'clear-overrides' });
    assert.equal(cleared.total, 1);
    assert.deepEqual(cleared.entries[0].snapshot, [{ countryCode: 'TR', countryName: 'Turkey', currentLanguageCode: 'de', defaultLanguageCode: 'tr' }]);
    assert.deepEqual((await store.findMappingAudit(cleared.entries[0]._id)).snapshot, cleared.entries[0].snapshot);
    const emptyFilter = await store.listMappingAudit({ actorEmail: 'nonexistent' });
    assert.deepEqual(emptyFilter, { entries: [], total: 0 });
  });

  it('rolls back country deletion if the durable audit record cannot be written', async () => {
    await pool.query("ALTER TABLE country_language_mapping_audit ADD CONSTRAINT test_reject_reset CHECK (action <> 'reset-all')");
    await assert.rejects(store.deleteCountryLanguageMappings('all', {}), (error: any) => error.code === '23514');
    assert.equal((await store.getCountryLanguageMappings(false)).length, 1);
    assert.equal((await store.listMappingAudit({ action: 'reset-all' })).total, 0);
  });

  it('boot seeds fill missing or blank translations and preserve admin copy across repeated runs', async () => {
    const definitions = [{ key: 'seed_key', defaultValue: 'Seed default', description: 'Seed key' }];
    assert.equal(await store.seedTranslationBundle(definitions, { tr: { seed_key: 'Baseline' } }, 'test'), 1);
    const key = await store.findKey('seed_key');
    await store.updateKey(key._id, { defaultValue: 'Admin default', description: 'Admin description' });
    await store.upsertTranslation({ keyId: key._id, language: 'tr', value: 'Admin text', isCompleted: true });
    await store.upsertTranslation({ keyId: key._id, language: 'de', value: ' \n\t', isCompleted: false });
    const results = await Promise.all(Array.from({ length: 3 }, () => store.seedTranslationBundle(definitions, {
      tr: { seed_key: 'Do not overwrite' }, de: { seed_key: 'Hallo' }, fr: { seed_key: 'Bonjour' },
    }, 'test')));
    assert.equal(results.reduce((sum, value) => sum + value, 0), 2);
    assert.equal((await store.findKey('seed_key')).defaultValue, 'Admin default');
    assert.equal((await store.findKey('seed_key')).description, 'Admin description');
    assert.equal((await store.findTranslation(key._id, 'tr')).value, 'Admin text');
    assert.equal((await store.findTranslation(key._id, 'de')).value, 'Hallo');
    assert.equal((await store.findTranslation(key._id, 'fr')).value, 'Bonjour');
  });
  it('counts English source defaults without requiring duplicate English translations', async () => {
    await store.saveTranslationLanguage({ code: 'en', name: 'English', isEnabled: true });
    await store.createKey({ key: 'source_only_english', defaultValue: 'English source text', category: 'test' });
    const englishRows = await store.listTranslations('en');
    assert.equal((await store.translationLanguagesWithCompletion()).find(language => language.code === 'en').completionPercentage, 100);
    assert.deepEqual(await store.listTranslations('en'), englishRows, 'reading completion must not generate translation rows');
    const blank = await store.createKey({ key: 'blank_source_fixture', defaultValue: '   ', category: 'test' });
    assert.ok((await store.translationLanguagesWithCompletion()).find(language => language.code === 'en').completionPercentage < 100, 'missing source text is still incomplete');
    await store.deleteKey(blank._id);
  });

});
