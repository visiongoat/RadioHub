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
