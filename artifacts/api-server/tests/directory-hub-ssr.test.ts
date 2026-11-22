import { genreDisplayName } from '@workspace/seo-shared/genre-localization';
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { buildDirectoryIndexSeo } from '@workspace/seo-shared/directory-index-seo';
import { getLocalizedCountryName, getLocalizedRegionName } from '@workspace/seo-shared/country-name-translations';
import { buildLocalizedUrl } from '../src/seo/url-helpers';

const pageCache = new Map<string, any>(), allowed = new Set(['pop', 'rock', 'jazz', 'thin']);
const queries: string[] = [];
let failRead = false;
let genreRows: Array<{ id: string; slug: string; name: string; station_count: number; is_discoverable: boolean; source?: Record<string, unknown> }> = [
  { id: 'rock', slug: 'rock', name: 'Rock', station_count: 80, is_discoverable: true },
  { id: 'pop', slug: 'pop', name: 'Pop', station_count: 120, is_discoverable: true },
  { id: 'thin', slug: 'thin', name: 'Thin', station_count: 1, is_discoverable: true },
  // Not featured is not a directory ban; this fixture is explicitly demoted.
  { id: 'jazz', slug: 'jazz', name: 'Jazz', station_count: 75, is_discoverable: false, source: { cleanupDemotion: true } },
  { id: '105', slug: '105', name: '105', station_count: 10000, is_discoverable: true },
];
let countryRows = [{ name: 'Germany' }, { name: 'Austria' }, { name: 'Turkey' }, { name: 'Türkiye' }, { name: 'Unknown Place' }];
const pool = { query: async (sql: string, values?: unknown[]) => {
  queries.push(sql); if (failRead) throw new Error('temporary reference read failure');
  if (sql.includes('FROM station_genres sg JOIN stations s ON s.id=sg.station_id')) {
    // Return the small per-genre visible-count aggregate, not full stations or
    // the stale genres.station_count snapshot. Native SQL tests cover counts.
    assert.match(sql, /s\.is_list_visible IS TRUE OR COALESCE\(s\.visibility_expires_at<=now\(\),false\)/);
    assert.doesNotMatch(sql, /s\.last_check_ok IS TRUE/, 'Provider uncertainty must not exclude a visible station');
    assert.match(sql, /count\(DISTINCT sg\.station_id\)::int station_count/);
    assert.match(sql, /GROUP BY sg\.genre_slug/);
    assert.deepEqual(values, ['']);
    return { rows: genreRows };
  }
  if (sql === 'SELECT name FROM countries ORDER BY name') return { rows: countryRows };
  throw new Error(`Unexpected DB query: ${sql}`);
} };
mock.module('../src/postgres-runtime', { namedExports: { getPostgresPool: () => pool, getPostgresCoordinationPool: () => pool } });
mock.module('../src/seo/genre-whitelist-store', { namedExports: {
  getMergedWhitelist: () => allowed, getMergedAliases: () => new Map(),
  ensureGenreWhitelistFresh: async () => { throw new Error('Directory hubs must not refresh editorial ownership'); },
} });
mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  getPageData: (key: string) => pageCache.get(key), setPageData: (key: string, value: any) => pageCache.set(key, value),
  getTranslations: () => ({}), getUrlTranslations: async () => new Map(),
} } });
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => null } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
mock.module('../src/seo/qualified-languages', { namedExports: { getCachedQualifiedLanguages: async () => [...ACTIVE_SITEMAP_LANGUAGES] } });
mock.module('../src/data/postgres-seo-read-store', { namedExports: { pgSeoCatalog: () => {
  throw new Error('Hub must not scan the station catalogue');
} } });
const { SeoRenderer } = await import('../src/seo-renderer');
const { loadGenreDirectoryHub, loadRegionDirectoryHub, loadContinentDirectory, DIRECTORY_GENRE_LIMIT, DIRECTORY_COUNTRIES_PER_REGION } = await import('../src/seo/directory-hub-data');
const renderer = new SeoRenderer();
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
beforeEach(() => { queries.length = 0; pageCache.clear(); failRead = false; allowed.add('rock'); });

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  for (const kind of ['genres', 'regions'] as const) {
    test(`${language}/${kind} raw SSR contains localized content and canonical native directory links`, async () => {
      const path = buildLocalizedUrl(`/${kind}`, language, undefined, new Map());
      const page = await renderer.renderStaticPage(path, 'https://themegaradio.com');
      const body = renderer.generateHtmlBody({ pageType: kind, language, translations: {}, additionalData: page.pageData.additionalData, cleanPath: `/${kind}`, urlTranslations: page.urlTranslations });
      const text = buildDirectoryIndexSeo(kind, language);
      assert.equal((body.match(/<h1\b/g) || []).length, 1);
      assert.ok(body.includes(`<h1>${escape(text.h1)}</h1>`));
      assert.ok(body.includes(escape(text.description)));
      assert.ok(body.includes(`lang="${language}" dir="${['ar', 'he'].includes(language) ? 'rtl' : 'ltr'}"`));
      if (kind === 'genres') {
        for (const slug of ['pop', 'rock']) assert.ok(body.includes(`href="${escape(path + '/' + slug)}"`));
        assert.ok(!body.includes('/105"') && !body.includes('/jazz"') && !body.includes('/thin"'));
        const schemas = renderer.generateStructuredData(page.seoTags, language, {}, page.cleanPath,
          undefined, page.urlTranslations, page.pageData.additionalData);
        const list = schemas.page.find((schema: any) => schema['@type'] === 'ItemList');
        assert.ok(list, 'The native genre directory is also machine-readable');
        assert.equal(list.numberOfItems, 2);
        assert.deepEqual(list.itemListElement, page.pageData.directoryGenres.map((genre: any, index: number) => ({
          '@type': 'ListItem', position: index + 1, name: genreDisplayName(genre, language),
          url: `https://themegaradio.com${path}/${encodeURIComponent(genre.slug)}`,
        })));
        const collection = schemas.page.find((schema: any) => schema['@type'] === 'CollectionPage');
        assert.deepEqual(collection.mainEntity, list);
        assert.ok(list.itemListElement.every((item: any) => body.includes(`href="${escape(new URL(item.url).pathname)}"`)));
      } else {
        const germany = buildLocalizedUrl('/regions/europe/germany', language, undefined, new Map());
        assert.ok(body.includes(`href="${escape(germany)}"`));
        assert.ok(body.includes(escape(getLocalizedCountryName('Germany', language))));
        assert.ok(body.includes(escape(getLocalizedRegionName('Europe', language))));
        assert.equal((body.match(/<section>/g) || []).length, 6);
        assert.ok(!body.includes('unknown-place'));
      }
      assert.equal(queries.length, 1, 'One bounded-result native aggregate/reference read per cold hub');
      await renderer.renderStaticPage(path, 'https://themegaradio.com');
      assert.equal(queries.length, 1, 'Existing pageData cache eliminates repeated reads');
      assert.ok(!queries.some(sql => /legacy|mongo|SELECT\s+s\.\*|\bs\.(?:source|descriptions)\b/i.test(sql)), 'Hubs never hydrate the station catalogue or archived articles');
      if (kind === 'regions') assert.ok(!queries.some(sql => /\bstations\b|\bstation_genres\b/i.test(sql)));
    });
  }
}
test('warm genre hub cache follows whitelist removals immediately', async () => {
  const first = await renderer.renderStaticPage('/en/genres', 'https://themegaradio.com');
  assert.equal(first.pageData.directoryGenres.length, 2);
  allowed.delete('rock');
  const second = await renderer.renderStaticPage('/en/genres', 'https://themegaradio.com');
  assert.deepEqual(second.pageData.directoryGenres.map((genre: any) => genre.slug), ['pop']);
  assert.equal(queries.length, 2);
});

test('an unfeatured but healthy whitelisted genre remains browseable; explicit cleanup demotion is respected', async () => {
  const jazz = genreRows.find(row => row.slug === 'jazz')!;
  const original = jazz.source;
  try {
    assert.ok(!(await loadGenreDirectoryHub()).some(genre => genre.slug === 'jazz'));
    jazz.source = undefined;
    assert.ok((await loadGenreDirectoryHub()).some(genre => genre.slug === 'jazz'));
    assert.equal(jazz.is_discoverable, false, 'Feature-tile preference is not changed');
  } finally { jazz.source = original; }
});
test('failed hub reads are not cached as permanent empty navigation', async () => {
  failRead = true;
  const failed = await renderer.renderStaticPage('/en/regions', 'https://themegaradio.com');
  assert.equal(failed.pageData.hubReadFailed, true); assert.equal(failed.pageData.stationDbError, true); assert.equal(pageCache.size, 0);
  failRead = false;
  const recovered = await renderer.renderStaticPage('/en/regions', 'https://themegaradio.com');
  assert.equal(recovered.pageData.directoryRegions.length, 6); assert.equal(queries.length, 2);
});

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}/regions/europe renders a crawlable country directory without querying stations`, async () => {
    const path = buildLocalizedUrl('/regions/europe', language, undefined, new Map());
    const page = await renderer.renderStaticPage(path, 'https://themegaradio.com');
    const body = renderer.generateHtmlBody({ pageType: 'regions', language, translations: {}, additionalData: page.pageData.additionalData, cleanPath: page.cleanPath, urlTranslations: page.urlTranslations });
    assert.equal((body.match(/<h1\b/g) || []).length, 1);
    assert.ok(body.includes(escape(getLocalizedRegionName('Europe', language))));
    for (const country of ['germany', 'austria']) {
      assert.ok(body.includes(`href="${buildLocalizedUrl(`/regions/europe/${country}`, language, undefined, new Map())}"`));
    }
    assert.ok(!body.includes('/turkey"'));
    assert.ok(body.includes('class="country-directory"'));
    assert.equal(page.seoTags.canonical, `https://themegaradio.com${path}`);
    assert.equal(page.seoTags.hreflangs.length, ACTIVE_SITEMAP_LANGUAGES.length + 1);
    assert.notEqual(page.seoTags.noIndex, true);
    assert.equal(queries.length, 1);
    await renderer.renderStaticPage(path, 'https://themegaradio.com');
    assert.equal(queries.length, 1);
  });
}

test('continent required-reference failure is retryable and not cached as an empty indexable page', async () => {
  failRead = true;
  const failed = await renderer.renderStaticPage('/en/regions/europe', 'https://themegaradio.com');
  assert.equal(failed.pageData.stationDbError, true);
  assert.equal(failed.pageData.notFound, false);
  assert.equal(pageCache.size, 0);
  failRead = false;
  const recovered = await renderer.renderStaticPage('/en/regions/europe', 'https://themegaradio.com');
  assert.equal(recovered.pageData.stationDbError, undefined);
  assert.equal(recovered.pageData.continentDirectory.countries.length, 2);
});
test('hub bounds, alias deduplication, safe slugs and name escaping preserve curated identity', async () => {
  const originalGenres = genreRows, originalCountries = countryRows;
  try {
    genreRows = Array.from({ length: 90 }, (_, n) => ({ id: `id-${n}`, slug: `genre-${n}`, name: '<b>Editor & name</b>', station_count: n + 10, is_discoverable: true }));
    genreRows.forEach(row => allowed.add(row.slug));
    const genres = await loadGenreDirectoryHub(); assert.equal(genres.length, DIRECTORY_GENRE_LIMIT);
    countryRows = [{ name: 'Germany' }, { name: 'Deutschland' }, { name: 'Austria' }, { name: 'France' }, { name: 'Italy' }, { name: 'Spain' }, { name: 'Portugal' }, { name: 'Belgium' }, { name: 'Netherlands' }, { name: 'Denmark' }, { name: 'Sweden' }];
    const regions = await loadRegionDirectoryHub();
    assert.equal(regions.find(region => region.slug === 'europe')!.countries.length, DIRECTORY_COUNTRIES_PER_REGION);
    assert.equal(regions.flatMap(region => region.countries).filter(country => country.slug === 'germany').length, 1);
    const europe = await loadContinentDirectory('europe');
    assert.equal(europe!.countries.length, 10, 'Continent directory exposes countries beyond the parent eight-link cap');
    assert.equal(await loadContinentDirectory('not-a-continent'), null);
    const html = renderer.generateHtmlBody({ pageType: 'genres', language: 'de', translations: {}, additionalData: { directoryGenres: genres } });
    assert.ok(html.includes('&lt;b&gt;Editor &amp; name&lt;/b&gt;')); assert.ok(!html.includes('<b>Editor'));
  } finally { genreRows = originalGenres; countryRows = originalCountries; }
});


test('translated genre names agree between SSR visible links and ItemList without changing slugs',()=>{
 const additionalData={directoryGenres:[{slug:'news',name:'News'},{slug:'classical',name:'Classical'}]};
 const body=renderer.generateHtmlBody({pageType:'genres',language:'tr',translations:{},additionalData,cleanPath:'/genres',urlTranslations:new Map()});
 assert.ok(body.includes('Haberler'));assert.ok(body.includes('Klasik'));
 assert.ok(body.includes('/news"'));assert.ok(body.includes('/classical"'));
 const schema=renderer.generateStructuredData({},'tr',{},'/genres',undefined,new Map(),additionalData).page.find((s:any)=>s['@type']==='ItemList');
 assert.deepEqual(schema.itemListElement.map((s:any)=>s.name),['Haberler','Klasik']);
 assert.equal(additionalData.directoryGenres[0].name,'News','raw catalogue cache must not be rewritten');
});
