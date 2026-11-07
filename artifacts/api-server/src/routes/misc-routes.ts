import { subscriptionAccess } from '@workspace/db-shared/subscription-access';
import { adminSubscriptionPatch } from '../utils/admin-subscription-patch';
import type { Express } from "express";
import { socialLinkInput } from '../admin-social-link-input';
import {
  pgListAdvertisements,
  pgSaveAdvertisement,
  pgDeleteAdvertisement,
  pgListFooterSocialMedia,
  pgSaveFooterSocialMedia,
  pgDeleteFooterSocialMedia,
  pgSeoMetadata,
  pgListSeoMetadata,
  pgSaveSeoMetadata,
  pgDeleteSeoMetadata,
  pgBulkSeoStatus,
  pgSeoMetadataStats,
  pgCreateAppLog,
  pgListAppLogs,
  pgAppLogStats,
  pgDeleteOldAppLogs,
  pgListFeedback,
  pgSaveFeedback,
  pgDeleteFeedback,
  pgAdminListeningHistory,
} from "../data/postgres-content-store";
import { pgCatalog } from "../data/postgres-catalog-store";
import { pgDiscoverableGenres } from "../data/postgres-taxonomy-store";
import { pgFindApiKeyByHash } from "../data/postgres-api-access-store";
import { logger } from "../utils/logger";
import crypto from "crypto";
import { registerAdvertisementUploadRoute } from './advertisement-upload';
import {
  PRODUCT_TO_PLAN as IAP_PRODUCT_TO_PLAN,
  PLAN_FEATURES as IAP_PLAN_FEATURES,
  APPLE_PLATFORMS as IAP_APPLE_PLATFORMS,
  normalizePlatform as iapNormalizePlatform,
  verifyAppleReceipt as iapVerifyAppleReceipt,
  verifyGoogleReceipt as iapVerifyGoogleReceipt,
  type Platform as IapPlatform,
} from "../services/iap-verify";
import {
  pgFindSubscriptionUser,
  pgGetSubscription,
  pgUpsertSubscription,
} from "../data/postgres-billing-store";
import {
  pgDeleteUser,
  pgFindUserById,
  pgListAdminUsers,
  pgUpdateUser,
  pgUserFavoriteCount,
} from "../data/postgres-user-store";
function subscriptionPatch(
  setFields: Record<string, any>,
  unsetFields: Record<string, any> = {},
): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const [key, value] of Object.entries(setFields))
    patch[key.replace(/^subscription\./, "")] = value;
  for (const key of Object.keys(unsetFields))
    patch[key.replace(/^subscription\./, "")] = null;
  return patch;
}
export function registerMiscRoutes(
  app: Express,
  deps: any,
  options?: {
    apiOnly?: boolean;
  },
) {
  const { requireAdmin, requireAuth } = deps;
  // ADMIN ADVERTISEMENT MANAGEMENT API
  registerAdvertisementUploadRoute(app, requireAdmin);
  // PUBLIC: only active ads, projection-limited (no admin-only fields).
  // Cached at the CDN edge for 5 minutes to keep the API server cool.
  app.get("/api/advertisements", async (_req, res) => {
    try {
      const ads = (await pgListAdvertisements(true)).map(
        ({ _id, title, imageUrl, altText, seoDescription, url, position, isActive }) => ({
          _id,
          title,
          imageUrl,
          altText,
          seoDescription,
          url,
          position,
          isActive,
        }),
      );
      res.set("Cache-Control", "public, max-age=300, s-maxage=300");
      res.json(ads);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch advertisements" });
    }
  });
  app.get("/api/admin/advertisements", requireAdmin, async (req, res) => {
    try {
      const ads = await pgListAdvertisements();
      res.json(ads);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch advertisements" });
    }
  });
  app.post("/api/admin/advertisements", requireAdmin, async (req, res) => {
    try {
      const {
        title,
        imageUrl,
        altText,
        seoDescription,
        url,
        position,
        isActive,
      } = req.body;
      if (!title || !imageUrl || !url) {
        return void res
          .status(400)
          .json({ error: "Title, Image URL, and Target URL are required" });
      }
      const ad = await pgSaveAdvertisement(null, {
        title,
        imageUrl,
        altText: altText || "",
        seoDescription: seoDescription || "",
        url,
        position: position || "desktop_sidebar",
        isActive: isActive !== false,
      });
      res.status(201).json(ad);
    } catch (error) {
      res.status(500).json({ error: "Failed to create advertisement" });
    }
  });
  app.patch("/api/admin/advertisements/:id", requireAdmin, async (req, res) => {
    try {
      const ad = await pgSaveAdvertisement(String(req.params.id), req.body);
      if (!ad)
        return void res.status(404).json({ error: "Advertisement not found" });
      res.json(ad);
    } catch (error) {
      res.status(500).json({ error: "Failed to update advertisement" });
    }
  });
  app.delete(
    "/api/admin/advertisements/:id",
    requireAdmin,
    async (req, res) => {
      try {
        const ad = await pgDeleteAdvertisement(String(req.params.id));
        if (!ad)
          return void res
            .status(404)
            .json({ error: "Advertisement not found" });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: "Failed to delete advertisement" });
      }
    },
  );
  app.get("/api/footer-social-media", async (req, res) => {
    try {
      const socialLinks = await pgListFooterSocialMedia(true);
      res.json(socialLinks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch footer social media" });
    }
  });
  app.get("/api/admin/footer-social-media", requireAdmin, async (req, res) => {
    try {
      const socialLinks = await pgListFooterSocialMedia();
      res.json(socialLinks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch footer social media" });
    }
  });
  app.post("/api/admin/footer-social-media", requireAdmin, async (req, res) => {
    let input: Record<string, unknown>;
    try { input = socialLinkInput(req.body); }
    catch (error) { return void res.status(400).json({ error: (error as Error).message }); }
    try {
      const socialLink = await pgSaveFooterSocialMedia(null, input);
      res.status(201).json(socialLink);
    } catch (error) {
      res.status(500).json({ error: "Failed to create footer social media" });
    }
  });
  app.patch(
    "/api/admin/footer-social-media/:id",
    requireAdmin,
    async (req, res) => {
      let input: Record<string, unknown>;
      try { input = socialLinkInput(req.body, true); }
      catch (error) { return void res.status(400).json({ error: (error as Error).message }); }
      try {
        const socialLink = await pgSaveFooterSocialMedia(
          String(req.params.id),
          input,
        );
        if (!socialLink)
          return void res
            .status(404)
            .json({ error: "Social media link not found" });
        res.json(socialLink);
      } catch (error) {
        res.status(500).json({ error: "Failed to update footer social media" });
      }
    },
  );
  app.delete(
    "/api/admin/footer-social-media/:id",
    requireAdmin,
    async (req, res) => {
      try {
        const socialLink = await pgDeleteFooterSocialMedia(
          String(req.params.id),
        );
        if (!socialLink)
          return void res
            .status(404)
            .json({ error: "Social media link not found" });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: "Failed to delete footer social media" });
      }
    },
  );
  // Streaming CSV export of all users matching the same filters as the
  // admin list query. Uses bounded SQL pages so we never load the full set
  // into memory — important once the user base grows past the in-browser
  // build's practical limit (tens of thousands of rows).
  app.get("/api/admin/users/export.csv", requireAdmin, async (req, res) => {
    try {
      const search =
        typeof req.query.search === "string" ? req.query.search.trim() : "";
      const planRaw =
        typeof req.query.plan === "string" ? req.query.plan : "all";
      const authRaw =
        typeof req.query.authMethod === "string" ? req.query.authMethod : "all";
      const platformRaw = typeof req.query.platform === "string" ? req.query.platform : "all";
      const platformFilter = ["all", "ios", "android", "tvos", "macos", "web", "stripe", "paddle", "admin"].includes(platformRaw) ? platformRaw : "all";
      const PLAN_VALUES = new Set([
        "all",
        "none",
        "remove_ads",
        "any_premium",
        "premium_monthly",
        "premium_yearly",
        "premium_lifetime",
      ]);
      const AUTH_VALUES = new Set([
        "all",
        "email",
        "google",
        "facebook",
        "apple",
      ]);
      const planFilter = PLAN_VALUES.has(planRaw) ? planRaw : "all";
      const authFilter = AUTH_VALUES.has(authRaw) ? authRaw : "all";
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .replace("Z", "");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="megaradio-users-${ts}.csv"`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const csvField = (value: unknown): string => {
        if (value === null || value === undefined) return '""';
        let str = String(value);
        if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
        return `"${str.replace(/"/g, '""')}"`;
      };
      const csvDate = (s?: Date | string | null): string => {
        if (!s) return "";
        const d = s instanceof Date ? s : new Date(s);
        return Number.isFinite(d.getTime()) ? d.toISOString() : "";
      };
      const headers = [
        "id",
        "name",
        "email",
        "auth_method",
        "plan",
        "plan_active",
        "expires_at",
        "followers",
        "favorites",
        "created_at",
        "updated_at",
      ];
      // BOM so Excel opens UTF-8 names/emails correctly.
      res.write("\uFEFF" + headers.map(csvField).join(",") + "\r\n");
      const BATCH = 500;
      {
        let exportPage = 1;
        let aborted = false;
        res.on("close", () => {
          aborted = true;
        });
        while (!aborted) {
          const result = await pgListAdminUsers({
            search,
            plan: planFilter,
            authMethod: authFilter,
            platform: platformFilter,
            sortBy: "createdAt",
            sortDir: "desc",
            page: exportPage,
            limit: BATCH,
          });
          if (!result.users.length) break;
          let chunk = "";
          for (const user of result.users) {
            const sub = user.subscription;
            chunk +=
              [
                user._id,
                user.fullName || "",
                user.email,
                (user.authProvider || "email").toLowerCase(),
                sub?.plan ?? "none",
                subscriptionAccess(sub).active ? "true" : "false",
                csvDate(sub?.expiresAt),
                user.followersCount ?? 0,
                user.favoriteCount ?? 0,
                csvDate(user.createdAt),
                csvDate(user.updatedAt),
              ]
                .map(csvField)
                .join(",") + "\r\n";
          }
          if (!res.write(chunk)) {
            await new Promise<void>((resolve) => {
              const done = () => {
                res.off("drain", done);
                res.off("close", done);
                resolve();
              };
              res.once("drain", done);
              res.once("close", done);
              if (res.destroyed) done();
            });
          }
          if (result.users.length < BATCH) break;
          exportPage += 1;
        }
        return void res.end();
      }
    } catch (error: any) {
      logger.error("Admin users export error:", error.message || error);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "Failed to export users", details: error.message });
      } else {
        try {
          res.end();
        } catch {}
      }
    }
  });
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(
        200,
        Math.max(1, parseInt(req.query.limit as string) || 50),
      );
      const search = ((req.query.search as string) || "").trim();
      const planRaw =
        typeof req.query.plan === "string" ? req.query.plan : "all";
      const authRaw =
        typeof req.query.authMethod === "string" ? req.query.authMethod : "all";
      const platformRaw =
        typeof req.query.platform === "string" ? req.query.platform : "all";
      const sortByRaw =
        typeof req.query.sortBy === "string" ? req.query.sortBy : "createdAt";
      const sortDirRaw = req.query.sortDir === "asc" ? "asc" : "desc";
      const PLAN_VALUES = new Set([
        "all",
        "none",
        "remove_ads",
        "any_premium",
        "premium_monthly",
        "premium_yearly",
        "premium_lifetime",
      ]);
      const AUTH_VALUES = new Set([
        "all",
        "email",
        "google",
        "facebook",
        "apple",
      ]);
      const PLATFORM_VALUES = new Set([
        "all",
        "ios",
        "android",
        "tvos",
        "macos",
        "web",
        "stripe",
        "paddle",
        "admin",
      ]);
      const planFilter = PLAN_VALUES.has(planRaw) ? planRaw : "all";
      const authFilter = AUTH_VALUES.has(authRaw) ? authRaw : "all";
      const platformFilter = PLATFORM_VALUES.has(platformRaw)
        ? platformRaw
        : "all";
      {
        const result = await pgListAdminUsers({
          search,
          plan: planFilter,
          authMethod: authFilter,
          platform: platformFilter,
          sortBy: sortByRaw as any,
          sortDir: sortDirRaw,
          page,
          limit,
        });
        const usersWithDetails = result.users.map((user: any) => {
          const fullNameParts = (user.fullName || "User").split(" ");
          return {
            _id: user._id,
            email: user.email,
            fullName: user.fullName || "",
            firstName: fullNameParts[0] || "",
            lastName: fullNameParts.slice(1).join(" ") || "",
            avatar: user.avatar || "",
            profilePicture: user.profilePicture || "",
            authProvider: user.authProvider || "email",
            googleId: user.googleId || "",
            followers: user.followersCount || 0,
            favorites: user.favoriteCount || 0,
            subscription: user.subscription || null,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            isActive: user.isActive !== false,
          };
        });
        return void res.json({
          users: usersWithDetails,
          total: result.total,
          page,
          limit,
          totalPages: Math.ceil(result.total / limit),
        });
      }
    } catch (error: any) {
      console.error("Admin users fetch error:", error.message || error);
      res
        .status(500)
        .json({ error: "Failed to fetch users", details: error.message });
    }
  });
  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const { email, firstName, lastName, profilePicture, isActive, fullName } =
        req.body;
      const updateData: any = {};
      if (email) updateData.email = email;
      if (fullName) updateData.fullName = fullName;
      else if (firstName || lastName) {
        const user = await pgFindUserById(String(req.params.id));
        if (user) {
          updateData.fullName = [
            firstName || user.fullName?.split(" ")[0],
            lastName || user.fullName?.split(" ").slice(1).join(" "),
          ]
            .filter(Boolean)
            .join(" ");
        }
      }
      if (profilePicture) updateData.profilePicture = profilePicture;
      if (isActive !== undefined) updateData.isActive = isActive;
      updateData.updatedAt = new Date();
      let user: any = null;
      {
        user = await pgUpdateUser(String(req.params.id), updateData);
      }
      if (!user) return void res.status(404).json({ error: "User not found" });
      const favoriteCount = await pgUserFavoriteCount(String(user._id));
      res.json({
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        firstName: (user.fullName || "User").split(" ")[0],
        lastName: (user.fullName || "User").split(" ").slice(1).join(" "),
        profilePicture: user.profilePicture,
        authProvider: user.authProvider,
        googleId: user.googleId,
        followers: user.followersCount || 0,
        favorites: favoriteCount || 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        isActive: user.isActive !== false,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to update user" });
    }
  });
  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      let found = false;
      const deletedFavorites = await pgUserFavoriteCount(String(userId));
      found = (await pgDeleteUser(userId)) || found;
      if (!found) return void res.status(404).json({ error: "User not found" });
      console.log(
        `Deleted user ${userId} and ${deletedFavorites} favorites; PostgreSQL relations cascade`,
      );
      res.json({ success: true, deletedFavorites });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });
  // ===== SUBSCRIPTION MANAGEMENT =====
  const VALID_PLANS = [
    "none",
    "remove_ads",
    "premium_monthly",
    "premium_yearly",
    "premium_lifetime",
  ] as const;
  type PremiumPlan = (typeof VALID_PLANS)[number];
  const PRODUCT_TO_PLAN: Record<string, PremiumPlan> = {
    megaradio_remove_ads_yearly1: "remove_ads",
    megaradio_premium_monthly1: "premium_monthly",
    megaradio_premium_yearly: "premium_yearly",
    megaradio_premium_lifetime: "premium_lifetime",
  };
  const PLAN_FEATURES: Record<PremiumPlan, string[]> = {
    none: [],
    remove_ads: ["remove_ads"],
    premium_monthly: [
      "remove_ads",
      "song_info",
      "spotify_link",
      "youtube_link",
      "hd_stream",
      "song_history",
      "stream_record",
    ],
    premium_yearly: [
      "remove_ads",
      "song_info",
      "spotify_link",
      "youtube_link",
      "hd_stream",
      "song_history",
      "stream_record",
    ],
    premium_lifetime: [
      "remove_ads",
      "song_info",
      "spotify_link",
      "youtube_link",
      "hd_stream",
      "song_history",
      "stream_record",
    ],
  };
  const PLAN_RANK: Record<PremiumPlan, number> = {
    none: 0,
    remove_ads: 1,
    premium_monthly: 2,
    premium_yearly: 3,
    premium_lifetime: 4,
  };
  function getExpiryForPlan(plan: PremiumPlan): Date | null {
    const now = new Date();
    switch (plan) {
      case "remove_ads":
      case "premium_yearly":
        return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      case "premium_monthly":
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      case "premium_lifetime":
        return null;
      default:
        return null;
    }
  }
  // SECURITY: This endpoint USED to accept any client-provided receipt and
  // grant premium without contacting Apple/Google — a critical broken access
  // control bug exploitable with a single curl. It now defers entirely to the
  // same Apple verifyReceipt / Google Play Developer API path used by
  // POST /api/iap/validate, ignores client-provided plan/expiresAt/transactionId,
  // and rejects unknown platforms. `mac`/`macos`/`tvos` are accepted as Apple
  // (Universal Purchase: Mac App Store receipts use the same bundle_id and
  // verifyReceipt endpoint as iOS).
  app.post("/api/user/subscription", requireAuth, async (req, res) => {
    try {
      const userId = req.session?.user?.userId || (req.session as any)?.userId;
      if (!userId)
        return void res.status(401).json({ error: "Not authenticated" });
      const {
        platform: rawPlatform,
        productId,
        receipt,
        purchaseToken,
      } = req.body || {};
      const platform = iapNormalizePlatform(rawPlatform);
      if (!platform) {
        return void res.status(400).json({
          error: "platform must be one of: ios, android, mac, macos, tvos",
        });
      }
      if (!productId || typeof productId !== "string") {
        return void res.status(400).json({ error: "productId is required" });
      }
      const plan = IAP_PRODUCT_TO_PLAN[productId];
      if (!plan || plan === "none") {
        return void res.status(400).json({
          error: `Unknown productId: ${productId}. Valid: ${Object.keys(IAP_PRODUCT_TO_PLAN).join(", ")}`,
        });
      }
      // Apple uses `receipt` (base64), Android uses `purchaseToken`. Accept either
      // field name for backwards compatibility with older mobile clients.
      const isAndroid = platform === "android";
      const credential = isAndroid
        ? (typeof purchaseToken === "string" && purchaseToken) ||
          (typeof receipt === "string" && receipt)
        : (typeof receipt === "string" && receipt) ||
          (typeof purchaseToken === "string" && purchaseToken);
      if (!credential || typeof credential !== "string") {
        return void res.status(400).json({
          error: isAndroid
            ? "purchaseToken is required for android"
            : "receipt (base64 receipt-data) is required for ios/mac/tvos",
        });
      }
      const result = IAP_APPLE_PLATFORMS.includes(platform)
        ? await iapVerifyAppleReceipt(credential, productId)
        : await iapVerifyGoogleReceipt(credential, productId);
      if (!result.valid) {
        logger.log(
          `[IAP] /api/user/subscription rejected: ${result.code} — ${result.error}`,
        );
        return void res
          .status(400)
          .json({
            error: result.error,
            code: String(result.code ?? "invalid_receipt"),
          });
      }
      // Same global replay-guard as /api/iap/validate: a single transaction may
      // only be attached to one user, otherwise an attacker who lapses their
      // sub could re-attach the same receipt to a fresh account.
      const replayQuery: any = {
        _id: { $ne: userId },
        $or: [
          {
            "subscription.originalTransactionId": result.originalTransactionId,
          },
        ],
      };
      if (isAndroid)
        replayQuery.$or.push({ "subscription.purchaseToken": credential });
      const postgresOwner = await pgFindSubscriptionUser({
        originalTransactionId: result.originalTransactionId,
        ...(isAndroid ? { purchaseToken: credential } : {}),
      });
      const conflict =
        postgresOwner && postgresOwner !== userId
          ? { _id: postgresOwner }
          : null;
      if (conflict) {
        logger.log(
          `[IAP] Replay blocked at /api/user/subscription: txn=${result.originalTransactionId} requested by user=${userId}, owned by user=${(conflict as any)._id}`,
        );
        return void res.status(409).json({
          error: "Receipt is already attached to another account",
          code: "receipt_replay",
        });
      }
      const expiresAtDate = result.isLifetime
        ? null
        : result.expiresAt
          ? new Date(result.expiresAt)
          : null;
      const existingSub: any = await pgGetSubscription(userId);
      const isSameTxn =
        existingSub?.originalTransactionId === result.originalTransactionId &&
        existingSub?.isActive;
      const setFields: any = {
        "subscription.plan": plan,
        "subscription.platform": platform,
        "subscription.productId": result.productId,
        "subscription.transactionId": result.originalTransactionId,
        "subscription.originalTransactionId": result.originalTransactionId,
        "subscription.isActive": true,
        "subscription.lastVerifiedAt": new Date(),
        "subscription.expiresAt": expiresAtDate,
      };
      const unsetFields: any = {};
      if (isAndroid) {
        setFields["subscription.purchaseToken"] = credential;
        unsetFields["subscription.receipt"] = "";
      } else {
        setFields["subscription.receipt"] = credential;
      }
      if (!isSameTxn && !existingSub?.startedAt)
        setFields["subscription.startedAt"] = new Date();
      const op: any = { $set: setFields };
      if (Object.keys(unsetFields).length) op.$unset = unsetFields;
      {
        await pgUpsertSubscription(
          userId,
          subscriptionPatch(setFields, unsetFields),
        );
      }
      res.json({
        success: true,
        plan,
        expiryDate: expiresAtDate,
        isActive: true,
        features: IAP_PLAN_FEATURES[plan],
        ...(result.environment ? { environment: result.environment } : {}),
      });
    } catch (error: any) {
      logger.error(
        "[IAP] /api/user/subscription update error:",
        error?.message || error,
      );
      res.status(500).json({ error: "Failed to update subscription" });
    }
  });
  app.get("/api/user/subscription", requireAuth, async (req, res) => {
    try {
      const userId = req.session?.user?.userId || (req.session as any)?.userId;
      if (!userId)
        return void res.status(401).json({ error: "Not authenticated" });
      const user: any = await pgFindUserById(userId);
      if (!user) return void res.status(404).json({ error: "User not found" });
      const sub = await pgGetSubscription(userId);
      // Checking access must not erase the original plan or provider history.
      const access = subscriptionAccess(sub);
      res.json({
        plan: access.active ? sub!.plan : "none",
        expiryDate: access.active ? sub!.expiresAt || null : null,
        isActive: access.active,
        features: access.active ? PLAN_FEATURES[sub!.plan as PremiumPlan] || [] : [],
        ...(access.expired ? { expired: true } : {}),
      });
    } catch (error: any) {
      console.error("Subscription fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch subscription" });
    }
  });
  // SECURITY/UX: Store-billed subscriptions (Apple/Google) MUST be cancelled
  // through the user's App Store / Play Store account — flipping isActive=false
  // here would silently downgrade entitlements while the store keeps charging.
  // For those platforms we return 409 with an actionRequired hint so the
  // mobile client can deep-link into the store's manage-subscription screen.
  // Lifetime, admin-granted, and web-billed plans (none of which exist yet
  // but are reserved) can still be cancelled locally.
  app.post("/api/user/subscription/cancel", requireAuth, async (req, res) => {
    try {
      const userId = req.session?.user?.userId || (req.session as any)?.userId;
      if (!userId)
        return void res.status(401).json({ error: "Not authenticated" });
      const existing: any = await pgFindUserById(userId);
      if (!existing)
        return void res.status(404).json({ error: "User not found" });
      const sub: any = await pgGetSubscription(userId);
      const platform = sub?.platform;
      const isStoreBilled =
        platform === "ios" ||
        platform === "macos" ||
        platform === "tvos" ||
        platform === "android";
      const isLifetime = sub?.plan === "premium_lifetime";
      if (isStoreBilled && !isLifetime) {
        const manageUrl =
          platform === "android"
            ? "https://play.google.com/store/account/subscriptions"
            : "https://apps.apple.com/account/subscriptions";
        return void res.status(409).json({
          error:
            "Subscriptions purchased through the App Store / Play Store must be cancelled there.",
          code: "manage_in_store",
          actionRequired: "open_store_subscriptions",
          platform,
          manageUrl,
        });
      }
      const cancelPatch = {
        "subscription.isActive": false,
        "subscription.plan": "none",
        "subscription.cancelledAt": new Date(),
      };
      {
        await pgUpsertSubscription(userId, subscriptionPatch(cancelPatch));
      }
      logger.log(
        `[IAP] /cancel local-cancel user=${userId} previousPlatform=${platform || "none"}`,
      );
      res.json({ success: true, plan: "none", isActive: false, features: [] });
    } catch (error: any) {
      logger.error("[IAP] /cancel error:", error?.message || error);
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  });
  app.patch(
    "/api/admin/users/:id/subscription",
    requireAdmin,
    async (req, res) => {
      try {
        const identityBefore = await pgFindUserById(req.params.id);
        if (!identityBefore) return void res.status(404).json({ error: "User not found" });
        const existing = await pgGetSubscription(req.params.id);
        const update = adminSubscriptionPatch(req.body, existing);
        if (update.error) return void res.status(400).json({ error: update.error });
        let user: any;
        {
          await pgUpsertSubscription(
            req.params.id,
            update.patch!,
          );
          const identity = await pgFindUserById(req.params.id);
          const subscription = await pgGetSubscription(req.params.id);
          user = identity ? { ...identity, subscription } : null;
        }
        if (!user)
          return void res.status(404).json({ error: "User not found" });
        const activePlan = subscriptionAccess(user.subscription).active ? user.subscription.plan as PremiumPlan : "none";
        res.json({
          success: true,
          user: {
            _id: user._id,
            fullName: user.fullName,
            email: user.email,
            subscription: user.subscription,
            features: PLAN_FEATURES[activePlan] || [],
          },
        });
      } catch (error: any) {
        res
          .status(500)
          .json({
            error: "Failed to update subscription",
            details: error.message,
          });
      }
    },
  );
  if (!options?.apiOnly) {
    app.get("/ads.txt", (req, res) => {
      const adsTxt = `google.com, pub-8771434485570434, DIRECT, f08c47fec0942fa0`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(adsTxt);
    });
    app.get("/app-ads.txt", (req, res) => {
      const appAdsTxt = `google.com, pub-8771434485570434, DIRECT, f08c47fec0942fa0`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(appAdsTxt);
    });
  }
  // api-keys, user-engagement, and apiKeyMiddleware are registered by the thin routes.ts orchestrator
  app.post("/api/logs/remote", async (req, res) => {
    try {
      const apiKey = req.headers["x-api-key"] as string;
      if (!apiKey)
        return void res
          .status(401)
          .json({ error: "X-API-Key header required" });
      const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
      const apiKeyDoc = await pgFindApiKeyByHash(keyHash);
      if (!apiKeyDoc || apiKeyDoc.status !== "active")
        return void res
          .status(401)
          .json({ error: "Invalid or inactive API key" });
      const {
        logs,
        deviceId,
        platform,
        appVersion,
        buildNumber,
        isCarPlayLog,
      } = req.body;
      if (
        !Array.isArray(logs) ||
        typeof deviceId !== "string" ||
        !deviceId ||
        !["ios", "android"].includes(platform) ||
        logs.some((l) => !l || typeof l !== "object")
      )
        return void res
          .status(400)
          .json({ error: "logs, deviceId, and platform are required" });
      const capped = logs.slice(0, 100);
      const hasCarPlay =
        isCarPlayLog === true ||
        capped.some(
          (l: any) =>
            typeof l.message === "string" && /carplay/i.test(l.message),
        );
      await pgCreateAppLog({
        deviceId,
        platform,
        appVersion: appVersion || "unknown",
        buildNumber: buildNumber || "",
        apiKeyHash: keyHash,
        isCarPlayLog: hasCarPlay,
        logs: capped.map((l: any) => ({
          level: l.level || "info",
          message: String(l.message || ""),
          timestamp: l.timestamp || new Date().toISOString(),
          data: l.data || {},
        })),
      });
      res.json({ success: true, received: capped.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to process logs" });
    }
  });
  app.get("/api/logs/remote", async (req, res) => {
    try {
      const raw = req.headers["x-api-key"];
      if (typeof raw !== "string" || !raw)
        return void res
          .status(401)
          .json({ error: "X-API-Key header required" });
      const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
      const apiKeyDoc = await pgFindApiKeyByHash(keyHash);
      if (!apiKeyDoc || apiKeyDoc.status !== "active")
        return void res
          .status(401)
          .json({ error: "Invalid or inactive API key" });
      const ownerHash = apiKeyDoc.plan === "internal" ? undefined : keyHash;
      const { platform, deviceId, level, search, from, to } = req.query;
      const { items } = await pgListAppLogs(
        {
          ownerHash,
          platform: platform ? String(platform) : undefined,
          deviceId: deviceId ? String(deviceId) : undefined,
          level: level ? String(level) : undefined,
          search: search ? String(search) : undefined,
          from: from ? new Date(String(from)) : undefined,
          to: to ? new Date(String(to)) : undefined,
        },
        1,
        Number(req.query.limit) || 50,
      );
      const logs = items.map(({ _id, ...entry }) => ({ id: _id, ...entry }));
      res.json({ success: true, count: logs.length, logs });
    } catch {
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });
  app.get("/api/logs/remote/stats", async (req, res) => {
    try {
      const raw = req.headers["x-api-key"];
      if (typeof raw !== "string" || !raw)
        return void res
          .status(401)
          .json({ error: "X-API-Key header required" });
      const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
      const apiKeyDoc = await pgFindApiKeyByHash(keyHash);
      if (!apiKeyDoc || apiKeyDoc.status !== "active")
        return void res
          .status(401)
          .json({ error: "Invalid or inactive API key" });
      const ownerHash = apiKeyDoc.plan === "internal" ? undefined : keyHash;
      res.json({ success: true, stats: await pgAppLogStats(ownerHash) });
    } catch {
      res.status(500).json({ error: "Failed to fetch log stats" });
    }
  });
  app.delete("/api/logs/remote", async (req, res) => {
    try {
      const raw = req.headers["x-api-key"];
      if (typeof raw !== "string" || !raw)
        return void res
          .status(401)
          .json({ error: "X-API-Key header required" });
      const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
      const apiKeyDoc = await pgFindApiKeyByHash(keyHash);
      if (!apiKeyDoc || apiKeyDoc.status !== "active")
        return void res
          .status(401)
          .json({ error: "Invalid or inactive API key" });
      const ownerHash = apiKeyDoc.plan === "internal" ? undefined : keyHash;
      if (!["internal", "pro"].includes(apiKeyDoc.plan))
        return void res
          .status(403)
          .json({ error: "Pro or Internal plan required to delete logs" });
      const olderThanDays = Math.max(
        1,
        Math.min(
          36500,
          parseInt(
            String(req.query.olderThan || req.query.older_than_days || "30"),
            10,
          ) || 30,
        ),
      );
      const result = await pgDeleteOldAppLogs(
        new Date(Date.now() - olderThanDays * 86400000),
        ownerHash,
      );
      res.json({
        success: true,
        deletedCount: result.deletedCount,
        message: "Logs older than " + olderThanDays + " days deleted",
      });
    } catch {
      res.status(500).json({ error: "Failed to delete logs" });
    }
  });
  app.get("/api/admin/app-logs", requireAdmin, async (req, res) => {
    try {
      const { platform, deviceId, isCarPlay } = req.query;
      const { items, total } = await pgListAppLogs(
        {
          platform: platform ? String(platform) : undefined,
          deviceId: deviceId ? String(deviceId) : undefined,
          isCarPlay:
            isCarPlay === undefined || isCarPlay === ""
              ? undefined
              : isCarPlay === "true",
        },
        Number(req.query.page) || 1,
        Number(req.query.limit) || 50,
      );
      res.json({ success: true, count: items.length, total, logs: items });
    } catch {
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });
  app.get("/api/admin/app-logs/crashes", requireAdmin, async (req, res) => {
    try {
      const { items } = await pgListAppLogs({ crashes: true }, 1, 50);
      res.json({ success: true, count: items.length, logs: items });
    } catch {
      res.status(500).json({ error: "Failed to fetch crash logs" });
    }
  });
  // country-language-mappings, url-translations, and performance routers are registered by the thin routes.ts orchestrator
  app.get("/api/admin/seo-metadata", requireAdmin, async (req, res) => {
    try {
      const { pageType, language, status } = req.query;
      const page = Math.max(1, parseInt(String(req.query.page), 10) || 1),
        limit = Math.max(
          1,
          Math.min(500, parseInt(String(req.query.limit), 10) || 50),
        );
      const { items, total } = await pgListSeoMetadata(
        {
          pageType: pageType ? String(pageType) : undefined,
          language: language ? String(language) : undefined,
          status: status ? String(status) : undefined,
        },
        page,
        limit,
      );
      res.json({
        items,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch SEO metadata" });
    }
  });
  app.get("/api/admin/seo-metadata/stats", requireAdmin, async (req, res) => {
    try {
      res.json(await pgSeoMetadataStats());
    } catch {
      res.status(500).json({ error: "Failed to fetch SEO metadata stats" });
    }
  });
  app.get("/api/admin/seo-metadata/page-types", requireAdmin, (req, res) => {
    res.json({
      pageTypes: [
        { value: "homepage", label: "Homepage" },
        { value: "genre_list", label: "Genre List" },
        { value: "genre_detail", label: "Genre Detail" },
        { value: "station_detail", label: "Station Detail" },
        { value: "country_list", label: "Country List" },
        { value: "country_detail", label: "Country Detail" },
        { value: "region", label: "Region" },
        { value: "search", label: "Search" },
        { value: "static", label: "Static Page" },
      ],
    });
  });
  app.get("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await pgSeoMetadata({ id: String(req.params.id) });
      if (!entry)
        return void res
          .status(404)
          .json({ error: "SEO metadata entry not found" });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch SEO metadata" });
    }
  });
  app.post("/api/admin/seo-metadata", requireAdmin, async (req, res) => {
    try {
      const { pageType, routeKey, language, title, description } = req.body;
      if (!pageType || !routeKey || !language || !title || !description)
        return void res.status(400).json({ error: "Missing required fields" });
      const entry = await pgSaveSeoMetadata(null, req.body);
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ error: "Failed to create SEO metadata" });
    }
  });
  app.patch("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await pgSaveSeoMetadata(String(req.params.id), req.body);
      if (!entry)
        return void res
          .status(404)
          .json({ error: "SEO metadata entry not found" });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: "Failed to update SEO metadata" });
    }
  });
  app.delete("/api/admin/seo-metadata/:id", requireAdmin, async (req, res) => {
    try {
      const entry = await pgDeleteSeoMetadata(String(req.params.id));
      if (!entry)
        return void res
          .status(404)
          .json({ error: "SEO metadata entry not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete SEO metadata" });
    }
  });
  app.post(
    "/api/admin/seo-metadata/bulk-status",
    requireAdmin,
    async (req, res) => {
      try {
        const { ids, status } = req.body;
        const result = await pgBulkSeoStatus(ids, status);
        res.json({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).json({ error: "Failed to bulk update SEO metadata" });
      }
    },
  );

  app.post(
    "/api/admin/seo-metadata/generate-draft",
    requireAdmin,
    async (req, res) => {
      try {
        const { pageType, language } = req.body;
        const OpenAI = (await import("openai")).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are an SEO expert." },
            {
              role: "user",
              content: `Generate SEO metadata for a ${pageType} page in ${language}.`,
            },
          ],
        });
        res.json({ draft: completion.choices[0].message.content });
      } catch (error) {
        res.status(500).json({ error: "Failed to generate draft" });
      }
    },
  );
  app.get("/api/admin/listening-history", requireAdmin, async (req, res) => {
    try {
      const history = await pgAdminListeningHistory(100);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });
  // ---- Admin: user feedback queue (read / triage / delete)
  // Backs artifacts/megaradio/src/pages/admin/feedback.tsx. Accepts
  // `status` and `type` query params; the special value 'all' (or
  // missing) disables that filter. Response shape matches what the
  // page consumes: `{ feedback, stats, total, page, limit, totalPages }`.
  app.get("/api/admin/feedback", requireAdmin, async (req, res) => {
    try {
      const status = String(req.query.status || ""),
        type = String(req.query.type || "");
      res.json(
        await pgListFeedback(
          {
            status: ["open", "in-progress", "resolved", "closed"].includes(
              status,
            )
              ? status
              : undefined,
            type: ["bug", "feature", "general"].includes(type)
              ? type
              : undefined,
          },
          Number(req.query.limit) || 200,
          Number(req.query.page) || 1,
        ),
      );
    } catch {
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  });
  app.patch("/api/admin/feedback/:id", requireAdmin, async (req, res) => {
    try {
      const FEEDBACK_STATUSES = new Set([
        "open",
        "in-progress",
        "resolved",
        "closed",
      ]);
      const { status, response } = req.body ?? {};
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof status === "string") {
        if (!FEEDBACK_STATUSES.has(status)) {
          return void res.status(400).json({ error: "Invalid status" });
        }
        update.status = status;
      }
      if (typeof response === "string") {
        const trimmed = response.trim();
        if (trimmed.length > 0) update.response = trimmed;
      }
      const updated = await pgSaveFeedback(String(req.params.id), update);
      if (!updated)
        return void res.status(404).json({ error: "Feedback not found" });
      res.json(updated);
    } catch (error) {
      logger.error(
        `❌ /api/admin/feedback PATCH failed: ${(error as Error)?.message || error}`,
      );
      res.status(500).json({ error: "Failed to update feedback" });
    }
  });
  app.delete("/api/admin/feedback/:id", requireAdmin, async (req, res) => {
    try {
      const deleted = await pgDeleteFeedback(String(req.params.id));
      if (!deleted)
        return void res.status(404).json({ error: "Feedback not found" });
      res.json({ success: true });
    } catch (error) {
      logger.error(
        `❌ /api/admin/feedback DELETE failed: ${(error as Error)?.message || error}`,
      );
      res.status(500).json({ error: "Failed to delete feedback" });
    }
  });
  app.get("/api/tv/bundle", async (req, res) => {
    res.set({ 'Cache-Control': 'no-cache, max-age=0, must-revalidate', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store' });
    try {
      const [popularStations, genres] = await Promise.all([
        pgCatalog().find({ isListVisible: true }, { sort: { votes: -1 }, limit: 20 }),
        pgDiscoverableGenres(undefined, 20),
      ]);
      const { tvSlimStation, tvSlimGenre } = await import("./shared-utils");
      res.json({
        stations: popularStations.map(tvSlimStation),
        genres: genres.map(tvSlimGenre),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bundle" });
    }
  });
}
