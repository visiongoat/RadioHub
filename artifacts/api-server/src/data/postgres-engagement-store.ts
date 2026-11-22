import crypto from "node:crypto";
import { recordStationVote } from "./station-vote-store";
import { getPostgresPool } from "../postgres-runtime";
import { stationVisibilityFields } from '../utils/station-visibility';
import { lockStationIdentity, resolveStationId, resolveStationIds } from './station-identity-store';
import { publicUserIdentity } from '../utils/public-user-identity';
import { normalizePublicUserSearch } from '../utils/user-handle';
import { resolveLegacyUserHandle } from './user-handle-store';

const pool = () => getPostgresPool();

function stationShape(row: Record<string, any>): Record<string, any> {
  return {
    ...(row.source || {}),
    _id: row.id,
    name: row.name,
    country: row.country,
    tags: row.tags_raw,
    genre: row.tags_raw,
    favicon: row.favicon,
    votes: row.votes,
    slug: row.slug,
    language: row.language,
    codec: row.codec,
    bitrate: row.bitrate,
    url: row.url,
    urlResolved: row.url_resolved,
    hasLogo: row.has_logo,
    logoAssets: row.logo_assets,
    averageRating: row.average_rating,
    totalRatings: row.total_ratings,
    lastCheckOk: row.last_check_ok,
    lastCheckTime: row.last_check_time,
    ...stationVisibilityFields(row),
  };
}

export async function pgResolveUserId(value: string): Promise<string | null> {
  const result = await pool().query<{ id: string }>(
    "SELECT id FROM users WHERE id=$1 OR slug=$1 OR username=$1 LIMIT 1",
    [value],
  );
  return result.rows[0]?.id ?? await resolveLegacyUserHandle(value);
}

/** Recheck privacy before serving cached public profile data; revision isolates prior edits. */
export async function pgPublicProfileCacheIdentity(value: string): Promise<string | null> {
  const result = await pool().query<{ id: string; revision: string }>(
    `SELECT id,updated_at::text AS revision FROM users
     WHERE (id=$1 OR slug=$1 OR username=$1) AND is_public_profile=true AND status='active' LIMIT 1`, [value],
  );
  const row = result.rows[0];
  if (!row) {
    const legacyId = await resolveLegacyUserHandle(value);
    return legacyId ? pgPublicProfileCacheIdentity(legacyId) : null;
  }
  return row ? `${row.id}:${row.revision}` : null;
}

export async function pgPublicProfile(value: string, currentUserId?: string): Promise<any | null> {
  const result = await pool().query(
    `SELECT u.*,
       (SELECT count(*)::int FROM user_follows f WHERE f.following_id=u.id) followers_count,
       (SELECT count(*)::int FROM user_follows f WHERE f.follower_id=u.id) following_count,
       EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=$2 AND f.following_id=u.id) is_following
     FROM users u
     WHERE (u.id=$1 OR u.slug=$1 OR u.username=$1) AND u.is_public_profile=true AND u.status='active' LIMIT 1`,
    [value, currentUserId || ""],
  );
  const user = result.rows[0];
  if (!user) {
    const legacyId = await resolveLegacyUserHandle(value);
    return legacyId ? pgPublicProfile(legacyId, currentUserId) : null;
  }
  const favorites = await pool().query<{ tags_raw: string | null; country: string | null }>(
    `SELECT s.tags_raw, s.country FROM user_favorites f
     JOIN stations s ON s.id=f.station_id WHERE f.user_id=$1 AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))`,
    [user.id],
  );
  const genres = new Map<string, number>();
  const countries = new Map<string, number>();
  for (const station of favorites.rows) {
    for (const tag of (station.tags_raw || "").split(",")) {
      const key = tag.trim().toLowerCase();
      if (key.length > 2) genres.set(key, (genres.get(key) || 0) + 1);
    }
    const country = station.country?.trim();
    if (country) countries.set(country, (countries.get(country) || 0) + 1);
  }
  const total = favorites.rowCount || 0;
  const ranked = (values: Map<string, number>, key: string) =>
    [...values.entries()]
      .map(([name, count]) => ({ [key]: name, count, percentage: total ? Math.round(count / total * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  return {
    _id: user.id,
    ...publicUserIdentity({ ...user, profileImageUrl: user.source?.profileImageUrl }),
    bio: user.bio || '',
    slug: user.slug || user.id,
    createdAt: user.created_at,
    favoriteStationsCount: total,
    isPublic: user.is_public_profile,
    followersCount: user.followers_count,
    followingCount: user.following_count,
    isFollowing: user.is_following,
    listeningStats: {
      // Favorites are not playback telemetry. Do not invent durations/activity.
      totalListenHours: null,
      uniqueStationsListened: null,
      favoriteGenres: ranked(genres, "genre"),
      favoriteCountries: ranked(countries, "country"),
      peakListeningHours: [],
      joinedDate: new Date(user.created_at).toISOString(),
      lastActiveDate: new Date(user.updated_at).toISOString(),
    },
    privacy: { showFavorites: user.is_public_profile, showStatistics: user.is_public_profile },
  };
}

export async function pgUserFavorites(value: string, page: number, limit: number): Promise<any | null> {
  const userId = await pgResolveUserId(value);
  if (!userId) return null;
  const publicResult = await pool().query<{ is_public_profile: boolean }>(
    "SELECT is_public_profile FROM users WHERE id=$1",
    [userId],
  );
  if (!publicResult.rows[0]?.is_public_profile) return null;
  const offset = Math.max(0, page - 1) * limit;
  const [rows, count] = await Promise.all([
    pool().query(
      `SELECT s.* FROM user_favorites f JOIN stations s ON s.id=f.station_id
       WHERE f.user_id=$1 AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false)) ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    pool().query<{ count: string }>("SELECT count(*)::text count FROM user_favorites f JOIN stations s ON s.id=f.station_id WHERE f.user_id=$1 AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))", [userId]),
  ]);
  return { favorites: rows.rows.map(stationShape), total: Number(count.rows[0]?.count || 0), page, limit };
}

export async function pgTrendingStations(country: string | undefined, limit: number): Promise<any> {
  const result = await pool().query(
    `SELECT s.*, count(f.user_id)::int total_favorites,
       (count(f.user_id) * (1 + COALESCE(s.votes,0)::numeric / 100))::float8 trending_score
     FROM user_favorites f JOIN stations s ON s.id=f.station_id
     WHERE (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false)) AND ($1='' OR s.country ILIKE '%' || $1 || '%')
     GROUP BY s.id ORDER BY trending_score DESC LIMIT $2`,
    [country && country !== "global" ? country : "", limit],
  );
  return {
    trending: result.rows.map((row) => ({
      stationId: row.id, totalFavorites: row.total_favorites,
      weeklyFavorites: row.total_favorites, trendingScore: Math.round(row.trending_score * 10) / 10,
      averageRating: row.average_rating || 0,
      station: { ...stationShape(row), genre: row.tags_raw, noIndex: row.no_index },
    })),
    meta: { count: result.rowCount || 0, country: country || "global", generatedAt: new Date().toISOString() },
  };
}

export async function pgCommunityFavorites(
  country: string | undefined,
  genre: string | undefined,
  limit: number,
): Promise<any> {
  const result = await pool().query(
    `SELECT s.*, count(f.user_id)::int total_favorites,
       min(f.created_at) first_favorited, max(f.created_at) last_favorited
     FROM user_favorites f JOIN stations s ON s.id=f.station_id
     WHERE (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false)) AND ($1='' OR s.country ILIKE '%' || $1 || '%')
       AND ($2='' OR s.tags_raw ILIKE '%' || $2 || '%')
     GROUP BY s.id ORDER BY total_favorites DESC, last_favorited DESC LIMIT $3`,
    [country && country !== "global" ? country : "", genre && genre !== "all" ? genre : "", limit],
  );
  return {
    favorites: result.rows.map((row) => ({
      stationId: row.id, totalFavorites: row.total_favorites,
      averageRating: row.average_rating || 0, totalRatings: row.total_ratings || 0,
      trendingScore: row.total_favorites * 2, station: stationShape(row),
    })),
    meta: { count: result.rowCount || 0, filters: { country: country || "global", genre: genre || "all" }, generatedAt: new Date().toISOString() },
  };
}

export async function pgRateStation(userId: string, stationId: string, rating: number, comment: string): Promise<any> {
  return pgRateStationIdentity({ userId }, stationId, rating, comment);
}

export interface RatingIdentity {
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
}

export async function pgRateStationIdentity(
  identity: RatingIdentity,
  stationId: string,
  rating: number,
  comment: string,
): Promise<any> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const identityType = identity.userId ? "user" : identity.sessionId ? "session" : "ip";
    const identityValue = identity.userId || identity.sessionId || identity.ipAddress;
    if (!identityValue) throw new Error("Rating identity is required");

    // All identities on a station must serialize BEFORE inserting and computing
    // aggregates; an identity-only lock permits stale averages/counts to win.
    const canonicalId = await lockStationIdentity(stationId, client);
    if (!canonicalId) throw new Error("Station not found");
    stationId = canonicalId;
    // Also retain identity uniqueness for anonymous IP-only ratings.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${stationId}:${identityType}:${identityValue}`,
    ]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM station_ratings WHERE station_id=$1 AND
       (($2='user' AND user_id=$3) OR ($2='session' AND session_id=$3) OR ($2='ip' AND ip_address=$3))
       LIMIT 1`,
      [stationId, identityType, identityValue],
    );
    const isNew = existing.rowCount === 0;
    const result = isNew
      ? await client.query(
          `INSERT INTO station_ratings(id,station_id,user_id,session_id,ip_address,rating,comment)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id,user_id,session_id,ip_address,station_id,rating,comment,created_at`,
          [crypto.randomUUID(), stationId, identity.userId || null, identity.sessionId || null,
            identity.ipAddress || null, rating, comment || null],
        )
      : await client.query(
          `UPDATE station_ratings SET rating=$2,comment=$3,updated_at=now() WHERE id=$1
           RETURNING id,user_id,session_id,ip_address,station_id,rating,comment,created_at`,
          [existing.rows[0].id, rating, comment || null],
        );
    await client.query(
      `UPDATE stations s SET average_rating=x.average_rating,total_ratings=x.total_ratings
       FROM (SELECT station_id,round(avg(rating)::numeric,1)::real average_rating,count(*)::int total_ratings
             FROM station_ratings WHERE station_id=$1 GROUP BY station_id) x
       WHERE s.id=x.station_id`,
      [stationId],
    );
    // Legacy signed-in ratings share the same one-vote identity as thumbs-up.
    if (identity.userId) await recordStationVote(client, stationId, identity.userId);
    const stats = await pgStationRatingStats(stationId, client);
    const station = await client.query<{ votes: number }>("SELECT votes FROM stations WHERE id=$1", [stationId]);
    await client.query("COMMIT");
    return { success: true, message: "Rating submitted successfully", rating: result.rows[0], stats: {
      ...stats, votes: station.rows[0]?.votes || 0,
    } };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function pgStationRatingStats(stationId: string, queryable = pool() as Pick<import('pg').PoolClient, 'query'>): Promise<any> {
  stationId = await resolveStationId(stationId, queryable) ?? stationId;
  const result = await queryable.query(
    `SELECT count(*)::int AS total,
       COALESCE(round(avg(rating)::numeric,1),0)::float8 AS average,
       count(*) FILTER (WHERE rating=1)::int AS stars1,
       count(*) FILTER (WHERE rating=2)::int AS stars2,
       count(*) FILTER (WHERE rating=3)::int AS stars3,
       count(*) FILTER (WHERE rating=4)::int AS stars4,
       count(*) FILTER (WHERE rating=5)::int AS stars5
     FROM station_ratings WHERE station_id=$1`,
    [stationId],
  );
  const row = result.rows[0];
  return { averageRating: Number(row?.average || 0), totalRatings: Number(row?.total || 0), ratingBreakdown: {
    stars1: Number(row?.stars1 || 0), stars2: Number(row?.stars2 || 0), stars3: Number(row?.stars3 || 0),
    stars4: Number(row?.stars4 || 0), stars5: Number(row?.stars5 || 0),
  } };
}

export async function pgStationRatings(stationId: string, page: number, limit: number): Promise<any> {
  stationId = await resolveStationId(stationId) ?? stationId;
  const offset = Math.max(0, page - 1) * limit;
  const [ratings, stats] = await Promise.all([
    pool().query(
      `SELECT user_id AS "userId",rating,comment,created_at AS "createdAt"
       FROM station_ratings WHERE station_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [stationId, limit, offset],
    ),
    pool().query<{ total: string; average: string | null }>(
      "SELECT count(*)::text total,round(avg(rating)::numeric,1)::text average FROM station_ratings WHERE station_id=$1",
      [stationId],
    ),
  ]);
  return { ratings: ratings.rows, meta: { page, limit, total: Number(stats.rows[0]?.total || 0), averageRating: Number(stats.rows[0]?.average || 0) } };
}

export async function pgStationRatingsDetailed(stationId: string, page: number, limit: number): Promise<any> {
  const result = await pgStationRatings(stationId, page, limit);
  const stats = await pgStationRatingStats(stationId);
  return {
    ratings: result.ratings,
    pagination: { page, limit, total: result.meta.total, totalPages: Math.ceil(result.meta.total / limit) },
    stats,
  };
}

export async function pgFindStationRating(stationId: string, identity: RatingIdentity): Promise<any | null> {
  const identityType = identity.userId ? "user" : identity.sessionId ? "session" : "ip";
  const identityValue = identity.userId || identity.sessionId || identity.ipAddress;
  if (!identityValue) return null;
  stationId = await resolveStationId(stationId) ?? stationId;
  const result = await pool().query(
    `SELECT id AS _id,user_id AS "userId",session_id AS "sessionId",ip_address AS "ipAddress",
       station_id AS "stationId",rating,comment,created_at AS "createdAt",updated_at AS "updatedAt"
     FROM station_ratings WHERE station_id=$1 AND
       (($2='user' AND user_id=$3) OR ($2='session' AND session_id=$3) OR ($2='ip' AND ip_address=$3))
     LIMIT 1`,
    [stationId, identityType, identityValue],
  );
  return result.rows[0] || null;
}

export async function pgFavoriteStationsForUser(
  userId: string,
  sort: string,
  page: number,
  limit: number,
): Promise<{ stations: any[]; total: number }> {
  const order = sort === "oldest" ? "f.created_at ASC" : sort === "name" ? "s.name ASC" :
    sort === "country" ? "s.country ASC NULLS LAST" : "f.created_at DESC";
  const pagination = page > 0 && limit > 0;
  const values: any[] = [userId];
  let suffix = "";
  if (pagination) {
    values.push(limit, (page - 1) * limit);
    suffix = " LIMIT $2 OFFSET $3";
  }
  const [rows, count] = await Promise.all([
    pool().query(
      `SELECT s.*,f.created_at AS favorited_at FROM user_favorites f
       JOIN stations s ON s.id=f.station_id WHERE f.user_id=$1 AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false)) ORDER BY ${order}${suffix}`,
      values,
    ),
    pool().query<{ count: string }>("SELECT count(*)::text count FROM user_favorites f JOIN stations s ON s.id=f.station_id WHERE f.user_id=$1 AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))", [userId]),
  ]);
  return {
    stations: rows.rows.map((row) => ({ ...stationShape(row), favoritedAt: row.favorited_at })),
    total: Number(count.rows[0]?.count || 0),
  };
}

export async function pgIsFavorite(userId: string, stationId: string): Promise<boolean> {
  stationId = await resolveStationId(stationId) ?? stationId;
  const result = await pool().query("SELECT 1 FROM user_favorites WHERE user_id=$1 AND station_id=$2", [userId, stationId]);
  return (result.rowCount || 0) > 0;
}

export async function pgSetFavorite(userId: string, stationId: string, enabled: boolean): Promise<any> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const canonicalId = await lockStationIdentity(stationId, client, 'KEY SHARE');
    if (!canonicalId && enabled) throw new Error('Station not found');
    stationId = canonicalId ?? stationId;
    if (enabled) {
      await client.query(
        "INSERT INTO user_favorites(user_id,station_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [userId, stationId],
      );
    } else {
      await client.query("DELETE FROM user_favorites WHERE user_id=$1 AND station_id=$2", [userId, stationId]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return { success: true, message: enabled ? "Station added to favorites" : "Station removed from favorites" };
}

export async function pgSetFollow(followerId: string, followeeId: string, enabled: boolean): Promise<any> {
  if (enabled) {
    await pool().query(
      "INSERT INTO user_follows(follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [followerId, followeeId],
    );
  } else {
    await pool().query("DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2", [followerId, followeeId]);
  }
  return { success: true, message: enabled ? "User followed successfully" : "User unfollowed successfully" };
}

export async function pgIsFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const result = await pool().query(
    "SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2",
    [followerId, followeeId],
  );
  return (result.rowCount || 0) > 0;
}

export async function pgFollowPage(
  userId: string,
  direction: "followers" | "following",
  page: number,
  limit: number,
): Promise<any> {
  const offset = Math.max(0, page - 1) * limit;
  const targetColumn = direction === "followers" ? "f.follower_id" : "f.following_id";
  const filterColumn = direction === "followers" ? "f.following_id" : "f.follower_id";
  const [rows, count] = await Promise.all([
    pool().query(
      `SELECT u.id,u.slug,u.username,u.full_name,u.avatar,u.source,f.created_at,
         (SELECT count(*)::int FROM user_follows x WHERE x.following_id=u.id) followers_count,
         (SELECT count(*)::int FROM user_follows x WHERE x.follower_id=u.id) following_count
       FROM user_follows f JOIN users u ON u.id=${targetColumn}
       WHERE ${filterColumn}=$1 ORDER BY f.created_at DESC,u.id ASC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    pool().query<{ count: string }>(`SELECT count(*)::text count FROM user_follows f WHERE ${filterColumn}=$1`, [userId]),
  ]);
  const entries = rows.rows.map((row) => ({
    user: {
      _id: row.id, slug: row.slug, fullName: row.full_name, username: row.username, avatar: row.avatar,
      location: row.source?.location, followersCount: row.followers_count,
      followingCount: row.following_count,
    },
    followedAt: row.created_at,
  }));
  const total = Number(count.rows[0]?.count || 0);
  return { [direction]: entries, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function pgPopularProfiles(limit: number): Promise<any[]> {
  const result = await pool().query(
    `SELECT u.id AS _id,u.full_name AS "fullName",u.username,u.slug,u.avatar,
       u.source->>'profileImageUrl' AS "profileImageUrl",u.created_at AS "createdAt",
       count(*)::int AS "favoriteCount",max(f.created_at) AS "lastFavoritedAt"
     FROM users u JOIN user_favorites f ON f.user_id=u.id JOIN stations s ON s.id=f.station_id
     WHERE u.is_public_profile=true AND u.status='active'
       AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))
     GROUP BY u.id
     ORDER BY max(f.created_at) DESC,u.id ASC LIMIT $1`,
    [Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 20))],
  );
  return result.rows.map(row => ({
    ...row, ...publicUserIdentity(row), id: row._id,
    favorites_count: row.favoriteCount, favoriteStationsCount: row.favoriteCount,
  }));
}

/** Cached discovery order must never expose an account that has since gone private. */
export async function pgRefreshPublicProfiles(profiles: any[]): Promise<any[]> {
  if (!profiles.length) return [];
  const result = await pool().query(
    `SELECT u.id,u.full_name AS "fullName",u.username,u.slug,u.avatar,
       u.source->>'profileImageUrl' AS "profileImageUrl"
     FROM users u WHERE u.id=ANY($1::text[]) AND u.is_public_profile=true AND u.status='active'
       AND EXISTS(SELECT 1 FROM user_favorites f JOIN stations s ON s.id=f.station_id
         WHERE f.user_id=u.id AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false)))`,
    [profiles.map(profile => profile._id)],
  );
  const visible = new Map(result.rows.map(row => [row.id, row]));
  return profiles.flatMap(profile => {
    const user = visible.get(profile._id);
    return user ? [{ ...profile, ...publicUserIdentity(user), slug: user.slug }] : [];
  });
}

export async function pgRecentlyPlayed(value: string, limit: number): Promise<any[]> {
  const result = await pool().query<{ source: any }>(
    "SELECT source FROM users WHERE (id=$1 OR slug=$1 OR username=$1) AND is_public_profile=true LIMIT 1",
    [value],
  );
  const recent = result.rows[0]?.source?.recentlyPlayedStations;
  if (!result.rows[0]) {
    const legacyId = await resolveLegacyUserHandle(value);
    return legacyId ? pgRecentlyPlayed(legacyId, limit) : [];
  }
  if (!Array.isArray(recent) || !recent.length) return [];
  const ids = recent.map((entry: any) => String(entry?.stationId || entry));
  const eligible = await pool().query('SELECT id FROM stations WHERE id=ANY($1::text[]) AND (is_list_visible IS TRUE OR COALESCE(visibility_expires_at<=now(),false))', [ids]);
  const allowed = new Set(eligible.rows.map(row => row.id));
  return recent.filter((entry: any) => allowed.has(String(entry?.stationId || entry))).slice(0, limit);
}

export async function pgRecentlyPlayedStations(userId: string, limit = 12): Promise<any[]> {
  const user = await pool().query<{ source: any }>("SELECT source FROM users WHERE id=$1", [userId]);
  const recent = Array.isArray(user.rows[0]?.source?.recentlyPlayedStations)
    ? user.rows[0].source.recentlyPlayedStations
    : [];
  if (!recent.length) return [];
  const ids = recent.map((entry: any) => String(entry?.stationId || entry));
  const stations = await pool().query("SELECT * FROM stations WHERE id=ANY($1::text[]) AND (is_list_visible IS TRUE OR COALESCE(visibility_expires_at<=now(),false))", [ids]);
  const byId = new Map(stations.rows.map((row) => [row.id, row]));
  return recent.flatMap((entry: any) => {
    const id = String(entry?.stationId || entry);
    const row = byId.get(id);
    return row ? [{ ...stationShape(row), playedAt: entry?.playedAt || null }] : [];
  }).slice(0, limit);
}

export async function pgAddRecentlyPlayed(userId: string, stationId: string): Promise<boolean> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const canonicalId = await lockStationIdentity(stationId, client, 'KEY SHARE');
    if (!canonicalId) { await client.query('ROLLBACK'); return false; }
    stationId = canonicalId;
    const user = await client.query<{ source: any }>("SELECT source FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!user.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    const source = user.rows[0].source && typeof user.rows[0].source === "object" ? user.rows[0].source : {};
    const previous = Array.isArray(source.recentlyPlayedStations) ? source.recentlyPlayedStations : [];
    const identities = await resolveStationIds(previous.map((entry: any) => String(entry?.stationId || entry)), client);
    const next = [
      { stationId, playedAt: new Date().toISOString() },
      ...previous.filter((entry: any) => {
        const id = String(entry?.stationId || entry);
        return (identities.get(id) ?? id) !== stationId;
      }),
    ].slice(0, 12);
    await client.query(
      "UPDATE users SET source=jsonb_set(COALESCE(source,'{}'::jsonb),'{recentlyPlayedStations}',$2::jsonb,true) WHERE id=$1",
      [userId, JSON.stringify(next)],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Search the public directory independently of favorites/ranking caches, including brand-new accounts. */
export async function pgSearchPublicProfiles(search: string, requestedLimit = 50): Promise<any[]> {
  const term = normalizePublicUserSearch(search);
  if (term.length < 2) return [];
  const limit = Math.max(1,Math.min(100,Math.trunc(Number(requestedLimit))||50));
  // Literal substring matching avoids wildcard expansion and never scans a client-truncated top-100 cohort.
  const pattern='%'+term.replace(/[\\%_]/g,'\\$&')+'%';
  // All name tokens must match, regardless of given/family-name order. Keep
  // punctuation in handle matching literal (including underscore and percent).
  const nameTokens = term.split(/[\s_.-]+/).filter(Boolean).slice(0, 10);
  const namePatterns = nameTokens.map(token => '%'+token.replace(/[\\%_]/g,'\\$&')+'%');
  const {rows} = await pool().query(`WITH matches AS (
    SELECT u.id AS _id,u.full_name AS "fullName",u.username,u.slug,u.avatar,
      u.source->>'profileImageUrl' AS "profileImageUrl",u.created_at AS "createdAt",
      translate(lower(COALESCE(u.full_name,'')),'çğıöşü','cgiosu') AS full_key,
      translate(lower(COALESCE(u.username,'')),'çğıöşü','cgiosu') AS user_key
    FROM users u WHERE u.is_public_profile=true AND u.status='active'
  ) SELECT _id,"fullName",username,slug,avatar,"profileImageUrl","createdAt",
    (SELECT count(*)::int FROM user_favorites f JOIN stations s ON s.id=f.station_id WHERE f.user_id=matches._id
      AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))) AS "favoriteCount" FROM matches
    WHERE full_key LIKE $1 OR user_key LIKE $1 OR (cardinality($4::text[])>1 AND full_key LIKE ALL($4::text[]))
    ORDER BY CASE WHEN user_key=$2 OR full_key=$2 THEN 0 WHEN starts_with(full_key,$2) OR starts_with(user_key,$2) THEN 1 ELSE 2 END,"createdAt" DESC NULLS LAST,_id
    LIMIT $3`,[pattern,term,limit,namePatterns]);
  return rows.map(row=>({...row,...publicUserIdentity(row),id:row._id,favorites_count:row.favoriteCount,favoriteStationsCount:row.favoriteCount}));
}
