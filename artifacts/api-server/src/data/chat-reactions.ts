export const CHAT_REACTIONS = new Set(['👍','❤️','😂','😮','😢','🙏','♫']);
export function validChatReaction(emoji:unknown):emoji is string|null{return emoji===null||typeof emoji==='string'&&CHAT_REACTIONS.has(emoji);}
/** Idempotent set/remove (not a toggle). The actor and display identity are server-owned.
 * Atomic JSON replacement serializes concurrent users without losing reactions. */
export async function setChatReaction(db:{query:Function},kind:'direct'|'group'|'station',id:string,actor:string,emoji:string|null,conversationId?:string){
 if(!validChatReaction(emoji))throw Object.assign(Error('Invalid reaction'),{status:400});
 const table={direct:'direct_messages',group:'chat_group_messages',station:'station_chat_messages'}[kind];
 const scope={
  direct:'(m.from_user_id=$2 OR m.to_user_id=$2)',
  group:"m.group_id=$4 AND EXISTS(SELECT 1 FROM chat_group_members member WHERE member.group_id=m.group_id AND member.user_id=$2 AND member.status='active' AND m.created_at>=member.joined_at)",
  station:`m.station_id=$4 AND m.created_at>now()-interval '24 hours'
    AND EXISTS(SELECT 1 FROM station_chat_sessions s WHERE s.user_id=$2 AND s.station_id=m.station_id AND s.connected AND s.expires_at>now())
    AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions s WHERE s.user_id=$2 AND s.expires_at>now())
    AND NOT EXISTS(SELECT 1 FROM station_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=m.user_id) OR (b.user_id=m.user_id AND b.blocked_user_id=$2))`,
 }[kind];
 const visibility=kind==='station'?'':'AND NOT ($2=ANY(m.hidden_for))';
 const result=await db.query(`UPDATE ${table} m SET reactions=COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(m.reactions) r WHERE r->>'userId'<>$2),'[]'::jsonb)||CASE WHEN $3::text IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('userId',$2,'emoji',$3::text,'name',COALESCE((SELECT COALESCE(NULLIF(full_name,''),username) FROM users WHERE id=$2),''),'avatar',(SELECT avatar FROM users WHERE id=$2))) END,reactions_revision=m.reactions_revision+1 WHERE m.id=$1 AND ${scope} AND m.deleted_at IS NULL ${visibility} RETURNING m.*`,kind==='direct'?[id,actor,emoji]:[id,actor,emoji,conversationId]);
 return result.rows[0]||null;
}
