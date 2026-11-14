import assert from 'node:assert/strict';
import {before,after,beforeEach,mock,test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const connectionString=process.env.PG_TEST_DATABASE_URL;
const schema=`direct_safety_${randomBytes(8).toString('hex')}`;
let admin:pg.Pool,pool:pg.Pool,safety:typeof import('../src/data/direct-chat-safety'),store:typeof import('../src/data/postgres-message-store');
before(async()=>{
 if(!connectionString)return;
 const url=new URL(connectionString);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/radiohub_test');
 admin=new pg.Pool({connectionString,ssl:false});await admin.query(`CREATE SCHEMA "${schema}"`);
 pool=new pg.Pool({connectionString,ssl:false,max:4,options:`-c search_path=${schema}`,application_name:schema});
 await pool.query(`CREATE TABLE users(id text PRIMARY KEY);INSERT INTO users VALUES('a'),('b'),('c');
 CREATE TABLE direct_messages(id text PRIMARY KEY,from_user_id text,to_user_id text,content text,message_type text,image_url text,created_at timestamptz,reply_to_id text,deleted_at timestamptz);
 CREATE TABLE chat_inbox_state(user_id text,kind text,target_id text,deleted boolean,updated_at timestamptz);`);
 await pool.query(await readFile(new URL('../../../lib/db/migrations/0057_direct_chat_safety.sql',import.meta.url),'utf8'));
 mock.module(new URL('../src/postgres-runtime.ts',import.meta.url).href,{namedExports:{getPostgresPool:()=>pool}});
 mock.module(new URL('../src/data/postgres-user-store.ts',import.meta.url).href,{namedExports:{newPublicUserId:()=>randomBytes(12).toString('hex')}});
 safety=await import('../src/data/direct-chat-safety');store=await import('../src/data/postgres-message-store');
});
beforeEach(async()=>{if(pool)await pool.query('TRUNCATE direct_messages,direct_chat_blocks,direct_chat_reports');});
after(async()=>{await pool?.end();if(admin){await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}mock.restoreAll();});
test('block commit wins over a concurrent message awaiting the same pair lock',{skip:!connectionString},async()=>{
 const db=await pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await db.query('BEGIN');await safety.lockDirectPair(db,'a','b');await db.query("INSERT INTO direct_chat_blocks(user_id,blocked_user_id) VALUES('b','a')");
  pending=assert.rejects(store.pgCreateMessage({fromUserId:'a',toUserId:'b',content:'race',messageType:'text'}),{status:403});
  let waiting=false;
  for(let i=0;i<100;i++){
   const {rows}=await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'",[schema]);
   if(rows.length){waiting=true;break;}await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(waiting,true,'sender really waited for the uncommitted block');
  await db.query('COMMIT');await pending;
  assert.equal((await pool.query('SELECT count(*)::int n FROM direct_messages')).rows[0].n,0);
 }finally{await db.query('ROLLBACK');db.release();await pending;}
});
test('reverse blocking survives actor unblock; history is preserved',{skip:!connectionString},async()=>{
 await store.pgCreateMessage({fromUserId:'a',toUserId:'b',content:'old history',messageType:'text'});
 await safety.setDirectBlock('a','b',true);await safety.setDirectBlock('b','a',true);await safety.setDirectBlock('a','b',false);
 assert.deepEqual(await safety.directSafety('a','b'),{blocked:false,canContact:false});
 await assert.rejects(store.pgCreateMessage({fromUserId:'b',toUserId:'a',content:'denied',messageType:'text'}),{status:403});
 assert.equal((await pool.query('SELECT count(*)::int n FROM direct_messages')).rows[0].n,1);
 await safety.setDirectBlock('b','a',false);assert.equal((await safety.directSafety('a','b')).canContact,true);
});
test('report evidence includes only the last five received non-recalled messages and requires a conversation',{skip:!connectionString},async()=>{
 for(let i=0;i<8;i++)await store.pgCreateMessage({fromUserId:'b',toUserId:'a',content:`received-${i}`,messageType:'text',createdAt:new Date(1700000000000+i)});
 await store.pgCreateMessage({fromUserId:'a',toUserId:'b',content:'private outgoing',messageType:'text'});
 await pool.query("UPDATE direct_messages SET deleted_at=now() WHERE content='received-7'");
 assert.equal(await safety.reportDirectChat('a','c','harassment'),false);
 assert.equal(await safety.reportDirectChat('a','b','harassment'),true);
 const reports=(await pool.query('SELECT * FROM direct_chat_reports')).rows;
 assert.equal(reports.length,1);assert.equal(reports[0].status,'pending');
 assert.deepEqual(reports[0].message_snapshot.map((m:any)=>m.content),['received-6','received-5','received-4','received-3','received-2']);
});
