import { getPostgresPool } from '../postgres-runtime';
import { publicStationCache } from '../public-station-cache';
import { publicUserIdentity } from '../utils/public-user-identity';
const key='community-profiles:discovery:v1';
/** One shared, bounded 30s pool. New arrivals and favorite-rich profiles alternate;
 * ties use immutable IDs. Paging never randomizes an already viewed collection. */
export async function getCommunityDiscovery(requestedLimit=24,requestedPage=1) {
  const limit=Math.max(1,Math.min(100,Math.trunc(Number(requestedLimit))||24));
  const page=Math.max(1,Math.min(100,Math.trunc(Number(requestedPage))||1));
  const ranked=await publicStationCache.getOrSetSingleFlight(key,async()=>{
    const {rows}=await getPostgresPool().query(`WITH favorites AS MATERIALIZED (
      SELECT f.user_id,count(*)::int AS count FROM user_favorites f
      JOIN stations s ON s.id=f.station_id
      WHERE s.is_list_visible IS TRUE OR COALESCE(s.visibility_expires_at<=now(),false)
      GROUP BY f.user_id
    ), candidates AS MATERIALIZED (
      (SELECT u.id,u.created_at,COALESCE(f.count,0) AS count FROM users u LEFT JOIN favorites f ON f.user_id=u.id
        WHERE u.is_public_profile AND u.status='active' ORDER BY u.created_at DESC,u.id LIMIT 1000)
      UNION
      (SELECT u.id,u.created_at,f.count FROM users u JOIN favorites f ON f.user_id=u.id
        WHERE u.is_public_profile AND u.status='active' ORDER BY f.count DESC,u.created_at DESC,u.id LIMIT 1000)
    ), ranked AS (
      SELECT *,row_number() OVER(ORDER BY created_at DESC,id) AS recent_rank,
        row_number() OVER(ORDER BY count DESC,created_at DESC,id) AS favorite_rank FROM candidates
    ) SELECT id,count AS "favoriteCount" FROM ranked
      ORDER BY least(recent_rank*2,favorite_rank*2-1),recent_rank,id LIMIT 2000`);
    return rows;
  },{ttl:30});
  const slice=ranked.slice((page-1)*limit,page*limit);
  if(!slice.length)return {data:[],pagination:{page,limit,hasMore:false}};
  // Privacy and identity never wait for ranking expiry; only selected IDs are hydrated.
  const {rows}=await getPostgresPool().query(`SELECT u.id,u.full_name AS "fullName",u.username,u.slug,u.avatar,
    u.source->>'profileImageUrl' AS "profileImageUrl",u.created_at AS "createdAt"
    FROM users u WHERE u.id=ANY($1::text[]) AND u.is_public_profile AND u.status='active'`,[slice.map((p:any)=>p.id)]);
  const visible=new Map(rows.map((row:any)=>[row.id,row]));
  const data=slice.flatMap((entry:any)=>{const user=visible.get(entry.id);return user?[{_id:entry.id,id:entry.id,...publicUserIdentity(user),slug:user.slug,createdAt:user.createdAt,
    favoriteCount:entry.favoriteCount,favorites_count:entry.favoriteCount,favoriteStationsCount:entry.favoriteCount}]:[];});
  return {data,pagination:{page,limit,hasMore:page*limit<ranked.length}};
}
