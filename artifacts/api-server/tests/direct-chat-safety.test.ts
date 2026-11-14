import {mock,test} from 'node:test';import assert from 'node:assert/strict';
const calls:{sql:string;args:any[]}[]=[];let blocked=false;
const client={query:async(sql:string,args:any[]=[])=>{calls.push({sql,args});if(sql.includes('SELECT EXISTS'))return{rows:[{blocked,can_contact:!blocked}]};if(sql.startsWith('INSERT INTO direct_chat_blocks'))blocked=true;if(sql.startsWith('DELETE FROM direct_chat_blocks'))blocked=false;return{rows:[]};},release(){}};
mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{getPostgresPool:()=>({...client,connect:async()=>client})}});
mock.module(new URL('../src/data/postgres-user-store.ts',import.meta.url).href,{namedExports:{newPublicUserId:()=> 'report-id'}});
const safety=await import('../src/data/direct-chat-safety');
test('block and unblock serialize with message writes and affect only actor-owned preference',async()=>{
 calls.length=0;assert.deepEqual(await safety.setDirectBlock('b','a',true),{blocked:true,canContact:false});
 assert.deepEqual(calls.filter(c=>c.sql.includes('pg_advisory_xact_lock')).map(c=>c.args),[['a:direct:b'],['b:direct:a']]);
 assert.ok(calls.findIndex(c=>c.sql.includes('pg_advisory_xact_lock'))<calls.findIndex(c=>c.sql.startsWith('INSERT')));
 await safety.setDirectBlock('b','a',false);const deletion=calls.find(c=>c.sql.startsWith('DELETE'))!;assert.deepEqual(deletion.args,['b','a']);assert.match(deletion.sql,/user_id=\$1 AND blocked_user_id=\$2/);
});
test('blocked transaction cannot perform an operation, and rolls back/releases',async()=>{
 blocked=true;calls.length=0;let ran=false;await assert.rejects(safety.withAllowedDirectPair('a','b',async()=>{ran=true;}),{status:403});assert.equal(ran,false);assert.equal(calls.at(-1)?.sql,'ROLLBACK');blocked=false;
});
test('reports are scoped to an existing conversation and only last five received, undeleted messages',async()=>{
 calls.length=0;await safety.reportDirectChat('a','b','harassment');const query=calls[0];assert.match(query.sql,/from_user_id=\$3 AND to_user_id=\$2 AND deleted_at IS NULL/);assert.match(query.sql,/LIMIT 5/);assert.match(query.sql,/WHERE EXISTS/);assert.deepEqual(query.args,['report-id','a','b','harassment']);
});
