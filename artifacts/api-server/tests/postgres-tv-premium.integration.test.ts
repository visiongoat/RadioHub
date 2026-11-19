import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {after,before,describe,it,mock} from 'node:test';
import pg from 'pg';
const connectionString=process.env.PG_TEST_DATABASE_URL;
describe('native TV Premium entitlement confirmation',{skip:!connectionString},async()=>{
 if(!connectionString)return;
 const schema=`tv_premium_${process.pid}_${randomBytes(6).toString('hex')}`;
 const admin=new pg.Pool({connectionString,ssl:false});
 const url=new URL(connectionString);url.searchParams.set('options',`-c search_path=${schema},public`);
 const pool=new pg.Pool({connectionString:url.toString(),ssl:false});
 mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool:()=>pool}});
 const {confirmTvPremiumEntitlement}=await import('../src/data/postgres-tv-store');
 before(async()=>{
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`CREATE TABLE tv_device_codes(id text,kind text,code text,purchase_owner_id text,user_id text,status text,expires_at timestamptz,completed_at timestamptz);
   CREATE TABLE subscriptions(user_id text PRIMARY KEY,plan text,is_active boolean,expires_at timestamptz)`);
 });
 after(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
 async function fixture(plan='premium_yearly',active=true,expired=false){
  await pool.query('TRUNCATE tv_device_codes,subscriptions');
  await pool.query("INSERT INTO tv_device_codes VALUES('issuance','subscription','123456','owner','owner','pending',now()+interval '10 minutes',null)");
  await pool.query("INSERT INTO subscriptions VALUES('owner',$1,$2,now()+($3::int*interval '1 day'))",[plan,active,expired?-1:1]);
 }
 it('confirms only the owner with a valid server entitlement, idempotently',async()=>{
  await fixture();assert.equal(await confirmTvPremiumEntitlement('123456','other'),false);
  assert.equal(await confirmTvPremiumEntitlement('123456','owner'),true);
  const first=(await pool.query('SELECT completed_at FROM tv_device_codes')).rows[0].completed_at;
  assert.equal(await confirmTvPremiumEntitlement('123456','owner'),true);
  assert.deepEqual((await pool.query('SELECT completed_at FROM tv_device_codes')).rows[0].completed_at,first);
 });
 it('rejects expired, inactive, ad-only and unbound codes without changing their status',async()=>{
  for(const [plan,active,expired] of [['premium_yearly',true,true],['premium_yearly',false,false],['remove_ads',true,false]] as const){
   await fixture(plan,active,expired);assert.equal(await confirmTvPremiumEntitlement('123456','owner'),false);
   assert.equal((await pool.query('SELECT status FROM tv_device_codes')).rows[0].status,'pending');
  }
  await fixture();await pool.query("UPDATE tv_device_codes SET expires_at=now()-interval '1 second'");assert.equal(await confirmTvPremiumEntitlement('123456','owner'),false);
  await fixture();await pool.query('UPDATE tv_device_codes SET purchase_owner_id=null');assert.equal(await confirmTvPremiumEntitlement('123456','owner'),false);
 });
 it('recognizes lifetime and quarterly Premium without changing the purchased plan',async()=>{
  for(const plan of ['premium_lifetime','premium_quarterly']){
   await fixture(plan);assert.equal(await confirmTvPremiumEntitlement('123456','owner'),true);
   assert.equal((await pool.query('SELECT plan FROM subscriptions')).rows[0].plan,plan);
  }
 });
});
