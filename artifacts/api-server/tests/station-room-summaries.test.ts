import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stationRoomSummaries,summaryStationIds} from '../src/services/station-room-summaries';
import {createNativePostgresFixture} from './helpers/native-postgres-fixture';
const station='a'.repeat(24),viewer='b'.repeat(24),peer='c'.repeat(24);
test('summary input is bounded to six canonical station IDs',()=>{
 assert.deepEqual(summaryStationIds(`${station},${station}`),[station]);
 for(const value of ['',null,'../users','A'.repeat(24),Array.from({length:7},(_,i)=>i.toString(16).padStart(24,'0')).join(',')])assert.throws(()=>summaryStationIds(value));
});
test('missing moderation pipeline never falls back to raw messages or joins a room',async()=>{
 const calls:string[]=[];const db={query:async(sql:string,args?:string[])=>{calls.push(sql);if(sql.includes('to_regclass'))return {rows:[{available:false}]};assert.deepEqual(args,[[station],viewer]);return {rows:[{stationId:station,count:2,participants:[{_id:peer}]}]};}};
 const data=await stationRoomSummaries([station],viewer,db);
 assert.equal(data.rooms[0].count,2);assert.deepEqual(data.rooms[0].messages,[]);
 assert.ok(calls.every(sql=>!sql.includes('station_chat_messages')));
 assert.ok(calls.every(sql=>!/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)));
});
test('public summary SQL counts distinct live leases and hides blocked/private identities', {skip:!process.env.PG_TEST_DATABASE_URL},async()=>{
 const f=await createNativePostgresFixture('room_summary');
 try{
  await f.insert('stations',{_id:station,name:'Summary radio',slug:'summary-radio',isListVisible:true});
  for(const id of [viewer,peer,'d'.repeat(24)])await f.insert('users',{_id:id,username:id,email:id+'@example.invalid',isPublicProfile:id!== 'd'.repeat(24)});
  await f.pool.query(`INSERT INTO station_chat_sessions(token_hash,station_id,user_id,identity_id,connected,expires_at) VALUES
   ('one',$1,$2,$2,true,now()+interval '30 seconds'),('duplicate',$1,$2,$2,true,now()+interval '30 seconds'),
   ('private',$1,$3,$3,true,now()+interval '30 seconds'),('expired',$1,$4,$4,true,now()-interval '1 second')`,[station,peer,'d'.repeat(24),viewer]);
  const before=Number((await f.pool.query('SELECT count(*) n FROM station_chat_sessions')).rows[0].n);
  let data=await stationRoomSummaries([station],viewer,f.pool);
  assert.equal(data.rooms[0].count,2);assert.deepEqual(data.rooms[0].participants.map((x:any)=>x._id),[peer]);
  await f.pool.query('INSERT INTO direct_chat_blocks(user_id,blocked_user_id) VALUES($1,$2)',[viewer,peer]);
  data=await stationRoomSummaries([station],viewer,f.pool);assert.equal(data.rooms[0].participants.length,0);
  await f.pool.query('CREATE TABLE station_chat_home_previews(message_id text PRIMARY KEY,decision text,reviewed_content text,display_name text)');
  await f.pool.query(`INSERT INTO station_chat_messages(id,station_id,user_id,client_id,content) VALUES
   ($1,$2,$3,'00000000-0000-4000-8000-000000000001','Safe hello'),($4,$2,$3,'00000000-0000-4000-8000-000000000002','Unreviewed text')`,['e'.repeat(24),station,peer,'f'.repeat(24)]);
  await f.pool.query("INSERT INTO station_chat_home_previews VALUES($1,'approved','Safe hello','Reviewed name')",['e'.repeat(24)]);
  const db={query:f.pool.query.bind(f.pool)};
  data=await stationRoomSummaries([station],viewer,db);assert.equal(data.rooms[0].messages.length,0,'blocked authors cannot appear in a preview');
  await f.pool.query('DELETE FROM direct_chat_blocks WHERE user_id=$1 AND blocked_user_id=$2',[viewer,peer]);
  data=await stationRoomSummaries([station],viewer,db);assert.deepEqual(data.rooms[0].messages.map((m:any)=>m.content),['Safe hello']);
  await f.pool.query('UPDATE station_chat_messages SET deleted_at=now() WHERE id=$1',['e'.repeat(24)]);
  data=await stationRoomSummaries([station],viewer,db);assert.equal(data.rooms[0].messages.length,0,'deleted approved text never falls back to unreviewed text');
  assert.equal(Number((await f.pool.query('SELECT count(*) n FROM station_chat_sessions')).rows[0].n),before,'previews never add presence');
 }finally{await f.close();}
});
