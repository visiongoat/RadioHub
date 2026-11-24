import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {createNativePostgresFixture} from './helpers/native-postgres-fixture';

// Opt-in local disposable PostgreSQL only; never a production URL/implicit env.
test('real SQL notification windows preserve scope, hidden/deleted/cutoff rules, ties, and unseen group read state',{skip:!process.env.PG_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.PG_TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const f=await createNativePostgresFixture('message_context');let server:ReturnType<typeof express.prototype.listen>|undefined;
 const id=(n:number)=>n.toString(16).padStart(24,'0'),owner=id(1),peer=id(2),other=id(3),group=id(4),station=id(5),foreign=id(6);
 try{
  for(const user of [owner,peer,other])await f.insert('users',{_id:user,username:'ctx_'+user,fullName:'Context fixture',email:user+'@example.invalid'});
  await f.insert('stations',{_id:station,station_uuid:randomUUID(),name:'Context fixture radio',slug:'context-fixture',url:'https://example.invalid/radio'});
  const stamp=new Date(Date.now()-3600000),joined=new Date(stamp.getTime()-3600000);
  for(let n=0;n<80;n++)await f.pool.query("INSERT INTO direct_messages(id,from_user_id,to_user_id,content,message_type,created_at) VALUES($1,$2,$3,$4,'text',$5)",[id(1000+n),peer,owner,'Direct '+n,stamp]);
  const store=await import('../src/data/postgres-message-store');
  let page=await store.pgConversationMessageContext(owner,peer,id(1040));assert.equal(page.targetFound,true);assert.equal(page.messages.length,51);assert.equal(page.hasMore,true);assert.equal(page.messages[25]._id,id(1040));assert.equal(new Set(page.messages.map(m=>m._id)).size,51);
  assert.deepEqual(page.messages.map(m=>m._id),Array.from({length:51},(_,n)=>id(1015+n)),'same-time messages use the stable ID tie-break');
  assert.equal((await store.pgConversationMessageContext(owner,other,id(1040))).targetFound,false);
  await f.pool.query('UPDATE direct_messages SET hidden_for=ARRAY[$2] WHERE id=$1',[id(1040),owner]);assert.deepEqual((await store.pgConversationMessageContext(owner,peer,id(1040))).messages,[]);
  await f.pool.query('UPDATE direct_messages SET hidden_for=ARRAY[]::text[],deleted_at=now() WHERE id=$1',[id(1040)]);assert.equal((await store.pgConversationMessageContext(owner,peer,id(1040))).targetFound,false);
  await f.pool.query('UPDATE direct_messages SET deleted_at=NULL WHERE id=$1',[id(1040)]);
  for(const n of [1040,1079])await f.insert('user_notifications',{_id:id(8000+n),userId:owner,fromUserId:peer,type:'new_message',title:'Fixture',message:'Fixture',data:{messageId:id(n)}});
  await store.pgMarkMessagesRead(owner,peer,[id(1040)]);const notices=await import('../src/data/postgres-notification-store');await notices.pgMarkConversationNotificationsRead(owner,peer,[id(1040)]);
  assert.equal((await f.pool.query("SELECT is_read FROM user_notifications WHERE data->>'messageId'=$1",[id(1040)])).rows[0].is_read,true);assert.equal((await f.pool.query("SELECT is_read FROM user_notifications WHERE data->>'messageId'=$1",[id(1079)])).rows[0].is_read,false);

  await f.pool.query('INSERT INTO chat_groups(id,name,created_by) VALUES($1,$2,$3)',[group,'Context fixture',owner]);
  await f.pool.query("INSERT INTO chat_group_members(group_id,user_id,role,status,joined_at,read_at) VALUES($1,$2,'admin','active',$3,$3)",[group,owner,joined]);
  for(let n=0;n<80;n++)await f.pool.query("INSERT INTO chat_group_messages(id,group_id,from_user_id,content,created_at) VALUES($1,$2,$3,$4,$5)",[id(2000+n),group,peer,'Group '+n,stamp]);
  for(const n of [2040,2079])await f.insert('user_notifications',{_id:id(9000+n),userId:owner,fromUserId:peer,type:'new_message',title:'Fixture',message:'Fixture',data:{groupId:group,messageId:id(n)}});
  const {registerChatGroupRoutes}=await import('../src/routes/chat-group-routes');
  const app=express();registerChatGroupRoutes(app,((req:any,_res:any,next:any)=>{req.session={user:{userId:String(req.headers['x-fixture-user']||owner)}};next();}));server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));const base=`http://127.0.0.1:${(server.address()as any).port}/api/messages/groups/${group}/messages`;
  const get=async(target:string,user=owner)=>{const response=await fetch(base+'?aroundMessageId='+target,{headers:{'x-fixture-user':user}});return {status:response.status,body:await response.json()as any};};
  let response=await get(id(2040));assert.equal(response.status,200);assert.equal(response.body.targetFound,true);assert.equal(response.body.messages.length,51);assert.equal(response.body.messages[25]._id,id(2040));
  assert.equal((await f.pool.query('SELECT read_at FROM chat_group_members WHERE group_id=$1 AND user_id=$2',[group,owner])).rows[0].read_at.getTime(),stamp.getTime());
  assert.equal((await f.pool.query("SELECT is_read FROM user_notifications WHERE data->>'messageId'=$1",[id(2079)])).rows[0].is_read,false);
  assert.equal((await get(id(2040),other)).status,404);
  await f.pool.query('UPDATE chat_group_messages SET hidden_for=ARRAY[$2] WHERE id=$1',[id(2040),owner]);assert.equal((await get(id(2040))).body.targetFound,false);
  await f.pool.query('UPDATE chat_group_messages SET hidden_for=ARRAY[]::text[],deleted_at=now() WHERE id=$1',[id(2040)]);assert.equal((await get(id(2040))).body.targetFound,false);
  await f.pool.query('UPDATE chat_group_messages SET deleted_at=NULL,created_at=$2 WHERE id=$1',[id(2040),new Date(joined.getTime()-1)]);assert.equal((await get(id(2040))).body.targetFound,false);
  await f.pool.query('UPDATE chat_group_messages SET created_at=$2 WHERE id=$1',[id(2040),stamp]);await f.pool.query("UPDATE chat_group_members SET status='left',left_at=$3 WHERE group_id=$1 AND user_id=$2",[group,owner,new Date(stamp.getTime()-1)]);assert.equal((await get(id(2040))).body.targetFound,false);

  for(let n=0;n<80;n++)await f.pool.query("INSERT INTO station_chat_messages(id,station_id,user_id,content,message_type,created_at,client_id) VALUES($1,$2,$3,$4,'text',$5,$6)",[id(3000+n),station,peer,'Room '+n,stamp,randomUUID()]);
  const {roomPage}=await import('../src/services/station-live-chat');let room=await roomPage(station,owner,undefined,id(3040));assert.equal(room.targetFound,true);assert.equal(room.messages.length,51);assert.equal(room.messages[25]._id,id(3040));
  assert.equal((await roomPage(foreign,owner,undefined,id(3040))).targetFound,false);
  await f.pool.query('UPDATE station_chat_messages SET deleted_at=now() WHERE id=$1',[id(3040)]);assert.equal((await roomPage(station,owner,undefined,id(3040))).targetFound,false);
  await f.pool.query('UPDATE station_chat_messages SET deleted_at=NULL,created_at=now()-interval \'25 hours\' WHERE id=$1',[id(3040)]);assert.equal((await roomPage(station,owner,undefined,id(3040))).targetFound,false);
  await f.pool.query('UPDATE station_chat_messages SET created_at=$2 WHERE id=$1',[id(3040),stamp]);await f.pool.query('INSERT INTO station_chat_blocks(user_id,blocked_user_id) VALUES($1,$2)',[owner,peer]);assert.equal((await roomPage(station,owner,undefined,id(3040))).targetFound,false);
 }finally{if(server)await new Promise<void>(resolve=>{server!.close(()=>resolve());server!.closeAllConnections();});await f.close();mock.restoreAll();}
});
