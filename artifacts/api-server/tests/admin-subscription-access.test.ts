import assert from 'node:assert/strict';
import { it } from 'node:test';
import { subscriptionAccess } from '@workspace/db-shared/subscription-access';
import { adminSubscriptionPatch } from '../src/utils/admin-subscription-patch';
const now = new Date('2026-11-07T12:00:00Z');

it('distinguishes effective expiry from raw activation without changing billing history', () => {
 const sub = { plan: 'premium_monthly', isActive: true, expiresAt: '2026-11-01T00:00:00Z', productId:'old-product', originalTransactionId:'original-history' };
 assert.deepEqual(subscriptionAccess(sub, now.getTime()), { active:false, expired:true, status:'expired' });
 assert.equal(sub.plan,'premium_monthly');assert.equal(sub.isActive,true);assert.equal(sub.originalTransactionId,'original-history');
 assert.equal(subscriptionAccess({...sub, expiresAt:now.toISOString()}, now.getTime()).active,false);
 for (const expiresAt of [null, 'invalid']) assert.equal(subscriptionAccess({...sub, expiresAt},now.getTime()).active,false);
 assert.equal(subscriptionAccess({...sub,plan:'premium_lifetime',expiresAt:null},now.getTime()).active,true);
 assert.equal(subscriptionAccess({...sub,expiresAt:'2026-12-01',isActive:false},now.getTime()).active,false);
});

it('past-dated admin test plans are inactive while preserving the chosen plan', () => {
 const result = adminSubscriptionPatch({plan:'premium_monthly',expiresAt:'2026-11-01T00:00:00Z'}, {plan:'premium_lifetime',isActive:true}, now);
 assert.equal(result.error,undefined);assert.equal(result.patch?.plan,'premium_monthly');assert.equal(result.patch?.isActive,false);assert.equal(result.patch?.platform,'admin');
 assert.equal('productId' in result.patch!,false);assert.equal('originalTransactionId' in result.patch!,false);
});

it('reactivation requires finite expiry and clears prior cancellation; lifetime canonical expiry is null', () => {
 for(const body of [{plan:'premium_monthly',expiresAt:null},{plan:'remove_ads'}, {plan:'premium_yearly',expiresAt:'invalid'}, {isActive:'true'}, {}, null]) assert.ok(adminSubscriptionPatch(body,null,now).error);
 const active=adminSubscriptionPatch({plan:'premium_monthly',expiresAt:'2026-12-01T00:00:00Z'},null,now).patch!;
 assert.equal(active.isActive,true);assert.equal(active.cancelledAt,null);assert.equal(active.startedAt,now);
 const lifetime=adminSubscriptionPatch({plan:'premium_lifetime',expiresAt:'2020-01-01'},null,now).patch!;
 assert.equal(lifetime.isActive,true);assert.equal(lifetime.expiresAt,null);
 assert.equal(adminSubscriptionPatch({plan:'none',isActive:true},null,now).patch?.isActive,false);
});
