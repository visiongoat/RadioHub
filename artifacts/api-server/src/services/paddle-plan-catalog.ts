import { validPaddlePrice } from "./paddle-billing";

const envPriceKeys: Record<string, string> = {
  remove_ads: "PADDLE_PRICE_REMOVE_ADS", premium_monthly: "PADDLE_PRICE_MONTHLY", premium_quarterly: "PADDLE_PRICE_QUARTERLY",
  premium_yearly: "PADDLE_PRICE_ANNUAL", premium_lifetime: "PADDLE_PRICE_LIFETIME",
};
export function configuredPaddlePriceId(planId: string, plans: any[]): string | null {
  const lookup = (id: string) => {
    const plan = plans.find(row => row.planId === id);
    // An explicit admin disable must not resurrect the plan via an old env fallback.
    if (plan && !plan.isActive) return null;
    return plan?.paddlePriceId || process.env[envPriceKeys[id]] || null;
  };
  if (!Object.hasOwn(envPriceKeys, planId)) return null;
  const candidate = lookup(planId);
  // A shared price cannot prove which entitlement was paid for. Detect this
  // before taking payment, not only when the webhook arrives.
  return candidate && Object.keys(envPriceKeys).filter(id => lookup(id) === candidate).length === 1 ? candidate : null;
}

const priceCache = new Map<string, { expires: number; promise: Promise<any> }>();
async function readPrice(origin: string, apiKey: string, key: string, priceId: string): Promise<any> {
  const cached = priceCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  // Share both successful reads and unavailable results to avoid a public /plans
  // request stampede against Paddle. No customer/private data enters this cache.
  const promise = (async () => {
    try {
      const response = await fetch(`${origin}/prices/${encodeURIComponent(priceId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return null;
      const { data } = await response.json() as any;
      return data && { ...data, billingCycle: data.billing_cycle,
        unitPrice: { amount: data.unit_price?.amount, currencyCode: data.unit_price?.currency_code } };
    } catch { return null; }
  })();
  if (priceCache.size >= 32) priceCache.clear();
  priceCache.set(key, { expires: Date.now() + 60_000, promise });
  return promise;
}

export async function publicPaddlePlanCatalog(plans: any[]): Promise<{ plans: any[]; providerConfigured: boolean; providerAvailable: boolean }> {
  const sandbox = process.env.PADDLE_ENVIRONMENT === "sandbox";
  const apiKey = process.env.PADDLE_API_KEY;
  const providerConfigured = !!(apiKey && process.env.PADDLE_WEBHOOK_SECRET && (process.env.PADDLE_CLIENT_TOKEN || process.env.VITE_PADDLE_CLIENT_TOKEN));
  const origin = sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  const rows: any[] = [];
  // At most two bounded, single-flight catalog GETs concurrently, no mutations.
  const activePlans = plans.filter(row => row.isActive);
  const readPlan = async (plan: any) => {
    const priceId = configuredPaddlePriceId(plan.planId, plans);
    const price = providerConfigured && priceId ? await readPrice(origin, apiKey!, `${sandbox}:${plan.planId}:${priceId}`, priceId) : null;
    const amount = price && /^\d+$/.test(price.unitPrice?.amount || "") ? Number(price.unitPrice.amount) : null;
    const checkoutAvailable = !!(price && validPaddlePrice(plan.planId, price) && Number.isSafeInteger(amount) && /^[A-Z]{3}$/.test(price.unitPrice?.currencyCode || ""));
    const cycle = checkoutAvailable ? price.billingCycle : null;
    return { _id: plan._id, planId: plan.planId, label: plan.label, description: plan.description,
      amount: checkoutAvailable ? amount : 0, currency: checkoutAvailable ? price.unitPrice.currencyCode.toLowerCase() : plan.currency,
      checkoutAvailable, billingInterval: cycle?.interval === "month" || cycle?.interval === "year" ? cycle.interval : null,
      billingFrequency: cycle?.frequency ?? null };
  };
  for (let index = 0; index < activePlans.length; index += 2) {
    rows.push(...await Promise.all(activePlans.slice(index, index + 2).map(readPlan)));
  }
  return { plans: rows, providerConfigured, providerAvailable: rows.some(row => row.checkoutAvailable) };
}
