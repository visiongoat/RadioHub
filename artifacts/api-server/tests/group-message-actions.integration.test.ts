import {after,before,describe,it,mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
const connectionString=process.env.PG_TEST_DATABASE_URL;
let pool:pg.Pool;
mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{getPostgresPool:()=>pool}});
mock.module(new URL('../src/data/postgres-user-store.ts',import.meta.url).href,{namedExports:{newPublicUserId:()=>randomBytes(12).toString('hex')}});
mock.module(new URL('../src/data/station-read-store.ts',import.meta.url).href,{namedExports:{getPublicStationByIdentifier:async()=>null}});
mock.module(new URL('../src/services/chat-service.ts',import.meta.url).href,{namedExports:{chatService:{broadcastToUsers(){}}}});
mock.module(new URL('../src/services/pushNotificationService.ts',import.meta.url).href,{namedExports:{PushNotificationService:{sendToUserAllChannels:async()=>false}}});
mock.module(new URL('../src/utils/logger.ts',import.meta.url).href,{namedExports:{logger:{error(){}}}});
mock.module('express-rate-limit',{namedExports:{rateLimit:()=>((_req:any,_res:any,next:any)=>next())}});
const {registerChatGroupRoutes}=await import('../src/routes/chat-group-routes');
describe('group message actions on isolated local PostgreSQL',{skip:!connectionString},()=>{
 const owner='507f1f77bcf86cd799439011',peer='507f1f77bcf86cd799439012',group='507f1f77bcf86cd799439020',otherGroup='507f1f77bcf86cd799439021';
 const schema=`group_actions_${process.pid}_${randomBytes(4).toString('hex')}`;
 let admin:pg.Pool,server:ReturnType<typeof express.prototype.listen>,base:string;
 before(async()=>{
  const url=new URL(connectionString!);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'integration fixtures require a local test database');
  admin=new pg.Pool({connectionString});await admin.query(`CREATE SCHEMA "${schema}"`);url.searchParams.set('options',`-c search_path=${schema},public`);pool=new pg.Pool({connectionString:url.toString()});
  await pool.query("CREATE TABLE users(id text PRIMARY KEY,full_name text,username text,avatar text,source jsonb DEFAULT '{}')");
  await pool.query('CREATE TABLE direct_messages(id text PRIMARY KEY)');
  for(const file of ['0046_chat_groups.sql','0047_chat_group_music_styles.sql','0048_chat_group_message_actions.sql','0049_chat_inbox_actions.sql','0053_chat_message_reactions.sql'])await pool.query(await readFile(new URL('../../../lib/db/migrations/'+file,import.meta.url),'utf8'));
  await pool.query("INSERT INTO users(id,full_name) VALUES($1,'Owner'),($2,'Peer')",[owner,peer]);
  await pool.query("INSERT INTO chat_groups(id,name,created_by) VALUES($1,'Group',$3),($2,'Other',$3)",[group,otherGroup,owner]);
  await pool.query("INSERT INTO chat_group_members(group_id,user_id,status,joined_at) VALUES($1,$2,'active','2026-01-01'),($1,$3,'active','2026-01-01')",[group,owner,peer]);
  const app=express();app.use(express.json());registerChatGroupRoutes(app,((req:any,_res:any,next:any)=>{req.session={user:{userId:req.headers['x-test-user']||owner}};next();}));server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}/api/messages/groups/${group}`;
 });
 after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool?.end();if(admin){await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}});
 const post=async(path:string,body:any,user=owner)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-test-user':user},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};};
 const history=async(user=owner)=>await (await fetch(base+'/messages',{headers:{'x-test-user':user}})).json() as any;
 it('persists concurrent reactions and rejects hidden or deleted messages',async()=>{
  const sent=await post('/messages',{content:'Reaction integration'});assert.equal(sent.status,200);const messageId=sent.body.message._id;
  const updates=await Promise.all([post('/react',{messageId,emoji:'❤️'}),post('/react',{messageId,emoji:'👍'},peer)]);
  assert.ok(updates.every(result=>result.status===200));
  let saved=(await history()).messages.find((message:any)=>message._id===messageId);
  assert.equal(saved.reactions.length,2);assert.equal(saved.reactionsRevision,2);
  const changed=await post('/react',{messageId,emoji:'😂'});assert.equal(changed.status,200);assert.equal(changed.body.message.reactions.length,2);
  assert.equal(changed.body.message.reactions.find((item:any)=>item.userId===owner).emoji,'😂');
  const removed=await post('/react',{messageId,emoji:null});assert.equal(removed.status,200);assert.deepEqual(removed.body.message.reactions.map((item:any)=>item.userId),[peer]);
  assert.equal((await post('/delete',{messageId,scope:'self'},peer)).status,200);assert.equal((await post('/react',{messageId,emoji:'❤️'},peer)).status,404);
  assert.equal((await post('/delete',{messageId,scope:'everyone'})).status,200);assert.equal((await post('/react',{messageId,emoji:'❤️'})).status,404);
 });
 it('persists replies and pins, hides personally, redacts everyone and enforces group/join boundaries',async()=>{
  const sent=await post('/messages',{content:'Original'});assert.equal(sent.status,200);const id=sent.body.message._id;
  const reply=await post('/messages',{content:'Reply',replyToId:id},peer);assert.equal(reply.status,200);assert.equal(reply.body.message.replyTo.content,'Original');
  assert.equal((await post('/pin',{messageId:id,pinned:true},peer)).status,200);assert.equal((await history()).pinnedMessages[0]._id,id);
  assert.equal((await post('/delete',{messageId:id,scope:'everyone'},peer)).status,403);
  assert.equal((await post('/delete',{messageId:id,scope:'self'},peer)).status,200);const personal=await history(peer);assert.ok(!personal.messages.some((message:any)=>message._id===id));assert.equal(personal.pinnedMessages.length,0);assert.equal(personal.messages[0].replyTo,null);assert.equal((await history()).messages[0].content,'Original');
  assert.equal((await post('/delete',{messageId:id,scope:'everyone'})).status,200);const shared=await history();assert.equal(shared.messages[0].content,'');assert.ok(shared.messages[0].deletedAt);assert.equal(shared.pinnedMessages.length,0);assert.equal(shared.messages[1].replyTo.content,'');assert.ok(shared.messages[1].replyTo.deletedAt);
  assert.equal((await post('/delete',{messageId:reply.body.message._id,scope:'everyone'},peer)).status,200);const inbox=await (await fetch(base.replace('/'+group,''))).json() as any;assert.equal(inbox.groups[0].lastMessageDeleted,true);assert.equal(inbox.groups[0].lastMessage,'');
  const old='507f1f77bcf86cd799439031',foreign='507f1f77bcf86cd799439032';await pool.query("INSERT INTO chat_group_messages(id,group_id,from_user_id,content,created_at) VALUES($1,$3,$5,'Old','2025-01-01'),($2,$4,$5,'Foreign',now())",[old,foreign,group,otherGroup,owner]);
  for(const messageId of [old,foreign]){assert.equal((await post('/pin',{messageId,pinned:true})).status,404);assert.equal((await post('/delete',{messageId,scope:'self'})).status,404);assert.equal((await post('/messages',{content:'Invalid reply',replyToId:messageId})).status,404);}
 });
});
