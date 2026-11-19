import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import { listSubscriptionPlans, saveSubscriptionPlan, type StripePlanId } from "../data/postgres-tv-store";
import { logger } from "../utils/logger";
import { publicPaddlePlanCatalog } from "../services/paddle-plan-catalog";
import { validateSubscriptionPlanUpdate } from "../utils/admin-account-validation";

const DEFAULT_PLANS: Array<{ planId: StripePlanId; label: string; description: string }> = [
  { planId: "remove_ads",      label: "Remove Ads", description: "Ad-free listening, no premium extras" },
  { planId: "premium_monthly", label: "Monthly",    description: "Billed monthly, cancel anytime" },
  { planId: "premium_quarterly", label: "Quarterly", description: "Billed every 3 months, cancel anytime" },
  { planId: "premium_yearly",  label: "Annual",     description: "Best value — save vs monthly" },
  { planId: "premium_lifetime", label: "Lifetime",  description: "One-time payment, never pay again" },
];

// Seed default plans on first boot if collection is empty
async function seedDefaultPlans() {
  try {
    const envPriceIds: Record<StripePlanId, string | undefined> = {
      remove_ads: process.env.STRIPE_PRICE_REMOVE_ADS,
      premium_monthly: process.env.STRIPE_PRICE_MONTHLY,
      premium_quarterly: process.env.STRIPE_PRICE_QUARTERLY,
      premium_yearly: process.env.STRIPE_PRICE_ANNUAL,
      premium_lifetime: process.env.STRIPE_PRICE_LIFETIME,
    };
    await Promise.all(DEFAULT_PLANS.map(p => saveSubscriptionPlan(p.planId, {
        stripePriceId: envPriceIds[p.planId] || "",
        label: p.label,
        description: p.description,
        currency: "usd",
        amount: 0,
        isActive: true,
        updatedAt: new Date(),
      }, true)));
    logger.log("[StripeConfig] Default subscription plans seeded");
  } catch (err: any) {
    logger.warn("[StripeConfig] Seed failed (non-critical):", err?.message);
  }
}

export function registerStripePlanAdminRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // Seed on registration (non-blocking)
  seedDefaultPlans().catch(() => {});

  // ── Public: /activate page fetches plan list ───────────────────────────────
  app.get("/api/subscription/plans", async (_req: Request, res: Response) => {
    try {
      if (process.env.PAYMENT_PROVIDER === "paddle") {
        return void res.json(await publicPaddlePlanCatalog(await listSubscriptionPlans()));
      }
      const plans = (await listSubscriptionPlans(true)).map(({ _id, planId, label, description, currency, amount }) => ({ _id, planId, label, description, currency, amount }));
      res.json({ plans });
    } catch (err: any) {
      // Fallback to hardcoded defaults so /activate always works
      res.json({
        ...(process.env.PAYMENT_PROVIDER === "paddle" ? { providerConfigured: !!(process.env.PADDLE_API_KEY && process.env.PADDLE_WEBHOOK_SECRET && (process.env.PADDLE_CLIENT_TOKEN || process.env.VITE_PADDLE_CLIENT_TOKEN)), providerAvailable: false } : {}),
        plans: DEFAULT_PLANS.map(p => ({
          planId: p.planId,
          label: p.label,
          description: p.description,
          currency: "usd",
          amount: 0,
          ...(process.env.PAYMENT_PROVIDER === "paddle" ? { checkoutAvailable: false, billingInterval: null, billingFrequency: null } : {}),
        })),
      });
    }
  });

  // ── Admin: list all plans (including inactive) ─────────────────────────────
  app.get("/api/admin/stripe-plans", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const plans = await listSubscriptionPlans();
      res.json({ plans });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch plans" });
    }
  });

  // ── Admin: update a single plan ────────────────────────────────────────────
  app.put("/api/admin/stripe-plans/:planId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const planId = String(req.params.planId);
      const VALID_PLANS: StripePlanId[] = ["remove_ads", "premium_monthly", "premium_quarterly", "premium_yearly", "premium_lifetime"];
      if (!VALID_PLANS.includes(planId as StripePlanId)) {
        return void res.status(400).json({ error: "Invalid planId" });
      }

      const validation = validateSubscriptionPlanUpdate(req.body);
      if (validation.error) return void res.status(400).json({ error: validation.error });
      const update = { ...validation.value, updatedAt: new Date() };

      const plan = await saveSubscriptionPlan(planId as StripePlanId, update);

      logger.log(`[StripeConfig] Plan ${planId} updated by admin`);
      res.json({ success: true, plan });
    } catch (err: any) {
      logger.error("[StripeConfig] Update error:", err.message);
      res.status(500).json({ error: "Failed to update plan" });
    }
  });

  // ── Admin: verify a Stripe price ID against live Stripe ───────────────────
  app.post("/api/admin/stripe-plans/verify-price", requireAdmin, async (req: Request, res: Response) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return void res.status(503).json({ error: "STRIPE_SECRET_KEY not configured" });
    }
    try {
      const { priceId } = req.body;
      if (!priceId || typeof priceId !== "string") {
        return void res.status(400).json({ error: "priceId is required" });
      }
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
      const price = await stripe.prices.retrieve(priceId);
      res.json({
        valid: true,
        currency: price.currency,
        unitAmount: price.unit_amount,
        recurring: (price as any).recurring ?? null,
        active: price.active,
        nickname: price.nickname,
      });
    } catch (err: any) {
      res.status(400).json({ valid: false, error: err?.message || "Price not found in Stripe" });
    }
  });

  // ── Admin: verify a Paddle price ID against live Paddle ───────────────────
  app.post("/api/admin/stripe-plans/verify-paddle-price", requireAdmin, async (req: Request, res: Response) => {
    const paddleKey = process.env.PADDLE_API_KEY;
    if (!paddleKey) {
      return void res.status(503).json({ error: "PADDLE_API_KEY not configured" });
    }
    try {
      const { priceId } = req.body;
      if (!priceId || typeof priceId !== "string") {
        return void res.status(400).json({ error: "priceId is required" });
      }
      const paddle = new Paddle(paddleKey, { environment: Environment.production });
      const price = await paddle.prices.get(priceId);
      const unitPrice = (price as any)?.unitPrice ?? (price as any)?.unit_price;
      res.json({
        valid: true,
        currency: unitPrice?.currencyCode ?? null,
        unitAmount: unitPrice?.amount ? parseInt(unitPrice.amount, 10) : null,
        billingCycle: (price as any)?.billingCycle ?? null,
        active: (price as any)?.status === "active",
        name: (price as any)?.name ?? null,
      });
    } catch (err: any) {
      res.status(400).json({ valid: false, error: err?.message || "Price not found in Paddle" });
    }
  });
}
