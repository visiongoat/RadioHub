import {getPostgresPool} from '../postgres-runtime';
import {stationVisibilitySql} from '../utils/station-visibility';
type DB={query:Function};
let schemaPool:unknown,schemaUntil=0,approvedAvailable=false;
export function summaryStationIds(value:unknown):string[]{
 if(typeof value!=='string')throw Object.assign(Error('INVALID_STATIONS'),{status:400});
 const ids=[...new Set(value.split(',').filter(Boolean))];
 if(!ids.length||ids.length>6||ids.some(id=>!/^[a-f0-9]{24}$/.test(id)))throw Object.assign(Error('INVALID_STATIONS'),{status:400});
 return ids.sort();
}
const allowedPerson=`u.is_public_profile IS TRUE AND COALESCE(u.status,'active') NOT IN ('inactive','suspended','banned','deleted')
 AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=u.id AND n.expires_at>now())
 AND NOT EXISTS(SELECT 1 FROM station_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=u.id) OR (b.user_id=u.id AND b.blocked_user_id=$2))
 AND NOT EXISTS(SELECT 1 FROM direct_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=u.id) OR (b.user_id=u.id AND b.blocked_user_id=$2))`;
/** Read-only: looking at a card never joins a room or creates a presence lease. */
export async function stationRoomSummaries(ids:string[],viewer:string,db:DB=getPostgresPool()){
 summaryStationIds(ids.join(','));
 if(schemaPool!==db||Date.now()>schemaUntil){
  const result=await db.query("SELECT to_regclass('station_chat_home_previews') IS NOT NULL AS available");
  schemaPool=db;schemaUntil=Date.now()+60000;approvedAvailable=result.rows[0]?.available===true;
 }
 const {rows}=await db.query(`SELECT s.id AS "stationId",
 (SELECT count(DISTINCT a.identity_id)::int FROM station_chat_sessions a WHERE a.station_id=s.id AND a.connected AND a.expires_at>now()
 AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=a.user_id AND n.expires_at>now())) AS count,
 COALESCE((SELECT jsonb_agg(p) FROM (
   SELECT u.id AS "_id",u.avatar FROM users u JOIN (
     SELECT user_id,max(expires_at) expires FROM station_chat_sessions WHERE station_id=s.id AND connected AND expires_at>now() AND user_id IS NOT NULL GROUP BY user_id
   ) a ON a.user_id=u.id WHERE ${allowedPerson} ORDER BY a.expires DESC,u.id LIMIT 6
 ) p),'[]'::jsonb) AS participants
 FROM stations s WHERE s.id=ANY($1::text[]) AND ${stationVisibilitySql('s')} AND s.redirect_to_slug IS NULL ORDER BY s.id`,[ids,viewer]);
 // Never substitute unreviewed chat history when the optional home moderation pipeline is absent.
 let snippets:any[]=[];
 if(approvedAvailable&&rows.length){
  snippets=(await db.query(`SELECT s.id AS "stationId",COALESCE((SELECT jsonb_agg(p) FROM (
   SELECT m.id AS "_id",p.display_name AS name,m.content,m.created_at AS "createdAt"
   FROM station_chat_messages m JOIN station_chat_home_previews p ON p.message_id=m.id AND p.decision='approved' AND p.reviewed_content=m.content
   JOIN users u ON u.id=m.user_id WHERE m.station_id=s.id AND m.deleted_at IS NULL AND m.message_type='text' AND m.created_at>now()-interval '24 hours'
   AND ${allowedPerson} AND NOT EXISTS(SELECT 1 FROM station_chat_reports r WHERE r.message_id=m.id AND r.status<>'dismissed')
   ORDER BY m.created_at DESC,m.id DESC LIMIT 1
  ) p),'[]'::jsonb) AS messages FROM stations s WHERE s.id=ANY($1::text[])`,[rows.map((r:any)=>r.stationId),viewer])).rows;
 }
 return {rooms:rows.map((row:any)=>({stationId:row.stationId,count:Number(row.count)||0,participants:row.participants||[],messages:snippets.find(s=>s.stationId===row.stationId)?.messages||[]}))};
}
