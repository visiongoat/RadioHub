import assert from 'node:assert/strict';
import { after, before, it, mock } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
let subscription: any;
let writes: any[] = [];
let exists = true;
mock.module('../src/data/postgres-billing-store', { namedExports: {
  pgGetSubscription: async () => subscription,
  pgUpsertSubscription: async (_id: string, patch: any) => { writes.push(patch); subscription = {...subscription,...patch}; },
  pgFindSubscriptionUser: async () => null,
} });
mock.module('../src/data/postgres-user-store', { namedExports: {
  pgFindUserById: async () => exists ? {_id:'review-fixture', email:'fixture@example.invalid'} : null,
  pgListAdminUsers: async () => ({users:[],total:0}), pgDeleteUser: async()=>null,
  pgUpdateUser: async()=>null, pgUserFavoriteCount: async()=>0,
} });
let server: Server, base: string;
before(async () => {
 const {registerMiscRoutes}=await import('../src/routes/misc-routes');
 const app=express();app.use(express.json());app.use((req:any,_res,next)=>{req.session={user:{userId:'review-fixture'}};next();});
 registerMiscRoutes(app,{requireAdmin:(_req:any,_res:any,next:any)=>next(),requireAuth:(_req:any,_res:any,next:any)=>next()},{apiOnly:true});
 server=await new Promise<Server>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});base=`http://127.0.0.1:${(server.address() as any).port}`;
});
after(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});

it('TV entitlement reads deny expired/cancelled access without rewriting purchase history',async()=>{
 exists=true;writes=[];subscription={plan:'premium_monthly',isActive:true,expiresAt:'2020-01-01',platform:'tvos',productId:'historical-monthly',originalTransactionId:'historical-transaction'};
 for(let i=0;i<2;i++){
  const response=await fetch(base+'/api/user/subscription');assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{plan:'none',expiryDate:null,isActive:false,features:[],expired:true});
 }
 assert.equal(writes.length,0);assert.equal(subscription.plan,'premium_monthly');assert.equal(subscription.originalTransactionId,'historical-transaction');
 subscription={...subscription,isActive:false,expiresAt:'2099-01-01'};
 const cancelled=await(await fetch(base+'/api/user/subscription')).json();assert.equal(cancelled.isActive,false);assert.deepEqual(cancelled.features,[]);assert.equal(cancelled.plan,'none');
});
it('admin expiry updates deny past-dated access, preserve original product and reject missing owner',async()=>{
 exists=true;writes=[];subscription={plan:'premium_lifetime',isActive:true,productId:'historical-lifetime',originalTransactionId:'historical-transaction'};
 const response=await fetch(base+'/api/admin/users/review-fixture/subscription',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:'premium_monthly',expiresAt:'2020-01-01'})});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.user.subscription.plan,'premium_monthly');assert.equal(body.user.subscription.isActive,false);assert.deepEqual(body.user.features,[]);assert.equal(body.user.subscription.originalTransactionId,'historical-transaction');
 const previousWrites=writes.length;exists=false;
 const missing=await fetch(base+'/api/admin/users/missing/subscription',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:'premium_lifetime'})});
 assert.equal(missing.status,404);assert.equal(writes.length,previousWrites);
});

it('keeps valid TV and lifetime entitlements available with their expected features',async()=>{
 exists=true;writes=[];
 for(const sub of [
  {plan:'premium_monthly',platform:'tvos',isActive:true,expiresAt:'2099-01-01'},
  {plan:'premium_lifetime',platform:'ios',isActive:true,expiresAt:null},
  {plan:'remove_ads',platform:'android',isActive:true,expiresAt:'2099-01-01'},
 ]){
  subscription=sub;const body=await(await fetch(base+'/api/user/subscription')).json();
  assert.equal(body.plan,sub.plan);assert.equal(body.isActive,true);assert.ok(body.features.includes('remove_ads'));
 }
 assert.equal(writes.length,0);
});
