/**
 * Smoke regression suite for the sitemap & robots endpoints (Task #153).
 *
 * Why: api-server has no per-request integration tests, so regressions in
 * /sitemap.xml, /sitemap-index.xml, /sitemap-main-{lang}.xml, /llms.txt
 * and /robots.txt only surface in production via Google Search Console
 * errors. This suite boots the real Express handlers with the
 * PostgreSQL store dependencies stubbed via `node:test` module mocks, then
 * makes real HTTP requests against an ephemeral server.
 *
 * Deviation from task spec: the spec asked for /sitemap.xml -> 301 to
 * /sitemap-index.xml, but Task #128 intentionally changed this — Google
 * Search Console rejected the redirect on its strict "must be a sitemap
 * document" check, so /sitemap.xml now serves the sitemap-index XML
 * directly with a 200. Tests assert the current contract.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test).
 */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { AddressInfo, Server } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { INDEXING_PILOT } from '../src/seo/indexing-pilot';
import { MARKET_BLOG_MANIFEST, BLOG_SITEMAP_UPDATED } from '@workspace/seo-shared/blog-manifest';
import { LEGACY_STATION_GUIDES } from '@workspace/seo-shared/legacy-station-guides';
import { buildLocalizedUrl } from '../src/seo/url-helpers';
import { PUBLIC_SEO_LOCALE_CODES } from '../src/seo/public-route-matchers';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { SITEMAP_STYLESHEET, SITEMAP_STYLESHEET_INSTRUCTION } from '../src/seo/sitemap-presentation';

/**
 * Task #194: assert XML well-formedness in addition to regex smoke
 * checks. Without a real parser pass, malformed entities or unclosed
 * tags would still match the regex assertions and slip through.
 */
function assertValidXml(body: string, label: string): unknown {
  const validation = XMLValidator.validate(body, { allowBooleanAttributes: false });
  assert.equal(
    validation,
    true,
    `${label} must be well-formed XML; parser said: ${
      typeof validation === 'object' ? JSON.stringify(validation) : String(validation)
    }`,
  );
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'url' || name === 'sitemap' || name === 'xhtml:link',
  });
  return parser.parse(body);
}

// ---------------------------------------------------------------------------
// Module mocks — must be installed BEFORE the routes module is imported so
// the mocked exports replace the real DB-backed ones at module-load time.
// Specifiers are absolute file URLs so every internal relative-path import
// of the same module resolves to the same mock.
// ---------------------------------------------------------------------------

const playbackReports: Record<string, any>[] = [];
mock.module(new URL('../src/data/postgres-station-debug-store.ts', import.meta.url).href, {namedExports: {
  pgReportStationDebugLog: async (input: Record<string, any>) => { const row = {...input, _id: 'test-report-receipt'}; playbackReports.push(row); return {row, created: true}; },
  pgListStationDebugLogs: async (filter: {stationId?:string}) => { const errors=playbackReports.filter(row=>!filter.stationId||row.stationId===filter.stationId); return {errors,total:errors.length}; },
}});

interface FakeManifestChunk {
  chunk: number;
  urlCount: number;
  maxUpdatedAt: Date;
  stationIds?: string[];
}
interface FakeManifest {
  type: 'main' | 'genres' | 'stations';
  language: string;
  version: string;
  qualifiedLanguagesHash: string;
  chunks: FakeManifestChunk[];
  totalUrls: number;
  chunkCount: number;
  generatedAt: Date;
  maxUpdatedAt?: Date;
}

const TEST_HASH = 'testhash00000000';
const QUALIFIED_LANGS = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ar', 'zh', 'tr', 'ja', 'ko', 'hi', 'he'] as const;
const NOW = new Date('2026-01-01T00:00:00Z');

const FAKE_QUALIFIED_STATE = {
  languages: [...QUALIFIED_LANGS] as string[],
  hash: TEST_HASH,
  source: 'computed' as const,
  computedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 60_000),
};

class FakeQualifiedLanguagesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QualifiedLanguagesUnavailableError';
  }
}

mock.module(new URL('../src/seo/qualified-languages.ts', import.meta.url).href, {
  namedExports: {
    getQualifiedLanguagesState: async () => FAKE_QUALIFIED_STATE,
    getCachedQualifiedLanguages: async () => [...QUALIFIED_LANGS],
    getCachedQualifiedLanguagesSync: () => [...QUALIFIED_LANGS],
    QualifiedLanguagesUnavailableError: FakeQualifiedLanguagesUnavailableError,
    invalidateQualifiedLanguages: () => {},
    initializeQualifiedLanguages: async () => FAKE_QUALIFIED_STATE,
    EMERGENCY_SEED_QUALIFIED_LANGUAGES: [...QUALIFIED_LANGS],
  },
});

function buildFakeManifest(
  type: 'main' | 'genres' | 'stations',
  language: string,
): FakeManifest {
  // Real sitemap-manifest-builder numbers chunks 1-based (see
  // buildStationChunks / buildGenreChunks). Mirror that here so the
  // sitemap-index advertises the same URL the per-chunk handler will
  // actually answer with 200 — the route's chunk-param regex
  // `[1-9]\d{0,3}` rejects `0` with 410 Gone.
  const chunks: FakeManifestChunk[] = type === 'stations'
    ? [{ chunk: 1, urlCount: 50, maxUpdatedAt: NOW, stationIds: ['s1', 's2'] }]
    : type === 'genres'
      ? [{ chunk: 1, urlCount: 3, maxUpdatedAt: NOW, stationIds: ['g1', 'g2', 'g3'] }]
      : [{ chunk: 1, urlCount: 1, maxUpdatedAt: NOW }];
  return {
    type,
    language,
    version: 'v1-test',
    qualifiedLanguagesHash: TEST_HASH,
    chunks,
    totalUrls: chunks.reduce((acc, c) => acc + c.urlCount, 0),
    chunkCount: chunks.length,
    generatedAt: NOW,
    maxUpdatedAt: NOW,
  };
}

// Mutable overrides so individual tests can control manifest-builder behaviour
// (e.g. simulate a missing chunk to assert the 410-vs-503 contract) without
// re-mocking the module — `mock.module` snapshots `namedExports` at install
// time, so we close over these holders instead.
let manualBuildResult: Record<string, unknown> = {};
const builderOverrides: {
  getActiveManifest:
    | null
    | ((type: 'main' | 'genres' | 'stations', language: string) => Promise<FakeManifest | null>);
  getActiveStationChunk:
    | null
    | ((language: string, chunk: number) => Promise<{
        stationIds: readonly string[];
        maxUpdatedAt: Date;
        qualifiedLanguagesHash: string;
        version: string;
      } | null>);
} = { getActiveManifest: null, getActiveStationChunk: null };

mock.module(new URL('../src/seo/sitemap-manifest-builder.ts', import.meta.url).href, {
  namedExports: {
    buildAllSitemapManifests: async (options: unknown) => {
      assert.deepEqual(options, { force: true });
      return manualBuildResult;
    },
    getActiveManifest: async (
      type: 'main' | 'genres' | 'stations',
      language: string,
    ) => {
      if (builderOverrides.getActiveManifest) {
        return builderOverrides.getActiveManifest(type, language);
      }
      return buildFakeManifest(type, language);
    },
    getActiveStationChunk: async (language: string, chunk: number) => {
      if (builderOverrides.getActiveStationChunk) {
        return builderOverrides.getActiveStationChunk(language, chunk);
      }
      return {
        stationIds: ['s1', 's2'],
        maxUpdatedAt: NOW,
        qualifiedLanguagesHash: TEST_HASH,
        version: 'v1-test',
      };
    },
    startManifestRefreshLoop: () => {},
    getTopCountryDbNames: async () => [],
    encodeTopCountryEntry: (regionSlug: string, countrySlug: string) =>
      `__topcountry__:${regionSlug}/${countrySlug}`,
    extractTopCountriesFromChunk: (
      _ids: ReadonlyArray<string | { toString(): string }>,
    ): Array<{ regionSlug: string; countrySlug: string }> => [],
    RESERVED_GENRE_SLUGS: new Set<string>(),
  },
});

// Active native manifest fixtures used by the sitemap index.
const FAKE_INDEX_MANIFESTS: FakeManifest[] = QUALIFIED_LANGS.flatMap((lang) => [
  buildFakeManifest('main', lang),
  buildFakeManifest('genres', lang),
  buildFakeManifest('stations', lang),
]);

// Two fake stations:
//   s1 — verified themegaradio.com host → MUST emit <image:image>
//   s2 — external favicon               → emits the owned SSR image proxy
// Both pass the junk-station gate (lastCheckOk + recent lastCheckOkTime,
// non-empty url/name) and yield 'en' in getEligibleLanguages because of the
// universal-language fallback, so they appear in /sitemap-stations-en-1.xml.
interface FakeStationDoc {
  _id: string;
  slug: string;
  name: string;
  url: string;
  countryCode: string;
  bitrate: number;
  lastCheckOk: boolean;
  lastCheckOkTime: Date;
  updatedAt: Date;
  logoAssets?: { webp256?: string; webp96?: string };
  favicon?: string;
  noIndex?: boolean;
  descriptions?: Record<string, { full: string; meta: string }>;
}

const FAKE_STATION_DOCS: FakeStationDoc[] = [
  {
    _id: 's1',
    slug: 'station-one',
    name: 'Station One',
    url: 'http://example.com/stream1',
    countryCode: 'US',
    bitrate: 128,
    lastCheckOk: true,
    lastCheckOkTime: NOW,
    updatedAt: NOW,
    logoAssets: { webp256: 'https://cdn.themegaradio.com/s1.webp' },
    descriptions: Object.fromEntries(QUALIFIED_LANGS.map(lang => [lang, { full: `Station content in ${lang}`, meta: `Listen in ${lang}` }])),
  },
  {
    _id: 's2',
    slug: 'station-two',
    name: 'Station Two',
    url: 'http://example.com/stream2',
    countryCode: 'GB',
    bitrate: 128,
    lastCheckOk: true,
    lastCheckOkTime: NOW,
    updatedAt: NOW,
    favicon: 'https://random-host.example.com/favicon.ico',
  },
];

// Native genre rows preserve string IDs; unsafe slugs are filtered by the route.
//   g1 'pop'         — safe slug, must appear
//   g2 'rock'        — safe slug, must appear
//   g3 'bad slug!'   — unsafe slug, must be filtered out by SAFE_SLUG_RE
const FAKE_GENRE_DOCS = [
  { _id: 'g1', slug: 'pop', updatedAt: NOW },
  { _id: 'g2', slug: 'rock', updatedAt: NOW },
  { _id: 'g3', slug: 'bad slug!', updatedAt: NOW },
];

const actualCatalog=await import('../src/data/postgres-catalog-store');
mock.module(new URL('../src/data/postgres-catalog-store.ts',import.meta.url).href,{
  namedExports:{...actualCatalog,pgCatalog:()=>({
    find:async()=>FAKE_STATION_DOCS,count:async()=>0,groupCount:async()=>[],
  })},
});
const actualSeo=await import('../src/data/postgres-seo-indexing-store');
let sitemapReadRows: readonly any[] = FAKE_STATION_DOCS;
const sitemapReadBatches: string[][] = [];
let manifestReadFails = false;
let stationBatchReadFails = false;
mock.module(new URL('../src/data/postgres-seo-indexing-store.ts',import.meta.url).href,{
  namedExports:{...actualSeo,pgActiveManifests:async()=>{
    if (manifestReadFails) throw new Error('temporary PostgreSQL manifest read failure');
    return FAKE_INDEX_MANIFESTS;
  },pgSeoGenres:async()=>FAKE_GENRE_DOCS,pgTopIndexableTags:async()=>[],
    pgSitemapStationBatch: async (ids: string[]) => {
      if (stationBatchReadFails) throw new Error('temporary station read failure');
      sitemapReadBatches.push([...ids]);
      return sitemapReadRows.filter(row => ids.includes(row._id)).reverse();
    },
  },
});
const actualLocalization=await import('../src/data/postgres-localization-store');
mock.module(new URL('../src/data/postgres-localization-store.ts',import.meta.url).href,{
  namedExports:{...actualLocalization,pgLocalization:()=>({getKeys:async()=>[],getTranslations:async()=>({})})},
});

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      getUrlTranslations: async () => new Map<string, string>(),
      getCountryLanguageMappings: async () => new Map<string, string[]>(),
      getStats: () => ({ hits: 0, misses: 0 }),
      clearTranslations: () => {},
      clearUrlTranslations: () => {},
      clearCountryLanguageMappings: () => {},
    },
    PerformanceCache: class {},
    deepFreeze: <T,>(v: T) => v,
  },
});

const fakeCacheStore = new Map<string, unknown>();
const fakeCacheReads: string[] = [];
const fixtureRedisUrl = process.env.REDIS_URL;
delete process.env.REDIS_URL;
const realCacheManager = (await import('../src/cache')).default;
if (fixtureRedisUrl !== undefined) process.env.REDIS_URL = fixtureRedisUrl;
let useRealBoundedCache = false;
const FAKE_CACHE_MANAGER = {
  get: async (k: string) => {
    fakeCacheReads.push(k);
    return useRealBoundedCache ? realCacheManager.get(k) : fakeCacheStore.get(k) ?? null;
  },
  set: async (k: string, v: unknown, options: { ttl?: number } = {}) => {
    if (useRealBoundedCache) return realCacheManager.set(k, v, options);
    fakeCacheStore.set(k, v);
  },
  del: async (k: string) => { if (useRealBoundedCache) await realCacheManager.del(k); else fakeCacheStore.delete(k); },
  delPattern: async () => {},
};

mock.module(new URL('../src/cache.ts', import.meta.url).href, {
  defaultExport: FAKE_CACHE_MANAGER,
  namedExports: {
    CacheManager: FAKE_CACHE_MANAGER,
    CacheKeys: {},
    invalidateSocialCacheForUser: async () => {},
  },
});

// ---------------------------------------------------------------------------
// Boot Express app with mocked deps + dynamic-import the routes module so
// it picks up the mocks installed above.
// ---------------------------------------------------------------------------

interface SeoSitemapDeps {
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
}
type RegisterFn = (
  app: Express,
  deps: SeoSitemapDeps,
  options?: { apiOnly?: boolean },
) => Promise<void>;

let server: HttpServer;
let baseUrl: string;
let app: Express;
let spaCalls: number;

before(async () => {
  // Force `getBaseUrl` to use the request host (not the production override).
  process.env.NODE_ENV = 'test';

  const mod = (await import('../src/routes/seo-sitemap-routes.ts')) as {
    registerSeoSitemapRoutes: RegisterFn;
  };

  app = express();
  app.use(express.json());
  await mod.registerSeoSitemapRoutes(app, {
    requireAdmin: (req, res, next) => {
      if(req.headers['x-test-admin']==='allowed'||req.headers['x-fixture-admin']==='manual-build')return next();
      res.status(403).end();
    },
  });

  // SPA tracer catch-all — mirrors the index-web.ts ordering. Any request
  // that falls through to here would be served the React HTML shell to
  // Googlebot in production, which is the regression we are guarding.
  spaCalls = 0;
  app.use((_req: Request, res: Response) => {
    spaCalls += 1;
    res.setHeader('X-Spa-Catchall', '1');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send('<html><body>spa shell</body></html>');
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  // Guard: if `before` failed (e.g. a missing mock export crashed the
  // dynamic import), `server` will be undefined. Don't shadow the real
  // setup error with a "Cannot read properties of undefined" from close().
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const apiOnly of [false, true]) {
  test(`app-link documents override inherited cache headers in ${apiOnly ? 'apiOnly' : 'web'} mode`, async (t) => {
    const { registerSeoSitemapRoutes } = await import('../src/routes/seo-sitemap-routes.ts');
    const fixtureApp = express();
    fixtureApp.use((_req, res, next) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Expires', new Date(Date.now() + 31_536_000_000).toUTCString());
      res.setHeader('X-Fixture-Header', 'preserved');
      next();
    });
    await registerSeoSitemapRoutes(fixtureApp, {
      requireAdmin: (_req: Request, res: Response) => res.status(403).end(),
    }, { apiOnly });
    const fixtureServer = fixtureApp.listen(0, '127.0.0.1');
    t.after(() => new Promise<void>((resolve) => fixtureServer.close(() => resolve())));
    await new Promise<void>((resolve) => fixtureServer.once('listening', resolve));
    const fixtureUrl = `http://127.0.0.1:${(fixtureServer.address() as AddressInfo).port}`;

    for (const pathname of ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json']) {
      for (const query of ['', '?v=1', '?v=2&source=smoke']) {
        for (const method of ['GET', 'HEAD']) {
          await t.test(`${method} ${pathname}${query}`, async () => {
            const response = await fetch(`${fixtureUrl}${pathname}${query}`, { method, redirect: 'manual' });
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type') || '', /^application\/json(?:;|$)/);
            assert.equal(response.headers.get('location'), null);
            assert.equal(response.headers.get('cache-control'), 'public, max-age=300, must-revalidate');
            assert.doesNotMatch(response.headers.get('cache-control') || '', /immutable/i);
            assert.equal(response.headers.get('expires'), null);
            assert.equal(response.headers.get('x-fixture-header'), 'preserved');

            const body = await response.text();
            if (method === 'HEAD') {
              assert.equal(body, '');
            } else if (pathname.endsWith('assetlinks.json')) {
              assert.deepEqual(JSON.parse(body), [
                {
                  relation: ['delegate_permission/common.handle_all_urls'],
                  target: {
                    namespace: 'android_app',
                    package_name: 'com.visiongo.megaradio',
                    sha256_cert_fingerprints: [
                      '15:46:3D:5C:AA:67:5D:BE:80:80:09:53:28:E0:9A:24:1F:93:30:CE:D0:8E:96:F2:91:E0:EF:84:2B:FC:D3:CB',
                    ],
                  },
                },
                {
                  relation: ['delegate_permission/common.handle_all_urls'],
                  target: {
                    namespace: 'android_app',
                    package_name: 'com.megaradio',
                    sha256_cert_fingerprints: [
                      'B7:D7:BD:6A:A9:DA:2F:B8:FA:D1:71:B1:E3:11:77:F4:A4:7E:02:0D:36:5A:56:5C:8B:D1:62:52:0A:7F:55:3F',
                    ],
                  },
                },
              ]);
            } else {
              const document = JSON.parse(body);
              const paths: string[] = document.applinks.details[0].paths;
              const tvPaths = ['/tv', ...['en','es','fr','de','pt','it','ru','ar','zh','tr','ja','ko','hi','he','nl','pl'].map(lang=>`/${lang}/tv`)];
              const isTvPath = (path: string) => /^\/(?:[a-z]{2}\/)?tv$/.test(path);
              assert.deepEqual(paths.filter(isTvPath).sort(), tvPaths.sort());
              // Preserve the exact previous AASA contract after removing only
              // the explicitly added pairing routes, including app identity.
              document.applinks.details[0].paths = paths.filter(path=>!isTvPath(path));
              assert.equal(createHash('sha256').update(JSON.stringify(document)).digest('hex'),
                '171008f5e62971cf7c7d446f7f309ee8e7d8b9a56d5417434791ea56b6dac33e');
            }
          });
        }
      }
    }
  });
}

test('SEO page-data never returns synthetic metadata on transient errors, including slim navigation responses', async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  const render = mock.method(SeoRenderer.prototype, 'renderStaticPage', async () => ({
    language: 'en', cleanPath: '/station/recovery-fm', translations: {},
    seoTags: { title: 'Synthetic metadata must not reach the SPA' }, pageData: { stationDbError: true },
  }));
  try {
    for (const suffix of ['', '&slim=1']) {
      const response = await fetch(`${baseUrl}/api/seo/page-data?url=/en/station/recovery-fm${suffix}`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '60');
      assert.equal((await response.json() as any).seoTags, undefined);
    }
    render.mock.mockImplementation(async () => { throw new Error('SEO_RENDER_TIMEOUT'); });
    assert.equal((await fetch(`${baseUrl}/api/seo/page-data?url=/en`)).status, 503);
    render.mock.mockImplementation(async () => ({ language: 'en', cleanPath: '/', translations: {}, seoTags: { title: 'Recovered metadata' }, pageData: {} }));
    const recovered = await fetch(`${baseUrl}/api/seo/page-data?url=/en&slim=1`);
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json() as any).seoTags.title, 'Recovered metadata');
  } finally { render.mock.restore(); }
});

test('slim SEO page-data forwards the exact localized renderer context and preserves the full preview contract', async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  const { normalizeSeoTitleTags } = await import('@workspace/seo-shared/seo-config');
  const fullTitle = 'Station One et toutes ses émissions musicales et culturelles en direct | Mega Radio';
  const fixture = {
    language: 'fr', cleanPath: '/station/station-one', translations: { genres: 'Genres français' },
    seoTags: { title: fullTitle, canonical: 'https://themegaradio.com/fr/station/station-one' },
    urlTranslations: new Map([['fr:station', 'station']]),
    pageData: { pageType: 'station', station: { ...FAKE_STATION_DOCS[0], descriptions: { fr: { full: 'Description française', meta: 'Écoutez cette station' } } } },
  };
  const structuredData = {
    global: [{ '@type': 'WebSite', '@id': 'https://themegaradio.com/#website' }],
    page: [{ '@type': 'RadioStation', name: fixture.pageData.station.name, url: fixture.seoTags.canonical, inLanguage: 'fr' }],
  };
  const render = mock.method(SeoRenderer.prototype, 'renderStaticPage', async () => fixture);
  const generate = mock.method(SeoRenderer.prototype, 'generateStructuredData', () => structuredData);
  try {
    const requestedUrl = '/fr/station/station-one';
    const full = await fetch(`${baseUrl}/api/seo/page-data?url=${requestedUrl}`);
    assert.equal(full.status, 200);
    const preview = await full.json() as any;
    assert.deepEqual(preview.pageData, JSON.parse(JSON.stringify(fixture.pageData)));
    assert.deepEqual(preview.translations, fixture.translations);
    assert.equal(preview.seoTags.title, fullTitle, 'admin preview preserves the full title');
    assert.equal(preview.structuredData, undefined);
    assert.equal(generate.mock.callCount(), 0);

    const slim = await fetch(`${baseUrl}/api/seo/page-data?url=${requestedUrl}&slim=1`);
    assert.equal(slim.status, 200);
    const payload = await slim.json() as any;
    assert.deepEqual(payload, { language: fixture.language, cleanPath: fixture.cleanPath, seoTags: normalizeSeoTitleTags(fixture.seoTags), structuredData });
    assert.ok(payload.seoTags.title.length <= 70);
    assert.ok(payload.seoTags.title.endsWith(' | Mega Radio'));
    assert.equal(fixture.seoTags.title, fullTitle, 'cached title/H1 inputs stay untouched');
    assert.deepEqual(render.mock.calls.at(-1)!.arguments, [requestedUrl, 'https://themegaradio.com']);
    assert.equal(generate.mock.callCount(), 1);
    const expectedArguments = [fixture.seoTags, fixture.language, fixture.translations, fixture.cleanPath, fixture.pageData.station, fixture.urlTranslations, fixture.pageData];
    generate.mock.calls[0].arguments.forEach((argument, index) => assert.strictEqual(argument, expectedArguments[index]));
    assert.equal(generate.mock.calls[0].arguments.length, expectedArguments.length);
    const head = new SeoRenderer().generateHtmlHead(fixture.seoTags, fixture.language, {}, fixture.cleanPath);
    assert.ok(head.includes(`<title>${payload.seoTags.title}</title>`), 'HTML and slim navigation titles match');
  } finally { render.mock.restore(); generate.mock.restore(); }
});

test('retired station navigation exposes only the verified identity and preserves terminal resolution errors', async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  let pageData: any = { pageType: 'station', station: { ...FAKE_STATION_DOCS[0], _id: 'resolved-target-id', source: { private: true } } };
  const render = mock.method(SeoRenderer.prototype, 'renderStaticPage', async () => ({
    language: 'en', cleanPath: '/station/station-one', translations: {}, urlTranslations: new Map(),
    seoTags: { title: 'Verified target', canonical: 'https://themegaradio.com/en/station/station-one' }, pageData,
  }));
  try {
    const response = await fetch(`${baseUrl}/api/seo/page-data?url=/sv/station/old-record&slim=1`);
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.equal(payload.stationIdentity, 'resolved-target-id');
    assert.equal(payload.station, undefined);
    assert.equal(payload.source, undefined);
    assert.equal(payload.pageData, undefined);
    for (const [flag, status] of [['notFound', 410], ['stationIsJunk', 410], ['stationDbError', 503]] as const) {
      pageData = { pageType: 'station', [flag]: true };
      const failed = await fetch(`${baseUrl}/api/seo/page-data?url=/sv/station/old-record&slim=1`);
      assert.equal(failed.status, status, flag);
      assert.equal(failed.headers.get('cache-control'), 'no-store');
      assert.equal((await failed.json() as any).stationIdentity, undefined);
    }
  } finally { render.mock.restore(); }
});

test('slim retired single-letter station pages do not require a directory DTO', async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  const id = '68a8c482bd66579311ab2f5b';
  const canonical = `https://themegaradio.com/en/station/${id}`;
  let cleanPath = '/station/x';
  let pageType = 'station';
  const render = mock.method(SeoRenderer.prototype, 'renderStaticPage', async () => ({
    language: 'en', cleanPath, translations: {}, urlTranslations: new Map(),
    seoTags: { title: 'Single-letter station', canonical },
    pageData: { pageType, station: { ...FAKE_STATION_DOCS[0], _id: id, slug: cleanPath.split('/')[2] } },
  }));
  try {
    for (const slug of ['x', 'a']) {
      cleanPath = `/station/${slug}`;
      const response = await fetch(`${baseUrl}/api/seo/page-data?url=/nl/station/${slug}&slim=1`);
      assert.equal(response.status, 200, cleanPath);
      const payload = await response.json() as any;
      assert.equal(payload.stationIdentity, id);
      assert.equal(payload.seoTags.canonical, canonical);
      assert.equal(payload.stationDirectory, undefined);
    }
    // A genuine directory still fails closed when its required DTO is absent.
    cleanPath = '/stations/x'; pageType = 'stations';
    const directory = await fetch(`${baseUrl}/api/seo/page-data?url=/nl/stations/x&slim=1`);
    assert.equal(directory.status, 503);
    assert.equal(directory.headers.get('cache-control'), 'no-store');
  } finally { render.mock.restore(); }
});

test('absent catalogue slices expose404 and noindex in both slim navigation and full previews', async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  const fixture = { language: 'de', cleanPath: '/stations', translations: {},
    seoTags: { title: 'Radiosender', robots: 'noindex, follow', noIndex: true, hreflangs: [] },
    pageData: { pageType: 'stations', notFound: true, httpNotFound: true } };
  const render = mock.method(SeoRenderer.prototype, 'renderStaticPage', async () => fixture);
  try {
    for (const suffix of ['', '&slim=1']) {
      const response = await fetch(`${baseUrl}/api/seo/page-data?url=%2Fde%2Fsender%3Fpage%3D999999${suffix}`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json() as any;
      assert.equal(body.seoTags.noIndex, true);
      assert.deepEqual(body.seoTags.hreflangs, []);
      if (!suffix) assert.deepEqual(body.pageData, fixture.pageData);
    }
  } finally { render.mock.restore(); }
});

test('slim directory responses expose only bounded public fields and use the same localized renderer data', async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  const fixture = {
    language: 'de', cleanPath: '/stations/z', translations: { secret_dictionary: 'not part of slim DTO' },
    seoTags: { title: 'Alle Radiosender', canonical: 'https://themegaradio.com/de/sender/z?page=2' },
    urlTranslations: new Map<string, string>(),
    pageData: { pageType: 'stations', catalogPage: 2, catalogTotalPages: 3,
      catalogStations: [{ _id: 'fixture-id', slug: 'z-fm', name: 'Z FM', country: 'Germany',
        url: 'https://fixture.invalid/live', internalNotes: 'must not leak' }] },
  };
  const render = mock.method(SeoRenderer.prototype, 'renderStaticPage', async () => fixture);
  try {
    const response = await fetch(`${baseUrl}/api/seo/page-data?url=%2Fde%2Fsender%2Fz%3Fpage%3D2&slim=1`);
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.deepEqual(Object.keys(payload).sort(), ['cleanPath', 'language', 'seoTags', 'stationDirectory', 'structuredData']);
    assert.equal(payload.stationDirectory.currentPage, 2);
    assert.deepEqual(payload.stationDirectory.stations.map((station: any) => station.href), ['/de/sender/z-fm']);
    assert.deepEqual(Object.keys(payload.stationDirectory.stations[0]).sort(), ['alt', 'href', 'logoUrl', 'name']);
    assert.equal(payload.stationDirectory.letters.length, 27);
    assert.deepEqual(payload.stationDirectory.pages.map((page: any) => page.href),
      ['/de/sender/z', '/de/sender/z?page=2', '/de/sender/z?page=3']);
    assert.ok(!JSON.stringify(payload.stationDirectory).includes('must not leak'));
    assert.ok(!JSON.stringify(payload.stationDirectory).includes('fixture.invalid'));
    assert.ok(!JSON.stringify(payload).includes('not part of slim DTO'));
    assert.deepEqual(render.mock.calls[0].arguments, ['/de/sender/z?page=2', 'https://themegaradio.com']);
  } finally { render.mock.restore(); }
});

test('missing or failed directory payloads are retryable503, never synthetic empty200', async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  const fixture: any = { language: 'en', cleanPath: '/stations/z', translations: {},
    seoTags: { title: 'Incomplete catalogue' }, pageData: { pageType: 'stations' } };
  const render = mock.method(SeoRenderer.prototype, 'renderStaticPage', async () => fixture);
  try {
    for (const pageData of [{ pageType: 'stations' }, { pageType: 'stations', hubReadFailed: true },
      { pageType: 'stations', stationDbError: true }]) {
      fixture.pageData = pageData;
      const response = await fetch(`${baseUrl}/api/seo/page-data?url=/en/stations/z&slim=1`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '60');
      const payload = await response.json() as any;
      assert.equal(payload.stationDirectory, undefined);
      assert.equal(payload.seoTags, undefined);
    }
  } finally { render.mock.restore(); }
});

test('large station sitemaps read bounded batches and retain manifest order, omissions and XML validity', async () => {
  const ids = Array.from({ length: 1201 }, (_, n) => `batch-${1200 - n}`);
  sitemapReadRows = ids.map((_id, n) => ({ ...FAKE_STATION_DOCS[0], _id, slug: `${_id}-radio`, noIndex: n === 500 }));
  // A deleted station must be omitted without disturbing neighboring entries.
  sitemapReadRows = sitemapReadRows.filter(row => row._id !== ids[1000]);
  sitemapReadBatches.length = 0;
  builderOverrides.getActiveStationChunk = async () => ({ stationIds: ids, maxUpdatedAt: NOW, qualifiedLanguagesHash: TEST_HASH, version: 'bounded-read-test' });
  try {
    const response = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(response.status, 200);
    const xml = await response.text();
    assertValidXml(xml, 'batched station sitemap');
    assert.deepEqual(sitemapReadBatches.map(batch => batch.length), [500, 500, 201]);
    assert.deepEqual(sitemapReadBatches.flat(), ids);
    const slugs = [...xml.matchAll(/<loc>[^<]*\/station\/([^<]+)<\/loc>/g)].map(match => match[1]);
    assert.deepEqual(slugs, ids.filter((_, n) => n !== 500 && n !== 1000).map(id => `${id}-radio`));
    const cached = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(await cached.text(), xml);
    assert.equal(sitemapReadBatches.length, 3, 'cached sitemap must not query another batch');
  } finally {
    sitemapReadRows = FAKE_STATION_DOCS;
    builderOverrides.getActiveStationChunk = null;
  }
});

function azPublicationFixture() {
  const descriptions = Object.freeze(Object.fromEntries(QUALIFIED_LANGS.map(lang => [lang,
    Object.freeze({ full: `Station content in ${lang}`, meta: `Listen in ${lang}` }),
  ])));
  const makeRow = (id: string, slug: string, extra: Record<string, unknown> = {}) => Object.freeze({
    ...FAKE_STATION_DOCS[0], _id: id, slug, name: `Fixture ${id}`, noIndex: false,
    descriptions, completeDescriptionLanguages: Object.freeze([...QUALIFIED_LANGS]),
    logoAssets: Object.freeze({ webp256: `https://cdn.themegaradio.com/${id}.webp` }), ...extra,
  });
  const keys = [...'abcdefghijklmnopqrstuvwxyz', '0-9'];
  const reserved = [...keys, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((slug, index) => makeRow(`az-reserved-${index}`, slug));
  const normalSlugs = ['ab', 'bbc', 'npr', 'k-1', '0-90', 'genres', 'profile'];
  const normals = normalSlugs.map((slug, index) => makeRow(`az-normal-${index}`, slug));
  const rows = Object.freeze([
    ...reserved, ...normals,
    makeRow('excluded-noindex', 'noindex-radio', { noIndex: true }),
    makeRow('excluded-junk', 'junk-radio', { url: '' }),
    makeRow('excluded-redirect', 'redirect-radio', { redirectToSlug: 'bbc' }),
    makeRow('excluded-numeric', '1234'),
  ]);
  return { keys, reserved, normals, normalSlugs, rows, ids: Object.freeze(rows.map(row => row._id)) };
}

test('old manifest IDs cannot emit A-Z station nodes or alternates in any locale, and diff URLs equal XML', async () => {
  const { computeStationsSitemapUrlsForChunk } = await import('../src/services/sitemap-diff-indexnow');
  const fixture = azPublicationFixture();
  const before = structuredClone(fixture.rows);
  const byId = new Map(fixture.rows.map(row => [row._id, row]));
  const union: string[] = [];
  const expectedUnion: string[] = [];
  sitemapReadRows = fixture.rows;
  builderOverrides.getActiveStationChunk = async () => ({ stationIds: fixture.ids, maxUpdatedAt: NOW, qualifiedLanguagesHash: TEST_HASH, version: 'old-az-manifest' });
  fakeCacheStore.clear();
  try {
    for (const language of QUALIFIED_LANGS) {
      const response = await fetch(`${baseUrl}/sitemap-stations-${language}-1.xml`);
      assert.equal(response.status, 200, language);
      const body = await response.text();
      const entries = (assertValidXml(body, `${language} A-Z filtered XML`) as any).urlset.url;
      const expected = fixture.normalSlugs.map(slug => 'https://themegaradio.com' + buildLocalizedUrl(`/station/${slug}`, language, undefined, new Map()));
      assert.deepEqual(entries.map((entry: any) => entry.loc), expected, `${language}: normal manifest order and identity`);
      assert.doesNotMatch(body, /az-reserved-|excluded-/);
      for (const [index, entry] of entries.entries()) {
        const links = entry['xhtml:link'];
        const codes = new Set(links.map((link: any) => link['@_hreflang']));
        for (const lang of QUALIFIED_LANGS) assert.ok(codes.has(lang), `${language}: normal ${fixture.normalSlugs[index]} lost ${lang}`);
        assert.ok(codes.has('x-default'));
        for (const link of links) {
          const lang = link['@_hreflang'] === 'x-default' ? 'en' : link['@_hreflang'].split('-')[0];
          assert.equal(link['@_href'], 'https://themegaradio.com' + buildLocalizedUrl(`/station/${fixture.normalSlugs[index]}`, lang, undefined, new Map()));
        }
      }
      const diff = computeStationsSitemapUrlsForChunk({ language, qualifiedLanguages: QUALIFIED_LANGS, stationIds: fixture.ids,
        stationsById: byId, translations: new Map(), baseUrl: 'https://themegaradio.com' });
      assert.deepEqual(diff, entries.map((entry: any) => entry.loc).sort(), `${language}: diff helper and served XML must agree`);
      union.push(...entries.map((entry: any) => entry.loc));
      expectedUnion.push(...expected);
    }
    assert.equal(new Set(union).size, fixture.normalSlugs.length * 14);
    assert.deepEqual(union.sort(), expectedUnion.sort());
    assert.ok(fixture.rows.every(Object.isFrozen));
    assert.deepEqual(fixture.rows, before, 'serve and diff must not mutate IDs, slug, noIndex or language fields');
    assert.deepEqual(fixture.ids, fixture.rows.map(row => row._id));
  } finally {
    sitemapReadRows = FAKE_STATION_DOCS;
    builderOverrides.getActiveStationChunk = null;
    fakeCacheStore.clear();
  }
});

test('all 14 main sitemaps retain 27 A-Z directory entries with reciprocal full locale and x-default clusters', async () => {
  const keys = [...'abcdefghijklmnopqrstuvwxyz', '0-9'];
  fakeCacheStore.clear();
  try {
    for (const language of QUALIFIED_LANGS) {
      const response = await fetch(`${baseUrl}/sitemap-main-${language}.xml`);
      assert.equal(response.status, 200);
      const entries = (assertValidXml(await response.text(), `${language} main A-Z XML`) as any).urlset.url;
      assert.equal(entries.length, 16 + 27);
      for (const key of keys) {
        const expected = new Map(QUALIFIED_LANGS.map(lang => [lang, 'https://themegaradio.com' + buildLocalizedUrl(`/stations/${key}`, lang, undefined, new Map())]));
        const matches = entries.filter((entry: any) => entry.loc === expected.get(language));
        assert.equal(matches.length, 1, `${language}: exactly one directory entry for ${key}`);
        const links = matches[0]['xhtml:link'];
        for (const lang of QUALIFIED_LANGS) {
          const alternate = links.filter((link: any) => link['@_hreflang'] === lang);
          assert.equal(alternate.length, 1);
          assert.equal(alternate[0]['@_href'], expected.get(lang), `${language}/${key}: reciprocal directory target ${lang}`);
        }
        const fallback = links.filter((link: any) => link['@_hreflang'] === 'x-default');
        assert.equal(fallback.length, 1);
        assert.equal(fallback[0]['@_href'], `https://themegaradio.com/en/stations/${key}`);
      }
    }
  } finally { fakeCacheStore.clear(); }
});

test('active but empty sitemap manifests are retryable, never a 200 empty index or a stale 304', async () => {
  const normal = await fetch(`${baseUrl}/sitemap-index.xml`);
  assert.equal(normal.status, 200);
  const etag = normal.headers.get('etag');
  assert.ok(etag);
  const saved = FAKE_INDEX_MANIFESTS.map(manifest => ({ ...manifest }));
  for (const manifest of FAKE_INDEX_MANIFESTS) {
    manifest.chunks = []; manifest.chunkCount = 0; manifest.totalUrls = 0;
  }
  try {
    for (const variant of ['empty', 'invalid-station-chunks']) {
      if (variant === 'invalid-station-chunks') {
        for (const manifest of FAKE_INDEX_MANIFESTS.filter(row => row.type === 'stations')) {
          manifest.chunkCount = 2;
          manifest.chunks = [{ chunk: 0, urlCount: 50, maxUpdatedAt: NOW }, { chunk: 10000, urlCount: 50, maxUpdatedAt: NOW }];
        }
      }
      for (const pathname of ['/sitemap-index.xml', '/sitemap.xml', '/sitemap-en.xml']) {
        const response = await fetch(`${baseUrl}${pathname}`, { headers: { 'If-None-Match': etag! } });
        assert.equal(response.status, 503, `${variant}: ${pathname}`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('retry-after'), '120');
        assert.doesNotMatch(await response.text(), /<sitemapindex/);
      }
    }
  } finally {
    saved.forEach((manifest, index) => Object.assign(FAKE_INDEX_MANIFESTS[index], manifest));
  }
  assert.equal((await fetch(`${baseUrl}/sitemap-index.xml`)).status, 200);
});

test('sitemap manifest database errors cannot be cached as successful empty indexes', async () => {
  manifestReadFails = true;
  try {
    for (const pathname of ['/sitemap-index.xml', '/sitemap.xml', '/sitemap-en.xml']) {
      const response = await fetch(`${baseUrl}${pathname}`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '120');
    }
  } finally { manifestReadFails = false; }
  assert.equal((await fetch(`${baseUrl}/sitemap-index.xml`)).status, 200);
});

test('operational station and genre timestamps do not advertise content freshness or change XML validators', async () => {
  fakeCacheStore.clear();
  const paths = ['/sitemap-stations-en-1.xml', '/sitemap-main-en.xml', '/sitemap-index.xml', '/sitemap.xml', '/sitemap-en.xml',
    ...QUALIFIED_LANGS.map(lang => `/sitemap-genres-${lang}.xml`)];
  const original = [];
  for (const pathname of paths) {
    const response = await fetch(baseUrl + pathname);
    assert.equal(response.status, 200);
    const body = await response.text();
    const parsed = assertValidXml(body, pathname) as any;
    if (parsed.urlset) {
      assert.equal(response.headers.get('last-modified'), null);
      if (pathname.includes('/sitemap-stations-')) assert.equal(parsed.urlset.url.length, 2, 'all eligible station URLs remain discoverable');
      else if (pathname.includes('/sitemap-genres-')) assert.equal(parsed.urlset.url.length, 2, 'eligible genre URLs remain discoverable');
      else assert.ok(parsed.urlset.url.length > 15, 'main discovery URLs remain present');
      for (const entry of parsed.urlset.url) assert.equal(entry.lastmod, undefined);
    } else {
      for (const entry of parsed.sitemapindex.sitemap) {
        if (entry.loc.endsWith('/sitemap-blog.xml')) assert.ok(entry.lastmod, 'editorial blog dates remain present');
        else assert.equal(entry.lastmod, undefined);
      }
    }
    assert.equal(response.headers.get('last-modified'), null);
    original.push({ pathname, body, etag: response.headers.get('etag')!, lastModified: response.headers.get('last-modified') });
  }
  const manifest = FAKE_INDEX_MANIFESTS.find(row => row.type === 'stations' && row.language === 'en')!;
  const mainManifest = FAKE_INDEX_MANIFESTS.find(row => row.type === 'main' && row.language === 'en')!;
  const previous = manifest.chunks[0].maxUpdatedAt;
  const previousMain = mainManifest.chunks[0].maxUpdatedAt;
  const advanced = new Date('2030-02-01T00:00:00Z');
  const genreDates = FAKE_GENRE_DOCS.map(genre => genre.updatedAt);
  FAKE_GENRE_DOCS.forEach(genre => { genre.updatedAt = advanced; });
  manifest.chunks[0].maxUpdatedAt = advanced;
  mainManifest.chunks[0].maxUpdatedAt = advanced;
  sitemapReadRows = FAKE_STATION_DOCS.map(station => ({ ...station, updatedAt: advanced }));
  builderOverrides.getActiveStationChunk = async () => ({ stationIds: ['s1', 's2'], maxUpdatedAt: advanced, qualifiedLanguagesHash: TEST_HASH, version: 'v1-test' });
  builderOverrides.getActiveManifest = async (type, language) => ({ ...buildFakeManifest(type, language), maxUpdatedAt: advanced });
  try {
    // Leave old cache entries in place: the new operational date invalidates
    // them, but a regenerated unchanged body must still return the same ETag.
    for (const snapshot of original) {
      const conditional = await fetch(baseUrl + snapshot.pathname, { headers: { 'If-None-Match': snapshot.etag } });
      assert.equal(conditional.status, 304);
      assert.equal(await conditional.text(), '');
      const response = await fetch(baseUrl + snapshot.pathname);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), snapshot.body);
      assert.equal(response.headers.get('etag'), snapshot.etag);
      assert.equal(response.headers.get('last-modified'), snapshot.lastModified);
    }
  } finally {
    manifest.chunks[0].maxUpdatedAt = previous;
    mainManifest.chunks[0].maxUpdatedAt = previousMain;
    FAKE_GENRE_DOCS.forEach((genre, index) => { genre.updatedAt = genreDates[index]; });
    sitemapReadRows = FAKE_STATION_DOCS;
    builderOverrides.getActiveStationChunk = null;
    builderOverrides.getActiveManifest = null;
    fakeCacheStore.clear();
  }
});

test('English pilot sitemaps expose only live eligible exact identities and remain independently measurable', async () => {
  sitemapReadRows = INDEXING_PILOT.map(profile => ({
    ...FAKE_STATION_DOCS[0], _id: profile.id, slug: profile.slug,
    countryCode: profile.countryCode, noIndex: false,
  }));
  try {
    for (const country of ['at', 'tr']) {
      const response = await fetch(`${baseUrl}/sitemap-pilot-en-${country}.xml`);
      assert.equal(response.status, 200);
      const xml = await response.text();
      const parsed = assertValidXml(xml, `pilot ${country}`) as any;
      assert.equal(xml.split(SITEMAP_STYLESHEET_INSTRUCTION).length - 1, 1);
      assert.equal(response.headers.get('etag'), xmlCacheFixture(xml).etag);
      assert.deepEqual(parsed.urlset.url.map((row: any) => new URL(row.loc).pathname),
        INDEXING_PILOT.filter(profile => profile.countryCode.toLowerCase() === country).map(profile => `/en/station/${profile.slug}`));
      assert.doesNotMatch(xml, /<lastmod>/);
      assert.equal((await fetch(`${baseUrl}/sitemap-pilot-en-${country}.xml`, { headers: { 'If-None-Match': response.headers.get('etag')! } })).status, 304);
    }
    for (const path of ['/sitemap-index.xml', '/sitemap.xml', '/sitemap-en.xml']) {
      const body = await (await fetch(baseUrl + path)).text();
      assert.ok(body.includes('/sitemap-pilot-en-at.xml'));
      assert.ok(body.includes('/sitemap-pilot-en-tr.xml'));
      assert.ok(body.includes('/sitemap-stations-en-1.xml'), 'the full catalogue is retained');
    }
    assert.equal((await fetch(`${baseUrl}/sitemap-pilot-en-us.xml`)).status, 410);
    const before = await fetch(`${baseUrl}/sitemap-pilot-en-at.xml`);
    const excluded = INDEXING_PILOT.find(profile => profile.countryCode === 'AT')!;
    sitemapReadRows = sitemapReadRows.map(row => row._id === excluded.id ? { ...row, noIndex: true } : row);
    const changed = await fetch(`${baseUrl}/sitemap-pilot-en-at.xml`, { headers: { 'If-None-Match': before.headers.get('etag')! } });
    assert.equal(changed.status, 200);
    assert.equal(countLocs(await changed.text()), 9);
    sitemapReadRows = [];
    const unavailable = await fetch(`${baseUrl}/sitemap-pilot-en-at.xml`, { headers: { 'If-None-Match': before.headers.get('etag')! } });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('cache-control'), 'no-store');
    stationBatchReadFails = true;
    assert.equal((await fetch(`${baseUrl}/sitemap-pilot-en-tr.xml`)).status, 503);
    for (const path of ['/sitemap-index.xml', '/sitemap.xml', '/sitemap-en.xml']) {
      assert.equal((await fetch(baseUrl + path)).status, 200, 'optional pilot reads cannot break the main sitemap indexes');
    }
  } finally { sitemapReadRows = FAKE_STATION_DOCS; stationBatchReadFails = false; }
});

test('nightly genre manifest timestamps alone do not change index XML or validators', async () => {
  const paths = ['/sitemap-index.xml', '/sitemap.xml', '/sitemap-en.xml'];
  const original = await Promise.all(paths.map(async pathname => {
    const response = await fetch(baseUrl + pathname);
    assert.equal(response.status, 200);
    return { pathname, etag: response.headers.get('etag')!, body: await response.text() };
  }));
  const manifest = FAKE_INDEX_MANIFESTS.find(row => row.type === 'genres' && row.language === 'en')!;
  const previous = manifest.chunks[0].maxUpdatedAt;
  const advanced = new Date('2026-02-01T00:00:00Z');
  manifest.chunks[0].maxUpdatedAt = advanced;
  try {
    for (const snapshot of original) {
      const response = await fetch(baseUrl + snapshot.pathname, { headers: { 'If-None-Match': snapshot.etag } });
      assert.equal(response.status, 304, `${snapshot.pathname} must ignore operational genre dates`);
      assert.equal(await response.text(), '');
      assert.equal(response.headers.get('etag'), snapshot.etag);
      assert.equal(response.headers.get('last-modified'), null);
      const fresh = await fetch(baseUrl + snapshot.pathname);
      assert.equal(await fresh.text(), snapshot.body);
      const unchanged = await fetch(baseUrl + snapshot.pathname, { headers: { 'If-None-Match': `"different", W/${snapshot.etag}` } });
      assert.equal(unchanged.status, 304);
      assert.equal(await unchanged.text(), '');
    }
  } finally { manifest.chunks[0].maxUpdatedAt = previous; }
});

test('genre XML bypasses old dated caches but still changes its ETag for real URL changes', async () => {
  fakeCacheStore.clear();
  const oldXml = '<?xml version="1.0"?><urlset><url><loc>https://example.invalid/old</loc><lastmod>2030-01-01</lastmod></url></urlset>';
  const oldKey = `sitemap:genres:xml-v2:en:${TEST_HASH}:v1-test:${NOW.getTime()}`;
  fakeCacheStore.set(oldKey, { xml: oldXml, etag: '"old-dated-xml"', byteLength: Buffer.byteLength(oldXml) });
  fakeCacheStore.set(`${oldKey}:validator`, { etag: '"old-dated-xml"' });
  const originalSlug = FAKE_GENRE_DOCS[0].slug;
  try {
    const response = await fetch(`${baseUrl}/sitemap-genres-en.xml`, { headers: { 'If-None-Match': '"old-dated-xml"' } });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.doesNotMatch(body, /<lastmod>/);
    assert.ok(body.includes('/en/genres/pop'));
    assert.equal(response.headers.get('last-modified'), null);
    const etag = response.headers.get('etag')!;
    assert.equal((await fetch(`${baseUrl}/sitemap-genres-en.xml`, { headers: { 'If-None-Match': etag } })).status, 304);
    FAKE_GENRE_DOCS[0].slug = 'new-pop';
    builderOverrides.getActiveManifest = async (type, language) => ({ ...buildFakeManifest(type, language), version: 'v2-real-url-change' });
    const changed = await fetch(`${baseUrl}/sitemap-genres-en.xml`, { headers: { 'If-None-Match': etag } });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get('etag'), etag);
    assert.match(await changed.text(), /\/en\/genres\/new-pop/);
  } finally {
    FAKE_GENRE_DOCS[0].slug = originalSlug;
    builderOverrides.getActiveManifest = null;
    fakeCacheStore.clear();
  }
});

test('rolling manifest hashes retain every locale and incomplete builds are retryable', async () => {
  const saved = FAKE_INDEX_MANIFESTS.map(row => ({ ...row }));
  try {
    FAKE_INDEX_MANIFESTS.forEach((manifest, index) => {
      manifest.qualifiedLanguagesHash = index === 0 ? TEST_HASH : 'previous-cohort';
    });
    const rolling = await fetch(`${baseUrl}/sitemap-index.xml`);
    assert.equal(rolling.status, 200);
    const body = await rolling.text();
    const parsed = assertValidXml(body, 'rolling cohort index') as any;
    assert.equal(parsed.sitemapindex.sitemap.length, QUALIFIED_LANGS.length * 3 + 3);
    assert.ok(body.includes('/sitemap-blog.xml'), 'the independently translated editorial sitemap is discoverable');
    for (const lang of QUALIFIED_LANGS) {
      assert.ok(body.includes(`/sitemap-stations-${lang}-1.xml`), `${lang} remains discoverable during the swap`);
    }

    const missing = FAKE_INDEX_MANIFESTS.findIndex(row => row.type === 'genres' && row.language === 'en');
    FAKE_INDEX_MANIFESTS.splice(missing, 1);
    for (const pathname of ['/sitemap-index.xml', '/sitemap.xml', '/sitemap-en.xml']) {
      const response = await fetch(baseUrl + pathname, { headers: { 'If-None-Match': rolling.headers.get('etag')! } });
      assert.equal(response.status, 503, `${pathname} must not publish a missing manifest slot`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '120');
    }
    assert.equal((await fetch(`${baseUrl}/sitemap-de.xml`)).status, 200, 'a complete locale remains independently available');
  } finally { FAKE_INDEX_MANIFESTS.splice(0, FAKE_INDEX_MANIFESTS.length, ...saved); }
});

test('date-only validators cannot hide removed URLs in an index or a station leaf', async () => {
  const index = await fetch(`${baseUrl}/sitemap-index.xml`);
  const station = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
  const manifest = FAKE_INDEX_MANIFESTS.find(row => row.type === 'stations' && row.language === 'en')!;
  const chunks = manifest.chunks;
  manifest.chunks = [];
  sitemapReadRows = [FAKE_STATION_DOCS[0]];
  fakeCacheStore.clear();
  try {
    const newIndex = await fetch(`${baseUrl}/sitemap-index.xml`, { headers: { 'If-Modified-Since': index.headers.get('last-modified')! } });
    assert.equal(newIndex.status, 200);
    assert.doesNotMatch(await newIndex.text(), /sitemap-stations-en-1\.xml/);
    const newStation = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-Modified-Since': 'Sat, 01 Feb 2031 00:00:00 GMT' } });
    assert.equal(newStation.status, 200);
    assert.equal(countLocs(await newStation.text()), 1);
    assert.notEqual(newStation.headers.get('etag'), station.headers.get('etag'));
  } finally {
    manifest.chunks = chunks;
    sitemapReadRows = FAKE_STATION_DOCS;
    fakeCacheStore.clear();
  }
});

test('station ETags represent current XML after cache expiry even without a manifest revision', async () => {
  fakeCacheStore.clear();
  const original = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
  const oldEtag = original.headers.get('etag')!;
  sitemapReadRows = FAKE_STATION_DOCS.map(row => ({ ...row, name: `${row.name} updated logo title` }));
  fakeCacheStore.clear();
  try {
    const changed = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': oldEtag } });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get('etag'), oldEtag);
    assert.match(await changed.text(), /updated logo title/);
    const unchanged = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': changed.headers.get('etag')! } });
    assert.equal(unchanged.status, 304);
  } finally { sitemapReadRows = FAKE_STATION_DOCS; fakeCacheStore.clear(); }
});

test('conditional leaf cache hits use small validators without rereading station rows or the XML body', async () => {
  fakeCacheStore.clear();
  sitemapReadBatches.length = 0;
  const original = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
  assert.equal(original.status, 200);
  const etag = original.headers.get('etag')!;
  const reads = sitemapReadBatches.length;
  // Simulate a body larger than the memory tier while retaining its compact,
  // same-TTL validator. A crawler with that exact body can still get a 304.
  for (const key of fakeCacheStore.keys()) if (!key.endsWith(':validator')) fakeCacheStore.delete(key);
  try {
    const cached = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': etag } });
    assert.equal(cached.status, 304);
    assert.equal(sitemapReadBatches.length, reads);
    const unconditional = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(unconditional.status, 200);
    assert.equal(unconditional.headers.get('etag'), etag);
    assert.ok(sitemapReadBatches.length > reads, 'a caller without the representation receives regenerated XML');
  } finally { fakeCacheStore.clear(); }
});

test('large station XML survives the real Redis-free memory cap without changing responses or rereading rows', async () => {
  fakeCacheStore.clear();
  await realCacheManager.clearByPattern('sitemap:');
  useRealBoundedCache = true;
  sitemapReadRows = [{ ...FAKE_STATION_DOCS[0], name: 'Large fixture Å '.repeat(220_000) }];
  sitemapReadBatches.length = 0;
  const cacheKey = `sitemap:stations:xml-v6-css-az-safe-owned-images:en:1:${TEST_HASH}:v1-test:${NOW.getTime()}`;
  try {
    const first = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(first.status, 200);
    const body = await first.text();
    const headers = ['etag', 'content-length', 'cache-control', 'content-type', 'content-encoding'] as const;
    const reads = sitemapReadBatches.length;
    assert.ok(JSON.stringify({ xml: body }).length * 2 > 8 * 1024 * 1024);
    assert.equal(await realCacheManager.get(cacheKey), null, 'older readers must never receive a packed record');
    const packed = await realCacheManager.get<any>(cacheKey + ':gzip-v1');
    assert.equal(packed?.encoding, 'gzip-base64-v1');
    assert.ok(JSON.stringify(packed).length * 2 < 8 * 1024 * 1024);
    const second = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(second.status, 200);
    assert.equal(await second.text(), body);
    for (const header of headers) assert.equal(second.headers.get(header), first.headers.get(header), header);
    assert.equal(sitemapReadBatches.length, reads, 'unconditional hot GET cannot regenerate XML from PostgreSQL');
    for (const validator of [first.headers.get('etag')!, `W/${first.headers.get('etag')!}`]) {
      fakeCacheReads.length = 0;
      const conditional = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': validator } });
      assert.equal(conditional.status, 304);
      assert.equal(await conditional.text(), '');
      assert.deepEqual(fakeCacheReads, [cacheKey + ':validator']);
    }
    const mismatch = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': '"different"' } });
    assert.equal(mismatch.status, 200);
    assert.equal(await mismatch.text(), body);
    assert.equal(sitemapReadBatches.length, reads);
    await realCacheManager.set(cacheKey + ':gzip-v1', { ...packed, data: 'AAAA' });
    const repaired = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(repaired.status, 200);
    assert.equal(await repaired.text(), body);
    assert.ok(sitemapReadBatches.length > reads, 'corrupt cache is a miss, not a broken or 503 response');
    const readsAfterRepair = sitemapReadBatches.length;
    await realCacheManager.clearByPattern('sitemap:');
    const afterClear = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(afterClear.status, 200);
    assert.equal(await afterClear.text(), body);
    assert.ok(sitemapReadBatches.length > readsAfterRepair);
  } finally {
    useRealBoundedCache = false;
    sitemapReadRows = FAKE_STATION_DOCS;
    fakeCacheStore.clear();
    await realCacheManager.clearByPattern('sitemap:');
  }
});

test('advertised leaves with no surviving rows return uncached 503 and recover on the next read', async () => {
  const station = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
  const genre = await fetch(`${baseUrl}/sitemap-genres-en.xml`);
  const genreRows = [...FAKE_GENRE_DOCS];
  sitemapReadRows = [];
  FAKE_GENRE_DOCS.splice(0);
  fakeCacheStore.clear();
  try {
    for (const [pathname, etag] of [
      ['/sitemap-stations-en-1.xml', station.headers.get('etag')!],
      ['/sitemap-genres-en.xml', genre.headers.get('etag')!],
    ]) {
      const response = await fetch(baseUrl + pathname, { headers: { 'If-None-Match': etag } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '120');
      assert.doesNotMatch(await response.text(), /<urlset/);
    }
    assert.equal(fakeCacheStore.size, 0, 'failed leaf responses cannot poison the XML cache');
  } finally {
    sitemapReadRows = FAKE_STATION_DOCS;
    FAKE_GENRE_DOCS.push(...genreRows);
  }
  assert.equal((await fetch(`${baseUrl}/sitemap-stations-en-1.xml`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/sitemap-genres-en.xml`)).status, 200);
});

test('image entries serialize owned logos and external proxy URLs without placeholders or invalid schemes', async () => {
  const favicon = ' https://radio.example.com/logos/rádio logo.png?size=large&theme=dark ';
  const values = [
    'https://cdn.themegaradio.com/logo.png?size=large&theme=dark', favicon,
    'https://cdn.themegaradio.com/images/no-image.webp?v=2',
    'https://cdn.themegaradio.com/default-station.png#logo',
    'javascript:alert(1)', 'https://', 'https://user:password@example.com/logo.png', '',
  ];
  const ids = values.map((_, n) => `image-${n}`);
  sitemapReadRows = values.map((value, n) => ({ ...FAKE_STATION_DOCS[0], _id: ids[n], slug: ids[n], logoAssets: undefined, favicon: value }));
  builderOverrides.getActiveStationChunk = async () => ({ stationIds: ids, maxUpdatedAt: NOW, qualifiedLanguagesHash: TEST_HASH, version: 'image-validation' });
  fakeCacheStore.clear();
  try {
    const response = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(response.status, 200);
    const body = await response.text();
    const urls = (assertValidXml(body, 'image sitemap') as any).urlset.url;
    assert.equal(urls[0]['image:image']['image:loc'], values[0]);
    assert.ok(body.includes('?size=large&amp;theme=dark'));
    const proxy = new URL(urls[1]['image:image']['image:loc']);
    assert.equal(proxy.origin, 'https://themegaradio.com');
    assert.equal(proxy.search, '?w=256');
    const encoded = proxy.pathname.slice('/api/image/'.length);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.equal(Buffer.from(encoded, 'base64url').toString('utf8'), new URL(favicon.trim()).href);
    for (const url of urls.slice(2)) assert.equal(url['image:image'], undefined);
  } finally { sitemapReadRows = FAKE_STATION_DOCS; builderOverrides.getActiveStationChunk = null; fakeCacheStore.clear(); }
});

test('owned image URLs replace both old station XML and validators without freshness or membership churn', async () => {
  fakeCacheStore.clear();
  const oldXml = '<urlset><url><loc>https://themegaradio.com/en/station/station-one</loc><image:image><image:loc>https://old.example/logo.webp</image:loc></image:image></url></urlset>';
  const oldKey = `sitemap:stations:xml-v3:en:1:${TEST_HASH}:v1-test:${NOW.getTime()}`;
  fakeCacheStore.set(oldKey, { xml: oldXml, etag: '"old-s3-image-xml"', byteLength: Buffer.byteLength(oldXml) });
  fakeCacheStore.set(`${oldKey}:validator`, { etag: '"old-s3-image-xml"' });
  const paths = ['/station-logos/mangoradio_11ab228c/logo-256.webp',
    '/station-logos/radio_12345678/variants/12345678-1234-1234-1234-123456789abc/logo-96.webp'];
  sitemapReadRows = FAKE_STATION_DOCS.map((row, index) => ({ ...row,
    name: index === 0 ? 'MANGO & Friends' : row.name,
    logoAssets: { webp256: `https://megaradio-station-logos.s3.eu-north-1.amazonaws.com${paths[index]}` },
  }));
  try {
    const response = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': '"old-s3-image-xml"' } });
    assert.equal(response.status, 200);
    const body = await response.text();
    const urls = (assertValidXml(body, 'owned image sitemap') as any).urlset.url;
    assert.equal(urls.length, 2);
    assert.equal(urls[0].loc, 'https://themegaradio.com/en/station/station-one');
    assert.equal(urls[1].loc, 'https://themegaradio.com/en/station/station-two');
    for (const [index, entry] of urls.entries()) {
      assert.equal(entry['image:image']['image:loc'], `https://themegaradio.com${paths[index]}`);
      assert.ok(entry['image:image']['image:title'].includes(sitemapReadRows[index].name));
      assert.equal(entry.lastmod, undefined);
    }
    assert.equal(response.headers.get('last-modified'), null);
    assert.notEqual(response.headers.get('etag'), '"old-s3-image-xml"');
    const newKey = oldKey.replace('xml-v3:', 'xml-v6-css-az-safe-owned-images:');
    assert.ok(fakeCacheStore.has(newKey));
    assert.ok(fakeCacheStore.has(`${newKey}:validator`));
    assert.equal((fakeCacheStore.get(oldKey) as any).xml, oldXml, 'unrelated old cache is not globally purged');
    const conditional = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': response.headers.get('etag')! } });
    assert.equal(conditional.status, 304);
  } finally { sitemapReadRows = FAKE_STATION_DOCS; fakeCacheStore.clear(); }
});

function xmlCacheFixture(xml: string) {
  return Object.freeze({ xml, etag: `"${createHash('sha256').update(xml).digest('hex')}"`, byteLength: Buffer.byteLength(xml) });
}

test('v5 ignores a prefilled v4 A-Z body and validator, returns changed XML 200, then validates the new body with 304', async () => {
  const fixture = azPublicationFixture();
  const rows = Object.freeze([fixture.normals[0], fixture.reserved.find(row => row.slug === 'k')!]);
  const ids = Object.freeze(rows.map(row => row._id));
  const suffix = `en:1:${TEST_HASH}:az-cache-migration:${NOW.getTime()}`;
  const oldKey = `sitemap:stations:xml-v4-owned-images:${suffix}`;
  const newKey = `sitemap:stations:xml-v6-css-az-safe-owned-images:${suffix}`;
  const old = xmlCacheFixture('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://themegaradio.com/en/station/k</loc><xhtml:link rel="alternate" hreflang="de" href="https://themegaradio.com/de/sender/k"/></url><url><loc>https://themegaradio.com/en/station/ab</loc></url></urlset>');
  fakeCacheStore.clear();
  fakeCacheStore.set(oldKey, old);
  fakeCacheStore.set(`${oldKey}:validator`, Object.freeze({ etag: old.etag }));
  fakeCacheReads.length = 0;
  sitemapReadRows = rows;
  builderOverrides.getActiveStationChunk = async () => ({ stationIds: ids, maxUpdatedAt: NOW, qualifiedLanguagesHash: TEST_HASH, version: 'az-cache-migration' });
  try {
    const response = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': old.etag } });
    assert.equal(response.status, 200, 'old v4 validator must not hide the changed representation');
    const body = await response.text();
    const entries = (assertValidXml(body, 'v5 cache migration XML') as any).urlset.url;
    assert.deepEqual(entries.map((entry: any) => entry.loc), ['https://themegaradio.com/en/station/ab']);
    assert.doesNotMatch(body, /az-reserved-|\/station\/k<|\/sender\/k"/);
    assert.equal(response.headers.get('etag'), xmlCacheFixture(body).etag, 'ETag must remain a hash of XML, not the cache namespace');
    assert.notEqual(response.headers.get('etag'), old.etag);
    assert.equal(fakeCacheReads.includes(oldKey), false);
    assert.equal(fakeCacheReads.includes(`${oldKey}:validator`), false);
    assert.equal((fakeCacheStore.get(newKey) as any).xml, body);
    assert.equal((fakeCacheStore.get(`${newKey}:validator`) as any).etag, response.headers.get('etag'));
    assert.deepEqual(fakeCacheStore.get(oldKey), old, 'old cache entries are not mutated or globally purged');
    const conditional = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': response.headers.get('etag')! } });
    assert.equal(conditional.status, 304);
    assert.equal(await conditional.text(), '');
  } finally {
    sitemapReadRows = FAKE_STATION_DOCS;
    builderOverrides.getActiveStationChunk = null;
    fakeCacheStore.clear();
  }
});

test('an unchanged normal chunk still accepts its checksum ETag across the v4-to-v5 namespace change', async () => {
  const fixture = azPublicationFixture();
  const rows = Object.freeze([fixture.normals[0]]);
  const ids = Object.freeze(rows.map(row => row._id));
  const suffix = `en:1:${TEST_HASH}:unchanged-normal:${NOW.getTime()}`;
  const oldKey = `sitemap:stations:xml-v4-owned-images:${suffix}`;
  const newKey = `sitemap:stations:xml-v6-css-az-safe-owned-images:${suffix}`;
  sitemapReadRows = rows;
  builderOverrides.getActiveStationChunk = async () => ({ stationIds: ids, maxUpdatedAt: NOW, qualifiedLanguagesHash: TEST_HASH, version: 'unchanged-normal' });
  fakeCacheStore.clear();
  try {
    const original = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(original.status, 200);
    const body = await original.text();
    const old = xmlCacheFixture(body);
    assert.equal(original.headers.get('etag'), old.etag);
    fakeCacheStore.clear();
    fakeCacheStore.set(oldKey, old);
    fakeCacheStore.set(`${oldKey}:validator`, Object.freeze({ etag: old.etag }));
    fakeCacheReads.length = 0;
    sitemapReadBatches.length = 0;
    const conditional = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`, { headers: { 'If-None-Match': old.etag } });
    assert.equal(conditional.status, 304, 'namespace-only changes must not fabricate a changed representation');
    assert.equal(await conditional.text(), '');
    assert.equal(conditional.headers.get('etag'), old.etag);
    assert.deepEqual(sitemapReadBatches, [[...ids]], 'v5 must recompute from rows, not reuse the v4 validator');
    assert.equal(fakeCacheReads.includes(oldKey), false);
    assert.equal(fakeCacheReads.includes(`${oldKey}:validator`), false);
    assert.equal((fakeCacheStore.get(newKey) as any).xml, body);
    assert.equal((fakeCacheStore.get(`${newKey}:validator`) as any).etag, old.etag);
    const unconditional = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(unconditional.status, 200);
    assert.equal(await unconditional.text(), body);
    assert.equal(unconditional.headers.get('etag'), old.etag);
    assert.equal(sitemapReadBatches.length, 1, 'warm v5 body does not read station rows again');
  } finally {
    sitemapReadRows = FAKE_STATION_DOCS;
    builderOverrides.getActiveStationChunk = null;
    fakeCacheStore.clear();
  }
});

test('reserved-only old chunks return uncached 503 in all 14 locales even with old v4 validators', async () => {
  const fixture = azPublicationFixture();
  const ids = Object.freeze(fixture.reserved.map(row => row._id));
  const before = structuredClone(fixture.reserved);
  sitemapReadRows = fixture.reserved;
  builderOverrides.getActiveStationChunk = async () => ({ stationIds: ids, maxUpdatedAt: NOW, qualifiedLanguagesHash: TEST_HASH, version: 'reserved-only' });
  fakeCacheStore.clear();
  try {
    for (const language of QUALIFIED_LANGS) {
      const suffix = `${language}:1:${TEST_HASH}:reserved-only:${NOW.getTime()}`;
      const oldKey = `sitemap:stations:xml-v4-owned-images:${suffix}`;
      const newKey = `sitemap:stations:xml-v6-css-az-safe-owned-images:${suffix}`;
      const old = xmlCacheFixture(`<urlset><url><loc>https://themegaradio.com${buildLocalizedUrl('/station/k', language, undefined, new Map())}</loc></url></urlset>`);
      fakeCacheStore.set(oldKey, old);
      fakeCacheStore.set(`${oldKey}:validator`, Object.freeze({ etag: old.etag }));
      fakeCacheReads.length = 0;
      const response = await fetch(`${baseUrl}/sitemap-stations-${language}-1.xml`, { headers: { 'If-None-Match': old.etag } });
      assert.equal(response.status, 503, language);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '120');
      assert.match(await response.text(), /^Sitemap manifest building/);
      assert.notEqual(response.headers.get('etag'), old.etag, 'a text error validator cannot validate the retired XML');
      assert.equal(fakeCacheStore.has(newKey), false);
      assert.equal(fakeCacheStore.has(`${newKey}:validator`), false);
      assert.equal(fakeCacheReads.includes(oldKey), false);
      assert.equal(fakeCacheReads.includes(`${oldKey}:validator`), false);
    }
    assert.deepEqual(fixture.reserved, before, 'reserved-only failure must not alter the source records');
  } finally {
    sitemapReadRows = FAKE_STATION_DOCS;
    builderOverrides.getActiveStationChunk = null;
    fakeCacheStore.clear();
  }
});

function countLocs(xml: string): number {
  return (xml.match(/<loc>/g) || []).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('/llms.txt returns text/plain 200 advertising the sitemap-index', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/llms.txt`);
  assert.equal(res.status, 200, '/llms.txt must be 200');
  assert.match(
    res.headers.get('content-type') || '',
    /^text\/plain/,
    '/llms.txt must be served as text/plain (Task #128 contract)',
  );
  assert.equal(res.headers.get('x-spa-catchall'), null);
  assert.equal(spaCalls, callsBefore, '/llms.txt must NOT fall through to the SPA catch-all');
  const body = await res.text();
  assert.match(body, /\/sitemap-index\.xml/);
  assert.match(body, /\/robots\.txt/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(body, /\/en\/stations/);
  assert.match(body, /\/en\/blog\/radio-data-usage/);
  assert.match(body, /\/en\/blog\/listen-to-radio-online/);
  assert.doesNotMatch(body, /\/api-docs|\/api-user|\/en\/radios|<html/i);
});

test('/robots.txt returns text/plain 200 with Sitemap directive', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^text\/plain/);
  assert.equal(res.headers.get('x-spa-catchall'), null);
  assert.equal(spaCalls, callsBefore, '/robots.txt must NOT fall through to the SPA catch-all');
  const body = await res.text();
  assert.match(
    body,
    /Sitemap: https?:\/\/[^\s]+\/sitemap-index\.xml/,
    'robots.txt must end with the Sitemap: directive pointing to sitemap-index.xml',
  );
  assert.match(body, /User-agent: \*/);
});

// Match the emitted ASCII rules without reordering queries or decoding reserved
// separators. REP compares unreserved percent-encoded octets as their literals.
function parseRobotsRules(body: string) {
  const normalizeOctets = (value: string) => value.replace(/%([0-9a-f]{2})/gi, (_encoded, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[A-Za-z0-9._~-]$/.test(character) ? character : `%${hex.toUpperCase()}`;
  });
  type Rule = { allow: boolean; matcher: RegExp; specificity: number };
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let group: typeof groups[number] | undefined;
  for (const line of body.split(/\r?\n/)) {
    const directive = /^([^:]+):\s*(.*)$/.exec(line.split('#', 1)[0].trim());
    if (!directive) continue;
    const field = directive[1].trim().toLowerCase();
    const value = directive[2].trim();
    if (field === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if (group && value && (field === 'allow' || field === 'disallow')) {
      const terminal = value.endsWith('$');
      const pattern = normalizeOctets(terminal ? value.slice(0, -1) : value);
      const source = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      group.rules.push({ allow: field === 'allow', matcher: new RegExp(`^${source}${terminal ? '$' : ''}`),
        specificity: Buffer.byteLength(pattern.replace(/\*/g, '')) });
    }
  }
  return (path: string, userAgent: string): boolean => {
    const agent = userAgent.toLowerCase();
    const scored = groups.map(entry => ({ ...entry, score: Math.max(-1,
      ...entry.agents.map(name => name === '*' ? 0 : agent.includes(name) ? name.length : -1)) }));
    const best = Math.max(-1, ...scored.map(entry => entry.score));
    const url = new URL(path, 'https://themegaradio.com');
    const target = normalizeOctets(url.pathname + url.search);
    const matching = scored.filter(entry => entry.score === best).flatMap(entry => entry.rules)
      .filter(rule => rule.matcher.test(target));
    const longest = Math.max(-1, ...matching.map(rule => rule.specificity));
    return longest === -1 || matching.some(rule => rule.specificity === longest && rule.allow);
  };
}

const CRAWLERS = ['generic-crawler', 'Googlebot', 'Google-Extended', 'bingbot', 'OAI-SearchBot',
  'Google-InspectionTool', 'Baiduspider', 'Sogou', 'GPTBot', 'CCBot', 'Bytespider', 'cohere-ai',
  'Meta-ExternalAgent', 'Diffbot', 'ChatGPT-User', 'anthropic-ai', 'Claude-Web', 'ClaudeBot',
  'PerplexityBot', 'Perplexity-User', 'Applebot-Extended', 'Amazonbot', 'DuckAssistBot', 'YouBot'];

for (const userAgent of CRAWLERS) {
  test(`robots allows only the two exact public discovery URLs for ${userAgent}`, async () => {
    const response = await fetch(`${baseUrl}/robots.txt`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    const allows = parseRobotsRules(await response.text());
    const firstPage = '/api/users/search?page=1&limit=20&sortBy=recent_favorites';
    for (const path of [
      '/api/users/search', firstPage,
      '/api/users/search?%70age=1&limit=20&sortBy=recent_favorites',
      '/api/users/se%61rch?page=1&limit=20&sortBy=recent_favorites',
      '/api/users/search?page=1&limit=20&sortBy=%72ecent_favorites',
    ]) {
      assert.equal(allows(path, userAgent), true, `${userAgent} must fetch ${path}`);
    }
    for (const path of [
      '/api/users/search?q=listener', '/api/users/search?search=listener',
      `${firstPage}&q=listener`, `${firstPage}&q=`, `${firstPage}&search=listener`,
      '/api/users/search?page=2&limit=20&sortBy=recent_favorites',
      '/api/users/search?page=1&limit=50&sortBy=recent_favorites',
      '/api/users/search?page=1&limit=20&sortBy=newest',
      '/api/users/search?page=01&limit=20&sortBy=recent_favorites',
      '/api/users/search?page=1&limit=20&sortBy=recent_favorites_extra',
      '/api/users/search?limit=20&page=1&sortBy=recent_favorites',
      '/api/users/search?sortBy=recent_favorites&page=1&limit=20',
      '/api/users/search?page=1%26limit=20&sortBy=recent_favorites',
      '/api/users/search?page=1%26limit%3D20%26sortBy%3Drecent_favorites',
      `${firstPage}&page=1`, `${firstPage}&limit=20`, `${firstPage}&sortBy=recent_favorites`,
      `${firstPage}&unknown=1`, `${firstPage}&`, `${firstPage}/private`,
      '/api/users/search/', '/api/users/search/private', '/api/users/searching', '/api/users/search.json',
      '/api/users/private-listener', '/api/users/private-listener/favorites',
      '/api/user/favorites', '/api/auth/me', '/api/auth/token-session', '/api/admin/users',
      '/api/admin', '/api/auth',
    ]) {
      assert.equal(allows(path, userAgent), false, `${userAgent} must not fetch ${path}`);
    }
  });
}

test('one compact robots policy permits every HTML route and protects operational APIs for every crawler', async () => {
  const response = await fetch(`${baseUrl}/robots.txt`);
  const body = await response.text();
  assert.deepEqual(body.match(/^User-agent:.*$/gm), ['User-agent: *']);
  assert.deepEqual(body.match(/^Allow:.*$/gm), [
    'Allow: /api/users/search$',
    'Allow: /api/users/search?page=1&limit=20&sortBy=recent_favorites$',
  ]);
  assert.ok(body.split('\n').length < 40, 'No locale or bot multiplication');
  assert.equal(body.match(/^Sitemap:/gm)?.length, 2);
  assert.ok(body.endsWith('/sitemap-blog.xml'));
  assert.doesNotMatch(body, /Google-Extended|GPTBot|utm_|fbclid|gclid/);
  assert.ok(body.split('\n').filter(line => line.startsWith('Disallow:')).every(line => line.startsWith('Disallow: /api/')));

  const allows = parseRobotsRules(body);
  const readable = [
    '/', '/recommendations', '/trending', '/favorites', '/profile', '/admin', '/auth/login',
    '/en/station/premium', '/de/sender/admin', '/en/genres/trending', '/en/stations?page=2',
    '/en/regions/europe/germany/stations?page=2', '/en/about', '/en/blog/radio-data-usage',
    '/en/search?q=fixture', '/en/profile/settings', '/en/login', '/en/favorites', '/en/notifications',
    '/assets/app.js', '/assets/app.css', '/images/fixture.webp', '/station-logos/fixture.webp',
    '/api/image/fixture?w=256', '/api/og-image/fixture', '/api/stations?page=2',
    '/api/genres', '/api/regions', '/api/user-engagement/trending',
    '/api/user-engagement/community/favorites', '/api/recommendations/pool',
  ];
  for (const parameter of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid']) {
    readable.push(`/en/stations?page=2&${parameter}=fixture`);
  }
  const restricted = [
    '/api/admin', '/api/admin/', '/api/admin?probe=1', '/api/admin/stations',
    '/api/auth', '/api/auth/', '/api/auth/me', '/api/user/favorites', '/api/users/private-listener',
    '/api/sync/stations', '/api/test/probe', '/api/payments/checkout', '/api/iap/verify',
    '/api/push/register', '/api/stream/proxy', '/api/stream-analysis', '/api/stream-https-analysis',
    '/api/tv/session', '/api/analytics', '/api/messages/inbox', '/api/cast/session', '/api/ml/model',
    '/api/internal/stats', '/api/cache/keys', '/api/logs/recent',
  ];
  for (const agent of CRAWLERS) {
    for (const path of readable) assert.equal(allows(path, agent), true, `${agent}: ${path}`);
    for (const path of restricted) assert.equal(allows(path, agent), false, `${agent}: ${path}`);
  }
});

test('all14 languages and country aliases allow public discovery and private HTML noindex to be read', async () => {
  const body = await (await fetch(`${baseUrl}/robots.txt`)).text();
  const allows = parseRobotsRules(body);
  for (const locale of PUBLIC_SEO_LOCALE_CODES) {
    for (const root of ['trending', 'recommendations', 'favorites', 'profile', 'admin', 'settings', 'search']) {
      for (const agent of CRAWLERS) assert.equal(allows(`/${locale}/${root}`, agent), true);
    }
  }
  for (const language of QUALIFIED_LANGS) {
    for (const key of ['trending', 'recommendations', 'favorites', 'profile', 'login', 'search']) {
      const path = buildLocalizedUrl(`/${key}`, language, undefined, new Map());
      const encoded = `/${language}/${encodeURIComponent(URL_TRANSLATIONS[language]?.[key] || key)}`;
      for (const agent of CRAWLERS) {
        assert.equal(allows(path, agent), true, `${agent}: ${path}`);
        assert.equal(allows(encoded, agent), true, `${agent}: ${encoded}`);
      }
    }
  }
});

test('/sitemap.xml returns the sitemap-index XML directly (Task #128 contract)', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/sitemap.xml`);
  assert.equal(spaCalls, callsBefore, '/sitemap.xml must NOT fall through to the SPA catch-all');
  assert.equal(res.status, 200, '/sitemap.xml must serve the sitemap-index document directly');
  assert.match(res.headers.get('content-type') || '', /^application\/xml/);
  const body = await res.text();
  // Task #194: parser-validated XML (catches unclosed tags / bad entities
  // that regex-only assertions would miss).
  const parsed = assertValidXml(body, '/sitemap.xml') as {
    sitemapindex?: { '@_xmlns'?: string; sitemap?: Array<{ loc?: string }> };
  };
  assert.ok(parsed.sitemapindex, '/sitemap.xml root must be <sitemapindex>');
  assert.equal(
    parsed.sitemapindex['@_xmlns'],
    'http://www.sitemaps.org/schemas/sitemap/0.9',
    '/sitemap.xml must declare the sitemaps.org 0.9 namespace',
  );
  assert.match(body, /\/sitemap-main-en\.xml/);
});

test('/sitemap-index.xml returns application/xml 200 with one entry per qualified lang', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/sitemap-index.xml`);
  assert.equal(spaCalls, callsBefore);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^application\/xml/);
  const body = await res.text();
  // Task #194: parse the response and assert structurally rather than
  // by regex. Each qualified language must contribute exactly a main +
  // genres + stations entry (6 langs × 3 types = 18 child sitemaps).
  const parsed = assertValidXml(body, '/sitemap-index.xml') as {
    sitemapindex?: { sitemap?: Array<{ loc?: string; lastmod?: string }> };
  };
  assert.ok(parsed.sitemapindex, 'root must be <sitemapindex>');
  const entries = parsed.sitemapindex.sitemap ?? [];
  assert.ok(
    entries.length >= QUALIFIED_LANGS.length * 3,
    `expected >=${QUALIFIED_LANGS.length * 3} child sitemap entries, found ${entries.length}`,
  );
  const locs = new Set(entries.map((e) => e.loc ?? ''));
  for (const lang of QUALIFIED_LANGS) {
    const hasMain = [...locs].some((l) => l.endsWith(`/sitemap-main-${lang}.xml`));
    const hasGenres = [...locs].some((l) => l.endsWith(`/sitemap-genres-${lang}.xml`));
    const hasStations = [...locs].some((l) => l.endsWith(`/sitemap-stations-${lang}-1.xml`));
    assert.ok(hasMain, `index must contain /sitemap-main-${lang}.xml`);
    assert.ok(hasGenres, `index must contain /sitemap-genres-${lang}.xml`);
    assert.ok(hasStations, `index must contain /sitemap-stations-${lang}-1.xml`);
  }
});

test('/sitemap-main-en.xml returns application/xml 200 with >15 <loc> entries', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/sitemap-main-en.xml`);
  assert.equal(
    spaCalls,
    callsBefore,
    '/sitemap-main-:lang.xml param route must NOT fall through to the SPA catch-all',
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^application\/xml/);
  const body = await res.text();
  // Task #194: parser-validated XML structure.
  const parsed = assertValidXml(body, '/sitemap-main-en.xml') as {
    urlset?: {
      '@_xmlns'?: string;
      '@_xmlns:xhtml'?: string;
      url?: Array<{ loc?: string; 'xhtml:link'?: Array<{ '@_hreflang'?: string }> }>;
    };
  };
  assert.ok(parsed.urlset, 'root must be <urlset>');
  assert.equal(
    parsed.urlset['@_xmlns'],
    'http://www.sitemaps.org/schemas/sitemap/0.9',
    'urlset must declare the sitemaps.org 0.9 namespace',
  );
  const urls = parsed.urlset.url ?? [];
  assert.ok(
    urls.length > 15,
    `expected >15 <url> entries in /sitemap-main-en.xml, found ${urls.length}`,
  );
  // Cross-check the regex count to catch parser-quirk regressions.
  assert.equal(countLocs(body), urls.length, '<loc> count must equal parsed <url> count');
  // Smoke: a few canonical pages must be present.
  const locs = urls.map((u) => u.loc ?? '');
  assert.ok(locs.some((l) => /\/en$/.test(l) || /\/en\/?$/.test(l)), 'must include /en home');
  assert.ok(locs.some((l) => l.includes('/en/stations')), 'must include /en/stations');
  assert.ok(locs.some((l) => l.includes('/en/genres')), 'must include /en/genres');
});

test('/sitemap-main-en.xml emits hreflang alternates for every qualified language', async () => {
  const res = await fetch(`${baseUrl}/sitemap-main-en.xml`);
  const body = await res.text();
  // Task #194: parse and assert that EVERY <url> emits an alternate
  // for EVERY qualified language plus x-default — not just that the
  // hreflang token appears somewhere in the doc.
  const parsed = assertValidXml(body, '/sitemap-main-en.xml hreflang') as {
    urlset?: {
      url?: Array<{
        loc?: string;
        'xhtml:link'?: Array<{ '@_hreflang'?: string; '@_href'?: string }>;
      }>;
    };
  };
  const urls = parsed.urlset?.url ?? [];
  assert.ok(urls.length > 0, 'expected at least one <url> entry');
  for (const url of urls) {
    const langs = new Set(
      (url['xhtml:link'] ?? [])
        .map((link) => link['@_hreflang'])
        .filter((v): v is string => typeof v === 'string'),
    );
    for (const lang of QUALIFIED_LANGS) {
      assert.ok(
        langs.has(lang),
        `<url loc="${url.loc}"> missing hreflang="${lang}" alternate`,
      );
    }
    assert.ok(
      langs.has('x-default'),
      `<url loc="${url.loc}"> missing hreflang="x-default" alternate`,
    );
  }
});

test('SPA catch-all does NOT shadow any of the sitemap/robots routes', async () => {
  const callsBefore = spaCalls;
  const targets = [
    '/llms.txt',
    '/robots.txt',
    '/sitemap.xml',
    '/sitemap-index.xml',
    '/sitemap-main-en.xml',
  ];
  for (const target of targets) {
    const res = await fetch(`${baseUrl}${target}`);
    assert.equal(
      res.headers.get('x-spa-catchall'),
      null,
      `${target} must not be served by the SPA catch-all`,
    );
    assert.doesNotMatch(
      res.headers.get('content-type') || '',
      /text\/html/,
      `${target} must not return text/html (would serve React shell to crawlers)`,
    );
  }
  assert.equal(
    spaCalls,
    callsBefore,
    'none of the sitemap/robots routes may invoke the SPA catch-all',
  );
});

// ---------------------------------------------------------------------------
// Task #259: offline regression checks for /sitemap-genres-:lang.xml and
// /sitemap-stations-:lang-:chunk.xml. The index test above only proves the
// child URLs are *advertised*; without parsing the bodies, regressions in
// the genre/station handlers (missing slugs, broken hreflang, junk-station
// leak, malformed image:loc, 410-vs-503 contract on a missing chunk) would
// still slip through.
// ---------------------------------------------------------------------------

test('/sitemap-genres-en.xml returns parser-valid XML with expected genre <loc> entries', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/sitemap-genres-en.xml`);
  assert.equal(
    spaCalls,
    callsBefore,
    '/sitemap-genres-:lang.xml param route must NOT fall through to the SPA catch-all',
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^application\/xml/);
  const body = await res.text();
  const parsed = assertValidXml(body, '/sitemap-genres-en.xml') as {
    urlset?: {
      '@_xmlns'?: string;
      '@_xmlns:xhtml'?: string;
      url?: Array<{
        loc?: string;
        'xhtml:link'?: Array<{ '@_hreflang'?: string }>;
      }>;
    };
  };
  assert.ok(parsed.urlset, 'root must be <urlset>');
  assert.equal(
    parsed.urlset['@_xmlns'],
    'http://www.sitemaps.org/schemas/sitemap/0.9',
    'urlset must declare the sitemaps.org 0.9 namespace',
  );
  const urls = parsed.urlset.url ?? [];
  // Two safe genres ('pop', 'rock') must appear; the third ('bad slug!')
  // must be filtered by SAFE_SLUG_RE before emission.
  assert.equal(urls.length, 2, 'unsafe genre slug must be filtered out');
  const locs = urls.map((u) => u.loc ?? '');
  assert.ok(locs.some((l) => l.endsWith('/en/genres/pop')), 'must include pop genre');
  assert.ok(locs.some((l) => l.endsWith('/en/genres/rock')), 'must include rock genre');
  assert.ok(
    !locs.some((l) => l.includes('bad slug')),
    'unsafe slug must never reach the rendered XML',
  );
  // Cross-check regex count to catch parser-quirk regressions.
  assert.equal(countLocs(body), urls.length, '<loc> count must equal parsed <url> count');
});

test('/sitemap-genres-en.xml emits an alternate for every qualified language', async () => {
  const res = await fetch(`${baseUrl}/sitemap-genres-en.xml`);
  const body = await res.text();
  const parsed = assertValidXml(body, '/sitemap-genres-en.xml hreflang') as {
    urlset?: {
      url?: Array<{
        loc?: string;
        'xhtml:link'?: Array<{ '@_hreflang'?: string }>;
      }>;
    };
  };
  const urls = parsed.urlset?.url ?? [];
  assert.ok(urls.length > 0, 'expected at least one <url> entry');
  for (const url of urls) {
    const langs = new Set(
      (url['xhtml:link'] ?? [])
        .map((l) => l['@_hreflang'])
        .filter((v): v is string => typeof v === 'string'),
    );
    for (const lang of QUALIFIED_LANGS) {
      assert.ok(
        langs.has(lang),
        `<url loc="${url.loc}"> missing hreflang="${lang}" alternate`,
      );
    }
    assert.ok(
      langs.has('x-default'),
      `<url loc="${url.loc}"> missing hreflang="x-default" alternate`,
    );
  }
});

test('/sitemap-stations-en-1.xml returns parser-valid XML with stations in manifest order', async () => {
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
  assert.equal(
    spaCalls,
    callsBefore,
    '/sitemap-stations-:lang-:chunk.xml param route must NOT fall through to the SPA catch-all',
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^application\/xml/);
  const body = await res.text();
  const parsed = assertValidXml(body, '/sitemap-stations-en-1.xml') as {
    urlset?: {
      '@_xmlns'?: string;
      '@_xmlns:image'?: string;
      url?: Array<{
        loc?: string;
        'image:image'?: { 'image:loc'?: string };
      }>;
    };
  };
  assert.ok(parsed.urlset, 'root must be <urlset>');
  assert.equal(
    parsed.urlset['@_xmlns'],
    'http://www.sitemaps.org/schemas/sitemap/0.9',
    'urlset must declare the sitemaps.org 0.9 namespace',
  );
  assert.equal(
    parsed.urlset['@_xmlns:image'],
    'http://www.google.com/schemas/sitemap-image/1.1',
    'urlset must declare the image-sitemap namespace',
  );
  const urls = parsed.urlset.url ?? [];
  assert.equal(urls.length, 2, 'expected both fake stations to be emitted');
  const locs = urls.map((u) => u.loc ?? '');
  // Manifest order is ['s1', 's2'] — Mongo $in does not preserve order, so
  // the route re-orders by manifest. station-one must precede station-two.
  assert.ok(
    locs[0].endsWith('/en/station/station-one'),
    `expected station-one first, got ${locs[0]}`,
  );
  assert.ok(
    locs[1].endsWith('/en/station/station-two'),
    `expected station-two second, got ${locs[1]}`,
  );

  // Owned logos stay direct; external favicons match the visible SSR proxy.
  const s1 = urls[0];
  assert.ok(
    s1['image:image']?.['image:loc']?.includes('cdn.themegaradio.com'),
    'verified-host station must emit <image:loc>',
  );
  const s2 = urls[1];
  assert.equal(
    s2['image:image']?.['image:loc'],
    `https://themegaradio.com/api/image/${Buffer.from(FAKE_STATION_DOCS[1].favicon!).toString('base64url')}?w=256`,
    'external favicon is discovered through the owned image proxy',
  );
});

test('/sitemap-stations-en-1.xml drops noIndex / junk stations defensively at serve time', async () => {
  // Flip s1 to noIndex and s2 to an actual test feed. The route must
  // re-run getIndexableLanguagesForStation at serve time and exclude both,
  // even though the manifest still references them.
  const original: FakeStationDoc[] = FAKE_STATION_DOCS.map((s) => ({ ...s }));
  FAKE_STATION_DOCS[0].noIndex = true;
  FAKE_STATION_DOCS[1].slug = 'station-two-test-stream';
  try {
    // Bypass the cache hit from the previous test by invalidating the store.
    fakeCacheStore.clear();
    const res2 = await fetch(`${baseUrl}/sitemap-stations-en-1.xml`);
    assert.equal(res2.status, 503, 'an advertised chunk with no surviving URLs is retryable');
    assert.equal(res2.headers.get('cache-control'), 'no-store');
    const body = await res2.text();
    assert.doesNotMatch(body, /<urlset/);
    assert.ok(
      !body.includes('station-one') && !body.includes('station-two'),
      'stored noindex + test-feed stations must be filtered at serve time',
    );
  } finally {
    // Restore + clear cache so subsequent tests see clean state.
    FAKE_STATION_DOCS.splice(0, FAKE_STATION_DOCS.length, ...original);
    fakeCacheStore.clear();
  }
});

test('/sitemap-stations-en-99.xml returns 410 when the chunk is missing but the manifest exists', async () => {
  // Simulate "this chunk is permanently retired": getActiveStationChunk
  // returns null, but getActiveManifest('stations', 'en') still resolves
  // to a real manifest. The route must serve a 410 Gone, not 503.
  builderOverrides.getActiveStationChunk = async () => null;
  fakeCacheStore.clear();
  try {
    const res = await fetch(`${baseUrl}/sitemap-stations-en-99.xml`);
    assert.equal(res.status, 410, 'missing chunk + present manifest must be 410 Gone');
  } finally {
    builderOverrides.getActiveStationChunk = null;
    fakeCacheStore.clear();
  }
});

test('/sitemap-stations-en-99.xml returns 503 when no manifest exists yet (cold-boot)', async () => {
  // Simulate cold boot: neither the chunk nor any manifest is available.
  // The route must return 503 Service Unavailable + Retry-After so search
  // engines come back later instead of treating the URL as permanently gone.
  builderOverrides.getActiveStationChunk = async () => null;
  builderOverrides.getActiveManifest = async (type) =>
    type === 'stations' ? null : buildFakeManifest(type, 'en');
  fakeCacheStore.clear();
  try {
    const res = await fetch(`${baseUrl}/sitemap-stations-en-99.xml`);
    assert.equal(res.status, 503, 'missing chunk + missing manifest must be 503');
    assert.ok(res.headers.get('retry-after'), '503 must include a Retry-After header');
    assert.equal(
      res.headers.get('cache-control'),
      'no-store',
      '503 must be uncacheable so CDN does not pin a cold-boot error',
    );
  } finally {
    builderOverrides.getActiveStationChunk = null;
    builderOverrides.getActiveManifest = null;
    fakeCacheStore.clear();
  }
});

test('Task #344: every station-chunk URL the sitemap-index advertises resolves to 200 (not 410)', async () => {
  // Regression guard: the per-chunk route's `:chunk` regex `[1-9]\d{0,3}`
  // 410 Gones anything outside 1..9999. If a manifest writer ever drifts to
  // 0-based numbering (or stores a >4-digit value) the index would happily
  // tell Google to fetch a URL that immediately 410s — silently dropping
  // every station in that chunk from the index. Walk the live sitemap-index
  // and assert each advertised station-chunk URL fetches with a 200.
  fakeCacheStore.clear();
  const indexRes = await fetch(`${baseUrl}/sitemap-index.xml`);
  assert.equal(indexRes.status, 200);
  const indexBody = await indexRes.text();
  const parsed = assertValidXml(indexBody, '/sitemap-index.xml chunk-resolves') as {
    sitemapindex?: { sitemap?: Array<{ loc?: string }> };
  };
  const stationLocs = (parsed.sitemapindex?.sitemap ?? [])
    .map((s) => s.loc ?? '')
    .filter((l) => /\/sitemap-stations-[a-z]+-\d+\.xml$/.test(l));
  assert.ok(stationLocs.length > 0, 'index must advertise at least one station chunk');
  for (const loc of stationLocs) {
    const url = new URL(loc);
    const childRes = await fetch(`${baseUrl}${url.pathname}`);
    assert.notEqual(
      childRes.status,
      410,
      `index advertises ${url.pathname} but the route returned 410 — chunk numbering drifted`,
    );
    assert.equal(
      childRes.status,
      200,
      `index advertises ${url.pathname} but the route returned ${childRes.status}`,
    );
  }
});

test('Task #344: sitemap-index defensively skips a station chunk numbered 0 (would 410)', async () => {
  // Simulate a manifest-writer regression: a chunk lands with chunk=0. The
  // index must NOT emit `/sitemap-stations-en-0.xml` because that URL would
  // immediately 410 Gone and Google would drop the chunk's stations. The
  // index handler reads SitemapManifest.find directly, so mutate the en
  // stations manifest in FAKE_INDEX_MANIFESTS for the duration of the test.
  const enStations = FAKE_INDEX_MANIFESTS.find(
    (m) => m.type === 'stations' && m.language === 'en',
  );
  assert.ok(enStations, 'fixture must include an en stations manifest');
  const originalChunks = enStations.chunks;
  enStations.chunks = [
    { chunk: 0, urlCount: 50, maxUpdatedAt: NOW, stationIds: ['s1'] },
    { chunk: 1, urlCount: 50, maxUpdatedAt: NOW, stationIds: ['s2'] },
  ];
  fakeCacheStore.clear();
  try {
    const res = await fetch(`${baseUrl}/sitemap-index.xml`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(
      !body.includes('/sitemap-stations-en-0.xml'),
      'index must not advertise a chunk-0 URL (would 410 Gone)',
    );
    assert.ok(
      body.includes('/sitemap-stations-en-1.xml'),
      'index must still advertise the valid sibling chunk',
    );
  } finally {
    enStations.chunks = originalChunks;
    fakeCacheStore.clear();
  }
});

test('sitemap CSS is public, cache bounded and independent of DB, without an HTML fallback', async (t) => {
  const { registerSeoSitemapRoutes } = await import('../src/routes/seo-sitemap-routes');
  const fixtureApp = express();
  fixtureApp.use((_req, res, next) => {
    res.setHeader('Expires', 'Tue, 05 Nov 2030 00:00:00 GMT');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    next();
  });
  await registerSeoSitemapRoutes(fixtureApp, { requireAdmin: (_req, res) => res.status(403).end() });
  const fixtureServer = fixtureApp.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>(resolve => fixtureServer.close(() => resolve())));
  await new Promise<void>(resolve => fixtureServer.once('listening', resolve));
  const url = `http://127.0.0.1:${(fixtureServer.address() as AddressInfo).port}/sitemap.css`;
  const readsBefore = fakeCacheReads.length;
  stationBatchReadFails = true;
  try {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(url, { method });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=3600, s-maxage=3600');
      assert.equal(response.headers.get('expires'), null);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(await response.text(), method === 'HEAD' ? '' : SITEMAP_STYLESHEET);
    }
    assert.equal(fakeCacheReads.length, readsBefore);
  } finally { stationBatchReadFails = false; }
});

test('all sitemap families retain parser-valid XML with one CSS instruction and representation validators', async () => {
  fakeCacheStore.clear();
  const paths = ['/sitemap.xml', '/sitemap-index.xml', '/sitemap-blog.xml',
    ...QUALIFIED_LANGS.flatMap(lang => [`/sitemap-${lang}.xml`, `/sitemap-main-${lang}.xml`, `/sitemap-genres-${lang}.xml`, `/sitemap-stations-${lang}-1.xml`])];
  for (const path of paths) {
    const response = await fetch(baseUrl + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') || '', /^application\/xml/);
    const body = await response.text();
    assertValidXml(body, path);
    assert.equal(body.split(SITEMAP_STYLESHEET_INSTRUCTION).length - 1, 1, path);
    assert.ok(body.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n${SITEMAP_STYLESHEET_INSTRUCTION}`));
    assert.equal(response.headers.get('etag'), xmlCacheFixture(body).etag);
    assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(body));
    assert.equal(response.headers.get('x-spa-catchall'), null);
    const conditional = await fetch(baseUrl + path, { headers: { 'If-None-Match': response.headers.get('etag')! } });
    assert.equal(conditional.status, 304, path);
    assert.equal(await conditional.text(), '');
  }
  fakeCacheStore.clear();
});

test('CSS presentation invalidates old XML body and validator-only caches without changing sitemap data', async () => {
  const suffix = `en:${TEST_HASH}:v1-test:${NOW.getTime()}`;
  const paths = [
    ['/sitemap-main-en.xml', `sitemap:main:xml-v3:${suffix}`],
    ['/sitemap-genres-en.xml', `sitemap:genres:xml-v3:${suffix}`],
    ['/sitemap-stations-en-1.xml', `sitemap:stations:xml-v5-az-safe-owned-images:en:1:${TEST_HASH}:v1-test:${NOW.getTime()}`],
  ];
  try {
    for (const [path, oldKey] of paths) {
      fakeCacheStore.clear();
      const body = await (await fetch(baseUrl + path)).text();
      const old = xmlCacheFixture(body.replace(`\n${SITEMAP_STYLESHEET_INSTRUCTION}`, ''));
      for (const validatorOnly of [false, true]) {
        fakeCacheStore.clear();
        if (!validatorOnly) fakeCacheStore.set(oldKey, old);
        fakeCacheStore.set(`${oldKey}:validator`, { etag: old.etag });
        fakeCacheReads.length = 0;
        const response = await fetch(baseUrl + path, { headers: { 'If-None-Match': old.etag } });
        assert.equal(response.status, 200, `${path} must not reuse an unstyled validator`);
        assert.equal(await response.text(), body, 'Only the presentation instruction changes');
        assert.equal(response.headers.get('etag'), xmlCacheFixture(body).etag);
        assert.equal(fakeCacheReads.includes(oldKey), false);
        assert.equal(fakeCacheReads.includes(`${oldKey}:validator`), false);
        assert.equal(fakeCacheStore.has(`${oldKey}:validator`), true, 'No global purge');
        const conditional = await fetch(baseUrl + path, { headers: { 'If-None-Match': response.headers.get('etag')! } });
        assert.equal(conditional.status, 304);
        assert.equal(await conditional.text(), '');
      }
    }
  } finally { fakeCacheStore.clear(); }
});

test('blog sitemap serves core editions plus actual market articles with editorial validators', async () => {
  const response = await fetch(`${baseUrl}/sitemap-blog.xml`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /xml/);
  const parsed = assertValidXml(await response.text(), 'blog sitemap') as any;
  const marketCount = Object.keys(MARKET_BLOG_MANIFEST).length;
  assert.equal(parsed.urlset.url.length, 154 + marketCount);
  for (const guide of LEGACY_STATION_GUIDES) assert.equal(parsed.urlset.url.filter((entry: any) => entry.loc === `https://themegaradio.com${guide.path}`).length, 0);
  assert.equal(parsed.urlset.url.filter((entry: any) => entry['image:image']).length, 140 + marketCount);
  assert.equal(response.headers.get('last-modified'), new Date(BLOG_SITEMAP_UPDATED).toUTCString());
  const indexResponse = await fetch(`${baseUrl}/sitemap-index.xml`);
  const index = assertValidXml(await indexResponse.text(), 'blog parent index') as any;
  assert.equal(index.sitemapindex.sitemap.find((entry: any) => entry.loc.endsWith('/sitemap-blog.xml')).lastmod, BLOG_SITEMAP_UPDATED);
  const cached = await fetch(`${baseUrl}/sitemap-blog.xml`, { headers: { 'If-None-Match': response.headers.get('etag')! } });
  assert.equal(cached.status, 304);
  assert.ok((await (await fetch(`${baseUrl}/robots.txt`)).text()).includes('/sitemap-blog.xml'));
});

test('blog slim metadata uses actual editions, returns404 for absent locales and503 for failures', async () => {
  const path = '/tr/blog/kral-fm-canli-dinle-sorunlari';
  const valid = await fetch(`${baseUrl}/api/seo/page-data?url=${encodeURIComponent(path)}&slim=1`);
  assert.equal(valid.status, 200);
  const payload = await valid.json() as any;
  assert.equal(payload.seoTags.canonical, `https://themegaradio.com${path}`);
  assert.deepEqual(payload.seoTags.hreflangs.map((entry: any) => entry.hreflang), ['tr']);
  assert.equal(payload.structuredData.page.find((entry: any) => entry['@type'] === 'BlogPosting').datePublished, '2026-10-27T00:00:00+01:00');
  const absent = await fetch(`${baseUrl}/api/seo/page-data?url=/en/blog/kral-fm-canli-dinle-sorunlari&slim=1`);
  assert.equal(absent.status, 404);
  const missing = await absent.json() as any;
  assert.equal(missing.seoTags.noIndex, true);
  assert.equal(missing.seoTags.canonical, undefined);
  assert.deepEqual(missing.seoTags.hreflangs, []);
  const { SeoRenderer } = await import('../src/seo-renderer');
  const failure = mock.method(SeoRenderer.prototype, 'renderStaticPage', async () => { throw new Error('Editorial chunk temporarily unavailable'); });
  try {
    const temporary = await fetch(`${baseUrl}/api/seo/page-data?url=${encodeURIComponent(path)}&slim=1`);
    assert.equal(temporary.status, 503);
    assert.equal(temporary.headers.get('cache-control'), 'no-store');
    assert.ok(temporary.headers.get('retry-after'));
  } finally { failure.mock.restore(); }
});

test('A clearly-unmatched path DOES fall through to the SPA catch-all (negative control)', async () => {
  // Sanity check that the SPA tracer is actually wired and would catch a
  // regression — without this, an always-true assertion above would lie.
  const callsBefore = spaCalls;
  const res = await fetch(`${baseUrl}/__definitely-not-a-real-route__`);
  assert.equal(res.headers.get('x-spa-catchall'), '1');
  assert.equal(spaCalls, callsBefore + 1);
});


test('manual radio report reaches the persistence adapter and the protected admin error-log list', async () => {
 const stationId='offline-test-station';
 const response=await fetch(`${baseUrl}/api/stations/report-error`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stationId,stationName:'Offline test radio',stationUrl:'https://stream.example.invalid/live',errorType:'USER_REPORT',errorMessage:'Decoder failed',errorDetails:{source:'mobile-player',userInitiated:true},browserInfo:{platform:'ios',language:'tr'}})});
 assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.success,true);assert.equal(receipt.errorId,'test-report-receipt');
 const saved=playbackReports.find(row=>row.stationId===stationId)!;assert.equal(saved.errorType,'USER_REPORT');assert.equal(saved.errorDetails.userInitiated,true);assert.equal(saved.isResolved,false);
 assert.equal((await fetch(`${baseUrl}/api/admin/error-logs?stationId=${stationId}`)).status,403);
 const admin=await fetch(`${baseUrl}/api/admin/error-logs?stationId=${stationId}`,{headers:{'x-test-admin':'allowed'}});assert.equal(admin.status,200);
 const data=await admin.json();assert.equal(data.pagination.total,1);assert.equal(data.errors[0].stationId,stationId);assert.equal(data.errors[0].errorType,'USER_REPORT');
});
test('manual sitemap rebuild never reports busy or unavailable builds as fresh success', async () => {
  for (const [reason, status, code] of [
    ['build-in-progress', 409, 'sitemap_build_in_progress'],
    ['qualified-languages-unavailable', 503, 'sitemap_build_unavailable'],
    ['fresh', 503, 'sitemap_build_unavailable'],
  ] as const) {
    manualBuildResult = { built: false, skippedReason: reason, qualifiedLanguages: [], activatedCount: 0 };
    const response = await fetch(`${baseUrl}/api/admin/sitemap/rebuild`, {
      method: 'POST', headers: { 'x-fixture-admin': 'manual-build' },
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('retry-after'), '60');
    const body = await response.json() as any;
    assert.equal(body.ok, false);
    assert.equal(body.error, code);
    assert.ok(body.message);
  }
  assert.equal((await fetch(`${baseUrl}/api/admin/sitemap/rebuild`, { method: 'POST' })).status, 403);
});
