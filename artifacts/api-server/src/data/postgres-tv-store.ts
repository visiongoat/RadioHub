import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type pg from "pg";
import { getPostgresPool } from "../postgres-runtime";

const newId = () => randomBytes(12).toString("hex");
function shape(row: any): any {
  if (!row) return null;
  const result: any = {};
  for (const [key, value] of Object.entries(row)) result[key.replace(/_([a-z])/g, (_m, letter) => letter.toUpperCase())] = value;
  if (row.id) result._id = row.id;
  if (row.timestamp !== undefined) result.timestamp = Number(row.timestamp);
  if (row.count !== undefined) result.count = Number(row.count);
  return result;
}
async function transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
async function mintTvToken(client: pg.PoolClient, userId: string, deviceName: string): Promise<string> {
  const token = `mrt_tv_${randomBytes(32).toString("hex")}`;
  await client.query(`INSERT INTO auth_tokens(id,token,user_id,device_type,device_name,expires_at,last_used_at)
    VALUES($1,$2,$3,'tv',$4,now()+interval '90 days',now())`, [randomUUID(),token,userId,deviceName]);
  return token;
}
export type TvCodeKind = "login" | "subscription";
export type StripePlanId = "remove_ads" | "premium_monthly" | "premium_yearly" | "premium_lifetime";

export async function createTvCode(kind: TvCodeKind, deviceId: string, platform: string, purchase?: { userId: string; plan: string }): Promise<any> {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [`tv-code:${kind}`,deviceId]);
    if (kind === "subscription") {
      const count = await client.query("SELECT count(*)::int count FROM tv_device_codes WHERE kind=$1 AND device_id=$2 AND created_at>now()-interval '1 hour'", [kind,deviceId]);
      if (count.rows[0].count >= 5) throw Object.assign(new Error("Too many code requests. Try again in an hour."), { statusCode: 429 });
    }
    await client.query("UPDATE tv_device_codes SET status='expired' WHERE kind=$1 AND status<>'expired' AND (expires_at<=now() OR (device_id=$2 AND status='pending'))", [kind,deviceId]);
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await client.query(`INSERT INTO tv_device_codes(id,kind,code,device_id,platform,user_id,plan,purchase_owner_id,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$6,now()+interval '10 minutes') ON CONFLICT DO NOTHING RETURNING *`, [newId(),kind,String(randomInt(100000,1000000)),deviceId,platform,purchase?.userId || null,purchase?.plan || null]);
      if (result.rowCount) return shape(result.rows[0]);
    }
    throw Object.assign(new Error("Unable to generate unique code. Try again."), { statusCode: 503 });
  });
}
export async function getTvCode(kind: TvCodeKind, code: string, deviceId?: string): Promise<any> {
  const result = await getPostgresPool().query(`SELECT *,CASE WHEN expires_at<=now() THEN 'expired' ELSE status END status
    FROM tv_device_codes WHERE kind=$1 AND code=$2 AND ($3::text IS NULL OR device_id=$3)
    ORDER BY created_at DESC,id DESC LIMIT 1`, [kind,code,deviceId || null]);
  return shape(result.rows[0]);
}
export async function activateTvLogin(code: string, userId: string): Promise<any> {
  return transaction(async (client) => {
    const result = await client.query("SELECT * FROM tv_device_codes WHERE kind='login' AND code=$1 AND status IN ('pending','activated') AND expires_at>now() FOR UPDATE", [code]);
    const row = result.rows[0];
    if (!row || (row.status === "activated" && row.user_id !== userId)) return null;
    if (row.status === "activated") return shape(row);
    const deviceName = row.platform === "tizen" ? "Samsung TV" : row.platform === "webos" ? "LG TV" : "TV";
    const token = await mintTvToken(client,userId,`${deviceName}-${row.device_id.slice(-6)}`);
    await client.query(`INSERT INTO user_devices(id,user_id,device_id,device_name,platform)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,device_id) DO UPDATE SET device_name=EXCLUDED.device_name,
      platform=EXCLUDED.platform,is_active=true,paired_at=now(),last_seen_at=now()`, [newId(),userId,row.device_id,deviceName,row.platform]);
    const updated = await client.query("UPDATE tv_device_codes SET status='activated',user_id=$2,token=$3,completed_at=now() WHERE id=$1 RETURNING *", [row.id,userId,token]);
    return shape(updated.rows[0]);
  });
}
/** Atomically reserve the checkout owner and plan before contacting a payment provider. */
export async function bindTvSubscriptionCheckout(codeId: string, userId: string, plan: string): Promise<boolean> {
  const result = await getPostgresPool().query(`UPDATE tv_device_codes SET user_id=$2,plan=$3
    WHERE id=$1 AND kind='subscription' AND status='pending' AND expires_at>now()
    AND (user_id IS NULL OR user_id=$2) AND (plan IS NULL OR plan=$3) RETURNING id`, [codeId,userId,plan]);
  return !!result.rowCount;
}
export async function completeTvSubscription(code: string, userId: string, plan: string, sessionId: string, codeId?: string, checkoutCreatedAt?: Date): Promise<void> {
  await getPostgresPool().query(`UPDATE tv_device_codes SET status='completed',user_id=$2,plan=$3,stripe_session_id=$4,completed_at=now()
    WHERE kind='subscription' AND code=$1 AND status='pending' AND expires_at>now()
      AND (user_id IS NULL OR user_id=$2) AND (plan IS NULL OR plan=$3)
      AND ($5::text IS NULL OR id=$5) AND ($5::text IS NOT NULL OR $6::timestamptz IS NULL OR created_at<=$6+interval '1 second')`, [code,userId,plan,sessionId,codeId||null,checkoutCreatedAt||null]);
}
export async function tvSubscriptionToken(codeId: string, deviceId: string): Promise<string | undefined> {
  return transaction(async (client) => {
    const result = await client.query("SELECT * FROM tv_device_codes WHERE id=$1 AND device_id=$2 AND kind='subscription' AND status='completed' AND expires_at>now() FOR UPDATE", [codeId,deviceId]);
    const row = result.rows[0];
    if (!row?.user_id) return undefined;
    if (row.token) return row.token;
    const deviceName = row.platform === 'tizen' ? 'Samsung TV' : row.platform === 'webos' ? 'LG TV' : 'TV';
    const token = await mintTvToken(client,row.user_id,`${deviceName}-${row.device_id.slice(-6)}`);
    await client.query(`INSERT INTO user_devices(id,user_id,device_id,device_name,platform)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,device_id) DO UPDATE SET is_active=true,last_seen_at=now()`, [newId(),row.user_id,row.device_id,deviceName,row.platform]);
    await client.query("UPDATE tv_device_codes SET token=$2 WHERE id=$1", [row.id,token]);
    return token;
  });
}
export async function listTvDevices(userId: string): Promise<any[]> {
  return (await getPostgresPool().query(`SELECT own.*,presence.last_seen_at FROM user_devices own
    CROSS JOIN LATERAL (SELECT MAX(last_seen_at) last_seen_at FROM user_devices
      WHERE device_id=own.device_id AND is_active=true) presence
    WHERE own.user_id=$1 AND own.is_active=true ORDER BY presence.last_seen_at DESC`, [userId])).rows.map(shape);
}
export async function findTvDevice(userId: string, deviceId: string): Promise<any> {
  return shape((await getPostgresPool().query("SELECT * FROM user_devices WHERE user_id=$1 AND device_id=$2 AND is_active=true", [userId,deviceId])).rows[0]);
}
export async function touchTvDevice(userId: string, deviceId: string, platform?: string): Promise<void> {
  await getPostgresPool().query("UPDATE user_devices SET last_seen_at=now(),platform=COALESCE($3,platform) WHERE user_id=$1 AND device_id=$2 AND is_active=true", [userId,deviceId,platform || null]);
}
export async function unpairTvDevice(userId: string, deviceId: string): Promise<void> {
  await transaction(async (client) => {
    await lockCastQueue(client,deviceId);
    await client.query("UPDATE user_devices SET is_active=false WHERE user_id=$1 AND device_id=$2", [userId,deviceId]);
    await client.query("UPDATE cast_sessions SET status='expired',is_playing=false WHERE user_id=$1 AND tv_device_id=$2", [userId,deviceId]);
    await client.query("DELETE FROM cast_commands WHERE user_id=$1 AND device_id=$2", [userId,deviceId]);
    await client.query("DELETE FROM cast_now_playing WHERE user_id=$1 AND device_id=$2", [userId,deviceId]);
  });
}
// Pairing grants control of a physical receiver, independently of the profile
// currently signed into its UI. Sending or receiving never changes that profile.
async function lockCastQueue(client: pg.PoolClient, deviceId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", ['cast:device',deviceId]);
}
export async function enqueueCastCommand(userId: string, deviceId: string, type: string, station: any, payload: any = null): Promise<boolean> {
  return transaction(async client => {
    await lockCastQueue(client,deviceId);
    const device = await client.query("SELECT id FROM user_devices WHERE user_id=$1 AND device_id=$2 AND is_active=true FOR SHARE",[userId,deviceId]);
    if (!device.rowCount) return false;
    if (type === 'cast:play') await client.query(`UPDATE cast_commands SET consumed=true
      WHERE device_id=$1 AND consumed=false AND type IN ('cast:play','cast:pause','cast:resume','cast:stop')`,[deviceId]);
    await client.query(`INSERT INTO cast_commands(id,user_id,device_id,type,station,timestamp,payload)
      SELECT $1,$2,$3,$4,$5,GREATEST($6,COALESCE(MAX(timestamp)+1,$6)),$7 FROM cast_commands WHERE device_id=$3 AND consumed=false`,
      [newId(),userId,deviceId,type,station ? JSON.stringify(station):null,Date.now(),payload ? JSON.stringify(payload):null]);
    return true;
  });
}
export async function pollCastCommand(userId: string, deviceId: string): Promise<any> {
  return transaction(async client => {
    await lockCastQueue(client,deviceId);
    const receiver = await client.query("SELECT id FROM user_devices WHERE user_id=$1 AND device_id=$2 AND is_active=true FOR SHARE",[userId,deviceId]);
    if (!receiver.rowCount) return null;
    // Ignore revoked senders before compacting: their old intents must not
    // replace an authorized sender's request, including during rolling deploys.
    await client.query(`UPDATE cast_commands c SET consumed=true WHERE c.device_id=$1 AND c.consumed=false
      AND (c.created_at<=now()-interval '2 minutes' OR NOT EXISTS (
        SELECT 1 FROM user_devices d WHERE d.user_id=c.user_id AND d.device_id=c.device_id AND d.is_active=true))`,[deviceId]);
    await client.query(`UPDATE cast_commands c SET consumed=true WHERE c.device_id=$1 AND c.consumed=false
      AND c.type IN ('cast:play','cast:pause','cast:resume','cast:stop') AND EXISTS (
        SELECT 1 FROM cast_commands newer WHERE newer.device_id=c.device_id
        AND newer.consumed=false AND newer.type='cast:play' AND (newer.timestamp,newer.id)>(c.timestamp,c.id))`,[deviceId]);
    return shape((await client.query(`UPDATE cast_commands SET consumed=true WHERE id=(
      SELECT c.id FROM cast_commands c JOIN user_devices d ON d.user_id=c.user_id AND d.device_id=c.device_id AND d.is_active=true
      WHERE c.device_id=$1 AND c.consumed=false AND c.created_at>now()-interval '2 minutes'
      ORDER BY c.timestamp,c.id FOR UPDATE OF c SKIP LOCKED LIMIT 1) RETURNING *`, [deviceId])).rows[0]);
  });
}
export async function saveCastNowPlaying(userId: string, input: any): Promise<void> {
  await transaction(async client => {
    await lockCastQueue(client,input.deviceId);
    await client.query(`INSERT INTO cast_now_playing(id,user_id,device_id,platform,station_name,title,artist,is_playing)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS (
        SELECT 1 FROM user_devices WHERE user_id=$2 AND device_id=$3 AND is_active=true)
      ON CONFLICT(user_id,device_id) DO UPDATE SET platform=EXCLUDED.platform,
      station_name=EXCLUDED.station_name,title=EXCLUDED.title,artist=EXCLUDED.artist,is_playing=EXCLUDED.is_playing,updated_at=now()`,
      [newId(),userId,input.deviceId,input.platform || "other",input.stationName ?? null,input.title ?? null,input.artist ?? null,input.isPlaying === true || input.isPlaying === "true"]);
  });
}
export async function getCastNowPlaying(userId: string, deviceId: string): Promise<any> {
  // Return playback only, never the other signed-in account's identity or data.
  return shape((await getPostgresPool().query(`SELECT np.device_id,np.platform,np.station_name,np.title,np.artist,np.is_playing,np.updated_at
    FROM cast_now_playing np JOIN user_devices reporter ON reporter.user_id=np.user_id AND reporter.device_id=np.device_id AND reporter.is_active=true
    WHERE np.device_id=$2 AND EXISTS (SELECT 1 FROM user_devices WHERE user_id=$1 AND device_id=$2 AND is_active=true)
    ORDER BY np.updated_at DESC,np.id DESC LIMIT 1`, [userId,deviceId])).rows[0]);
}
export async function savePushToken(input: any): Promise<void> {
  await getPostgresPool().query(`INSERT INTO push_tokens(id,token,user_id,platform,token_type,device_name,country,language)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id,platform=EXCLUDED.platform,
    token_type=EXCLUDED.token_type,device_name=EXCLUDED.device_name,country=EXCLUDED.country,language=EXCLUDED.language,is_active=true,updated_at=now()`,
    [newId(),input.token,input.userId || null,input.platform,input.tokenType,input.deviceName || "",input.country || "",input.language || ""]);
}
export async function deactivatePushToken(token: string, userId: string | null): Promise<boolean> {
  return !!(await getPostgresPool().query("UPDATE push_tokens SET is_active=false,updated_at=now() WHERE token=$1 AND ($2::text IS NULL OR user_id=$2 OR user_id IS NULL) RETURNING id", [token,userId])).rowCount;
}
export async function getTvVersion(): Promise<any> { return shape((await getPostgresPool().query("SELECT * FROM tv_version_config WHERE singleton=true")).rows[0]); }
export async function saveTvVersion(input: any): Promise<void> {
  await getPostgresPool().query(`INSERT INTO tv_version_config(id,latest,minimum,release_notes,store_url) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(singleton) DO UPDATE SET latest=EXCLUDED.latest,minimum=EXCLUDED.minimum,release_notes=EXCLUDED.release_notes,store_url=EXCLUDED.store_url,updated_at=now()`,
    [newId(),JSON.stringify(input.latest),JSON.stringify(input.minimum || {}),JSON.stringify(input.releaseNotes || {}),JSON.stringify(input.storeUrl || {})]);
}
export async function recordTvTelemetry(input: any): Promise<void> {
  const day = new Date().toISOString().slice(0,10);
  const src = input.src || "remote", plat=input.plat || "other", version=input.v || "";
  await transaction(async (client) => {
    await client.query("INSERT INTO tv_telemetry(id,src,v,plat,app,did,country) VALUES($1,$2,$3,$4,$5,$6,$7)", [newId(),src,version,plat,input.app || null,input.did || null,input.country || null]);
    await client.query(`INSERT INTO tv_telemetry_daily(id,day,plat,src,v,count,unique_dids) VALUES($1,$2,$3,$4,$5,1,$6)
      ON CONFLICT(day,plat,src,v) DO UPDATE SET count=tv_telemetry_daily.count+1,
      unique_dids=ARRAY(SELECT DISTINCT unnest(tv_telemetry_daily.unique_dids || EXCLUDED.unique_dids)),updated_at=now()`,
      [newId(),day,plat,src,version,input.did ? [input.did] : []]);
  });
}
export async function listTvTelemetry(since: string): Promise<any[]> { return (await getPostgresPool().query("SELECT * FROM tv_telemetry_daily WHERE day>=$1 ORDER BY day DESC", [since])).rows.map(shape); }
export async function listSubscriptionPlans(activeOnly=false): Promise<any[]> { return (await getPostgresPool().query("SELECT * FROM stripe_subscription_plans WHERE ($1=false OR is_active=true) ORDER BY plan_id", [activeOnly])).rows.map(shape); }
export async function getSubscriptionPlan(planId: string): Promise<any> { return shape((await getPostgresPool().query("SELECT * FROM stripe_subscription_plans WHERE plan_id=$1 AND is_active=true", [planId])).rows[0]); }
export async function saveSubscriptionPlan(planId: string, patch: any, seedOnly=false): Promise<any> {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('subscription-plan'),hashtext($1))", [planId]);
    const old=shape((await client.query("SELECT * FROM stripe_subscription_plans WHERE plan_id=$1", [planId])).rows[0]);
    if (old && seedOnly) return old;
    const value={stripePriceId:"",paddlePriceId:null,label:"",description:"",currency:"usd",amount:0,isActive:true,...old,...patch};
    return shape((await client.query(`INSERT INTO stripe_subscription_plans(id,plan_id,stripe_price_id,paddle_price_id,label,description,currency,amount,is_active)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(plan_id) DO UPDATE SET stripe_price_id=EXCLUDED.stripe_price_id,paddle_price_id=EXCLUDED.paddle_price_id,
      label=EXCLUDED.label,description=EXCLUDED.description,currency=EXCLUDED.currency,amount=EXCLUDED.amount,is_active=EXCLUDED.is_active,updated_at=now() RETURNING *`,
      [old?._id || newId(),planId,value.stripePriceId,value.paddlePriceId,value.label,value.description,value.currency,value.amount,value.isActive])).rows[0]);
  });
}
export async function cleanupTvState(): Promise<void> {
  await getPostgresPool().query(`DELETE FROM tv_device_codes WHERE expires_at<now()-interval '1 day';
    DELETE FROM cast_sessions WHERE expires_at<=now(); DELETE FROM cast_commands WHERE created_at<now()-interval '1 day';
    DELETE FROM cast_events WHERE created_at<now()-interval '1 day'; DELETE FROM cast_connections WHERE expires_at<=now();
    DELETE FROM tv_telemetry WHERE ts<now()-interval '90 days';
    DELETE FROM tv_diagnostic_daily WHERE day<current_date-29`);
}
