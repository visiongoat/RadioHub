// This is deliberately not a general non-transactional SQL runner. Only the
// reviewed catalogue-index grammars below can opt out of BEGIN/COMMIT.
export function parseConcurrentIndexMigration(sql) {
  if (!sql.startsWith('-- radiohub:concurrent-index\n') && !sql.startsWith('-- radiohub:concurrent-index\r\n')) return null;
  const statement = sql.replace(/^--[^\r\n]*(?:\r?\n|$)/gm, '').trim();
  const match = /^CREATE INDEX CONCURRENTLY (stations_source_genre_trgm_idx) ON (stations) USING gin \(\(lower\(source->>'genre'\)\) gin_trgm_ops\);$/.exec(statement);
  if (!match) {
    if (statement === 'CREATE INDEX CONCURRENTLY stations_name_fold_trgm_idx ON stations USING gin (station_search_key(name) gin_trgm_ops);')
      return {name:'stations_name_fold_trgm_idx',table:'stations',statement};
    if (statement === 'CREATE INDEX CONCURRENTLY stations_recommendation_order_idx ON stations USING btree (votes DESC NULLS LAST, click_count DESC NULLS LAST, id);')
      return {name:'stations_recommendation_order_idx',table:'stations',statement};
    throw new Error('Unsupported concurrent-index migration: expected a reviewed catalog expression index');
  }
  return { name: match[1], table: match[2], statement };
}

async function inspectIndex(client, spec) {
  const result = await client.query(`SELECT i.indisvalid AS valid,i.indisready AS ready,
    i.indrelid=$2::regclass AS correct_table,am.amname AS method,i.indisunique AS unique,
    i.indnkeyatts AS keys,pg_get_expr(i.indexprs,i.indrelid) AS expression,
    i.indpred IS NULL AS no_predicate,opc.opcname AS operator_class,
    i.indnatts AS attributes,i.indoption::smallint[] AS key_options,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,position)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.position) AS key_columns,
    NOT EXISTS(SELECT 1 FROM unnest(i.indclass::oid[]) oc(oid)
      JOIN pg_opclass p ON p.oid=oc.oid WHERE NOT p.opcdefault) AS default_operator_classes,
    NOT EXISTS(SELECT 1 FROM generate_series(0,i.indnatts-1) k
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[k]
      WHERE i.indcollation[k]<>a.attcollation) AS column_collations
    FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
    JOIN pg_am am ON am.oid=c.relam JOIN pg_opclass opc ON opc.oid=i.indclass[0]
    WHERE c.relname=$1 AND c.relnamespace=(SELECT relnamespace FROM pg_class WHERE oid=$2::regclass)`, [spec.name, spec.table]);
  const row = result.rows[0];
  if (!row) return null;
  if (spec.name === 'stations_recommendation_order_idx') {
    if (!row.correct_table || row.method !== 'btree' || row.unique || row.keys !== 3 || row.attributes !== 3
      || !row.no_predicate || row.expression !== null || !row.default_operator_classes || !row.column_collations
      || JSON.stringify(row.key_columns) !== JSON.stringify(['votes','click_count','id'])
      || JSON.stringify(row.key_options) !== JSON.stringify([1,1,0])) {
      throw new Error(`Existing concurrent index ${spec.name} has an unexpected definition; refusing to replace it`);
    }
    return row;
  }
  if (!row.correct_table || row.method !== 'gin' || row.unique || row.keys !== 1 || !row.no_predicate
    || row.operator_class !== 'gin_trgm_ops' || row.expression !== (spec.name === 'stations_name_fold_trgm_idx' ? 'station_search_key(name)' : "lower((source ->> 'genre'::text))")) {
    throw new Error(`Existing concurrent index ${spec.name} has an unexpected definition; refusing to replace it`);
  }
  return row;
}

/** Caller holds the schema advisory lock on this very connection. */
export async function applyConcurrentIndexMigration(client, spec) {
  const previous = await client.query("SELECT current_setting('lock_timeout') AS value");
  // Fail promptly if another writer/DDL cannot yield. CREATE INDEX CONCURRENTLY
  // does not block ordinary DML; the migrator's bounded statement timeout still
  // covers the complete operation and the old deployment can continue serving.
  await client.query("SELECT set_config('lock_timeout','5000',false)");
  try {
    const existing = await inspectIndex(client, spec);
    if (existing?.valid && existing.ready) return;
    if (existing) {
      // A cancelled concurrent build can leave an invalid index behind. Repair
      // only this exact owned definition; never mark an invalid index complete.
      await client.query(`DROP INDEX CONCURRENTLY ${spec.name}`);
    }
    await client.query(spec.statement);
    const completed = await inspectIndex(client, spec);
    if (!completed?.valid || !completed.ready) throw new Error(`Concurrent index ${spec.name} is not valid and ready`);
  } finally {
    await client.query("SELECT set_config('lock_timeout',$1,false)", [previous.rows[0].value]);
  }
}
