import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mobileAppLinkPaths } from '../src/seo/mobile-app-links';

test('associations preserve legacy paths and include localized and plural routes', () => {
  const paths = mobileAppLinkPaths();
  for (const path of ['/station/*', '/*/station/*', '/en/stations/*', '/de/sender/*', '/de/benutzer/*', '/tr/turler/*']) assert.ok(paths.includes(path), path);
  assert.ok(!paths.includes('/*'));
  assert.equal(new Set(paths).size, paths.length);
});
test('associations do not capture unrelated web or administrative routes', () => {
  const paths = mobileAppLinkPaths();
  assert.ok(!paths.includes('/de/*/*'));
  assert.ok(!paths.some(path => /admin|auth|checkout|login/.test(path)));
  assert.ok(paths.includes('/zh/%E7%94%B5%E5%8F%B0/*'));
});

test('TV confirmation is claimed without claiming OAuth or unrelated login routes',()=>{
 const paths=mobileAppLinkPaths();
 for(const path of ['/tv','/tr/tv','/de/tv','/en/tv'])assert.ok(paths.includes(path));
 assert.ok(!paths.includes('/tv/*'));assert.ok(!paths.includes('/api/auth/*'));
});

test('Premium continuation claims exact localized paths without intercepting payment callbacks',()=>{
 const paths=mobileAppLinkPaths();for(const path of ['/activate','/tr/activate','/de/activate','/en/activate'])assert.ok(paths.includes(path));
 for(const path of ['/activate/*','/activate/success','/checkout','/api/subscription/*'])assert.ok(!paths.includes(path));
});
