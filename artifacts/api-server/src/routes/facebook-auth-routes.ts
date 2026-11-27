import { randomBytes, createHmac } from 'node:crypto';
import type { Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pgFindUserByIdentity, pgFindUserById, pgCreateUser, pgUpdateUser, newPublicUserId } from '../data/postgres-user-store';
import { createFacebookState, consumeFacebookState, createFacebookMobileHandoff, consumeFacebookMobileHandoff } from '../data/facebook-oauth-store';
import { publicUserIdentity } from '../utils/public-user-identity';
import { safeOAuthReturnTo, buildOAuthFailureRedirect, buildGoogleSessionRedirect } from '../auth/oauth-redirect';
import { FACEBOOK_MOBILE_REDIRECT, facebookCallbackUrl, facebookProof, facebookVerifier, validFacebookState } from '../auth/facebook-oauth-policy';
import { desktopOAuthFailure, finishDesktopOAuth, isDesktopOAuthReturn, readDesktopOAuth } from './desktop-auth-routes';

const graph = () => `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION || 'v24.0'}`;

async function graphJson(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  const value = await response.json() as any;
  if (!response.ok || value.error) throw new Error('facebook_provider_error');
  return value;
}

/** A matching email alone never authorizes attaching a new provider identity. */
async function facebookUser(profile: any) {
  if (typeof profile.id !== 'string' || !/^\d{1,40}$/.test(profile.id)) throw new Error('facebook_profile_invalid');
  let user = await pgFindUserByIdentity({ facebookId: profile.id });
  if (user) {
    if (user.status !== 'active' || user.isActive === false) throw new Error('account_inactive');
    return await pgUpdateUser(user._id, { lastLoginAt: new Date() });
  }
  const email = typeof profile.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
    ? profile.email.toLowerCase() : `facebook-${profile.id}@oauth.invalid`;
  if (await pgFindUserByIdentity({ email })) throw new Error('facebook_account_link_required');
  const id = newPublicUserId();
  const avatar = profile.picture?.data?.url;
  user = await pgCreateUser({
    id, email, username: `fb_${id}`,
    fullName: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim().slice(0, 200) : 'Listener',
    facebookId: profile.id, emailVerified: false, status: 'active', role: 'user',
    ...(typeof avatar === 'string' && avatar.startsWith('https://') ? { avatar } : {}),
    lastLoginAt: new Date(),
  });
  return user;
}

export function registerFacebookAuthRoutes(app: Express, deps: { generateAuthToken: (id: string, type: any) => Promise<string> }) {
  const limiter = rateLimit({ windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const noStore = (_req: any, res: any, next: any) => {
    res.set({ 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer' });
    next();
  };
  app.get('/api/auth/facebook', limiter, noStore, async (req: any, res) => {
    if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
      return void res.status(503).json({ error: 'Facebook authentication not configured' });
    }
    const mobile = req.query.platform === 'mobile';
    if (mobile && !facebookProof(req.query.code_challenge)) return void res.status(400).json({ error: 'Invalid code challenge' });
    if (!req.session) return void res.status(503).json({ error: 'Session unavailable' });
    const state = randomBytes(32).toString('hex');
    req.session.facebookOAuth = {
      state, started: Date.now(), returnTo: safeOAuthReturnTo(req.query.returnTo),
      challenge: mobile ? req.query.code_challenge : null,
    };
    try {
      await createFacebookState(state);
      await new Promise<void>((resolve, reject) => req.session.save((err: any) => err ? reject(err) : resolve()));
    } catch {
      delete req.session.facebookOAuth;
      return void res.status(503).json({ error: 'Facebook sign-in unavailable. Please try again.' });
    }
    const url = new URL(`https://www.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION || 'v24.0'}/dialog/oauth`);
    for (const [key, value] of Object.entries({
      client_id: process.env.FACEBOOK_APP_ID, redirect_uri: facebookCallbackUrl(),
      scope: 'public_profile,email', response_type: 'code', state,
    })) url.searchParams.set(key, value);
    res.redirect(url.href);
  });

  app.get('/api/auth/facebook/callback', limiter, noStore, async (req: any, res) => {
    const flow = req.session?.facebookOAuth;
    // Cancellation requires the same session-bound state as success.
    if (!flow || !validFacebookState(flow.state, req.query.state, flow.started)) {
      return void res.status(400).send('Facebook sign-in expired. Please start again.');
    }
    delete req.session.facebookOAuth;
    const frontend = process.env.FRONTEND_URL || 'https://themegaradio.com';
    const desktop = !flow.challenge && readDesktopOAuth(req, 'facebook', flow.returnTo);
    if (!flow.challenge && isDesktopOAuthReturn(flow.returnTo) && !desktop) {
      return void res.status(400).send('Desktop sign-in expired. Please try again.');
    }
    const failure = (error: string) => desktop
      ? desktopOAuthFailure(req, res, desktop)
      : res.redirect(flow.challenge
        ? `${FACEBOOK_MOBILE_REDIRECT}?error=${encodeURIComponent(error)}`
        : buildOAuthFailureRedirect(frontend, flow.returnTo, '', error));
    try {
      // SQL consumption also prevents parallel callbacks on separate API replicas.
      if (!await consumeFacebookState(flow.state)) return void res.status(400).send('Facebook sign-in expired. Please start again.');
      await new Promise<void>((resolve, reject) => req.session.save((err: any) => err ? reject(err) : resolve()));
      if (req.query.error) return void failure('facebook_cancelled');
      if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) return void failure('facebook_auth_failed');
      const credentials = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID!, client_secret: process.env.FACEBOOK_APP_SECRET!,
        redirect_uri: facebookCallbackUrl(), code: req.query.code,
      });
      const exchanged = await graphJson(`${graph()}/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: credentials,
      });
      if (typeof exchanged.access_token !== 'string' || !exchanged.access_token) throw new Error('facebook_provider_error');
      const proof = createHmac('sha256', process.env.FACEBOOK_APP_SECRET!).update(exchanged.access_token).digest('hex');
      const profile = await graphJson(`${graph()}/me?fields=id,name,email,picture.type(large)&appsecret_proof=${proof}`, {
        headers: { Authorization: `Bearer ${exchanged.access_token}` },
      });
      const user = await facebookUser(profile);
      if (desktop) return void await finishDesktopOAuth(req, res, desktop, user._id);
      if (flow.challenge) {
        const code = randomBytes(32).toString('base64url');
        await createFacebookMobileHandoff(code, user._id, flow.challenge);
        return void res.redirect(`${FACEBOOK_MOBILE_REDIRECT}?code=${code}`);
      }
      await new Promise<void>((resolve, reject) => req.login(user, (err: any) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => req.session.save((err: any) => err ? reject(err) : resolve()));
      res.redirect(buildGoogleSessionRedirect(frontend, flow.returnTo, '').replace('success=google_login', 'success=facebook_login'));
    } catch (error: any) {
      failure(['facebook_account_link_required', 'account_inactive'].includes(error?.message) ? error.message : 'facebook_auth_failed');
    }
  });

  app.post('/api/auth/facebook/exchange', limiter, noStore, async (req, res) => {
    if (!facebookProof(req.body?.code) || !facebookVerifier(req.body?.codeVerifier)) return void res.status(400).json({ error: 'Invalid sign-in code' });
    try {
      const userId = await consumeFacebookMobileHandoff(req.body.code, req.body.codeVerifier);
      const user = userId && await pgFindUserById(userId);
      if (!user || user.status !== 'active' || user.isActive === false) return void res.status(401).json({ error: 'Sign-in expired. Please try again.' });
      const token = await deps.generateAuthToken(user._id, 'mobile');
      res.json({ success: true, token, user: { _id: user._id, ...publicUserIdentity(user), email: user.email, role: user.role, slug: user.slug } });
    } catch {
      res.status(503).json({ error: 'Facebook sign-in unavailable. Please try again.' });
    }
  });
}
