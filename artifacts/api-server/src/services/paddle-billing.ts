import { createHmac, timingSafeEqual } from "node:crypto";
import { pgApplySubscriptionEvent, pgFindPaddleSubscriptionUser, pgGetSubscription, pgRecordBillingEvent } from "../data/postgres-billing-store";

export const PADDLE_PLANS = ["remove_ads", "premium_monthly", "premium_quarterly", "premium_yearly", "premium_lifetime"] as const;
type Plan = typeof PADDLE_PLANS[number];
type Data = Record<string, any>;
const text = (value: unknown): string => typeof value === "string" ? value : "";
const date = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value) return null;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result : null;
};
const customPayload = (custom: Data) => JSON.stringify(["radiohub:paddle-checkout:v1", custom.userId, custom.plan, custom.priceId, custom.tvCode, custom.tvCodeId]);

/** Paddle.js custom_data is client-editable; a valid provider signature alone
 * does not bind an application user or the entitlement advertised by a client. */
export function signedPaddleCustomData(secret: string, input: { userId: string; plan: string; priceId: string; tvCode?: string; tvCodeId?: string }): Record<string, string> {
  if (!secret || !input.userId || !PADDLE_PLANS.includes(input.plan as Plan)) throw new Error("Paddle checkout binding is unavailable");
  const custom = { userId: input.userId, plan: input.plan, priceId: input.priceId, tvCode: input.tvCode || "", tvCodeId: input.tvCodeId || "" };
  return { ...custom, checkoutSignature: createHmac("sha256", secret).update(customPayload(custom)).digest("hex") };
}

export function validPaddleCustomData(secret: string, custom: Data): boolean {
  if (!secret || !["userId", "plan", "priceId", "tvCode", "tvCodeId"].every(key => typeof custom[key] === "string") ||
      !PADDLE_PLANS.includes(custom.plan) || !/^[a-f0-9]{64}$/.test(custom.checkoutSignature || "")) return false;
  const expected = createHmac("sha256", secret).update(customPayload(custom)).digest();
  return timingSafeEqual(expected, Buffer.from(custom.checkoutSignature, "hex"));
}

/** Reject accidental monthly→lifetime and archived/custom catalog mappings. */
export function validPaddlePrice(plan: string, price: Data): boolean {
  const cycle = price.billingCycle ?? price.billing_cycle;
  if (price.status !== "active" || price.type === "custom") return false;
  if (price.quantity && (price.quantity.minimum > 1 || price.quantity.maximum < 1)) return false;
  if (plan === "premium_monthly") return cycle?.interval === "month" && cycle.frequency === 1;
  if (plan === "premium_quarterly") return cycle?.interval === "month" && cycle.frequency === 3;
  if (plan === "premium_yearly") return cycle?.interval === "year" && cycle.frequency === 1;
  if (plan === "premium_lifetime") return cycle == null;
  return plan === "remove_ads"; // Existing configured ad-free plans may be recurring or one-time.
}

export function paddleSubscriptionPatch(data: Data): Data {
  if (!["active", "trialing", "past_due", "paused", "canceled"].includes(data.status)) throw new Error("Unsupported Paddle subscription status");
  const expiresAt = date(data.current_billing_period?.ends_at);
  const liveStatus = ["active", "trialing", "past_due"].includes(data.status);
  if (liveStatus && !expiresAt) throw new Error("Paddle subscription has no verified billing period");
  const cancelAtPeriodEnd = data.scheduled_change?.action === "cancel";
  return {
    paddleBillingKind: "recurring",
    subscriptionStatus: data.status,
    // Keep the existing past-due grace policy, but never beyond the provider's period.
    isActive: liveStatus && !!expiresAt && expiresAt.getTime() > Date.now(),
    isTrial: data.status === "trialing", expiresAt,
    renewsAt: cancelAtPeriodEnd || !liveStatus ? null : date(data.next_billed_at),
    cancelAtPeriodEnd, cancelledAt: date(data.canceled_at),
    ...(date(data.started_at) ? { startedAt: date(data.started_at) } : {}),
  };
}

export async function processPaddleEvent(event: Data, options: {
  secret: string;
  getPriceId: (plan: string) => Promise<string | null>;
}): Promise<{ outcome: string; tv?: { code: string; codeId: string; userId: string; plan: string; transactionId: string } }> {
  const eventId = text(event.event_id), type = text(event.event_type), occurredAt = date(event.occurred_at), data = event.data;
  if (!eventId || !occurredAt || !data || typeof data !== "object") throw new Error("Invalid Paddle event envelope");
  const receipt = { provider: "paddle" as const, providerEventId: eventId, eventType: type, occurredAt, payload: event };
  const ignored = async (reason: string) => {
    await pgRecordBillingEvent({ ...receipt, status: reason });
    return { outcome: reason };
  };
  const subscriptionEvent = ["subscription.created", "subscription.activated", "subscription.updated", "subscription.trialing", "subscription.resumed", "subscription.paused", "subscription.past_due", "subscription.canceled"].includes(type);
  const transactionEvent = type === "transaction.completed";
  const adjustmentEvent = type === "adjustment.created" || type === "adjustment.updated";
  if (!subscriptionEvent && !transactionEvent && !adjustmentEvent) return { outcome: "ignored_event" };
  const customerId = text(data.customer_id);
  const subscriptionId = subscriptionEvent ? text(data.id) : text(data.subscription_id);
  const transactionId = transactionEvent ? text(data.id) : text(data.transaction_id);
  if (!customerId || (subscriptionEvent && !subscriptionId) || (!subscriptionEvent && !transactionId)) return ignored("invalid_identity");
  const custom = data.custom_data && typeof data.custom_data === "object" ? data.custom_data : {};
  const bound = validPaddleCustomData(options.secret, custom);
  const linkedUser = await pgFindPaddleSubscriptionUser({ subscriptionId, transactionId, customerId });
  if (linkedUser && custom.userId && linkedUser !== custom.userId) return ignored("owner_mismatch");
  const userId = linkedUser || (bound ? text(custom.userId) : "");
  const fullRefund = adjustmentEvent && data.status === "approved" && ["refund", "chargeback"].includes(data.action) && data.type === "full";
  if (!userId) {
    // Refund may arrive before checkout: do not acknowledge it as permanently
    // processed before a customer/transaction can be matched on the retry.
    if (fullRefund) throw new Error("Paddle refund awaits its transaction binding");
    return ignored("unbound_checkout_review_required");
  }
  const current = await pgGetSubscription(userId);

  if (adjustmentEvent) {
    // A partial/tax/pending refund is not evidence that the whole entitlement was refunded.
    if (!fullRefund) return ignored("non_full_refund");
    if (!current || current.transactionId !== transactionId) {
      if (current?.lastPaddleTransactionTime && new Date(current.lastPaddleTransactionTime).getTime() > occurredAt.getTime()) return ignored("unrelated_refund_review_required");
      throw new Error("Paddle refund awaits its transaction binding");
    }
    const outcome = await pgApplySubscriptionEvent(userId, {
      isActive: false, subscriptionStatus: "canceled", isTrial: false, renewsAt: null,
      cancelAtPeriodEnd: false, cancelledAt: occurredAt, lastVerifiedAt: new Date(),
      paddleRefundedTransactionId: transactionId,
    }, { ...receipt, userId, status: "processed", plan: current.plan }, {
      order: { field: "lastPaddleAdjustmentTime", timestamp: occurredAt.getTime(), isDowngrade: true },
      paddle: { customerId, subscriptionId, transactionId, allowBinding: false, kind: "adjustment" },
    });
    return { outcome };
  }

  if (transactionEvent && data.status !== "completed") return ignored("unpaid_transaction");
  const restrictiveLifecycle = subscriptionEvent && ["canceled", "paused"].includes(data.status) &&
    current?.platform === "paddle" && current.paddleSubscriptionId === subscriptionId;
  const items: Data[] = Array.isArray(data.items) ? data.items : [];
  if (!restrictiveLifecycle && (items.length !== 1 || items[0].quantity !== 1 || !text(items[0].price?.id))) return ignored("unsupported_items");
  const price = items[0]?.price || {}, priceId = restrictiveLifecycle ? current.productId : price.id;
  const mappings = await Promise.all(PADDLE_PLANS.map(async plan => ({ plan, id: await options.getPriceId(plan) })));
  const matches = mappings.filter(mapping => mapping.id === priceId);
  // Existing linked subscriptions retain their original price even after the catalog changes.
  const plan = restrictiveLifecycle ? current.plan : matches.length === 1 ? matches[0].plan
    : matches.length === 0 && current?.platform === "paddle" && current.productId === priceId && PADDLE_PLANS.includes(current.plan) ? current.plan : null;
  if (!plan || !restrictiveLifecycle && !validPaddlePrice(plan, { ...price, status: "active" })) return ignored("unrecognized_price");
  if (!linkedUser && bound && (custom.plan !== plan || custom.priceId !== priceId)) return ignored("checkout_price_mismatch");
  if (!linkedUser && !bound) return ignored("unbound_checkout_review_required");
  let patch: Data = { plan, productId: priceId, platform: "paddle", paddleCustomerId: customerId,
    paddleSubscriptionId: subscriptionId || null, lastVerifiedAt: new Date() };
  if (subscriptionEvent) {
    patch = { ...patch, ...paddleSubscriptionPatch(data) };
  } else {
    const recurring = (price.billing_cycle ?? price.billingCycle) != null;
    // Missing cycle data is not proof that a paid entitlement has no expiry.
    const oneTime = price.billing_cycle === null || price.billingCycle === null;
    if (!recurring && !oneTime) return ignored("unverified_billing_kind");
    if (!recurring && subscriptionId) return ignored("billing_kind_mismatch");
    const expiresAt = recurring ? date(data.billing_period?.ends_at) : null;
    // Initial recurring checkouts can precede their subscription event. Without
    // a verified period, wait for that event rather than manufacture lifetime access.
    if (recurring && !subscriptionId) return ignored("missing_subscription_identity");
    patch = { ...patch, transactionId, paddleBillingKind: recurring ? "recurring" : "one_time",
      isActive: recurring ? !!expiresAt && expiresAt.getTime() > Date.now() : true,
      subscriptionStatus: recurring && !expiresAt ? "pending" : "active", isTrial: false, expiresAt,
      renewsAt: recurring ? expiresAt : null,
      cancelAtPeriodEnd: false, cancelledAt: null, startedAt: occurredAt };
  }
  const amount = transactionEvent && /^\d+$/.test(text(data.details?.totals?.total)) ? Number(data.details.totals.total) : null;
  const outcome = await pgApplySubscriptionEvent(userId, patch, {
    ...receipt, userId, status: "processed", plan, amountMinor: Number.isSafeInteger(amount) ? amount : null,
    currency: transactionEvent ? text(data.currency_code) || null : null,
  }, {
    order: { field: subscriptionEvent ? "lastPaddleSubscriptionTime" : "lastPaddleTransactionTime", timestamp: occurredAt.getTime(), isDowngrade: !patch.isActive },
    paddle: { customerId, subscriptionId, transactionId,
      allowBinding: bound && (!current?.paddleCustomerId || transactionEvent && !String(data.origin || "").startsWith("subscription_") ||
        subscriptionEvent && ["subscription.created", "subscription.trialing"].includes(type) && (!current.isActive || current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now())),
      kind: subscriptionEvent ? "subscription" : "transaction" },
  });
  const tv = bound && custom.tvCode && custom.tvCodeId && (outcome === "applied" || outcome === "duplicate")
    ? { code: custom.tvCode, codeId: custom.tvCodeId, userId, plan, transactionId: transactionId || subscriptionId } : undefined;
  return { outcome, tv };
}
