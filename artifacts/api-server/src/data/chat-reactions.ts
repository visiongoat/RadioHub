export const CHAT_REACTIONS = new Set(['👍','❤️','😂','😮','😢','🙏']);
export function validChatReaction(emoji:unknown):emoji is string|null{return emoji===null||typeof emoji==='string'&&CHAT_REACTIONS.has(emoji);}
/** Idempotent set/remove (not a toggle). The actor and display identity are server-owned.
 * Atomic JSON replacement serializes concurrent users without losing reactions. */
export async function setChatReaction(db:{query:Function},kind:'direct'|'group',id:string,actor:string,emoji:string|null,groupId?:string){
 if(!validChatReaction(emoji))throw Object.assign(Error('Invalid reaction'),{status:400});
 const table=kind==='direct'?'direct_messages':'chat_group_messages';
 const scope=kind==='direct'?'(m.from_user_id=$2 OR m.to_user_id=$2)':"m.group_id=$4 AND EXISTS(SELECT 1 FROM chat_group_members member WHERE member.group_id=m.group_id AND member.user_id=$2 AND member.status='active' AND m.created_at>=member.joined_at)";
 const result=await db.query(`UPDATE ${table} m SET reactions=COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(m.reactions) r WHERE r->>'userId'<>$2),'[]'::jsonb)||CASE WHEN $3::text IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('userId',$2,'emoji',$3::text,'name',COALESCE((SELECT COALESCE(NULLIF(full_name,''),username) FROM users WHERE id=$2),''),'avatar',(SELECT avatar FROM users WHERE id=$2))) END,reactions_revision=m.reactions_revision+1 WHERE m.id=$1 AND ${scope} AND m.deleted_at IS NULL AND NOT ($2=ANY(m.hidden_for)) RETURNING m.*`,kind==='group'?[id,actor,emoji,groupId]:[id,actor,emoji]);
 return result.rows[0]||null;
}
