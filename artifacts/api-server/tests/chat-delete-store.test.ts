import {mock,test} from 'node:test';
import assert from 'node:assert/strict';
const queries:{sql:string;args:any[]}[]=[];
mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{getPostgresPool:()=>({query:async(sql:string,args:any[])=>{queries.push({sql,args});return {rows:[{id:'message',from_user_id:'sender',to_user_id:'recipient',content:'',message_type:'text',deleted_at:new Date('2026-11-09T12:00:00Z'),hidden_for:['recipient']}],rowCount:1};}})}});
mock.module(new URL('../src/data/postgres-user-store.ts',import.meta.url).href,{namedExports:{newPublicUserId:()=> 'unused'}});
const store=await import('../src/data/postgres-message-store');
test('everyone deletion is sender-guarded, idempotent, clears payload and never exposes hidden viewers',async()=>{const message=await store.pgDeleteChatMessage('sender','message','everyone');const q=queries.at(-1)!;assert.match(q.sql,/WHERE id=\$1 AND from_user_id=\$2/);assert.match(q.sql,/content='',image_url=NULL/);assert.match(q.sql,/COALESCE\(deleted_at,now\(\)\)/);assert.deepEqual(q.args,['message','sender']);assert.equal('hiddenFor' in message,false);});
test('personal hiding only appends a participant and leaves the other participant content intact',async()=>{await store.pgDeleteChatMessage('recipient','message','self');const q=queries.at(-1)!;assert.match(q.sql,/from_user_id=\$2 OR to_user_id=\$2/);assert.match(q.sql,/CASE WHEN \$2=ANY\(hidden_for\)/);assert.doesNotMatch(q.sql,/SET content/);});
test('thread, inbox and unread queries exclude personally hidden rows; unread excludes shared tombstones',async()=>{await store.pgConversationMessages('recipient','sender',undefined,51);assert.match(queries.at(-1)!.sql,/NOT \(\$1=ANY\(hidden_for\)\)/);await store.pgUnreadMessageCount('recipient');assert.match(queries.at(-1)!.sql,/deleted_at IS NULL AND NOT \(\$1=ANY\(hidden_for\)\)/);await store.pgConversations('recipient');assert.match(queries.at(-1)!.sql,/NOT \(\$1=ANY\(hidden_for\)\)/);});

test('pin query is participant guarded and cannot pin hidden or deleted content',async()=>{
 await store.pgPinChatMessage('recipient','message',true);const q=queries.at(-1)!;
 assert.match(q.sql,/from_user_id=\$2 OR to_user_id=\$2/);assert.match(q.sql,/deleted_at IS NULL/);assert.match(q.sql,/NOT \(\$2=ANY\(hidden_for\)\)/);assert.deepEqual(q.args,['message','recipient',true]);
 await store.pgPinnedChatMessages('recipient','sender');assert.match(queries.at(-1)!.sql,/pinned_at IS NOT NULL AND deleted_at IS NULL/);
});
test('reply pages resolve original content without storing stale quote snapshots',async()=>{
 await store.pgConversationMessages('recipient','sender',undefined,51);const q=queries.at(-1)!;
 assert.match(q.sql,/r.id=m.reply_to_id/);assert.match(q.sql,/CASE WHEN r.deleted_at IS NULL THEN r.content ELSE '' END/);assert.match(q.sql,/NOT \(\$1=ANY\(r.hidden_for\)\)/);
});

test('recall deadline is atomic and uses database time rather than the client clock',async()=>{await store.pgDeleteChatMessage('sender','message','everyone');assert.match(queries.at(-1)!.sql,/created_at>statement_timestamp\(\)-interval '48 hours'/);await store.pgDeleteChatMessage('recipient','message','self');assert.doesNotMatch(queries.at(-1)!.sql,/48 hours/);});
