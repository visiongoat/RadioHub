import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blockedContacts,unblockContact} from '../src/data/blocked-contacts';
test('blocked directory bounds pages and does not expose the extra cursor row',async()=>{
 const rows=Array.from({length:51},(_,i)=>({_id:String(i).padStart(24,'0'),direct:true,station:i%2===0}));
 const page=await blockedContacts('owner','cursor',{query:async(sql:string,args:string[])=>{
  assert.deepEqual(args,['owner','cursor']);assert.match(sql,/user_id=\$1/g);assert.match(sql,/LIMIT 51/);return {rows};
 }});
 assert.equal(page.items.length,50);assert.equal(page.nextCursor,rows[49]._id);
 assert.equal((await blockedContacts('owner','',{query:async()=>({rows:[]})})).nextCursor,null);
});
test('unblock serializes direct-message permission changes and atomically removes only owner preferences',async()=>{
 const calls:{sql:string;args:any[]}[]=[];let released=false;
 const client={query:async(sql:string,args:any[]=[])=>{calls.push({sql,args});return {rows:[]};},release(){released=true;}};
 await unblockContact('owner','peer',{connect:async()=>client} as any);
 assert.equal(calls[0].sql,'BEGIN');assert.equal(calls.at(-1)?.sql,'COMMIT');assert.ok(released);
 const deletions=calls.filter(c=>c.sql.startsWith('DELETE'));
 assert.equal(deletions.length,2);
 for(const c of deletions){assert.match(c.sql,/WHERE user_id=\$1 AND blocked_user_id=\$2$/);assert.deepEqual(c.args,['owner','peer']);}
 assert.ok(calls.findIndex(c=>c.sql.includes('pg_advisory_xact_lock'))<calls.findIndex(c=>c.sql.startsWith('DELETE')));
});
test('partial unblock failure rolls back both scopes and releases connection',async()=>{
 const calls:string[]=[];let released=false;
 const client={query:async(sql:string)=>{calls.push(sql);if(sql.startsWith('DELETE FROM station_chat'))throw Error('offline');return {rows:[]};},release(){released=true;}};
 await assert.rejects(()=>unblockContact('owner','peer',{connect:async()=>client} as any),/offline/);
 assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.includes('COMMIT'));assert.ok(released);
});
