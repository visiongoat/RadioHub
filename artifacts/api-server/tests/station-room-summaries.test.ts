import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {stationRoomSummaries,summaryStationIds} from '../src/services/station-room-summaries';
import {createNativePostgresFixture} from './helpers/native-postgres-fixture';
const station='a'.repeat(24),viewer='b'.repeat(24),peer='c'.repeat(24),privateUser='d'.repeat(24);
test('room summaries accept only six canonical IDs and never request history',async()=>{
 assert.deepEqual(summaryStationIds(`${station},${station}`),[station]);
 for(const input of ['',null,'../users','A'.repeat(24),Array.from({length:7},(_,i)=>i.toString(16).padStart(24,'0')).join(',')])assert.throws(()=>summaryStationIds(input));
 const calls:string[]=[];const result=await stationRoomSummaries([station],viewer,{query:async(sql:string)=>{calls.push(sql);return {rows:[{stationId:station,count:3,participants:[]}]};}});
 assert.equal(result.rooms[0].count,3);assert.ok(calls.every(sql=>!sql.includes('station_chat_messages')&&!/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)));
});
test('presence summaries deduplicate sessions, exclude expired leases and hide private or blocked photos',{skip:!process.env.PG_TEST_DATABASE_URL},async()=>{
 const f=await createNativePostgresFixture('room_summary');try{
 await f.insert('stations',{_id:station,station_uuid:randomUUID(),name:'Summary radio',url:'https://example.invalid/radio.mp3',slug:'summary-radio',isListVisible:true});
 for(const id of [viewer,peer,privateUser])await f.insert('users',{_id:id,username:id,fullName:id,email:id+'@example.invalid',isPublicProfile:id!==privateUser});
 await f.pool.query(`INSERT INTO station_chat_sessions(token_hash,station_id,user_id,identity_id,connected,expires_at) VALUES
 ('one',$1,$2,$2,true,now()+interval '30 seconds'),('two',$1,$2,$2,true,now()+interval '30 seconds'),
 ('private',$1,$3,$3,true,now()+interval '30 seconds'),('expired',$1,$4,$4,true,now()-interval '1 second')`,[station,peer,privateUser,viewer]);
 let result=await stationRoomSummaries([station],viewer,f.pool);assert.equal(result.rooms[0].count,2);assert.deepEqual(result.rooms[0].participants.map((p:any)=>p._id),[peer]);
 await f.pool.query('INSERT INTO direct_chat_blocks(user_id,blocked_user_id) VALUES($1,$2)',[viewer,peer]);
 result=await stationRoomSummaries([station],viewer,f.pool);assert.equal(result.rooms[0].participants.length,0);
 assert.equal(Number((await f.pool.query('SELECT count(*) n FROM station_chat_sessions')).rows[0].n),4);
 }finally{await f.close();}
});
