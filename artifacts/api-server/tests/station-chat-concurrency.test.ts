import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createNativePostgresFixture} from './helpers/native-postgres-fixture';

test('concurrent distinct senders persist without loss of acknowledgements and retention converges', {skip:!process.env.PG_TEST_DATABASE_URL}, async()=>{
 const f=await createNativePostgresFixture('room_concurrent');
 try {
  const station='a'.repeat(24), users=240;
  await f.insert('stations',{_id:station,station_uuid:randomUUID(),name:'Concurrent room',slug:'concurrent-room',url:'https://example.invalid/live.mp3'});
  await f.pool.query(`INSERT INTO users(id,username,full_name,email) SELECT lpad(i::text,24,'0'),'load_'||i,'Load user '||i,'load_'||i||'@example.invalid' FROM generate_series(1,$1) i`,[users]);
  await f.pool.query(`INSERT INTO station_chat_sessions(token_hash,station_id,user_id,identity_id,connected,expires_at) SELECT 'load_'||id,$1,id,id,true,now()+interval '5 minutes' FROM users`,[station]);
  const {sendRoomMessage}=await import('../src/services/station-live-chat');
  const times:number[]=[], started=performance.now();
  const replies=await Promise.all(Array.from({length:users},async(_,i)=>{
   const began=performance.now();
   const message=await sendRoomMessage(station,String(i+1).padStart(24,'0'),{clientId:randomUUID(),content:'Hello from listener '+i});
   times.push(performance.now()-began);return message;
  }));
  assert.equal(new Set(replies.map(m=>m._id)).size,users);
  // One subsequent write finishes retention after overlapping transactions settle.
  await f.pool.query(`UPDATE station_chat_messages SET created_at=now()-interval '10 seconds'`);
  await sendRoomMessage(station,'1'.padStart(24,'0'),{clientId:randomUUID(),content:'Latest listener update'});
  const retained=Number((await f.pool.query('SELECT count(*) n FROM station_chat_messages WHERE station_id=$1',[station])).rows[0].n);
  assert.equal(retained,200);
  times.sort((a,b)=>a-b);
  console.log(JSON.stringify({realPostgresSenders:users,acknowledgements:replies.length,retained,
    elapsedMs:Math.round(performance.now()-started),p95Ms:Math.round(times[Math.floor(times.length*.95)])}));
 }finally{await f.close();}
});
