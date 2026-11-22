import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyConcurrentIndexMigration, parseConcurrentIndexMigration } from '../scripts/postgres-concurrent-index.mjs';

const sql = readFileSync(new URL('../../../lib/db/migrations/0027_station_source_genre_search.sql', import.meta.url), 'utf8');
const spec = parseConcurrentIndexMigration(sql)!;
const definition = { valid: true, ready: true, correct_table: true, method: 'gin', unique: false, keys: 1,
  no_predicate: true, operator_class: 'gin_trgm_ops', expression: "lower((source ->> 'genre'::text))" };
function fixture(existing: any = null, created: any = definition, failure = false) {
  const calls: Array<{ sql: string; values?: any[] }> = [];
  return { calls, client: { async query(statement: string, values?: any[]) {
    calls.push({ sql: statement, values });
    if (statement.startsWith("SELECT current_setting")) return { rows: [{ value: '60s' }] };
    if (statement.startsWith('SELECT i.indisvalid')) return { rows: existing ? [existing] : [] };
    if (statement.startsWith('DROP INDEX')) existing = null;
    if (statement.startsWith('CREATE INDEX')) { if (failure) throw new Error('cancelled build'); existing = created; }
    return { rows: [] };
  } } };
}
test('reviewed station name fold index is accepted and definition-checked',async()=>{
 const sql=readFileSync(new URL('../../../lib/db/migrations/0052_station_search_key_index.sql',import.meta.url),'utf8');
 const nameSpec=parseConcurrentIndexMigration(sql)!;
 assert.equal(nameSpec.name,'stations_name_fold_trgm_idx');
 const def={...definition,expression:'station_search_key(name)'};
 const f=fixture(null,def);await applyConcurrentIndexMigration(f.client,nameSpec);
 assert.ok(f.calls.some(c=>c.sql.startsWith('CREATE INDEX CONCURRENTLY stations_name_fold')));
 await assert.rejects(applyConcurrentIndexMigration(fixture(definition).client,nameSpec),/unexpected definition/);
 assert.throws(()=>parseConcurrentIndexMigration(sql+'DROP TABLE stations;'),/Unsupported concurrent-index/);
});
test('only the exact reviewed single concurrent-index statement is accepted', () => {
  assert.equal(spec.name, 'stations_source_genre_trgm_idx');
  assert.equal(parseConcurrentIndexMigration('CREATE TABLE ordinary(id int);'), null);
  for (const candidate of [sql + 'DROP TABLE stations;', sql.replace('stations USING', 'users USING'),
    sql.replace('source->>', 'name->>'), sql.replace('CONCURRENTLY', 'CONCURRENTLY IF NOT EXISTS')]) {
    assert.throws(() => parseConcurrentIndexMigration(candidate), /Unsupported concurrent-index/);
  }
});
test('a successful prior build is reused when recording its checksum was interrupted', async () => {
  const f = fixture(definition); await applyConcurrentIndexMigration(f.client, spec);
  assert.ok(!f.calls.some(call => /^(CREATE|DROP)/.test(call.sql)));
  assert.deepEqual(f.calls.at(-1)?.values, ['60s']);
  assert.match(f.calls.find(call => call.sql.startsWith('SELECT i.indisvalid'))!.sql,
    /c\.relname=\$1 AND c\.relnamespace=\(SELECT relnamespace FROM pg_class WHERE oid=\$2::regclass\)/);
});
test('only a matching invalid owned index is dropped concurrently and rebuilt before completion', async () => {
  const f = fixture({ ...definition, valid: false, ready: false });
  await applyConcurrentIndexMigration(f.client, spec);
  assert.equal(f.calls.filter(call => call.sql.startsWith('DROP INDEX CONCURRENTLY')).length, 1);
  assert.equal(f.calls.filter(call => call.sql.startsWith('CREATE INDEX CONCURRENTLY')).length, 1);
  assert.equal(f.calls.filter(call => call.sql.startsWith('SELECT i.indisvalid')).length, 2);
  assert.ok(!f.calls.some(call => /^(BEGIN|COMMIT)/.test(call.sql)));
});
test('a same-name index with a different owner table, expression or operator class is never replaced', async () => {
  for (const change of [{ correct_table: false }, { expression: 'lower(name)' }, { operator_class: 'text_ops' },
    { no_predicate: false }, { method: 'btree' }, { unique: true }, { keys: 2 }]) {
    const f = fixture({ ...definition, ...change });
    await assert.rejects(applyConcurrentIndexMigration(f.client, spec), /unexpected definition/);
    assert.ok(!f.calls.some(call => /^(CREATE|DROP)/.test(call.sql)));
  }
});
test('invalid completion and cancellation fail closed and restore the bounded lock setting', async () => {
  for (const f of [fixture(null, { ...definition, valid: false }), fixture(null, definition, true)]) {
    await assert.rejects(applyConcurrentIndexMigration(f.client, spec), /not valid|cancelled build/);
    assert.deepEqual(f.calls.at(-1)?.values, ['60s']);
  }
});

const orderSql = readFileSync(new URL('../../../lib/db/migrations/0072_recommendation_pool_order.sql', import.meta.url), 'utf8');
const orderSpec = parseConcurrentIndexMigration(orderSql)!;
const orderDefinition = { valid:true,ready:true,correct_table:true,method:'btree',unique:false,keys:3,attributes:3,
  expression:null,no_predicate:true,key_options:[1,1,0],key_columns:['votes','click_count','id'],
  default_operator_classes:true,column_collations:true };
test('only the reviewed stable recommendation order can use the concurrent runner', () => {
  assert.equal(orderSpec.name,'stations_recommendation_order_idx');
  for(const sql of [orderSql.replace('votes DESC NULLS LAST','votes DESC'),
    orderSql.replace('click_count DESC','click_count ASC'),orderSql+'DROP TABLE stations;']) {
    assert.throws(()=>parseConcurrentIndexMigration(sql),/Unsupported concurrent-index/);
  }
});
test('recommendation order resumes a completed index and repairs only its matching invalid definition', async()=>{
  const existing=fixture(orderDefinition);await applyConcurrentIndexMigration(existing.client,orderSpec);
  assert.ok(!existing.calls.some(call=>/^(CREATE|DROP)/.test(call.sql)));
  const invalid=fixture({...orderDefinition,valid:false,ready:false},orderDefinition);
  await applyConcurrentIndexMigration(invalid.client,orderSpec);
  assert.equal(invalid.calls.filter(call=>call.sql.startsWith('DROP INDEX CONCURRENTLY')).length,1);
  assert.equal(invalid.calls.filter(call=>call.sql.startsWith('CREATE INDEX CONCURRENTLY')).length,1);
  assert.ok(!invalid.calls.some(call=>/^(BEGIN|COMMIT)/.test(call.sql)));
});
test('recommendation order refuses wrong null order, collation, included columns and wrong ownership', async()=>{
  for(const change of [{correct_table:false},{method:'gin'},{unique:true},{keys:2},{attributes:4},
    {expression:'lower(name)'},{no_predicate:false},{key_options:[3,1,0]},
    {key_columns:['votes','id','click_count']},{default_operator_classes:false},{column_collations:false}]){
    const f=fixture({...orderDefinition,...change});
    await assert.rejects(applyConcurrentIndexMigration(f.client,orderSpec),/unexpected definition/);
    assert.ok(!f.calls.some(call=>/^(CREATE|DROP)/.test(call.sql)));
  }
});
test('recommendation order cancellation never records success and restores the lock deadline',async()=>{
  const f=fixture(null,orderDefinition,true);
  await assert.rejects(applyConcurrentIndexMigration(f.client,orderSpec),/cancelled build/);
  assert.deepEqual(f.calls.at(-1)?.values,['60s']);
});
