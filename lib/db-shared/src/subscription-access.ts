/** Effective access is separate from stored billing history and never mutates it. */
export interface SubscriptionAccessInput {
  plan?: string | null;
  isActive?: boolean | null;
  expiresAt?: string | Date | null;
}
const timeLimitedPlans = new Set(['remove_ads', 'premium_monthly', 'premium_yearly']);
export function subscriptionAccess(subscription: SubscriptionAccessInput | null | undefined, now = Date.now()) {
  const plan = subscription?.plan || 'none';
  const expiry = subscription?.expiresAt ? new Date(subscription.expiresAt).getTime() : NaN;
  const timeLimited = timeLimitedPlans.has(plan);
  const expired = timeLimited && Number.isFinite(expiry) && expiry <= now;
  const invalidExpiry = timeLimited && !Number.isFinite(expiry);
  const active = subscription?.isActive === true &&
    (plan === 'premium_lifetime' || timeLimited && Number.isFinite(expiry) && expiry > now);
  const status = active ? 'active' : expired ? 'expired' : invalidExpiry ? 'invalid_expiry' : plan === 'none' ? 'none' : 'inactive';
  return { active, expired, status } as const;
}
