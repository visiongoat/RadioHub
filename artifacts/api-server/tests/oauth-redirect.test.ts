import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  googleOAuthCallbackUrl, safeOAuthReturnTo, resolveGoogleOAuthReturnTo, buildRedirectWithToken,
  buildOAuthFailureRedirect, buildGoogleSessionRedirect,
} from '../src/auth/oauth-redirect';

const site = 'https://themegaradio.com';
const secret = 'test-only-signing-key';
const sign = (target: unknown) => {
  const payload = Buffer.from(JSON.stringify({ r: target })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 16)}`;
};

test('Google OAuth callback retains explicit configuration and frontend/default fallbacks', () => {
  assert.equal(googleOAuthCallbackUrl({}), `${site}/api/auth/google/callback`);
  assert.equal(googleOAuthCallbackUrl({ FRONTEND_URL: 'https://frontend.example' }), 'https://frontend.example/api/auth/google/callback');
  assert.equal(googleOAuthCallbackUrl({ FRONTEND_URL: 'http://localhost:22507' }), 'http://localhost:22507/api/auth/google/callback');
  assert.equal(googleOAuthCallbackUrl({
    FRONTEND_URL: 'https://frontend.example', GOOGLE_CALLBACK_URL: 'https://api.example/api/auth/google/callback',
  }), 'https://api.example/api/auth/google/callback');
});

test('successful TV redirects keep the localized route, six-digit code, query and fragment', () => {
  for (const base of [site, '']) {
    const result = buildRedirectWithToken(base, '/de/tv?code=123456&ref=phone#connect', 'test-token');
    const url = new URL(result, site);
    assert.equal(url.origin, site);
    assert.equal(url.pathname, '/de/tv');
    assert.equal(url.searchParams.get('code'), '123456');
    assert.equal(url.searchParams.get('ref'), 'phone');
    assert.equal(url.searchParams.get('auth_token'), 'test-token');
    assert.equal(url.hash, '#connect');
    assert.equal(result.startsWith('/'), !base);
  }
});

test('untrusted return paths can never receive a token on another origin', () => {
  for (const target of [
    undefined, null, {}, ['//outside.example'], '', 'https://outside.example', 'javascript:alert(1)',
    '//outside.example', '/\\outside.example', '/\t/outside.example', '/\n/outside.example',
    '/%5Coutside.example', '/%2foutside.example', '/%2F%2Foutside.example',
    '/en/%00tv', '/en/%0atv', '/en/%7ftv', '/en/tv\u0000', '/%broken',
    '/%2e%2e//outside.example', '/' + 'a'.repeat(2048),
  ]) {
    assert.equal(safeOAuthReturnTo(target), undefined, JSON.stringify(target));
    const url = new URL(buildRedirectWithToken(site, target, 'test-token'));
    assert.equal(url.origin, site);
    assert.equal(url.pathname, '/');
    assert.equal(url.searchParams.get('auth_token'), 'test-token');
  }
  assert.equal(safeOAuthReturnTo('/tr/tv?code=123456&label=a%20b#devam'), '/tr/tv?code=123456&label=a%20b#devam');
  assert.equal(safeOAuthReturnTo('/en/../de/tv?code=123456'), '/de/tv?code=123456');
  assert.equal(safeOAuthReturnTo('/de/tv?returnTo=https%3A%2F%2Foutside.example'), '/de/tv?returnTo=https%3A%2F%2Foutside.example');
});

test('Google cancellation recovers only authenticated state when its session is absent', () => {
  const path = '/tr/tv?code=654321';
  assert.equal(resolveGoogleOAuthReturnTo(undefined, sign(path), secret), path);
  assert.equal(resolveGoogleOAuthReturnTo('/de/tv?code=123456', sign(path), secret), '/de/tv?code=123456');
  assert.equal(resolveGoogleOAuthReturnTo(undefined, sign(path), 'wrong-secret'), undefined);
  assert.equal(resolveGoogleOAuthReturnTo(undefined, sign(path) + '.extra', secret), undefined);
  assert.equal(resolveGoogleOAuthReturnTo(undefined, sign('/\\outside.example'), secret), undefined);
  assert.equal(resolveGoogleOAuthReturnTo(undefined, [sign(path)], secret), undefined);
  assert.equal(resolveGoogleOAuthReturnTo(undefined, 'unsigned', secret), undefined);
});

test('TV OAuth errors and cancellation lead to a retryable login and preserve pairing state', () => {
  for (const error of ['google_auth_cancelled', 'google_auth_failed', 'apple_auth_failed', 'login_failed']) {
    for (const path of ['/en/tv?code=123456', '/de/tv?code=654321#connect', '/tv?code=222222']) {
      const url = new URL(buildOAuthFailureRedirect(site, path, 'tr', error));
      const expectedLanguage = path.startsWith('/en/') ? 'en' : path.startsWith('/de/') ? 'de' : 'tr';
      assert.equal(url.pathname, `/${expectedLanguage}/login`);
      assert.equal(url.searchParams.get('returnTo'), path);
      assert.equal(url.searchParams.get('error'), error);
      assert.equal(url.searchParams.has('auth_token'), false);
    }
  }
  assert.equal(new URL(buildOAuthFailureRedirect(site, '/tv', '', 'google_auth_cancelled')).pathname, '/en/login');
});

test('non-TV failures retain the existing homepage behavior and reject an untrusted locale', () => {
  assert.equal(buildOAuthFailureRedirect('', '/de/profile', 'de', 'google_auth_failed'), '/de/?error=google_auth_failed');
  assert.equal(buildOAuthFailureRedirect('', '/\\outside.example', '//outside.example', 'apple_auth_failed'), '/?error=apple_auth_failed');
  assert.equal(buildOAuthFailureRedirect('', '/xx/tv', '', 'google_auth_failed'), '/?error=google_auth_failed');
});

test('the Google cookie-session fallback also returns to the TV code instead of a blocked homepage', () => {
  const url = new URL(buildGoogleSessionRedirect(site, '/fr/tv?code=123456', 'fr'));
  assert.equal(url.pathname, '/fr/tv');
  assert.equal(url.searchParams.get('code'), '123456');
  assert.equal(url.searchParams.get('success'), 'google_login');
  assert.equal(url.searchParams.has('auth_token'), false);
  assert.equal(buildGoogleSessionRedirect('', undefined, 'de'), '/de/?success=google_login');
});
