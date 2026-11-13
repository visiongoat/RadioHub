import { getPostgresPool } from "../postgres-runtime";
import { newPublicUserId } from "./postgres-user-store";

export const messageStore: string = "postgres";

function shape(row: any): any {
  return {
    _id: row.id, fromUserId: row.from_user_id, toUserId: row.to_user_id,
    reactions:row.deleted_at?[]:row.reactions||[],reactionsRevision:Number(row.reactions_revision||0),
    content: row.content, messageType: row.message_type, imageUrl: row.image_url,
    replyToId:row.reply_to_id||null, ...(row.reply_to?{replyTo:row.reply_to}:{}), pinnedAt:row.pinned_at||null,pinUpdatedAt:row.updated_at, deletedAt:row.deleted_at||null, read: row.is_read, readAt: row.read_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function pgCreateMessage(input: {
  id?: string; fromUserId: string; toUserId: string; content: string;
  messageType: string; imageUrl?: string | null; replyToId?:string|null; createdAt?: Date;
}): Promise<any> {
  const db=await getPostgresPool().connect();
  try{
   await db.query('BEGIN');
   for(const actor of [input.fromUserId,input.toUserId].sort()){
    const partner=actor===input.fromUserId?input.toUserId:input.fromUserId;
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor}:direct:${partner}`]);
   }
   const result=await db.query(
    `INSERT INTO direct_messages(id,from_user_id,to_user_id,content,message_type,image_url,created_at,reply_to_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [input.id||newPublicUserId(),input.fromUserId,input.toUserId,input.content,input.messageType,input.imageUrl||null,input.createdAt||new Date(),input.replyToId||null]);
   await db.query("UPDATE chat_inbox_state SET deleted=false,updated_at=now() WHERE kind='direct' AND ((user_id=$1 AND target_id=$2) OR (user_id=$2 AND target_id=$1)) AND deleted",[input.fromUserId,input.toUserId]);
   await db.query('COMMIT');return shape(result.rows[0]);
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

export async function pgConversationMessages(
  userId: string, partnerId: string, before: string | undefined, limit: number,
): Promise<any[]> {
  const result = await getPostgresPool().query(
    `SELECT m.*,(SELECT jsonb_build_object('_id',r.id,'fromUserId',r.from_user_id,'content',CASE WHEN r.deleted_at IS NULL THEN r.content ELSE '' END,'messageType',r.message_type,'deletedAt',r.deleted_at) FROM direct_messages r WHERE r.id=m.reply_to_id AND NOT ($1=ANY(r.hidden_for))) reply_to FROM direct_messages m WHERE
       ((from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1))
       AND NOT ($1=ANY(hidden_for))
       AND ($3='' OR (created_at,id)<(SELECT created_at,id FROM direct_messages WHERE id=$3
         AND ((from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1))))
       ORDER BY created_at DESC,id DESC LIMIT $4`,
    [userId, partnerId, before || "", limit],
  );
  return result.rows.map(shape).reverse();
}

export async function pgHasConversation(userId: string, partnerId: string): Promise<boolean> {
  const result = await getPostgresPool().query(
    `SELECT 1 FROM direct_messages WHERE
      ((from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1)) LIMIT 1`,
    [userId, partnerId],
  );
  return result.rows.length > 0;
}

export async function pgMarkMessagesRead(userId: string, partnerId: string, messageIds?: string[]): Promise<number> {
  const result = await getPostgresPool().query(
    `UPDATE direct_messages SET is_read=true,read_at=COALESCE(read_at,now())
     WHERE from_user_id=$2 AND to_user_id=$1 AND is_read=false AND deleted_at IS NULL AND NOT ($1=ANY(hidden_for))
       AND ($3::text[] IS NULL OR id=ANY($3::text[]))`,
    [userId, partnerId, messageIds ?? null],
  );
  await getPostgresPool().query("UPDATE chat_inbox_state SET marked_unread=false,updated_at=now() WHERE user_id=$1 AND kind='direct' AND target_id=$2 AND marked_unread",[userId,partnerId]);
  return result.rowCount || 0;
}

export async function pgUnreadMessageCount(userId: string): Promise<number> {
  const result = await getPostgresPool().query<{ count: string }>(
    "SELECT count(*)::text count FROM direct_messages WHERE to_user_id=$1 AND is_read=false AND deleted_at IS NULL AND NOT ($1=ANY(hidden_for))",
    [userId],
  );
  return Number(result.rows[0]?.count || 0);
}

export async function pgMessageContacts(userId: string, query?: string): Promise<any[]> {
  const result = await getPostgresPool().query(
    `WITH contacts AS (
       SELECT following_id id,true i_follow,false follows_me FROM user_follows WHERE follower_id=$1
       UNION ALL SELECT follower_id,false,true FROM user_follows WHERE following_id=$1
     ), flags AS (
       SELECT id,bool_or(i_follow) i_follow,bool_or(follows_me) follows_me FROM contacts
       WHERE id<>$1 GROUP BY id
     )
     SELECT u.id AS _id,u.username,u.full_name AS "fullName",u.avatar,
       u.source->>'profileImageUrl' AS "profileImageUrl",f.i_follow AS "iFollow",f.follows_me AS "followsMe"
     FROM flags f JOIN users u ON u.id=f.id
     WHERE ($2='' OR u.username ILIKE '%'||$2||'%' OR u.full_name ILIKE '%'||$2||'%')
     ORDER BY u.full_name NULLS LAST,u.username LIMIT 100`,
    [userId, query || ""],
  );
  return result.rows;
}

export async function pgConversations(userId: string, limit = 50): Promise<any[]> {
  const result = await getPostgresPool().query(
    `WITH ranked AS (
       SELECT m.*,
         CASE WHEN from_user_id=$1 THEN to_user_id ELSE from_user_id END partner_id,
         row_number() OVER (PARTITION BY LEAST(from_user_id,to_user_id),GREATEST(from_user_id,to_user_id)
                            ORDER BY created_at DESC,id DESC) rn,
         count(*) FILTER (WHERE to_user_id=$1 AND is_read=false AND deleted_at IS NULL) OVER
           (PARTITION BY LEAST(from_user_id,to_user_id),GREATEST(from_user_id,to_user_id)) unread_count
       FROM direct_messages m WHERE (from_user_id=$1 OR to_user_id=$1) AND NOT ($1=ANY(hidden_for))
     )
     SELECT r.*,u.username,u.full_name,u.avatar,u.source->>'profileImageUrl' profile_image_url
     FROM (SELECT * FROM ranked WHERE rn=1 UNION ALL SELECT m.*,p.target_id AS partner_id,1::bigint AS rn,0::bigint AS unread_count FROM chat_inbox_state p JOIN LATERAL (SELECT * FROM direct_messages d WHERE (d.from_user_id=$1 AND d.to_user_id=p.target_id) OR (d.from_user_id=p.target_id AND d.to_user_id=$1) ORDER BY d.created_at DESC,d.id DESC LIMIT 1) m ON true WHERE p.user_id=$1 AND p.kind='direct' AND NOT p.deleted AND NOT EXISTS(SELECT 1 FROM ranked r WHERE r.partner_id=p.target_id)) r JOIN users u ON u.id=r.partner_id
     ORDER BY r.created_at DESC,r.id DESC LIMIT $2`,
    [userId, limit],
  );
  return result.rows.map((row) => ({
    partnerId: row.partner_id,
    partner: { _id: row.partner_id, username: row.username, fullName: row.full_name,
      avatar: row.avatar, profileImageUrl: row.profile_image_url },
    lastMessageDeleted:!!row.deleted_at&&!row.hidden_for?.includes(userId),lastMessage: row.hidden_for?.includes(userId)||row.deleted_at?'':row.message_type==='station'?(()=>{try{return '📻 '+String(JSON.parse(row.content).name||'Radio').slice(0,140);}catch{return '📻 Radio';}})():row.content, lastMessageAt: row.created_at,
    unreadCount: Number(row.unread_count || 0),
  }));
}

export async function pgChatMessageById(id:string):Promise<any|null>{
 const result=await getPostgresPool().query('SELECT * FROM direct_messages WHERE id=$1 LIMIT 1',[id]);return result.rows[0]?{...shape(result.rows[0]),hiddenFor:result.rows[0].hidden_for||[]}:null;
}

export async function pgDeleteChatMessage(userId:string,id:string,scope:'self'|'everyone'):Promise<any|null>{
 const result=scope==='everyone'
 ?await getPostgresPool().query(`UPDATE direct_messages SET content='',image_url=NULL,message_type='text',deleted_at=COALESCE(deleted_at,now()),updated_at=now() WHERE id=$1 AND from_user_id=$2 AND (deleted_at IS NOT NULL OR created_at>statement_timestamp()-interval '48 hours') RETURNING *`,[id,userId])
 :await getPostgresPool().query(`UPDATE direct_messages SET hidden_for=CASE WHEN $2=ANY(hidden_for) THEN hidden_for ELSE array_append(hidden_for,$2) END WHERE id=$1 AND (from_user_id=$2 OR to_user_id=$2) RETURNING *`,[id,userId]);
 return result.rows[0]?shape(result.rows[0]):null;
}

/** Pins are shared within the participant-only conversation. */
export async function pgPinChatMessage(userId:string,id:string,pinned:boolean):Promise<any|null>{
 const result=await getPostgresPool().query(`UPDATE direct_messages SET pinned_at=CASE WHEN $3 THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND (from_user_id=$2 OR to_user_id=$2) AND deleted_at IS NULL AND NOT ($2=ANY(hidden_for)) RETURNING *`,[id,userId,pinned]);
 return result.rows[0]?shape(result.rows[0]):null;
}
export async function pgPinnedChatMessages(userId:string,partnerId:string):Promise<any[]>{
 const result=await getPostgresPool().query(`SELECT * FROM direct_messages WHERE ((from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1)) AND pinned_at IS NOT NULL AND deleted_at IS NULL AND NOT ($1=ANY(hidden_for)) ORDER BY pinned_at DESC LIMIT 20`,[userId,partnerId]);
 return result.rows.map(shape);
}
