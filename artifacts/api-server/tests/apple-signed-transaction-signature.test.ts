import {test} from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {rootCertificates} from 'node:tls';
import {verifyAppleSignedTransaction} from '../src/services/apple-signed-transaction';
import {APPLE_ROOT_CA_G3_PEM} from '../src/services/apple-root';
const payload={bundleId:'com.visiongo.megaradio',environment:'Sandbox',productId:'megaradio_remove_ads_yearly1',type:'Auto-Renewable Subscription',originalTransactionId:'untrusted',transactionId:'untrusted',signedDate:Date.now(),purchaseDate:Date.now(),expiresDate:Date.now()+86400000};
function forged(x5c?:string[],alg='ES256'){
 return [Buffer.from(JSON.stringify({alg,x5c})).toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),Buffer.alloc(64).toString('base64url')].join('.');
}
test('the actual Apple verifier rejects unsigned, arbitrary-root and root-as-leaf forged transactions',async()=>{
 const foreignRoot=new X509Certificate(rootCertificates[0]).raw.toString('base64');
 const appleRoot=new X509Certificate(APPLE_ROOT_CA_G3_PEM).raw.toString('base64');
 for(const token of [forged(),forged([foreignRoot,foreignRoot,foreignRoot]),forged([appleRoot,appleRoot,appleRoot]),forged([appleRoot,appleRoot,appleRoot],'HS256')]){
  const result=await verifyAppleSignedTransaction(token,payload.productId,false);assert.equal(result.valid,false);
 }
});
