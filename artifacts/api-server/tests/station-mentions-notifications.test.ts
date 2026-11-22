import {mock,test} from 'node:test';
import assert from 'node:assert/strict';
const queries:{sql:string;params:any[]}[]=[], notifications:any[]=[],pushes:any[]=[],events:any[]=[];
let targets:any[]=[{id:'recipient'}],viewing=false;
const db={query:async(sql:string,params:any[]=[])=>{
 queries.push({sql,params});
 if(sql.startsWith('SELECT u.id'))return {rows:targets};
 if(sql.startsWith('SELECT name FROM stations'))return {rows:[{name:'Metro FM'}]};
 if(sql.startsWith('SELECT 1 FROM station_chat_sessions'))return {rowCount:viewing?1:0,rows:[]};
 if(sql.startsWith('SELECT id AS'))return {rows:[{_id:'recipient',username:'user_123',fullName:'Yasin'}]};
 return {rows:[],rowCount:1};
}};
mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{getPostgresPool:()=>db}});
mock.module(new URL('../src/data/postgres-notification-store.ts',import.meta.url).href,{namedExports:{pgCreateNotification:async(input:any)=>{notifications.push(input);}}});
mock.module(new URL('../src/cache.ts',import.meta.url).href,{defaultExport:{clearByPattern:async()=>{}}});
mock.module(new URL('../src/services/pushNotificationService.ts',import.meta.url).href,{namedExports:{PushNotificationService:{sendToUserAllChannels:async(...args:any[])=>{pushes.push(args);}}}});
mock.module(new URL('../src/services/chat-service.ts',import.meta.url).href,{namedExports:{chatService:{sendToUser:(...args:any[])=>events.push(args)}}});
const {mentionedUsernames,hydrateRoomMentions,notifyRoomMentions}=await import('../src/services/station-chat-mentions');
test('mentions are bounded, deduplicated and exclude email substrings',()=>{
 assert.deepEqual(mentionedUsernames('mail@example.com @user_123 @USER_123 @çağrı'),['user_123','çağrı']);
 assert.equal(mentionedUsernames(Array.from({length:30},(_,i)=>'@person'+i).join(' ')).length,8);
 assert.deepEqual(mentionedUsernames('x'.repeat(400)+' @hidden'),[]);
});
test('stored mentions retain a human identity after the person leaves the loaded page',async()=>{
 const result=await hydrateRoomMentions([{stationId:'metro',content:'Hi @user_123'}]);
 assert.equal(result[0].mentions[0].fullName,'Yasin');
 const query=queries.at(-1)!;
 assert.match(query.sql,/EXISTS.*station_chat_messages/);
 assert.deepEqual(query.params[1],['metro']);
});
test('background recipient gets a stored notification and correct room push; visible room suppresses only push',async()=>{
 const message={_id:'message',userId:'sender',stationId:'metro',content:'Hi @user_123',sender:{fullName:'Sahin',avatar:'avatar'}};
 await notifyRoomMentions(message);
 assert.equal(notifications.length,1);assert.equal(pushes.length,1);
 assert.equal(notifications[0].fromUserId,'sender');
 assert.equal(pushes[0][1].data.type,'station_mention');
 assert.equal(pushes[0][1].data.stationId,'metro');
 assert.match(pushes[0][1].body,/Sahin.*Metro FM/);
 const sql=queries.find(q=>q.sql.startsWith('SELECT u.id'))!.sql;
 assert.match(sql,/u.id<>\$2/);assert.match(sql,/station_chat_blocks/);assert.match(sql,/direct_chat_blocks/);
 viewing=true;await notifyRoomMentions({...message,_id:'second'});
 assert.equal(notifications.length,2);assert.equal(pushes.length,1);
 targets=[];await notifyRoomMentions({...message,_id:'third'});assert.equal(notifications.length,2);
 await notifyRoomMentions({...message,messageType:'gif'});assert.equal(notifications.length,2);
});
test('a GIF caption retains the text mention identity and notification without treating the provider slug as text',async()=>{
 const message={_id:'caption-message',stationId:'metro',userId:'sender',messageType:'gif',content:'klipy:wave',caption:'Hi @user_123',sender:{fullName:'Sahin'}};
 const hydrated=await hydrateRoomMentions([message]);
 assert.equal(hydrated[0].mentions[0].fullName,'Yasin');
 targets=[{id:'recipient'}];viewing=false;
 const previous=notifications.length;
 await notifyRoomMentions(message);
 assert.equal(notifications.length,previous+1);
 assert.equal(pushes.at(-1)[1].data.messageId,'caption-message');
});
