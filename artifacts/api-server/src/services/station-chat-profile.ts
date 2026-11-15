import {getPostgresPool} from '../postgres-runtime';
import {pgUserFollowCounts} from '../data/postgres-user-store';
import {pgListeningTotalMinutes} from '../data/postgres-listening-store';
/** Aggregate public profile only. Never exposes email, history or subscription details. */
type ProfileSources = {query:(sql:string,values:string[])=>Promise<{rows:unknown[]}>;counts:typeof pgUserFollowCounts;minutes:typeof pgListeningTotalMinutes};
export async function stationChatProfilePreview(userId:string,viewerId:string,sources?:ProfileSources) {
  if(!/^[a-f0-9]{24}$/.test(userId))throw Object.assign(Error('PROFILE_UNAVAILABLE'),{status:404});
  const read=sources?.query||((sql:string,values:string[])=>getPostgresPool().query(sql,values));
  const {rows}=await read(`SELECT u.id,(SELECT count(*)::int FROM user_favorites f JOIN stations s ON s.id=f.station_id WHERE f.user_id=u.id AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))) AS favorite_count FROM users u WHERE u.id=$1
    AND u.is_public_profile IS TRUE AND COALESCE(u.status,'active') NOT IN ('inactive','suspended','banned','deleted')
    AND NOT EXISTS(SELECT 1 FROM station_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=u.id) OR (b.user_id=u.id AND b.blocked_user_id=$2))
    AND NOT EXISTS(SELECT 1 FROM direct_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=u.id) OR (b.user_id=u.id AND b.blocked_user_id=$2))`,[userId,viewerId]);
  if(!rows.length)throw Object.assign(Error('PROFILE_UNAVAILABLE'),{status:404});
  const [counts,minutes]=await Promise.all([(sources?.counts||pgUserFollowCounts)(userId),(sources?.minutes||pgListeningTotalMinutes)(userId)]);
  return {_id:userId,isPublicProfile:true,...counts,favoriteStationsCount:Number((rows[0] as {favorite_count:number}).favorite_count||0),totalListeningMinutes:minutes};
}
