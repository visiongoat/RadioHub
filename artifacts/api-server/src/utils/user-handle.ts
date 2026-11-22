import { transliterate } from 'transliteration';

export const USER_HANDLE_MAX_LENGTH = 30;

function legacyNativeHandle(value: unknown): { base: string; timestamp: number } | null {
  if (typeof value !== 'string') return null;
  // Former native mobileRegister: first 16 sanitized email characters + base36
  // milliseconds + four random characters (native commit 1d91f02a, authService.ts).
  const match = /^([a-z0-9_]{1,16})_([a-z0-9]{8})([a-z0-9]{4})$/.exec(value);
  if (!match) return null;
  const timestamp = Number.parseInt(match[2], 36);
  return timestamp.toString(36) === match[2] ? { base: match[1], timestamp } : null;
}

/** Recognizable alias shapes; email-derived handles need account proof before replacement. */
export function isLegacyGeneratedHandle(value: unknown): boolean {
  return typeof value === 'string' && (/^(?:user_\d{13}_[a-z0-9]{1,9}|fb_[a-f0-9]{24})$/.test(value) || !!legacyNativeHandle(value));
}

export function needsGeneratedHandle(value: unknown, account?: { email?: unknown; createdAt?: unknown; created_at?: unknown }): boolean {
  if (typeof value !== 'string' || !value.trim()) return true;
  if (/^(?:user_\d{13}_[a-z0-9]{1,9}|fb_[a-f0-9]{24})$/.test(value)) return true;
  const native = legacyNativeHandle(value);
  if (!native || typeof account?.email !== 'string' || !account.email.includes('@')) return false;
  const base = account.email.trim().toLowerCase().split('@')[0].replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
  const created = account.createdAt ?? account.created_at;
  const createdAt = created instanceof Date ? created.getTime()
    : typeof created === 'string' || typeof created === 'number' ? new Date(created).getTime() : NaN;
  // Matching length/suffix alone is not proof that a custom username was generated.
  return native.base === base && Number.isFinite(createdAt) && Math.abs(native.timestamp - createdAt) <= 10 * 60 * 1000;
}

/** Public names only: a private email address is never a handle fallback. */
export function userHandleBase(fullName: unknown): string {
  const name = typeof fullName === 'string' && !isLegacyGeneratedHandle(fullName.trim()) ? fullName : '';
  const normalized = transliterate(name).toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, USER_HANDLE_MAX_LENGTH).replace(/_+$/g, '');
  return normalized.length >= 3 ? normalized : normalized ? `${normalized}_listener` : 'listener';
}

export function userHandleCandidate(base: string, suffix: number): string {
  const ending = suffix ? `_${suffix}` : '';
  return base.slice(0, USER_HANDLE_MAX_LENGTH - ending.length).replace(/_+$/g, '') + ending;
}

export function normalizePublicUserSearch(value: string): string {
  return value.trim().replace(/^@+/, '').slice(0, 100).toLocaleLowerCase('en')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/\s+/g, ' ');
}
