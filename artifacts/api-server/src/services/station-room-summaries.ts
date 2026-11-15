import {getPostgresPool} from '../postgres-runtime';
import {stationVisibilitySql} from '../utils/station-visibility';
export function summaryStationIds(value:unknown):string[]{
 if(typeof value!=='string')throw Object.assign(Error('INVALID_STATIONS'),{status:400});
 const ids=[...new Set(value.split(',').filter(Boolean))];
 if(!ids.length||ids.length>6||ids.some(id=>!/^[a-f0-9]{24}$/.test(id)))throw Object.assign(Error('INVALID_STATIONS'),{status:400});
 return ids.sort();
}
/** Six bounded indexed presence reads; no room joins, leases or message history. */
export async function stationRoomSummaries(ids:string[],viewer:string,db:{query:Function}=getPostgresPool()){
 summaryStationIds(ids.join(','));
 const {rows}=await db.query(`SELECT s.id AS "stationId",
 (SELECT count(DISTINCT a.identity_id)::int FROM station_chat_sessions a WHERE a.station_id=s.id AND a.connected AND a.expires_at>now()
 AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=a.user_id AND n.expires_at>now())) AS count,
 COALESCE((SELECT jsonb_agg(p) FROM (
   SELECT u.id AS "_id",u.avatar,u.source->>'profileImageUrl' AS "profileImageUrl" FROM users u JOIN (
     SELECT user_id,max(expires_at) expires FROM station_chat_sessions WHERE station_id=s.id AND connected AND expires_at>now() AND user_id IS NOT NULL GROUP BY user_id
   ) a ON a.user_id=u.id WHERE u.is_public_profile IS TRUE AND COALESCE(u.status,'active') NOT IN ('inactive','suspended','banned','deleted')
   AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=u.id AND n.expires_at>now())
   AND NOT EXISTS(SELECT 1 FROM station_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=u.id) OR (b.user_id=u.id AND b.blocked_user_id=$2))
   AND NOT EXISTS(SELECT 1 FROM direct_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=u.id) OR (b.user_id=u.id AND b.blocked_user_id=$2))
   ORDER BY a.expires DESC,u.id LIMIT 2
 ) p),'[]'::jsonb) AS participants
 FROM stations s WHERE s.id=ANY($1::text[]) AND ${stationVisibilitySql('s')} AND s.redirect_to_slug IS NULL ORDER BY s.id`,[ids,viewer]);
 return {rooms:rows.map((row:any)=>({stationId:row.stationId,count:Number(row.count)||0,participants:row.participants||[]}))};
}
