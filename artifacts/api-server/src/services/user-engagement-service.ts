import { pgUserFollowCounts } from '../data/postgres-user-store';
import { pgCommunityFavorites, pgPublicProfile, pgRateStation, pgRecentlyPlayed, pgSetFavorite, pgSetFollow, pgStationRatings, pgTrendingStations, pgUserFavorites, } from '../data/postgres-engagement-store';
import { getCommunityProfiles, invalidateCommunityProfiles } from './community-profiles';
import { ensurePostgresUser } from '../data/auth-token-store';
import { publicStationCache } from '../public-station-cache';

async function invalidatePublicProfileSummaries(...userIds: string[]): Promise<void> {
    // Keys begin with the canonical ID so a mutation refreshes every slug,
    // viewer and favorites limit for both affected public profile counts.
    await Promise.all([...new Set(userIds)].flatMap(id => [
        publicStationCache.clearByPattern(`user-engagement-profile:v2:${id}:`),
        publicStationCache.clearByPattern(`user-engagement-full:v2:${id}:`),
    ]));
}

async function invalidateFavoriteProfile(userId: string): Promise<void> {
    await Promise.all([
        invalidateCommunityProfiles(),
        invalidatePublicProfileSummaries(userId),
        publicStationCache.clearByPattern(`user-engagement-favs:v2:${userId}:`),
    ]);
}
async function publishFollowCounts(...ids:string[]) {
  const {chatService}=await import('./chat-service');
  await Promise.all(ids.map(async userId=>{chatService.sendToUser(userId,{type:'social:counts',userId,...await pgUserFollowCounts(userId)});}));
}
export const engagementStore: string = "postgres";
export interface TrendingStation {
    stationId: string;
    totalFavorites: number;
    averageRating: number;
    trendingScore: number;
    weeklyFavorites: number;
    station: {
        name: string;
        country: string;
        genre: string;
        favicon: string;
        slug: string;
        votes: number;
    };
}
export interface CommunityFavorite {
    stationId: string;
    totalFavorites: number;
    averageRating: number;
    totalRatings: number;
    trendingScore: number;
    station: {
        name: string;
        country: string;
        tags: string;
        favicon: string;
        slug: string;
        votes: number;
    };
}
export interface UserProfile {
    displayName: string;
    bio?: string;
    slug: string;
    avatar?: string;
    isPublic: boolean;
    followersCount?: number;
    followingCount?: number;
    isFollowing?: boolean;
    listeningStats: {
        totalListenHours: number;
        uniqueStationsListened: number;
        favoriteGenres: Array<{
            genre: string;
            count: number;
            percentage: number;
        }>;
        favoriteCountries: Array<{
            country: string;
            count: number;
            percentage: number;
        }>;
        peakListeningHours: number[];
        joinedDate: string;
        lastActiveDate: string;
    };
    privacy: {
        showFavorites: boolean;
        showStatistics: boolean;
    };
}
export class UserEngagementService {
    async getUserProfileBySlug(slug: string, currentUserId?: string): Promise<UserProfile | null> {
        return pgPublicProfile(slug, currentUserId);
    }
    // Get user favorites with station details
    // OPTIMIZED: no longer calls getUserProfileBySlug (was running all 9 queries again)
    async getUserFavoritesBySlug(slug: string, page = 1, limit = 20): Promise<any> {
        return pgUserFavorites(slug, page, limit);
    }
    // Get trending stations based on real user favorites from UserFavorite collection
    async getTrendingStations(country?: string, limit = 50): Promise<any> {
        return pgTrendingStations(country, limit);
    }
    // Get community favorite stations
    async getCommunityFavorites(country?: string, genre?: string, limit = 50): Promise<any> {
        return pgCommunityFavorites(country, genre, limit);
    }
    // Rate a station (mock implementation)
    async rateStation(userId: string, stationId: string, rating: number, review: string): Promise<any> {
        return pgRateStation(userId, stationId, rating, review);
    }
    // Get station ratings from real database
    async getStationRatings(stationId: string, page = 1, limit = 10): Promise<any> {
        return pgStationRatings(stationId, page, limit);
    }
    // Add station to favorites
    async addFavorite(userId: string, stationId: string): Promise<any> {
        const result = await pgSetFavorite(userId, stationId, true);
        await invalidateFavoriteProfile(userId);
        return result;
    }
    // Remove station from favorites
    async removeFavorite(userId: string, stationId: string): Promise<any> {
        const result = await pgSetFavorite(userId, stationId, false);
        await invalidateFavoriteProfile(userId);
        return result;
    }
    // Follow a user
    async followUser(followerId: string, followeeId: string): Promise<any> {
        const result = await pgSetFollow(followerId, followeeId, true);
        await invalidatePublicProfileSummaries(followerId, followeeId);
        await publishFollowCounts(followerId,followeeId).catch(()=>{});
        return result;
    }
    // Unfollow a user
    async unfollowUser(followerId: string, followeeId: string): Promise<any> {
        const result = await pgSetFollow(followerId, followeeId, false);
        await invalidatePublicProfileSummaries(followerId, followeeId);
        await publishFollowCounts(followerId,followeeId).catch(()=>{});
        return result;
    }
    // Get popular user profiles
    async getPopularProfiles(limit = 20): Promise<any[]> {
        return getCommunityProfiles(limit);
    }
    async getRecentlyPlayed(slug: string, limit = 20): Promise<any[]> {
        return pgRecentlyPlayed(slug, limit);
    }
}
