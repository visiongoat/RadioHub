import {mock,test} from 'node:test';
import assert from 'node:assert/strict';
let current:any, writes=0;
const queries:string[]=[];
const client={async query(sql:string,params:any[]=[]){queries.push(sql);if(sql.startsWith('SELECT id FROM users'))return {rowCount:1,rows:[{id:'fixture'}]};if(sql.startsWith('SELECT * FROM subscriptions'))return {rows:current?[current]:[]};if(sql.startsWith('INSERT INTO subscriptions')){writes++;assert.equal(JSON.parse(params[19]).appleSignedProof,undefined,'internal proof flag is not stored as entitlement data');}return {rowCount:1,rows:[]};},release(){}};
mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool:()=>({connect:async()=>client})}});
mock.module('../src/data/auth-token-store',{namedExports:{ensurePostgresUser:async()=>{}}});
const {pgUpsertSubscription}=await import('../src/data/postgres-billing-store');
const at=Date.now();
const signedPatch=(signedDate:number)=>({platform:'ios',plan:'remove_ads',originalTransactionId:'original',isActive:true,expiresAt:new Date(at+86400000),lastSignedDate:new Date(signedDate),appleSignedProof:true});
test('a newer refund/revoke discovered under the row lock cannot be undone by old signed proof',async()=>{
 current={plan:'none',platform:'ios',is_active:false,original_transaction_id:'original',cancelled_at:new Date(at),provider_data:{lastSignedDate:new Date(at).toISOString()}};writes=0;queries.length=0;
 await assert.rejects(pgUpsertSubscription('fixture',signedPatch(at-1000)),(error:any)=>error.code==='apple_stale_proof');
 await assert.rejects(pgUpsertSubscription('fixture',signedPatch(at)),(error:any)=>error.code==='apple_stale_proof');
 assert.equal(writes,0);assert.ok(queries.some(sql=>sql.includes('subscriptions WHERE user_id=$1 FOR UPDATE')));assert.ok(queries.includes('ROLLBACK'));
});
test('a newer active entitlement cannot be replaced by an older signed plan',async()=>{
 current={plan:'premium_yearly',platform:'ios',is_active:true,provider_data:{lastSignedDate:new Date(at).toISOString()}};writes=0;
 await assert.rejects(pgUpsertSubscription('fixture',signedPatch(at-1000)),(error:any)=>error.code==='apple_stale_proof');assert.equal(writes,0);
});
test('first verified grants, idempotent active restores and genuinely newer purchases remain possible',async()=>{
 writes=0;current=null;await pgUpsertSubscription('fixture',signedPatch(at));assert.equal(writes,1);
 current={plan:'remove_ads',platform:'ios',is_active:true,provider_data:{lastSignedDate:new Date(at).toISOString()}};await pgUpsertSubscription('fixture',signedPatch(at));assert.equal(writes,2);
 current={plan:'none',platform:'ios',is_active:false,cancelled_at:new Date(at),provider_data:{lastSignedDate:new Date(at).toISOString()}};await pgUpsertSubscription('fixture',signedPatch(at+1000));assert.equal(writes,3);
});
