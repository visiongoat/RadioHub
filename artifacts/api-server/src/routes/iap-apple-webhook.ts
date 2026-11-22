import type { Express, Request, Response } from "express";
import express from "express";
import crypto from "crypto";
import { APPLE_ROOT_CA_G3_PEM } from "../services/apple-root";
import * as jose from "jose";
import { logger } from "../utils/logger";
import { pgApplySubscriptionEvent, pgFindSubscriptionUser, pgGetSubscription, pgRecordBillingEvent } from "../data/postgres-billing-store";
import { createIapAuditIdentity } from "../data/iap-audit-identity";
import { PRODUCT_TO_PLAN, PLAN_FEATURES, type PremiumPlan, } from "../services/iap-verify";
// =====================================================================
// Apple App Store Server Notifications V2
//
// Apple POSTs `{ signedPayload: <JWS> }` for every subscription lifecycle
// event (renewal, refund, revoke, expire, billing failure, etc.). We MUST:
//   1. Verify the JWS signature using the leaf cert from header.x5c.
//   2. Walk the x5c chain and pin the root to Apple Root CA - G3.
//   3. Recursively verify the nested JWS (signedTransactionInfo,
//      signedRenewalInfo) the same way.
//   4. Idempotently mutate User.subscription based on notificationType.
//   5. Write an IapEvent audit row for every notification (success or fail).
//
// Reference:
//   https://developer.apple.com/documentation/appstoreservernotifications
//   https://www.apple.com/certificateauthority/
// =====================================================================
// Apple Root CA - G3 (production root for x5c chains in V2 notifications).
// Pinned at build time — if Apple ever rotates roots we'll have to update.

const APPLE_ROOT_FINGERPRINT_SHA256 = (() => {
    const cert = new crypto.X509Certificate(APPLE_ROOT_CA_G3_PEM);
    return cert.fingerprint256;
})();
function subscriptionPatch(setOps: Record<string, any>, unsetOps: Record<string, any>): Record<string, any> {
    const patch: Record<string, any> = {};
    for (const [key, value] of Object.entries(setOps))
        patch[key.replace(/^subscription\./, "")] = value;
    for (const key of Object.keys(unsetOps))
        patch[key.replace(/^subscription\./, "")] = null;
    return patch;
}
function der64ToPem(b64: string): string {
    const lines = b64.match(/.{1,64}/g)?.join("\n") || b64;
    return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}
/**
 * Verify a JWS compact-serialized string with x5c chain pinned to Apple Root CA.
 * Returns the decoded JSON payload, or throws if verification fails at any step.
 */
async function verifyAppleJws<T = any>(jws: string): Promise<T> {
    if (typeof jws !== "string" || !jws.includes(".")) {
        throw new Error("Invalid JWS: not a compact JWS string");
    }
    const headerB64 = jws.split(".")[0];
    let header: any;
    try {
        header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    }
    catch {
        throw new Error("Invalid JWS: header is not valid base64url JSON");
    }
    const x5c: string[] | undefined = header?.x5c;
    if (!Array.isArray(x5c) || x5c.length < 2) {
        throw new Error("Invalid JWS: missing or short x5c chain");
    }
    // 1) Walk the chain — each cert must be signed by the next, and the last
    //    cert must match our pinned Apple Root CA G3 by SHA-256 fingerprint.
    const chain = x5c.map((b64) => new crypto.X509Certificate(der64ToPem(b64)));
    const root = chain[chain.length - 1];
    if (root.fingerprint256 !== APPLE_ROOT_FINGERPRINT_SHA256) {
        throw new Error(`Invalid JWS: x5c root fingerprint ${root.fingerprint256} does not match pinned Apple Root CA G3`);
    }
    const now = Date.now();
    for (const cert of chain) {
        const notBefore = Date.parse(cert.validFrom);
        const notAfter = Date.parse(cert.validTo);
        if (Number.isFinite(notBefore) && now < notBefore) {
            throw new Error(`Cert not yet valid: ${cert.subject}`);
        }
        if (Number.isFinite(notAfter) && now > notAfter) {
            throw new Error(`Cert expired: ${cert.subject}`);
        }
    }
    for (let i = 0; i < chain.length - 1; i++) {
        if (!chain[i].verify(chain[i + 1].publicKey)) {
            throw new Error(`Cert chain broken at index ${i} (${chain[i].subject})`);
        }
    }
    // 2) Verify the JWS signature with the leaf cert's public key.
    const leafKey = await jose.importX509(chain[0].toString(), header.alg || "ES256");
    const { payload } = await jose.compactVerify(jws, leafKey);
    return JSON.parse(new TextDecoder().decode(payload)) as T;
}
interface NotificationPayload {
    notificationType: string;
    subtype?: string;
    notificationUUID: string;
    data?: {
        bundleId?: string;
        environment?: "Sandbox" | "Production";
        signedTransactionInfo?: string;
        signedRenewalInfo?: string;
    };
    signedDate?: number;
    version?: string;
}
interface TransactionInfo {
    transactionId: string;
    originalTransactionId: string;
    productId: string;
    bundleId: string;
    expiresDate?: number; // ms epoch
    purchaseDate: number;
    originalPurchaseDate: number;
    type: string;
    inAppOwnershipType?: string;
    revocationDate?: number;
    revocationReason?: number;
    environment: "Sandbox" | "Production";
}
interface RenewalInfo {
    originalTransactionId: string;
    autoRenewProductId?: string;
    productId: string;
    autoRenewStatus: 0 | 1;
    expirationIntent?: number;
    isInBillingRetryPeriod?: boolean;
    recentSubscriptionStartDate?: number;
}
const APPLE_NOTIFICATION_TYPES = new Set([
    "SUBSCRIBED",
    "DID_RENEW",
    "DID_CHANGE_RENEWAL_STATUS",
    "DID_CHANGE_RENEWAL_PREF",
    "OFFER_REDEEMED",
    "EXPIRED",
    "GRACE_PERIOD_EXPIRED",
    "DID_FAIL_TO_RENEW",
    "REFUND",
    "REFUND_DECLINED",
    "REFUND_REVERSED",
    "REVOKE",
    "CONSUMPTION_REQUEST",
    "PRICE_INCREASE",
    "RENEWAL_EXTENDED",
    "RENEWAL_EXTENSION",
    "TEST",
]);
export function registerAppleWebhookRoutes(app: Express) {
    // Apple POSTs JSON. We mount our own JSON body parser locally because some
    // server stacks tweak the global parser limits / verify hooks; this keeps
    // the webhook self-contained.
    const jsonParser = express.json({ limit: "1mb" });
    app.post("/api/iap/apple-webhook", jsonParser, async (req: Request, res: Response) => {
        const startedAt = Date.now();
        const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
            req.ip ||
            "";
        const userAgent = (req.headers["user-agent"] as string) || "";
        const signedPayload: string | undefined = req.body?.signedPayload;
        if (!signedPayload || typeof signedPayload !== "string") {
            await safeAudit({
                platform: "ios",
                result: "bad_request",
                providerCode: "missing_signed_payload",
                statusCode: 400,
                errorMessage: "Missing signedPayload in body",
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            });
            return void res.status(400).json({ error: "Missing signedPayload" });
        }
        let notification: NotificationPayload;
        try {
            notification = await verifyAppleJws<NotificationPayload>(signedPayload);
        }
        catch (err: any) {
            logger.error("[apple-webhook] JWS verification failed:", err?.message || err);
            await safeAudit({
                platform: "ios",
                result: "invalid_receipt",
                providerCode: "jws_verify_failed",
                statusCode: 401,
                errorMessage: String(err?.message || err).slice(0, 500),
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            });
            // Apple retries on non-2xx, so respond 401 only for invalid signatures
            // (Apple won't retry forever on a permanent auth failure).
            return void res.status(401).json({ error: "Signature verification failed" });
        }
        const { notificationType, subtype, notificationUUID } = notification;
        if (typeof notificationUUID !== "string" || !notificationUUID.trim()) {
            return void res.status(400).json({ error: "Missing notificationUUID" });
        }
        // -----------------------------------------------------------------
        // App-binding check: every signed payload from Apple is cryptographically
        // valid for SOMEONE — we must reject ones not scoped to our bundle so a
        // misconfigured Apple-signed payload from another app can't grant entitlement
        // to our users. APPLE_EXPECTED_BUNDLE_IDS is a comma-separated allowlist.
        // -----------------------------------------------------------------
        const expectedBundles = (process.env.APPLE_EXPECTED_BUNDLE_IDS || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const payloadBundle = notification.data?.bundleId || "";
        if (expectedBundles.length && payloadBundle && !expectedBundles.includes(payloadBundle)) {
            logger.error(`[apple-webhook] bundleId mismatch: got=${payloadBundle} expected=${expectedBundles.join("|")} uuid=${notificationUUID}`);
            await safeAudit({
                platform: "ios",
                result: "invalid_receipt",
                providerCode: "bundle_mismatch",
                statusCode: 401,
                errorMessage: `bundleId ${payloadBundle} not in allowlist`,
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            });
            return void res.status(401).json({ error: "Bundle mismatch" });
        }
        if (!expectedBundles.length) {
            logger.warn(`[apple-webhook] APPLE_EXPECTED_BUNDLE_IDS not configured — skipping bundle check (defense-in-depth disabled). Set the env var to enable.`);
        }
        // PostgreSQL checks the delivery receipt while holding the subscription
        // lock and commits it with the entitlement update below.
        if (!APPLE_NOTIFICATION_TYPES.has(notificationType)) {
            logger.log(`[apple-webhook] unknown notificationType=${notificationType} uuid=${notificationUUID}`);
            // Ack with 200 — Apple may add new types and we don't want infinite retries.
            await safeAudit({
                platform: "ios",
                result: "success",
                providerCode: `unknown:${notificationType}`,
                statusCode: 200,
                errorMessage: "",
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            });
            return void res.status(200).json({ ok: true, ignored: true });
        }
        // TEST notifications carry no transaction data.
        if (notificationType === "TEST") {
            logger.log(`[apple-webhook] TEST received uuid=${notificationUUID}`);
            await safeAudit({
                platform: "ios",
                result: "success",
                providerCode: "test",
                statusCode: 200,
                errorMessage: "",
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            });
            return void res.status(200).json({ ok: true });
        }
        // Decode nested JWS payloads with the same chain validation.
        let txnInfo: TransactionInfo | null = null;
        let renewalInfo: RenewalInfo | null = null;
        try {
            if (notification.data?.signedTransactionInfo) {
                txnInfo = await verifyAppleJws<TransactionInfo>(notification.data.signedTransactionInfo);
            }
            if (notification.data?.signedRenewalInfo) {
                renewalInfo = await verifyAppleJws<RenewalInfo>(notification.data.signedRenewalInfo);
            }
        }
        catch (err: any) {
            logger.error("[apple-webhook] nested JWS failed:", err?.message || err);
            await safeAudit({
                platform: "ios",
                result: "invalid_receipt",
                providerCode: "nested_jws_failed",
                statusCode: 401,
                errorMessage: String(err?.message || err).slice(0, 500),
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            });
            return void res.status(401).json({ error: "Nested signature failed" });
        }
        const originalTransactionId = txnInfo?.originalTransactionId || renewalInfo?.originalTransactionId || "";
        const productId = txnInfo?.productId || renewalInfo?.productId || "";
        if (!originalTransactionId) {
            logger.log(`[apple-webhook] no originalTransactionId in ${notificationType}/${subtype} uuid=${notificationUUID}`);
            await safeAudit({
                platform: "ios",
                result: "bad_request",
                providerCode: `${notificationType}:no_otid`,
                statusCode: 200,
                errorMessage: "",
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            });
            return void res.status(200).json({ ok: true, skipped: "no_originalTransactionId" });
        }
        // Locate the user we previously attached this transaction to. If we
        // never saw the receipt (user might have purchased on another platform
        // and never validated), we ack 200 — there's nothing to mutate.
        const postgresUserId = await pgFindSubscriptionUser({ originalTransactionId });
        const user = postgresUserId ? { _id: postgresUserId, subscription: await pgGetSubscription(postgresUserId) } : null;
        if (!user) {
            logger.log(`[apple-webhook] no matching user for txn=${originalTransactionId} type=${notificationType}`);
            await safeAudit({
                platform: "ios",
                result: "success",
                productId,
                originalTransactionId,
                providerCode: `${notificationType}:no_user`,
                statusCode: 200,
                errorMessage: "",
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            });
            return void res.status(200).json({ ok: true, skipped: "no_user_for_transaction" });
        }
        const userId = (user as any)._id;
        const plan = PRODUCT_TO_PLAN[productId];
        const features = plan ? PLAN_FEATURES[plan as PremiumPlan] : [];
        // -----------------------------------------------------------------
        // Out-of-order guard: Apple sends notifications best-effort, so an old
        // SUBSCRIBED/DID_RENEW can arrive AFTER a newer REFUND/REVOKE. We
        // compare notification.signedDate against the lastSignedDate stamped on
        // the user's subscription. UPGRADES (SUBSCRIBED/DID_RENEW/etc.) are
        // skipped if the stored timestamp is newer. DOWNGRADES (REFUND/REVOKE/
        // EXPIRED) are always applied — safer to over-revoke than to leave a
        // refunded user entitled.
        // -----------------------------------------------------------------
        const incomingSignedDateMs = Number(notification.signedDate || 0);
        const storedSignedDateMs = Number((user as any).subscription?.lastSignedDate
            ? new Date((user as any).subscription.lastSignedDate).getTime()
            : 0);
        // Decide entitlement state from notificationType + subtype + txn fields.
        // We always re-derive isActive from the notification (never trust prior
        // state) so refunds/revokes immediately downgrade the user.
        let setOps: any = {
            "subscription.lastVerifiedAt": new Date(),
        };
        let unsetOps: any = {};
        let auditPlan = plan || "";
        const isRevocation = notificationType === "REFUND" ||
            notificationType === "REVOKE" ||
            (txnInfo?.revocationDate && txnInfo.revocationDate > 0);
        const isExpiration = notificationType === "EXPIRED" ||
            notificationType === "GRACE_PERIOD_EXPIRED" ||
            notificationType === "DID_FAIL_TO_RENEW";
        const isDowngrade = isRevocation || isExpiration;
        if (incomingSignedDateMs > 0) {
            setOps["subscription.lastSignedDate"] = new Date(Math.max(incomingSignedDateMs, storedSignedDateMs || 0));
        }
        const isActiveNow = !isRevocation &&
            !isExpiration &&
            (txnInfo?.expiresDate ? txnInfo.expiresDate > Date.now() : true);
        if (isRevocation) {
            setOps["subscription.plan"] = "none";
            setOps["subscription.isActive"] = false;
            setOps["subscription.cancelledAt"] = new Date();
            auditPlan = "none";
        }
        else if (isExpiration) {
            setOps["subscription.plan"] = "none";
            setOps["subscription.isActive"] = false;
            if (txnInfo?.expiresDate)
                setOps["subscription.expiresAt"] = new Date(txnInfo.expiresDate);
            auditPlan = "none";
        }
        else if (notificationType === "SUBSCRIBED" ||
            notificationType === "DID_RENEW" ||
            notificationType === "OFFER_REDEEMED" ||
            notificationType === "DID_CHANGE_RENEWAL_PREF" ||
            notificationType === "REFUND_REVERSED" ||
            notificationType === "RENEWAL_EXTENDED" ||
            notificationType === "RENEWAL_EXTENSION") {
            if (plan) {
                setOps["subscription.plan"] = plan;
                setOps["subscription.isActive"] = isActiveNow;
                setOps["subscription.platform"] = "ios";
                setOps["subscription.productId"] = productId;
                setOps["subscription.originalTransactionId"] = originalTransactionId;
                setOps["subscription.transactionId"] = txnInfo?.transactionId || originalTransactionId;
                if (txnInfo?.expiresDate)
                    setOps["subscription.expiresAt"] = new Date(txnInfo.expiresDate);
                if (notificationType === "SUBSCRIBED" || notificationType === "OFFER_REDEEMED") {
                    setOps["subscription.startedAt"] = new Date(txnInfo?.purchaseDate || Date.now());
                }
                unsetOps["subscription.cancelledAt"] = "";
            }
        }
        else if (notificationType === "DID_CHANGE_RENEWAL_STATUS") {
        }
        try {
            const op: any = { $set: setOps };
            if (Object.keys(unsetOps).length)
                op.$unset = unsetOps;
            {
                const outcome = await pgApplySubscriptionEvent(String(userId), subscriptionPatch(setOps, unsetOps), {
                    provider: "apple", providerEventId: notificationUUID, userId: String(userId),
                    eventType: subtype ? `${notificationType}:${subtype}` : notificationType,
                    status: "success", plan: auditPlan, occurredAt: new Date(notification.signedDate || Date.now()),
                    payload: { notificationType, subtype, notificationUUID, productId, originalTransactionId,
                        transactionId: txnInfo?.transactionId || null },
                }, {
                    order: { field: "lastSignedDate", timestamp: incomingSignedDateMs, isDowngrade: !!isDowngrade },
                    ...({}),
                });
                if (outcome !== "applied") {
                    return void res.status(200).json({ ok: true, skipped: outcome === "duplicate" ? "duplicate_notification" : "stale_event" });
                }
            }
        }
        catch (err: any) {
            logger.error("[apple-webhook] DB write failed:", err?.message || err);
            await safeAudit({
                userId,
                platform: "ios",
                productId,
                originalTransactionId,
                transactionId: txnInfo?.transactionId,
                result: "persist_error",
                providerCode: notificationType,
                statusCode: 500,
                errorMessage: String(err?.message || err).slice(0, 500),
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            });
            // Return 500 so Apple retries — we want the state to converge.
            return void res.status(500).json({ error: "DB write failed" });
        }
        logger.log(`[apple-webhook] ${notificationType}${subtype ? "/" + subtype : ""} user=${userId} txn=${originalTransactionId} plan=${auditPlan || "(unchanged)"} active=${isActiveNow}`);
        await safeAudit({
            userId,
            platform: "ios",
            productId,
            transactionId: txnInfo?.transactionId,
            originalTransactionId,
            result: "success",
            providerCode: subtype ? `${notificationType}:${subtype}` : notificationType,
            statusCode: 200,
            errorMessage: "",
            plan: auditPlan,
            expiresAt: txnInfo?.expiresDate ? new Date(txnInfo.expiresDate) : null,
            isLifetime: false,
            ip,
            userAgent,
            durationMs: Date.now() - startedAt,
        });
        return void res.status(200).json({ ok: true, features });
    });
}
async function safeAudit(input: {
    userId?: string | null;
    platform: "ios" | "android" | "unknown";
    productId?: string;
    transactionId?: string;
    originalTransactionId?: string;
    result: "success" | "replay_blocked" | "invalid_receipt" | "expired" | "apple_error" | "google_error" | "missing_credentials" | "bad_request" | "persist_error" | "fatal_error";
    providerCode?: string;
    statusCode: number;
    errorMessage?: string;
    plan?: string;
    expiresAt?: Date | null;
    isLifetime?: boolean;
    ip?: string;
    userAgent?: string;
    durationMs?: number;
}) {
    try {
        const identity = createIapAuditIdentity(input.platform);
        const auditPayload = {
            _id: identity.providerEventId.slice('audit:'.length),
            userId: input.userId ? String(input.userId) : null,
            platform: input.platform,
            productId: input.productId || "",
            transactionId: input.transactionId || "",
            originalTransactionId: input.originalTransactionId || "",
            result: input.result,
            providerCode: input.providerCode || "",
            statusCode: input.statusCode,
            errorMessage: input.errorMessage || "",
            plan: input.plan || "",
            expiresAt: input.expiresAt ?? null,
            isLifetime: input.isLifetime || false,
            ip: input.ip || "",
            userAgent: input.userAgent || "",
            durationMs: input.durationMs || 0,
        };
        {
            await pgRecordBillingEvent({
                provider: identity.provider, providerEventId: identity.providerEventId,
                userId: input.userId ? String(input.userId) : null,
                eventType: "iap_audit", status: input.result, plan: input.plan || null,
                payload: { ...input, userId: input.userId ? String(input.userId) : null },
            });
        }
    }
    catch (err: any) {
        logger.error("[apple-webhook] audit write failed:", err?.message || err);
    }
}
