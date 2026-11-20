import { randomBytes } from 'node:crypto';
import { isActiveUiLanguage } from '@workspace/seo-shared/seo-config';
import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';

export const localizationStore = 'postgres' as const;

export interface UrlTranslationInput {
  languageCode: string;
  englishPath: string;
  translatedPath: string;
  notes?: string;
}

export interface UrlTranslationRecord extends UrlTranslationInput {
  _id: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TranslationMetadataRecord {
  _id: string;
  scope: string;
  languagesVersion: number;
  lastBumpedAt: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TranslationKeyInput {
  key: string;
  defaultValue: string;
  category?: string;
  description?: string | null;
  context?: string | null;
  isPlural?: boolean;
}

export interface TranslationInput {
  keyId: string;
  language: string;
  value: string;
  isCompleted?: boolean;
  lastModified?: Date;
}

export interface CountryLanguageMappingInput {
  countryCode: string;
  countryName: string;
  languageCode: string;
  isActive?: boolean;
  notes?: string;
}

export interface MappingAuditFilter {
  action?: string;
  actorEmail?: string;
  country?: string;
  from?: Date;
  to?: Date;
}

function countryMapping(row: any): any {
  return { _id: row.id, countryCode: row.country_code, countryName: row.country_name,
    languageCode: row.language_code, isActive: row.is_active, priority: row.priority,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mappingAudit(row: any): any {
  return { _id: row.id, action: row.action, actorEmail: row.actor_email, deletedCount: row.deleted_count,
    snapshot: row.snapshot || [], changes: row.changes || [], createdAt: new Date(row.created_at) };
}

function translationKey(row: any): any {
  return { _id: row.id, key: row.key, defaultValue: row.default_value, category: row.category,
    description: row.description, context: row.context, isPlural: row.is_plural,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function translationRow(row: any, populated = false): any {
  return { _id: row.id, keyId: populated ? { _id: row.key_id, key: row.key, defaultValue: row.default_value } : row.key_id,
    language: row.language, value: row.value, isCompleted: row.is_completed,
    lastModified: row.last_modified, createdAt: row.created_at };
}

function translationLanguage(row: any): any {
  return { _id: row.id, code: row.code, name: row.name, isEnabled: row.is_enabled,
    isDefault: row.is_default, createdAt: row.created_at };
}

function metadata(row: any): TranslationMetadataRecord {
  const version = Number(row.languages_version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Translation metadata version is outside the supported integer range');
  }
  return {
    _id: row.scope, scope: row.scope, languagesVersion: version,
    lastBumpedAt: row.last_bumped_at, notes: row.notes ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function urlTranslation(row: any): UrlTranslationRecord {
  return {
    _id: row.id, languageCode: row.language_code, englishPath: row.english_path,
    translatedPath: row.translated_path, isActive: row.is_active,
    notes: row.notes ?? '', createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Explicit localization queries; all API-visible IDs remain 24-character text. */
export class PostgresLocalizationStore {
  private pool: Pick<pg.Pool, 'query' | 'connect'>;

  constructor(pool: Pick<pg.Pool, 'query' | 'connect'>) {
    this.pool = pool;
  }

  private async transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getKeys(keys?: readonly string[]): Promise<any[]> {
    const result = await this.pool.query('SELECT * FROM translation_keys WHERE ($1::text[] IS NULL OR key=ANY($1::text[])) ORDER BY created_at,id', [keys ?? null]);
    return result.rows.map(translationKey);
  }

  async countKeys(): Promise<number> {
    return Number((await this.pool.query('SELECT count(*)::integer AS count FROM translation_keys')).rows[0].count);
  }

  async findKey(key: string): Promise<any | null> {
    const result = await this.pool.query('SELECT * FROM translation_keys WHERE key=$1', [key]);
    return result.rows[0] ? translationKey(result.rows[0]) : null;
  }

  async createKey(input: TranslationKeyInput): Promise<any> {
    const result = await this.pool.query(
      `INSERT INTO translation_keys(id,key,default_value,category,description,context,is_plural)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [randomBytes(12).toString('hex'), input.key, input.defaultValue, input.category || 'general', input.description ?? null, input.context ?? null, !!input.isPlural],
    );
    return translationKey(result.rows[0]);
  }

  async upsertKey(input: TranslationKeyInput, preserveExisting = false): Promise<any> {
    const result = await this.pool.query(
      `INSERT INTO translation_keys(id,key,default_value,category,description,context,is_plural)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(key) DO UPDATE SET
         default_value=CASE WHEN $8 THEN translation_keys.default_value ELSE EXCLUDED.default_value END,
         category=CASE WHEN $8 THEN translation_keys.category ELSE EXCLUDED.category END,
         description=CASE WHEN $8 THEN translation_keys.description ELSE EXCLUDED.description END,
         context=CASE WHEN $8 THEN translation_keys.context ELSE EXCLUDED.context END,
         is_plural=CASE WHEN $8 THEN translation_keys.is_plural ELSE EXCLUDED.is_plural END
       RETURNING *`,
      [randomBytes(12).toString('hex'), input.key, input.defaultValue, input.category || 'general', input.description ?? null, input.context ?? null, !!input.isPlural, preserveExisting],
    );
    return translationKey(result.rows[0]);
  }

  async updateKey(id: string, input: Partial<TranslationKeyInput>): Promise<any | null> {
    const fields = { key: 'key', defaultValue: 'default_value', category: 'category', description: 'description', context: 'context', isPlural: 'is_plural' } as const;
    const values: unknown[] = [id];
    const changes: string[] = [];
    for (const [property, column] of Object.entries(fields)) {
      const value = input[property as keyof TranslationKeyInput];
      if (value !== undefined) { values.push(value); changes.push(`${column}=$${values.length}`); }
    }
    const result = await this.pool.query(`UPDATE translation_keys SET ${changes.length ? changes.join(',') : 'updated_at=now()'} WHERE id=$1 RETURNING *`, values);
    return result.rows[0] ? translationKey(result.rows[0]) : null;
  }

  async deleteKey(id: string): Promise<any | null> {
    const result = await this.pool.query('DELETE FROM translation_keys WHERE id=$1 RETURNING *', [id]);
    return result.rows[0] ? translationKey(result.rows[0]) : null;
  }

  async bulkUpdateKeyDefaults(updates: unknown): Promise<number> {
    if (!Array.isArray(updates) || updates.length === 0 || updates.length > 1000 || updates.some(row =>
      !row || typeof row.keyId !== 'string' || !row.keyId.trim() || row.keyId.length > 256 ||
      typeof row.defaultValue !== 'string' || !row.defaultValue.trim() || row.defaultValue.length > 20000) ||
      new Set(updates.map(row => row.keyId)).size !== updates.length) {
      throw Object.assign(new Error('Expected 1-1000 unique keys with non-empty source values'), { status: 400 });
    }
    return this.transaction(async client => {
      const found = await client.query('SELECT id FROM translation_keys WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
        [updates.map(row => row.keyId)]);
      if (found.rows.length !== updates.length) throw Object.assign(new Error('One or more translation keys no longer exist'), { status: 409 });
      let changed = 0;
      for (const row of updates) {
        const result = await client.query('UPDATE translation_keys SET default_value=$2,updated_at=now() WHERE id=$1 AND default_value IS DISTINCT FROM $2',
          [row.keyId, row.defaultValue]);
        changed += result.rowCount ?? 0;
      }
      if (changed) await client.query(
        `INSERT INTO translation_metadata(scope,languages_version,notes) VALUES ('global',2,'Updated translation source values')
         ON CONFLICT(scope) DO UPDATE SET languages_version=translation_metadata.languages_version+1,
           last_bumped_at=now(),updated_at=now(),notes=EXCLUDED.notes`);
      return changed;
    });
  }

  async listTranslations(language?: string, keys?: readonly string[], populated = false): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT t.*,k.key,k.default_value FROM translations t JOIN translation_keys k ON k.id=t.key_id
       WHERE ($1::text IS NULL OR t.language=$1) AND ($2::text[] IS NULL OR k.key=ANY($2::text[])) ORDER BY t.created_at,t.id`,
      [language ?? null, keys ?? null],
    );
    return result.rows.map((row) => translationRow(row, populated));
  }

  async adminTranslationCompletion(): Promise<Array<{ keyId: string; completedCount: number }>> {
    const result = await this.pool.query(
      `SELECT t.key_id, count(*)::integer AS completed_count
       FROM translations t JOIN translation_languages l ON l.code=t.language
       WHERE l.is_enabled=true AND t.language<>'en' AND t.is_completed=true
         AND btrim(t.value, $1)<>''
       GROUP BY t.key_id`,
      // Match String.trim() used by the editor, including Unicode whitespace.
      [' \t\n\r\f\v\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'],
    );
    return result.rows.map(row => ({ keyId: row.key_id, completedCount: Number(row.completed_count) }));
  }

  async adminTranslationValues(filter: { language?: string; keyId?: string }): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT id,key_id,language,value,is_completed FROM translations
       WHERE ($1::text IS NULL OR language=$1) AND ($2::text IS NULL OR key_id=$2)
       ORDER BY language,key_id`,
      [filter.language ?? null, filter.keyId ?? null],
    );
    return result.rows.map(row => ({ _id: row.id, keyId: row.key_id, language: row.language,
      value: row.value, isCompleted: row.is_completed }));
  }

  async findTranslation(keyId: string, language: string): Promise<any | null> {
    const result = await this.pool.query('SELECT * FROM translations WHERE key_id=$1 AND language=$2', [keyId, language]);
    return result.rows[0] ? translationRow(result.rows[0]) : null;
  }

  private async writeTranslation(client: Pick<pg.PoolClient, 'query'>, input: TranslationInput, insertOnly: boolean): Promise<any | null> {
    const result = await client.query(
      `INSERT INTO translations(id,key_id,language,value,is_completed,last_modified)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(key_id,language)
       ${insertOnly ? 'DO NOTHING' : 'DO UPDATE SET value=EXCLUDED.value,is_completed=EXCLUDED.is_completed,last_modified=EXCLUDED.last_modified'} RETURNING *`,
      [randomBytes(12).toString('hex'), input.keyId, input.language, input.value, input.isCompleted ?? false, input.lastModified ?? new Date()],
    );
    return result.rows[0] ? translationRow(result.rows[0]) : null;
  }

  async upsertTranslation(input: TranslationInput, insertOnly = false): Promise<any | null> {
    return this.writeTranslation(this.pool, input, insertOnly);
  }

  async bulkUpsertTranslations(inputs: TranslationInput[]): Promise<number> {
    if (!Array.isArray(inputs) || inputs.length > 10_000 || inputs.some((item) => !item ||
      typeof item.keyId !== 'string' || !item.keyId || typeof item.language !== 'string' || !item.language ||
      typeof item.value !== 'string' || (item.isCompleted !== undefined && typeof item.isCompleted !== 'boolean'))) {
      throw new Error('Invalid translations: expected at most 10000 entries with keyId, language and value strings');
    }
    return this.transaction(async (client) => {
      const ordered = [...inputs].sort((a, b) => a.keyId.localeCompare(b.keyId) || a.language.localeCompare(b.language));
      for (const input of ordered) await this.writeTranslation(client, input, false);
      return inputs.length;
    });
  }

  /** Boot-time seeders fill gaps without overwriting concurrent admin edits. */
  async seedTranslationBundle(definitions: readonly TranslationKeyInput[], translations: Record<string, Record<string, string>>, category: string,
    options: { overwriteExisting?: boolean; bumpVersion?: boolean } = {}): Promise<number> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`localization:seed:${category}`]);
      const ordered = [...definitions].sort((a, b) => a.key.localeCompare(b.key));
      let insertedKeys = 0;
      for (const definition of ordered) {
        const inserted = await client.query(
        `INSERT INTO translation_keys(id,key,default_value,category,description,is_plural)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(key) DO NOTHING`,
        [randomBytes(12).toString('hex'), definition.key, definition.defaultValue, definition.category || category, definition.description ?? null, definition.isPlural ?? false],
        );
        insertedKeys += inserted.rowCount || 0;
      }
      const keys = await client.query('SELECT id,key FROM translation_keys WHERE key=ANY($1::text[])', [ordered.map((definition) => definition.key)]);
      const ids = new Map(keys.rows.map((key) => [key.key, key.id]));
      let changed = 0;
      for (const [language, values] of Object.entries(translations).sort(([a], [b]) => a.localeCompare(b))) {
        if (!isActiveUiLanguage(language)) continue;
        for (const definition of ordered) {
          const value = values[definition.key];
          if (typeof value !== 'string' || !value.trim()) continue;
          const result = await client.query(
            `INSERT INTO translations(id,key_id,language,value,is_completed,last_modified)
             VALUES ($1,$2,$3,$4,true,now()) ON CONFLICT(key_id,language) DO UPDATE SET
               value=EXCLUDED.value,is_completed=true,last_modified=now()
             WHERE ($5::boolean OR translations.value !~ '[^[:space:]]')
               AND (translations.value IS DISTINCT FROM EXCLUDED.value OR translations.is_completed IS DISTINCT FROM true)`,
            [randomBytes(12).toString('hex'), ids.get(definition.key), language, value, options.overwriteExisting === true],
          );
          changed += result.rowCount ?? 0;
        }
      }
      if (options.bumpVersion && (changed || insertedKeys)) await client.query(
        `INSERT INTO translation_metadata(scope,languages_version,notes) VALUES ('global',2,$1)
         ON CONFLICT(scope) DO UPDATE SET languages_version=translation_metadata.languages_version+1,
           last_bumped_at=now(),updated_at=now(),notes=EXCLUDED.notes`, [`Seeded ${category} translation gaps`]);
      return changed;
    });
  }

  async getTranslationsWithDefaults(language: string): Promise<Record<string, string>> {
    const result = await this.pool.query<{ key: string; value: string }>(
      `SELECT k.key,COALESCE(NULLIF(t.value,''),k.default_value) AS value FROM translation_keys k
       LEFT JOIN translations t ON t.key_id=k.id AND t.language=$1`, [language],
    );
    return Object.fromEntries(result.rows.filter((row) => row.value).map((row) => [row.key, row.value]));
  }

  async translationLanguagesWithCompletion(): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT l.*,CASE WHEN k.total=0 THEN 0 ELSE round(100.0*(CASE WHEN l.code='en' THEN k.source_completed ELSE COALESCE(t.completed,0) END)/k.total)::integer END AS completion
       FROM translation_languages l CROSS JOIN (SELECT count(*) AS total,count(*) FILTER (WHERE btrim(default_value)<>'') AS source_completed FROM translation_keys) k
       LEFT JOIN (SELECT language,count(*) AS completed FROM translations WHERE is_completed=true GROUP BY language) t ON t.language=l.code
       ORDER BY l.created_at DESC,l.id`,
    );
    return result.rows.map((row) => ({ ...translationLanguage(row), completionPercentage: row.completion }));
  }

  async findTranslationLanguage(code: string): Promise<any | null> {
    const result = await this.pool.query('SELECT * FROM translation_languages WHERE code=$1', [code]);
    return result.rows[0] ? translationLanguage(result.rows[0]) : null;
  }

  async saveTranslationLanguage(input: { code?: string; name?: string; isEnabled?: boolean; isDefault?: boolean }, id?: string): Promise<any | null> {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('localization:languages'))");
      const existing = id ? (await client.query('SELECT * FROM translation_languages WHERE id=$1 FOR UPDATE', [id])).rows[0] : null;
      if (id && !existing) return null;
      if (input.isDefault) await client.query('UPDATE translation_languages SET is_default=false WHERE is_default=true');
      const code = input.code?.toLowerCase() || existing?.code;
      const result = await client.query(
        `INSERT INTO translation_languages(id,code,name,is_enabled,is_default) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,is_enabled=EXCLUDED.is_enabled,is_default=EXCLUDED.is_default RETURNING *`,
        [id ?? randomBytes(12).toString('hex'), code, input.name || existing?.name, input.isEnabled ?? existing?.is_enabled ?? true, input.isDefault ?? existing?.is_default ?? false],
      );
      // Renaming a language must keep its translations attached. A collision in
      // the destination language is rejected and the entire rename rolls back.
      if (existing && code !== existing.code) await client.query('UPDATE translations SET language=$1 WHERE language=$2', [code, existing.code]);
      return translationLanguage(result.rows[0]);
    });
  }

  async deleteTranslationLanguage(id: string): Promise<any | null> {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('localization:languages'))");
      const row = (await client.query('SELECT * FROM translation_languages WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) return null;
      if (row.is_default) throw Object.assign(new Error('Cannot delete the default language'), { code: 'default_language' });
      await client.query('DELETE FROM translations WHERE language=$1', [row.code]);
      await client.query('DELETE FROM translation_languages WHERE id=$1', [id]);
      return translationLanguage(row);
    });
  }

  async getMetadata(scope = 'global'): Promise<TranslationMetadataRecord> {
    // A conflict-safe insert handles simultaneous first requests across API replicas.
    await this.pool.query(
      `INSERT INTO translation_metadata(scope, notes) VALUES ($1, $2)
       ON CONFLICT(scope) DO NOTHING`,
      [scope, 'Auto-created translation metadata'],
    );
    const result = await this.pool.query('SELECT * FROM translation_metadata WHERE scope=$1', [scope]);
    if (!result.rows[0]) throw new Error('Translation metadata disappeared while reading');
    return metadata(result.rows[0]);
  }

  async getQualifiedLanguagesLkg(key: string): Promise<any | null> {
    const result = await this.pool.query(
      `SELECT id AS "_id",key,languages,hash,source,computed_at AS "computedAt",expires_at AS "expiresAt",
       created_at AS "createdAt",updated_at AS "updatedAt" FROM seo_qualified_languages_lkg WHERE key=$1 AND expires_at>now()`, [key],
    );
    return result.rows[0] ?? null;
  }

  async saveQualifiedLanguagesLkg(input: { key: string; languages: string[]; hash: string; source: 'computed' | 'seed'; computedAt: Date; expiresAt: Date }): Promise<void> {
    await this.pool.query(
      `INSERT INTO seo_qualified_languages_lkg(id,key,languages,hash,source,computed_at,expires_at)
       VALUES ($1,$2,$3::text[],$4,$5,$6,$7) ON CONFLICT(key) DO UPDATE SET
       languages=EXCLUDED.languages,hash=EXCLUDED.hash,source=EXCLUDED.source,computed_at=EXCLUDED.computed_at,expires_at=EXCLUDED.expires_at`,
      [randomBytes(12).toString('hex'), input.key, input.languages, input.hash, input.source, input.computedAt, input.expiresAt],
    );
  }

  async bumpVersion(notes?: string, scope = 'global'): Promise<{ version: number; success: boolean }> {
    // Initial version is 1, so the first bump is 2. The upsert increments under
    // the row lock and never loses concurrent increments across API instances.
    const result = await this.pool.query(
      `INSERT INTO translation_metadata(scope,languages_version,notes)
       VALUES ($1,2,COALESCE($2,'Auto-created translation metadata'))
       ON CONFLICT(scope) DO UPDATE SET
         languages_version=translation_metadata.languages_version+1,
         last_bumped_at=now(),updated_at=now(),
         notes=COALESCE($2,translation_metadata.notes)
       RETURNING *`,
      [scope, notes || null],
    );
    return { version: metadata(result.rows[0]).languagesVersion, success: true };
  }

  async listUrlTranslations(languageCode?: string): Promise<UrlTranslationRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM url_translations WHERE is_active=true
       AND ($1::text IS NULL OR language_code=$1) ORDER BY language_code,english_path`,
      [languageCode ?? null],
    );
    return result.rows.map(urlTranslation);
  }

  async saveUrlTranslations(inputs: UrlTranslationInput[]): Promise<{ upsertedCount: number; modifiedCount: number }> {
    // Validate the complete request before beginning a write. One invalid entry
    // must not leave the earlier entries from the same request committed.
    if (!Array.isArray(inputs) || inputs.length > 10_000) {
      throw new Error('URL translations must be an array of at most 10000 entries');
    }
    for (const input of inputs) {
      if (!input || ['languageCode', 'englishPath', 'translatedPath'].some(
        (field) => typeof input[field as keyof UrlTranslationInput] !== 'string' || !input[field as keyof UrlTranslationInput]?.trim(),
      ) || (input.notes !== undefined && typeof input.notes !== 'string')) {
        throw new Error('Each URL translation requires non-empty languageCode, englishPath and translatedPath strings');
      }
    }
    if (!inputs.length) return { upsertedCount: 0, modifiedCount: 0 };
    const client = await this.pool.connect();
    let upsertedCount = 0;
    let modifiedCount = 0;
    try {
      await client.query('BEGIN');
      // Stable key ordering prevents lock-order inversions between concurrent bulks.
      const deduplicated = new Map<string, UrlTranslationInput>();
      for (const input of inputs) deduplicated.set(JSON.stringify([input.languageCode, input.englishPath]), input);
      const ordered = [...deduplicated.entries()].sort(([a], [b]) => a.localeCompare(b));
      for (const [, input] of ordered) {
        const result = await client.query<{ inserted: boolean }>(
          `INSERT INTO url_translations(id,language_code,english_path,translated_path,is_active,notes)
           VALUES ($1,$2,$3,$4,true,$5)
           ON CONFLICT(language_code,english_path) DO UPDATE SET
             translated_path=EXCLUDED.translated_path,is_active=true,notes=EXCLUDED.notes,updated_at=now()
           RETURNING (xmax=0) AS inserted`,
          [randomBytes(12).toString('hex'), input.languageCode, input.englishPath, input.translatedPath, input.notes || ''],
        );
        if (result.rows[0].inserted) upsertedCount++;
        else modifiedCount++;
      }
      await client.query('COMMIT');
      return { upsertedCount, modifiedCount };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteUrlTranslation(id: string): Promise<UrlTranslationRecord | null> {
    const result = await this.pool.query('DELETE FROM url_translations WHERE id=$1 RETURNING *', [id]);
    return result.rows[0] ? urlTranslation(result.rows[0]) : null;
  }

  async urlTranslationStats(): Promise<{
    totalTranslations: number;
    byLanguage: { _id: string; count: number }[];
    byPath: { _id: string; count: number }[];
    totalLanguages: number;
  }> {
    // One statement gives every counter the same PostgreSQL snapshot.
    const result = await this.pool.query<{ language_code: string; english_path: string; count: string }>(
      `SELECT language_code,english_path,count(*)::text AS count FROM url_translations
       WHERE is_active=true GROUP BY GROUPING SETS ((language_code),(english_path),())`,
    );
    const byLanguage: { _id: string; count: number }[] = [];
    const byPath: { _id: string; count: number }[] = [];
    let totalTranslations = 0;
    for (const row of result.rows) {
      if (row.language_code !== null) byLanguage.push({ _id: row.language_code, count: Number(row.count) });
      else if (row.english_path !== null) byPath.push({ _id: row.english_path, count: Number(row.count) });
      else totalTranslations = Number(row.count);
    }
    byLanguage.sort((a, b) => a._id.localeCompare(b._id));
    byPath.sort((a, b) => b.count - a.count || a._id.localeCompare(b._id));
    return { totalTranslations, byLanguage, byPath: byPath.slice(0, 10), totalLanguages: byLanguage.length };
  }

  async getTranslations(language: string, keys?: string[]): Promise<Record<string, string>> {
    const result = await this.pool.query<{ key: string; value: string }>(
      `SELECT k.key,t.value FROM translations t JOIN translation_keys k ON k.id=t.key_id
       WHERE t.language=$1 AND ($2::text[] IS NULL OR k.key=ANY($2::text[]))`,
      [language, keys ?? null],
    );
    return Object.fromEntries(result.rows.filter((row) => row.value).map((row) => [row.key, row.value]));
  }

  async getCountryLanguageMappings(activeOnly = true): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT id AS "_id",country_code AS "countryCode",country_name AS "countryName",
       language_code AS "languageCode",is_active AS "isActive",priority,notes,
       created_at AS "createdAt",updated_at AS "updatedAt"
       FROM country_language_mappings WHERE ($1::boolean=false OR is_active=true) ORDER BY country_name`,
      [activeOnly],
    );
    return result.rows;
  }

  private async writeMappingAudit(client: pg.PoolClient, entry: {
    action: string; actorEmail?: string; deletedCount: number; changes?: unknown[]; snapshot?: unknown[];
  }): Promise<void> {
    await client.query(
      `INSERT INTO country_language_mapping_audit(id,action,actor_email,deleted_count,changes,snapshot)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [randomBytes(12).toString('hex'), entry.action, entry.actorEmail ?? null, entry.deletedCount,
        JSON.stringify(entry.changes ?? []), JSON.stringify(entry.snapshot ?? [])],
    );
    await client.query(
      `DELETE FROM country_language_mapping_audit WHERE created_at < now()-interval '180 days'
       OR id IN (SELECT id FROM country_language_mapping_audit ORDER BY created_at DESC,id DESC OFFSET 500)`,
    );
  }

  async saveCountryLanguageMappings(inputs: CountryLanguageMappingInput[], action: 'edit' | 'bulk-save', actorEmail?: string): Promise<any[]> {
    if (inputs.length > 10_000 || inputs.some((input) => !input ||
      [input.countryCode,input.countryName,input.languageCode].some((value) => typeof value !== 'string' || !value.trim()) ||
      (input.isActive !== undefined && typeof input.isActive !== 'boolean') ||
      (input.notes !== undefined && typeof input.notes !== 'string'))) throw new Error('Invalid country language mappings');
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('localization:country-mappings'))");
      const changes: any[] = [];
      const saved: any[] = [];
      for (const input of inputs) {
        const previous = (await client.query('SELECT language_code FROM country_language_mappings WHERE country_code=$1 FOR UPDATE', [input.countryCode])).rows[0];
        const result = await client.query(
          `INSERT INTO country_language_mappings(id,country_code,country_name,language_code,is_active,notes)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(country_code) DO UPDATE SET
             country_name=EXCLUDED.country_name,language_code=EXCLUDED.language_code,is_active=EXCLUDED.is_active,notes=EXCLUDED.notes
           RETURNING *`,
          [randomBytes(12).toString('hex'), input.countryCode, input.countryName, input.languageCode, input.isActive ?? true, input.notes || ''],
        );
        saved.push(countryMapping(result.rows[0]));
        if (previous?.language_code !== input.languageCode) changes.push({
          countryCode: input.countryCode, countryName: input.countryName,
          previousLanguageCode: previous?.language_code ?? null, newLanguageCode: input.languageCode,
        });
      }
      if (changes.length) await this.writeMappingAudit(client, { action, actorEmail, deletedCount: changes.length, changes });
      return saved;
    });
  }

  async deleteCountryLanguageMappings(mode: 'all' | 'overrides' | 'country', defaults: Record<string, string>, actorEmail?: string, countryCode?: string): Promise<{ deletedCount: number; snapshot: any[] }> {
    if (mode === 'country' && !countryCode) throw new Error('countryCode is required to delete one mapping');
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('localization:country-mappings'))");
      const result = await client.query('SELECT * FROM country_language_mappings WHERE ($1::text IS NULL OR country_code=$1) FOR UPDATE', [mode === 'country' ? countryCode : null]);
      const snapshot = result.rows.map(countryMapping).filter((row) => mode !== 'overrides' || (defaults[row.countryCode] && defaults[row.countryCode] !== row.languageCode));
      const deleted = snapshot.length ? await client.query('DELETE FROM country_language_mappings WHERE id=ANY($1::text[])', [snapshot.map((row) => row._id)]) : { rowCount: 0 };
      const deletedCount = deleted.rowCount ?? 0;
      if (mode !== 'country' || deletedCount) await this.writeMappingAudit(client, {
        action: mode === 'all' ? 'reset-all' : mode === 'overrides' ? 'clear-overrides' : 'delete',
        actorEmail, deletedCount,
        snapshot: mode === 'country' ? [] : snapshot.map((row) => ({ countryCode: row.countryCode, countryName: row.countryName || row.countryCode, currentLanguageCode: row.languageCode, defaultLanguageCode: defaults[row.countryCode] ?? '' })),
        changes: snapshot.map((row) => ({ countryCode: row.countryCode, countryName: row.countryName || row.countryCode, previousLanguageCode: row.languageCode, newLanguageCode: null })),
      });
      return { deletedCount, snapshot };
    });
  }

  async listMappingAudit(filter: MappingAuditFilter, limit?: number, offset = 0): Promise<{ entries: any[]; total: number }> {
    const result = await this.pool.query(
      `WITH filtered AS (
         SELECT * FROM country_language_mapping_audit
         WHERE ($1::text IS NULL OR action=$1)
         AND ($2::text IS NULL OR strpos(lower(COALESCE(actor_email,'')),lower($2))>0)
         AND ($3::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(snapshot || changes) AS item
           WHERE strpos(lower(COALESCE(item->>'countryCode','')),lower($3))>0
              OR strpos(lower(COALESCE(item->>'countryName','')),lower($3))>0))
         AND ($4::timestamptz IS NULL OR created_at >= $4) AND ($5::timestamptz IS NULL OR created_at <= $5)
       ), page AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT $6 OFFSET $7)
       SELECT (SELECT count(*)::integer FROM filtered) AS total,
              COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS entries`,
      [filter.action && filter.action !== 'all' ? filter.action : null, filter.actorEmail || null, filter.country || null,
        filter.from ?? null, filter.to ?? null, limit === undefined ? null : Math.min(500, Math.max(1, Math.floor(limit))), Math.max(0, Math.floor(offset))],
    );
    return { entries: result.rows[0].entries.map(mappingAudit), total: result.rows[0].total };
  }

  async findMappingAudit(id: string): Promise<any | null> {
    const result = await this.pool.query('SELECT * FROM country_language_mapping_audit WHERE id=$1', [id]);
    return result.rows[0] ? mappingAudit(result.rows[0]) : null;
  }

  async getTranslationLanguages(enabledOnly = false): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT id AS "_id",code,name,is_enabled AS "isEnabled",is_default AS "isDefault",created_at AS "createdAt"
       FROM translation_languages WHERE ($1::boolean=false OR is_enabled=true) ORDER BY name`,
      [enabledOnly],
    );
    return result.rows;
  }
}

export const pgLocalization = (): PostgresLocalizationStore => new PostgresLocalizationStore(getPostgresPool());
