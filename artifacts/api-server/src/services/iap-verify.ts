import { JWT } from "google-auth-library";
import { logger } from "../utils/logger";
import { isAppleSignedTransaction, verifyAppleSignedTransaction } from './apple-signed-transaction';

export type Platform = "ios" | "android" | "tvos" | "macos";
export type PremiumPlan =
  | "none"
  | "remove_ads"
  | "premium_monthly"
  | "premium_quarterly"
  | "premium_yearly"
  | "premium_lifetime";

export const PRODUCT_TO_PLAN: Record<string, PremiumPlan> = {
  megaradio_remove_ads_yearly1: "remove_ads",
  megaradio_premium_monthly1: "premium_monthly",
  megaradio_premium_quarterly: "premium_quarterly",
  megaradio_premium_yearly: "premium_yearly",
  megaradio_premium_lifetime: "premium_lifetime",
};

export const LIFETIME_PRODUCT_IDS = new Set<string>(["megaradio_premium_lifetime"]);

export const PLAN_FEATURES: Record<PremiumPlan, string[]> = {
  none: [],
  remove_ads: ["remove_ads"],
  premium_monthly: ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"],
  premium_quarterly: ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"],
  premium_yearly: ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"],
  premium_lifetime: ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"],
};

export const APPLE_PLATFORMS: ReadonlyArray<Platform> = ["ios", "tvos", "macos"];
export const ALL_PLATFORMS: ReadonlyArray<Platform> = ["ios", "android", "tvos", "macos"];

const APPLE_PROD_URL = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";

export interface ValidationSuccess {
  valid: true;
  expiresAt: number | null;
  originalTransactionId: string;
  isLifetime: boolean;
  productId: string;
  environment?: "production" | "sandbox";
  signedDate?: number;
}

export interface ValidationFailure {
  valid: false;
  error: string;
  code?: string | number;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Normalize legacy/alias platform strings ("mac" -> "macos") and reject unknown.
 * Both /api/iap/validate and /api/user/subscription accept the resulting set.
 */
export function normalizePlatform(raw: unknown): Platform | null {
  if (typeof raw !== "string") return null;
  const v = raw.toLowerCase();
  if (v === "ios") return "ios";
  if (v === "android") return "android";
  if (v === "mac" || v === "macos" || v === "osx") return "macos";
  if (v === "tv" || v === "tvos" || v === "appletv") return "tvos";
  return null;
}

export async function verifyAppleReceipt(
  receipt: string,
  productId: string
): Promise<ValidationResult> {
  if (isAppleSignedTransaction(receipt)) return verifyAppleSignedTransaction(receipt, productId, LIFETIME_PRODUCT_IDS.has(productId));
  const sharedSecret = process.env.APPLE_IAP_SHARED_SECRET;
  if (!sharedSecret) {
    return { valid: false, error: "Apple shared secret not configured", code: "missing_apple_secret" };
  }

  const body = JSON.stringify({
    "receipt-data": receipt,
    password: sharedSecret,
    "exclude-old-transactions": true,
  });

  let env: "production" | "sandbox" = "production";
  let resp: any = null;

  try {
    const r = await fetch(APPLE_PROD_URL, { method: "POST", headers: { "content-type": "application/json" }, body });
    resp = await r.json();
  } catch (err: any) {
    return { valid: false, error: `Apple verifyReceipt request failed: ${err?.message || err}`, code: "apple_network" };
  }

  if (resp?.status === 21007) {
    env = "sandbox";
    try {
      const r2 = await fetch(APPLE_SANDBOX_URL, { method: "POST", headers: { "content-type": "application/json" }, body });
      resp = await r2.json();
    } catch (err: any) {
      return { valid: false, error: `Apple sandbox verifyReceipt failed: ${err?.message || err}`, code: "apple_sandbox_network" };
    }
  }

  if (!resp || resp.status !== 0) {
    return { valid: false, error: `Apple verifyReceipt status ${resp?.status}`, code: resp?.status ?? "apple_unknown" };
  }

  const isLifetime = LIFETIME_PRODUCT_IDS.has(productId);

  if (isLifetime) {
    const inApp: any[] = resp?.receipt?.in_app || [];
    const match = inApp.find((it) => it?.product_id === productId);
    if (!match) {
      return { valid: false, error: `Lifetime productId ${productId} not found in receipt`, code: "apple_not_in_receipt" };
    }
    if (match.cancellation_date_ms || match.cancellation_date) {
      return { valid: false, error: "Lifetime purchase was cancelled/refunded", code: "apple_cancelled" };
    }
    const origTxn = String(match.original_transaction_id || match.transaction_id || "");
    if (!origTxn) {
      return { valid: false, error: "Apple receipt missing original_transaction_id", code: "apple_no_txn" };
    }
    return {
      valid: true,
      expiresAt: null,
      originalTransactionId: origTxn,
      isLifetime: true,
      productId,
      environment: env,
    };
  }

  const latest: any[] = resp?.latest_receipt_info || resp?.receipt?.in_app || [];
  const matches = latest.filter((it) => it?.product_id === productId);
  if (!matches.length) {
    return { valid: false, error: `productId ${productId} not found in receipt`, code: "apple_not_in_receipt" };
  }
  const newest = matches.reduce((a, b) => {
    const ax = Number(a?.expires_date_ms || a?.purchase_date_ms || 0);
    const bx = Number(b?.expires_date_ms || b?.purchase_date_ms || 0);
    return bx > ax ? b : a;
  });

  if (newest?.cancellation_date_ms || newest?.cancellation_date) {
    return { valid: false, error: "Subscription was cancelled/refunded", code: "apple_cancelled" };
  }

  const expiresMs = Number(newest?.expires_date_ms || 0);
  if (!expiresMs) {
    return { valid: false, error: "Apple receipt has no expires_date_ms", code: "apple_no_expiry" };
  }
  if (expiresMs <= Date.now()) {
    return { valid: false, error: "Subscription expired", code: "expired" };
  }

  const origTxn = String(newest.original_transaction_id || newest.transaction_id || "");
  if (!origTxn) {
    return { valid: false, error: "Apple receipt missing original_transaction_id", code: "apple_no_txn" };
  }

  return {
    valid: true,
    expiresAt: expiresMs,
    originalTransactionId: origTxn,
    isLifetime: false,
    productId,
    environment: env,
  };
}

let cachedGoogleClient: JWT | null = null;
function getGoogleAuthClient(): JWT | null {
  if (cachedGoogleClient) return cachedGoogleClient;
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const creds = JSON.parse(raw);
    if (!creds.client_email || !creds.private_key) {
      logger.error("[IAP] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON missing client_email or private_key");
      return null;
    }
    cachedGoogleClient = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
    return cachedGoogleClient;
  } catch (err: any) {
    logger.error("[IAP] Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:", err?.message || err);
    return null;
  }
}

export async function verifyGoogleReceipt(
  purchaseToken: string,
  productId: string
): Promise<ValidationResult> {
  const client = getGoogleAuthClient();
  if (!client) {
    return { valid: false, error: "Google service account not configured", code: "missing_google_creds" };
  }
  const pkg = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  if (!pkg) {
    return { valid: false, error: "GOOGLE_PLAY_PACKAGE_NAME not configured", code: "missing_pkg" };
  }

  const isLifetime = LIFETIME_PRODUCT_IDS.has(productId);
  const path = isLifetime
    ? `applications/${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`
    : `applications/${encodeURIComponent(pkg)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/${path}`;

  let data: any;
  try {
    const resp = await client.request<any>({ url });
    data = resp.data;
  } catch (err: any) {
    const status = err?.response?.status;
    const detail = err?.response?.data?.error?.message || err?.message || String(err);
    return { valid: false, error: `Google API error: ${detail}`, code: status || "google_error" };
  }

  if (isLifetime) {
    if (data?.purchaseState !== 0) {
      return { valid: false, error: `Lifetime purchaseState=${data?.purchaseState}`, code: "google_not_purchased" };
    }
    if (data?.consumptionState === 1) {
      return { valid: false, error: "Lifetime purchase has been consumed", code: "google_consumed" };
    }
    const orderId = String(data?.orderId || "");
    if (!orderId) {
      return { valid: false, error: "Google response missing orderId", code: "google_no_order_id" };
    }
    return {
      valid: true,
      expiresAt: null,
      originalTransactionId: orderId,
      isLifetime: true,
      productId,
    };
  }

  const paymentState = data?.paymentState;
  if (paymentState !== undefined && paymentState !== 1 && paymentState !== 2) {
    return { valid: false, error: `Google subscription paymentState=${paymentState} (not paid)`, code: "google_unpaid" };
  }
  if (data?.cancelReason === 1 && data?.expiryTimeMillis && Number(data.expiryTimeMillis) <= Date.now()) {
    return { valid: false, error: "Subscription cancelled by system (billing failure)", code: "google_billing_failure" };
  }

  const expiresMs = Number(data?.expiryTimeMillis || 0);
  if (!expiresMs) {
    return { valid: false, error: "Google subscription has no expiryTimeMillis", code: "google_no_expiry" };
  }
  if (expiresMs <= Date.now()) {
    return { valid: false, error: "Subscription expired", code: "expired" };
  }

  const txnId = String(data?.orderId || data?.linkedPurchaseToken || purchaseToken);

  return {
    valid: true,
    expiresAt: expiresMs,
    originalTransactionId: txnId,
    isLifetime: false,
    productId,
  };
}

/**
 * Run the right verifier based on platform. Caller must have already
 * normalized platform with normalizePlatform().
 */
export async function verifyReceiptForPlatform(
  platform: Platform,
  receipt: string,
  productId: string
): Promise<ValidationResult> {
  if (APPLE_PLATFORMS.includes(platform)) {
    return verifyAppleReceipt(receipt, productId);
  }
  return verifyGoogleReceipt(receipt, productId);
}
