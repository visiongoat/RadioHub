import crypto from "node:crypto";
import { getPostgresPool } from "../postgres-runtime";

export const userStore: string = "postgres";

export interface UserWriteInput {
  [key: string]: unknown;
  id?: string;
  username: string;
  email: string;
  passwordHash?: string | null;
  fullName?: string | null;
  bio?: string | null;
  slug?: string | null;
  role?: string;
  status?: string;
  emailVerified?: boolean;
  isPublicProfile?: boolean;
  avatar?: string | null;
  googleId?: string | null;
  facebookId?: string | null;
  appleId?: string | null;
  preferences?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  lastLoginAt?: Date | null;
  source?: Record<string, unknown>;
}

export function newPublicUserId(): string {
  return crypto.randomBytes(12).toString("hex");
}

function shape(row: any): any | null {
  if (!row) return null;
  const normalizedSubscription = row.normalized_subscription
    ? {
        ...(row.normalized_subscription.provider_data || {}),
        plan: row.normalized_subscription.plan,
        platform: row.normalized_subscription.platform,
        subscriptionStatus: row.normalized_subscription.status,
        productId: row.normalized_subscription.product_id,
        transactionId: row.normalized_subscription.transaction_id,
        originalTransactionId: row.normalized_subscription.original_transaction_id,
        purchaseToken: row.normalized_subscription.purchase_token,
        stripeCustomerId: row.normalized_subscription.stripe_customer_id,
        stripeSubscriptionId: row.normalized_subscription.stripe_subscription_id,
        paddleCustomerId: row.normalized_subscription.paddle_customer_id,
        paddleSubscriptionId: row.normalized_subscription.paddle_subscription_id,
        isActive: row.normalized_subscription.is_active,
        isTrial: row.normalized_subscription.is_trial,
        expiresAt: row.normalized_subscription.expires_at,
        renewsAt: row.normalized_subscription.renews_at,
        startedAt: row.normalized_subscription.started_at,
        cancelledAt: row.normalized_subscription.cancelled_at,
        lastVerifiedAt: row.normalized_subscription.last_verified_at,
      }
    : undefined;
  return {
    ...(row.source && typeof row.source === "object" ? row.source : {}),
    _id: row.id, id: row.id, username: row.username, email: row.email,
    passwordHash: row.password_hash, fullName: row.full_name, slug: row.slug,
    bio: row.bio, avatar: row.avatar, role: row.role, status: row.status,
    emailVerified: row.email_verified, isPublicProfile: row.is_public_profile,
    googleId: row.google_id, facebookId: row.facebook_id, appleId: row.apple_id,
    preferences: row.preferences || {}, permissions: row.permissions || {},
    stats: row.stats || {}, lastLoginAt: row.last_login_at,
    ...(normalizedSubscription ? { subscription: normalizedSubscription } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const userSelect = `SELECT u.*,to_jsonb(s) AS normalized_subscription
  FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id`;

export async function pgFindUserById(id: string): Promise<any | null> {
  const result = await getPostgresPool().query(`${userSelect} WHERE u.id=$1`, [id]);
  return shape(result.rows[0]);
}

export async function pgFindUserByIdOrSlug(value: string): Promise<any | null> {
  const result = await getPostgresPool().query(`${userSelect} WHERE u.id=$1 OR u.slug=$1 LIMIT 1`, [value]);
  return shape(result.rows[0]);
}

export async function pgFindUserByEmail(email: string): Promise<any | null> {
  const result = await getPostgresPool().query(`${userSelect} WHERE lower(u.email)=lower($1) LIMIT 1`, [email.trim()]);
  return shape(result.rows[0]);
}

export async function pgFindUsersByIds(ids: string[]): Promise<any[]> {
  if (!ids.length) return [];
  const result = await getPostgresPool().query(`${userSelect} WHERE u.id=ANY($1::text[])`, [ids]);
  return result.rows.map(shape);
}

export interface AdminUserListOptions {
  search?: string;
  plan?: string;
  authMethod?: string;
  platform?: string;
  sortBy?: "createdAt" | "updatedAt" | "name" | "email" | "followers";
  sortDir?: "asc" | "desc";
  page: number;
  limit: number;
}

export async function pgListAdminUsers(options: AdminUserListOptions): Promise<{ users: any[]; total: number }> {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const bind = (candidate: unknown): string => {
    values.push(candidate);
    return `$${values.length}`;
  };
  if (options.search) {
    const value = bind(options.search);
    conditions.push(`(u.email ILIKE '%' || ${value} || '%' OR u.full_name ILIKE '%' || ${value} || '%')`);
  }
  const effectiveAccess = `(s.is_active=true AND (s.plan='premium_lifetime' OR
    (s.plan=ANY(ARRAY['remove_ads','premium_monthly','premium_yearly']) AND s.expires_at>CURRENT_TIMESTAMP)))`;
  if (options.plan === "none") {
    conditions.push(`NOT COALESCE(${effectiveAccess},false)`);
  } else if (options.plan === "any_premium") {
    conditions.push(`${effectiveAccess} AND s.plan=ANY(ARRAY['premium_monthly','premium_yearly','premium_lifetime'])`);
  } else if (options.plan && options.plan !== "all") {
    conditions.push(`${effectiveAccess} AND s.plan=${bind(options.plan)}`);
  }
  const authExpression = `lower(COALESCE(NULLIF(u.source->>'authProvider',''),
    CASE WHEN u.google_id IS NOT NULL THEN 'google' WHEN u.facebook_id IS NOT NULL THEN 'facebook'
         WHEN u.apple_id IS NOT NULL THEN 'apple' ELSE 'email' END))`;
  if (options.authMethod && options.authMethod !== "all") {
    conditions.push(`${authExpression}=${bind(options.authMethod)}`);
  }
  if (options.platform && options.platform !== "all") {
    conditions.push(`s.platform=${bind(options.platform)}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortColumns: Record<string, string> = {
    createdAt: "u.created_at", updatedAt: "u.updated_at", name: "u.full_name",
    email: "u.email", followers: "followers_count",
  };
  const sortColumn = sortColumns[options.sortBy || "createdAt"] || sortColumns.createdAt;
  const sortDirection = options.sortDir === "asc" ? "ASC" : "DESC";
  const count = await getPostgresPool().query<{ count: string }>(
    `SELECT count(*)::text count FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id ${where}`,
    values,
  );
  const rowValues = [...values, options.limit, Math.max(0, options.page - 1) * options.limit];
  const result = await getPostgresPool().query(
    `SELECT u.*,to_jsonb(s) AS normalized_subscription,
       (SELECT count(*)::int FROM user_follows f WHERE f.following_id=u.id) followers_count,
       (SELECT count(*)::int FROM user_favorites f WHERE f.user_id=u.id) favorite_count,
       ${authExpression} auth_provider
     FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id ${where}
     ORDER BY ${sortColumn} ${sortDirection},u.id ASC
     LIMIT $${rowValues.length - 1} OFFSET $${rowValues.length}`,
    rowValues,
  );
  return {
    users: result.rows.map((row) => ({
      ...shape(row), authProvider: row.auth_provider, followersCount: row.followers_count,
      favoriteCount: row.favorite_count,
      isActive: typeof row.source?.isActive === "boolean" ? row.source.isActive : row.status !== "inactive",
    })),
    total: Number(count.rows[0]?.count || 0),
  };
}

export async function pgFindUserByResetToken(tokenHash: string): Promise<any | null> {
  const result = await getPostgresPool().query(
    `${userSelect} WHERE u.source->>'resetPasswordToken'=$1
       AND NULLIF(u.source->>'resetPasswordExpires','')::timestamptz>now() LIMIT 1`,
    [tokenHash],
  );
  return shape(result.rows[0]);
}

/** Consume a reset token exactly once and revoke prior sessions in the same transaction. */
export async function pgResetUserPassword(tokenHash: string, passwordHash: string): Promise<boolean> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string }>(
      `UPDATE users SET password_hash=$2,
         source=(COALESCE(source,'{}'::jsonb)-'resetPasswordToken'-'resetPasswordExpires') || jsonb_build_object('passwordHash',$2::text),
         updated_at=now()
       WHERE source->>'resetPasswordToken'=$1
         AND NULLIF(source->>'resetPasswordExpires','')::timestamptz>now() RETURNING id`, [tokenHash, passwordHash],
    );
    const id = result.rows[0]?.id;
    if (id) {
      await client.query('UPDATE auth_tokens SET is_revoked=true WHERE user_id=$1', [id]);
      await client.query(`DELETE FROM user_sessions WHERE sess->>'userId'=$1 OR sess#>>'{user,userId}'=$1 OR sess#>>'{passport,user}'=$1`, [id]);
    }
    await client.query('COMMIT');
    return !!id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function pgFindUserByIdentity(input: {
  email?: string; username?: string; googleId?: string; facebookId?: string; appleId?: string;
}): Promise<any | null> {
  const clauses: string[] = [];
  const values: string[] = [];
  const columns: Record<string, string> = {
    email: "lower(u.email)", username: "u.username", googleId: "u.google_id",
    facebookId: "u.facebook_id", appleId: "u.apple_id",
  };
  for (const [key, candidate] of Object.entries(input)) {
    if (!candidate) continue;
    values.push(key === "email" ? candidate.toLowerCase().trim() : candidate);
    clauses.push(`${columns[key]}=$${values.length}`);
  }
  if (!clauses.length) return null;
  const result = await getPostgresPool().query(`${userSelect} WHERE ${clauses.join(" OR ")} LIMIT 1`, values);
  return shape(result.rows[0]);
}

export async function pgUserSlugExists(slug: string): Promise<boolean> {
  const result = await getPostgresPool().query("SELECT 1 FROM users WHERE slug=$1", [slug]);
  return (result.rowCount || 0) > 0;
}

export async function pgCreateUser(input: UserWriteInput): Promise<any> {
  const id = input.id || newPublicUserId();
  const now = new Date();
  const { source: inputSource, id: _inputId, ...fields } = input;
  const source = { ...(inputSource || {}), ...fields, _id: id };
  const result = await getPostgresPool().query(
    `INSERT INTO users(id,username,email,password_hash,full_name,slug,avatar,role,status,
       email_verified,is_public_profile,google_id,facebook_id,apple_id,preferences,stats,source,created_at,updated_at,bio,permissions,last_login_at)
     VALUES (${Array.from({ length: 22 }, (_, index) => `$${index + 1}`).join(",")}) RETURNING *`,
    [id, input.username, input.email.toLowerCase().trim(), input.passwordHash || null,
      input.fullName || input.username || "User", input.slug || null, input.avatar || null, input.role || "user",
      input.status || "active", !!input.emailVerified, !!input.isPublicProfile,
      input.googleId || null, input.facebookId || null, input.appleId || null,
      JSON.stringify(input.preferences || {}), JSON.stringify(input.stats || {}),
      JSON.stringify(source), now, now, input.bio || null,
      JSON.stringify(input.permissions || {}), input.lastLoginAt || null],
  );
  return shape(result.rows[0]);
}

export async function pgUpdateUser(id: string, patch: Record<string, any>): Promise<any | null> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    // Serialize the read/merge/write, including JSON preferences and source.
    // Lock only users: a nullable LEFT JOIN subscription cannot be FOR UPDATE.
    const locked = await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [id]);
    const current = shape(locked.rows[0]);
    if (!current) {
      await client.query("COMMIT");
      return null;
    }
    // Ignore undefined (an omitted field), but retain explicit null/removals.
    const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    if (changes.notificationSettings && typeof changes.notificationSettings === 'object') {
      changes.notificationSettings = { ...(current.notificationSettings || {}), ...changes.notificationSettings };
    }
    const next = { ...current, ...changes, preferences: changes.preferences
      ? { ...(current.preferences || {}), ...changes.preferences } : current.preferences };
    const source = { ...(locked.rows[0].source || {}), ...changes, _id: id };
    const result = await client.query(
    `UPDATE users SET username=$2,email=$3,password_hash=$4,full_name=$5,slug=$6,bio=$7,
       avatar=$8,role=$9,status=$10,email_verified=$11,is_public_profile=$12,
       google_id=$13,facebook_id=$14,apple_id=$15,preferences=$16,permissions=$17,
       stats=$18,last_login_at=$19,source=$20,updated_at=now() WHERE id=$1 RETURNING *`,
    [id, next.username, next.email.toLowerCase().trim(), next.passwordHash || null,
      next.fullName ?? "", next.slug || null, next.bio || null, next.avatar || null,
      next.role || "user", next.status || "active", !!next.emailVerified,
      !!next.isPublicProfile, next.googleId || null, next.facebookId || null,
      next.appleId || null, JSON.stringify(next.preferences || {}),
      JSON.stringify(next.permissions || {}), JSON.stringify(next.stats || {}),
      next.lastLoginAt || null, JSON.stringify(source)],
  );
    const subscription = await client.query("SELECT to_jsonb(s) AS value FROM subscriptions s WHERE user_id=$1", [id]);
    await client.query("COMMIT");
    return shape({ ...result.rows[0], normalized_subscription: subscription.rows[0]?.value });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function pgDeleteUser(id: string): Promise<boolean> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    // Normalized relations cascade from users. Remove the lossless mirror rows
    // that carry this account as a principal as well, so account deletion is
    // not undone by a later normalization run.
    await client.query(
      `DELETE FROM legacy_documents WHERE
       (collection_name='users' AND document_id=$1) OR payload->>'userId'=$1 OR
       payload->>'followingUserId'=$1 OR payload->>'fromUserId'=$1 OR payload->>'toUserId'=$1`,
      [id],
    );
    await client.query("DELETE FROM listening_history WHERE user_id=$1 OR session_id=$1", [id]);
    await client.query("DELETE FROM listening_sessions WHERE user_id=$1 OR session_id=$1", [id]);
    await client.query("DELETE FROM recommendation_profiles WHERE user_id=$1 OR session_id=$1", [id]);
    await client.query("DELETE FROM user_music_profiles WHERE user_id=$1", [id]);
    await client.query("DELETE FROM recommendation_events WHERE user_id=$1", [id]);
    await client.query(`DELETE FROM user_sessions WHERE sess->>'userId'=$1 OR sess#>>'{user,userId}'=$1 OR sess#>>'{passport,user}'=$1`, [id]);
    const result = await client.query("DELETE FROM users WHERE id=$1", [id]);
    await client.query("COMMIT");
    return (result.rowCount || 0) > 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function pgUserFollowState(userId: string): Promise<{ following: string[]; followersCount: number }> {
  const [following, followers] = await Promise.all([
    getPostgresPool().query<{ following_id: string }>("SELECT following_id FROM user_follows WHERE follower_id=$1", [userId]),
    getPostgresPool().query<{ count: string }>("SELECT count(*)::text count FROM user_follows WHERE following_id=$1", [userId]),
  ]);
  return { following: following.rows.map((row) => row.following_id), followersCount: Number(followers.rows[0]?.count || 0) };
}

export async function pgUserFollowCounts(userId: string): Promise<{ followersCount: number; followingCount: number }> {
  const result = await getPostgresPool().query<{ followers: number; following: number }>(
    `SELECT
       (SELECT count(*)::int FROM user_follows WHERE following_id=$1) followers,
       (SELECT count(*)::int FROM user_follows WHERE follower_id=$1) following`,
    [userId],
  );
  return { followersCount: result.rows[0]?.followers || 0, followingCount: result.rows[0]?.following || 0 };
}

export async function pgUserFavoriteCount(userId: string): Promise<number> {
  const result = await getPostgresPool().query<{ count: string }>(
    "SELECT count(*)::text count FROM user_favorites WHERE user_id=$1",
    [userId],
  );
  return Number(result.rows[0]?.count || 0);
}

export async function pgListUsers(options: {
  query?: string; status?: string; role?: string; publicOnly?: boolean;
  sortBy?: string; page: number; limit: number;
}): Promise<{ users: any[]; total: number }> {
  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 500));
  const page = Math.max(1, Number(options.page) || 1);
  const values: unknown[] = [];
  const conditions: string[] = [];
  const bind = (candidate: unknown) => { values.push(candidate); return `$${values.length}`; };
  if (options.publicOnly) conditions.push("u.is_public_profile=true");
  if (options.status) conditions.push(`u.status=${bind(options.status)}`);
  if (options.role) conditions.push(`u.role=${bind(options.role)}`);
  if (options.query && options.query.length >= 2) {
    const parameter = bind(options.query);
    conditions.push(`(u.username ILIKE '%'||${parameter}||'%' OR u.full_name ILIKE '%'||${parameter}||'%' OR u.email ILIKE '%'||${parameter}||'%')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = options.sortBy === "oldest" ? "u.created_at ASC"
    : options.sortBy === "recent_favorites" ? "last_favorited_at DESC NULLS LAST,u.created_at DESC"
    : options.sortBy === "most_radios" ? "favorite_count DESC,u.created_at DESC"
      : options.sortBy === "least_radios" ? "favorite_count ASC,u.created_at DESC"
        : "u.created_at DESC";
  const count = await getPostgresPool().query<{ count: string }>(`SELECT count(*)::text count FROM users u ${where}`, values);
  const rowValues = [...values, limit, (page - 1) * limit];
  const result = await getPostgresPool().query(
    `SELECT u.*,
       favorites.favorite_count,favorites.last_favorited_at,
       (SELECT count(*)::int FROM user_follows f WHERE f.following_id=u.id) followers_count,
       (SELECT count(*)::int FROM user_follows f WHERE f.follower_id=u.id) following_count,
       ${options.publicOnly ? '0::int' : "(SELECT count(*)::int FROM stations s WHERE s.source->>'createdBy'=u.id)"} stations_created_count
     FROM users u LEFT JOIN LATERAL (
       SELECT count(*)::int favorite_count,max(f.created_at) last_favorited_at
       FROM user_favorites f ${options.publicOnly ? 'JOIN stations s ON s.id=f.station_id' : ''}
       WHERE f.user_id=u.id ${options.publicOnly ? 'AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))' : ''}
     ) favorites ON true ${where} ORDER BY ${order},u.id ASC
     LIMIT $${rowValues.length - 1} OFFSET $${rowValues.length}`,
    rowValues,
  );
  return {
    total: Number(count.rows[0]?.count || 0),
    users: result.rows.map((row) => ({
      ...shape(row), location: row.source?.location,
      favoriteStationsCount: row.favorite_count, followersCount: row.followers_count,
      lastFavoritedAt: row.last_favorited_at,
      followingCount: row.following_count, stationsCreatedCount: row.stations_created_count,
    })),
  };
}

export async function pgUserManagementDetail(userId: string): Promise<any | null> {
  const user = await pgFindUserById(userId);
  if (!user) return null;
  const [favorites, created, counts] = await Promise.all([
    getPostgresPool().query(
      `SELECT s.id AS _id,s.name,s.country,s.tags_raw AS genre FROM user_favorites f
       JOIN stations s ON s.id=f.station_id WHERE f.user_id=$1 ORDER BY f.created_at DESC`,
      [userId],
    ),
    getPostgresPool().query(
      `SELECT id AS _id,name,country,tags_raw AS genre,votes FROM stations
       WHERE source->>'createdBy'=$1 ORDER BY created_at DESC`,
      [userId],
    ),
    pgUserFollowCounts(userId),
  ]);
  const recent = Array.isArray(user.recentlyPlayedStations) ? user.recentlyPlayedStations : [];
  const totalListening = recent.reduce((sum: number, play: any) => sum + Number(play?.playDuration || 0), 0);
  return {
    ...user, favoriteStations: favorites.rows, createdStations: created.rows,
    favoriteStationsCount: favorites.rowCount || 0, stationsCreatedCount: created.rowCount || 0,
    followersCount: counts.followersCount, followingCount: counts.followingCount,
    totalListeningTime: Math.round(totalListening / 60),
    stats: { ...(user.stats || {}), totalPlays: recent.length,
      totalListeningHours: Math.round(totalListening / 3600), joinDate: user.createdAt,
      lastActiveDate: user.lastLoginAt || user.createdAt },
  };
}

export async function pgUserManagementStats(): Promise<any> {
  const result = await getPostgresPool().query(
    `SELECT count(*)::int total_users,
       count(*) FILTER (WHERE status='active')::int active_users,
       count(*) FILTER (WHERE role='admin')::int admin_users,
       count(*) FILTER (WHERE role='moderator')::int moderator_users,
       count(*) FILTER (WHERE status='suspended')::int suspended_users,
       count(*) FILTER (WHERE created_at>=now()-interval '7 days')::int recent_registrations
     FROM users`,
  );
  const top = await getPostgresPool().query(
    `SELECT username,full_name AS "fullName",
       CASE WHEN (source->>'totalListeningTime') ~ '^[0-9]+(\\.[0-9]+)?$'
         THEN (source->>'totalListeningTime')::float8 ELSE 0 END AS "totalListeningTime",
       (SELECT count(*)::int FROM user_favorites f WHERE f.user_id=users.id) AS "favoriteStationsCount"
     FROM users ORDER BY 3 DESC LIMIT 5`,
  );
  const row = result.rows[0] || {};
  const totalUsers = Number(row.total_users || 0);
  const activeUsers = Number(row.active_users || 0);
  return {
    totalUsers, activeUsers, adminUsers: Number(row.admin_users || 0),
    moderatorUsers: Number(row.moderator_users || 0), suspendedUsers: Number(row.suspended_users || 0),
    recentRegistrations: Number(row.recent_registrations || 0),
    activePercentage: totalUsers ? Math.round(activeUsers / totalUsers * 100) : 0,
    topUsersByListening: top.rows,
  };
}

export async function pgRecentUserActivity(limit: number): Promise<any[]> {
  const result = await getPostgresPool().query(
    `SELECT id AS _id,username,full_name AS "fullName",last_login_at AS timestamp
     FROM users WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return result.rows.map((row) => ({ ...row, action: "login", details: "User logged in" }));
}

export async function pgUserSocialByEmail(email: string): Promise<any | null> {
  const user = await pgFindUserByEmail(email);
  if (!user) return null;
  const [followers, following] = await Promise.all([
    getPostgresPool().query(
      `SELECT u.id AS _id,u.username,u.email,u.full_name AS "fullName",u.avatar AS "avatarUrl"
       FROM user_follows f JOIN users u ON u.id=f.follower_id
       WHERE f.following_id=$1 ORDER BY f.created_at DESC`,
      [String(user._id)],
    ),
    getPostgresPool().query(
      `SELECT u.id AS _id,u.username,u.email,u.full_name AS "fullName",u.avatar AS "avatarUrl"
       FROM user_follows f JOIN users u ON u.id=f.following_id
       WHERE f.follower_id=$1 ORDER BY f.created_at DESC`,
      [String(user._id)],
    ),
  ]);
  return { followersCount: followers.rowCount || 0, followingCount: following.rowCount || 0,
    followers: followers.rows, following: following.rows };
}

export async function pgSetUserPushSubscription(userId: string, subscription: Record<string, unknown> | null): Promise<boolean> {
  const result = subscription
    ? await getPostgresPool().query(
        "UPDATE users SET source=jsonb_set(source,'{pushSubscription}',$2::jsonb,true),updated_at=now() WHERE id=$1",
        [userId, JSON.stringify(subscription)],
      )
    : await getPostgresPool().query(
        "UPDATE users SET source=source-'pushSubscription',updated_at=now() WHERE id=$1",
        [userId],
      );
  return (result.rowCount || 0) > 0;
}

export async function pgGetUserPushSubscription(userId: string): Promise<Record<string, any> | null> {
  const result = await getPostgresPool().query<{ subscription: Record<string, any> | null }>(
    "SELECT source->'pushSubscription' subscription FROM users WHERE id=$1",
    [userId],
  );
  return result.rows[0]?.subscription || null;
}

export async function pgListUserPushSubscriptions(offset: number, limit: number): Promise<Array<{ id: string; subscription: Record<string, any> }>> {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
  const result = await getPostgresPool().query<{ id: string; subscription: Record<string, any> }>(
    `SELECT id,source->'pushSubscription' subscription FROM users
     WHERE source->'pushSubscription' IS NOT NULL ORDER BY id LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset],
  );
  return result.rows;
}

export async function pgUsersNeedingProfileFix(): Promise<any[]> {
  const result = await getPostgresPool().query(
    `SELECT * FROM users WHERE is_public_profile=false OR slug IS NULL OR slug=''
       OR slug ~ '^[0-9a-fA-F]{24}$' ORDER BY id`,
  );
  return result.rows.map(shape);
}

export async function pgAdminUserIds(): Promise<string[]> {
  const result = await getPostgresPool().query<{ id: string }>(
    "SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id",
  );
  return result.rows.map((row) => row.id);
}
