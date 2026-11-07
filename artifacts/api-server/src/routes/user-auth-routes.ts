import { pgListeningTotalMinutes } from '../data/postgres-listening-store';
import type { Express } from "express";
import { profileFieldsSchema, authProfileSchema, notificationSettingsSchema } from '@workspace/api-zod';
import { getPostgresPool } from '../postgres-runtime';
import { pgListAuthEvents } from '../data/postgres-api-access-store';
import { logger } from '../utils/logger';
import { publicUserIdentity } from '../utils/public-user-identity';
import { invalidateCommunityProfiles } from '../services/community-profiles';
import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { googleOAuthCallbackUrl, safeOAuthReturnTo, resolveGoogleOAuthReturnTo, buildRedirectWithToken, buildOAuthFailureRedirect, buildGoogleSessionRedirect } from '../auth/oauth-redirect';
// 2026-05-13 hotfix: `deps` (built in routes.ts) does NOT export CacheKeys
// or CacheManager — three sites in this file used to do
// `const { CacheKeys, CacheManager } = deps;` which threw at runtime
// (`Cannot read properties of undefined (reading 'userSocial')`),
// breaking the post-OAuth profile flow because /api/user/social/:email
// 500'd. Import them directly from the cache module instead, mirroring
// station-public-routes.ts / genres-countries-routes.ts.
import CacheManager, { CacheKeys } from '../cache';
import { logAuthEvent } from '../auth/auth-event-logger';
import { verifyMobileGoogleToken, verifyMobileAppleToken } from '../auth/mobile-social-verification';
import { deleteUserAuthTokens, findActiveAuthToken, revokeAuthToken } from '../data/auth-token-store';
import { newPublicUserId, pgCreateUser, pgDeleteUser, pgFindUserByEmail, pgFindUserById, pgFindUserByIdentity, pgFindUserByResetToken, pgResetUserPassword, pgListUsers, pgRecentUserActivity, pgUpdateUser, pgUserManagementDetail, pgUserManagementStats, pgUserSocialByEmail, pgUserFollowState, pgUserSlugExists, userStore, } from '../data/postgres-user-store';
import { UserEngagementService, engagementStore } from '../services/user-engagement-service';
import { pgFollowPage, pgIsFollowing } from '../data/postgres-engagement-store';
import { notificationStore, pgCreateNotification } from '../data/postgres-notification-store';
// Build the canonical set of enabled language codes for OAuth referer parsing.
// Used to distinguish a real language prefix (`/en`, `/tr`) from a route name
// that happens to be 2 letters (`/tv`).
const ENABLED_LANGUAGE_CODES = new Set(SEO_LANGUAGES.filter((l: any) => l.enabled).map((l: any) => l.code.toLowerCase()));
function notificationSettingsFor(user: any) {
    const stored = user?.notificationSettings || {};
    return Object.fromEntries(Object.entries({ favorites: true, nowPlaying: true, newStations: false, recommendations: false }).map(([key, fallback]) => [key, typeof stored[key] === 'boolean' ? stored[key] : fallback]));
}
async function invalidateProfileCaches(user: any): Promise<void> {
    await invalidateCommunityProfiles();
    for (const key of [user?._id, user?.id, user?.slug, user?.username].filter(Boolean)) {
        for (const prefix of ['user-engagement-profile:', 'user-engagement-favs:', 'user-engagement-full:', 'user-engagement-recent:', 'user_profile_', 'user-profile:']) await CacheManager.clearByPattern(`${prefix}${key}`);
    }
    if (user?.email) await CacheManager.del(CacheKeys.userSocial(user.email));
}
function ownedAvatarKey(avatar: unknown, userId: string): string | null {
    if (typeof avatar !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) return null;
    try {
        const url = new URL(avatar);
        const host = `${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'eu-north-1'}.amazonaws.com`;
        if (!process.env.AWS_BUCKET_NAME || url.protocol !== 'https:' || url.hostname !== host || url.search || url.hash) return null;
        const key = url.pathname.slice(1);
        return new RegExp(`^avatars/user_(?:${userId}|${userId.slice(-8)})_[0-9]+\\.webp$`, 'i').test(key) ? key : null;
    } catch { return null; }
}
/**
 * Extract the language prefix from an HTTP referer URL.
 * Returns the language code (e.g. "en", "tr") if the referer's first path
 * segment is an enabled SEO language, otherwise null. Slashless homepages
 * like https://themegaradio.com/en match; non-language routes like /tv do not.
 */
function extractLanguageFromReferer(referer: string): string | null {
    if (!referer)
        return null;
    try {
        const url = new URL(referer);
        const segments = url.pathname.split('/').filter(Boolean);
        const first = segments[0]?.toLowerCase();
        if (first && ENABLED_LANGUAGE_CODES.has(first))
            return first;
    }
    catch (_) { /* malformed referer, ignore */ }
    return null;
}
async function generateAppleClientSecret(): Promise<string> {
    const jose = await import('jose');
    const teamId = process.env.APPLE_TEAM_ID || '';
    const clientId = process.env.APPLE_SERVICE_ID || process.env.APPLE_CLIENT_ID || '';
    const keyId = process.env.APPLE_KEY_ID || '';
    let privateKeyPem = process.env.APPLE_PRIVATE_KEY || '';
    privateKeyPem = privateKeyPem.replace(/\\n/g, '\n');
    const privateKey = await jose.importPKCS8(privateKeyPem, 'ES256');
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new jose.SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: keyId })
        .setIssuer(teamId)
        .setIssuedAt(now)
        .setExpirationTime(now + 15777000)
        .setAudience('https://appleid.apple.com')
        .setSubject(clientId)
        .sign(privateKey);
    return jwt;
}
export function registerUserAuthRoutes(app: Express, deps: any) {
    const { requireAuth, requireAdmin, generateAuthToken, passport } = deps;
    const userEngagementService = new UserEngagementService();
    async function createFollowNotification(input: Record<string, any>): Promise<void> {
        const id = newPublicUserId();
        {
            await pgCreateNotification({ id, ...input } as any);
        }
    }
    async function findIdentity(input: {
        email?: string;
        googleId?: string;
        appleId?: string;
    }): Promise<any | null> {
        return pgFindUserByIdentity(input);
    }
    async function saveIdentity(user: any, patch: Record<string, any>): Promise<any> {
        Object.assign(user, patch);
        await pgUpdateUser(String(user._id), patch);
        return user;
    }
    async function uniqueUserSlug(base: string): Promise<string> {
        let candidate = base || 'user';
        let counter = 1;
        while (await pgUserSlugExists(candidate)) {
            candidate = `${base || 'user'}-${counter++}`;
        }
        return candidate;
    }
    async function createSocialIdentity(input: Record<string, any>): Promise<any> {
        const id = newPublicUserId();
        let user: any;
        user = await pgCreateUser({ ...input, id } as any);
        return user;
    }
    // PUBLIC USER DISCOVERY — no auth required
    // Lists/searches only users that have isPublicProfile:true (privacy-safe).
    // Default sort: createdAt desc (newest community members first).
    // Used by /users (Discover/Community) page; supports search by username/fullName/email.
    // Also supports sortBy: newest|oldest|most_radios|least_radios|recent_favorites.
    // Accepts BOTH `q` and `search` for query (legacy compat).
    app.get("/api/users/search", async (req, res) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        try {
            const { q, search, page = 1, limit = 20, sortBy = 'newest' } = req.query;
            const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 50);
            const pageNum = Math.max(Number(page) || 1, 1);
            const skip = (pageNum - 1) * limitNum;
            const filter: any = {
                isPublicProfile: true,
                status: 'active',
            };
            const queryStr = String(q ?? search ?? '').trim();
            if (queryStr.length >= 2) {
                // Escape regex meta-chars to prevent NoSQL $regex injection / ReDoS.
                const safe = queryStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                filter.$or = [
                    { username: { $regex: safe, $options: 'i' } },
                    { fullName: { $regex: safe, $options: 'i' } },
                    { email: { $regex: safe, $options: 'i' } },
                ];
            }
            // STRICT ALLOWLIST — email + IDs + tokens + provider IDs are NEVER returned to public callers,
            // even though search BY email is supported (one-way: searchable, not enumerable).
            const PUBLIC_FIELDS = '_id username fullName avatar location bio followersCount followingCount createdAt slug';
            const sortKey = String(sortBy);
            const useAggregation = sortKey === 'most_radios' || sortKey === 'least_radios';
            {
                const result = await pgListUsers({
                    query: queryStr, status: 'active', publicOnly: true,
                    sortBy: sortKey, page: pageNum, limit: limitNum,
                });
                const users = result.users.map((user: any) => ({
                    _id: user._id, ...publicUserIdentity(user), location: user.location, bio: user.bio,
                    followersCount: user.followersCount || 0, followingCount: user.followingCount || 0,
                    favoriteStationsCount: user.favoriteStationsCount || 0,
                    lastFavoritedAt: user.lastFavoritedAt,
                    createdAt: user.createdAt, slug: user.slug,
                }));
                res.set('Cache-Control', 'no-store');
                res.set('CDN-Cache-Control', 'no-store');
                res.set('Cloudflare-CDN-Cache-Control', 'no-store');
                return void res.json({ users, pagination: {
                        page: pageNum, limit: limitNum, total: result.total,
                        pages: Math.ceil(result.total / limitNum),
                        hasMore: pageNum < Math.ceil(result.total / limitNum),
                    } });
            }
        }
        catch (error) {
            logger.log('User search error:', error);
            res.status(500).json({ error: 'Failed to search users' });
        }
    });
    // USER MANAGEMENT API ENDPOINTS — admin only (enumerable PII)
    // Get all users with filters and pagination
    app.get("/api/users", requireAdmin, async (req, res) => {
        try {
            // logger.log(' Fetching users...');
            const { search, status, role, page = 1, limit = 20, sortBy = 'newest' } = req.query;
            // Build filter based on query params
            const filter: any = {};
            if (search) {
                // Escape regex meta-chars to prevent NoSQL $regex injection / ReDoS.
                const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                filter.$or = [
                    { username: { $regex: safe, $options: 'i' } },
                    { fullName: { $regex: safe, $options: 'i' } },
                    { email: { $regex: safe, $options: 'i' } }
                ];
            }
            if (status && status !== 'all') {
                filter.status = status;
            }
            if (role && role !== 'all') {
                filter.role = role;
            }
            const skip = (Number(page) - 1) * Number(limit);
            // Build sort object based on sortBy parameter
            let sortObject: any = {};
            switch (sortBy) {
                case 'oldest':
                    sortObject = { createdAt: 1 };
                    break;
                case 'most_radios':
                    // Will handle with aggregation below
                    break;
                case 'least_radios':
                    // Will handle with aggregation below
                    break;
                case 'newest':
                default:
                    sortObject = { createdAt: -1 };
                    break;
            }
            {
                const result = await pgListUsers({
                    query: search ? String(search) : undefined,
                    status: status && status !== 'all' ? String(status) : undefined,
                    role: role && role !== 'all' ? String(role) : undefined,
                    sortBy: String(sortBy), page: Number(page), limit: Number(limit),
                });
                const enhancedUsers = result.users.map((user: any) => {
                    const { passwordHash, resetPasswordToken, resetPasswordExpires, emailVerificationToken, ...safe } = user;
                    const recent = Array.isArray(user.recentlyPlayedStations) ? user.recentlyPlayedStations : [];
                    const totalListening = recent.reduce((sum: number, play: any) => sum + Number(play?.playDuration || 0), 0);
                    return { ...safe, totalListeningTime: Math.round(totalListening / 60), stats: {
                            ...(user.stats || {}), totalPlays: recent.length,
                            totalListeningHours: Math.round(totalListening / 3600), joinDate: user.createdAt,
                            lastActiveDate: user.lastLoginAt || user.createdAt,
                        } };
                });
                return void res.json({ users: enhancedUsers, total: result.total, page: Number(page), limit: Number(limit), pagination: {
                        page: Number(page), limit: Number(limit), total: result.total,
                        pages: Math.ceil(result.total / Number(limit)),
                        hasMore: Number(page) < Math.ceil(result.total / Number(limit)),
                    } });
            }
        }
        catch (error) {
            // console.error('Error fetching users:', error);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    });
    // Get user statistics summary — admin only
    app.get("/api/users/stats", requireAdmin, async (req, res) => {
        try {
            {
                const stats = await pgUserManagementStats();
                return void res.json({ ...stats, topUsersByListening: stats.topUsersByListening.map((user: any) => ({
                        username: user.username, fullName: user.fullName,
                        listeningTime: user.totalListeningTime || 0,
                        favoriteStations: user.favoriteStationsCount || 0,
                    })) });
            }
        }
        catch (error) {
            // console.error('Error fetching user stats:', error);
            res.status(500).json({ error: 'Failed to fetch user statistics' });
        }
    });
    // Get user activity/recent actions — admin only
    app.get("/api/users/activity", requireAdmin, async (req, res) => {
        try {
            // logger.log(' Fetching user activity...');
            const { limit = 10 } = req.query;
            {
                return void res.json(await pgRecentUserActivity(Number(limit)));
            }
        }
        catch (error) {
            // console.error('Error fetching user activity:', error);
            res.status(500).json({ error: 'Failed to fetch user activity' });
        }
    });
    // Get single user details with enhanced stats — admin only
    // (public profile pages use a separate sanitized endpoint)
    app.get("/api/users/:userId", requireAdmin, async (req, res) => {
        try {
            const { userId } = req.params;
            {
                const detail = await pgUserManagementDetail(String(userId));
                if (!detail)
                    return void res.status(404).json({ error: 'User not found' });
                const { passwordHash, resetPasswordToken, resetPasswordExpires, emailVerificationToken, ...safe } = detail;
                return void res.json(safe);
            }
        }
        catch (error) {
            // console.error('Error fetching user details:', error);
            res.status(500).json({ error: 'Failed to fetch user details' });
        }
    });
    // Update user information
    // Authorization: must be the owner OR an admin. Strict field allowlist; privileged fields (role, status)
    // are admin-only. Prevents mass-assignment IDOR.
    app.put("/api/users/:userId", requireAuth, async (req, res) => {
        try {
            const { userId } = req.params;
            const sessionUserId = (req.session as any)?.user?.userId || (req.session as any)?.userId;
            const isAdmin = (req.session as any)?.adminAuth?.role === 'admin';
            if (!isAdmin && sessionUserId !== userId) {
                return void res.status(403).json({ error: 'Forbidden' });
            }
            const parsed = profileFieldsSchema.safeParse(req.body || {});
            if (!parsed.success) return void res.status(400).json({ error: 'Invalid profile fields' });
            const body: any = parsed.data;
            // User-editable fields
            const USER_FIELDS = ['fullName', 'username', 'email', 'avatar', 'location', 'isPublicProfile', 'preferences', 'bio'];
            // Admin-only fields
            const ADMIN_FIELDS = ['role', 'status', 'emailVerified'];
            const updates: any = {};
            for (const f of USER_FIELDS) {
                if (body[f] !== undefined)
                    updates[f] = body[f];
            }
            if (isAdmin) {
                for (const f of ADMIN_FIELDS) {
                    if (req.body[f] !== undefined)
                        updates[f] = req.body[f];
                }
            }
            if (Object.keys(updates).length === 0) {
                return void res.status(400).json({ error: 'No updatable fields provided' });
            }
            const existing = await pgFindUserById(String(userId));
            if (!existing) return void res.status(404).json({ error: 'User not found' });
            if (updates.email && updates.email !== existing.email?.toLowerCase()) {
                const other = await pgFindUserByEmail(updates.email);
                if (other && String(other._id) !== String(userId)) return void res.status(409).json({ error: 'Email is already in use' });
                if (!isAdmin || req.body.emailVerified === undefined) updates.emailVerified = false;
            }
            const persistedUpdates = { ...updates, updatedAt: new Date() };
            let updatedUser: any;
            {
                updatedUser = await pgUpdateUser(String(userId), persistedUpdates);
            }
            if (!updatedUser) {
                return void res.status(404).json({ error: 'User not found' });
            }
            await invalidateProfileCaches(existing);
            await invalidateProfileCaches(updatedUser);
            {
                const { passwordHash, resetPasswordToken, resetPasswordExpires, emailVerificationToken, ...safe } = updatedUser;
                return void res.json(safe);
            }
        }
        catch (error: any) {
            res.status(error?.code === '23505' ? 409 : 500).json({ error: error?.code === '23505' ? 'Email or username is already in use' : 'Failed to update user' });
        }
    });
    // Legacy follow/unfollow endpoints — DEPRECATED, return 410 Gone
    app.post("/api/users/:userId/follow-OLD", (_req, res) => {
        res.status(410).json({ error: 'Deprecated. Use POST /api/user/follow/:userId with Bearer auth.' });
    });
    app.delete("/api/users/:userId/follow", (_req, res) => {
        res.status(410).json({ error: 'Deprecated. Use DELETE /api/user/unfollow/:userId with Bearer auth.' });
    });
    // AUTHENTICATION API ENDPOINTS
    // Social Authentication Routes
    // Get user's social connections (followers and following)
    // Requires authentication to avoid enumeration via email
    app.get("/api/user/social/:email", requireAuth, async (req, res) => {
        try {
            const { email } = req.params;
            // An authenticated visitor must not enumerate another account's private graph/email addresses.
            const owner = await pgFindUserById(String((req as any).user?._id || (req.session as any)?.user?.userId || (req.session as any)?.userId));
            if (!owner || owner.email?.toLowerCase() !== String(email).trim().toLowerCase()) return void res.status(403).json({ error: 'Forbidden' });
            const cacheKey = CacheKeys.userSocial(email);
            const cached = await CacheManager.get(cacheKey);
            if (cached) {
                return void res.json(cached);
            }
            {
                const result = await pgUserSocialByEmail(String(email));
                if (!result)
                    return void res.status(404).json({ error: 'User not found' });
                await CacheManager.set(cacheKey, result, { ttl: 120 });
                return void res.json(result);
            }
        }
        catch (error) {
            console.error('❌ Error fetching user social data:', error);
            res.status(500).json({ error: 'Failed to fetch social data' });
        }
    });
    // Check social authentication status
    app.get("/api/auth/social-status", (req, res) => {
        const { getSocialAuthStatus } = deps;
        const status = getSocialAuthStatus();
        res.json(status);
    });
    // Debug endpoint to show current callback URL for OAuth setup
    app.get("/api/auth/debug/callback-url", (req, res) => {
        const callbackUrl = googleOAuthCallbackUrl();
        const baseUrl = new URL(callbackUrl).origin;
        res.json({
            message: 'Add this exact URL to your Google Cloud Console OAuth app as an authorized redirect URI',
            callbackUrl,
            currentDomain: baseUrl,
            allDomains: [new URL(callbackUrl).host],
            instructions: [
                '1. Go to https://console.cloud.google.com/',
                '2. Select your project',
                '3. Go to: APIs & Services → Credentials',
                '4. Click on your OAuth 2.0 client ID',
                '5. Add the callbackUrl above to "Authorized redirect URIs"',
                '6. Save changes'
            ]
        });
    });
    // CRITICAL: Force Cloudflare to bypass cache and WAF security checks for all auth routes.
    // Without this, Cloudflare caches OAuth redirects (with state params) causing 502 errors
    // on subsequent login attempts, and WAF may flag OAuth code params as attacks.
    app.use('/api/auth', (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Surrogate-Control', 'no-store');
        res.setHeader('CDN-Cache-Control', 'no-store');
        res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
        next();
    });
    // Social authentication routes with passport integration
    app.get("/api/auth/google", async (req, res, next) => {
        const { getSocialAuthStatus } = deps;
        const status = getSocialAuthStatus();
        if (!status.google) {
            return void res.status(501).json({
                error: 'Google authentication not configured',
                message: 'Social login with Google requires API keys to be configured.'
            });
        }
        // Save returnTo URL in session for post-login redirect.
        // Only relative paths starting with '/' are accepted to prevent open redirects.
        const rawReturnTo = req.query.returnTo as string | undefined;
        const returnTo = safeOAuthReturnTo(rawReturnTo);
        if (returnTo && req.session) {
            (req.session as any).oauthReturnTo = returnTo;
            logger.log('🔀 Saved OAuth returnTo:', returnTo);
        }
        // Save current language/country code in session for OAuth return.
        // Uses the SEO_LANGUAGES whitelist so slashless homepages like /en match
        // but route names that happen to be two letters (like /tv) do NOT.
        const refererLang = extractLanguageFromReferer(req.headers.referer || '');
        if (refererLang && req.session) {
            (req.session as any).oauthReturnLang = refererLang;
            logger.log('🌍 Saved OAuth return language:', refererLang);
        }
        if (req.session) {
            try {
                await new Promise<void>((resolve, reject) => {
                    req.session.save((err: any) => err ? reject(err) : resolve());
                });
            }
            catch (saveErr) {
                logger.error('⚠️ Google OAuth session save failed (continuing with state-param fallback):', saveErr);
            }
        }
        // Defense-in-depth: also encode returnTo into the OAuth `state` parameter.
        // Google echoes `state` back on the callback unchanged, so even if the
        // session cookie is dropped (third-party-cookie blockers, Safari ITP,
        // store outage, etc.) the callback can still recover the redirect target.
        // We sign with HMAC to prevent attacker tampering, and the callback also
        // re-validates that the recovered path starts with '/'.
        let stateParam: string | undefined;
        if (returnTo) {
            try {
                const crypto = await import('crypto');
                const secret = process.env.SESSION_SECRET || 'radio-station-dev-only-secret-do-not-use-in-prod';
                const payload = Buffer.from(JSON.stringify({ r: returnTo })).toString('base64url');
                const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 16);
                stateParam = `${payload}.${sig}`;
            }
            catch (_) { /* state is optional; ignore */ }
        }
        // Use passport Google authentication
        try {
            passport.authenticate('google', {
                scope: ['profile', 'email'],
                ...(stateParam ? { state: stateParam } : {})
            } as any)(req, res, next);
        }
        catch (error) {
            console.error('Passport auth error:', error);
            res.status(500).json({ error: 'Authentication setup error' });
        }
    });
    app.get("/api/auth/facebook", (req, res) => {
        const { getSocialAuthStatus } = deps;
        const status = getSocialAuthStatus();
        if (!status.facebook) {
            return void res.status(501).json({
                error: 'Facebook authentication not configured',
                message: 'Social login with Facebook requires API keys to be configured.'
            });
        }
        // TODO: Implement Facebook OAuth when credentials are provided
        res.status(501).json({
            error: 'Facebook authentication not implemented',
            message: 'Facebook OAuth flow will be implemented when Facebook credentials are provided.'
        });
    });
    app.get("/api/auth/apple", async (req, res) => {
        const { getSocialAuthStatus } = deps;
        const status = getSocialAuthStatus();
        if (!status.apple) {
            return void res.status(501).json({
                error: 'Apple authentication not configured',
                message: 'Social login with Apple requires API keys to be configured.'
            });
        }
        // Sanitize returnTo: must be a same-origin path (mirrors Google flow).
        // Reject protocol-relative `//evil.com` and any absolute URL — otherwise
        // an attacker can pivot the post-login redirect to an external host.
        const rawReturnTo = req.query.returnTo as string | undefined;
        const returnTo = safeOAuthReturnTo(rawReturnTo);
        if (returnTo && req.session) {
            (req.session as any).oauthReturnTo = returnTo;
        }
        const referer = req.headers.referer || '';
        const urlMatch = referer.match(/\/([a-z]{2})(?:\/|$)/i);
        if (urlMatch && req.session) {
            (req.session as any).oauthReturnLang = urlMatch[1].toLowerCase();
        }
        const clientId = process.env.APPLE_SERVICE_ID || process.env.APPLE_CLIENT_ID || '';
        const frontendUrl = process.env.FRONTEND_URL || 'https://themegaradio.com';
        const redirectUri = process.env.APPLE_CALLBACK_URL || `${frontendUrl}/api/auth/apple/callback`;
        const crypto = await import('crypto');
        const state = crypto.randomBytes(16).toString('hex');
        if (req.session) {
            (req.session as any).appleOAuthState = state;
        }
        await new Promise<void>((resolve, reject) => {
            req.session.save((err: any) => err ? reject(err) : resolve());
        });
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code id_token',
            response_mode: 'form_post',
            scope: 'name email',
            state: state
        });
        const appleAuthUrl = `https://appleid.apple.com/auth/authorize?${params.toString()}`;
        // Explicit diagnostic log: when Apple returns "Invalid client id or web
        // redirect url" the values BELOW must EXACTLY match what's configured in
        // Apple Developer Console → Identifiers → Services IDs → (your service)
        // → Web Authentication Configuration. The Service ID must equal client_id,
        // and Return URLs must contain redirect_uri verbatim (scheme + host + path).
        logger.log(`🍎 Apple OAuth params — client_id="${clientId}" redirect_uri="${redirectUri}" frontendUrl="${frontendUrl}"`);
        logger.log('🍎 Apple OAuth redirect to:', appleAuthUrl);
        res.redirect(appleAuthUrl);
    });
    app.get("/api/auth/google/callback", (req, res, next) => {
        const savedLang = (req.session as any)?.oauthReturnLang || '';
        const langPrefix = savedLang ? `/${savedLang}` : '';
        const frontendBase = process.env.FRONTEND_URL || '';
        const returnTo = resolveGoogleOAuthReturnTo(
            (req.session as any)?.oauthReturnTo, req.query.state,
            process.env.SESSION_SECRET || 'radio-station-dev-only-secret-do-not-use-in-prod');
        const failureRedirect = (error: string) => buildOAuthFailureRedirect(frontendBase, returnTo, savedLang, error);
        void logAuthEvent(req, { method: 'google', event: 'callback_received', ok: true, message: `lang=${savedLang || '(none)'} hasState=${!!req.query.state}` });
        passport.authenticate('google', {
            failureRedirect: failureRedirect('google_auth_failed')
        }, async (err: any, user: any, info: any) => {
            if (err) {
                logger.error('Google OAuth callback error:', err);
                void logAuthEvent(req, { method: 'google', event: 'passport_error', ok: false, message: err?.message || String(err) });
                return void res.redirect(failureRedirect('google_auth_failed'));
            }
            if (!user) {
                void logAuthEvent(req, { method: 'google', event: 'no_user_returned', ok: false, message: info?.message || 'cancelled or rejected' });
                return void res.redirect(failureRedirect('google_auth_cancelled'));
            }
            void logAuthEvent(req, { method: 'google', event: 'profile_resolved', ok: true, email: user.email, userId: user._id?.toString() });
            try {
                const token = await generateAuthToken(user._id.toString(), 'web');
                logger.log(`✅ Google OAuth token generated for: ${user.email} userId=${user._id} tokenPrefix=${token.slice(0, 16)}… len=${token.length}`);
                void logAuthEvent(req, { method: 'google', event: 'token_issued', ok: true, email: user.email, userId: user._id?.toString(), message: `tokenLen=${token.length}` });
                delete (req.session as any).oauthReturnTo;
                delete (req.session as any).oauthReturnLang;
                // Persist the session cleanup + the passport user before redirecting.
                if (req.session) {
                    try {
                        await new Promise<void>((resolve, reject) => {
                            req.session.save((err: any) => err ? reject(err) : resolve());
                        });
                    }
                    catch (saveErr) {
                        logger.error('⚠️ Google OAuth callback session save failed:', saveErr);
                    }
                }
                // Re-validate returnTo (defence in depth) before redirecting.
                // Use buildRedirectWithToken so existing query strings or fragments
                // in returnTo are preserved (e.g. `/en/tv?ref=abc#section`).
                if (returnTo) {
                    void logAuthEvent(req, { method: 'google', event: 'redirect_with_token', ok: true, email: user.email, userId: user._id?.toString(), message: `to=${returnTo}` });
                    return void res.redirect(buildRedirectWithToken(frontendBase, returnTo, token));
                }
                void logAuthEvent(req, { method: 'google', event: 'redirect_with_token', ok: true, email: user.email, userId: user._id?.toString(), message: `to=${langPrefix}/` });
                res.redirect(buildRedirectWithToken(frontendBase, `${langPrefix}/`, token));
            }
            catch (tokenErr: any) {
                logger.error('Google OAuth token generation error:', tokenErr);
                void logAuthEvent(req, { method: 'google', event: 'token_generation_error', ok: false, email: user.email, userId: user._id?.toString(), message: tokenErr?.message || String(tokenErr) });
                req.login(user, (loginErr: any) => {
                    if (loginErr) {
                        void logAuthEvent(req, { method: 'google', event: 'session_login_error', ok: false, email: user.email, userId: user._id?.toString(), message: loginErr?.message || String(loginErr) });
                        return void res.redirect(failureRedirect('login_failed'));
                    }
                    (req.session as any).user = {
                        userId: user._id.toString(),
                        email: user.email,
                        role: user.role
                    };
                    req.session.save(() => {
                        void logAuthEvent(req, { method: 'google', event: 'session_fallback_redirect', ok: true, email: user.email, userId: user._id?.toString() });
                        res.redirect(buildGoogleSessionRedirect(frontendBase, returnTo, savedLang));
                    });
                });
            }
        })(req, res, next);
    });
    app.get("/api/auth/facebook/callback", async (req, res) => {
        try {
            res.redirect('/?error=facebook_auth_not_implemented');
        }
        catch (error) {
            console.error('Facebook OAuth callback error:', error);
            res.redirect('/?error=facebook_auth_failed');
        }
    });
    app.post("/api/auth/apple/callback", async (req, res) => {
        const frontendBase = process.env.FRONTEND_URL || '';
        const savedLang = (req.session as any)?.oauthReturnLang || '';
        const langPrefix = savedLang ? `/${savedLang}` : '';
        const returnTo = safeOAuthReturnTo((req.session as any)?.oauthReturnTo);
        const failureRedirect = () => buildOAuthFailureRedirect(frontendBase, returnTo, savedLang, 'apple_auth_failed');
        void logAuthEvent(req, { method: 'apple', event: 'callback_received', ok: true, message: `lang=${savedLang || '(none)'} hasCode=${!!req.body?.code} hasIdToken=${!!req.body?.id_token}` });
        try {
            const { code, id_token, state, user: userDataStr } = req.body;
            if (!code && !id_token) {
                logger.error('🍎 Apple callback: No code or id_token received');
                void logAuthEvent(req, { method: 'apple', event: 'missing_credentials', ok: false, message: 'no code and no id_token in body' });
                return void res.redirect(failureRedirect());
            }
            const savedState = (req.session as any)?.appleOAuthState;
            delete (req.session as any).appleOAuthState;
            if (!state || !savedState || state !== savedState) {
                logger.error('🍎 Apple OAuth state mismatch or missing', { state: !!state, savedState: !!savedState });
                void logAuthEvent(req, { method: 'apple', event: 'state_mismatch', ok: false, message: `state=${!!state} savedState=${!!savedState}` });
                return void res.redirect(failureRedirect());
            }
            const jose = await import('jose');
            let applePayload: any;
            if (id_token) {
                try {
                    const JWKS = jose.createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
                    const clientId = process.env.APPLE_SERVICE_ID || process.env.APPLE_CLIENT_ID || '';
                    const { payload } = await jose.jwtVerify(id_token, JWKS, {
                        issuer: 'https://appleid.apple.com',
                        audience: clientId,
                    });
                    applePayload = payload;
                }
                catch (verifyErr: any) {
                    logger.error('🍎 Apple id_token verification failed:', verifyErr);
                    void logAuthEvent(req, { method: 'apple', event: 'id_token_verify_failed', ok: false, message: verifyErr?.message || String(verifyErr) });
                    return void res.redirect(failureRedirect());
                }
            }
            else if (code) {
                try {
                    const clientSecret = await generateAppleClientSecret();
                    const clientId = process.env.APPLE_SERVICE_ID || process.env.APPLE_CLIENT_ID || '';
                    const redirectUri = process.env.APPLE_CALLBACK_URL || `${frontendBase}/api/auth/apple/callback`;
                    const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            client_id: clientId,
                            client_secret: clientSecret,
                            code: code,
                            grant_type: 'authorization_code',
                            redirect_uri: redirectUri,
                        }).toString(),
                    });
                    if (!tokenResponse.ok) {
                        const errorText = await tokenResponse.text();
                        logger.error('🍎 Apple token exchange failed:', errorText);
                        void logAuthEvent(req, { method: 'apple', event: 'token_exchange_http_error', ok: false, message: `status=${tokenResponse.status}`, detail: { body: errorText.slice(0, 500) } });
                        return void res.redirect(failureRedirect());
                    }
                    const tokenData = await tokenResponse.json() as any;
                    const JWKS = jose.createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
                    const { payload } = await jose.jwtVerify(tokenData.id_token, JWKS, {
                        issuer: 'https://appleid.apple.com',
                        audience: clientId,
                    });
                    applePayload = payload;
                }
                catch (tokenErr: any) {
                    logger.error('🍎 Apple token exchange error:', tokenErr);
                    void logAuthEvent(req, { method: 'apple', event: 'token_exchange_error', ok: false, message: tokenErr?.message || String(tokenErr) });
                    return void res.redirect(failureRedirect());
                }
            }
            if (!applePayload || !applePayload.sub) {
                void logAuthEvent(req, { method: 'apple', event: 'invalid_payload', ok: false, message: 'no sub in apple payload' });
                return void res.redirect(failureRedirect());
            }
            const appleId = applePayload.sub;
            const appleEmail = applePayload.email;
            let appleFullName: string | undefined;
            if (userDataStr) {
                try {
                    const userData = typeof userDataStr === 'string' ? JSON.parse(userDataStr) : userDataStr;
                    if (userData.name) {
                        appleFullName = [userData.name.firstName, userData.name.lastName].filter(Boolean).join(' ');
                    }
                }
                catch (e) { }
            }
            logger.log('🍎 Apple OAuth callback for:', appleId, appleEmail);
            void logAuthEvent(req, { method: 'apple', event: 'profile_resolved', ok: true, email: appleEmail, message: `appleId=${appleId}` });
            let user = await findIdentity({ appleId });
            if (user) {
                user.lastLoginAt = new Date();
                if (appleFullName && !user.fullName) {
                    user.fullName = appleFullName;
                }
                await saveIdentity(user, { lastLoginAt: user.lastLoginAt, fullName: user.fullName });
            }
            else {
                if (appleEmail) {
                    user = await findIdentity({ email: appleEmail });
                }
                if (user) {
                    (user as any).appleId = appleId;
                    user.lastLoginAt = new Date();
                    if (appleFullName && !user.fullName) {
                        user.fullName = appleFullName;
                    }
                    await saveIdentity(user, {
                        appleId: user.appleId, lastLoginAt: user.lastLoginAt, fullName: user.fullName,
                    });
                }
                else {
                    const generateSlug = (name: string, emailStr: string): string => {
                        let slugSource = name || emailStr?.split('@')[0] || 'apple-user';
                        return slugSource.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim().replace(/^-+|-+$/g, '');
                    };
                    const baseSlug = generateSlug(appleFullName || '', appleEmail || '');
                    const userSlug = await uniqueUserSlug(baseSlug || 'apple-user');
                    const newUser = await createSocialIdentity({
                        appleId: appleId,
                        email: appleEmail || `apple-${appleId}@oauth.invalid`,
                        fullName: appleFullName || undefined,
                        username: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        slug: userSlug,
                        passwordHash: '',
                        emailVerified: true,
                        lastLoginAt: new Date()
                    });
                    user = newUser;
                    logger.log(`✅ New Apple user created: "${userSlug}" (${appleEmail || 'no email'})`);
                }
            }
            try {
                const token = await generateAuthToken((user as any)._id.toString(), 'web');
                logger.log('✅ Apple OAuth token generated for:', (user as any).email);
                void logAuthEvent(req, { method: 'apple', event: 'token_issued', ok: true, email: (user as any).email, userId: (user as any)._id?.toString(), message: `tokenLen=${token.length}` });
                delete (req.session as any).oauthReturnTo;
                delete (req.session as any).oauthReturnLang;
                // Re-validate returnTo (defence in depth — session could carry an
                // unsanitized value from a legacy cookie). Use buildRedirectWithToken
                // so existing query strings or fragments are preserved correctly.
                if (returnTo) {
                    void logAuthEvent(req, { method: 'apple', event: 'redirect_with_token', ok: true, email: (user as any).email, userId: (user as any)._id?.toString(), message: `to=${returnTo}` });
                    return void res.redirect(buildRedirectWithToken(frontendBase, returnTo, token));
                }
                void logAuthEvent(req, { method: 'apple', event: 'redirect_with_token', ok: true, email: (user as any).email, userId: (user as any)._id?.toString(), message: `to=${langPrefix}/` });
                res.redirect(buildRedirectWithToken(frontendBase, `${langPrefix}/`, token));
            }
            catch (tokenErr: any) {
                logger.error('🍎 Apple OAuth token generation error:', tokenErr);
                void logAuthEvent(req, { method: 'apple', event: 'token_generation_error', ok: false, email: (user as any)?.email, userId: (user as any)?._id?.toString(), message: tokenErr?.message || String(tokenErr) });
                res.redirect(failureRedirect());
            }
        }
        catch (error: any) {
            logger.error('🍎 Apple OAuth callback error:', error);
            void logAuthEvent(req, { method: 'apple', event: 'unhandled_error', ok: false, message: error?.message || String(error) });
            res.redirect(failureRedirect());
        }
    });
    // MOBILE AUTH: Google Sign-In with idToken (POST - for mobile apps)
    app.post("/api/auth/google", async (req, res) => {
        try {
            const { idToken, email, name, googleId, platform = 'mobile' } = req.body;
            if (!idToken) {
                return void res.status(400).json({ success: false, error: 'idToken is required' });
            }
            let payload: any;
            try {
                payload = await verifyMobileGoogleToken(idToken);
            }
            catch (verifyErr) {
                logger.error('Google idToken verification failed:', verifyErr);
                return void res.status(401).json({ success: false, error: 'Invalid or expired Google token' });
            }
            if (!payload || !payload.sub) {
                return void res.status(401).json({ success: false, error: 'Invalid token payload' });
            }
            const verifiedGoogleId = payload.sub;
            const verifiedEmail = payload.email;
            const verifiedName = payload.name || name;
            const avatar = payload.picture;
            if (!verifiedEmail) {
                return void res.status(400).json({ success: false, error: 'Google account does not have a verified email' });
            }
            let user = await findIdentity({ googleId: verifiedGoogleId });
            if (user) {
                if (user.status !== 'active') {
                    return void res.status(403).json({ success: false, error: 'Account is suspended or inactive' });
                }
                user.lastLoginAt = new Date();
                if (avatar && !user.avatar) {
                    (user as any).avatar = avatar;
                }
                await saveIdentity(user, { lastLoginAt: user.lastLoginAt, avatar: user.avatar });
            }
            else {
                user = await findIdentity({ email: verifiedEmail });
                if (user) {
                    if (user.status !== 'active') {
                        return void res.status(403).json({ success: false, error: 'Account is suspended or inactive' });
                    }
                    user.googleId = verifiedGoogleId;
                    user.lastLoginAt = new Date();
                    if (avatar && !(user as any).avatar) {
                        (user as any).avatar = avatar;
                    }
                    if (!user.fullName && verifiedName) {
                        user.fullName = verifiedName;
                    }
                    await saveIdentity(user, {
                        googleId: user.googleId, lastLoginAt: user.lastLoginAt,
                        avatar: user.avatar, fullName: user.fullName,
                    });
                }
                else {
                    const generateSlug = (displayName: string, emailStr: string): string => {
                        let slugSource = displayName || emailStr.split('@')[0];
                        return slugSource.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim().replace(/^-+|-+$/g, '');
                    };
                    const baseSlug = generateSlug(verifiedName || '', verifiedEmail);
                    const userSlug = await uniqueUserSlug(baseSlug);
                    user = await createSocialIdentity({
                        googleId: verifiedGoogleId,
                        email: verifiedEmail,
                        fullName: verifiedName || verifiedEmail.split('@')[0],
                        avatar,
                        username: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        slug: userSlug,
                        passwordHash: '',
                        emailVerified: true,
                        lastLoginAt: new Date()
                    });
                    logger.log(`✅ New Google mobile user created: "${userSlug}" (${verifiedEmail})`);
                }
            }
            const deviceType = platform === 'tv' ? 'tv' : 'mobile';
            const token = await generateAuthToken(user._id.toString(), deviceType);
            res.json({
                success: true,
                token,
                expiresIn: '90 days',
                user: {
                    _id: user._id,
                    fullName: user.fullName,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    avatar: (user as any).avatar,
                }
            });
        }
        catch (error) {
            logger.error('Mobile Google auth error:', error);
            res.status(500).json({ success: false, error: 'Authentication failed' });
        }
    });
    // MOBILE AUTH: Apple Sign-In with identityToken (POST - for mobile apps)
    app.post("/api/auth/apple", async (req, res) => {
        try {
            const { identityToken, authorizationCode, fullName, email, user: appleUserId, platform = 'mobile' } = req.body;
            if (!identityToken) {
                return void res.status(400).json({ success: false, error: 'identityToken is required' });
            }
            let applePayload: any;
            try {
                applePayload = await verifyMobileAppleToken(identityToken);
            }
            catch (verifyErr) {
                logger.error('Apple identityToken verification failed:', verifyErr);
                return void res.status(401).json({ success: false, error: 'Invalid or expired Apple token' });
            }
            if (!applePayload || !applePayload.sub) {
                return void res.status(401).json({ success: false, error: 'Invalid token payload' });
            }
            const verifiedAppleId = applePayload.sub;
            const verifiedEmail = applePayload.email;
            const displayName = fullName
                ? [fullName.givenName, fullName.familyName].filter(Boolean).join(' ')
                : undefined;
            let user = await findIdentity({ appleId: verifiedAppleId });
            if (user) {
                if (user.status !== 'active') {
                    return void res.status(403).json({ success: false, error: 'Account is suspended or inactive' });
                }
                user.lastLoginAt = new Date();
                if (displayName && !user.fullName) {
                    user.fullName = displayName;
                }
                await saveIdentity(user, { lastLoginAt: user.lastLoginAt, fullName: user.fullName });
            }
            else {
                user = verifiedEmail ? await findIdentity({ email: verifiedEmail }) : null;
                if (user) {
                    if (user.status !== 'active') {
                        return void res.status(403).json({ success: false, error: 'Account is suspended or inactive' });
                    }
                    (user as any).appleId = verifiedAppleId;
                    user.lastLoginAt = new Date();
                    if (displayName && !user.fullName) {
                        user.fullName = displayName;
                    }
                    await saveIdentity(user, {
                        appleId: user.appleId, lastLoginAt: user.lastLoginAt, fullName: user.fullName,
                    });
                }
                else {
                    const generateSlug = (name: string, emailStr: string): string => {
                        let slugSource = name || emailStr?.split('@')[0] || 'apple-user';
                        return slugSource.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim().replace(/^-+|-+$/g, '');
                    };
                    const baseSlug = generateSlug(displayName || '', verifiedEmail || '');
                    const userSlug = await uniqueUserSlug(baseSlug || 'apple-user');
                    user = await createSocialIdentity({
                        appleId: verifiedAppleId,
                        email: verifiedEmail || `apple-${verifiedAppleId}@oauth.invalid`,
                        fullName: displayName || 'Apple User',
                        username: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        slug: userSlug,
                        passwordHash: '',
                        emailVerified: !!verifiedEmail,
                        lastLoginAt: new Date()
                    });
                    logger.log(`✅ New Apple mobile user created: "${userSlug}" (${verifiedEmail || 'no-email'})`);
                }
            }
            const deviceType = platform === 'tv' ? 'tv' : 'mobile';
            const token = await generateAuthToken(user._id.toString(), deviceType);
            res.json({
                success: true,
                token,
                expiresIn: '90 days',
                user: {
                    _id: user._id,
                    fullName: user.fullName,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    avatar: (user as any).avatar,
                }
            });
        }
        catch (error) {
            logger.error('Mobile Apple auth error:', error);
            res.status(500).json({ success: false, error: 'Authentication failed' });
        }
    });
    // MOBILE AUTH: Login with token response
    app.post("/api/auth/mobile/login", async (req, res) => {
        const emailRaw = req.body?.email;
        void logAuthEvent(req, { method: 'mobile-email', event: 'request_received', ok: true, email: emailRaw, message: `deviceType=${req.body?.deviceType || 'mobile'}` });
        try {
            const { email, password, deviceType = 'mobile', deviceName } = req.body;
            if (!email || !password) {
                void logAuthEvent(req, { method: 'mobile-email', event: 'missing_credentials', ok: false, email: emailRaw });
                return void res.status(400).json({ error: 'Email and password are required' });
            }
            const user: any = await pgFindUserByEmail(email);
            if (!user) {
                void logAuthEvent(req, { method: 'mobile-email', event: 'user_not_found', ok: false, email });
                return void res.status(401).json({ error: 'Invalid email or password' });
            }
            const bcrypt = await import('bcrypt');
            const isValid = await bcrypt.default.compare(password, user.passwordHash);
            if (!isValid) {
                void logAuthEvent(req, { method: 'mobile-email', event: 'wrong_password', ok: false, email, userId: user._id?.toString() });
                return void res.status(401).json({ error: 'Invalid email or password' });
            }
            if (user.status !== 'active') {
                void logAuthEvent(req, { method: 'mobile-email', event: 'account_inactive', ok: false, email, userId: user._id?.toString(), message: `status=${user.status}` });
                return void res.status(403).json({ error: 'Account is suspended or inactive' });
            }
            // Update last login
            user.lastLoginAt = new Date();
            await pgUpdateUser(String(user._id), { lastLoginAt: user.lastLoginAt });
            const token = await generateAuthToken(user._id.toString(), deviceType, deviceName);
            void logAuthEvent(req, { method: 'mobile-email', event: 'token_issued', ok: true, email, userId: user._id?.toString(), message: `device=${deviceType} tokenLen=${token.length}` });
            res.json({
                success: true,
                token,
                expiresIn: '90 days',
                user: {
                    _id: user._id,
                    fullName: user.fullName,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    avatar: user.avatar,
                }
            });
        }
        catch (error: any) {
            console.error('Mobile login error:', error);
            void logAuthEvent(req, { method: 'mobile-email', event: 'unhandled_error', ok: false, email: emailRaw, message: error?.message || String(error) });
            res.status(500).json({ error: 'Login failed' });
        }
    });
    // User Signup
    app.post("/api/auth/signup", async (req, res) => {
        const emailRaw = req.body?.email;
        void logAuthEvent(req, { method: 'email', event: 'signup_request_received', ok: true, email: emailRaw, message: `username=${req.body?.username}` });
        try {
            const { fullName, username, email, password } = req.body;
            if (!fullName || !username || !email || !password) {
                void logAuthEvent(req, { method: 'email', event: 'signup_missing_fields', ok: false, email: emailRaw });
                return void res.status(400).json({ error: 'All fields are required' });
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                void logAuthEvent(req, { method: 'email', event: 'signup_invalid_email', ok: false, email });
                return void res.status(400).json({ error: 'Invalid email format' });
            }
            if (password.length < 8) {
                void logAuthEvent(req, { method: 'email', event: 'signup_weak_password', ok: false, email, message: `len=${password.length}` });
                return void res.status(400).json({ error: 'Password must be at least 8 characters long' });
            }
            if (username.length < 3 || username.length > 30) {
                return void res.status(400).json({ error: 'Username must be 3-30 characters long' });
            }
            if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
                return void res.status(400).json({ error: 'Username may only contain letters, numbers, underscores, dots, and hyphens' });
            }
            // Check if user exists
            const normalizedEmail = email.toLowerCase().trim();
            const existingUser = await pgFindUserByIdentity({ email: normalizedEmail, username });
            if (existingUser) {
                void logAuthEvent(req, { method: 'email', event: 'signup_duplicate', ok: false, email, message: `username=${username}` });
                return void res.status(400).json({ error: 'User with this email or username already exists' });
            }
            // Hash password
            const bcrypt = await import('bcrypt');
            const saltRounds = 12;
            const passwordHash = await bcrypt.default.hash(password, saltRounds);
            // Create user slug
            const userSlug = username.toLowerCase().replace(/[^a-z0-9]/g, '-');
            const userId = newPublicUserId();
            const stats = {
                totalPlays: 0,
                totalListeningHours: 0,
                favoriteStationsCount: 0,
                favoriteGenres: [],
                joinDate: new Date(),
                lastActiveDate: new Date(),
                streakDays: 0
            };
            const userValues = {
                id: userId,
                fullName: fullName.trim(),
                username,
                email: normalizedEmail,
                passwordHash,
                slug: userSlug,
                role: 'user',
                status: 'active',
                emailVerified: false,
                stats,
            };
            let newUser: any;
            newUser = await pgCreateUser(userValues);
            logger.log(`✅ User created with slug: "${userSlug}" (${email})`);
            void logAuthEvent(req, { method: 'email', event: 'signup_user_created', ok: true, email: normalizedEmail, userId: newUser._id?.toString(), message: `slug=${userSlug}` });
            // Return user data (without sensitive fields)
            const userData = {
                _id: newUser._id,
                fullName: newUser.fullName,
                username: newUser.username,
                email: newUser.email,
                emailVerified: newUser.emailVerified,
                role: newUser.role,
                status: newUser.status,
                createdAt: newUser.createdAt
            };
            res.status(201).json({
                message: 'Account created successfully',
                user: userData,
                emailVerificationRequired: true
            });
        }
        catch (error: any) {
            console.error('Signup error:', error);
            void logAuthEvent(req, { method: 'email', event: 'signup_unhandled_error', ok: false, email: emailRaw, message: error?.message || String(error) });
            res.status(500).json({ error: 'Failed to create account' });
        }
    });
    // User login
    app.post("/api/auth/login", async (req, res) => {
        const emailRaw = req.body?.email;
        void logAuthEvent(req, { method: 'email', event: 'login_request_received', ok: true, email: emailRaw, message: `rememberMe=${!!req.body?.rememberMe}` });
        try {
            const { email, password, rememberMe } = req.body;
            if (!email || !password) {
                void logAuthEvent(req, { method: 'email', event: 'login_missing_credentials', ok: false, email: emailRaw });
                return void res.status(400).json({ error: 'Email and password are required' });
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                void logAuthEvent(req, { method: 'email', event: 'login_invalid_email_format', ok: false, email });
                return void res.status(400).json({ error: 'Invalid email format' });
            }
            // Find user by email
            const normalizedEmail = email.toLowerCase().trim();
            const user: any = await pgFindUserByEmail(normalizedEmail);
            if (!user) {
                void logAuthEvent(req, { method: 'email', event: 'login_user_not_found', ok: false, email });
                return void res.status(401).json({ error: 'Invalid email or password' });
            }
            // Check password
            const bcrypt = await import('bcrypt');
            const isValidPassword = await bcrypt.default.compare(password, user.passwordHash);
            if (!isValidPassword) {
                void logAuthEvent(req, { method: 'email', event: 'login_wrong_password', ok: false, email, userId: user._id?.toString() });
                return void res.status(401).json({ error: 'Invalid email or password' });
            }
            // Check if account is active
            if (user.status !== 'active') {
                void logAuthEvent(req, { method: 'email', event: 'login_account_inactive', ok: false, email, userId: user._id?.toString(), message: `status=${user.status}` });
                return void res.status(403).json({ error: 'Account is suspended or inactive' });
            }
            void logAuthEvent(req, { method: 'email', event: 'login_credentials_ok', ok: true, email, userId: user._id?.toString() });
            // Update last login
            user.lastLoginAt = new Date();
            if (!user.stats)
                user.stats = {} as any;
            user.stats!.lastActiveDate = new Date();
            {
                await pgUpdateUser(String(user._id), { lastLoginAt: user.lastLoginAt, stats: user.stats });
            }
            const userData = {
                _id: user._id,
                fullName: user.fullName,
                username: user.username,
                email: user.email,
                emailVerified: user.emailVerified,
                role: user.role,
                status: user.status,
                avatar: user.avatar,
                location: user.location,
                isPublicProfile: user.isPublicProfile,
                followersCount: user.followersCount,
                followingCount: user.followingCount,
                favoriteStationsCount: user.favoriteStationsCount,
                totalListeningTime: user.totalListeningTime,
                lastLoginAt: user.lastLoginAt
            };
            // Use Passport's req.login()
            req.login(user, async (err) => {
                if (err) {
                    console.error('Session login error:', err);
                    void logAuthEvent(req, { method: 'email', event: 'login_session_error', ok: false, email, userId: user._id?.toString(), message: err?.message || String(err) });
                    return void res.status(500).json({ error: 'Failed to create session' });
                }
                // Custom session data
                (req.session as any).user = {
                    userId: user._id.toString(),
                    email: user.email,
                    role: user.role,
                    rememberMe
                };
                const deviceType = req.body.deviceType || (req.headers['x-device-type'] as string) || 'web';
                const deviceName = req.body.deviceName || req.headers['x-device-name'] as string;
                if (deviceType === 'mobile' || deviceType === 'tv') {
                    const authToken = await generateAuthToken(user._id.toString(), deviceType, deviceName);
                    void logAuthEvent(req, { method: 'email', event: 'login_success_with_token', ok: true, email, userId: user._id?.toString(), message: `device=${deviceType} tokenLen=${authToken.length}` });
                    res.json({
                        message: 'Login successful',
                        user: userData,
                        authenticated: true,
                        token: authToken,
                        tokenExpiresIn: '90 days'
                    });
                }
                else {
                    void logAuthEvent(req, { method: 'email', event: 'login_success_session', ok: true, email, userId: user._id?.toString(), message: `sessionId=${req.sessionID?.slice(0, 12) || '?'}` });
                    res.json({
                        message: 'Login successful',
                        user: userData,
                        authenticated: true
                    });
                }
            });
        }
        catch (error: any) {
            void logAuthEvent(req, { method: 'email', event: 'login_unhandled_error', ok: false, email: emailRaw, message: error?.message || String(error) });
            res.status(500).json({ error: 'Failed to login' });
        }
    });
    app.post("/api/auth/token-session", async (req, res) => {
        try {
            const { token } = req.body;
            const tokenPrefix = typeof token === 'string' ? `${token.slice(0, 16)}…(${token.length})` : `<${typeof token}>`;
            logger.log(`🔐 token-session POST received tokenPrefix=${tokenPrefix} origin=${req.headers.origin || '(none)'} ua=${(req.headers['user-agent'] || '').slice(0, 60)}`);
            if (typeof token !== 'string' || token.length < 16 || token.length > 512) {
                logger.warn(`🔐 token-session REJECTED — bad token shape: ${tokenPrefix}`);
                return void res.status(400).json({ success: false, error: 'Token is required' });
            }
            const authToken = await findActiveAuthToken(token);
            if (!authToken) {
                logger.warn(`🔐 token-session 401 — active token not found (prefix=${tokenPrefix})`);
                return void res.status(401).json({ success: false, error: 'Invalid or expired token' });
            }
            const user: any = await pgFindUserById(authToken.userId);
            if (!user) {
                return void res.status(404).json({ success: false, error: 'User not found' });
            }
            (req.session as any).user = {
                userId: user._id.toString(),
                email: user.email,
                role: user.role
            };
            req.session.save((err: any) => {
                if (err) {
                    logger.error('Token-session save error:', err);
                    return void res.status(500).json({ success: false, error: 'Session save failed' });
                }
                logger.log('✅ Token-session created for:', user.email);
                // Return the user object so the frontend can populate its auth state
                // immediately, without depending on the session cookie persisting in
                // the browser (some cookie policies / privacy modes drop SameSite=None).
                const u: any = user;
                res.json({
                    success: true,
                    authenticated: true,
                    user: {
                        _id: u._id,
                        id: u._id,
                        fullName: u.fullName,
                        username: u.username,
                        email: u.email,
                        emailVerified: u.emailVerified,
                        role: u.role,
                        status: u.status,
                        avatar: u.avatar,
                        location: u.location,
                        isPublicProfile: u.isPublicProfile,
                        preferences: u.preferences,
                        followersCount: u.followersCount ?? 0,
                        followingCount: u.followingCount ?? 0,
                        favoriteStationsCount: u.favoriteStationsCount ?? 0,
                        totalListeningTime: u.totalListeningTime ?? 0,
                        lastLoginAt: u.lastLoginAt,
                        createdAt: u.createdAt,
                        following: [],
                    },
                });
            });
        }
        catch (error) {
            logger.error('Token-session error:', error);
            res.status(500).json({ success: false, error: 'Internal error' });
        }
    });
    // Get current user (check authentication)
    app.get("/api/auth/me", async (req, res) => {
        try {
            let userId: string | undefined = req.session?.user?.userId ||
                (req as any).user?._id?.toString() ||
                undefined;
            // Bearer-token fallback: after OAuth login, the frontend stores the auth
            // token in sessionStorage (_mrt_oat) and sends it as Authorization: Bearer
            // on every request. When the session cookie is dropped (SameSite=None
            // restrictions, cross-origin, strict privacy mode), we still authenticate
            // the user so they're not unexpectedly logged out.
            if (!userId) {
                const authHeader = req.headers['authorization'];
                const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
                if (bearerToken && typeof bearerToken === 'string' && bearerToken.length >= 16 && bearerToken.length <= 512) {
                    try {
                        const tokenDoc = await findActiveAuthToken(bearerToken);
                        if (tokenDoc) {
                            userId = tokenDoc.userId;
                            // Restore session so future requests use the cookie instead of Bearer.
                            if (req.session) {
                                (req.session as any).user = { userId };
                                req.session.save(() => { });
                            }
                        }
                    }
                    catch { throw new Error('Authentication token lookup unavailable'); }
                }
            }
            if (!userId) {
                return void res.json({ user: null, authenticated: false });
            }
            const [user, followState] = await Promise.all([pgFindUserById(userId), pgUserFollowState(userId)]);
            if (!user) {
                if (req.session) {
                    req.session.user = undefined;
                }
                return void res.json({ user: null, authenticated: false });
            }
            if (['inactive', 'suspended', 'banned', 'deleted'].includes(user.status) || user.isActive === false) return void res.status(403).json({ error: 'Account is not active' });
            const following = followState.following;
            const actualFollowingCount = following.length;
            const actualFollowersCount = followState.followersCount;
            if (user.followersCount !== actualFollowersCount || user.followingCount !== actualFollowingCount) {
                const countPatch = { followersCount: actualFollowersCount, followingCount: actualFollowingCount };
                void (async () => {
                    {
                        await pgUpdateUser(String(user._id), countPatch);
                    }
                })().catch(() => { });
            }
            const userData = {
                _id: user._id,
                id: user._id,
                fullName: user.fullName,
                username: user.username,
                email: user.email,
                emailVerified: user.emailVerified,
                role: user.role,
                status: user.status,
                avatar: user.avatar,
                location: user.location,
                isPublicProfile: user.isPublicProfile,
                preferences: user.preferences,
                notificationSettings: notificationSettingsFor(user),
                followersCount: actualFollowersCount,
                followingCount: actualFollowingCount,
                favoriteStationsCount: user.favoriteStationsCount,
                totalListeningTime: await pgListeningTotalMinutes(userId),
                lastLoginAt: user.lastLoginAt,
                createdAt: user.createdAt,
                following: following
            };
            res.json({ user: userData, authenticated: true });
        }
        catch (error) {
            res.status(503).json({ error: 'Authentication service unavailable' });
        }
    });
    // User logout
    app.post("/api/auth/logout", async (req, res) => {
        try {
            // Revoke any Bearer token that was used as a session-cookie fallback so
            // it can't be replayed after the user explicitly signs out.
            const bearerToken = (() => {
                const h = req.headers['authorization'];
                return h?.startsWith('Bearer ') ? h.slice(7) : null;
            })();
            if (bearerToken) {
                await revokeAuthToken(bearerToken);
            }
            if (req.session) {
                req.session.destroy((err) => {
                    if (err) {
                        return void res.status(500).json({ error: 'Failed to logout' });
                    }
                    res.clearCookie('connect.sid');
                    res.json({ message: 'Logout successful', authenticated: false });
                });
            }
            else {
                res.json({ message: 'Logout successful', authenticated: false });
            }
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to logout' });
        }
    });
    // Update user profile
    app.put("/api/auth/profile", requireAuth, async (req, res) => {
        try {
            const userId = String((req as any).user?._id || (req.session as any)?.user?.userId || (req.session as any)?.userId || '');
            const parsed = authProfileSchema.safeParse(req.body);
            if (!parsed.success) return void res.status(400).json({ error: 'Invalid profile fields', fields: parsed.error.flatten().fieldErrors });
            const { password, ...profilePatch } = parsed.data;
            const existing: any = await pgFindUserById(userId);
            if (!existing) {
                return void res.status(404).json({ error: 'User not found' });
            }
            const changes: Record<string, any> = { ...profilePatch };
            if (changes.email && changes.email !== existing.email?.toLowerCase()) {
                const other = await pgFindUserByEmail(changes.email);
                if (other && String(other._id) !== userId) return void res.status(409).json({ error: 'Email is already in use' });
                changes.emailVerified = false;
            }
            if (password && password.trim() !== '') {
                const bcrypt = await import('bcrypt');
                changes.passwordHash = await bcrypt.default.hash(password, 12);
            }
            // Write only submitted fields; a concurrent avatar/preferences save must not be overwritten.
            const user = await pgUpdateUser(userId, changes);
            if (!user) return void res.status(404).json({ error: 'User not found' });
            await invalidateProfileCaches(existing);
            await invalidateProfileCaches(user);
            const userData = {
                _id: user._id,
                fullName: user.fullName,
                username: user.username,
                email: user.email,
                emailVerified: user.emailVerified,
                role: user.role,
                status: user.status,
                avatar: user.avatar,
                location: user.location,
                isPublicProfile: user.isPublicProfile,
                preferences: user.preferences,
                followersCount: user.followersCount,
                followingCount: user.followingCount,
                favoriteStationsCount: user.favoriteStationsCount,
                totalListeningTime: user.totalListeningTime,
                lastLoginAt: user.lastLoginAt
            };
            res.json({
                message: 'Profile updated successfully',
                user: userData
            });
        }
        catch (error: any) {
            res.status(error?.code === '23505' ? 409 : 500).json({ error: error?.code === '23505' ? 'Email is already in use' : 'Failed to update profile' });
        }
    });
    app.get('/api/user/notification-settings', requireAuth, async (req, res) => {
        try {
            const user = await pgFindUserById(String((req as any).user?._id || (req.session as any)?.user?.userId || (req.session as any)?.userId));
            if (!user) return void res.status(404).json({ error: 'User not found' });
            res.json({ notificationSettings: notificationSettingsFor(user) });
        } catch { res.status(503).json({ error: 'Notification settings unavailable' }); }
    });
    const saveNotificationSettings: import('express').RequestHandler = async (req, res) => {
        const parsed = notificationSettingsSchema.safeParse(req.body);
        if (!parsed.success || !Object.keys(parsed.data).length) return void res.status(400).json({ error: 'Invalid notification settings' });
        try {
            const user = await pgUpdateUser(String((req as any).user?._id || (req.session as any)?.user?.userId || (req.session as any)?.userId), { notificationSettings: parsed.data });
            if (!user) return void res.status(404).json({ error: 'User not found' });
            res.json({ notificationSettings: notificationSettingsFor(user) });
        } catch { res.status(503).json({ error: 'Could not save notification settings' }); }
    };
    app.patch('/api/user/notification-settings', requireAuth, saveNotificationSettings);
    app.put('/api/user/notification-settings', requireAuth, saveNotificationSettings);
    // Forgot password
    app.post("/api/auth/forgot-password", async (req, res) => {
        try {
            const { email } = req.body;
            logger.log(`🔑 Password reset request for: ${email}`);
            const user: any = await pgFindUserByEmail(email);
            if (!user) {
                return void res.json({ message: 'If an account exists with this email, you will receive reset instructions.' });
            }
            const crypto = await import('crypto');
            const resetToken = crypto.default.randomBytes(32).toString('hex');
            const resetTokenHash = crypto.default.createHash('sha256').update(resetToken).digest('hex');
            const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour
            // Store only the hash in DB — original token goes out via email only
            user.resetPasswordToken = resetTokenHash;
            (user as any).resetPasswordExpires = resetTokenExpiry;
            const resetPatch = { resetPasswordToken: resetTokenHash, resetPasswordExpires: resetTokenExpiry };
            await pgUpdateUser(String(user._id), resetPatch);
            const sgMail = (await import('@sendgrid/mail')).default;
            sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');
            const resetUrl = `https://themegaradio.com/reset-password?token=${resetToken}`;
            const msg = {
                to: email,
                from: 'noreply@themegaradio.com',
                subject: 'Reset Your Password - Mega Radio',
                html: `
          <div style="font-family: 'Ubuntu', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0E0E0E; color: white;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #FF4199; margin: 0;">Mega Radio</h1>
            </div>
            <div style="background-color: #1a1a1a; padding: 30px; border-radius: 10px;">
              <h2 style="color: white; margin-top: 0;">Reset Your Password</h2>
              <p style="color: #ccc; line-height: 1.6;">Click the button below to reset your password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #FF4199; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block;">Reset Password</a>
              </div>
              <p style="color: #888; font-size: 14px;">This link expires in 1 hour.</p>
            </div>
          </div>
        `,
            };
            await sgMail.send(msg);
            res.json({ message: 'If an account exists with this email, you will receive reset instructions.' });
        }
        catch (error) {
            res.json({ message: 'If an account exists with this email, you will receive reset instructions.' });
        }
    });
    // Reset password with token
    app.post("/api/auth/reset-password", async (req, res) => {
        try {
            const { token, newPassword } = req.body;
            if (typeof token !== 'string' || !token || token.length > 512 || typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) {
                return void res.status(400).json({ error: 'Invalid password' });
            }
            const crypto = await import('crypto');
            const tokenHash = crypto.default.createHash('sha256').update(String(token)).digest('hex');
            const user: any = await pgFindUserByResetToken(tokenHash);
            if (!user) {
                return void res.status(400).json({ error: 'Invalid or expired reset token' });
            }
            const bcrypt = await import('bcrypt');
            const passwordHash = await bcrypt.default.hash(newPassword, 12);
            if (!await pgResetUserPassword(tokenHash, passwordHash)) return void res.status(400).json({ error: 'Invalid or expired reset token' });
            res.json({ message: 'Password has been reset successfully.' });
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to reset password' });
        }
    });
    // User Following System
    app.post("/api/user/follow/:userId", requireAuth, async (req, res) => {
        try {
            const followingUserId = req.params.userId;
            const currentUserId = (req.session as any).userId;
            if (!/^[a-f0-9]{24}$/i.test(String(followingUserId))) {
                return void res.status(400).json({ error: "Invalid user ID" });
            }
            if (followingUserId === currentUserId) {
                return void res.status(400).json({ error: "You cannot follow yourself" });
            }
            const userToFollow: any = await pgFindUserById(followingUserId);
            if (!userToFollow) {
                return void res.status(404).json({ error: "User not found" });
            }
            if (await (pgIsFollowing(currentUserId, followingUserId))) {
                return void res.status(400).json({ error: "Already following this user" });
            }
            const followResult = await userEngagementService.followUser(currentUserId, followingUserId);
            if (!followResult.success)
                return void res.status(500).json({ error: followResult.message });
            const currentUser: any = await pgFindUserById(currentUserId);
            await createFollowNotification({
                userId: followingUserId, fromUserId: currentUserId, type: 'follow', title: 'New Follower',
                message: `${currentUser?.fullName || currentUser?.username || 'Someone'} started following you`,
                data: { followerId: currentUserId }
            });
            const { invalidateSocialCacheForUser } = deps;
            await Promise.all([
                invalidateSocialCacheForUser(currentUserId, currentUser?.email),
                invalidateSocialCacheForUser(followingUserId, (userToFollow as any)?.email)
            ]);
            res.json(followResult);
        }
        catch (error: any) {
            logger.error('Follow error:', error?.message || error);
            res.status(500).json({ error: 'Failed to follow user' });
        }
    });
    app.delete("/api/user/unfollow/:userId", requireAuth, async (req, res) => {
        try {
            const followingUserId = req.params.userId;
            const currentUserId = (req.session as any).userId;
            if (!/^[a-f0-9]{24}$/i.test(String(followingUserId))) {
                return void res.status(400).json({ error: "Invalid user ID" });
            }
            const wasFollowing = await pgIsFollowing(currentUserId, followingUserId);
            if (!wasFollowing) {
                return void res.status(400).json({ error: "Not following this user" });
            }
            const unfollowResult = await userEngagementService.unfollowUser(currentUserId, followingUserId);
            if (!unfollowResult.success)
                return void res.status(500).json({ error: unfollowResult.message });
            const currentUser: any = await pgFindUserById(currentUserId);
            await createFollowNotification({
                userId: followingUserId, fromUserId: currentUserId, type: 'unfollow', title: 'User Unfollowed',
                message: `${currentUser?.fullName || currentUser?.username || 'Someone'} unfollowed you`,
                data: { followerId: currentUserId }
            });
            const { invalidateSocialCacheForUser } = deps;
            const unfollowedUser: any = await pgFindUserById(followingUserId);
            await Promise.all([
                invalidateSocialCacheForUser(currentUserId, currentUser?.email),
                invalidateSocialCacheForUser(followingUserId, unfollowedUser?.email)
            ]);
            res.json(unfollowResult);
        }
        catch (error: any) {
            logger.error('Unfollow error:', error?.message || error);
            res.status(500).json({ error: 'Failed to unfollow user' });
        }
    });
    app.get("/api/user/is-following/:userId", requireAuth, async (req, res) => {
        try {
            const targetUserId = req.params.userId;
            const currentUserId = (req.session as any).userId;
            if (!/^[a-f0-9]{24}$/i.test(String(targetUserId))) {
                return void res.status(400).json({ error: "Invalid user ID" });
            }
            const follow = await pgIsFollowing(currentUserId, targetUserId);
            res.json({ isFollowing: follow });
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to check follow status' });
        }
    });
    app.get("/api/user/followers/:userId", async (req, res) => {
        try {
            const userId = req.params.userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const skip = (page - 1) * limit;
            const cacheKey = `${CacheKeys.userFollowers(userId, page, limit)}:${engagementStore}`;
            const cached = await CacheManager.get(cacheKey);
            if (cached)
                return void res.json(cached);
            {
                const result = await pgFollowPage(userId, 'followers', page, Math.min(limit, 100));
                await CacheManager.set(cacheKey, result, { ttl: 120 });
                return void res.json(result);
            }
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to get followers' });
        }
    });
    app.get("/api/user/following/:userId", async (req, res) => {
        try {
            const userId = req.params.userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const skip = (page - 1) * limit;
            const cacheKey = `${CacheKeys.userFollowing(userId, page, limit)}:${engagementStore}`;
            const cached = await CacheManager.get(cacheKey);
            if (cached)
                return void res.json(cached);
            {
                const result = await pgFollowPage(userId, 'following', page, Math.min(limit, 100));
                await CacheManager.set(cacheKey, result, { ttl: 120 });
                return void res.json(result);
            }
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to get following' });
        }
    });
    // ============================================================
    // AVATAR UPLOAD & DELETE
    // ============================================================
    app.post("/api/user/avatar", requireAuth, async (req, res) => {
        try {
            const multer = (await import('multer')).default;
            const sharp = (await import('sharp')).default;
            const { uploadToS3, deleteFromS3 } = await import('../services/s3-storage');
            const upload = multer({
                storage: multer.memoryStorage(),
                limits: { fileSize: 5 * 1024 * 1024 },
                fileFilter: (_req, file, cb) => {
                    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
                    if (allowed.includes(file.mimetype))
                        cb(null, true);
                    else
                        cb(new Error('Invalid file type. Allowed: jpeg, png, webp'));
                }
            }).single('avatar');
            upload(req, res, async (uploadErr: any) => {
              try {
                if (uploadErr) {
                    if (uploadErr.code === 'LIMIT_FILE_SIZE') {
                        return void res.status(413).json({ error: 'File too large. Maximum size: 5MB' });
                    }
                    return void res.status(400).json({ error: uploadErr.message || 'Upload failed' });
                }
                if (!req.file) {
                    return void res.status(400).json({ error: 'No avatar file provided' });
                }
                const userId = (req.session as any)?.user?.userId || (req as any).user?._id?.toString();
                if (!userId)
                    return void res.status(401).json({ error: 'Not authenticated' });
                const user: any = await pgFindUserById(userId);
                if (!user) return void res.status(404).json({ error: 'User not found' });
                let metadata;
                try { metadata = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 }).metadata(); }
                catch { return void res.status(400).json({ error: 'Invalid image file' }); }
                if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100) {
                    return void res.status(400).json({ error: 'Image too small. Minimum size: 100x100px' });
                }
                const webpBuffer = await sharp(req.file.buffer)
                    .resize(400, 400, { fit: 'cover', position: 'centre' })
                    .webp({ quality: 80 })
                    .toBuffer();
                const s3Key = `avatars/user_${userId}_${Date.now()}.webp`;
                const avatarUrl = await uploadToS3(s3Key, webpBuffer, 'image/webp');
                const oldAvatar = user.avatar;
                user.avatar = avatarUrl;
                user.updatedAt = new Date();
                const updated = await pgUpdateUser(String(user._id), { avatar: avatarUrl });
                if (!updated) return void res.status(404).json({ error: 'User not found' });
                await invalidateProfileCaches(user);
                const oldKey = ownedAvatarKey(oldAvatar, String(user._id));
                if (oldKey) {
                    try {
                        await deleteFromS3(oldKey);
                    }
                    catch { }
                }
                res.json({ success: true, avatar: avatarUrl });
              } catch (error: any) {
                logger.error('Avatar upload failed');
                if (!res.headersSent) res.status(500).json({ error: 'Avatar upload failed' });
              }
            });
        }
        catch (error: any) {
            logger.log('Avatar upload error:', error.message);
            res.status(500).json({ error: 'Avatar upload failed' });
        }
    });
    app.delete("/api/user/avatar", requireAuth, async (req, res) => {
        try {
            const { deleteFromS3 } = await import('../services/s3-storage');
            const userId = (req.session as any)?.user?.userId || (req as any).user?._id?.toString();
            if (!userId)
                return void res.status(401).json({ error: 'Not authenticated' });
            const user: any = await pgFindUserById(userId);
            if (!user)
                return void res.status(404).json({ error: 'User not found' });
            const oldAvatar = user.avatar;
            const updated = await pgUpdateUser(String(user._id), { avatar: null });
            if (!updated) return void res.status(404).json({ error: 'User not found' });
            await invalidateProfileCaches(user);
            const oldKey = ownedAvatarKey(oldAvatar, String(user._id));
            if (oldKey) {
                try {
                    await deleteFromS3(oldKey);
                }
                catch { }
            }
            res.json({ success: true, message: 'Avatar removed' });
        }
        catch (error: any) {
            logger.log('Avatar delete error:', error.message);
            res.status(500).json({ error: 'Avatar delete failed' });
        }
    });
    app.delete("/api/user/delete-account", requireAuth, async (req, res) => {
        try {
            const userId = (req.session as any)?.userId || (req.session as any)?.user?.userId;
            if (!userId) {
                return void res.status(401).json({ success: false, message: 'Authentication required' });
            }
            let user: any = await pgFindUserById(userId);
            if (!user) {
                return void res.status(404).json({ success: false, message: 'User not found' });
            }
            const userIdStr = userId.toString();
            const removed = await pgDeleteUser(userIdStr);
            if (!removed) return void res.status(404).json({ success: false, message: 'User not found' });
            const avatarKey = ownedAvatarKey(user.avatar, userIdStr);
            if (avatarKey) {
                try {
                    const s3Module = await import('../services/s3-storage');
                    await s3Module.deleteFromS3(avatarKey);
                }
                catch { }
            }
            await invalidateProfileCaches(user);
            const CacheManagerModule = (await import('../cache')).default;
            await CacheManagerModule.clearByPattern(`user-favorites:${userIdStr}`);
            await CacheManagerModule.del(`user_profile_${userIdStr}`);
            logger.log(`🗑️ Account deleted: user ${userIdStr} (PostgreSQL transaction)`);
            if (req.session) {
                await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
            }
            res.clearCookie('connect.sid');
            res.json({ success: true, message: 'Account deleted successfully' });
        }
        catch (error: any) {
            logger.error('Account deletion error:', error.message);
            res.status(500).json({ success: false, message: 'Could not delete account' });
        }
    });
    // 2026-05-13: minimal listening-history endpoint that returns the last
    // ~20 stations the logged-in user listened to. Previously the client
    // (profile-discover.tsx) called this URL and the server had no route, so
    // every profile load produced an infinite TanStack-Query 404 retry loop.
    // The route is intentionally tolerant — auth is OPTIONAL and the response
    // is always a 200 with an array (possibly empty) so the client never has
    // to special-case 401/404 again.
    app.get("/api/user/last-played", async (req, res) => {
        try {
            const sessionUser = (req.session as any)?.user;
            const passportUser = (req.user as any);
            const userId = sessionUser?.userId || passportUser?._id?.toString() || passportUser?.id;
            if (!userId) {
                return void res.json([]);
            }
            const rows = (await getPostgresPool().query(
                `SELECT station_id AS "stationId",station_name AS "stationName",country,genre,listened_at AS "listenedAt"
                 FROM listening_history WHERE user_id=$1 AND interaction_type IN ('play','favorite')
                 ORDER BY listened_at DESC,id DESC LIMIT 20`, [String(userId)]
            )).rows;
            const seen = new Set<string>();
            const result = rows
                .filter((r: any) => {
                if (!r.stationId || seen.has(r.stationId))
                    return false;
                seen.add(r.stationId);
                return true;
            })
                .map((r: any) => ({
                stationId: r.stationId,
                name: r.stationName,
                country: r.country,
                genre: r.genre,
                lastPlayedAt: r.listenedAt,
            }));
            res.json(result);
        }
        catch (error: any) {
            logger.error('last-played fetch error:', error?.message || error);
            res.status(503).json({ error: 'Listening history is temporarily unavailable' });
        }
    });
    // 2026-05-13: admin-only viewer for the persistent auth event log. Lets
    // the operator inspect the last N login attempts (Google / Apple / Email
    // — both web and mobile flows) even if Railway has restarted the process
    // or the user has refreshed the page since the failure happened. Filters
    // are simple string matches; results are capped at 500 rows.
    app.get("/api/admin/auth-events", requireAdmin, async (req, res) => {
        try {
            const limit = Math.min(Math.max(parseInt(String(req.query.limit || '200'), 10) || 200, 1), 500);
            const filter: any = {};
            if (req.query.method)
                filter.method = String(req.query.method);
            if (req.query.email)
                filter.email = String(req.query.email).toLowerCase();
            if (req.query.ok === 'true')
                filter.ok = true;
            if (req.query.ok === 'false')
                filter.ok = false;
            if (req.query.event)
                filter.event = String(req.query.event);
            const sinceMs = parseInt(String(req.query.sinceMs || ''), 10);
            if (sinceMs > 0)
                filter.ts = { $gte: new Date(Date.now() - sinceMs) };
            const rows = await pgListAuthEvents({ ...filter, since: filter.ts?.$gte }, limit);
            res.json({
                count: rows.length,
                filter: { ...filter, ts: filter.ts ? `>= ${filter.ts.$gte.toISOString()}` : undefined },
                events: rows,
            });
        }
        catch (error: any) {
            logger.error('auth-events viewer error:', error?.message || error);
            res.status(500).json({ error: 'Failed to load auth events' });
        }
    });
    // 2026-05-13: admin-only OAuth config inspector. When Apple returns
    // "Invalid client id or web redirect url" or Google returns "redirect_uri
    // mismatch", paste the values below into the respective developer console
    // and confirm they match EXACTLY. Secrets/keys are never returned — only
    // the public-facing identifiers and URLs that the IdP itself sees.
    app.get("/api/admin/auth-config", requireAdmin, (_req, res) => {
        const frontendUrl = process.env.FRONTEND_URL || 'https://themegaradio.com';
        const appleServiceId = process.env.APPLE_SERVICE_ID || process.env.APPLE_CLIENT_ID || '';
        const appleRedirect = process.env.APPLE_CALLBACK_URL || `${frontendUrl}/api/auth/apple/callback`;
        const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
        const googleRedirect = process.env.GOOGLE_CALLBACK_URL || `${frontendUrl}/api/auth/google/callback`;
        res.json({
            frontendUrl,
            apple: {
                configured: !!(appleServiceId && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
                serviceId: appleServiceId || '(missing — set APPLE_SERVICE_ID)',
                redirectUri: appleRedirect,
                teamIdSet: !!process.env.APPLE_TEAM_ID,
                keyIdSet: !!process.env.APPLE_KEY_ID,
                privateKeySet: !!process.env.APPLE_PRIVATE_KEY,
                instructions: [
                    'Open https://developer.apple.com/account/resources/identifiers/list/serviceId',
                    `Click your Service ID — its identifier MUST equal: ${appleServiceId || '(unset)'}`,
                    'Open "Configure" next to "Sign In with Apple"',
                    `Domains and Subdomains MUST contain: ${new URL(frontendUrl).hostname}`,
                    `Return URLs MUST contain (verbatim): ${appleRedirect}`,
                    'Save and try Apple login again.',
                ],
            },
            google: {
                configured: !!(googleClientId && process.env.GOOGLE_CLIENT_SECRET),
                clientIdPrefix: googleClientId ? `${googleClientId.slice(0, 16)}…` : '(missing)',
                redirectUri: googleRedirect,
            },
        });
    });
}
