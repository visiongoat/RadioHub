import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

let current: any = null, linkedUser: string | null = null;
const applications: any[] = [], receipts: any[] = [];
mock.module("../src/data/postgres-billing-store", { namedExports: {
  pgGetSubscription: async () => current,
  pgFindPaddleSubscriptionUser: async () => linkedUser,
  pgApplySubscriptionEvent: async (...args: any[]) => { applications.push(args); return "applied"; },
  pgRecordBillingEvent: async (event: any) => { receipts.push(event); return "inserted"; },
} });
const { signedPaddleCustomData, validPaddleCustomData, validPaddlePrice, paddleSubscriptionPatch, processPaddleEvent } = await import("../src/services/paddle-billing");
const { configuredPaddlePriceId, publicPaddlePlanCatalog } = await import("../src/services/paddle-plan-catalog");
const secret = "offline-unit-secret";
const price = { id: "pri_monthly", status: "active", type: "standard", billing_cycle: { interval: "month", frequency: 1 } };
const custom = () => signedPaddleCustomData(secret, { userId: "user-A", plan: "premium_monthly", priceId: price.id, tvCode: "123456", tvCodeId: "issuance-A" });
const future = () => new Date(Date.now() + 86400000).toISOString();
const event = (data: any = {}) => ({ event_id: "evt_offline", event_type: "transaction.completed", occurred_at: new Date().toISOString(),
  data: { id: "txn_A", customer_id: "ctm_A", subscription_id: "sub_A", status: "completed", origin: "web",
    items: [{ price, quantity: 1 }], custom_data: custom(), billing_period: { ends_at: future() }, ...data } });
const options = { secret, getPriceId: async (plan: string) => plan === "premium_monthly" ? price.id : null };
beforeEach(() => { current = null; linkedUser = null; applications.length = 0; receipts.length = 0; });

describe("Paddle entitlement decisions", () => {
  it("binds user, actual price, plan and specific TV issuance against client edits", () => {
    assert.equal(validPaddleCustomData(secret, custom()), true);
    for (const key of ["userId", "plan", "priceId", "tvCode", "tvCodeId", "checkoutSignature"]) {
      assert.equal(validPaddleCustomData(secret, { ...custom(), [key]: "changed" }), false, key);
    }
    assert.equal(validPaddleCustomData("rotated", custom()), false);
    assert.equal(validPaddleCustomData(secret, { userId: "user-A", plan: "premium_lifetime" }), false);
  });
  it("requires plan-compatible recurring periods and rejects archived or custom checkout prices", () => {
    assert.equal(validPaddlePrice("premium_monthly", price), true);
    assert.equal(validPaddlePrice("premium_lifetime", price), false);
    assert.equal(validPaddlePrice("premium_yearly", price), false);
    assert.equal(validPaddlePrice("premium_monthly", { ...price, status: "archived" }), false);
    assert.equal(validPaddlePrice("premium_monthly", { ...price, type: "custom" }), false);
    assert.equal(validPaddlePrice("premium_lifetime", { ...price, billing_cycle: null }), true);
  });
  it("accepts only a verified three-month recurring price for quarterly Premium", async () => {
    const quarterly = { ...price, id: "pri_quarterly", billing_cycle: { interval: "month", frequency: 3 } };
    assert.equal(validPaddlePrice("premium_quarterly", quarterly), true);
    for (const cycle of [null, { interval: "month", frequency: 1 }, { interval: "year", frequency: 1 }]) {
      assert.equal(validPaddlePrice("premium_quarterly", { ...quarterly, billing_cycle: cycle }), false);
    }
    assert.equal(validPaddlePrice("premium_monthly", quarterly), false);
    const binding = signedPaddleCustomData(secret, { userId: "user-A", plan: "premium_quarterly", priceId: quarterly.id, tvCode: "123456", tvCodeId: "issuance-A" });
    const result = await processPaddleEvent(event({ items: [{ price: quarterly, quantity: 1 }], custom_data: binding }), {
      secret, getPriceId: async plan => plan === "premium_quarterly" ? quarterly.id : null,
    });
    assert.equal(result.outcome, "applied");
    assert.equal(applications[0][1].plan, "premium_quarterly");
    assert.equal(result.tv?.plan, "premium_quarterly");
    assert.equal(applications[0][1].expiresAt.getTime() > Date.now(), true);
  });
  it("does not grant an unsigned, forged or mismatched initial purchase", async () => {
    for (const data of [
      { custom_data: { userId: "user-A", plan: "premium_lifetime" } },
      { custom_data: { ...custom(), userId: "victim" } },
      { custom_data: signedPaddleCustomData(secret, { userId: "user-A", plan: "premium_lifetime", priceId: "pri_other" }) },
      { status: "paid" }, { items: [{ price, quantity: 2 }] }, { items: [{ price: { ...price, id: "pri_not_allowed" }, quantity: 1 }] },
    ]) assert.notEqual((await processPaddleEvent(event(data), options)).outcome, "applied");
    assert.equal(applications.length, 0);
  });
  it("derives the paid entitlement and transaction ID from provider line items", async () => {
    const result = await processPaddleEvent(event(), options);
    assert.equal(result.outcome, "applied");
    assert.equal(applications[0][1].plan, "premium_monthly");
    assert.equal(applications[0][1].transactionId, "txn_A");
    assert.equal(applications[0][1].paddleBillingKind, "recurring");
    assert.ok(applications[0][1].expiresAt instanceof Date);
    assert.equal(applications[0][3].order.field, "lastPaddleTransactionTime");
    assert.deepEqual(result.tv, { code: "123456", codeId: "issuance-A", userId: "user-A", plan: "premium_monthly", transactionId: "txn_A" });
  });
  it("writes the one-time marker only from accepted provider price data, not custom_data", async () => {
    const oneTimePrice = { id: "pri_remove_ads_once", status: "active", type: "standard", billing_cycle: null };
    const custom = signedPaddleCustomData(secret, { userId: "user-A", plan: "remove_ads", priceId: oneTimePrice.id });
    const input = event({
      subscription_id: null, billing_period: null,
      items: [{ price: oneTimePrice, quantity: 1 }],
      custom_data: { ...custom, paddleBillingKind: "recurring" },
    });
    const accepted = await processPaddleEvent(input, { secret, getPriceId: async plan => plan === "remove_ads" ? oneTimePrice.id : null });
    assert.equal(accepted.outcome, "applied");
    const patch = applications[0][1];
    assert.equal(patch.plan, "remove_ads");
    assert.equal(patch.platform, "paddle");
    assert.equal(patch.paddleBillingKind, "one_time");
    assert.equal(patch.paddleSubscriptionId, null);
    assert.equal(patch.expiresAt, null);
    assert.equal(patch.renewsAt, null);
    assert.equal(patch.isActive, true);
  });
  for (const [label, endsAt] of [
    ["past", "2020-01-01T00:00:00Z"],
    ["future", "2099-01-01T00:00:00Z"],
  ]) {
    it("ignores a " + label + " billing_period for an accepted one-time Remove Ads price", async () => {
      const once = { id: "pri_remove_ads_once", status: "active", type: "standard", billing_cycle: null };
      const input = event({
        subscription_id: null, billing_period: { ends_at: endsAt },
        items: [{ price: once, quantity: 1 }],
        custom_data: signedPaddleCustomData(secret, { userId: "user-A", plan: "remove_ads", priceId: once.id }),
      });
      assert.equal((await processPaddleEvent(input, { secret, getPriceId: async plan => plan === "remove_ads" ? once.id : null })).outcome, "applied");
      const patch = applications[0][1];
      assert.equal(patch.paddleBillingKind, "one_time");
      assert.equal(patch.paddleSubscriptionId, null);
      assert.equal(patch.isActive, true);
      assert.equal(patch.expiresAt, null);
      assert.equal(patch.renewsAt, null);
    });
  }
  it("corrects one-time history to recurring when the provider verifies a recurring ad-free price", async () => {
    linkedUser = "user-A";
    current = { platform: "paddle", plan: "remove_ads", paddleCustomerId: "ctm_A", paddleBillingKind: "one_time", isActive: true };
    const recurring = { ...price, id: "pri_remove_ads_monthly" };
    const input = event({ items: [{ price: recurring, quantity: 1 }], custom_data: { paddleBillingKind: "one_time" } });
    assert.equal((await processPaddleEvent(input, { secret, getPriceId: async plan => plan === "remove_ads" ? recurring.id : null })).outcome, "applied");
    assert.equal(applications[0][1].paddleBillingKind, "recurring");
    assert.equal(applications[0][1].paddleSubscriptionId, "sub_A");
    assert.ok(applications[0][1].expiresAt instanceof Date);
  });
  it("does not invent unlimited access if the initial recurring transaction lacks a period", async () => {
    await processPaddleEvent(event({ billing_period: null }), options);
    assert.equal(applications[0][1].isActive, false);
    assert.equal(applications[0][1].subscriptionStatus, "pending");
    assert.equal(applications[0][1].transactionId, "txn_A");
  });
  it("handles linked legacy subscription lifecycle without trusting new unsigned custom data", async () => {
    linkedUser = "user-A"; current = { platform: "paddle", paddleCustomerId: "ctm_A", paddleSubscriptionId: "sub_A", plan: "premium_monthly" };
    const input = { ...event(), event_type: "subscription.canceled", data: { id: "sub_A", customer_id: "ctm_A", status: "canceled", items: [{ price, quantity: 1 }] } };
    assert.equal((await processPaddleEvent(input, options)).outcome, "applied");
    assert.equal(applications[0][1].isActive, false);
    assert.equal(applications[0][1].paddleBillingKind, "recurring");
    assert.equal(applications[0][3].order.field, "lastPaddleSubscriptionTime");
    await processPaddleEvent({ ...input, data: { ...input.data, custom_data: { userId: "user-B" } } }, options);
    assert.equal(applications.length, 1);
    assert.equal(receipts.at(-1).status, "owner_mismatch");
  });
  it("still revokes linked subscriptions after the old catalog price has been removed or disabled", async () => {
    linkedUser = "user-A"; current = { platform: "paddle", paddleCustomerId: "ctm_A", paddleSubscriptionId: "sub_A", plan: "premium_monthly" };
    const input = { ...event(), event_type: "subscription.canceled", data: { id: "sub_A", customer_id: "ctm_A", status: "canceled", items: [] } };
    assert.equal((await processPaddleEvent(input, { ...options, getPriceId: async () => null })).outcome, "applied");
    assert.equal(applications[0][1].isActive, false);
  });
  it("binds a returning customer's signed trial and completes only its specific TV issuance", async () => {
    linkedUser = "user-A"; current = { platform: "paddle", paddleCustomerId: "ctm_A", paddleSubscriptionId: "sub_old", plan: "premium_monthly", isActive: false };
    const input = { ...event(), event_type: "subscription.trialing", data: { ...event().data, id: "sub_new", status: "trialing", current_billing_period: { ends_at: future() } } };
    const result = await processPaddleEvent(input, options);
    assert.equal(result.outcome, "applied"); assert.equal(applications[0][3].paddle.allowBinding, true);
    assert.equal(applications[0][1].isTrial, true); assert.equal(result.tv?.transactionId, "sub_new");
  });
  it("maps trial, scheduled cancellation, past-due grace, paused and ended access explicitly", () => {
    for (const status of ["active", "trialing", "past_due"]) {
      const patch = paddleSubscriptionPatch({ status, current_billing_period: { ends_at: future() }, scheduled_change: { action: "cancel" }, next_billed_at: future() });
      assert.equal(patch.isActive, true); assert.equal(patch.cancelAtPeriodEnd, true); assert.equal(patch.renewsAt, null);
      assert.equal(patch.isTrial, status === "trialing");
      assert.equal(paddleSubscriptionPatch({ status, current_billing_period: { ends_at: "2020-01-01T00:00:00Z" } }).isActive, false);
      assert.throws(() => paddleSubscriptionPatch({ status, current_billing_period: null }), /billing period/);
    }
    for (const status of ["paused", "canceled"]) assert.equal(paddleSubscriptionPatch({ status }).isActive, false);
    assert.throws(() => paddleSubscriptionPatch({ status: "invented" }), /status/);
  });
  it("only revokes for an approved full refund of this exact current transaction", async () => {
    linkedUser = "user-A"; current = { transactionId: "txn_A", plan: "premium_monthly" };
    const refund = { ...event(), event_type: "adjustment.updated", data: { id: "adj_A", customer_id: "ctm_A", transaction_id: "txn_A", subscription_id: "sub_A", action: "refund", type: "full", status: "approved" } };
    for (const extra of [{ type: "partial" }, { status: "pending_approval" }, { action: "credit" }, { status: "rejected" }]) {
      assert.equal((await processPaddleEvent({ ...refund, data: { ...refund.data, ...extra } }, options)).outcome, "non_full_refund");
    }
    assert.equal(applications.length, 0);
    assert.equal((await processPaddleEvent(refund, options)).outcome, "applied");
    assert.equal(applications[0][1].isActive, false);
    assert.equal(applications[0][3].paddle.transactionId, "txn_A");
  });
  it("retries a refund delivered before its payment instead of acknowledging it forever", async () => {
    await assert.rejects(processPaddleEvent({ ...event(), event_type: "adjustment.updated", data: { id: "adj_A", customer_id: "ctm_A", transaction_id: "txn_A", action: "refund", type: "full", status: "approved" } }, options), /awaits/);
    assert.equal(receipts.length, 0); assert.equal(applications.length, 0);
  });
  it("requires the actual stable event ID and occurrence time", async () => {
    await assert.rejects(processPaddleEvent({ ...event(), event_id: "" }, options), /envelope/);
    await assert.rejects(processPaddleEvent({ ...event(), occurred_at: "bad" }, options), /envelope/);
  });
});

describe("Truthful Paddle plan availability", () => {
  it("does not resurrect an inactive plan through environment fallback", () => {
    process.env.PADDLE_PRICE_MONTHLY = "pri_old";
    assert.equal(configuredPaddlePriceId("premium_monthly", [{ planId: "premium_monthly", isActive: false }]), null);
    delete process.env.PADDLE_PRICE_MONTHLY;
  });
  it("rejects a price ID shared by two entitlements before accepting checkout", () => {
    const plans = ["remove_ads", "premium_monthly"].map(planId => ({ planId, isActive: true, paddlePriceId: "pri_duplicate" }));
    assert.equal(configuredPaddlePriceId("premium_monthly", plans), null);
    assert.equal(configuredPaddlePriceId("remove_ads", plans), null);
  });
  it("shares price reads, exposes verified cents/interval and fails closed on 403 without fabricated prices", async (t) => {
    process.env.PADDLE_API_KEY = "offline_key"; process.env.PADDLE_WEBHOOK_SECRET = "offline_secret"; process.env.PADDLE_CLIENT_TOKEN = "test_offline";
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
      calls++; assert.ok(init.signal); assert.equal(init.method, undefined);
      const good = String(url).includes("verified");
      return new Response(JSON.stringify(good ? { data: { status: "active", type: "standard", unit_price: { amount: "399", currency_code: "EUR" }, billing_cycle: { interval: "month", frequency: 1 } } } : { error: { code: "forbidden" } }), { status: good ? 200 : 403 });
    });
    const plans = [
      { planId: "premium_monthly", isActive: true, paddlePriceId: "pri_verified", amount: 999999, currency: "eur" },
      { planId: "premium_lifetime", isActive: true, paddlePriceId: "pri_forbidden", amount: 999999, currency: "eur" },
    ];
    const results = await Promise.all([publicPaddlePlanCatalog(plans), publicPaddlePlanCatalog(plans)]);
    assert.equal(calls, 2);
    assert.equal(results[0].providerAvailable, true);
    assert.equal(results[0].plans[0].amount, 399); assert.equal(results[0].plans[0].billingInterval, "month");
    assert.equal(results[0].plans[1].amount, 0); assert.equal(results[0].plans[1].checkoutAvailable, false);
  });
});
