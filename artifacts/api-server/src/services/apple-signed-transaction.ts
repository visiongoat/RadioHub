import { X509Certificate } from 'node:crypto';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { APPLE_ROOT_CA_G3_PEM } from './apple-root';
import type { ValidationResult } from './iap-verify';

const BUNDLE_ID = 'com.visiongo.megaradio';
const APP_APPLE_ID = 6759302561;
const verifiers = new Map<Environment, SignedDataVerifier>();
const isJws = (value: string) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
export const isAppleSignedTransaction = isJws;

/** StoreKit 2 does not require a legacy app receipt. Trust the transaction only
 * after Apple's verifier checks the Apple-pinned certificate chain, signature,
 * certificate revocation, expected bundle and the selected App Store environment.
 */
export async function verifyAppleSignedTransaction(jws: string, productId: string, isLifetime: boolean): Promise<ValidationResult> {
  if (!isJws(jws) || jws.length > 128000) return {valid:false,error:'Invalid signed Apple transaction',code:'apple_jws_invalid'};
  let routing: any, header: any;
  try { header = JSON.parse(Buffer.from(jws.split('.')[0], 'base64url').toString('utf8')); routing = JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8')); }
  catch { return {valid:false,error:'Invalid signed Apple transaction',code:'apple_jws_invalid'}; }
  if (header.alg !== 'ES256') return {valid:false,error:'Unsupported Apple signature algorithm',code:'apple_jws_algorithm'};
  // Unverified data selects only one of two fixed verification policies; it
  // never supplies the expected bundle/app ID or establishes an entitlement.
  const environment = routing.environment === Environment.SANDBOX ? Environment.SANDBOX
    : routing.environment === Environment.PRODUCTION ? Environment.PRODUCTION : null;
  if (!environment) return {valid:false,error:'Unsupported Apple transaction environment',code:'apple_environment'};
  let transaction;
  try {
    let verifier = verifiers.get(environment);
    if (!verifier) {
      verifier = new SignedDataVerifier([new X509Certificate(APPLE_ROOT_CA_G3_PEM).raw], true, environment, BUNDLE_ID, APP_APPLE_ID);
      verifiers.set(environment, verifier);
    }
    transaction = await verifier.verifyAndDecodeTransaction(jws);
  } catch {
    return {valid:false,error:'Apple signed transaction verification failed',code:'apple_jws_verification_failed'};
  }
  if (transaction.bundleId !== BUNDLE_ID || transaction.environment !== environment)
    return {valid:false,error:'Apple transaction belongs to a different application',code:'apple_bundle_mismatch'};
  if (transaction.productId !== productId)
    return {valid:false,error:'Apple transaction product does not match the requested product',code:'apple_product_mismatch'};
  if (transaction.revocationDate !== undefined || transaction.isUpgraded === true)
    return {valid:false,error:'Apple transaction is revoked or superseded',code:'apple_cancelled'};
  if (transaction.type !== (isLifetime ? 'Non-Consumable' : 'Auto-Renewable Subscription'))
    return {valid:false,error:'Apple product type does not match the configured plan',code:'apple_product_type'};
  const now = Date.now(), signedDate = Number(transaction.signedDate), purchaseDate = Number(transaction.purchaseDate);
  if (!Number.isFinite(signedDate) || signedDate <= 0 || signedDate > now + 60000 || !Number.isFinite(purchaseDate) || purchaseDate <= 0 || purchaseDate > now + 60000)
    return {valid:false,error:'Apple transaction dates are invalid',code:'apple_transaction_date'};
  const originalTransactionId = transaction.originalTransactionId;
  if (typeof originalTransactionId !== 'string' || !originalTransactionId || !transaction.transactionId)
    return {valid:false,error:'Apple transaction identity is missing',code:'apple_no_txn'};
  const expiresAt = isLifetime ? null : Number(transaction.expiresDate);
  if (!isLifetime && (!Number.isFinite(expiresAt) || !expiresAt))
    return {valid:false,error:'Apple subscription expiry is missing',code:'apple_no_expiry'};
  if (expiresAt !== null && expiresAt <= now) return {valid:false,error:'Subscription expired',code:'expired'};
  return {valid:true,expiresAt,originalTransactionId,isLifetime,productId,environment:environment === Environment.SANDBOX ? 'sandbox' : 'production',signedDate};
}
