import {mock,test} from 'node:test';
import assert from 'node:assert/strict';
let failSignature=false;
let payload:any;
const constructors:any[]=[];
mock.module('@apple/app-store-server-library',{namedExports:{Environment:{SANDBOX:'Sandbox',PRODUCTION:'Production'},SignedDataVerifier:class{
 constructor(...args:any[]){constructors.push(args);}
 async verifyAndDecodeTransaction(){if(failSignature)throw Error('untrusted chain or signature');return payload;}
}}});
const {verifyAppleSignedTransaction}=await import('../src/services/apple-signed-transaction');
const sku='megaradio_remove_ads_yearly1',now=Date.now();
const valid=()=>({bundleId:'com.visiongo.megaradio',environment:'Sandbox',productId:sku,type:'Auto-Renewable Subscription',originalTransactionId:'original-fixture',transactionId:'fixture',purchaseDate:now-10000,signedDate:now-1000,expiresDate:now+86400000});
const proof=(environment='Sandbox',alg='ES256')=>[Buffer.from(JSON.stringify({alg})).toString('base64url'),Buffer.from(JSON.stringify({environment})).toString('base64url'),'c2lnbmF0dXJl'].join('.');
test('StoreKit annual ad-free proof uses Apple verification before deriving entitlement and a lifetime proof stays distinct',async()=>{
 payload=valid();const result=await verifyAppleSignedTransaction(proof(),sku,false);
 assert.equal(result.valid,true);if(result.valid){assert.equal(result.expiresAt,payload.expiresDate);assert.equal(result.signedDate,payload.signedDate);assert.equal(result.isLifetime,false);}
 assert.equal(constructors[0][1],true,'certificate online/revocation checks remain enabled');assert.equal(constructors[0][3],'com.visiongo.megaradio');assert.equal(constructors[0][4],6759302561);assert.ok(Buffer.isBuffer(constructors[0][0][0]));
 payload={...valid(),productId:'megaradio_premium_lifetime',type:'Non-Consumable',expiresDate:undefined};
 const lifetime=await verifyAppleSignedTransaction(proof(),'megaradio_premium_lifetime',true);assert.equal(lifetime.valid,true);if(lifetime.valid)assert.equal(lifetime.expiresAt,null);
 payload={...valid(),environment:'Production'};assert.equal((await verifyAppleSignedTransaction(proof('Production'),sku,false)).valid,true);assert.equal(constructors.at(-1)[2],'Production');
});
test('unsigned routing or a client-provided status cannot bypass signature verification',async()=>{
 payload=valid();failSignature=true;
 assert.equal((await verifyAppleSignedTransaction(proof(),sku,false)).valid,false);failSignature=false;
 for(const environment of ['Xcode','LocalTesting','invented'])assert.equal((await verifyAppleSignedTransaction(proof(environment),sku,false)).valid,false);
 assert.equal((await verifyAppleSignedTransaction(proof('Sandbox','none'),sku,false)).valid,false);
 assert.equal((await verifyAppleSignedTransaction('not-a-signed-transaction',sku,false)).valid,false);
});
test('verified transaction claims remain bound to app, environment, product, type, identity and current validity',async()=>{
 for(const patch of [
  {bundleId:'com.someone.else'},{environment:'Production'},{productId:'different-sku'},
  {type:'Non-Consumable'},{type:'Consumable'},{type:'Non-Renewing Subscription'},
  {revocationDate:now-1000},{isUpgraded:true},{expiresDate:now-1},{expiresDate:undefined},
  {originalTransactionId:''},{transactionId:''},{signedDate:0},{signedDate:now+3600000},{purchaseDate:now+3600000},
 ]){payload={...valid(),...patch};const result=await verifyAppleSignedTransaction(proof(),sku,false);assert.equal(result.valid,false,JSON.stringify(patch));}
});
