import { getPostgresPool } from '../postgres-runtime';

/** Keyset pagination remains bounded and does not skip rows as invalid tokens are removed. */
export async function* pgPushDevices(filters: { userId?: string; country?: string } = {}): AsyncGenerator<{ id:string; token:string; platform:string; tokenType:string }> {
  let after='';
  while(true){
    const rows=(await getPostgresPool().query(`SELECT id,token,platform,token_type AS "tokenType" FROM push_tokens
      WHERE is_active=true AND id>$1 AND ($2::text IS NULL OR user_id=$2) AND ($3::text IS NULL OR country=$3)
      ORDER BY id LIMIT 500`,[after,filters.userId||null,filters.country||null])).rows;
    if(!rows.length)return;
    for(const row of rows)yield row;
    after=rows[rows.length-1].id;
  }
}
export async function pgPushStatus():Promise<any>{
  const [counts,countries,delivery]=await Promise.all([
    getPostgresPool().query(`SELECT count(*)::int total,count(*) FILTER(WHERE is_active)::int active,
      count(*) FILTER(WHERE is_active AND platform='ios')::int ios,count(*) FILTER(WHERE is_active AND platform='android')::int android,
      count(*) FILTER(WHERE is_active AND token_type='expo')::int expo,count(*) FILTER(WHERE is_active AND token_type='apns')::int apns,
      count(*) FILTER(WHERE is_active AND token_type='fcm')::int fcm FROM push_tokens`),
    getPostgresPool().query("SELECT country,count(*)::int count FROM push_tokens WHERE is_active AND country<>'' GROUP BY country ORDER BY count(*) DESC,country LIMIT 10"),
    getPostgresPool().query("SELECT COALESCE(d.platform,'unknown') AS platform,r.state,r.error_code AS error,count(*)::int count FROM push_receipts r LEFT JOIN push_tokens d ON d.id=r.push_token_id WHERE r.created_at>=now()-interval '24 hours' GROUP BY d.platform,r.state,r.error_code ORDER BY count(*) DESC"),
  ]);
  const row=counts.rows[0];return {tokens:{total:row.total,active:row.active,byPlatform:{ios:row.ios,android:row.android},byType:{expo:row.expo,apns:row.apns,fcm:row.fcm}},topCountries:countries.rows,deliveryLast24Hours:delivery.rows};
}
export async function pgCleanupPushTokens():Promise<number>{
  return(await getPostgresPool().query("DELETE FROM push_tokens WHERE is_active=false AND updated_at<now()-interval '30 days'")).rowCount||0;
}
