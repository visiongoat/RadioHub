import { newPublicUserId } from "./postgres-user-store";
import { getPostgresPool } from "../postgres-runtime";

export const notificationStore: string = "postgres";

export interface NotificationInput {
  id?: string;
  userId: string;
  fromUserId?: string | null;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read?: boolean;
  readAt?: Date | null;
  expiresAt?: Date | null;
  createdAt?: Date;
}

function shape(row: any): any {
  return {
    _id: row.id, userId: row.user_id, fromUserId: row.sender || row.from_user_id,
    type: row.type, title: row.title, message: row.message, data: row.data || {},
    read: row.is_read, readAt: row.read_at, expiresAt: row.expires_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function pgCreateNotification(input: NotificationInput): Promise<any> {
  const result = await getPostgresPool().query(
    `INSERT INTO user_notifications(id,user_id,from_user_id,type,title,message,data,is_read,read_at,expires_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [input.id || newPublicUserId(), input.userId, input.fromUserId || null, input.type,
      input.title, input.message, JSON.stringify(input.data || {}), !!input.read,
      input.readAt || null, input.expiresAt || null, input.createdAt || new Date()],
  );
  return shape(result.rows[0]);
}

export const notificationCategories = {
  all: null,
  social: ['follow', 'unfollow', 'group_invitation', 'new_message', 'station_mention'],
  stations: ['new_station', 'favorite_station', 'favorite_update'],
  system: ['system', 'promotional', 'comment_reply'],
} as const;
export type NotificationCategory = keyof typeof notificationCategories;
// Explicit known types only. Preserve the existing 10-day social/station,
// 7-day message, and 30-day system retention windows plus expires_at.
const visibleNotificationSql = `user_id=$1 AND (
  (type IN ('new_station','follow','unfollow','favorite_station','favorite_update','station_mention','group_invitation') AND created_at>=now()-interval '10 days')
  OR (type='new_message' AND created_at>=now()-interval '7 days')
  OR (type IN ('system','promotional','comment_reply') AND created_at>=now()-interval '30 days'))
  AND (expires_at IS NULL OR expires_at>now())`;

export async function pgListNotifications(userId: string, page: number, limit: number, category: NotificationCategory = 'all'): Promise<any> {
  if (!Object.hasOwn(notificationCategories, category)) throw new Error('Invalid notification category');
  page = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 10;
  const offset = Math.max(0, page - 1) * limit;
  const [rows, totals] = await Promise.all([
    getPostgresPool().query(
      `SELECT n.*, CASE WHEN u.id IS NOT NULL THEN jsonb_build_object('_id',u.id,'fullName',u.full_name,'username',u.username,'avatar',u.avatar,'profileImageUrl',u.source->>'profileImageUrl') END AS sender
       FROM (SELECT * FROM user_notifications WHERE ${visibleNotificationSql}
       AND ($4::text[] IS NULL OR type=ANY($4::text[]))
       ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3) n LEFT JOIN users u ON u.id=COALESCE(n.from_user_id,n.data->>'followerId',n.data->>'userId') ORDER BY n.created_at DESC,n.id DESC`,
      [userId, limit, offset, notificationCategories[category]],
    ),
    getPostgresPool().query<{ type: string; count: string; unread: string }>(
      `SELECT type,count(*)::text count,count(*) FILTER (WHERE is_read=false)::text unread
       FROM user_notifications WHERE ${visibleNotificationSql} GROUP BY type`,
      [userId],
    ),
  ]);
  const categoryCounts = Object.fromEntries(Object.entries(notificationCategories).map(([key, types]) => [key,
    totals.rows.filter(row => types === null || (types as readonly string[]).includes(row.type)).reduce((sum,row) => sum + Number(row.count),0),
  ]));
  const total = categoryCounts[category];
  return { notifications: rows.rows.map(shape), pagination: {
    page, limit, total, totalPages: Math.ceil(total / limit),
  }, categoryCounts, unreadCount: totals.rows.reduce((sum,row) => sum + Number(row.unread),0) };
}

export async function pgMarkNotificationRead(userId: string, id: string): Promise<any | null> {
  const result = await getPostgresPool().query(
    "UPDATE user_notifications SET is_read=true,read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING *",
    [id, userId],
  );
  return result.rows[0] ? shape(result.rows[0]) : null;
}

export async function pgMarkAllNotificationsRead(userId: string): Promise<number> {
  const result = await getPostgresPool().query(
    "UPDATE user_notifications SET is_read=true,read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND is_read=false",
    [userId],
  );
  return result.rowCount || 0;
}

export async function pgMarkConversationNotificationsRead(userId: string, fromUserId: string, messageIds?:string[]): Promise<number> {
  const result = await getPostgresPool().query(
    `UPDATE user_notifications SET is_read=true,read_at=COALESCE(read_at,now())
     WHERE user_id=$1 AND from_user_id=$2 AND type='new_message' AND is_read=false
       AND (($3::text[] IS NULL AND NOT EXISTS (SELECT 1 FROM direct_messages WHERE to_user_id=$1 AND from_user_id=$2 AND is_read=false AND deleted_at IS NULL AND NOT ($1=ANY(hidden_for))))
         OR ($3::text[] IS NOT NULL AND data->>'messageId'=ANY($3::text[]) AND EXISTS(SELECT 1 FROM direct_messages m WHERE m.id=user_notifications.data->>'messageId' AND m.to_user_id=$1 AND m.from_user_id=$2 AND m.is_read=true AND m.deleted_at IS NULL AND NOT ($1=ANY(m.hidden_for)))))`,
    [userId, fromUserId, messageIds??null],
  );
  return result.rowCount || 0;
}

export async function pgUpsertMessageNotification(input: Omit<NotificationInput, "id" | "type"> & { id?: string }): Promise<any> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`message:${input.userId}:${input.fromUserId || ""}`]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM user_notifications WHERE user_id=$1 AND from_user_id=$2
       AND type='new_message' AND is_read=false LIMIT 1`,
      [input.userId, input.fromUserId || null],
    );
    const result = existing.rowCount
      ? await client.query(
          `UPDATE user_notifications SET title=$2,message=$3,data=$4,created_at=$5,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [existing.rows[0].id, input.title, input.message, JSON.stringify(input.data || {}), input.createdAt || new Date()],
        )
      : await client.query(
          `INSERT INTO user_notifications(id,user_id,from_user_id,type,title,message,data,created_at)
           VALUES ($1,$2,$3,'new_message',$4,$5,$6,$7) RETURNING *`,
          [input.id || newPublicUserId(), input.userId, input.fromUserId || null, input.title,
            input.message, JSON.stringify(input.data || {}), input.createdAt || new Date()],
        );
    await client.query("COMMIT");
    return shape(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Dismiss only this account's rows; retain records for normal retention cleanup. */
export async function pgDismissAllNotifications(userId: string): Promise<number> {
 const result=await getPostgresPool().query("UPDATE user_notifications SET expires_at=now(),is_read=true,read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND (expires_at IS NULL OR expires_at>now())",[userId]);
 return result.rowCount||0;
}
