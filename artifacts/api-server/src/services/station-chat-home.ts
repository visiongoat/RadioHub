import { getStationCountryIdentity } from "@workspace/seo-shared/seo-config";
import { getPostgresPool } from "../postgres-runtime";
import { stationVisibilitySql } from "../utils/station-visibility";
const ranks = new Map<
  string,
  { until: number; data: Promise<{ station_id: string }[]> }
>();
// Eligibility follows the room's retained history, independently of live presence.
// Approval/public-profile rules below apply separately to public Home snippets.
const retainedMessageSql = (alias: string) => `${alias}.deleted_at IS NULL
  AND ${alias}.created_at>now()-interval '24 hours'
  AND NOT EXISTS(SELECT 1 FROM station_chat_reports r WHERE r.message_id=${alias}.id AND r.status<>'dismissed')
  AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=${alias}.user_id AND n.expires_at>now())`;
let rankPool: unknown;
async function roomRank(country: string, code: string) {
  const db = getPostgresPool();
  if (rankPool !== db) {
    ranks.clear();
    rankPool = db;
  }
  const key = country + "|" + code,
    cached = ranks.get(key);
  if (cached && cached.until > Date.now()) return cached.data;
  const data = db
    .query(
      `WITH retained AS MATERIALIZED (
        SELECT live.station_id,max(live.created_at) AS last_message
        FROM station_chat_messages live JOIN stations s ON s.id=live.station_id
        WHERE ${stationVisibilitySql("s")} AND s.redirect_to_slug IS NULL
        AND ($1='' OR lower(s.country)=lower($1) OR ($2<>'' AND upper(s.country_code)=upper($2)))
        AND ${retainedMessageSql("live")}
        GROUP BY live.station_id
      ), presence AS (
        SELECT a.station_id,count(DISTINCT a.identity_id)::int AS count
        FROM station_chat_sessions a JOIN retained r ON r.station_id=a.station_id
        WHERE a.connected AND a.expires_at>now()
        AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=a.user_id AND n.expires_at>now())
        GROUP BY a.station_id
      ), pool AS (
        SELECT r.station_id,r.last_message,s.country_code,s.country,COALESCE(p.count,0) AS count,
          row_number() OVER(PARTITION BY COALESCE(NULLIF(s.country_code,''),s.country)
            ORDER BY COALESCE(p.count,0) DESC,r.last_message DESC,r.station_id) AS country_rank
        FROM retained r JOIN stations s ON s.id=r.station_id LEFT JOIN presence p ON p.station_id=r.station_id
      ), candidates AS MATERIALIZED (
        SELECT * FROM pool ORDER BY CASE WHEN $1='' THEN country_rank ELSE 0 END,count DESC,last_message DESC,station_id LIMIT 128
      ), scored AS (SELECT c.station_id,c.count,c.country_code,c.country,
        (ln(1+c.count)*0.75+COALESCE(activity.recent,0)*0.6) AS score FROM candidates c
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS recent FROM (
          SELECT m.id FROM station_chat_messages m
          JOIN station_chat_home_previews p ON p.message_id=m.id AND p.decision='approved' AND p.reviewed_content=m.content
          JOIN users u ON u.id=m.user_id AND u.is_public_profile
          AND COALESCE(u.status,'active') NOT IN ('inactive','suspended','banned','deleted')
          WHERE m.station_id=c.station_id AND m.deleted_at IS NULL AND m.created_at>now()-interval '10 minutes'
          AND NOT EXISTS(SELECT 1 FROM station_chat_reports r WHERE r.message_id=m.id AND r.status<>'dismissed')
          AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=m.user_id AND n.expires_at>now())
          ORDER BY m.created_at DESC,m.id DESC LIMIT 12
        ) visible
      ) activity ON true
      ), diversified AS (
        SELECT *,row_number() OVER(PARTITION BY COALESCE(NULLIF(country_code,''),country) ORDER BY score DESC,station_id) AS country_rank FROM scored
      ) SELECT station_id FROM diversified
      ORDER BY CASE WHEN $1='' THEN country_rank ELSE 0 END,score DESC,station_id LIMIT 32`,
      [country, code],
    )
    .then((result) => result.rows);
  const value = { until: Date.now() + 3000, data };
  ranks.delete(key);
  ranks.set(key, value);
  if (ranks.size > 64) ranks.delete(ranks.keys().next().value!);
  try {
    return await data;
  } catch (error) {
    if (ranks.get(key) === value) ranks.delete(key);
    throw error;
  }
}
/** Short shared rank cache; private snippets/blocks are always read per viewer. */
export async function activeStationRooms(country: string, actor: string) {
  const identity = getStationCountryIdentity({
    country,
    countryCode: country.length === 2 ? country : undefined,
  });
  const rank = await roomRank(country, identity?.code || "");
  if (!rank.length) return { rooms: [], updatedAt: new Date().toISOString() };
  const { rows } = await getPostgresPool().query(
    `
 WITH active AS (SELECT * FROM unnest($4::text[]) AS a(station_id) ), rooms AS MATERIALIZED (
   SELECT s.id,s.name,s.country,s.country_code,s.state,s.source->>'city' AS city,
     s.language,s.language_codes,s.tags_raw,s.url,s.url_resolved,s.favicon,s.logo_assets,s.has_logo,presence.count
   FROM active a JOIN stations s ON s.id=a.station_id
   CROSS JOIN LATERAL (
     SELECT count(DISTINCT p.identity_id)::int AS count FROM station_chat_sessions p
     WHERE p.station_id=s.id AND p.connected AND p.expires_at>now()
     AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=p.user_id AND n.expires_at>now())
   ) presence
   WHERE ${stationVisibilitySql("s")} AND s.redirect_to_slug IS NULL
   AND ($1='' OR lower(s.country)=lower($1) OR ($3<>'' AND upper(s.country_code)=upper($3)))
   AND EXISTS(SELECT 1 FROM station_chat_messages live WHERE live.station_id=s.id AND ${retainedMessageSql("live")})
   ORDER BY array_position($4::text[],s.id) LIMIT 32
 )
 SELECT jsonb_build_object('_id',s.id,'name',s.name,'country',s.country,'countryCode',s.country_code,'state',s.state,'city',s.city,'language',s.language,'languagecodes',s.language_codes,'tags',s.tags_raw,'url',s.url,'urlResolved',s.url_resolved,'favicon',s.favicon,'logoAssets',s.logo_assets,'hasLogo',s.has_logo) AS station,
 s.count,s.count AS "activeCount",COALESCE(people.total,0) AS "participantCount",COALESCE(people.items,'[]'::jsonb) AS participants,COALESCE(preview.items,'[]'::jsonb) AS messages
 FROM rooms s
 LEFT JOIN LATERAL (
   SELECT jsonb_agg(to_jsonb(p)-'total'-'latest' ORDER BY p.latest DESC,p."_id") AS items,max(p.total)::int AS total FROM (
     SELECT u.id AS "_id",u.avatar,u.source->>'profileImageUrl' AS "profileImageUrl",
       (f.following_id IS NOT NULL) AS "isFollowed",
       CASE WHEN f.following_id IS NOT NULL THEN COALESCE(NULLIF(btrim(u.full_name),''),u.username) END AS "displayName",
       a.latest,count(*) OVER() AS total
     FROM users u JOIN (
       SELECT m.user_id,max(m.created_at) AS latest FROM station_chat_messages m
       WHERE m.station_id=s.id AND ${retainedMessageSql("m")} GROUP BY m.user_id
     ) a ON a.user_id=u.id
     LEFT JOIN user_follows f ON f.follower_id=$2 AND f.following_id=u.id
     WHERE u.is_public_profile AND COALESCE(u.status,'active') NOT IN ('inactive','suspended','banned','deleted')
     AND NOT EXISTS(SELECT 1 FROM station_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=u.id) OR (b.user_id=u.id AND b.blocked_user_id=$2))
     AND NOT EXISTS(SELECT 1 FROM direct_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=u.id) OR (b.user_id=u.id AND b.blocked_user_id=$2))
     AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=u.id AND n.expires_at>now())
     ORDER BY a.latest DESC,u.id LIMIT 3
   ) p
 ) people ON true
 LEFT JOIN LATERAL (
   SELECT jsonb_agg(p) AS items FROM (
     SELECT m.id AS "_id",p.display_name AS name,m.content,m.created_at AS "createdAt",
       m.user_id AS "userId",u.avatar,u.source->>'profileImageUrl' AS "profileImageUrl"
     FROM station_chat_messages m JOIN station_chat_home_previews p ON p.message_id=m.id AND p.decision='approved' AND p.reviewed_content=m.content
     JOIN users u ON u.id=m.user_id AND u.is_public_profile
          AND COALESCE(u.status,'active') NOT IN ('inactive','suspended','banned','deleted')
     WHERE m.station_id=s.id AND m.deleted_at IS NULL AND m.created_at>now()-interval '24 hours'
     AND NOT EXISTS(SELECT 1 FROM station_chat_reports r WHERE r.message_id=m.id AND r.status<>'dismissed')
     AND NOT EXISTS(SELECT 1 FROM station_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=m.user_id) OR (b.user_id=m.user_id AND b.blocked_user_id=$2))
     AND NOT EXISTS(SELECT 1 FROM direct_chat_blocks b WHERE (b.user_id=$2 AND b.blocked_user_id=m.user_id) OR (b.user_id=m.user_id AND b.blocked_user_id=$2))
     AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions n WHERE n.user_id=m.user_id AND n.expires_at>now())
     ORDER BY m.created_at DESC,m.id DESC LIMIT 6
   ) p
 ) preview ON true
 ORDER BY array_position($4::text[],s.id)`,
    [
      country,
      actor,
      identity?.code || "",
      rank.map((room) => room.station_id),
    ],
  );
  return { rooms: rows, updatedAt: new Date().toISOString() };
}
