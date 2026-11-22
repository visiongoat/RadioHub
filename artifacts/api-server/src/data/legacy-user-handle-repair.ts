import { setTimeout as pause } from 'node:timers/promises';
import { getPostgresPool } from '../postgres-runtime';
import { isLegacyGeneratedHandle, needsGeneratedHandle } from '../utils/user-handle';
import { allocateUserHandle, lockUserHandles, retiredUserHandleAliases } from './user-handle-store';

export interface LegacyHandleRepairSummary {
  mode: 'dry-run' | 'apply';
  scanned: number;
  matched: number;
  eligible: number;
  changed: number;
  unproven: number;
  alreadyRepaired: number;
}

interface HandleProofRow {
  id: string;
  username: string;
  email: string;
  created_at: Date;
}

/** Revalidate after both locks; an intervening custom edit must never be overwritten. */
export async function repairLegacyUserHandle(id: string): Promise<boolean> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    await lockUserHandles(client);
    const { rows } = await client.query<HandleProofRow & { full_name: string; profile_aliases: unknown }>(`SELECT id,username,email,full_name,created_at,source->'profileAliases' AS profile_aliases FROM users WHERE id=$1 FOR UPDATE`, [id]);
    const user = rows[0];
    if (!user || !isLegacyGeneratedHandle(user.username) || !needsGeneratedHandle(user.username, user)) {
      await client.query('COMMIT');
      return false;
    }
    const username = await allocateUserHandle(client, user.full_name, user.id);
    const aliases = retiredUserHandleAliases({ profileAliases: user.profile_aliases }, user.username);
    // IDs, canonical/old slugs, email, role, status, privacy and all other source fields stay intact.
    await client.query(`UPDATE users SET username=$2,
      source=jsonb_set(jsonb_set(source,'{username}',to_jsonb($2::text),true),'{profileAliases}',$3::jsonb,true),
      updated_at=now() WHERE id=$1`, [user.id, username, JSON.stringify(aliases)]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

/** Bounded keyset scan of every account; no account identifiers are emitted by progress reports. */
export async function repairLegacyUserHandles(options: {
  apply?: boolean;
  batchSize?: number;
  pauseMs?: number;
  onProgress?: (summary: LegacyHandleRepairSummary) => void;
} = {}): Promise<LegacyHandleRepairSummary> {
  const batchSize = options.batchSize ?? 100;
  const pauseMs = options.pauseMs ?? 25;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500
    || !Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 1000) throw new Error('INVALID_REPAIR_OPTIONS');
  const summary: LegacyHandleRepairSummary = {
    mode: options.apply ? 'apply' : 'dry-run', scanned: 0, matched: 0, eligible: 0,
    changed: 0, unproven: 0, alreadyRepaired: 0,
  };
  let cursor: string | null = null;
  for (;;) {
    const { rows }: { rows: HandleProofRow[] } = await getPostgresPool().query<HandleProofRow>(`SELECT id,username,email,created_at FROM users
      WHERE ($1::text IS NULL OR id>$1) ORDER BY id LIMIT $2`, [cursor, batchSize]);
    if (!rows.length) return summary;
    for (const user of rows) {
      summary.scanned++;
      if (!isLegacyGeneratedHandle(user.username)) continue;
      summary.matched++;
      if (!needsGeneratedHandle(user.username, user)) { summary.unproven++; continue; }
      summary.eligible++;
      if (!options.apply) continue;
      if (await repairLegacyUserHandle(user.id)) summary.changed++;
      else summary.alreadyRepaired++;
      if (pauseMs) await pause(pauseMs);
    }
    cursor = rows.at(-1)!.id;
    options.onProgress?.({ ...summary });
  }
}
