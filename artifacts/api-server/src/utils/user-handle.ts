import { transliterate } from 'transliteration';

export const USER_HANDLE_MAX_LENGTH = 30;

/** Only formats produced by our former OAuth allocators; never guess from an email prefix. */
export function isLegacyGeneratedHandle(value: unknown): boolean {
  return typeof value === 'string' && /^(?:user_\d{13}_[a-z0-9]{1,9}|fb_[a-f0-9]{24})$/.test(value);
}

export function needsGeneratedHandle(value: unknown): boolean {
  return typeof value !== 'string' || !value.trim() || isLegacyGeneratedHandle(value);
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
