import { createHmac, timingSafeEqual } from 'node:crypto';
import { SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';

const referenceOrigin = 'https://oauth-return.invalid';
const languages = new Set(SEO_LANGUAGES.filter(language => language.enabled).map(language => language.code));

export function googleOAuthCallbackUrl(env: { GOOGLE_CALLBACK_URL?: string; FRONTEND_URL?: string } = process.env): string {
  return env.GOOGLE_CALLBACK_URL || `${env.FRONTEND_URL || 'https://themegaradio.com'}/api/auth/google/callback`;
}

/** Never attach an authentication token to an untrusted or ambiguous origin. */
export function safeOAuthReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 2048 || !value.startsWith('/')
    || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value, referenceOrigin);
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.origin !== referenceOrigin || decodedPath.startsWith('//')
      || /[\\\u0000-\u0020\u007f]/.test(decodedPath)) return undefined;
    return url.pathname + url.search + url.hash;
  } catch { return undefined; }
}

/** Recover the existing signed Google return path even if its session cookie is lost. */
export function resolveGoogleOAuthReturnTo(sessionPath: unknown, state: unknown, secret: string): string | undefined {
  const sessionReturn = safeOAuthReturnTo(sessionPath);
  if (sessionReturn) return sessionReturn;
  if (typeof state !== 'string' || state.length > 4096) return undefined;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{16})$/.exec(state);
  if (!match) return undefined;
  const [, payload, signature] = match;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 16);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined;
  try { return safeOAuthReturnTo(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.r); }
  catch { return undefined; }
}

function destination(frontendBase: string, returnTo: unknown): URL {
  return new URL(safeOAuthReturnTo(returnTo) || '/', frontendBase || referenceOrigin);
}
function output(url: URL, frontendBase: string): string {
  return frontendBase ? url.toString() : url.pathname + url.search + url.hash;
}

export function buildRedirectWithToken(frontendBase: string, returnTo: unknown, token: string): string {
  const url = destination(frontendBase, returnTo);
  url.searchParams.set('auth_token', token);
  return output(url, frontendBase);
}

/** Keep a cancelled/failed TV sign-in on a reachable login page with its code intact. */
export function buildOAuthFailureRedirect(frontendBase: string, returnTo: unknown, savedLanguage: unknown, error: string): string {
  const target = safeOAuthReturnTo(returnTo);
  const savedLang = typeof savedLanguage === 'string' && languages.has(savedLanguage) ? savedLanguage : '';
  const tvPath = target && /^\/(?:([a-z]{2})\/)?tv\/?$/.exec(new URL(target, referenceOrigin).pathname);
  const tvLanguage = tvPath && (!tvPath[1] || languages.has(tvPath[1]))
    ? tvPath[1] || savedLang || 'en' : undefined;
  const url = destination(frontendBase, tvLanguage ? `/${tvLanguage}/login` : savedLang ? `/${savedLang}/` : '/');
  url.searchParams.set('error', error);
  if (tvLanguage && target) url.searchParams.set('returnTo', target);
  return output(url, frontendBase);
}

export function buildGoogleSessionRedirect(frontendBase: string, returnTo: unknown, savedLanguage: unknown): string {
  const savedLang = typeof savedLanguage === 'string' && languages.has(savedLanguage) ? savedLanguage : '';
  const url = destination(frontendBase, safeOAuthReturnTo(returnTo) || (savedLang ? `/${savedLang}/` : '/'));
  url.searchParams.set('success', 'google_login');
  return output(url, frontendBase);
}
