// Shared types and constants for the web premium subscription flow.
// Consumed by PaywallModal, /premium page, and /activate page.
import { subscriptionAccess, type SubscriptionAccessInput } from '@workspace/db-shared/subscription-access';

export interface PlanInfo {
  planId: string;
  label: string;
  description: string;
  currency: string;
  amount: number;
  checkoutAvailable?: boolean;
  billingInterval?: 'month' | 'year' | null;
  billingFrequency?: number | null;
}

export const PLAN_LABEL: Record<string, string> = {
  remove_ads:       "Remove Ads",
  premium_monthly:  "Monthly",
  premium_quarterly: "Quarterly",
  premium_yearly:   "Annual",
  premium_lifetime: "Lifetime",
};

export function fmtPrice(amount: number, currency: string, locale = 'en'): string {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  try {
    const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    });
    return formatter.format(amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
  } catch { return ''; }
}

export const PAID_PLANS = ['remove_ads', 'premium_monthly', 'premium_quarterly', 'premium_yearly', 'premium_lifetime'] as const;
export function isAdFreeSubscription(sub: unknown, now = Date.now()): boolean {
  if (!sub || typeof sub !== 'object') return false;
  const value = sub as SubscriptionAccessInput;
  return PAID_PLANS.includes(value.plan as typeof PAID_PLANS[number]) && subscriptionAccess(value, now).active;
}
