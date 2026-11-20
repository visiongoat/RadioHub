import {publishStoredNotification} from '../services/notification-events';
import express from 'express';
import { engagementStore, UserEngagementService } from '../services/user-engagement-service';
import { pgResolveUserId, pgPublicProfileCacheIdentity, pgFollowPage } from '../data/postgres-engagement-store';
import { publicStationCache as CacheManager } from '../public-station-cache';
import { publicStationResponseCache } from '../middleware/public-station-cache';
import { findActiveAuthToken } from '../data/auth-token-store';
import { PushNotificationService } from '../services/pushNotificationService';
import { isQuotaExceeded, handleQuotaError, isQuotaError, safeWrite } from '../utils/quota-guard';
import { pgFindUserById, newPublicUserId, userStore } from '../data/postgres-user-store';
import { notificationStore, pgCreateNotification } from '../data/postgres-notification-store';
const router = express.Router();
router.use(publicStationResponseCache);
const userEngagementService = new UserEngagementService();
// Get user profile by slug
router.get('/profile/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const currentUserId = await resolveCurrentUserId(req);
        const identity = await pgPublicProfileCacheIdentity(slug);
        if (!identity) return void res.status(404).json({ error: 'Profile not found' });
        const cacheKey = `user-engagement-profile:v2:${identity}:${currentUserId || 'anon'}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) {
            return void res.json(cached);
        }
        const profile = await userEngagementService.getUserProfileBySlug(slug, currentUserId || undefined);
        if (!profile) {
            return void res.status(404).json({ error: 'Profile not found' });
        }
        await CacheManager.set(cacheKey, profile, { ttl: 120 });
        res.json(profile);
    }
    catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get user favorites by slug
router.get('/profile/:slug/favorites', async (req, res) => {
    try {
        const { slug } = req.params;
        const { page = '1', limit = '20' } = req.query;
        const identity = await pgPublicProfileCacheIdentity(slug);
        if (!identity) return void res.status(404).json({ error: 'Profile not found or favorites private' });
        const cacheKey = `user-engagement-favs:v2:${identity}:p${page}:l${limit}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached) {
            return void res.json(cached);
        }
        const favorites = await userEngagementService.getUserFavoritesBySlug(slug, parseInt(page as string), parseInt(limit as string));
        if (!favorites) {
            return void res.status(404).json({ error: 'Profile not found or favorites private' });
        }
        await CacheManager.set(cacheKey, favorites, { ttl: 120 });
        res.json(favorites);
    }
    catch (error) {
        console.error('Error fetching user favorites:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Combined endpoint: profile + favorites + recently-played in ONE round trip
// Eliminates 3-request waterfall on the frontend (no more enabled: !!userProfile?.isPublic blocking)
router.get('/profile/:slug/full', async (req, res) => {
    try {
        const { slug } = req.params;
        const { favLimit = '20', recentLimit = '20' } = req.query;
        const currentUserId = await resolveCurrentUserId(req);
        const identity = await pgPublicProfileCacheIdentity(slug);
        if (!identity) return void res.status(404).json({ error: 'Profile not found' });
        const cacheKey = `user-engagement-full:v2:${identity}:${currentUserId || 'anon'}:fl${favLimit}:rl${recentLimit}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached)
            return void res.json(cached);
        const profile = await userEngagementService.getUserProfileBySlug(slug, currentUserId || undefined);
        if (!profile)
            return void res.status(404).json({ error: 'Profile not found' });
        let favorites: any[] = [];
        let total = 0;
        let recentlyPlayed: any[] = [];
        if (profile.isPublic) {
            const [favResult, recentlyPlayedResult] = await Promise.all([
                userEngagementService.getUserFavoritesBySlug(slug, 1, parseInt(favLimit as string)),
                userEngagementService.getRecentlyPlayed(slug, parseInt(recentLimit as string)),
            ]);
            favorites = favResult?.favorites || [];
            total = favResult?.total ?? favorites.length;
            recentlyPlayed = recentlyPlayedResult;
        }
        const result = { profile, favorites, total, recentlyPlayed };
        await CacheManager.set(cacheKey, result, { ttl: 90 });
        res.json(result);
    }
    catch (error) {
        console.error('Error fetching full user profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get recently played by slug
router.get('/profile/:slug/recently-played', async (req, res) => {
    try {
        const { slug } = req.params;
        const { limit = '20' } = req.query;
        const identity = await pgPublicProfileCacheIdentity(slug);
        if (!identity) return void res.status(404).json({ error: 'Profile not found' });
        const cacheKey = `user-engagement-recent:${slug}:${identity}:l${limit}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached)
            return void res.json(cached);
        const result = await userEngagementService.getRecentlyPlayed(slug, parseInt(limit as string));
        await CacheManager.set(cacheKey, result, { ttl: 60 });
        res.json(result);
    }
    catch (error) {
        res.status(503).json({ error: 'Listening history unavailable' });
    }
});
// Get trending stations
router.get('/trending', async (req, res) => {
    try {
        const { country, limit = '100' } = req.query;
        const cacheKey = `user-engagement-trending:${country || 'all'}:${limit}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached)
            return void res.json(cached);
        const trending = await userEngagementService.getTrendingStations(country as string, parseInt(limit as string));
        await CacheManager.set(cacheKey, trending, { ttl: 300 });
        res.json(trending);
    }
    catch (error) {
        console.error('Error fetching trending stations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get community favorites
router.get('/community/favorites', async (req, res) => {
    try {
        const { country, genre, limit = '100' } = req.query;
        const cacheKey = `user-engagement-community:${country || 'all'}:${genre || 'all'}:${limit}`;
        const cached = await CacheManager.get(cacheKey);
        if (cached)
            return void res.json(cached);
        const favorites = await userEngagementService.getCommunityFavorites(country as string, genre as string, parseInt(limit as string));
        await CacheManager.set(cacheKey, favorites, { ttl: 300 });
        res.json(favorites);
    }
    catch (error) {
        console.error('Error fetching community favorites:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Rate a station
router.post('/stations/:stationId/rate', async (req, res) => {
    try {
        const { stationId } = req.params;
        const { rating, review } = req.body;
        const userId = await resolveCurrentUserId(req);
        if (!userId) {
            return void res.status(401).json({ error: 'User authentication required' });
        }
        if (!rating || rating < 1 || rating > 5) {
            return void res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }
        const result = await userEngagementService.rateStation(userId, stationId, rating, review || '');
        res.json(result);
    }
    catch (error) {
        console.error('Error rating station:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get station ratings
router.get('/stations/:stationId/ratings', async (req, res) => {
    try {
        const { stationId } = req.params;
        const { page = '1', limit = '10' } = req.query;
        const ratings = await userEngagementService.getStationRatings(stationId, parseInt(page as string), parseInt(limit as string));
        res.json(ratings);
    }
    catch (error) {
        console.error('Error fetching station ratings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Add/remove station favorite
router.post('/stations/:stationId/favorite', async (req, res) => {
    try {
        const { stationId } = req.params;
        const { action } = req.body;
        const userId = await resolveCurrentUserId(req);
        if (!userId) {
            return void res.status(401).json({ error: 'User authentication required' });
        }
        if (action !== 'add' && action !== 'remove') {
            return void res.status(400).json({ error: 'Action must be "add" or "remove"' });
        }
        const result = action === 'add'
            ? await userEngagementService.addFavorite(userId, stationId)
            : await userEngagementService.removeFavorite(userId, stationId);
        res.json(result);
    }
    catch (error) {
        console.error('Error updating favorite:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Helper: resolve userId from session (web) or Bearer token (mobile)
async function resolveCurrentUserId(req: any): Promise<string | null> {
    const session = req.session;
    const fromSession = session?.userId || session?.user?.userId || session?.passport?.user || req.user?._id || req.user?.id;
    if (fromSession)
        return fromSession.toString();
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (bearerToken) {
        const tokenDoc = await findActiveAuthToken(bearerToken, false);
        if (tokenDoc)
            return tokenDoc.userId;
    }
    return null;
}
async function resolveTargetUserId(param: string): Promise<string | null> {
    return pgResolveUserId(param);
}
// Account-only relationship lists, always read fresh after a removal.
router.get('/connections/:direction', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store' });
    try {
        const currentUserId = await resolveCurrentUserId(req);
        if (!currentUserId) return void res.status(401).json({ error: 'Authentication required' });
        const direction = req.params.direction;
        const page = req.query.page === undefined ? 1 : Number(req.query.page);
        const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
        if ((direction !== 'followers' && direction !== 'following')
            || !Number.isSafeInteger(page) || page < 1 || page > 1000000
            || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            return void res.status(400).json({ error: 'Invalid connection list parameters' });
        res.json(await pgFollowPage(currentUserId, direction, page, limit));
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Remove only an incoming relationship to the authenticated account.
router.post('/remove-follower/:userId', async (req, res) => {
    try {
        const currentUserId = await resolveCurrentUserId(req);
        if (!currentUserId) return void res.status(401).json({ error: 'Authentication required' });
        const targetUserId = await resolveTargetUserId(req.params.userId);
        if (!targetUserId) return void res.status(404).json({ error: 'User not found' });
        if (targetUserId === currentUserId) return void res.status(400).json({ error: 'Cannot remove yourself' });
        res.json(await userEngagementService.unfollowUser(targetUserId, currentUserId));
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Follow a user
router.post('/follow/:userId', async (req, res) => {
    try {
        const currentUserId = await resolveCurrentUserId(req);
        if (!currentUserId)
            return void res.status(401).json({ error: 'Authentication required' });
        const targetUserId = await resolveTargetUserId(req.params.userId);
        if (!targetUserId)
            return void res.status(404).json({ error: 'User not found' });
        if (currentUserId === targetUserId)
            return void res.status(400).json({ error: 'Cannot follow yourself' });
        const result = await userEngagementService.followUser(currentUserId, targetUserId);
        const follower: any = await pgFindUserById(currentUserId);
        const followerName = (follower as any)?.fullName || (follower as any)?.username || 'Someone';
        const followerSlug = (follower as any)?.slug;
        const notificationId = newPublicUserId();
        const notification = {
            userId: targetUserId,
            fromUserId: currentUserId,
            type: 'follow',
            title: 'New Follower',
            message: `${followerName} started following you`,
            data: { followerId: currentUserId, followerSlug, userName:followerName, userAvatar:follower?.avatar||follower?.profileImageUrl }
        };
        {
            await pgCreateNotification({ id: notificationId, ...notification });
            await publishStoredNotification(targetUserId,notification.type,notification.data);
        }
        // Send push notification (web + mobile, non-blocking)
        PushNotificationService.sendFollowNotification(targetUserId, followerName, followerSlug, currentUserId).catch(() => { });
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Unfollow a user
router.post('/unfollow/:userId', async (req, res) => {
    try {
        const currentUserId = await resolveCurrentUserId(req);
        if (!currentUserId)
            return void res.status(401).json({ error: 'Authentication required' });
        const targetUserId = await resolveTargetUserId(req.params.userId);
        if (!targetUserId)
            return void res.status(404).json({ error: 'User not found' });
        res.json(await userEngagementService.unfollowUser(currentUserId, targetUserId));
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get popular user profiles
router.get('/profiles/popular', async (req, res) => {
    try {
        const { limit = '20' } = req.query;
        res.set('Cache-Control', 'no-store');
        res.set('CDN-Cache-Control', 'no-store');
        res.set('Cloudflare-CDN-Cache-Control', 'no-store');
        const profiles = await userEngagementService.getPopularProfiles(parseInt(limit as string));
        const result = {
            profiles,
            meta: { count: profiles.length, generatedAt: new Date().toISOString() }
        };
        res.json(result);
    }
    catch (error) {
        console.error('Error fetching popular profiles:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
export { router as userEngagementRouter };
