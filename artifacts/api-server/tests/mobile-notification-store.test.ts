import {mock,test} from 'node:test';
import assert from 'node:assert/strict';
const queries:{sql:string;params:any[]}[]=[];
const query=async(sql:string,params:any[])=>{
 queries.push({sql,params});
 if(sql.startsWith('INSERT INTO users'))return {rows:[{id:params[0],username:params[1],email:params[2],is_public_profile:params[10],source:{}}]};
 if(sql.includes('AS sender'))return {rows:[{id:'notice',user_id:'recipient',from_user_id:'sender',sender:{_id:'sender',fullName:'Sahin',avatar:'photo'},type:'follow',data:{}}]};
 if(sql.includes('GROUP BY type'))return {rows:[
   {type:'follow',count:'1',unread:'1',desktop_count:'1',desktop_unread:'1'},
   {type:'system',count:'2',unread:'2',desktop_count:'1',desktop_unread:'1'},
   {type:'favorite_station',count:'1',unread:'1',desktop_count:'1',desktop_unread:'1'},
 ]};
 return {rows:[],rowCount:sql.startsWith('UPDATE user_notifications') ? 2 : 0};
};
mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{
 getPostgresPool:()=>({query,connect:async()=>({query,release:()=>{}})}),
}});
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
 assert.equal(page.unreadCount,4);
 const read=queries.find(q=>q.sql.includes('AS sender'))!;
 assert.equal(read.params[0],'recipient');assert.match(read.sql,/LEFT JOIN users/);
});
test('bulk read and dismiss remain scoped to the current owner and keep messages untouched',async()=>{
 const start=queries.length;
 assert.equal(await pgMarkAllNotificationsRead('recipient'),2);
 assert.equal(await pgDismissAllNotifications('recipient'),2);
 assert.deepEqual(queries[start].params,['recipient',null,false]);
 assert.deepEqual(queries[start+1].params,['recipient']);
 for(const q of queries.slice(start)){
  assert.match(q.sql,/WHERE user_id=\$1/);
  assert.match(q.sql,/UPDATE user_notifications/);assert.doesNotMatch(q.sql,/DELETE|UPDATE users|chat_messages/);
 }
});

test('desktop feed, unread badge and bulk read skip legacy favorite notices',async()=>{
 const start=queries.length;
 const feed=await pgListNotifications('recipient',1,30,'desktop');
 assert.equal(feed.desktopScoped,true);
 assert.equal(feed.unreadCount,2);
 assert.equal(feed.pagination.total,2);
 assert.equal(feed.categoryCounts.desktop,2);
 await pgMarkAllNotificationsRead('recipient','desktop');
 const [list, totals, update]=queries.slice(start);
 assert.equal(list.params[4],true);
 assert.equal(update.params[2],true);
 assert.ok(!list.params[3].includes('favorite_station'));
 for(const q of [list,totals,update])assert.match(q.sql,/Station Removed from Favorites/);
});
