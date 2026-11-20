import {mock,test} from 'node:test';
import assert from 'node:assert/strict';
const queries:{sql:string;params:any[]}[]=[];
let due:any[]=[],response:any={data:{}};
mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{getPostgresPool:()=>({query:async(sql:string,params:any[]=[])=>{queries.push({sql,params});return {rows:sql.startsWith('WITH due')?due:[],rowCount:1};}})}});
mock.module(new URL('../src/services/expo-push-client.ts',import.meta.url).href,{namedExports:{expoPushRequest:async()=>response}});
const {recordPushTicket,drainPushReceipts}=await import('../src/services/push-receipts');
test('malformed tickets do not become accepted sends; valid tickets persist without message content',async()=>{
 assert.equal(await recordPushTicket({id:'device',token:'secret'},{}),false);
 assert.equal(await recordPushTicket({id:'device',token:'secret'},{status:'ok',id:'ticket'}),true);
 assert.deepEqual(queries.at(-1)?.params,['ticket','device']);
});
test('unregistered device is retired only when its token still matches',async()=>{
 await recordPushTicket({id:'device',token:'old-token'},{status:'error',details:{error:'DeviceNotRegistered'}});
 const update=queries.at(-1)!;assert.match(update.sql,/id=\$1 AND token=\$2/);assert.deepEqual(update.params,['device','old-token']);
});
test('receipt polling distinguishes provider acceptance from errors and protects refreshed devices',async()=>{
 due=[{ticket_id:'ok',push_token_id:'one'},{ticket_id:'bad',push_token_id:'two'},{ticket_id:'pending',push_token_id:'three'}];
 response={data:{ok:{status:'ok'},bad:{status:'error',details:{error:'DeviceNotRegistered'}}}};
 const start=queries.length;await drainPushReceipts();const next=queries.slice(start);
 assert.ok(next.some(q=>q.sql.includes('SKIP LOCKED')&&q.sql.includes('LIMIT 300')));
 assert.ok(next.some(q=>q.params[0]==='ok'&&q.params[1]==='provider_accepted'));
 assert.ok(next.some(q=>q.params[0]==='bad'&&q.params[1]==='error'));
 assert.ok(next.some(q=>q.sql.startsWith('UPDATE push_tokens')&&q.sql.includes('updated_at<=')));
 assert.ok(!next.some(q=>q.params[0]==='pending'));
});
