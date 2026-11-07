import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES, generateLanguageUrls, getLanguageFromPath, truncateAtWordBoundary } from '@workspace/seo-shared/seo-config';
import { getIndexableLanguagesForStation, isStationIndexableInLanguage } from '../src/seo/junk-station-rules';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { getStationStreamUnavailableNotice } from '@workspace/seo-shared/station-page-copy';
import { buildTemplateDescription } from '@workspace/seo-shared/station-description-template';
import { getLocalizedCountryName, getLocalizedRegionName } from '@workspace/seo-shared/country-name-translations';

const pageCache = new Map<string, any>();
let databaseFails = false;
let qualificationFails = false;
let missing = false;
let noIndex = false;
let stationReads = 0;
let stationOverrides: Record<string, any> = {};
let customMetadata: Record<string, any> | null = null;
let mergedAlias: Record<string, any> | null = null;
let exactLookupFixtures: Map<string, any> | null = null;
let qualifiedLanguages = ['en'];
let relatedReads: Array<{ filter: any; options: any }> = [];
let relatedCards: any[] = [];
const station = { _id: 'test-station', name: 'Recovery FM', slug: 'recovery-fm', url: 'https://stream.example.invalid/live', country: 'Germany', tags: 'pop', lastCheckOk: true };
mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  getPageData: (key: string) => pageCache.get(key),
  setPageData: (key: string, value: any) => pageCache.set(key, value),
  getTranslations: () => ({}),
  getUrlTranslations: async () => new Map<string, string>(),
} } });
mock.module('../src/data/postgres-seo-read-store', { namedExports: { pgSeoCatalog: () => ({
  findOne: async (query: any) => {
    stationReads++;
    if (databaseFails) throw new Error('temporary PostgreSQL read outage');
    if (exactLookupFixtures) {
      const value = exactLookupFixtures.get(query.slug ? `slug:${query.slug}` : `alias:${query.slugAliases}`);
      return typeof value === 'function' ? value() : value ?? null;
    }
    return missing ? null : { ...station, ...stationOverrides, noIndex };
  },
  find: async (filter: any, options: any) => {
    relatedReads.push({ filter, options });
    return relatedCards;
  }, count: async () => 0, groupCount: async () => [],
  findMergedAlias: async () => mergedAlias,
}) } });
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => customMetadata } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {} } });
mock.module('../src/seo/qualified-languages', { namedExports: { getCachedQualifiedLanguages: async () => {
  if (qualificationFails) throw new Error('temporary qualification outage');
  return qualifiedLanguages;
} } });
const { SeoRenderer } = await import('../src/seo-renderer');
const renderer = new SeoRenderer();
for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: region breadcrumbs share valid location paths for visible HTML and structured data`, () => {
    const routes = URL_TRANSLATIONS[language] || {};
    const root = `/${language}/${routes.regions || 'regions'}`;
    const stationSegment = routes.stations || 'stations';
    const overrides = new Map(Object.entries(routes).map(([key, value]) => [`${language}:${key}`, value]));
    const label = (key: string, fallback: string) => ({ nav_regions: 'Radio by Country', nav_stations: 'All Stations' }[key] || fallback);
    for (const mapping of [overrides, undefined]) {
      const cityItems = (renderer as any).computeBreadcrumbItems(language,
        '/regions/europe/germany/berlin/stations', mapping, undefined, label);
      assert.deepEqual(cityItems, [
        { name: 'Home', path: `/${language}` },
        { name: 'Radio by Country', path: root },
        { name: getLocalizedRegionName('Europe', language), path: `${root}/europe` },
        { name: getLocalizedCountryName('Germany', language), path: `${root}/europe/germany` },
        { name: 'Berlin', path: `${root}/europe/germany/berlin/${stationSegment}` },
      ]);
      const countryItems = (renderer as any).computeBreadcrumbItems(language,
        '/regions/europe/germany/stations', mapping, undefined, label);
      assert.deepEqual(countryItems.map((item: any) => item.path), [
        `/${language}`, root, `${root}/europe`, `${root}/europe/germany/${stationSegment}`,
      ]);
    }
  });

  test(`${language}: station collection breadcrumb uses the real plural directory with and without cached overrides`, () => {
    const expected = URL_TRANSLATIONS[language]?.stations || 'stations';
    const overrides = new Map(Object.entries(URL_TRANSLATIONS[language] || {}).map(([key, value]) => [`${language}:${key}`, value]));
    overrides.set(`${language}:station`, 'detail-only-prefix');
    for (const mapping of [overrides, undefined]) {
      const items = (renderer as any).computeBreadcrumbItems(language, '/station/kral-fm', mapping,
        { name: 'KRAL FM' }, (key: string, fallback: string) => key === 'nav_stations' ? 'Directory' : fallback);
      assert.equal(items.find((item: any) => item.name === 'Directory')?.path, `/${language}/${expected}`);
      assert.notEqual(items.find((item: any) => item.name === 'Directory')?.path, `/${language}/detail-only-prefix`);
    }
  });
}
for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: profile breadcrumbs link to the single settings screen and omit the duplicate settings crumb`, () => {
    const routes = URL_TRANSLATIONS[language] || {};
    const expected = `/${language}/${routes.profile || 'profile'}/${routes.settings || 'settings'}`;
    const overrides = new Map(Object.entries(routes).map(([key, value]) => [`${language}:${key}`, value]));
    for (const mapping of [overrides, undefined]) {
      const label = (_key: string, fallback: string) => fallback;
      const profile = (renderer as any).computeBreadcrumbItems(language, '/profile/settings', mapping, undefined, label);
      assert.deepEqual(profile, [{ name: 'Home', path: `/${language}` }, { name: 'Profile', path: expected }]);
      for (const child of ['favorites', 'followers', 'following']) {
        const items = (renderer as any).computeBreadcrumbItems(language, `/profile/${child}`, mapping, undefined, label);
        assert.equal(items.length, 3);
        assert.equal(items[1].path, expected);
      }
    }
  });
}
const url = '/en/station/recovery-fm';
beforeEach(() => {
  pageCache.clear(); databaseFails = false; qualificationFails = false;
  missing = false; noIndex = false; stationReads = 0;
  stationOverrides = {}; qualifiedLanguages = ['en']; customMetadata = null;
  mergedAlias = null;
  exactLookupFixtures = null;
  relatedReads = [];
  relatedCards = [];
});

test('station cross-links read compact native cards, retaining identity, visibility and ranking filters', async () => {
  stationOverrides = { state: 'Berlin' };
  relatedCards = [
    { _id: 'test-station', name: 'Recovery FM', slug: 'recovery-fm', country: 'Germany', isListVisible: true },
    { _id: 'related', name: 'Related Radio', slug: 'related-radio', country: 'Germany', isListVisible: true },
  ];
  const result = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(result.pageData.station.name, 'Recovery FM');
  assert.equal(relatedReads.length, 3);
  for (const { filter, options } of relatedReads) {
    assert.deepEqual(options.fields, ['name', 'slug', 'favicon', 'logoAssets', 'country', 'countryCode', 'tags', 'votes']);
    assert.equal(filter.noIndex.$ne, true);
    assert.equal(filter.isListVisible, true);
    assert.equal(filter._id, undefined, 'self exclusion happens after the shared country/state/publisher query');
    assert.equal(typeof options.sharedCardsKey, 'string');
    assert.deepEqual(options.sort, { votes: -1 });
  }
  assert.deepEqual(relatedReads.map(read => read.options.limit), [9, 7, 8]);
  assert.deepEqual(result.pageData.additionalData.crossLinks.samePublisher.map((row: any) => row.slug), ['related-radio']);
  const body = renderer.generateHtmlBody({ pageType: 'station', stationData: result.pageData.station,
    additionalData: result.pageData.additionalData, language: 'en', translations: {}, seoTags: result.seoTags });
  assert.ok(body.includes('/en/station/related-radio'));
});

for (const fixture of [
  { country: 'Unknown', countryCode: undefined, expected: '' },
  { country: 'N/A', countryCode: 'ZZ', expected: '' },
  { country: '', countryCode: undefined, expected: '' },
  { country: 'Unknown', countryCode: 'DE', expected: 'Germany' },
  { country: undefined, countryCode: 'TR', expected: 'Türkiye' },
  { country: 'The United States Of America', countryCode: 'US', expected: 'The United States Of America' },
]) {
  test(`same-country SSR query respects stable country identity: ${fixture.country}/${fixture.countryCode}`, async () => {
    stationOverrides = { country: fixture.country, countryCode: fixture.countryCode };
    await renderer.renderStaticPage(url, 'https://themegaradio.com');
    const countryReads = relatedReads.filter(read => Object.hasOwn(read.filter, 'country'));
    assert.deepEqual(countryReads.map(read => read.filter.country), fixture.expected ? [fixture.expected] : []);
    assert.equal(relatedReads.length, fixture.expected ? 2 : 1, 'unknown geography cannot start a country lookup');
  });
}

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: raw and encoded Unicode station slugs resolve the same exact identity`, async () => {
    qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
    const detail = URL_TRANSLATIONS[language]?.station || 'station';
    for (const slug of ['şeker-fm', 'радио-волна', '音乐之声']) {
      const identity = { ...station, _id: `unicode-${slug}`, slug, noIndex: false,
        descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang,
          { full: `Original station information for ${lang}`, meta: `Station summary ${lang}` }])) };
      exactLookupFixtures = new Map([[`slug:${slug}`, identity]]);
      for (const path of [`/${language}/${detail}/${slug}`, `/${language}/${encodeURIComponent(detail)}/${encodeURIComponent(slug)}`]) {
        pageCache.clear(); stationReads = 0;
        assert.equal(getLanguageFromPath(path).cleanPath.replace(/^\/stations\//, '/station/'), `/station/${slug}`, path);
        const result = await renderer.renderStaticPage(path, 'https://themegaradio.com');
        assert.equal(result.pageData?.station?._id, identity._id, path);
        assert.equal(result.pageData?.notFound, false, path);
        assert.equal(result.pageData?.stationIsJunk, false, path);
        assert.equal(result.pageData?.stationDbError, undefined, path);
        assert.equal(result.pageData?.redirectTo, undefined, path);
        assert.equal(result.seoTags.noIndex, undefined, path);
        assert.equal(stationReads, 1, 'an exact Unicode owner needs no alias fallback');
      }
    }
  });

  test(`${language}: malformed and double-encoded station escapes do not throw or match another owner`, async (t) => {
    t.mock.method(console, 'warn', () => {});
    const detail = URL_TRANSLATIONS[language]?.station || 'station';
    exactLookupFixtures = new Map([['slug:şeker-fm', { ...station, slug: 'şeker-fm', noIndex: false }]]);
    for (const [slug, decodedSlug] of [
      ['bad%', 'bad%'],
      ['%ZZ-fm', '%ZZ-fm'],
      ['%E0%A4%A-fm', '%E0%A4%A-fm'],
      ['%25C5%259Feker-fm', '%C5%9Feker-fm'],
    ]) {
      const path = `/${language}/${encodeURIComponent(detail)}/${slug}`;
      pageCache.clear();
      assert.equal(getLanguageFromPath(path).cleanPath.replace(/^\/stations\//, '/station/'), `/station/${decodedSlug}`);
      const result = await renderer.renderStaticPage(path, 'https://themegaradio.com');
      assert.equal(result.pageData?.notFound, true, path);
      assert.equal(result.pageData?.stationDbError, undefined, path);
      assert.equal(result.pageData?.redirectTo, undefined, path);
      assert.equal(result.pageData?.station?._id, null, path);
    }
  });
}

test('English Unicode decoding never turns reserved or control escapes into another station identity', async () => {
  for (const [encodedSlug, unsafeDecodedSlug] of [
    ['radio%2Fone', 'radio/one'],
    ['radio%2fone', 'radio/one'],
    ['%C5%9Feker%2Ffm', 'şeker/fm'],
    ['radio%5Cone', 'radio\\one'],
    ['radio%3Fone', 'radio?one'],
    ['radio%23one', 'radio#one'],
    ['radio%00one', 'radio\u0000one'],
    ['radio%09one', 'radio\tone'],
    ['radio%0Aone', 'radio\none'],
    ['radio%0Done', 'radio\rone'],
    ['radio%1Fone', 'radio\u001fone'],
    ['radio%7Fone', 'radio\u007fone'],
    ['radio%C2%85one', 'radio\u0085one'],
    ['%2e', '.'],
    ['%2E%2e', '..'],
  ]) {
    const path = `/en/station/${encodedSlug}`;
    exactLookupFixtures = new Map([[`slug:${unsafeDecodedSlug}`, { ...station, slug: unsafeDecodedSlug }]]);
    pageCache.clear();
    assert.equal(getLanguageFromPath(path).cleanPath, `/station/${encodedSlug}`, path);
    const result = await renderer.renderStaticPage(path, 'https://themegaradio.com');
    assert.equal(result.pageData?.notFound, true, path);
    assert.equal(result.pageData?.station?._id, null, path);
    assert.equal(result.pageData?.redirectTo, undefined, path);
    assert.equal(result.pageData?.stationDbError, undefined, path);
  }
});

test('English Unicode decoding cannot introduce a station route boundary', async () => {
  exactLookupFixtures = new Map([[`slug:${station.slug}`, station]]);
  for (const route of ['station%2Frecovery-fm', 'station%5Crecovery-fm', '%73tation%2Frecovery-fm']) {
    const path = `/en/${route}`;
    pageCache.clear(); stationReads = 0;
    assert.equal(getLanguageFromPath(path).cleanPath, `/${route}`, path);
    const result = await renderer.renderStaticPage(path, 'https://themegaradio.com');
    assert.equal(result.pageData?.station?._id, undefined, path);
    assert.equal(result.pageData?.redirectTo, undefined, path);
    assert.equal(stationReads, 0, path);
  }
});

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  for (const [legacy, alias, canonical] of [
    ['kpissfm-2', 'kpiss-fm-2', 'kpiss-fm'],
    ['flashbassfm-1', 'flashbass-fm-1', 'flashbass-fm'],
  ]) {
    test(`${language}: verified legacy ${legacy} redirects to its persisted localized canonical`, async () => {
      exactLookupFixtures = new Map([[`alias:${alias}`, { ...station, slug: canonical, noIndex: false }]]);
      const detail = URL_TRANSLATIONS[language]?.station || 'station';
      const result = await renderer.renderStaticPage(`/${language}/${detail}/${legacy}`, 'https://themegaradio.com');
      assert.equal(decodeURI(result.pageData?.redirectTo || ''), `/${language}/${detail}/${canonical}`);
      assert.equal(result.pageData?.stationIsJunk, undefined);
    });
  }
}

test('verified legacy alias repair never bypasses an excluded target or guesses a missing record', async () => {
  exactLookupFixtures = new Map([['alias:kpiss-fm-2', { ...station, slug: 'kpiss-fm', noIndex: true, manualEditFields: { noIndex: true } }]]);
  const excluded = await renderer.renderStaticPage('/en/station/kpissfm-2', 'https://themegaradio.com');
  assert.equal(excluded.pageData?.stationIsJunk, true);
  assert.equal(excluded.pageData?.redirectTo, undefined);
  pageCache.clear(); exactLookupFixtures.clear();
  const missingTarget = await renderer.renderStaticPage('/en/station/kpissfm-2', 'https://themegaradio.com');
  assert.equal(missingTarget.pageData?.notFound, true);
  assert.equal(missingTarget.pageData?.redirectTo, undefined);
});

test('a current exact alias takes precedence over a verified historical spelling repair', async () => {
  exactLookupFixtures = new Map([
    ['alias:kpissfm-2', { ...station, slug: 'explicit-current-owner', noIndex: false }],
    ['alias:kpiss-fm-2', { ...station, slug: 'kpiss-fm', noIndex: false }],
  ]);
  const result = await renderer.renderStaticPage('/de/sender/kpissfm-2', 'https://themegaradio.com');
  assert.equal(result.pageData?.redirectTo, '/de/sender/explicit-current-owner');
});

for (const [legacy, canonical, id] of [
  ['radio-onda-rossa-1', 'onda-rossa', '68a8c482bd66579311ab2f5b'],
  ['kiis-1065-sydney-1065-fm-mp3-1', 'kiis-106-5', '68a8c478bd66579311ab1477'],
  ['france-bleu-besanon', 'france-bleu-besancon', '6a07916dbef34beb9148c147'],
  ['radio-russia', 'radio-rossii', '68a8c4a8bd66579311ab8be1'],
  ['1fm-movie-soundtrack', 'movie-soundtracks-hits-radio-1-fm', '68a8c47fbd66579311ab27d0'],
  ['1fm-movie-soundtrack-hits', 'movie-soundtracks-hits-radio-1-fm', '68a8c47fbd66579311ab27d0'],
]) {
  const target = { ...station, _id: id, slug: canonical, noIndex: false,
    descriptions: Object.fromEntries(ACTIVE_SITEMAP_LANGUAGES.map(lang => [lang, { full: `Full ${lang}`, meta: `Meta ${lang}` }])) };
  for (const language of ACTIVE_SITEMAP_LANGUAGES) {
    test(`${language}: recovered ${legacy} redirects once to its pinned localized station`, async () => {
      qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
      exactLookupFixtures = new Map([[`slug:${canonical}`, target]]);
      const detail = URL_TRANSLATIONS[language]?.station || 'station';
      const result = await renderer.renderStaticPage(`/${language}/${detail}/${legacy}`, 'https://themegaradio.com');
      assert.equal(decodeURI(result.pageData?.redirectTo || ''), `/${language}/${detail}/${canonical}`);
      assert.equal(result.pageData?.stationIsJunk, undefined);
      assert.equal(stationReads, 3, 'exact source, source alias and exact target only');
      const finalPage = await renderer.renderStaticPage(`/${language}/${detail}/${canonical}`, 'https://themegaradio.com');
      assert.equal(finalPage.pageData?.station?._id, id);
      assert.equal(finalPage.pageData?.redirectTo, undefined, 'redirect destination remains stable');
    });
  }

  for (const [reason, patch, excluded] of [
    ['missing', null, false],
    ['reassigned identity', { _id: 'unrelated-station' }, false],
    ['noindex', { noIndex: true }, true],
    ['offline noindex', { noIndex: true, lastCheckOk: false }, true],
    ['junk', { url: '' }, true],
    ['redirect cycle', { redirectToSlug: legacy }, false],
    ['redirect chain', { redirectToSlug: 'unreviewed-destination' }, false],
  ] as const) {
    test(`${legacy}: SSR refuses a ${reason} destination`, async () => {
      exactLookupFixtures = new Map(patch ? [[`slug:${canonical}`, { ...target, ...patch }]] : []);
      const result = await renderer.renderStaticPage(`/en/station/${legacy}`, 'https://themegaradio.com');
      assert.equal(result.pageData?.redirectTo, undefined);
      if (excluded) assert.equal(result.pageData?.stationIsJunk, true);
      else assert.equal(result.pageData?.notFound, true);
      assert.ok(stationReads <= 4, 'lookup does not follow chains or scan candidates');
    });
  }

  for (const kind of ['slug', 'alias', 'merged']) {
    test(`${legacy}: SSR preserves the current ${kind} owner before a historical repair`, async () => {
      const actual = { ...station, _id: 'current-owner', slug: kind === 'slug' ? legacy : 'actual-owner', noIndex: false };
      exactLookupFixtures = new Map([[`slug:${canonical}`, target]]);
      if (kind === 'merged') mergedAlias = actual;
      else exactLookupFixtures.set(`${kind}:${legacy}`, actual);
      const result = await renderer.renderStaticPage(`/en/station/${legacy}`, 'https://themegaradio.com');
      if (kind === 'slug') {
        assert.equal(result.pageData?.station?._id, 'current-owner');
        assert.equal(result.pageData?.redirectTo, undefined);
      } else {
        assert.equal(result.pageData?.redirectTo, '/en/station/actual-owner');
      }
      assert.ok(stationReads <= 2, 'existing owner avoids the historical target read');
    });
  }
}

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  for (const [alias, sourceSlug, targetSlug] of [
    ['rdi-gaga', 'radio-gaga-1', 'radio-gaga'],
    ['rdio_fm-1', 'radio-fm-4', 'sro4-radio-fm'],
    ['smooth-3', 'smooth-1', 'radio-jazz-smooth'],
  ]) {
    test(`${language}: retained duplicate alias ${alias} redirects directly to its indexable final target`, async () => {
      exactLookupFixtures = new Map([
        [`alias:${alias}`, { ...station, slug: sourceSlug, noIndex: true, redirectToSlug: targetSlug }],
        [`slug:${targetSlug}`, { ...station, slug: targetSlug, noIndex: false,
          descriptions: Object.fromEntries(ACTIVE_SITEMAP_LANGUAGES.map(lang => [lang, { full: `Full ${lang}`, meta: `Meta ${lang}` }])) }],
      ]);
      const detail = URL_TRANSLATIONS[language]?.station || 'station';
      const result = await renderer.renderStaticPage(`/${language}/${detail}/${alias}`, 'https://themegaradio.com');
      assert.equal(decodeURI(result.pageData?.redirectTo || ''), `/${language}/${detail}/${targetSlug}`);
      assert.equal(result.pageData?.stationIsJunk, undefined);
      assert.equal(stationReads, 3, 'exact miss, persisted alias, and one final-target read only');
    });
  }
}

for (const [reason, targetSlug, target] of [
  ['missing', 'canonical-fm', null],
  ['noindex', 'canonical-fm', { ...station, slug: 'canonical-fm', noIndex: true }],
  ['junk', 'canonical-fm', { ...station, slug: 'canonical-fm', noIndex: false, url: '' }],
  ['numeric', '12345', { ...station, slug: '12345', noIndex: false }],
  ['self', 'duplicate-fm', { ...station, slug: 'duplicate-fm', noIndex: false }],
  ['input alias', 'old-fm', { ...station, slug: 'old-fm', noIndex: false }],
  ['redirect cycle', 'canonical-fm', { ...station, slug: 'canonical-fm', noIndex: false, redirectToSlug: 'duplicate-fm' }],
  ['redirect chain', 'canonical-fm', { ...station, slug: 'canonical-fm', noIndex: false, redirectToSlug: 'third-fm' }],
] as const) {
  test(`retained duplicate alias does not redirect to a ${reason} target`, async () => {
    exactLookupFixtures = new Map([
      ['alias:old-fm', { ...station, slug: 'duplicate-fm', noIndex: true, redirectToSlug: targetSlug }],
      [`slug:${targetSlug}`, target],
    ]);
    // For a target equal to the input alias, keep the initial exact lookup a miss
    // and return that target only for the subsequent canonical-target read.
    if (targetSlug === 'old-fm') {
      let reads = 0;
      exactLookupFixtures.set('slug:old-fm', () => ++reads === 1 ? null : target);
    }
    const result = await renderer.renderStaticPage('/ar/mahta/old-fm', 'https://themegaradio.com');
    assert.equal(result.pageData?.redirectTo, undefined);
    assert.equal(result.pageData?.stationIsJunk, true);
  });
}

test('an exact current station wins over a historical duplicate alias with a redirect', async () => {
  exactLookupFixtures = new Map([
    ['slug:current-fm', { ...station, slug: 'current-fm', noIndex: false }],
    ['alias:current-fm', { ...station, slug: 'duplicate-fm', noIndex: true, redirectToSlug: 'canonical-fm' }],
    ['slug:canonical-fm', { ...station, slug: 'canonical-fm', noIndex: false }],
  ]);
  const result = await renderer.renderStaticPage('/en/station/current-fm', 'https://themegaradio.com');
  assert.equal(result.pageData?.redirectTo, undefined);
  assert.equal(result.pageData?.station.slug, 'current-fm');
  assert.equal(stationReads, 1);
});

test('a retained duplicate target read outage stays retryable instead of becoming cached 410', async () => {
  exactLookupFixtures = new Map([
    ['alias:old-fm', { ...station, slug: 'duplicate-fm', noIndex: true, redirectToSlug: 'canonical-fm' }],
    ['slug:canonical-fm', () => { throw new Error('temporary target read outage'); }],
  ]);
  const path = '/en/station/old-fm';
  const failed = await renderer.renderStaticPage(path, 'https://themegaradio.com');
  assert.equal(failed.pageData?.stationDbError, true);
  assert.equal(failed.pageData?.stationIsJunk, false);
  assert.equal(failed.pageData?.redirectTo, undefined);
  assert.equal(pageCache.has(path), false);
  exactLookupFixtures.set('slug:canonical-fm', { ...station, slug: 'canonical-fm', noIndex: false });
  const recovered = await renderer.renderStaticPage(path, 'https://themegaradio.com');
  assert.equal(recovered.pageData?.redirectTo, '/en/station/canonical-fm');
});

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: reviewed Eurodance duplicate redirects without publishing a second indexable document`, async () => {
    const source = {
      ...station, _id: '68a8c48bbd66579311ab4546', name: 'Radio Eurodance Classic',
      slug: 'radio-eurodance-classic', country: 'Belgium', noIndex: true,
      url: 'http://listen.shoutcast.com/radioeurodanceclassic',
      urlResolved: 'http:quincy.torontocast.com:2380/stream',
      redirectToSlug: 'radio-eurodance-classic-pure-and-addictive',
    };
    exactLookupFixtures = new Map([
      ['slug:radio-eurodance-classic', source],
      [`slug:${source.redirectToSlug}`, { ...station, slug: source.redirectToSlug, noIndex: false,
        descriptions: Object.fromEntries(ACTIVE_SITEMAP_LANGUAGES.map(lang => [lang, { full: `Full ${lang}`, meta: `Meta ${lang}` }])) }],
    ]);
    const detail = URL_TRANSLATIONS[language]?.station || 'station';
    const result = await renderer.renderStaticPage(`/${language}/${detail}/${source.slug}`, 'https://themegaradio.com');
    assert.equal(decodeURI(result.pageData?.redirectTo || ''), `/${language}/${detail}/${source.redirectToSlug}`);
    assert.equal(result.pageData?.station, undefined);
    assert.equal(result.pageData?.stationIsJunk, undefined);
    assert.equal(source.noIndex, true, 'the duplicate stays excluded in storage');
    assert.equal(stationReads, 2, 'the source and its exact final target are checked without a discovery scan');
  });
}

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: merged IDs redirect once to the localized surviving station`, async () => {
    missing = true;
    mergedAlias = { ...station, noIndex: false };
    const detail = URL_TRANSLATIONS[language]?.station || 'station';
    const result = await renderer.renderStaticPage(`/${language}/${detail}/0123456789abcdef01234567`, 'https://themegaradio.com');
    assert.equal(decodeURI(result.pageData?.redirectTo || ''), `/${language}/${detail}/recovery-fm`);
    assert.equal(result.pageData?.notFound, undefined);
    assert.equal(result.pageData?.stationDbError, undefined);
  });
}

test('merged aliases never bypass an explicit junk target decision', async () => {
  missing = true;
  mergedAlias = { ...station, noIndex: true, manualEditFields: { noIndex: true } };
  const result = await renderer.renderStaticPage('/tr/istasyon/old-uuid', 'https://themegaradio.com');
  assert.equal(result.pageData?.redirectTo, undefined);
  assert.equal(result.pageData?.stationIsJunk, true);
});

test('a persisted alias may retain a live historical noindex information page without claiming indexing approval', async () => {
  missing = true;
  mergedAlias = { ...station, noIndex: true, lastCheckOk: true };
  const alias = await renderer.renderStaticPage('/en/station/old-uuid', 'https://themegaradio.com');
  assert.equal(alias.pageData?.redirectTo, '/en/station/recovery-fm');
  pageCache.clear(); missing = false; noIndex = true; stationOverrides = { lastCheckOk: true };
  const target = await renderer.renderStaticPage('/en/station/recovery-fm', 'https://themegaradio.com');
  assert.equal(target.pageData?.stationIsJunk, false);
  assert.equal(target.seoTags.noIndex, true);
  assert.deepEqual(target.seoTags.hreflangs, []);
});

test('transient PostgreSQL placeholder is not permanent junk and the next request re-reads recovered data', async () => {
  databaseFails = true;
  const failed = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(failed.pageData?.stationDbError, true);
  assert.equal(failed.pageData?.stationIsJunk, false);
  assert.equal(failed.pageData?.notFound, false);
  assert.equal(pageCache.has(url), false);
  databaseFails = false;
  const recovered = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(recovered.pageData?.stationDbError, undefined);
  assert.equal(recovered.pageData?.station?.name, 'Recovery FM');
  assert.equal(recovered.pageData?.stationIsJunk, false);
  assert.equal(stationReads, 2);
  assert.equal(pageCache.has(url), true);
});

test('qualification failure is retryable and never cached as a permanent noindex or redirect', async () => {
  qualificationFails = true;
  const failed = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(failed.pageData?.stationDbError, true);
  assert.equal(failed.pageData?.stationIsJunk, false);
  assert.equal(failed.pageData?.redirectTo, undefined);
  assert.notEqual(failed.seoTags.noIndex, true);
  assert.equal(pageCache.has(url), false);
  qualificationFails = false;
  assert.equal((await renderer.renderStaticPage(url, 'https://themegaradio.com')).pageData?.stationDbError, undefined);
});

test('real missing stations and explicit noIndex quality decisions retain permanent handling', async () => {
  missing = true;
  const unknown = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(unknown.pageData?.notFound, true);
  assert.equal(unknown.pageData?.stationDbError, undefined);
  pageCache.clear(); missing = false; noIndex = true;
  stationOverrides = { manualEditFields: { noIndex: true } };
  const excluded = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.equal(excluded.pageData?.stationIsJunk, true);
  assert.equal(excluded.seoTags.noIndex, true);
  assert.equal(excluded.pageData?.stationDbError, undefined);
});

test('numeric-only stations are excluded consistently without turning positive callsigns into gone pages or redirects', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  const descriptions = Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full: `Station description ${lang}`, meta: `Station metadata ${lang}` }]));
  for (const slug of ['1234', '-1234']) {
    stationOverrides = { slug, descriptions };
    const page = await renderer.renderStaticPage(`/en/station/${slug}`, 'https://themegaradio.com');
    assert.equal(page.seoTags.noIndex, true);
    assert.deepEqual(page.seoTags.hreflangs, []);
    assert.equal(page.pageData?.redirectTo, undefined);
    assert.equal(page.pageData?.notFound, false);
    assert.equal(page.pageData?.stationDbError, undefined);
    assert.equal(page.pageData?.stationIsJunk, slug.startsWith('-'));
    const doc = { ...station, ...stationOverrides };
    assert.deepEqual(getIndexableLanguagesForStation(doc, qualifiedLanguages), []);
    assert.equal(isStationIndexableInLanguage(doc, 'en', qualifiedLanguages), false);
  }
});

test('a normal station with complete content retains all fourteen indexable locale alternates', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  stationOverrides = { descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full: `Full ${lang}`, meta: `Meta ${lang}` }])) };
  const page = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.notEqual(page.seoTags.noIndex, true);
  assert.equal(page.pageData?.stationIsJunk, false);
  assert.equal(page.pageData?.redirectTo, undefined);
  assert.deepEqual(new Set(page.seoTags.hreflangs.filter((entry: any) => entry.lang !== 'x-default').map((entry: any) => entry.lang)), new Set(qualifiedLanguages));
  assert.deepEqual(new Set(getIndexableLanguagesForStation({ ...station, ...stationOverrides }, qualifiedLanguages)), new Set(qualifiedLanguages));
});

test('actual localized SSR station routes retain the same reciprocal fourteen-language cluster', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  stationOverrides = { descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full: `Full ${lang}`, meta: `Meta ${lang}` }])) };
  const expected = generateLanguageUrls('/station/recovery-fm', 'https://themegaradio.com', 'en', undefined, undefined, qualifiedLanguages)
    .map(entry => ({ ...entry, url: new URL(entry.url).href }));
  for (const entry of expected.filter(item => item.lang !== 'x-default')) {
    const page = await renderer.renderStaticPage(new URL(entry.url).pathname, 'https://themegaradio.com');
    assert.equal(page.pageData?.pageType, 'station');
    assert.equal(new URL(page.seoTags.canonical).href, new URL(entry.url).href);
    assert.deepEqual(page.seoTags.hreflangs.map((item: any) => ({ ...item, url: new URL(item.url).href })), expected, entry.lang);
  }
});

test('English station HTML retains a factual article without waiting for fourteen translations or crashing on malformed prose', async () => {
  for (const descriptions of [{}, { en: { full: ' \u00a0', meta: '' } }, { en: { full: 42, meta: false } }]) {
    pageCache.clear(); stationOverrides = { descriptions };
    const page = await renderer.renderStaticPage('/en/station/recovery-fm', 'https://themegaradio.com');
    assert.notEqual(page.seoTags.noIndex, true);
    const body = renderer.generateHtmlBody({ pageType: 'station', language: 'en', translations: {},
      stationData: page.pageData.station, seoTags: page.seoTags });
    assert.ok(body.includes(buildTemplateDescription(station).full));
  }
});

test('offline station details retain full fourteen-language content, indexability and matching human-visible notices', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  stationOverrides = {
    lastCheckOk: false, isListVisible: false, lastCheckTime: new Date(), lastCheckOkTime: new Date(Date.now() - 90 * 86400000),
    descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full: `Existing editorial station information ${lang}`, meta: `Existing station summary ${lang}` }])),
  };
  const entries = generateLanguageUrls('/station/recovery-fm', 'https://themegaradio.com', 'en', undefined, undefined, qualifiedLanguages);
  for (const entry of entries.filter(item => item.lang !== 'x-default')) {
    const page = await renderer.renderStaticPage(new URL(entry.url).pathname, 'https://themegaradio.com');
    assert.equal(page.pageData?.station.lastCheckOk, false);
    assert.equal(page.pageData?.stationIsJunk, false);
    assert.equal(page.pageData?.notFound, false);
    assert.equal(page.pageData?.stationDbError, undefined, 'offline audio is not a page/database outage');
    assert.equal(page.pageData?.redirectTo, undefined);
    assert.notEqual(page.seoTags.noIndex, true);
    assert.equal(new URL(page.seoTags.canonical).href, new URL(entry.url).href);
    assert.deepEqual(page.seoTags.hreflangs.map((item: any) => ({ ...item, url: new URL(item.url).href })), entries.map(item => ({ ...item, url: new URL(item.url).href })));
    assert.equal(page.pageData?.station.descriptions[entry.lang].full, stationOverrides.descriptions[entry.lang].full);
    const body = renderer.generateHtmlBody({ pageType: 'station', language: entry.lang, translations: {},
      stationData: page.pageData?.station, seoTags: page.seoTags, cleanPath: page.cleanPath });
    assert.ok(body.includes(stationOverrides.descriptions[entry.lang].full));
    assert.ok(body.includes(`<p id="station-stream-unavailable" role="status">${escapeHead(getStationStreamUnavailableNotice(entry.lang))}</p>`));
    assert.equal((body.match(/<h1>/g) || []).length, 1);
    for (const availability of [true, undefined]) {
      const availableBody = renderer.generateHtmlBody({ pageType: 'station', language: entry.lang, translations: {},
        stationData: { ...page.pageData?.station, isListVisible: availability }, seoTags: page.seoTags });
      assert.ok(!availableBody.includes('id="station-stream-unavailable"'));
    }
  }
});

test('unknown legacy offline noindex keeps rich localized200 data without reindexing, while manual and quality exclusions stay gone', async () => {
  noIndex = true; qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  stationOverrides = { lastCheckOk: false, descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang,
    { full: `Retained original station article ${lang}`, meta: `Retained station summary ${lang}` }])) };
  const entries = generateLanguageUrls('/station/recovery-fm', 'https://themegaradio.com', 'en', undefined, undefined, qualifiedLanguages);
  for (const entry of entries.filter(item => item.lang !== 'x-default')) {
    const page = await renderer.renderStaticPage(new URL(entry.url).pathname, 'https://themegaradio.com');
    assert.equal(page.pageData.stationIsJunk, false, 'HTTP layer keeps200 instead of410');
    assert.equal(page.pageData.stationDbError, undefined);
    assert.equal(page.pageData.notFound, false);
    assert.equal(page.pageData.redirectTo, undefined);
    assert.equal(page.pageData.station.noIndex, true, 'unknown persisted flag is not reset');
    assert.equal(page.seoTags.noIndex, true);
    assert.deepEqual(page.seoTags.hreflangs, []);
    assert.deepEqual(getIndexableLanguagesForStation(page.pageData.station, qualifiedLanguages), []);
    assert.equal(new URL(page.seoTags.canonical).href, new URL(entry.url).href);
    const body = renderer.generateHtmlBody({ pageType: 'station', language: entry.lang, translations: {},
      stationData: page.pageData.station, seoTags: page.seoTags });
    assert.ok(body.includes(stationOverrides.descriptions[entry.lang].full));
    assert.ok(!body.includes('id="station-stream-unavailable"'), 'an unverified source flag is not a confirmed outage');
  }
  for (const extra of [{ manualEditFields: { noIndex: true } }, { manualEditFields: { noIndex: false } },
    { slug: 'radio-test-stream' }, { slug: '-1234' }]) {
    pageCache.clear(); stationOverrides = { ...stationOverrides, manualEditFields: undefined, slug: 'recovery-fm', ...extra };
    const page = await renderer.renderStaticPage(`/en/station/${stationOverrides.slug}`, 'https://themegaradio.com');
    assert.equal(page.pageData.stationIsJunk, true);
    assert.equal(page.seoTags.noIndex, true);
  }
  pageCache.clear(); stationOverrides = { ...stationOverrides, manualEditFields: undefined, slug: 'radio-aac' };
  const formatPage = await renderer.renderStaticPage('/en/station/radio-aac', 'https://themegaradio.com');
  assert.equal(formatPage.pageData.stationIsJunk, false);
  assert.equal(formatPage.seoTags.noIndex, true, 'the stored legacy flag still requires explicit review');
  pageCache.clear(); stationOverrides = { lastCheckOk: false, redirectToSlug: 'original-fm' };
  exactLookupFixtures = new Map([
    ['slug:recovery-fm', { ...station, ...stationOverrides, noIndex }],
    ['slug:original-fm', { ...station, slug: 'original-fm', noIndex: false }],
  ]);
  const duplicate = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  assert.match(duplicate.pageData.redirectTo, /original-fm$/);
});

for (const lastCheckOk of [true, undefined]) {
  test(`legacy noindex with stream health ${lastCheckOk} is not evidence of a permanently removed page`, async () => {
    noIndex = true; qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
    stationOverrides = { lastCheckOk, descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang,
      { full: `Retained station information ${lang}`, meta: `Retained summary ${lang}` }])) };
    const entries = generateLanguageUrls('/station/recovery-fm', 'https://themegaradio.com', 'en', undefined, undefined, qualifiedLanguages);
    for (const entry of entries.filter(item => item.lang !== 'x-default')) {
      const page = await renderer.renderStaticPage(new URL(entry.url).pathname, 'https://themegaradio.com');
      assert.equal(page.pageData.stationIsJunk, false);
      assert.equal(page.pageData.notFound, false);
      assert.equal(page.pageData.redirectTo, undefined);
      assert.equal(page.pageData.station.noIndex, true, 'identity review remains required');
      assert.equal(page.seoTags.noIndex, true);
      assert.deepEqual(page.seoTags.hreflangs, []);
      assert.deepEqual(getIndexableLanguagesForStation(page.pageData.station, qualifiedLanguages), []);
      assert.equal(new URL(page.seoTags.canonical).href, new URL(entry.url).href);
      const body = renderer.generateHtmlBody({ pageType: 'station', language: entry.lang, translations: {},
        stationData: page.pageData.station, seoTags: page.seoTags });
      assert.ok(body.includes(stationOverrides.descriptions[entry.lang].full));
    }
  });
}

const escapeHead = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
test('page-data and HTML emit identical bounded descriptions without shortening stored body content', async () => {
  qualifiedLanguages = [...ACTIVE_SITEMAP_LANGUAGES];
  const full = 'Full station editorial text with a final unpunctuated tail '.repeat(12);
  stationOverrides = { descriptions: Object.fromEntries(qualifiedLanguages.map(lang => [lang, { full, meta: `${lang}: ` + 'Music, news & "special" programming for every listener. '.repeat(5) }])) };
  for (const language of qualifiedLanguages) {
    const entry = generateLanguageUrls('/station/recovery-fm', 'https://themegaradio.com', 'en', undefined, undefined, qualifiedLanguages).find(item => item.lang === language)!;
    const page = await renderer.renderStaticPage(new URL(entry.url).pathname, 'https://themegaradio.com');
    const head = renderer.generateHtmlHead(page.seoTags, language, {}, page.cleanPath, page.pageData?.station);
    const expected = truncateAtWordBoundary(stationOverrides.descriptions[language].meta, 160);
    assert.equal(page.seoTags.description, expected);
    assert.equal(page.pageData?.seoTags.description, expected);
    assert.ok(head.includes(`<meta name="description" content="${escapeHead(expected)}">`));
    assert.ok(head.includes(`<meta property="og:description" content="${escapeHead(page.seoTags.ogDescription)}">`));
    assert.ok(head.includes(`<meta name="twitter:description" content="${escapeHead(page.seoTags.twitterDescription)}">`));
    assert.equal(page.pageData?.station.descriptions[language].full, full);
    assert.ok(stationOverrides.descriptions[language].meta.length > 160, 'stored value is not rewritten');
  }
});

test('published admin descriptions keep priority and match HTML presentation limits without mutating overrides or titles', async () => {
  stationOverrides = { country: 'The United States Of America', countryCode: 'US' };
  customMetadata = {
    title: 'An intentional full editorial title '.repeat(4),
    description: 'Admin-approved meta description & special programming. '.repeat(5),
    ogDescription: 'Admin-approved social description. '.repeat(8),
    twitterDescription: 'Admin-approved Twitter description. '.repeat(8),
  };
  const original = { ...customMetadata };
  const page = await renderer.renderStaticPage(url, 'https://themegaradio.com');
  const head = renderer.generateHtmlHead(page.seoTags, 'en', {}, page.cleanPath, page.pageData?.station);
  for (const field of ['description', 'ogDescription', 'twitterDescription']) {
    assert.equal(page.seoTags[field], truncateAtWordBoundary(original[field], 160));
    assert.ok(head.includes(`content="${escapeHead(page.seoTags[field])}"`));
  }
  assert.equal(page.seoTags.title, original.title, 'H1/title derivation keeps its full source input');
  assert.deepEqual(customMetadata, original, 'admin data is not mutated');
});
