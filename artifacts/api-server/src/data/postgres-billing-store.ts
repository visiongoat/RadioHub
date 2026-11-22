import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { getPostgresPool } from "../postgres-runtime";
import { ensurePostgresUser } from "./auth-token-store";

export const billingStore: string = "postgres";

export interface BillingEvent {
  provider: "apple" | "google" | "stripe" | "paddle";
  providerEventId: string;
  userId?: string | null;
  eventType: string;
  status: string;
  plan?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  occurredAt?: Date;
  payload: Record<string, unknown>;
}

function value<T>(input: T | undefined, fallback: T): T {
  return input === undefined ? fallback : input;
}

export async function pgGetSubscription(userId: string): Promise<Record<string, any> | null> {
  const result = await getPostgresPool().query("SELECT * FROM subscriptions WHERE user_id=$1", [userId]);
  return subscriptionFromRow(result.rows[0]);
}

function subscriptionFromRow(row: Record<string, any> | undefined): Record<string, any> | null {
  if (!row) return null;
  return {
    ...(row.provider_data || {}), plan: row.plan, platform: row.platform,
    subscriptionStatus: row.status, productId: row.product_id, transactionId: row.transaction_id,
    originalTransactionId: row.original_transaction_id, purchaseToken: row.purchase_token,
    stripeCustomerId: row.stripe_customer_id, stripeSubscriptionId: row.stripe_subscription_id,
    paddleCustomerId: row.paddle_customer_id, paddleSubscriptionId: row.paddle_subscription_id,
    isActive: row.is_active, isTrial: row.is_trial, expiresAt: row.expires_at,
    renewsAt: row.renews_at, startedAt: row.started_at, cancelledAt: row.cancelled_at,
    lastVerifiedAt: row.last_verified_at,
  };
}

export async function pgFindSubscriptionUser(criteria: {
  originalTransactionId?: string;
  purchaseToken?: string;
  stripeSubscriptionId?: string;
  paddleSubscriptionId?: string;
}): Promise<string | null> {
  const entries = Object.entries(criteria).filter(([, candidate]) => !!candidate);
  if (!entries.length) return null;
  const columns: Record<string, string> = {
    originalTransactionId: "original_transaction_id", purchaseToken: "purchase_token",
    stripeSubscriptionId: "stripe_subscription_id", paddleSubscriptionId: "paddle_subscription_id",
  };
  const clauses = entries.map(([key], index) => `${columns[key]}=$${index + 1}`);
  const result = await getPostgresPool().query(
    `SELECT user_id FROM subscriptions WHERE ${clauses.join(" OR ")} LIMIT 1`,
    entries.map(([, candidate]) => candidate),
  );
  return result.rows[0]?.user_id || null;
}

export async function pgUpsertSubscription(userId: string, patch: Record<string, any>): Promise<void> {
  await ensurePostgresUser(userId);
  await withLockedSubscription(userId, async (client, current) => {
    const verifiedPatch = {...patch};
    if (verifiedPatch.appleSignedProof === true) {
      // Signature validity is not current refund state. A restore of an older
      // StoreKit JWS must not reactivate or replace a newer Apple webhook.
      // This comparison belongs under the same row lock as the entitlement write.
      const incoming = new Date(verifiedPatch.lastSignedDate || 0).getTime();
      const stored = Math.max(new Date(current.lastSignedDate || 0).getTime() || 0,
        current.isActive === false ? new Date(current.cancelledAt || 0).getTime() || 0 : 0);
      if (!Number.isFinite(incoming) || incoming <= 0 || stored > incoming || (current.isActive === false && stored >= incoming)) {
        throw Object.assign(new Error('A newer Apple subscription state supersedes this transaction'), {code:'apple_stale_proof'});
      }
    }
    delete verifiedPatch.appleSignedProof;
    await writeSubscription(client, userId, current, verifiedPatch);
  });
}

async function withLockedSubscription<T>(
  userId: string,
  operation: (client: PoolClient, current: Record<string, any>) => Promise<T>,
  paddle?: PaddleEventIdentity,
): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    // Serialize claims on provider identities across different application users.
    // The per-user row lock alone cannot protect the first cross-user insert.
    if (paddle) for (const key of [paddle.customerId, paddle.subscriptionId, paddle.transactionId].filter(Boolean).sort()) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('paddle-billing'),hashtext($1))", [key]);
    }
    // The parent row exists even before the first subscription is inserted.
    // Locking it serializes the read/merge/write path for every billing writer.
    const owner = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!owner.rowCount) throw new Error("Subscription owner no longer exists");
    const result = await client.query("SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE", [userId]);
    const outcome = await operation(client, subscriptionFromRow(result.rows[0]) || {});
    await client.query("COMMIT");
    return outcome;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function writeSubscription(
  client: PoolClient, userId: string, current: Record<string, any>, patch: Record<string, any>,
): Promise<void> {
  const next = { ...current, ...patch };
  for (const [key, candidate] of Object.entries(next)) {
    if (candidate === undefined) delete next[key];
  }
  const nextStatus = patch.subscriptionStatus !== undefined
    ? patch.subscriptionStatus
    : patch.isActive !== undefined
      ? (patch.isActive ? "active" : "inactive")
      : value(next.subscriptionStatus, next.isActive ? "active" : "inactive");
  await client.query(
    `INSERT INTO subscriptions(user_id,plan,platform,status,product_id,transaction_id,
       original_transaction_id,purchase_token,stripe_customer_id,stripe_subscription_id,
       paddle_customer_id,paddle_subscription_id,is_active,is_trial,expires_at,renews_at,
       started_at,cancelled_at,last_verified_at,provider_data)
     VALUES (${Array.from({ length: 20 }, (_, index) => `$${index + 1}`).join(",")})
     ON CONFLICT (user_id) DO UPDATE SET plan=EXCLUDED.plan,platform=EXCLUDED.platform,
       status=EXCLUDED.status,product_id=EXCLUDED.product_id,transaction_id=EXCLUDED.transaction_id,
       original_transaction_id=EXCLUDED.original_transaction_id,purchase_token=EXCLUDED.purchase_token,
       stripe_customer_id=EXCLUDED.stripe_customer_id,stripe_subscription_id=EXCLUDED.stripe_subscription_id,
       paddle_customer_id=EXCLUDED.paddle_customer_id,paddle_subscription_id=EXCLUDED.paddle_subscription_id,
       is_active=EXCLUDED.is_active,is_trial=EXCLUDED.is_trial,expires_at=EXCLUDED.expires_at,
       renews_at=EXCLUDED.renews_at,started_at=EXCLUDED.started_at,cancelled_at=EXCLUDED.cancelled_at,
       last_verified_at=EXCLUDED.last_verified_at,provider_data=EXCLUDED.provider_data`,
    [userId, value(next.plan, "none"), next.platform || null,
      nextStatus, next.productId || null,
      next.transactionId || null, next.originalTransactionId || null, next.purchaseToken || null,
      next.stripeCustomerId || null, next.stripeSubscriptionId || null, next.paddleCustomerId || null,
      next.paddleSubscriptionId || null, !!next.isActive, !!next.isTrial, next.expiresAt || null,
      next.renewsAt || null, next.startedAt || null, next.cancelledAt || null,
      next.lastVerifiedAt || null, JSON.stringify(next)],
  );
}

export interface SubscriptionEventOrder {
  field: "lastSignedDate" | "lastGoogleEventTime" | "lastStripeEventTime" | "lastPaddleSubscriptionTime" | "lastPaddleTransactionTime" | "lastPaddleAdjustmentTime";
  timestamp: number;
  isDowngrade: boolean;
}

interface PaddleEventIdentity {
  customerId: string;
  subscriptionId?: string;
  transactionId?: string;
  allowBinding: boolean;
  kind: "subscription" | "transaction" | "adjustment";
}

export async function pgFindPaddleSubscriptionUser(identity: { customerId: string; subscriptionId?: string; transactionId?: string }): Promise<string | null> {
  const result = await getPostgresPool().query(`SELECT DISTINCT user_id FROM subscriptions
    WHERE paddle_customer_id=$1 OR (NULLIF($2,'') IS NOT NULL AND paddle_subscription_id=$2)
      OR (NULLIF($3,'') IS NOT NULL AND platform='paddle' AND transaction_id=$3) LIMIT 2`,
  [identity.customerId, identity.subscriptionId || "", identity.transactionId || ""]);
  // Ambiguous legacy data must be reviewed, never choose an arbitrary owner.
  return result.rows.length === 1 ? result.rows[0].user_id : null;
}

/**
 * Commit the subscription and its delivery receipt together. Retries cannot
 * acknowledge an uncommitted write or replay an already committed event.
 */
export async function pgApplySubscriptionEvent(
  userId: string,
  patch: Record<string, any>,
  event: BillingEvent,
  options: { order?: SubscriptionEventOrder; paddle?: PaddleEventIdentity } = {},
): Promise<"applied" | "duplicate" | "stale"> {
  if (!event.providerEventId) throw new Error("Billing delivery requires a stable provider event ID");
  if (event.userId && event.userId !== userId) throw new Error("Billing event owner does not match subscription");
  await ensurePostgresUser(userId);
  return withLockedSubscription(userId, async (client, current) => {
    const recorded = await insertBillingEvent(client, { ...event, userId });
    if (recorded === "duplicate") return "duplicate";

    const markStale = async () => {
      await client.query("UPDATE payment_events SET status='stale' WHERE provider=$1 AND provider_event_id=$2", [event.provider, event.providerEventId]);
      return "stale" as const;
    };
    const paddle = options.paddle;
    if (paddle) {
      if (event.provider !== "paddle") throw new Error("Paddle identity guard requires a Paddle event");
      const conflicts = await client.query(`SELECT 1 FROM subscriptions WHERE user_id<>$1 AND
        (paddle_customer_id=$2 OR (NULLIF($3,'') IS NOT NULL AND paddle_subscription_id=$3)
        OR (NULLIF($4,'') IS NOT NULL AND platform='paddle' AND transaction_id=$4)) LIMIT 1`,
      [userId, paddle.customerId, paddle.subscriptionId || "", paddle.transactionId || ""]);
      if (conflicts.rowCount) return markStale();
      if (current.paddleCustomerId && current.paddleCustomerId !== paddle.customerId && !paddle.allowBinding) return markStale();
      if (!paddle.allowBinding && (current.platform !== "paddle" || current.paddleCustomerId !== paddle.customerId ||
          (paddle.subscriptionId && current.paddleSubscriptionId !== paddle.subscriptionId) ||
          (paddle.kind === "adjustment" && current.transactionId !== paddle.transactionId))) return markStale();
      // A delayed initial transaction must not replace a newer purchase/provider.
      if (paddle.allowBinding && current.startedAt && event.occurredAt &&
          new Date(current.startedAt).getTime() > event.occurredAt.getTime()) return markStale();
    }

    const order = options.order;
    const storedTime = order ? new Date(current[order.field] || 0).getTime() : 0;
    if (order && (event.provider === "paddle" || !order.isDowngrade) && order.timestamp > 0 && storedTime > order.timestamp) {
      await client.query(
        "UPDATE payment_events SET status='stale' WHERE provider=$1 AND provider_event_id=$2",
        [event.provider, event.providerEventId],
      );
      return "stale";
    }
    const orderedPatch = { ...patch };
    if (paddle?.kind === "transaction") {
      // Transaction processing can finish after subscription.canceled. Once a
      // lifecycle event exists, it alone owns recurring entitlement state.
      if (paddle.subscriptionId && current.paddleSubscriptionId === paddle.subscriptionId && current.lastPaddleSubscriptionTime) {
        for (const key of ["isActive", "isTrial", "subscriptionStatus", "expiresAt", "renewsAt", "cancelAtPeriodEnd", "cancelledAt", "startedAt", "plan", "productId", "paddleBillingKind"]) delete orderedPatch[key];
      }
      if (paddle.transactionId !== current.transactionId) {
        orderedPatch.paddleRefundedTransactionId = null;
        // Renewal lifecycle and payment events can arrive in either order. If
        // the new period is already verified active, a *different paid* transaction
        // can release the previous period's refund hold, never a canceled plan.
        if (current.paddleRefundedTransactionId && current.paddleSubscriptionId === paddle.subscriptionId &&
            ["active", "trialing", "past_due"].includes(current.subscriptionStatus) &&
            current.expiresAt && new Date(current.expiresAt).getTime() > Date.now()) orderedPatch.isActive = true;
      }
      // A refund may precede the original payment webhook. Its verified receipt
      // is durable even when there was no linked local subscription at that time.
      const refunded = await client.query(`SELECT 1 FROM payment_events WHERE provider='paddle'
        AND event_type IN ('adjustment.created','adjustment.updated')
        AND payload->'data'->>'transaction_id'=$1 AND payload->'data'->>'status'='approved'
        AND payload->'data'->>'type'='full' AND payload->'data'->>'action' IN ('refund','chargeback') LIMIT 1`, [paddle.transactionId]);
      if (refunded.rowCount) Object.assign(orderedPatch, { isActive: false, subscriptionStatus: "canceled", renewsAt: null, paddleRefundedTransactionId: paddle.transactionId });
    }
    if (paddle?.kind === "subscription" && current.paddleRefundedTransactionId && current.paddleRefundedTransactionId === current.transactionId) {
      orderedPatch.isActive = false;
    }
    // A late revocation still removes access, but never rewinds the high-water
    // timestamp and thereby allows an even older upgrade on its next delivery.
    if (order && Number.isFinite(order.timestamp) && order.timestamp > 0) {
      orderedPatch[order.field] = new Date(Math.max(order.timestamp, storedTime || 0));
    }
    await writeSubscription(client, userId, current, orderedPatch);
    return "applied";
  }, options.paddle);
}

export async function pgRecordBillingEvent(event: BillingEvent): Promise<"inserted" | "duplicate"> {
  if (event.userId) await ensurePostgresUser(event.userId);
  return insertBillingEvent(getPostgresPool(), event);
}

async function insertBillingEvent(client: Pick<PoolClient, "query">, event: BillingEvent): Promise<"inserted" | "duplicate"> {
  const result = await client.query(
    `INSERT INTO payment_events(id,provider,provider_event_id,user_id,event_type,status,plan,
       amount_minor,currency,occurred_at,payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (provider,provider_event_id) DO NOTHING RETURNING id`,
    [crypto.randomUUID(), event.provider, event.providerEventId, event.userId || null,
      event.eventType, event.status, event.plan || null, event.amountMinor ?? null,
      event.currency || null, event.occurredAt || new Date(), JSON.stringify(event.payload)],
  );
  return result.rowCount ? "inserted" : "duplicate";
}

export interface IapAuditFilters {
  userId?: string;
  result?: string;
  platform?: string;
  productId?: string;
  originalTransactionId?: string;
  from?: Date | null;
  to?: Date | null;
  page: number;
  limit: number;
}

const iapAuditPredicate = `(event_type='iap_audit' OR payload ? 'result')`;
const iapPlatformExpression = `COALESCE(NULLIF(payload->>'platform',''),
  CASE WHEN provider='google' THEN 'android' WHEN provider='apple' THEN 'ios' ELSE provider END)`;

export async function pgListIapAuditEvents(filters: IapAuditFilters): Promise<{ items: any[]; total: number }> {
  const limit = Math.max(1, Math.min(Number(filters.limit) || 50, 500));
  const page = Math.max(1, Number(filters.page) || 1);
  const values: unknown[] = [];
  const conditions = [iapAuditPredicate];
  const bind = (candidate: unknown) => { values.push(candidate); return `$${values.length}`; };
  if (filters.userId) conditions.push(`e.user_id=${bind(filters.userId)}`);
  if (filters.result) conditions.push(`COALESCE(NULLIF(e.payload->>'result',''),e.status)=${bind(filters.result)}`);
  if (filters.platform) conditions.push(`${iapPlatformExpression}=${bind(filters.platform)}`);
  if (filters.productId) conditions.push(`e.payload->>'productId'=${bind(filters.productId)}`);
  if (filters.originalTransactionId) conditions.push(`e.payload->>'originalTransactionId'=${bind(filters.originalTransactionId)}`);
  if (filters.from) conditions.push(`e.occurred_at>=${bind(filters.from)}`);
  if (filters.to) conditions.push(`e.occurred_at<=${bind(filters.to)}`);
  const where = `WHERE ${conditions.join(" AND ")}`;
  const count = await getPostgresPool().query<{ count: string }>(
    `SELECT count(*)::text count FROM payment_events e ${where}`,
    values,
  );
  const rowValues = [...values, limit, (page - 1) * limit];
  const result = await getPostgresPool().query(
    `SELECT e.*,${iapPlatformExpression} normalized_platform,u.email,u.full_name
     FROM payment_events e LEFT JOIN users u ON u.id=e.user_id ${where}
     ORDER BY e.occurred_at DESC,e.id DESC
     LIMIT $${rowValues.length - 1} OFFSET $${rowValues.length}`,
    rowValues,
  );
  return {
    total: Number(count.rows[0]?.count || 0),
    items: result.rows.map((row) => ({
      ...(row.payload || {}), _id: row.id, userId: row.user_id,
      platform: row.normalized_platform, result: row.payload?.result || row.status,
      plan: row.plan || row.payload?.plan || "", createdAt: row.occurred_at,
      user: row.user_id ? { email: row.email, fullName: row.full_name } : null,
    })),
  };
}

export async function pgIapAuditStats(since: Date): Promise<Record<string, number>> {
  const result = await getPostgresPool().query<{ result: string; count: string }>(
    `SELECT COALESCE(NULLIF(payload->>'result',''),status) result,count(*)::text count
     FROM payment_events WHERE ${iapAuditPredicate} AND occurred_at>=$1 GROUP BY 1`,
    [since],
  );
  return Object.fromEntries(result.rows.map((row) => [row.result, Number(row.count)]));
}

export async function pgSalesAnalytics(options: {
  from: Date; to: Date; platform: string; plan: string; groupBy: string;
}): Promise<any> {
  const bucket = options.groupBy === "month"
    ? `to_char(date_trunc('month',occurred_at),'YYYY-MM')`
    : options.groupBy === "week"
      ? `to_char(date_trunc('week',occurred_at),'IYYY-"W"IW')`
      : `to_char(date_trunc('day',occurred_at),'YYYY-MM-DD')`;
  const baseValues: unknown[] = [options.from, options.to, options.platform, options.plan];
  const iapConditions = [iapAuditPredicate,
    "COALESCE(NULLIF(payload->>'result',''),status)='success'", "occurred_at BETWEEN $1 AND $2",
    `$3<>'stripe' AND ($3='all' OR ${iapPlatformExpression}=$3)`,
    "($4='all' OR COALESCE(plan,payload->>'plan')=$4)",
  ];
  const saleConditions = ["provider=ANY(ARRAY['stripe','paddle'])", "amount_minor IS NOT NULL",
    // Lifecycle/refund/ignored deliveries are audit evidence, not sales.
    `(status IN ('processed','success','paid','completed','recorded') AND (
      (provider='stripe' AND event_type IN ('checkout.session.completed','checkout.session.async_payment_succeeded')
        AND (COALESCE(payload#>>'{data,object,payment_status}','paid')='paid' OR amount_minor=0 AND payload#>>'{data,object,payment_status}'='no_payment_required'))
      OR (provider='paddle' AND event_type='transaction.completed')
      OR (provider='stripe' AND origin='mongo_migration' AND COALESCE(payload->>'stripeSessionId','')<>'')))`,
    "amount_minor>=0",
    "occurred_at BETWEEN $1 AND $2", "$3=ANY(ARRAY['all','stripe'])",
    "($4='all' OR COALESCE(plan,payload->>'plan')=$4)",
  ];
  const iapWhere = iapConditions.join(" AND ");
  const saleWhere = saleConditions.join(" AND ");
  const query = (sql: string) => getPostgresPool().query(sql, baseValues);
  const [iapCount, iapPlan, iapPlatform, iapTimeline, saleSummary, salePlan, saleTimeline, recent] = await Promise.all([
    query(`SELECT count(*)::int count FROM payment_events WHERE ${iapWhere}`),
    query(`SELECT COALESCE(plan,payload->>'plan','unknown') _id,count(*)::int count FROM payment_events WHERE ${iapWhere} GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT ${iapPlatformExpression} _id,count(*)::int count FROM payment_events WHERE ${iapWhere} GROUP BY 1`),
    query(`SELECT ${bucket} date,COALESCE(plan,payload->>'plan','unknown') plan,count(*)::int count FROM payment_events WHERE ${iapWhere} GROUP BY 1,2 ORDER BY 1`),
    query(`SELECT count(*)::int count,COALESCE(sum(amount_minor),0)::bigint total_amount,
      NULLIF(lower(currency),'') currency FROM payment_events WHERE ${saleWhere} GROUP BY 3 ORDER BY 3`),
    query(`SELECT COALESCE(plan,payload->>'plan','unknown') _id,count(*)::int count,
      CASE WHEN count(DISTINCT COALESCE(NULLIF(lower(currency),''),'unknown'))=1 THEN sum(amount_minor)::bigint END total,
      CASE WHEN count(DISTINCT COALESCE(NULLIF(lower(currency),''),'unknown'))=1 THEN min(NULLIF(lower(currency),'')) END currency
      FROM payment_events WHERE ${saleWhere} GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT ${bucket} date,COALESCE(plan,payload->>'plan','unknown') plan,count(*)::int count,
      CASE WHEN count(DISTINCT COALESCE(NULLIF(lower(currency),''),'unknown'))=1 THEN sum(amount_minor)::bigint END amount,
      CASE WHEN count(DISTINCT COALESCE(NULLIF(lower(currency),''),'unknown'))=1 THEN min(NULLIF(lower(currency),'')) END currency
      FROM payment_events WHERE ${saleWhere} GROUP BY 1,2 ORDER BY 1`),
    query(`SELECT * FROM payment_events WHERE (${iapWhere}) OR (${saleWhere}) ORDER BY occurred_at DESC LIMIT 50`),
  ]);
  const iapRows = iapTimeline.rows.map((row) => ({ _id: { date: row.date, plan: row.plan }, count: row.count }));
  const saleRows = saleTimeline.rows.map((row) => ({ _id: { date: row.date, plan: row.plan }, count: row.count, amount: row.amount === null ? null : Number(row.amount), currency: row.currency }));
  const byCurrency = saleSummary.rows.map(row => ({ currency: row.currency, count: row.count, amount: Number(row.total_amount) }));
  return {
    iap: { count: iapCount.rows[0]?.count || 0, byPlan: iapPlan.rows, byPlatform: iapPlatform.rows, timeline: iapRows },
    sales: {
      count: byCurrency.reduce((sum, row) => sum + row.count, 0),
      totalAmount: byCurrency.length === 1 && byCurrency[0].currency ? byCurrency[0].amount : byCurrency.length ? null : 0,
      currency: byCurrency.length === 1 ? byCurrency[0].currency : null, byCurrency,
      byPlan: salePlan.rows.map((row) => ({ ...row, total: row.total === null ? null : Number(row.total) })), timeline: saleRows,
    },
    recent: recent.rows.map((row) => {
      const isIap = row.event_type === "iap_audit" || row.payload?.result;
      return {
        source: isIap ? "iap" : row.provider, platform: isIap
          ? (row.payload?.platform || (row.provider === "google" ? "android" : "ios")) : row.provider,
        plan: row.plan || row.payload?.plan, productId: row.payload?.productId || null,
        isTrial: !!row.payload?.isTrial, isLifetime: !!row.payload?.isLifetime,
        amount: isIap ? null : row.amount_minor, currency: isIap ? null : row.currency,
        tvCode: row.payload?.tvCode || null, createdAt: row.occurred_at,
      };
    }),
  };
}
