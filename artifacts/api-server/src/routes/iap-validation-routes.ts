import type { Express, Request, Response } from "express";
import { createHash } from "crypto";
import { logger } from "../utils/logger";
import { findActiveAuthToken } from "../data/auth-token-store";
import { pgFindSubscriptionUser, pgGetSubscription, pgRecordBillingEvent, pgUpsertSubscription } from "../data/postgres-billing-store";
import { createIapAuditIdentity, type IapEventResult } from "../data/iap-audit-identity";
import { PRODUCT_TO_PLAN, PLAN_FEATURES, APPLE_PLATFORMS, ALL_PLATFORMS, normalizePlatform, verifyAppleReceipt, verifyGoogleReceipt, type Platform, type PremiumPlan, type ValidationResult, } from "../services/iap-verify";
// SHA-256 hex of the receipt — receipts/purchaseTokens are credentials that
// re-validate against Apple/Google, so the raw value MUST never live in the
// audit log. The hash is enough to correlate multiple validate calls for the
// same purchase.
function hashReceipt(receipt: string | undefined | null): string {
    if (!receipt || typeof receipt !== "string")
        return "";
    return createHash("sha256").update(receipt).digest("hex");
}
function subscriptionPatch(setOps: Record<string, any>, unsetOps: Record<string, any> = {}): Record<string, any> {
    const patch: Record<string, any> = {};
    for (const [key, value] of Object.entries(setOps))
        patch[key.replace(/^subscription\./, "")] = value;
    for (const key of Object.keys(unsetOps))
        patch[key.replace(/^subscription\./, "")] = null;
    return patch;
}
// Best-effort write to the IapEvent audit collection. NEVER throws — audit
// failures must not break the user-facing validate flow.
async function writeIapEvent(payload: {
    userId: string | null;
    platform: "ios" | "android" | "unknown";
    productId?: string;
    transactionId?: string;
    originalTransactionId?: string;
    receiptHash?: string;
    result: IapEventResult;
    providerCode?: string;
    statusCode: number;
    errorMessage?: string;
    plan?: string;
    isTrial?: boolean;
    expiresAt?: Date | null;
    isLifetime?: boolean;
    ip?: string;
    userAgent?: string;
    durationMs?: number;
}): Promise<void> {
    try {
        const identity = createIapAuditIdentity(payload.platform);
        {
            await pgRecordBillingEvent({
                provider: identity.provider,
                providerEventId: identity.providerEventId,
                userId: payload.userId,
                eventType: "iap_audit",
                status: payload.result,
                plan: payload.plan || null,
                payload: { ...payload },
            });
        }
    }
    catch (err: any) {
        // Don't surface audit failures — they're for after-the-fact debugging
        // and shouldn't impact subscription delivery.
        logger.error("[IAP] audit write failed:", err?.message || err);
    }
}
// Apple/Google verify helpers, product map, and plan features now live in
// `../services/iap-verify` so POST /api/user/subscription can reuse the same
// cryptographically-anchored validation path.
async function resolveAuthUserId(req: Request): Promise<string | null> {
    const session: any = (req as any).session;
    if (session?.user?.userId)
        return String(session.user.userId);
    if (session?.userId)
        return String(session.userId);
    const authHeader = req.headers["authorization"];
    const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
    if (!bearer)
        return null;
    try {
        const tokenDoc = await findActiveAuthToken(bearer);
        if (!tokenDoc)
            return null;
        return tokenDoc.userId;
    }
    catch (err) {
        logger.error("[IAP] Bearer token lookup failed:", err);
        return null;
    }
}
export function registerIapValidationRoutes(app: Express) {
    app.post("/api/iap/validate", async (req: Request, res: Response) => {
        const startedAt = Date.now();
        const { platform, productId, receipt } = req.body || {};
        // Normalize the audit `platform` so even malformed requests get a row.
        const auditPlatform: "ios" | "android" | "unknown" = platform === "android"
            ? "android"
            : APPLE_PLATFORMS.includes(platform as Platform)
                ? "ios"
                : "unknown";
        const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
            req.ip ||
            req.socket?.remoteAddress ||
            "";
        const userAgent = (req.headers["user-agent"] as string) || "";
        // Fold result classification + status code + JSON body emission into one
        // helper so every exit point writes a matching audit row.
        //
        // The audit write is FIRE-AND-FORGET: we send the response first and let
        // the audit insert happen on the next tick. This way database latency,
        // buffering, or transient stalls never delay the user-facing validate
        // call. `writeIapEvent` itself swallows its own errors so an unhandled
        // rejection here is impossible, but we attach a `.catch` for safety.
        const finish = (statusCode: number, body: any, audit: {
            result: IapEventResult;
            userId?: string | null;
            productId?: string;
            transactionId?: string;
            originalTransactionId?: string;
            providerCode?: string;
            errorMessage?: string;
            plan?: string;
            isTrial?: boolean;
            expiresAt?: Date | null;
            isLifetime?: boolean;
        }) => {
            const payload = {
                userId: audit.userId ?? null,
                platform: auditPlatform,
                productId: audit.productId ?? (typeof productId === "string" ? productId : ""),
                transactionId: audit.transactionId ?? "",
                originalTransactionId: audit.originalTransactionId ?? "",
                receiptHash: hashReceipt(typeof receipt === "string" ? receipt : ""),
                result: audit.result,
                providerCode: audit.providerCode ?? "",
                statusCode,
                errorMessage: audit.errorMessage ?? "",
                plan: audit.plan ?? "",
                isTrial: !!audit.isTrial,
                expiresAt: audit.expiresAt ?? null,
                isLifetime: !!audit.isLifetime,
                ip,
                userAgent,
                durationMs: Date.now() - startedAt,
            };
            // Schedule on next tick to guarantee the response is flushed first.
            setImmediate(() => {
                writeIapEvent(payload).catch((err) => logger.error("[IAP] audit dispatch failed:", err?.message || err));
            });
            return void res.status(statusCode).json(body);
        };
        try {
            if (!platform || !["ios", "android", "tvos", "macos"].includes(platform)) {
                return finish(400, { valid: false, error: "platform must be one of: ios, android, tvos, macos" }, { result: "bad_request", errorMessage: "invalid platform" });
            }
            if (!productId || typeof productId !== "string") {
                return finish(400, { valid: false, error: "productId is required" }, { result: "bad_request", errorMessage: "missing productId" });
            }
            if (!PRODUCT_TO_PLAN[productId]) {
                return finish(400, {
                    valid: false,
                    error: `Unknown productId: ${productId}. Valid: ${Object.keys(PRODUCT_TO_PLAN).join(", ")}`,
                }, { result: "bad_request", errorMessage: `unknown productId: ${productId}` });
            }
            if (!receipt || typeof receipt !== "string") {
                return finish(400, {
                    valid: false,
                    error: "receipt is required (Apple base64 receipt-data or Google purchaseToken)",
                }, { result: "bad_request", errorMessage: "missing receipt" });
            }
            const platformTyped = platform as Platform;
            const result: ValidationResult = APPLE_PLATFORMS.includes(platformTyped)
                ? await verifyAppleReceipt(receipt, productId)
                : await verifyGoogleReceipt(receipt, productId);
            if (!result.valid) {
                // Classify the failure code into one of the audit buckets so admins
                // can group "expired vs network error vs config error vs invalid".
                const codeStr = String(result.code || "");
                let auditResult: IapEventResult = "invalid_receipt";
                if (codeStr === "expired") {
                    auditResult = "expired";
                }
                else if (codeStr.startsWith("missing_apple_secret") || codeStr.startsWith("missing_google_creds") || codeStr === "missing_pkg") {
                    auditResult = "missing_credentials";
                }
                else if (codeStr.startsWith("apple_network") || codeStr.startsWith("apple_sandbox_network") || codeStr === "apple_unknown") {
                    auditResult = "apple_error";
                }
                else if (codeStr === "google_error" || codeStr === "google_billing_failure") {
                    auditResult = "google_error";
                }
                return finish(400, result, {
                    result: auditResult,
                    providerCode: codeStr,
                    errorMessage: result.error,
                    productId,
                });
            }
            const authedUserId = await resolveAuthUserId(req);
            const bodyUserId = typeof req.body?.userId === "string" ? req.body.userId : null;
            const targetUserId = authedUserId || null;
            if (bodyUserId && authedUserId && bodyUserId !== authedUserId) {
                logger.log(`[IAP] body.userId (${bodyUserId}) differs from auth user (${authedUserId}); using auth user`);
            }
            if (bodyUserId && !authedUserId) {
                logger.log(`[IAP] body.userId (${bodyUserId}) provided without auth header; ignoring for DB write`);
            }
            let attached = false;
            let attachError: string | null = null;
            const isAndroid = platformTyped === "android";
            const plan = PRODUCT_TO_PLAN[result.productId];
            const expiresAtDate = result.isLifetime ? null : (result.expiresAt ? new Date(result.expiresAt) : null);
            if (targetUserId) {
                try {
                    // Global receipt-replay guard: reject if this transaction is already attached
                    // to ANY OTHER user (active OR inactive). Without the inactive check an
                    // attacker could deactivate their own sub (e.g. by letting it lapse) and
                    // then re-attach the same receipt/token to a fresh account. Match against
                    // both originalTransactionId and (Android) purchaseToken.
                    const replayQuery: any = {
                        _id: { $ne: targetUserId },
                        $or: [
                            { "subscription.originalTransactionId": result.originalTransactionId },
                        ],
                    };
                    if (isAndroid) {
                        replayQuery.$or.push({ "subscription.purchaseToken": receipt });
                    }
                    const pgOwner = await pgFindSubscriptionUser({
                        originalTransactionId: result.originalTransactionId,
                        ...(isAndroid ? { purchaseToken: receipt } : {}),
                    });
                    const conflict = pgOwner && pgOwner !== targetUserId ? { _id: pgOwner } : null;
                    if (conflict) {
                        logger.log(`[IAP] Replay blocked: txn=${result.originalTransactionId} requested by user=${targetUserId}, owned by user=${(conflict as any)._id}`);
                        return finish(409, {
                            valid: false,
                            error: "Receipt is already attached to another account",
                            code: "receipt_replay",
                        }, {
                            result: "replay_blocked",
                            userId: targetUserId,
                            productId: result.productId,
                            transactionId: result.originalTransactionId,
                            originalTransactionId: result.originalTransactionId,
                            providerCode: "receipt_replay",
                            errorMessage: `owned by user ${(conflict as any)._id}`,
                            plan,
                            expiresAt: expiresAtDate,
                            isLifetime: result.isLifetime,
                        });
                    }
                    else {
                        const existingSub: any = await pgGetSubscription(targetUserId);
                        const isSameTransaction = existingSub?.originalTransactionId &&
                            existingSub.originalTransactionId === result.originalTransactionId &&
                            existingSub.isActive;
                        if (!isSameTransaction) {
                            const update: any = {
                                "subscription.plan": plan,
                                "subscription.platform": platformTyped,
                                "subscription.productId": result.productId,
                                "subscription.transactionId": result.originalTransactionId,
                                "subscription.originalTransactionId": result.originalTransactionId,
                                "subscription.isActive": true,
                                "subscription.lastVerifiedAt": new Date(),
                                "subscription.expiresAt": expiresAtDate,
                            };
                            if (result.signedDate) {
                                update['subscription.appleSignedProof'] = true;
                                update['subscription.lastSignedDate'] = new Date(result.signedDate);
                            }
                            if (isAndroid) {
                                update["subscription.purchaseToken"] = receipt;
                                update.$unset = { "subscription.receipt": "" };
                            }
                            else {
                                update["subscription.receipt"] = receipt;
                            }
                            if (!existingSub?.startedAt)
                                update["subscription.startedAt"] = new Date();
                            const { $unset, ...setFields } = update as any;
                            const op: any = { $set: setFields };
                            if ($unset)
                                op.$unset = $unset;
                            {
                                await pgUpsertSubscription(targetUserId, subscriptionPatch(setFields, $unset));
                            }
                        }
                        else {
                            const sameTxnSet: any = {
                                "subscription.lastVerifiedAt": new Date(),
                                "subscription.expiresAt": expiresAtDate,
                            };
                            if (result.signedDate) {
                                sameTxnSet['subscription.appleSignedProof'] = true;
                                sameTxnSet['subscription.lastSignedDate'] = new Date(result.signedDate);
                            }
                            const sameTxnUnset: any = {};
                            // Migrate legacy Android records that stored token in `receipt`
                            if (isAndroid && existingSub?.receipt && !existingSub?.purchaseToken) {
                                sameTxnSet["subscription.purchaseToken"] = receipt;
                                sameTxnUnset["subscription.receipt"] = "";
                            }
                            const sameTxnOp: any = { $set: sameTxnSet };
                            if (Object.keys(sameTxnUnset).length)
                                sameTxnOp.$unset = sameTxnUnset;
                            {
                                await pgUpsertSubscription(targetUserId, subscriptionPatch(sameTxnSet, sameTxnUnset));
                            }
                        }
                        attached = true;
                    }
                }
                catch (err: any) {
                    if (err?.code === 'apple_stale_proof') return finish(409, {
                        valid:false,error:'A newer Apple subscription state supersedes this transaction',code:'apple_stale_proof',
                    }, {result:'invalid_receipt',userId:targetUserId,productId:result.productId,
                        originalTransactionId:result.originalTransactionId,providerCode:'apple_stale_proof',errorMessage:'Newer Apple subscription state supersedes signed proof'});
                    attachError = err?.message || String(err);
                    logger.error("[IAP] Failed to persist subscription:", attachError);
                }
            }
            if (targetUserId && attachError) {
                return finish(503, {
                    valid: true, error: "Subscription verified but persistence failed; retry required",
                    code: "persist_error",
                }, {
                    result: "persist_error", userId: targetUserId, productId: result.productId,
                    transactionId: result.originalTransactionId, originalTransactionId: result.originalTransactionId,
                    errorMessage: attachError, plan, expiresAt: expiresAtDate, isLifetime: result.isLifetime,
                });
            }
            return finish(200, {
                valid: true,
                expiresAt: result.expiresAt,
                originalTransactionId: result.originalTransactionId,
                isLifetime: result.isLifetime,
                productId: result.productId,
                plan,
                features: PLAN_FEATURES[plan],
                attachedToUser: attached,
                ...(attachError ? { attachError } : {}),
                ...(result.environment ? { environment: result.environment } : {}),
            }, {
                result: attachError ? "persist_error" : "success",
                userId: targetUserId,
                productId: result.productId,
                transactionId: result.originalTransactionId,
                originalTransactionId: result.originalTransactionId,
                errorMessage: attachError || "",
                plan,
                expiresAt: expiresAtDate,
                isLifetime: result.isLifetime,
            });
        }
        catch (err: any) {
            logger.error("[IAP] /api/iap/validate fatal:", err?.message || err);
            return finish(500, { valid: false, error: "Internal validation error" }, {
                result: "fatal_error",
                errorMessage: err?.message || String(err),
            });
        }
    });
}
