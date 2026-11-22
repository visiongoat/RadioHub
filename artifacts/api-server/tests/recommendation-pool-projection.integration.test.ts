import assert from 'node:assert/strict';
import {after,before,describe,it,mock} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createNativePostgresFixture,type NativePostgresFixture} from './helpers/native-postgres-fixture';
import {applyConcurrentIndexMigration,parseConcurrentIndexMigration} from '../scripts/postgres-concurrent-index.mjs';

// Observe the real SQL without replacing PostgreSQL or persisting cache entries.
mock.module('../src/public-station-cache',{namedExports:{publicStationCache:{getOrSetSingleFlight:async(_key:string,load:()=>Promise<unknown>)=>load()}}});
describe('bounded recommendation source projection and concurrent rank index',{skip:!process.env.PG_TEST_DATABASE_URL},()=>{
 let fixture:NativePostgresFixture;
 let getPool:typeof import('../src/services/recommendation-pool').getRecommendationPool;
 let runtime:typeof import('../src/postgres-runtime');
 const statements:Array<{text:string;values?:unknown[]}>=[];
 before(async()=>{
  fixture=await createNativePostgresFixture('recommendation_bound');
  runtime=await import('../src/postgres-runtime');
  const pool=runtime.getPostgresPool(),query=pool.query.bind(pool);
  mock.method(pool,'query',((input:any,...args:any[])=>{
   if(input?.text?.startsWith('WITH candidates'))statements.push(input);
   return (query as any)(input,...args);
  }) as any);
  getPool=(await import('../src/services/recommendation-pool')).getRecommendationPool;
  await fixture.pool.query(`INSERT INTO stations(id,station_uuid,name,slug,url,country,votes,click_count,is_list_visible,source)
   SELECT 'fixture-'||lpad(n::text,5,'0'),'uuid-'||n,'Fixture '||n,'fixture-'||n,'https://example.invalid/'||n,
    CASE WHEN n%3=0 THEN 'Türkiye' ELSE 'Germany' END,(n%400),n%7,true,
    jsonb_build_object('genre','jazz','localImagePath','fixture.webp','privateEditorial',repeat(md5(n::text),512))
   FROM generate_series(1,6000)n`);
  await fixture.pool.query(`UPDATE stations SET is_list_visible=false,visibility_expires_at=now()+interval '1 hour' WHERE id='fixture-05999';
   UPDATE stations SET is_list_visible=false,visibility_expires_at=now()-interval '1 hour' WHERE id='fixture-05998';
   INSERT INTO station_genres(station_id,genre_slug) SELECT id,'jazz' FROM stations WHERE right(id,1)='0';
   ANALYZE stations`);
 });
 after(async()=>{mock.restoreAll();await fixture?.close();});
 it('preserves exact filtered IDs, stable ties, health expiry and compact wire fields',async()=>{
  for(const scope of [{country:null,genres:[]},{country:'Türkiye',genres:[]},{country:'Germany',genres:['jazz']},{country:'No Such Country',genres:[]}]){
   const values:unknown[]=[];const conditions=['(s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))'];
   if(scope.country){values.push(scope.country.toLowerCase());conditions.push(`lower(s.country)=$${values.length}`);}
   if(scope.genres.length){values.push(scope.genres);conditions.push(`EXISTS(SELECT 1 FROM station_genres sg WHERE sg.station_id=s.id AND sg.genre_slug=ANY($${values.length}::text[]))`);}
   const expected=await fixture.pool.query(`SELECT s.id FROM stations s WHERE ${conditions.join(' AND ')} ORDER BY s.votes DESC NULLS LAST,s.click_count DESC NULLS LAST,s.id LIMIT 100`,values);
   const actual=await getPool(scope);
   assert.deepEqual(actual.stations.map(s=>s._id),expected.rows.map(s=>s.id));
   assert.equal(actual.total,expected.rowCount);
   assert.ok(!JSON.stringify(actual).includes('privateEditorial'));
   if(actual.total){assert.equal(actual.stations[0].genre,'jazz');assert.equal(actual.stations[0].localImagePath,'fixture.webp');}
  }
 });
 it('real EXPLAIN keeps source JSON outside the materialized 100-row candidate and uses the matching order index',async()=>{
  await getPool({country:null,genres:[]});const query=statements.at(-1)!;
  const result=await fixture.pool.query({text:'EXPLAIN(ANALYZE,VERBOSE,BUFFERS,FORMAT JSON) '+query.text,values:query.values});
  const plan=result.rows[0]['QUERY PLAN'][0].Plan;
  const nodes=(node:any):any[]=>[node,...(node.Plans||[]).flatMap(nodes)];
  const all=nodes(plan),candidate=all.find(n=>n['Subplan Name']==='CTE candidates');
  assert.ok(candidate,'materialized CTE stays a separate execution boundary');
  assert.equal(candidate['Node Type'],'Limit');assert.equal(candidate['Actual Rows'],100);
  assert.ok(nodes(candidate).every(n=>!n.Output?.some((value:string)=>value.includes('jsonb_build_object')||value.includes('source'))));
  assert.ok(nodes(candidate).some(n=>n['Index Name']==='stations_recommendation_order_idx'));
  assert.ok(nodes(candidate).every(n=>n['Node Type']!=='Sort'));
  assert.ok(all.some(n=>n.Output?.some((value:string)=>value.includes('jsonb_build_object'))));
 });
 it('an already built production order index is validated without rebuilding it',async()=>{
  const sql=await readFile(new URL('../../../lib/db/migrations/0072_recommendation_pool_order.sql',import.meta.url),'utf8');
  const spec=parseConcurrentIndexMigration(sql)!;
  const before=(await fixture.pool.query("SELECT oid::text oid FROM pg_class WHERE oid='stations_recommendation_order_idx'::regclass")).rows[0].oid;
  const client=await fixture.pool.connect();try{await applyConcurrentIndexMigration(client,spec);}finally{client.release();}
  const after=(await fixture.pool.query("SELECT oid::text oid FROM pg_class WHERE oid='stations_recommendation_order_idx'::regclass")).rows[0].oid;
  assert.equal(after,before);
 });
 it('never accepts or replaces a same-name index with different PostgreSQL null ordering',async()=>{
  await fixture.pool.query('DROP INDEX stations_recommendation_order_idx; CREATE INDEX stations_recommendation_order_idx ON stations(votes DESC,click_count DESC,id)');
  const sql=await readFile(new URL('../../../lib/db/migrations/0072_recommendation_pool_order.sql',import.meta.url),'utf8');
  const client=await fixture.pool.connect();
  try{await assert.rejects(applyConcurrentIndexMigration(client,parseConcurrentIndexMigration(sql)!),/unexpected definition/);}
  finally{client.release();}
  assert.match((await fixture.pool.query("SELECT pg_get_indexdef('stations_recommendation_order_idx'::regclass) definition")).rows[0].definition,/votes DESC, click_count DESC/);
 });
});
