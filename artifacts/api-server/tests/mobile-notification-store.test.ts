import {mock,test} from 'node:test';
import assert from 'node:assert/strict';
const queries:{sql:string;params:any[]}[]=[];
mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{getPostgresPool:()=>({query:async(sql:string,params:any[])=>{
 queries.push({sql,params});
 if(sql.startsWith('INSERT INTO users'))return {rows:[{id:params[0],username:params[1],email:params[2],is_public_profile:params[10],source:{}}]};
 if(sql.includes('AS sender'))return {rows:[{id:'notice',user_id:'recipient',from_user_id:'sender',sender:{_id:'sender',fullName:'Sahin',avatar:'photo'},type:'follow',data:{}}]};
 if(sql.includes('GROUP BY type'))return {rows:[{type:'follow',count:'1',unread:'1'}]};
 return {rows:[],rowCount:2};
}})}});
const {pgCreateUser}=await import('../src/data/postgres-user-store');
const {pgListNotifications,pgDismissAllNotifications,pgMarkAllNotificationsRead}=await import('../src/data/postgres-notification-store');
test('new accounts are public by default; explicitly private signups stay private',async()=>{
 assert.equal((await pgCreateUser({username:'new',email:'new@example.invalid'})).isPublicProfile,true);
 assert.equal((await pgCreateUser({username:'private',email:'private@example.invalid',isPublicProfile:false})).isPublicProfile,false);
 assert.ok(queries.every(q=>!q.sql.startsWith('UPDATE users')),'no existing privacy choices are migrated');
});
test('notification response hydrates sender identity and photo for legacy follow payloads',async()=>{
 const page=await pgListNotifications('recipient',1,10);
 assert.equal(page.notifications[0].fromUserId.fullName,'Sahin');
 assert.equal(page.notifications[0].fromUserId.avatar,'photo');
 assert.equal(page.unreadCount,1);
 const read=queries.find(q=>q.sql.includes('AS sender'))!;
 assert.equal(read.params[0],'recipient');assert.match(read.sql,/LEFT JOIN users/);
});
test('bulk read and dismiss remain scoped to the current owner and keep messages untouched',async()=>{
 const start=queries.length;
 assert.equal(await pgMarkAllNotificationsRead('recipient'),2);
 assert.equal(await pgDismissAllNotifications('recipient'),2);
 for(const q of queries.slice(start)){
  assert.deepEqual(q.params,['recipient']);assert.match(q.sql,/WHERE user_id=\$1/);
  assert.match(q.sql,/UPDATE user_notifications/);assert.doesNotMatch(q.sql,/DELETE|UPDATE users|chat_messages/);
 }
});
