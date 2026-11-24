import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {messageContextSQL,messageContextRows} from '../src/data/chat-message-context';

test('context window has one scoped target, two independently bounded sides and deterministic tuple ordering',()=>{
 const eligible='m.scope=$1 AND m.deleted_at IS NULL AND NOT ($2=ANY(m.hidden_for))';
 const sql=messageContextSQL('direct_messages','SELECT m.* FROM direct_messages m',eligible,'$3');
 assert.equal(sql.split(eligible).length-1,3,'the anchor and both sides share eligibility');
 assert.match(sql,/m\.id=\$3/);assert.match(sql,/LIMIT 26/);assert.equal((sql.match(/LIMIT 25/g)||[]).length,2);
 assert.match(sql,/\(m.created_at,m.id\)<\(t.created_at,t.id\)/);assert.match(sql,/\(m.created_at,m.id\)>\(t.created_at,t.id\)/);
 assert.match(sql,/ORDER BY m.created_at ASC,m.id ASC$/);assert.match(sql,/count\(\*\)>25 FROM context_older/);
 const target='a'.repeat(24),rows=[{_id:target,content:'Target',_contextHasMore:true}];
 assert.deepEqual(messageContextRows(rows,target),{messages:[{_id:target,content:'Target'}],hasMore:true,targetFound:true});
 assert.equal(rows[0]._contextHasMore,true,'response shaping does not mutate shared rows');
 for(const invalid of [[],[{_id:'b'.repeat(24)}],[{_id:target,deletedAt:'2026-01-01'}]])assert.deepEqual(messageContextRows(invalid,target),{messages:[],hasMore:false,targetFound:false});
});

test('station notification context applies expiry, room/deletion/block filters to the anchor and neighbors, then hydrates only eligible rows',async()=>{
 let sql='',args:any[]=[];const target='a'.repeat(24),station='b'.repeat(24),actor='c'.repeat(24);let rows:any[]=[{_id:target,content:'Room target',_contextHasMore:false}];
 mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{getPostgresPool:()=>({query:async(statement:string,values:any[])=>{sql=statement;args=values;return {rows};}})}});
 mock.module(new URL('../src/services/station-chat-mentions.ts',import.meta.url).href,{namedExports:{hydrateRoomMentions:async(value:any[])=>value,notifyRoomMentions:async()=>{}}});
 const {roomPage}=await import('../src/services/station-live-chat');
 try{
  assert.deepEqual(await roomPage(station,actor,undefined,target),{messages:[{_id:target,content:'Room target'}],hasMore:false,targetFound:true});assert.deepEqual(args,[station,actor,target]);
  assert.equal((sql.match(/m.station_id=\$1/g)||[]).length,3);assert.equal((sql.match(/m.created_at>now\(\)-interval '24 hours'/g)||[]).length,3);assert.equal((sql.match(/m.deleted_at IS NULL/g)||[]).length,3);assert.equal((sql.match(/b.blocked_user_id=m.user_id/g)||[]).length,3);
  rows=[];assert.deepEqual(await roomPage(station,actor,undefined,target),{messages:[],hasMore:false,targetFound:false});
  const store=await import('../src/data/postgres-message-store');rows=[{id:target,content:'Direct target',_contextHasMore:true}];
  const direct=await store.pgConversationMessageContext(actor,station,target);assert.equal(direct.targetFound,true);assert.equal(direct.hasMore,true);assert.equal(direct.messages[0]._id,target);assert.equal(direct.messages[0]._contextHasMore,undefined);assert.deepEqual(args,[actor,station,target]);
  const directEligible=`((m.from_user_id=$1 AND m.to_user_id=$2) OR (m.from_user_id=$2 AND m.to_user_id=$1)) AND NOT ($1=ANY(m.hidden_for)) AND m.deleted_at IS NULL`;assert.equal(sql.split(directEligible).length-1,3);
  const notifications=await import('../src/data/postgres-notification-store');await notifications.pgMarkConversationNotificationsRead(actor,station,[target]);assert.deepEqual(args,[actor,station,[target]]);assert.match(sql,/data->>'messageId'=ANY\(\$3::text\[\]\)/);assert.match(sql,/m.is_read=true AND m.deleted_at IS NULL/);
  await notifications.pgMarkConversationNotificationsRead(actor,station);assert.deepEqual(args,[actor,station,null]);
 }finally{mock.restoreAll();}
});
