import {test,mock,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
const actor='507f1f77bcf86cd799439011',peer='507f1f77bcf86cd799439012',group='507f1f77bcf86cd799439020';
let messageRow:any=null;
let foundStation:any=null,listedMembers:any[]=[];
let status='active',eligible=true,allow=true,actorRole='admin',createdBy=actor,targetActive=true;const queries:{sql:string;args:any[]}[]=[],events:any[]=[];
const db={release(){},async query(sql:string,args:any[]=[]){queries.push({sql,args});let rows:any[]=[];
 if(sql.includes('FOR UPDATE OF g,m'))rows=allow?[{id:group,name:'Test group',genres:['jazz','rock'],role:actorRole,created_by:createdBy,status,left_at:status==='left'?'2026-11-10T10:00:00Z':null,joined_at:'2026-11-09T12:00:00Z'}]:[];
 else if(sql.includes('AS user,m.role,m.status'))rows=listedMembers;
 else if(sql.startsWith('SELECT * FROM chat_group_messages WHERE id=$1'))rows=messageRow&&messageRow.id===args[0]&&messageRow.group_id===args[1]&&Date.parse(messageRow.created_at)>=Date.parse(args[2])&&!messageRow.hidden_for.includes(args[3])?[messageRow]:[];
 else if(sql.startsWith('UPDATE chat_group_messages SET hidden_for=')){messageRow.hidden_for.push(args[1]);}
 else if(sql.startsWith('UPDATE chat_group_messages SET deleted_at=')){messageRow.deleted_at=new Date().toISOString();messageRow.content='';messageRow.image_url=null;messageRow.pinned_at=null;rows=[{id:messageRow.id}];}
 else if(sql.startsWith('UPDATE chat_group_messages SET pinned_at=')){messageRow.pinned_at=args[1]?new Date().toISOString():null;}
 else if(sql.includes('UPDATE chat_group_members SET role=$3'))rows=targetActive?[{user_id:peer}]:[];
 else if(sql.includes('SELECT u.id FROM users'))rows=eligible?[{id:peer}]:[];
 else if(sql.includes('SELECT user_id FROM chat_group_members'))rows=[{user_id:actor},{user_id:peer}];
 else if(sql.includes('AS sender FROM chat_group_messages'))rows=[messageRow?{_id:messageRow.id,fromUserId:messageRow.from_user_id,content:messageRow.content,pinnedAt:messageRow.pinned_at,pinUpdatedAt:new Date().toISOString()}: { _id:'message',fromUserId:actor,content:'Hello'}];
 return {rows,rowCount:rows.length};}};
mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{getPostgresPool:()=>({connect:async()=>db})}});
mock.module(new URL('../src/data/postgres-user-store.ts',import.meta.url).href,{namedExports:{newPublicUserId:()=>group}});
mock.module(new URL('../src/services/chat-service.ts',import.meta.url).href,{namedExports:{chatService:{broadcastToUsers:(ids:any,event:any)=>events.push({ids,event})}}});
mock.module(new URL('../src/data/station-read-store.ts',import.meta.url).href,{namedExports:{getPublicStationByIdentifier:async()=>foundStation}});
mock.module(new URL('../src/utils/logger.ts',import.meta.url).href,{namedExports:{logger:{error(){}}}});
mock.module(new URL('../src/services/pushNotificationService.ts',import.meta.url).href,{namedExports:{PushNotificationService:{sendToUserAllChannels:async()=>false}}});
mock.module('express-rate-limit',{namedExports:{rateLimit:()=>((_req:any,_res:any,next:any)=>next())}});
mock.module(new URL('../src/services/group-music-catalog.ts',import.meta.url).href,{namedExports:{getCachedGroupMusicGenres:async()=>[{slug:'blues'},{slug:'classic-rock'},{slug:'arabesk'},{slug:'folk-music'}]}});
const {registerChatGroupRoutes,groupInput}=await import('../src/routes/chat-group-routes');
const app=express();app.use(express.json());registerChatGroupRoutes(app,((req:any,_res:any,next:any)=>{req.session={user:{userId:actor}};next();}));
const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}/api/messages/groups`;
after(()=>server.close());
const post=(path:string,body:any)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('group input deduplicates contacts and rejects empty names, own ID and arbitrary images',()=>{
 assert.equal(groupInput({name:' Jazz ',memberIds:[peer,peer]},actor).memberIds.length,1);
 for(const body of [{name:'',memberIds:[peer]},{name:'Jazz',memberIds:[actor]},{name:'Jazz',memberIds:[peer],avatar:'https://untrusted.test/photo'}])assert.throws(()=>groupInput(body,actor));
});
test('group music styles are optional, deduplicated, allow-listed and limited to three',()=>{
 assert.deepEqual(groupInput({name:'Jazz',memberIds:[peer]},actor).genres,[]);
 assert.deepEqual(groupInput({name:'Jazz',memberIds:[peer],genres:['jazz','rock','jazz']},actor).genres,['jazz','rock']);
 for(const genres of [null,'jazz',['unknown'],['pop','rock','jazz','folk'],[42]])assert.throws(()=>groupInput({name:'Jazz',memberIds:[peer],genres},actor));
});
test('group creation only invites related users; creator becomes active administrator',async()=>{
 eligible=false;assert.equal((await post('',{name:'Jazz',memberIds:[peer]})).status,403);
 eligible=true;assert.equal((await post('',{name:'Jazz',memberIds:[peer],genres:['jazz','rock']})).status,200);
 assert.deepEqual(queries.find(q=>q.sql.startsWith('INSERT INTO chat_groups'))?.args[4],['jazz','rock']);
 assert.ok(queries.some(q=>q.sql.includes("'admin','active'")));assert.ok(queries.some(q=>q.sql.includes('unnest($2::text[])')));assert.equal(events.at(-1).event.type,'group:updated');
});
test('group details expose stored music styles and list query includes them',async()=>{
 const response=await fetch(base+'/'+group);assert.equal(response.status,200);
 assert.deepEqual((await response.json()).group.genres,['jazz','rock']);
 await fetch(base);assert.ok(queries.some(q=>q.sql.includes('g.name,g.avatar,g.genres')));
});
test('invitations cannot read or send group history; acceptance starts at current time',async()=>{
 status='invited';assert.equal((await fetch(base+'/'+group+'/messages')).status,404);
 assert.equal((await post('/'+group+'/messages',{content:'No',messageType:'text'})).status,404);
 assert.equal((await post('/'+group+'/respond',{accept:true})).status,200);
 assert.ok(queries.some(q=>q.sql.includes('joined_at=now(),read_at=now()')));status='active';
});
test('nonmembers cannot read group details or send; messages reject external media URLs',async()=>{
 allow=false;assert.equal((await fetch(base+'/'+group)).status,404);allow=true;
 assert.equal((await post('/'+group+'/messages',{content:'image',messageType:'image',imageUrl:'https://untrusted.test/a.jpg'})).status,400);
 assert.equal((await post('/'+group+'/messages',{content:'Hello',messageType:'text'})).status,200);
 assert.deepEqual(events.at(-1).ids,[actor,peer]);
});
test('history query enforces join cutoff and group-scoped cursor',async()=>{
 await fetch(base+'/'+group+'/messages');const q=queries.find(q=>q.sql.includes('m.created_at>=$2'))!;assert.ok(q);assert.match(q.sql,/WHERE id=\$3 AND group_id=\$1/);
});

test('only active administrators can grant roles or change group photos',async()=>{
 actorRole='member';
 assert.equal((await post('/'+group+'/role',{userId:peer,role:'admin'})).status,403);
 assert.equal((await post('/'+group+'/photo',{avatar:'/uploads/chat/test.jpg'})).status,403);
 actorRole='admin';status='invited';
 assert.equal((await post('/'+group+'/role',{userId:peer,role:'admin'})).status,404);status='active';
});
test('admin can promote/demote active members, but cannot demote the creator or alter self',async()=>{
 assert.equal((await post('/'+group+'/role',{userId:peer,role:'admin'})).status,200);
 assert.equal((await post('/'+group+'/role',{userId:peer,role:'member'})).status,200);
 assert.equal(events.at(-1).event.type,'group:updated');
 assert.equal((await post('/'+group+'/role',{userId:actor,role:'member'})).status,400);
 createdBy=peer;assert.equal((await post('/'+group+'/role',{userId:peer,role:'member'})).status,403);createdBy=actor;
 targetActive=false;assert.equal((await post('/'+group+'/role',{userId:peer,role:'admin'})).status,404);targetActive=true;
 const updates=queries.filter(q=>q.sql.includes('UPDATE chat_group_members SET role=$3'));assert.ok(updates.every(q=>q.sql.includes("status='active'")));
});
test('group photo changes accept validated upload paths or removal, reject external URLs',async()=>{
 const response=await post('/'+group+'/photo',{avatar:'/uploads/chat/test.jpg'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal((await post('/'+group+'/photo',{avatar:null})).status,200);
 for(const avatar of ['https://untrusted.test/a.jpg','/uploads/chat/../private.jpg',42,undefined])assert.equal((await post('/'+group+'/photo',{avatar})).status,400);
 assert.ok(queries.some(q=>q.sql==='UPDATE chat_groups SET avatar=$2 WHERE id=$1'&&q.args[1]===null));
});

test('only active admins can update the group genres and invalid genres are rejected',async()=>{
 actorRole='member';assert.equal((await post('/'+group+'/genres',{genres:['jazz']})).status,403);
 actorRole='admin';assert.equal((await post('/'+group+'/genres',{genres:['unknown']})).status,400);
 assert.equal((await post('/'+group+'/genres',{genres:['jazz','rock']})).status,200);
 assert.equal((await post('/'+group+'/genres',{genres:['blues','classic-rock']})).status,200);
 assert.equal((await post('/'+group+'/genres',{genres:['blues','classic-rock','pop','jazz']})).status,400);
 assert.ok(queries.some(q=>q.sql.startsWith('UPDATE chat_groups SET genres=')&&q.args[1].join(',')==='jazz,rock'));
});

test('only active group members publish canonical expiring listening presence',async()=>{
 allow=true;status='invited';assert.equal((await post('/'+group+'/listening',{clientId:'device-123',revision:1,listening:true,stationId:peer})).status,404);
 status='active';foundStation={_id:peer,name:'Canonical radio',favicon:'https://example.com/logo.png'};listedMembers=[{user:{_id:actor},status:'active',role:'admin'},{user:{_id:peer},status:'invited',role:'member'}];
 assert.equal((await post('/'+group+'/listening',{clientId:'device-123',revision:2,listening:true,stationId:peer,name:'Spoofed radio'})).status,200);
 const info=await (await fetch(base+'/'+group)).json();assert.equal(info.group.members[0].listening.name,'Canonical radio');assert.equal(info.group.members[1].listening,undefined);
 assert.equal((await post('/'+group+'/listening',{clientId:'device-123',revision:3,listening:false})).status,200);
 const stopped=await (await fetch(base+'/'+group)).json();assert.equal(stopped.group.members[0].listening,undefined);
 allow=false;assert.equal((await post('/'+group+'/listening',{clientId:'device-123',revision:4,listening:true,stationId:peer})).status,404);allow=true;
});

const actionId='507f1f77bcf86cd799439030';
const resetMessage=()=>{allow=true;status='active';actorRole='member';messageRow={id:actionId,group_id:group,from_user_id:actor,content:'Hello',created_at:new Date(Date.now()-60000).toISOString(),hidden_for:[],deleted_at:null,pinned_at:null};};
test('group message deletion uses personal hiding and sender-only everyone deletion',async()=>{
 resetMessage();messageRow.from_user_id=peer;assert.equal((await post('/'+group+'/delete',{messageId:actionId,scope:'everyone'})).status,403);
 const eventCount=events.length;assert.equal((await post('/'+group+'/delete',{messageId:actionId,scope:'self'})).status,200);assert.deepEqual(messageRow.hidden_for,[actor]);assert.ok(events.slice(eventCount).every(event=>event.ids.length===1&&event.ids[0]===actor),'personal deletion is not sent to peers');
 resetMessage();assert.equal((await post('/'+group+'/delete',{messageId:actionId,scope:'everyone'})).status,200);assert.ok(messageRow.deleted_at);assert.equal(messageRow.content,'');assert.equal(messageRow.pinned_at,null);
});
test('group recall expires after 48 hours but personal hiding remains available',async()=>{
 resetMessage();messageRow.created_at=new Date(Date.now()-48*60*60*1000-1).toISOString();const before=events.length;
 assert.equal((await post('/'+group+'/delete',{messageId:actionId,scope:'everyone'})).status,409);assert.equal(events.length,before);assert.equal(messageRow.content,'Hello');
 assert.equal((await post('/'+group+'/delete',{messageId:actionId,scope:'self'})).status,200);
 resetMessage();await post('/'+group+'/delete',{messageId:actionId,scope:'everyone'});assert.match(queries.findLast(q=>q.sql.startsWith('UPDATE chat_group_messages SET deleted_at='))!.sql,/created_at>statement_timestamp\(\)-interval '48 hours'/);
});
test('reply, pin and delete cannot target another group, hidden messages or pre-join history',async()=>{
 for(const change of [{group_id:peer},{created_at:'2020-01-01T00:00:00Z'},{hidden_for:[actor]}]){
  resetMessage();Object.assign(messageRow,change);assert.equal((await post('/'+group+'/delete',{messageId:actionId,scope:'self'})).status,404);assert.equal((await post('/'+group+'/pin',{messageId:actionId,pinned:true})).status,404);assert.equal((await post('/'+group+'/messages',{content:'Reply',replyToId:actionId})).status,404);
 }
 resetMessage();messageRow.deleted_at=new Date().toISOString();assert.equal((await post('/'+group+'/pin',{messageId:actionId,pinned:true})).status,400);assert.equal((await post('/'+group+'/messages',{content:'Reply',replyToId:actionId})).status,400);
 resetMessage();status='invited';assert.equal((await post('/'+group+'/pin',{messageId:actionId,pinned:true})).status,404);status='active';allow=false;assert.equal((await post('/'+group+'/delete',{messageId:actionId,scope:'self'})).status,404);allow=true;
});
test('visible group replies persist target and pin/unpin returns the updated message',async()=>{
 resetMessage();assert.equal((await post('/'+group+'/messages',{content:'Reply',replyToId:actionId})).status,200);assert.ok(queries.some(query=>query.sql.includes('INSERT INTO chat_group_messages')&&query.args[6]===actionId));
 assert.equal((await post('/'+group+'/pin',{messageId:actionId,pinned:true})).status,200);assert.ok(messageRow.pinned_at);assert.equal((await post('/'+group+'/pin',{messageId:actionId,pinned:false})).status,200);assert.equal(messageRow.pinned_at,null);
 const response=await fetch(base+'/'+group+'/messages');assert.equal(response.status,200);const query=queries.findLast(query=>query.sql.includes('m.pinned_at IS NOT NULL'));assert.ok(query?.sql.includes('NOT ($3=ANY(m.hidden_for))'));assert.ok(query?.sql.includes('m.created_at>=$2'));
});

test('left members retain only pre-departure history and cannot send or alter group settings',async()=>{
 status='left';queries.length=0;assert.equal((await fetch(base+'/'+group+'/messages')).status,200);
 const page=queries.find(q=>q.sql.includes('($5::timestamptz IS NULL'))!;assert.match(page.sql,/m.created_at<=\$5/);assert.equal(page.args[4],'2026-11-10T10:00:00Z');
 assert.equal((await post('/'+group+'/messages',{content:'Not allowed',messageType:'text'})).status,404);
 assert.equal((await post('/'+group+'/photo',{avatar:null})).status,404);status='active';
});
test('leaving timestamps departure and transfers administration without deleting history',async()=>{
 queries.length=0;actorRole='admin';assert.equal((await post('/'+group+'/leave',{})).status,200);
 assert.ok(queries.some(q=>q.sql.includes("SET status='left',left_at=now()")));assert.ok(queries.some(q=>q.sql.includes("SET role='admin'")));
 assert.ok(!queries.some(q=>q.sql.includes('DELETE FROM chat_group_messages')));
});

test('group creation accepts the full picker catalog beyond home navigation genres',async()=>{
 const response=await post('',{name:'Arabeskin Kralı ❤️🌹',memberIds:[peer],genres:['folk','arabesk','folk-music']});
 assert.equal(response.status,200);
 assert.deepEqual(queries.filter(q=>q.sql.startsWith('INSERT INTO chat_groups')).at(-1)?.args[4],['folk','arabesk','folk-music']);
 const rejected=await post('',{name:'Example',memberIds:[peer],genres:['not-a-catalog-genre']});
 assert.equal(rejected.status,400);assert.equal((await rejected.json()).code,'GROUP_GENRES_INVALID');
});
