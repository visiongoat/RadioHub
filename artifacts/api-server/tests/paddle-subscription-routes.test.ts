import assert from "node:assert/strict";
import { before, after, beforeEach, describe, it, mock } from "node:test";
import type { Server } from "node:http";
import express from "express";

process.env.PAYMENT_PROVIDER = "paddle";
process.env.PADDLE_API_KEY = "offline_key";
process.env.PADDLE_WEBHOOK_SECRET = "offline_secret";
process.env.PADDLE_CLIENT_TOKEN = "test_offline";
process.env.PADDLE_ENVIRONMENT = "sandbox";
process.env.WEB_BASE_URL = "https://themegaradio.com";
let subscription: any, priceFails = false, archived = false, period: any;
const portalCalls: any[] = [];
const plans = [{ planId: "premium_monthly", isActive: true, paddlePriceId: "pri_test" }];
mock.module("@paddle/paddle-node-sdk", { namedExports: {
  Environment: { sandbox: "sandbox", production: "production" },
  Paddle: class {
    prices = { get: async () => { if (priceFails) throw new Error("forbidden"); return { status: archived ? "archived" : "active", type: "standard", billingCycle: period }; } };
    webhooks = { isSignatureValid: async () => false };
    customerPortalSessions = { create: async (...args: any[]) => { portalCalls.push(args); return { urls: { general: { overview: "https://sandbox-customer-portal.paddle.com/test?token=offline" } } }; } };
  },
} });
mock.module("../src/data/postgres-billing-store", { namedExports: {
  pgGetSubscription: async () => subscription,
  pgFindSubscriptionUser: async () => null, pgFindPaddleSubscriptionUser: async () => null,
  pgApplySubscriptionEvent: async () => "applied", pgRecordBillingEvent: async () => "inserted", pgUpsertSubscription: async () => {},
} });
mock.module("../src/data/postgres-user-store", { namedExports: {
  pgFindUserById: async () => ({ _id: "user-A", email: "offline@example.invalid" }),
} });
mock.module("../src/data/postgres-tv-store", { namedExports: {
  listSubscriptionPlans: async () => plans, getSubscriptionPlan: async () => plans[0],
  bindTvSubscriptionCheckout: async () => true,
  confirmTvPremiumEntitlement: async () => false, completeTvSubscription: async () => {}, createTvCode: async () => {},
  getTvCode: async (kind: string, code: string, deviceId?: string) => {
    assert.equal(kind, "subscription");
    if (code !== "123456" || deviceId && deviceId !== "real-TV-device") return null;
    return { id: "issuance-A", status: "completed", userId: "user-A", plan: "premium_monthly" };
  },
  tvSubscriptionToken: async () => "offline-test-token",
} });
const { registerStripeSubscriptionRoutes, formatSubscriptionStatus } = await import("../src/routes/stripe-subscription-routes");
const { validPaddleCustomData } = await import("../src/services/paddle-billing");
describe("Paddle checkout, portal and TV HTTP contracts", () => {
  let server: Server, base: string;
  before(async () => {
    const app = express();
    app.use(express.json({ verify: (req, _res, body) => { if (req.headers["x-no-raw"] !== "1") (req as any).rawBody = body.toString("utf8"); } }));
    const requireAuth: express.RequestHandler = (req, res, next) => {
      if (req.headers["x-offline-auth"] !== "yes") return void res.status(401).json({ error: "Unauthorized" });
      (req as any).userId = "user-A"; next();
    };
    registerStripeSubscriptionRoutes(app, { requireAuth, requireAdmin: requireAuth });
    server = await new Promise<Server>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  beforeEach(() => { subscription = null; priceFails = false; archived = false; period = { interval: "month", frequency: 1 }; portalCalls.length = 0; });
  const post = (path: string, body: any = {}, auth = true, extra: any = {}) => fetch(base + path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...(auth ? { "x-offline-auth": "yes" } : {}), ...extra } });
  it("requires normal authentication for checkout and portal", async () => {
    for (const path of ["/api/subscription/checkout", "/api/subscription/portal"]) assert.equal((await post(path, {}, false)).status, 401);
    assert.equal(portalCalls.length, 0);
  });
  it("returns signed checkout data and preserves a strict localized success URL", async () => {
    const response = await post("/api/subscription/checkout", { plan: "premium_monthly", locale: "de" });
    assert.equal(response.status, 200);
    const { paddleCheckout: checkout } = await response.json() as any;
    assert.equal(checkout.successUrl, "https://themegaradio.com/de/premium/success");
    assert.equal(checkout.environment, "sandbox");
    assert.equal(validPaddleCustomData("offline_secret", checkout.customData), true);
    assert.equal(checkout.customData.userId, "user-A"); assert.equal(checkout.priceId, "pri_test");
    for (const locale of ["//evil.invalid", "de/../en", "xx", {}, "am"]) assert.equal((await post("/api/subscription/checkout", { plan: "premium_monthly", locale })).status, 400);
  });
  it("does not return checkout data for forbidden, archived or mismatched Paddle prices", async () => {
    priceFails = true;
    assert.equal((await post("/api/subscription/checkout", { plan: "premium_monthly" })).status, 503);
    priceFails = false; archived = true;
    assert.equal((await post("/api/subscription/checkout", { plan: "premium_monthly" })).status, 503);
    archived = false; period = null;
    assert.equal((await post("/api/subscription/checkout", { plan: "premium_monthly" })).status, 503);
  });
  it("prevents a second charge for an already active entitlement, but permits expired subscribers", async () => {
    subscription = { plan: "premium_monthly", isActive: true, expiresAt: new Date(Date.now() + 60000) };
    const response = await post("/api/subscription/checkout", { plan: "premium_monthly" });
    assert.equal(response.status, 409); assert.equal((await response.json() as any).code, "already_subscribed");
    subscription.expiresAt = "2020-01-01T00:00:00Z";
    assert.equal((await post("/api/subscription/checkout", { plan: "premium_monthly" })).status, 200);
  });
  it("creates a no-store portal only for the authenticated native billing account, ignoring attacker IDs", async () => {
    subscription = { platform: "paddle", paddleCustomerId: "ctm_owner", paddleSubscriptionId: "sub_owner" };
    const response = await post("/api/subscription/portal", { customerId: "ctm_victim", userId: "victim", subscriptionId: "sub_victim" });
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.deepEqual(portalCalls, [["ctm_owner", ["sub_owner"]]]);
    subscription = { platform: "apple" };
    assert.equal((await post("/api/subscription/portal")).status, 404);
  });
  it("never publishes TV user/token details to web-activate or mismatched devices", async () => {
    for (const query of ["", "?deviceId=web-activate"]) {
      const response = await fetch(base + "/api/subscription/tv/code/123456/status" + query);
      assert.deepEqual(await response.json(), { status: "activated" });
    }
    const wrong = await fetch(base + "/api/subscription/tv/code/123456/status?deviceId=other-device");
    assert.deepEqual(await wrong.json(), { status: "not_found" });
    subscription = { plan: "premium_monthly", isActive: false };
    const matched = await fetch(base + "/api/subscription/tv/code/123456/status?deviceId=real-TV-device");
    const body = await matched.json() as any;
    assert.equal(body.subscription.tier, "free"); assert.equal(body.user.token, "offline-test-token");
  });
  it("keeps verified one-time Remove Ads ad-free but non-premium across status and TV polling", async () => {
    const purchased = { plan: "remove_ads", platform: "paddle", paddleBillingKind: "one_time", expiresAt: null, paddleSubscriptionId: null, isActive: true };
    for (const [patch, adFree] of [
      [{}, true], [{ isActive: false }, false], [{ paddleBillingKind: undefined }, false],
      [{ expiresAt: "invalid" }, false], [{ paddleSubscriptionId: "sub_recurring" }, false],
    ] as const) {
      subscription = { ...purchased, ...patch };
      const expected = { tier: "free", status: "active", adFree };
      const status = await fetch(base + "/api/subscription/status", { headers: { "x-offline-auth": "yes" } });
      assert.equal(status.status, 200);
      assert.deepEqual(await status.json(), expected);
      const tv = await fetch(base + "/api/subscription/tv/code/123456/status?deviceId=real-TV-device");
      assert.equal(tv.status, 200);
      const body = await tv.json() as any;
      assert.deepEqual(body.subscription, expected);
      assert.equal(body.status, "activated");
    }
  });
  it("requires the untouched raw webhook body and a valid signature", async () => {
    assert.equal((await post("/api/webhooks/paddle", {}, false, { "x-no-raw": "1", "paddle-signature": "invalid" })).status, 400);
    assert.equal((await post("/api/webhooks/paddle", {}, false, { "paddle-signature": "invalid" })).status, 400);
  });
  it("uses expiry and a fixed entitlement allowlist in subscription status", () => {
    for (const sub of [
      { plan: "premium_monthly", isActive: true, expiresAt: "2020-01-01T00:00:00Z" },
      { plan: "arbitrary_admin", isActive: true },
      { plan: "premium_yearly", isActive: true, expiresAt: "invalid" },
    ]) assert.equal(formatSubscriptionStatus(sub).tier, "free");
    assert.equal(formatSubscriptionStatus({ plan: "remove_ads", isActive: true }).adFree, false);
    assert.equal(formatSubscriptionStatus({
      plan: "remove_ads", isActive: true, platform: "paddle", paddleBillingKind: "one_time", expiresAt: null,
    }).adFree, true);
  });
});
