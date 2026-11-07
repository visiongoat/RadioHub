import type { Request } from 'express';
import { pgInsertAuthEvent } from '../data/postgres-api-access-store';
import { logger } from '../utils/logger';

// 2026-05-13: structured + persistent auth-flow logging. Every step of every
// login attempt (Google OAuth, Apple Sign-In, email/password, mobile token
// flows) is funnelled through `logAuthEvent`. The helper does TWO things:
//   1) Prints a single-line structured record to stdout so it appears in the
//      Deployment live tail (✅ AUTH ... or ❌ AUTH ...).
//   2) Persists the same record to the `auth_event_logs` PostgreSQL table
//      asynchronously so it survives process restarts and page refreshes.
// Failures of the audit write are themselves logged but NEVER throw — auth
// must keep working even if the audit collection is unavailable.

export type AuthMethod =
  | 'google'
  | 'apple'
  | 'facebook'
  | 'email'
  | 'mobile-email'
  | 'mobile-apple'
  | 'mobile-google';

export interface AuthEventInput {
  method: AuthMethod;
  event: string;
  ok: boolean;
  email?: string | null;
  userId?: string | null;
  message?: string;
  detail?: any;
}

// Defensive redaction for the free-form `detail` field. Current call sites
// only pass things like HTTP status codes / Apple error bodies, but this
// guard protects future call sites from accidentally persisting tokens,
// passwords, JWTs, or other secrets into the audit collection.
const SECRET_KEY_RE = /pass(word)?|secret|token|jwt|cookie|authorization|bearer|client[_-]?secret|private[_-]?key|api[_-]?key/i;
const MAX_DETAIL_BYTES = 4_000;

function redactDetail(value: any, depth = 0): any {
  if (value == null) return value;
  if (depth > 4) return '[depth-cut]';
  if (typeof value === 'string') {
    return value.length > 500 ? value.slice(0, 500) + '…' : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redactDetail(v, depth + 1));
  const out: any = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = '[redacted]';
    } else {
      out[k] = redactDetail(v, depth + 1);
    }
  }
  try {
    if (JSON.stringify(out).length > MAX_DETAIL_BYTES) {
      return { _truncated: true, preview: JSON.stringify(out).slice(0, MAX_DETAIL_BYTES) };
    }
  } catch {
    return { _unserializable: true };
  }
  return out;
}

function getClientIp(req?: Request): string | undefined {
  if (!req) return undefined;
  const xff = (req.headers['x-forwarded-for'] || '') as string;
  const candidate =
    xff.split(',')[0].trim() ||
    req.ip ||
    (req.socket as any)?.remoteAddress ||
    '';
  return candidate ? String(candidate).slice(0, 64) : undefined;
}

export async function logAuthEvent(
  req: Request | undefined,
  input: AuthEventInput,
): Promise<void> {
  const ts = new Date();
  const ip = getClientIp(req);
  const userAgent = req?.headers['user-agent']?.toString().slice(0, 256);
  const tag = input.ok ? '✅ AUTH' : '❌ AUTH';
  try {
    logger.log(
      `${tag} method=${input.method} event=${input.event}` +
        (input.email ? ` email=${input.email}` : '') +
        (input.userId ? ` userId=${input.userId}` : '') +
        (ip ? ` ip=${ip}` : '') +
        (input.message ? ` msg="${String(input.message).slice(0, 200)}"` : ''),
    );
  } catch {
    /* never fail auth on logging */
  }
  setImmediate(() => {
    pgInsertAuthEvent({
      ts,
      method: input.method,
      event: input.event,
      ok: input.ok,
      email: input.email ? String(input.email).toLowerCase().slice(0, 256) : null,
      userId: input.userId || null,
      ip,
      userAgent,
      message: input.message ? String(input.message).slice(0, 500) : undefined,
      detail: input.detail !== undefined ? redactDetail(input.detail) : undefined,
    }).catch((err: any) => {
      logger.error('⚠️ logAuthEvent persist failed:', err?.message || err);
    });
  });
}
