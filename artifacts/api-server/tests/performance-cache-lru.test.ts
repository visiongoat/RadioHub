import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

mock.module('../src/postgres-runtime', { namedExports: {
  getPostgresPool: () => { throw new Error('Database access is forbidden'); },
} });
const { performanceCache: cache } = await import('../src/performance-cache');

beforeEach(() => cache.clearAll());

test('capacity replaces only the least recently read entry, not 30% of the cache', () => {
  for (let i = 0; i < 300; i++) cache.setQuick(`key-${i}`, { value: i });
  assert.deepEqual(cache.getQuick('key-0'), { value: 0 });
  cache.setQuick('new', { value: 300 });
  assert.equal(cache.getStats().quick.keys, 300);
  assert.equal(cache.getQuick('key-1'), null);
  assert.deepEqual(cache.getQuick('key-0'), { value: 0 });
  for (let i = 2; i < 300; i++) assert.deepEqual(cache.getQuick(`key-${i}`), { value: i });
});

test('updating a full cache does not evict an unrelated entry and still freezes data', () => {
  for (let i = 0; i < 300; i++) cache.setQuick(`key-${i}`, { value: i });
  const value = { nested: { version: 2 } };
  cache.setQuick('key-150', value);
  assert.equal(cache.getStats().quick.keys, 300);
  assert.equal(cache.getQuick('key-150'), value);
  assert.ok(Object.isFrozen(value.nested));
  assert.deepEqual(cache.getQuick('key-0'), { value: 0 });
});

test('reading a hot key does not extend its original expiry', t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  cache.setQuick('short', { value: 1 }, 5);
  now += 4_000;
  assert.ok(cache.getQuick('short'));
  now += 1_001;
  assert.equal(cache.getQuick('short'), null);
});

test('flush and lazy expiry remove recency entries before refilling to capacity', t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  cache.setQuick('old', { value: 1 }, 1);
  now += 1_001;
  assert.equal(cache.getQuick('old'), null);
  cache.setQuick('flush-me', { value: 2 });
  cache.clearAll();
  for (let i = 0; i < 301; i++) cache.setQuick(`new-${i}`, { value: i });
  assert.equal(cache.getStats().quick.keys, 300);
  assert.equal(cache.getQuick('new-0'), null);
  assert.deepEqual(cache.getQuick('new-300'), { value: 300 });
});
