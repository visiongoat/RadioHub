import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { EventEmitter } from 'node:events';
import { getSeoReadDeadline, withSeoReadDeadline } from '../src/utils/seo-read-deadline';
import {
  getPublicStationDeadline,
  limitPublicStationDeadline,
  publicStationDeadlineContext,
  withPublicStationDeadline,
} from '../src/utils/public-station-deadline';

type Cards = Array<Record<string, unknown>>;
type Envelope = { value: unknown; expiresAt: number };
type CacheOptions = { ttl?: number };
type Method = 'find' | 'findOne' | 'findById' | 'findMergedAlias' | 'count' | 'groupCount';
type Call = {
  method: Method;
  receiver: unknown;
  args: unknown[];
  deadline: ReturnType<typeof getSeoReadDeadline>;
};
type Reader = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };
const START = 1_000_000;
const cards: Cards = [{ _id: 'healthy-station', name: 'Fixture Radio', isListVisible: true }];
const entries = new Map<string, Envelope>();
const reads: string[] = [];
const writes: Array<{ key: string; envelope: Envelope; options: CacheOptions }> = [];
const calls: Call[] = [];
const instances: MockCatalogStore[] = [];
let beforeGet: ((key: string) => Promise<void>) | undefined;
let beforeSet: ((key: string) => Promise<void>) | undefined;
let find: (this: MockCatalogStore, ...args: unknown[]) => Promise<Cards> = async () => cards;

// Only storage is replaced. Public cache single-flight, envelopes and deadlines
// below are the production implementation, including its follower re-read.
mock.module('../src/cache', { defaultExport: {
  get: async (key: string) => {
    reads.push(key);
    await beforeGet?.(key);
    return entries.get(key) ?? null;
  },
  set: async (key: string, envelope: Envelope, options: CacheOptions) => {
    writes.push({ key, envelope, options });
    await beforeSet?.(key);
    entries.set(key, envelope);
  },
  del: async (key: string) => { entries.delete(key); },
  clearByPattern: async () => {},
} });

class MockCatalogStore {
  constructor(readonly pool: Reader) { instances.push(this); }
  record(method: Method, args: unknown[]) {
    calls.push({ method, receiver: this, args, deadline: getSeoReadDeadline() });
  }
  async find(...args: unknown[]) { this.record('find', args); return find.apply(this, args); }
  async findOne(...args: unknown[]) { this.record('findOne', args); return cards[0]; }
  async findById(...args: unknown[]) { this.record('findById', args); return cards[0]; }
  async findMergedAlias(...args: unknown[]) { this.record('findMergedAlias', args); return cards[0]; }
  async count(...args: unknown[]) { this.record('count', args); return 17; }
  async groupCount(...args: unknown[]) { this.record('groupCount', args); return [{ _id: 'DE', count: 17 }]; }
}
mock.module('../src/data/postgres-catalog-store', { namedExports: { PostgresCatalogStore: MockCatalogStore } });

const sql: Array<{ text: string; values?: unknown[] }> = [];
const releases: unknown[] = [];
const client = Object.assign(new EventEmitter(), {
  async query(text: string, values?: unknown[]) { sql.push({ text, values }); return { rows: cards }; },
  release(discard?: unknown) { releases.push(discard); },
});
const connect = mock.fn(async () => client);
const defaultQuery = mock.fn(async () => { throw new Error('Default pool queries are forbidden'); });
mock.module('../src/postgres-runtime', { namedExports: {
  getPostgresPool: () => ({ connect, query: defaultQuery }),
} });
mock.module('../src/utils/logger', { namedExports: { logger: { warn: () => {} } } });

const module = await import('../src/data/postgres-seo-read-store');
const { pgSeoCatalog } = module;
const { relatedStationCards } = await import('../src/seo/related-station-cards');
const { publicStationCache, publicStationCacheKey } = await import('../src/public-station-cache');
const storageKey = (key: string) => publicStationCacheKey(`ssr-grid:v1:${key}`);
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const observe = <T>(promise: Promise<T>) => promise.then(
  value => ({ value, error: undefined }),
  (error: unknown) => ({ value: undefined, error }),
);
const hasCode = (code: string) => (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === code;

async function request(key = 'home') {
  return withPublicStationDeadline(async () => {
    const value = await pgSeoCatalog().find({ isListVisible: true }, { sharedCardsKey: key, limit: 24 });
    return { value, deadline: getPublicStationDeadline() };
  });
}

// The renderer owns caller cancellation; abandoning its wait must not cancel
// the shared producer that another request is still awaiting.
function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

beforeEach(t => {
  entries.clear(); reads.length = 0; writes.length = 0; calls.length = 0;
  sql.length = 0; releases.length = 0;
  beforeGet = undefined; beforeSet = undefined;
  find = async () => cards;
  connect.mock.resetCalls(); defaultQuery.mock.resetCalls();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: START });
});

test('retains only the original named export and a single bounded catalog instance', () => {
  assert.deepEqual(Object.keys(module), ['pgSeoCatalog']);
  assert.equal(instances.length, 1);
  assert.equal(typeof instances[0].pool.query, 'function');
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(defaultQuery.mock.callCount(), 0);
});

test('related stations share one query across station pages, excluding each page only after reading', async () => {
  const pool = Array.from({ length: 9 }, (_, i) => ({ _id: `station-${i}`, name: `Radio ${i}` }));
  find = async () => pool;
  const results = await Promise.all(Array.from({ length: 14 }, (_, i) =>
    relatedStationCards('country', 'Germany', `station-${i % 9}`, 8)));
  assert.equal(calls.length, 1);
  for (let i = 0; i < results.length; i++) {
    assert.equal(results[i].length, 8);
    assert.ok(results[i].every(card => card._id !== `station-${i % 9}`));
  }
  const [filter, options] = calls[0].args as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(filter.country, 'Germany');
  assert.equal(filter.isListVisible, true);
  assert.deepEqual(filter.noIndex, { $ne: true });
  assert.equal(filter._id, undefined);
  assert.equal(options.limit, 9);
  assert.deepEqual(options.sort, { votes: -1 });
});

test('related station scopes and literal publisher prefixes do not collide', async () => {
  await relatedStationCards('country', 'C++', 'self', 6);
  await relatedStationCards('state', 'C++', 'self', 6);
  await relatedStationCards('publisher', 'C++', 'self', 6);
  await relatedStationCards('publisher', 'C++', 'other', 6);
  assert.equal(calls.length, 3);
  assert.deepEqual((calls[2].args[0] as any).name, { $regex: '^C\\+\\+' });
  assert.deepEqual(await relatedStationCards('country', '', 'self', 8), []);
  assert.equal(calls.length, 3);
});

test('14 concurrent callers and 14 later callers for one key execute only one find', async () => {
  const gate = Promise.withResolvers<Cards>();
  find = async () => gate.promise;
  const pending = Array.from({ length: 14 }, () => request());
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(writes.length, 0);
  gate.resolve(cards);
  const results = await Promise.all(pending);
  for (const result of results) {
    assert.equal(result.value, cards);
    assert.equal(result.deadline, START + 60_000);
  }
  for (let i = 0; i < 14; i++) assert.equal((await request()).value, cards);
  assert.equal(calls.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, storageKey('home'));
  assert.equal(writes[0].options.ttl, 60);
  assert.deepEqual(calls[0].args, [{ isListVisible: true }, { limit: 24 }]);
  assert.equal(connect.mock.callCount(), 0);
});

test('home, escaped genre terms and exact country names retain distinct opaque keys', async () => {
  const keys = [
    'home',
    JSON.stringify(['genre', 'rock\\+pop']),
    JSON.stringify(['genre', 'rock+pop']),
    JSON.stringify(['country', 'Germany']),
    JSON.stringify(['country', 'germany']),
    JSON.stringify(['country', 'Germany ']),
  ];
  const gates = keys.map(() => Promise.withResolvers<Cards>());
  find = async () => gates[calls.length - 1].promise;
  const pending = keys.flatMap(key => [request(key), request(key)]);
  await flush();
  assert.equal(calls.length, keys.length);
  gates.forEach((gate, i) => gate.resolve([{ _id: keys[i] }]));
  const results = await Promise.all(pending);
  keys.forEach((key, i) => {
    assert.deepEqual(results[2 * i].value, [{ _id: key }]);
    assert.deepEqual(results[2 * i + 1].value, [{ _id: key }]);
  });
  for (const key of keys) assert.deepEqual((await request(key)).value, [{ _id: key }]);
  assert.equal(calls.length, keys.length);
  assert.deepEqual(new Set(writes.map(write => write.key)), new Set(keys.map(storageKey)));
});

test('shared find removes only its cache option and preserves the complete catalog query', async () => {
  const filter = { tags: { $regex: 'rock\\+pop', $options: 'i' }, isListVisible: true };
  const fields = ['_id', 'name', 'logoAssets'];
  const sort = { votes: -1 };
  const options = { sharedCardsKey: JSON.stringify(['genre', 'rock\\+pop']), fields, sort, limit: 24, offset: 3 };
  await pgSeoCatalog().find(filter, options);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].receiver, instances[0]);
  assert.equal(calls[0].args[0], filter);
  assert.deepEqual(calls[0].args[1], { fields, sort, limit: 24, offset: 3 });
  const forwarded = calls[0].args[1] as { fields: string[]; sort: Record<string, number> };
  assert.equal(forwarded.fields, fields);
  assert.equal(forwarded.sort, sort);
  assert.equal(options.sharedCardsKey, JSON.stringify(['genre', 'rock\\+pop']), 'caller options are not mutated');
});

test('non-opted-in find preserves filter, options, this and caller deadline without any cache I/O', async () => {
  const filter = { slug: 'fixture', tags: { $regex: '70s', $options: 'i' } };
  const options = { fields: ['_id', 'name'], limit: 7, offset: 2, sort: { votes: -1 } };
  const controller = new AbortController();
  const context = { expiresAt: START + 1234, signal: controller.signal };
  await withSeoReadDeadline(context, async () => {
    assert.equal(await pgSeoCatalog().find(filter, options), cards);
    assert.equal(await pgSeoCatalog().find(filter, options), cards);
    assert.equal(await pgSeoCatalog().find(filter), cards);
    assert.equal(await pgSeoCatalog().find(), cards);
  });
  assert.equal(calls.length, 4, 'no implicit cache or coalescing for the default reader');
  for (const call of calls) {
    assert.equal(call.receiver, instances[0]);
    assert.equal(call.deadline, context);
  }
  assert.equal(calls[0].args[0], filter);
  assert.equal(calls[0].args[1], options);
  assert.equal(calls[1].args[1], options);
  assert.equal(calls[2].args[0], filter);
  assert.deepEqual(calls[2].args[1], {});
  assert.deepEqual(calls[3].args, [{}, {}]);
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
});

for (const [method, args, expected] of [
  ['findOne', [{ slug: 'fixture' }, { fields: ['_id'], sort: { votes: -1 } }], cards[0]],
  ['findById', ['id:fixture'], cards[0]],
  ['findMergedAlias', ['old/fixture'], cards[0]],
  ['count', [{ noIndex: { $ne: true } }], 17],
  ['groupCount', ['country', { isListVisible: true }], [{ _id: 'DE', count: 17 }]],
] as const) {
  test(`${method} stays bound to the underlying store and preserves arguments without caching`, async () => {
    const context = { expiresAt: START + 987, signal: new AbortController().signal };
    const detached = pgSeoCatalog()[method] as (...params: unknown[]) => Promise<unknown>;
    await withSeoReadDeadline(context, async () => {
      assert.deepEqual(await detached(...args), expected);
      assert.deepEqual(await detached(...args), expected);
    });
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.method, method);
      assert.equal(call.receiver, instances[0]);
      assert.equal(call.deadline, context);
      assert.deepEqual(call.args, args);
      args.forEach((arg, i) => assert.equal(call.args[i], arg));
    }
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
  });
}

for (const callerBudget of [100, 10_000]) {
  test(`shared owner ignores first caller's ${callerBudget}ms deadline and abort while follower succeeds`, async t => {
    const gate = Promise.withResolvers<void>();
    const ownerController = new AbortController();
    const followerController = new AbortController();
    const firstContext = { expiresAt: START + callerBudget, signal: ownerController.signal };
    find = async function () {
      assert.deepEqual(getSeoReadDeadline(), { expiresAt: START + 4000 });
      assert.notEqual(getSeoReadDeadline(), firstContext);
      await gate.promise;
      assert.deepEqual(getSeoReadDeadline(), { expiresAt: START + 4000 });
      await this.pool.query('SELECT fixture_cards', ['fixture']);
      return cards;
    };
    const owner = observe(withSeoReadDeadline(firstContext,
      () => waitWithSignal(request(), ownerController.signal)));
    await flush();
    const follower = withSeoReadDeadline({ expiresAt: START + 20_000, signal: followerController.signal },
      () => request());
    await flush();
    t.mock.timers.tick(1001);
    ownerController.abort();
    const abandoned = await owner;
    assert.ok(abandoned.error instanceof Error);
    assert.equal(abandoned.error.name, 'AbortError');
    assert.equal(calls.length, 1);
    gate.resolve();
    const result = await follower;
    assert.equal(result.value, cards);
    assert.equal(result.deadline, START + 1001 + 60_000, 'query budget is not a visibility-cache TTL');
    assert.equal(connect.mock.callCount(), 1);
    assert.equal(defaultQuery.mock.callCount(), 0);
    assert.equal(sql.filter(call => call.text === 'SELECT fixture_cards').length, 1);
    assert.deepEqual(releases, [undefined]);
    assert.equal(getSeoReadDeadline(), undefined);
    assert.equal(getPublicStationDeadline(), Infinity);
  });
}

test('an already-aborted first caller cannot poison the shared producer', async () => {
  const controller = new AbortController(); controller.abort();
  find = async function () {
    await this.pool.query('SELECT fixture_cards');
    return cards;
  };
  const result = await withSeoReadDeadline({ expiresAt: START - 1, signal: controller.signal }, () => request());
  assert.equal(result.value, cards);
  assert.deepEqual(calls[0].deadline, { expiresAt: START + 4000 });
  assert.equal(connect.mock.callCount(), 1);
  assert.equal((await request()).value, cards);
  assert.equal(calls.length, 1);
});

for (const delay of [3999, 4000, 4500]) {
  test(`${delay}ms cache lookup counts against the producer's original four-second budget`, async t => {
    const gate = Promise.withResolvers<void>();
    beforeGet = async () => gate.promise;
    find = async function () {
      await this.pool.query('SELECT fixture_cards');
      return cards;
    };
    const pending = observe(request());
    await flush();
    assert.equal(calls.length, 0);
    t.mock.timers.tick(delay);
    gate.resolve();
    const result = await pending;
    if (delay < 4000) {
      assert.equal(result.value?.value, cards);
      assert.deepEqual(calls[0].deadline, { expiresAt: START + 4000 });
      assert.equal(connect.mock.callCount(), 1);
      assert.ok(sql.some(call => call.text === "SET LOCAL statement_timeout = '1ms'"),
        'checkout/setup/query cannot receive a new four-second budget after cache I/O');
    } else {
      assert.ok(hasCode('SEO_READ_TIMEOUT')(result.error));
      assert.equal(calls.length, 0, 'expired cache lookup must not call the catalog store');
      assert.equal(connect.mock.callCount(), 0, 'no late connection checkout');
      assert.deepEqual(sql, [], 'not even BEGIN may run after expiry');
      assert.deepEqual(writes, []);
    }
    assert.equal(defaultQuery.mock.callCount(), 0);
  });
}

test('one rejected flight is not cached and a later flight can recover', async () => {
  const original = new Error('fixture catalog unavailable');
  const gate = Promise.withResolvers<Cards>();
  find = async () => gate.promise;
  const pending = Array.from({ length: 14 }, () => observe(request()));
  await flush();
  assert.equal(calls.length, 1);
  gate.reject(original);
  for (const result of await Promise.all(pending)) assert.equal(result.error, original);
  assert.deepEqual(writes, []);
  assert.equal(entries.size, 0);
  find = async () => cards;
  const recovered = await Promise.all(Array.from({ length: 14 }, () => request()));
  assert.ok(recovered.every(result => result.value === cards));
  assert.equal(calls.length, 2);
  assert.equal(writes.length, 1);
  assert.equal((await request()).value, cards);
  assert.equal(calls.length, 2);
});

test('the shared entry is a hit at 59,999ms and expires at exactly 60,000ms', async t => {
  await request();
  const old = entries.get(storageKey('home'));
  assert.equal(old?.expiresAt, START + 60_000);
  assert.equal(writes[0].options.ttl, 60);
  t.mock.timers.tick(59_999);
  assert.equal((await request()).value, cards);
  assert.equal(calls.length, 1);
  const recovered = [{ _id: 'newly-recovered' }];
  find = async () => recovered;
  t.mock.timers.tick(1);
  assert.equal((await request()).value, recovered);
  assert.equal(calls.length, 2);
  assert.equal(writes.length, 2);
  assert.equal(entries.get(storageKey('home'))?.expiresAt, START + 120_000);
});

test('a 55-second hit cannot grant a response cache a renewed public health deadline', async t => {
  find = async () => { limitPublicStationDeadline(START + 60_000); return cards; };
  assert.equal((await request()).deadline, START + 60_000);
  t.mock.timers.tick(55_000);
  await withPublicStationDeadline(async () => {
    const value = await publicStationCache.getOrSetSingleFlight('fixture-response', async () => ({
      cards: await pgSeoCatalog().find({}, { sharedCardsKey: 'home', limit: 24 }),
    }));
    assert.deepEqual(value, { cards });
    assert.equal(getPublicStationDeadline(), START + 60_000);
  });
  assert.equal(calls.length, 1);
  const response = entries.get(publicStationCacheKey('fixture-response'));
  assert.equal(response?.expiresAt, START + 60_000);
  t.mock.timers.tick(5000);
  assert.equal(await publicStationCache.get('fixture-response'), null);
  assert.equal(await publicStationCache.get('ssr-grid:v1:home'), null);
});

test('a shorter native health deadline survives both a shared hit and an earlier caller deadline', async t => {
  find = async () => { limitPublicStationDeadline(START + 25_000); return cards; };
  assert.equal((await request()).deadline, START + 25_000);
  assert.equal(entries.get(storageKey('home'))?.expiresAt, START + 25_000);
  t.mock.timers.tick(24_000);
  await publicStationDeadlineContext.run({ expiresAt: START + 24_500 }, async () => {
    assert.equal((await request()).deadline, START + 24_500, 'a hit cannot relax an existing public deadline');
  });
  assert.equal((await request()).deadline, START + 25_000);
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1000);
  find = async () => [{ _id: 'health-rechecked' }];
  assert.deepEqual((await request()).value, [{ _id: 'health-rechecked' }]);
  assert.equal(calls.length, 2);
});

for (const freshness of [1000, 60_000]) {
  test(`publication delayed ${freshness}ms cannot return expired cards to owner or followers or renew cache life`, async t => {
    const publish = Promise.withResolvers<void>();
    beforeSet = async () => publish.promise;
    find = async () => { limitPublicStationDeadline(START + freshness); return cards; };
    const owner = observe(request());
    await flush();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].envelope.expiresAt, START + freshness);
    assert.equal(entries.size, 0, 'storage publication is still pending');
    const followers = Array.from({ length: 13 }, () => observe(request()));
    await flush();
    assert.equal(calls.length, 1);
    t.mock.timers.tick(freshness);
    publish.resolve();
    for (const result of await Promise.all([owner, ...followers])) {
      assert.ok(hasCode('SEO_SHARED_CARDS_EXPIRED')(result.error));
      assert.equal(result.value, undefined);
    }
    assert.equal(await publicStationCache.get('ssr-grid:v1:home'), null);
    assert.equal(entries.get(storageKey('home'))?.expiresAt, START + freshness);
    assert.equal(writes.length, 1, 'no follower may re-publish expired cards with a fresh TTL');
    beforeSet = undefined;
    find = async () => [{ _id: 'fresh-after-publication-timeout' }];
    assert.deepEqual((await request()).value, [{ _id: 'fresh-after-publication-timeout' }]);
    assert.equal(calls.length, 2);
    assert.equal(entries.get(storageKey('home'))?.expiresAt, START + freshness + 60_000);
  });
}

test('a follower delayed past freshness cannot use its resolved flight after the cache entry expires', async t => {
  const load = Promise.withResolvers<Cards>();
  const reread = Promise.withResolvers<void>();
  find = async () => { limitPublicStationDeadline(START + 1000); return load.promise; };
  const owner = request();
  await flush();
  const follower = observe(request());
  await flush();
  assert.equal(reads.length, 2);
  beforeGet = async () => { if (reads.length === 3) await reread.promise; };
  load.resolve(cards);
  assert.equal((await owner).value, cards);
  await flush();
  assert.equal(reads.length, 3, 'the real single-flight follower re-reads the cache deadline');
  t.mock.timers.tick(1000);
  reread.resolve();
  const result = await follower;
  assert.ok(hasCode('SEO_SHARED_CARDS_EXPIRED')(result.error));
  assert.equal(result.value, undefined);
  assert.equal(writes.length, 1);
  assert.equal(entries.get(storageKey('home'))?.expiresAt, START + 1000);
  beforeGet = undefined;
  find = async () => [{ _id: 'fresh-after-follower-timeout' }];
  assert.deepEqual((await request()).value, [{ _id: 'fresh-after-follower-timeout' }]);
  assert.equal(calls.length, 2);
});

for (const [label, value] of [
  ['infinite deadline', { cards, expiresAt: Infinity }],
  ['NaN deadline', { cards, expiresAt: NaN }],
  ['expired inner deadline with a live outer envelope', { cards, expiresAt: START }],
  ['null cards', { cards: null, expiresAt: START + 60_000 }],
  ['non-array cards', { cards: {}, expiresAt: START + 60_000 }],
] as const) {
  test(`malformed or expired shared payload is rejected: ${label}`, async () => {
    entries.set(storageKey('home'), { value, expiresAt: START + 120_000 });
    await assert.rejects(request(), hasCode('SEO_SHARED_CARDS_EXPIRED'));
    assert.equal(calls.length, 0);
    assert.deepEqual(writes, [], 'invalid data cannot be republished as a successful flight');
  });
}
