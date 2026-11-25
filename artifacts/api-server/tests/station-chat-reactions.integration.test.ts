import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {createNativePostgresFixture} from './helpers/native-postgres-fixture';

test('radio reactions persist, replace and clear under the room visibility rules', {skip:!process.env.PG_TEST_DATABASE_URL}, async()=>{
 const url=new URL(process.env.PG_TEST_DATABASE_URL!);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const f=await createNativePostgresFixture('station_reactions');
 let server:ReturnType<ReturnType<typeof express>['listen']>|undefined;
 const id=(n:number)=>n.toString(16).padStart(24,'0');
 const [author,a,b,station,otherStation,message]=[1,2,3,4,5,6].map(id);
 try{
  for(const user of [author,a,b])await f.insert('users',{_id:user,username:'reaction_'+user,fullName:'Listener '+user,email:user+'@example.invalid'});
  for(const radio of [station,otherStation])await f.insert('stations',{_id:radio,station_uuid:randomUUID(),name:'Fixture '+radio,slug:'fixture-'+radio,url:'https://example.invalid/radio'});
  await f.pool.query("INSERT INTO station_chat_messages(id,station_id,user_id,client_id,content) VALUES($1,$2,$3,$4,'Fixture message')",[message,station,author,randomUUID()]);
  const {setChatReaction}=await import('../src/data/chat-reactions');
  const {roomPage}=await import('../src/services/station-live-chat');
  const {registerStationChatRoutes}=await import('../src/routes/station-chat-routes');
  const app=express();
  app.use(express.json());
  registerStationChatRoutes(app,(req:any,_res,next)=>{req.user={id: a};next();},(_req,_res,next)=>next());
  server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server!.once('listening',resolve));
  const endpoint=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/station-chat/${station}/reaction`;
  const react=(emoji:unknown)=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:message,emoji})});
  const set=(actor:string,emoji:string|null,scope=station)=>setChatReaction(f.pool,'station',message,actor,emoji,scope);
  assert.equal((await react('invalid')).status,400);
  assert.equal((await react('👍')).status,404,'an account must have a current connected room session');
  for(const user of [a,b])await f.pool.query('INSERT INTO station_chat_sessions(token_hash,station_id,user_id,identity_id,connected) VALUES($1,$2,$3,$3,true)',[randomUUID(),station,user]);
  assert.equal(await set(a,'👍',otherStation),null);
  const listener=await f.pool.connect();
  try{
   await listener.query('LISTEN mega_station_chat');
   const received=new Promise<string|undefined>(resolve=>listener.once('notification',event=>resolve(event.payload)));
   const [response]=await Promise.all([react('👍'),set(b,'😮')]);
   assert.equal(response.status,200);
   const change=await response.json() as {messageId:string;reactionsRevision:number};
   assert.equal(change.messageId,message);
   assert.ok(change.reactionsRevision>0);
   assert.deepEqual(JSON.parse((await received)??''),{stationId:station,event:{type:'reaction',messageId:message}});
  }finally{await listener.query('UNLISTEN mega_station_chat');listener.release();}
  let [saved]=(await roomPage(station,a)).messages;
  assert.deepEqual(new Set(saved.reactions.map((r:{emoji:string})=>r.emoji)),new Set(['👍','😮']));
  assert.equal(saved.reactionsRevision,2);
  await set(a,'❤️');
  await set(a,null);
  [saved]=(await roomPage(station,a)).messages;
  assert.deepEqual(saved.reactions.map((r:{emoji:string})=>r.emoji),['😮']);
  assert.equal(saved.reactionsRevision,4);
  await f.pool.query('INSERT INTO station_chat_blocks(user_id,blocked_user_id) VALUES($1,$2)',[author,a]);
  assert.equal((await react('😂')).status,404);
  await f.pool.query("INSERT INTO station_chat_sanctions(user_id,expires_at,reason) VALUES($1,now()+interval '1 hour','test')",[b]);
  assert.equal(await set(b,'😂'),null);
  await f.pool.query('UPDATE station_chat_messages SET deleted_at=now() WHERE id=$1',[message]);
  assert.equal((await roomPage(station,b)).messages.length,0);

  const {pgListNotifications}=await import('../src/data/postgres-notification-store');
  for(const [i,type] of ['new_message','station_mention','follow','group_invitation'].entries())
   await f.insert('user_notifications',{_id:id(100+i),userId:a,fromUserId:author,type,title:'Fixture',message:'Fixture'});
  const messageNotice=await pgListNotifications(a,1,1,'messages');
  assert.equal(messageNotice.pagination.totalPages,2);
  assert.ok(['new_message','group_invitation'].includes(messageNotice.notifications[0].type));
  const mentions=await pgListNotifications(a,1,10,'mentions');
  assert.deepEqual(mentions.notifications.map((row:{type:string})=>row.type),['station_mention']);
  assert.equal(mentions.unreadCount,4,'the bell badge remains account-wide');
 }finally{
  if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  await f.close();
 }
});
