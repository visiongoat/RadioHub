import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
const base=new URL('../../../lib/db/migrations/',import.meta.url);
const migration=await readFile(new URL('0070_tv_usage_heartbeats.sql',base),'utf8');
test('heartbeat storage migration preserves the original closed event list and counters',()=>{
 assert.match(migration,/ALTER TABLE tv_diagnostic_daily ADD CONSTRAINT tv_diagnostic_daily_event_check/);
 assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE|client_id|duration_seconds/i);
 for(const name of ['activity_heartbeat','listening_heartbeat','playback_start','playback_pause','app_open'])assert.ok(migration.includes("'"+name+"'"));
});
test('real PostgreSQL constraints accept both heartbeats after upgrade, retain existing counts and still reject unknown events', {skip:!process.env.RADIOHUB_PGLITE_ENTRY},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.RADIOHUB_PGLITE_ENTRY!).href);const db=await PGlite.create();
 const insert=(event:string)=>db.query(`INSERT INTO tv_diagnostic_daily(platform,app_version,bundle_version,event,code,route,module) VALUES ('tizen','2.2.104','local-abcdef1',$1,'none','discover','main')`,[event]);
 try{
  await db.exec(await readFile(new URL('0046_tv_diagnostic_daily.sql',base),'utf8'));
  await insert('app_open');
  await assert.rejects(()=>insert('activity_heartbeat'),(e:any)=>e.code==='23514');
  await db.exec(migration);await db.exec(migration);
  await insert('activity_heartbeat');await insert('listening_heartbeat');
  assert.deepEqual((await db.query('SELECT event,count FROM tv_diagnostic_daily ORDER BY event')).rows,[{event:'activity_heartbeat',count:1},{event:'app_open',count:1},{event:'listening_heartbeat',count:1}]);
  await assert.rejects(()=>insert('invented_event'),(e:any)=>e.code==='23514');
 }finally{await db.close();}
});
