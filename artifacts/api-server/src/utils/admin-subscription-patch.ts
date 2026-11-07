import { subscriptionAccess, type SubscriptionAccessInput } from '@workspace/db-shared/subscription-access';

const plans = new Set(['none', 'remove_ads', 'premium_monthly', 'premium_yearly', 'premium_lifetime']);
/** Admin changes are entitlements, not Apple/Google purchase verifications. */
export function adminSubscriptionPatch(body: unknown, current: SubscriptionAccessInput | null, now = new Date()): {
  patch?: Record<string, unknown>; error?: string;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Subscription changes must be an object' };
  const input = body as Record<string, unknown>;
  if (!['plan', 'isActive', 'expiresAt'].some(key => input[key] !== undefined)) return { error: 'Provide a plan, active flag or expiry date' };
  if (input.plan !== undefined && (typeof input.plan !== 'string' || !plans.has(input.plan))) return { error: 'Invalid subscription plan' };
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') return { error: 'isActive must be a boolean' };
  const plan = typeof input.plan === 'string' ? input.plan : current?.plan || 'none';
  let expiresAt = current?.expiresAt || null;
  if (input.expiresAt !== undefined) {
    if (input.expiresAt !== null && (typeof input.expiresAt !== 'string' || !Number.isFinite(Date.parse(input.expiresAt)))) return { error: 'expiresAt must be a valid date or null' };
    expiresAt = input.expiresAt ? new Date(input.expiresAt as string) : null;
  }
  if (plan === 'premium_lifetime') expiresAt = null;
  const requestedActive = typeof input.isActive === 'boolean' ? input.isActive : input.plan !== undefined ? plan !== 'none' : current?.isActive === true;
  if (requestedActive && plan !== 'none' && plan !== 'premium_lifetime' && !expiresAt) return { error: 'Time-limited plans require an expiry date' };
  const isActive = subscriptionAccess({ plan, expiresAt, isActive: requestedActive }, now.getTime()).active;
  const patch: Record<string, unknown> = { plan, expiresAt, isActive, platform: 'admin', lastVerifiedAt: now };
  if (isActive) {
    patch.cancelledAt = null;
    if (!current || current.plan !== plan) patch.startedAt = now;
  }
  // Do not clear or relabel historical product/transaction fields.
  return { patch };
}
