import { createHash, randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { getSocialAuthStatus } from '../auth/social-auth-simple';
import { getPostgresPool } from '../postgres-runtime';
import { pgFindUserById } from '../data/postgres-user-store';
import { publicUserIdentity } from '../utils/public-user-identity';

const proof = /^[A-Za-z0-9_-]{43}$/;
const verifier = /^[A-Za-z0-9._~-]{43,128}$/;
const markerPrefix = '/desktop-oauth/';
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
type Provider = 'google' | 'facebook' | 'apple';
type RouteSession = Request['session'] & { desktopOAuth?: DesktopOAuth; oauthReturnTo?: string; oauthReturnLang?: string };
type DesktopOAuth = {
  marker: string;
  provider: Provider;
  callback: string;
  state: string;
  challenge: string;
  expiresAt: number;
};

function isProof(value: unknown): value is string {
  return typeof value === 'string' && proof.test(value);
}

function allowedCallback(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/(desktop-auth\/callback|desktop\.html)$/.exec(value);
  if (!match || Number(match[1]) > 65535 || Number(match[1]) < 1024) return null;
  if (match[2] === 'desktop.html' && match[1] !== '22517') return null;
  return value;
}

function callbackHeaders(res: Response) {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
}

export function isDesktopOAuthReturn(returnTo: string | undefined) {
  return Boolean(returnTo?.startsWith(markerPrefix));
}

export function readDesktopOAuth(req: Request, provider: Provider, returnTo: string | undefined) {
  const flow = (req.session as RouteSession)?.desktopOAuth;
  return flow?.marker === returnTo && flow?.provider === provider && flow.expiresAt > Date.now()
    ? flow : undefined;
}

function callbackUrl(flow: DesktopOAuth, code?: string) {
  const url = new URL(flow.callback);
  const params = new URLSearchParams({
    desktop_state: flow.state,
    ...(code ? { desktop_code: code } : { desktop_error: 'sign_in_failed' }),
  });
  // The preview returns to the browser origin without putting the code in HTTP logs.
  if (url.pathname === '/desktop.html') url.hash = params.toString();
  else url.search = params.toString();
  return url.href;
}

function clearDesktopOAuth(req: Request, flow: DesktopOAuth) {
  const session = req.session as RouteSession;
  if (session?.desktopOAuth?.marker === flow.marker) delete session.desktopOAuth;
  if (session?.oauthReturnTo === flow.marker) {
    delete session.oauthReturnTo;
    delete session.oauthReturnLang;
  }
}

export function desktopOAuthFailure(req: Request, res: Response, flow: DesktopOAuth) {
  clearDesktopOAuth(req, flow);
  callbackHeaders(res);
  res.redirect(303, callbackUrl(flow));
}

export async function finishDesktopOAuth(req: Request, res: Response, flow: DesktopOAuth, userId: string) {
  callbackHeaders(res);
  clearDesktopOAuth(req, flow);
  try {
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    const code = randomBytes(32).toString('base64url');
    const db = getPostgresPool();
    await db.query('DELETE FROM oauth_mobile_handoffs WHERE expires_at<=now()');
    await db.query(
      "INSERT INTO oauth_mobile_handoffs(code_hash,user_id,challenge,expires_at) VALUES($1,$2,$3,now()+interval '90 seconds')",
      [digest('desktop:' + code), userId, flow.challenge],
    );
    res.redirect(303, callbackUrl(flow, code));
  } catch {
    desktopOAuthFailure(req, res, flow);
  }
}

export function registerDesktopAuthRoutes(app: Express, generateAuthToken: (id: string, type: 'desktop', name: string) => Promise<string>) {
  const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
  app.get('/api/auth/desktop/status', (_req, res) => {
    callbackHeaders(res);
    res.json(getSocialAuthStatus());
  });
  app.get('/api/auth/desktop/start', limiter, (req, res) => {
    callbackHeaders(res);
    const { provider, redirect_uri, state, code_challenge } = req.query;
    const callback = allowedCallback(redirect_uri);
    if ((provider !== 'google' && provider !== 'apple' && provider !== 'facebook') ||
        !callback || !isProof(state) || !isProof(code_challenge)) {
      return void res.status(400).send('Invalid desktop sign-in request.');
    }
    if (!req.session) return void res.status(503).send('Sign-in unavailable. Please try again.');

    const flow: DesktopOAuth = {
      provider, callback, state, challenge: code_challenge,
      marker: markerPrefix + randomBytes(32).toString('base64url'),
      expiresAt: Date.now() + 5 * 60_000,
    };
    if (!getSocialAuthStatus()[provider]) return desktopOAuthFailure(req, res, flow);
    (req.session as RouteSession).desktopOAuth = flow;
    req.session.save(error => {
      if (error) return desktopOAuthFailure(req, res, flow);
      res.redirect(303, '/api/auth/' + provider + '?returnTo=' + encodeURIComponent(flow.marker));
    });
  });

  app.post('/api/auth/desktop/exchange', limiter, async (req, res) => {
    callbackHeaders(res);
    const { code, codeVerifier } = req.body || {};
    if (!isProof(code) || typeof codeVerifier !== 'string' || !verifier.test(codeVerifier)) {
      return void res.status(400).json({ error: 'Invalid sign-in code.' });
    }
    try {
      const result = await getPostgresPool().query(
        'DELETE FROM oauth_mobile_handoffs WHERE code_hash=$1 AND challenge=$2 AND expires_at>now() RETURNING user_id',
        [digest('desktop:' + code), digest(codeVerifier)],
      );
      const user = result.rows[0] && await pgFindUserById(result.rows[0].user_id);
      if (!user || user.status !== 'active' || user.isActive === false) {
        return void res.status(401).json({ error: 'Sign-in expired. Please try again.' });
      }
      const token = await generateAuthToken(user._id, 'desktop', 'MegaRadio Desktop');
      res.json({ token, user: { _id: user._id, ...publicUserIdentity(user), email: user.email } });
    } catch {
      res.status(503).json({ error: 'Sign-in unavailable. Please try again.' });
    }
  });
}
