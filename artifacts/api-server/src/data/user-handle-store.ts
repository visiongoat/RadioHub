import type pg from 'pg';
import { getPostgresPool } from '../postgres-runtime';
import { isLegacyGeneratedHandle, userHandleBase, userHandleCandidate } from '../utils/user-handle';

/** Every handle writer takes this lock before a user row lock, including custom handles. */
export async function lockUserHandles(client: pg.PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('public-user-handles:v1',0))");
}

/** Retired automatic handles are server-managed and never supplied by a profile edit. */
export function retiredUserHandleAliases(source: Record<string, any> | null, username: string): string[] {
  const aliases = Array.isArray(source?.profileAliases) ? source.profileAliases.filter(isLegacyGeneratedHandle) : [];
  return [...new Set([...aliases, username])];
}

export async function userHandleTaken(client: pg.PoolClient, candidate: string, id: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM users WHERE id<>$2 AND
    (lower(username)=lower($1) OR lower(slug)=lower($1) OR lower(id)=lower($1)
      OR COALESCE(source->'profileAliases','[]'::jsonb) ? lower($1)) LIMIT 1`, [candidate, id]);
  return !!result.rowCount;
}

export async function allocateUserHandle(client: pg.PoolClient, fullName: unknown, id: string): Promise<string> {
  const base = userHandleBase(fullName);
  for (let attempt = 0; attempt < 1000000; attempt++) {
    const candidate = userHandleCandidate(base, attempt === 0 ? 0 : attempt + 1);
    if (!await userHandleTaken(client, candidate, id)) return candidate;
  }
  throw new Error('Unable to allocate a public user handle');
}

/** Call only after indexed ID/slug/username lookup misses. Legacy aliases are server managed. */
export async function resolveLegacyUserHandle(value: string): Promise<string | null> {
  if (!isLegacyGeneratedHandle(value)) return null;
  const result = await getPostgresPool().query<{ id: string }>(
    "SELECT id FROM users WHERE COALESCE(source->'profileAliases','[]'::jsonb) ? $1 ORDER BY id LIMIT 1", [value],
  );
  return result.rows[0]?.id ?? null;
}
