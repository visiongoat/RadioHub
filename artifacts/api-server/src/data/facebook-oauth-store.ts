import { getPostgresPool } from '../postgres-runtime';
import { facebookHash } from '../auth/facebook-oauth-policy';

export async function createFacebookState(state: string): Promise<void> {
  const db = getPostgresPool();
  await db.query('DELETE FROM facebook_oauth_states WHERE expires_at<=now()');
  await db.query("INSERT INTO facebook_oauth_states(state_hash,expires_at) VALUES($1,now()+interval '10 minutes')", [facebookHash(state)]);
}

/** Session validation precedes this cross-replica, single-use claim. */
export async function consumeFacebookState(state: string): Promise<boolean> {
  const result = await getPostgresPool().query('DELETE FROM facebook_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash', [facebookHash(state)]);
  return result.rows.length === 1;
}

export async function createFacebookMobileHandoff(code: string, userId: string, challenge: string): Promise<void> {
  const db = getPostgresPool();
  await db.query('DELETE FROM oauth_mobile_handoffs WHERE expires_at<=now()');
  await db.query("INSERT INTO oauth_mobile_handoffs(code_hash,user_id,challenge,expires_at) VALUES($1,$2,$3,now()+interval '90 seconds')", [facebookHash(code), userId, challenge]);
}

/** A wrong verifier cannot burn a legitimate code; concurrent requests have one winner. */
export async function consumeFacebookMobileHandoff(code: string, verifier: string): Promise<string | undefined> {
  const result = await getPostgresPool().query<{ user_id: string }>('DELETE FROM oauth_mobile_handoffs WHERE code_hash=$1 AND challenge=$2 AND expires_at>now() RETURNING user_id', [facebookHash(code), facebookHash(verifier)]);
  return result.rows[0]?.user_id;
}
