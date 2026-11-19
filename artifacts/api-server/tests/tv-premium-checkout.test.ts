import assert from 'node:assert/strict';
import {before,after,beforeEach,mock,test} from 'node:test';
import express from 'express';
import type {Server} from 'node:http';
import type {AddressInfo} from 'node:net';
let row:any, reserved=true, minted=0, created:any, confirmed:any, entitlement=true;
const noop=async()=>undefined;
mock.module('../src/data/postgres-tv-store',{namedExports:{
 createTvCode:async(_kind:any,_device:any,_platform:any,purchase:any)=>{created=purchase;return {code:'123456',expiresAt:new Date(Date.now()+600000)};},
 getTvCode:async()=>row,bindTvSubscriptionCheckout:async()=>reserved,
 confirmTvPremiumEntitlement:async(code:string,user:string)=>{confirmed={code,user};return entitlement;},completeTvSubscription:noop,tvSubscriptionToken:async()=>{minted++;return 'legacy-token';},
 listSubscriptionPlans:async()=>[],getSubscriptionPlan:async()=>null,
}});
mock.module('../src/data/postgres-billing-store',{namedExports:{pgApplySubscriptionEvent:noop,pgFindSubscriptionUser:noop,pgFindPaddleSubscriptionUser:noop,pgGetSubscription:async()=>null,pgRecordBillingEvent:noop,pgUpsertSubscription:noop}});
mock.module('../src/data/postgres-user-store',{namedExports:{pgFindUserById:async()=>({id:'owner'})}});
mock.module('../src/utils/logger',{namedExports:{logger:{log(){},error(){},warn(){}}}});
let server:Server,base:string;
before(async()=>{
 const {registerStripeSubscriptionRoutes}=await import('../src/routes/stripe-subscription-routes');
 const app=express();app.use(express.json());
 const auth=(req:any,res:any,next:any)=>{const id=req.headers.authorization?.replace('Bearer ','');if(!id)return res.sendStatus(401);req.userId=id;next();};
 registerStripeSubscriptionRoutes(app,{requireAuth:auth,requireAdmin:auth});
 server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
});
after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>{row={id:'issuance',code:'123456',status:'pending',userId:'owner',purchaseOwnerId:'owner',plan:'premium_yearly'};reserved=true;minted=0;created=null;confirmed=null;entitlement=true;});
async function request(path:string,owner?:string,body?:any){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(owner?{Authorization:'Bearer '+owner}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {response,data:await response.json()};}
test('binds selected plan to the authenticated TV account without a session token in the QR',async()=>{
 const {data,response}=await request('/api/subscription/tv/code','owner',{deviceId:'device',plan:'premium_yearly'});
 assert.match(response.headers.get('cache-control')!,/private.*no-store/);assert.deepEqual(created,{userId:'owner',plan:'premium_yearly'});assert.equal(data.accountBound,true);assert.equal(data.accountOwnerId,'owner');assert.equal(new URL(data.activationUrl).searchParams.get('plan'),'premium_yearly');assert.equal(data.token,undefined);
});
test('rejects selecting a paid plan without authentication',async()=>{const {response}=await request('/api/subscription/tv/code',undefined,{deviceId:'device',plan:'premium_yearly'});assert.equal(response.status,401);assert.equal(created,null);});
test('public browser status discloses neither account identity nor token; authenticated browser detects mismatch',async()=>{
 const guest=await request('/api/subscription/tv/code/123456/status?deviceId=web-activate');assert.match(guest.response.headers.get('cache-control')!,/private.*no-store/);assert.equal(guest.data.accountMatch,false);assert.equal(guest.data.accountOwnerId,undefined);assert.equal(guest.data.user,undefined);
 const other=await request('/api/subscription/tv/code/123456/status?deviceId=web-activate','other');assert.equal(other.data.accountMatch,false);
 const own=await request('/api/subscription/tv/code/123456/status?deviceId=web-activate','owner');assert.equal(own.data.accountMatch,true);assert.equal(minted,0);
});
test('completed bound purchase preserves TV session; another account cannot poll it',async()=>{
 row.status='completed';const own=await request('/api/subscription/tv/code/123456/status?deviceId=device','owner');assert.equal(own.data.status,'activated');assert.equal(own.data.user,undefined);assert.equal(minted,0);
 const other=await request('/api/subscription/tv/code/123456/status?deviceId=device','other');assert.equal(other.response.status,403);assert.equal(minted,0);
});
test('conflicting checkout is rejected before any payment provider is contacted',async()=>{
 reserved=false;const result=await request('/api/subscription/checkout','other',{plan:'premium_yearly',tvCode:'123456'});assert.equal(result.response.status,409);assert.equal(result.data.error,'TV_ACCOUNT_OR_PLAN_MISMATCH');
});

test('native confirmation requires authentication and a verified entitlement; client owner and plan are ignored',async()=>{
 const denied=await fetch(base+'/api/subscription/tv/code/123456/confirm-premium',{method:'POST'});assert.equal(denied.status,401);assert.equal(confirmed,null);
 const ok=await request('/api/subscription/tv/code/123456/confirm-premium','owner',{userId:'other',plan:'premium_lifetime'});assert.equal(ok.response.status,200);assert.deepEqual(confirmed,{code:'123456',user:'owner'});assert.equal(ok.data.status,'activated');assert.match(ok.response.headers.get('cache-control')!,/no-store/);assert.equal(minted,0);
 entitlement=false;const invalid=await request('/api/subscription/tv/code/123456/confirm-premium','other',{});assert.equal(invalid.response.status,409);assert.equal(minted,0);
 const bad=await request('/api/subscription/tv/code/12345/confirm-premium','owner',{});assert.equal(bad.response.status,400);
});
