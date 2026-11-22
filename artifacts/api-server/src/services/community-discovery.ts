import { getPostgresPool } from '../postgres-runtime';
import { publicStationCache } from '../public-station-cache';
import { publicUserIdentity } from '../utils/public-user-identity';
interface RankedProfile { id:string; favoriteCount:number }
const prefix='community-profiles:discovery:v2:';
/** Bounded cohorts balance new arrivals and favorite-rich profiles. Global
 * favorite counts run at most once per five minutes; the fresh cohort counts
 * only its 1,000 selected IDs every 30s. Both reads are single-flight. */
export async function getCommunityDiscovery(requestedLimit=24,requestedPage=1) {
  const limit=Math.max(1,Math.min(100,Math.trunc(Number(requestedLimit))||24));
  const page=Math.max(1,Math.min(100,Math.trunc(Number(requestedPage))||1));
  const [rich,recent]=await Promise.all([
    publicStationCache.getOrSetSingleFlight<RankedProfile[]>(prefix+'favorites',async()=>{
      const {rows}=await getPostgresPool().query(`SELECT u.id,count(*)::int AS "favoriteCount"
        FROM users u JOIN user_favorites f ON f.user_id=u.id JOIN stations s ON s.id=f.station_id
        WHERE u.is_public_profile AND u.status='active'
          AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))
        GROUP BY u.id ORDER BY count(*) DESC,u.created_at DESC,u.id LIMIT 1000`);
      return rows;
    },{ttl:300}),
    publicStationCache.getOrSetSingleFlight<RankedProfile[]>(prefix+'recent',async()=>{
      const {rows}=await getPostgresPool().query(`WITH recent AS MATERIALIZED (
        SELECT id,created_at FROM users WHERE is_public_profile AND status='active'
        ORDER BY created_at DESC,id LIMIT 1000
      ) SELECT u.id,counts.count AS "favoriteCount" FROM recent u
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS count FROM user_favorites f JOIN stations s ON s.id=f.station_id
          WHERE f.user_id=u.id AND (s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false))
        ) counts ORDER BY u.created_at DESC,u.id`);
      return rows;
    },{ttl:30}),
  ]);
  const ranked:RankedProfile[]=[],seen=new Set<string>();
  for(let index=0;index<Math.max(rich.length,recent.length);index++)for(const entry of [rich[index],recent[index]]){
    if(entry&&!seen.has(entry.id)){seen.add(entry.id);ranked.push(entry);}
  }
  const slice=ranked.slice((page-1)*limit,page*limit);
  if(!slice.length)return {data:[],pagination:{page,limit,hasMore:false}};
  // Privacy and identity never wait for ranking expiry; hydrate selected IDs only.
  const {rows}=await getPostgresPool().query(`SELECT u.id,u.full_name AS "fullName",u.username,u.slug,u.avatar,
    u.source->>'profileImageUrl' AS "profileImageUrl",u.created_at AS "createdAt"
    FROM users u WHERE u.id=ANY($1::text[]) AND u.is_public_profile AND u.status='active'`,[slice.map(p=>p.id)]);
  const visible=new Map(rows.map(row=>[row.id,row]));
  const data=slice.flatMap(entry=>{const user=visible.get(entry.id);return user?[{_id:entry.id,id:entry.id,...publicUserIdentity(user),slug:user.slug,createdAt:user.createdAt,
    favoriteCount:entry.favoriteCount,favorites_count:entry.favoriteCount,favoriteStationsCount:entry.favoriteCount}]:[];});
  return {data,pagination:{page,limit,hasMore:page*limit<ranked.length}};
}
