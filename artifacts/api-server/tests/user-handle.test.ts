import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLegacyGeneratedHandle, needsGeneratedHandle, normalizePublicUserSearch, userHandleBase, userHandleCandidate } from '../src/utils/user-handle';

test('public names become bounded readable ASCII handles, preserving name order and never exposing email', () => {
  assert.equal(userHandleBase(' Şahin Yoğurtcu '), 'sahin_yogurtcu');
  assert.equal(userHandleBase('Çağrı İŞIK'), 'cagri_isik');
  assert.equal(userHandleBase('Zoë Müller'), 'zoe_muller');
  assert.equal(userHandleBase('李 小龍'), 'li_xiao_long');
  assert.equal(userHandleBase(''), 'listener');
  assert.equal(userHandleBase('A'), 'a_listener');
  assert.equal(userHandleBase('user_1755000000000_abc123456'), 'listener');
  const candidate = userHandleCandidate(userHandleBase('A'.repeat(40)), 123);
  assert.equal(candidate.length, 30);
  assert.ok(candidate.endsWith('_123'));
});

test('only proven former OAuth handles and missing handles are replaced', () => {
  for (const value of ['user_1755000000000_abc123456', 'fb_507f1f77bcf86cd799439011']) assert.equal(isLegacyGeneratedHandle(value), true);
  for (const value of ['user_123', 'user_1755000000000_personalname', 'alice_m4xyz123', 'sahin815', 'my.custom-name']) {
    assert.equal(isLegacyGeneratedHandle(value), false);
    assert.equal(needsGeneratedHandle(value), false);
  }
  for (const value of [undefined, null, '', '   ']) assert.equal(needsGeneratedHandle(value), true);
});

test('directory search accepts an @handle, preserves literal punctuation and folds Turkish accents', () => {
  assert.equal(normalizePublicUserSearch(' @ŞAHİN_YOĞURTCU '), 'sahin_yogurtcu');
  assert.equal(normalizePublicUserSearch('  YOĞURTCU   ŞAHİN '), 'yogurtcu sahin');
  assert.equal(normalizePublicUserSearch('@100%_real'), '100%_real');
});

test('former native email handles require the recorded email base and registration timestamp, never only length', () => {
  // Exact former mobileRegister algorithm from native commit 1d91f02a.
  const email = 'YogurtcuSahin5me+private@example.invalid';
  const createdAt = new Date('2026-10-13T20:10:35.322Z');
  const base = email.trim().toLowerCase().split('@')[0].replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
  const old = `${base}_${createdAt.getTime().toString(36)}v2w7`;
  assert.equal(old, 'yogurtcusahin5me_mv748druv2w7');
  assert.equal(isLegacyGeneratedHandle(old), true, 'old URLs/mentions still accept this alias shape');
  assert.equal(needsGeneratedHandle(old, { email, createdAt }), true);
  assert.equal(needsGeneratedHandle(old, { email, created_at: createdAt.toISOString() }), true);
  for (const account of [undefined, { email }, { email: 'different@example.invalid', createdAt },
    { email, createdAt: '2026-10-20T00:00:00Z' }, { email, createdAt: 'invalid' }]) {
    assert.equal(needsGeneratedHandle(old, account), false);
  }
  assert.equal(needsGeneratedHandle('chosen_custom_long_username'), false);
  assert.equal(isLegacyGeneratedHandle('chosen_00000000v2w7'), false);
  assert.equal(userHandleBase('Yoğurtcu Şahin'), 'yogurtcu_sahin');
});
