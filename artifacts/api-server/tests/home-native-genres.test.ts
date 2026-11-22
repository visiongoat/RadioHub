import { genreDisplayName } from '@workspace/seo-shared/genre-localization';
import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';

const pages = new Map<string, any>();
let calls = 0;
let links: ReadonlyArray<{ slug: string; name: string }> | undefined;
let translationsFail = false;
mock.module('../src/performance-cache', { namedExports: { performanceCache: {
  getPageData: (key: string) => pages.get(key),
  setPageData: (key: string, value: any) => pages.set(key, value),
  getTranslations: () => {
    if (translationsFail) throw new Error('required translations unavailable');
    return {};
  },
  getUrlTranslations: async () => new Map<string, string>(),
} } });
mock.module('../src/data/postgres-seo-read-store', { namedExports: { pgSeoCatalog: () => ({ find: async () => [] }) } });
mock.module('../src/data/postgres-content-store', { namedExports: { pgSeoMetadata: async () => null } });
mock.module('../src/services/home-genre-navigation', { namedExports: { getHomeGenreNavigation: () => { calls++; return links; } } });
mock.module('../src/services/precomputed-genres', { namedExports: { PrecomputedGenresService: {
  getGenres: () => { throw new Error('Home SSR must never load the legacy aggregate'); },
} } });
mock.module('../src/seo/qualified-languages', { namedExports: { getCachedQualifiedLanguages: async () => ['en'] } });
const { SeoRenderer } = await import('../src/seo-renderer');
const renderer = new SeoRenderer();
beforeEach(() => {
  pages.clear(); calls = 0; translationsFail = false;
  links = Object.freeze([{ slug: 'jazz', name: 'Editorial Jazz' }, { slug: 'rock', name: 'Editorial Rock' }]);
});
after(() => mock.restoreAll());

test('home SSR renders the bounded native navigation snapshot with localized names while retaining its canonical order and raw snapshot', async () => {
  const page = await renderer.renderStaticPage('/en', 'https://themegaradio.com');
  assert.equal(calls, 1);
  assert.equal(page.pageData.pageType, 'home');
  assert.deepEqual(page.pageData.topGenres, links?.map(genre => ({...genre,name:genreDisplayName(genre,'en')})));
  assert.equal(links?.[0].name,'Editorial Jazz','the shared navigation cache is never mutated');
  const html = renderer.generateHtmlBody({ pageType: 'home', language: page.language,
    translations: page.translations, additionalData: page.pageData, urlTranslations: page.urlTranslations });
  assert.match(html, /href="\/en\/genres\/jazz">Jazz<\/a>/);
  assert.match(html, /href="\/en\/genres\/rock">Rock<\/a>/);
  await renderer.renderStaticPage('/en', 'https://themegaradio.com');
  assert.equal(calls, 1, 'A warm page does not request navigation again');
});

test('a cold or expired optional snapshot renders the home body and existing localized fallback links', async () => {
  links = undefined;
  const page = await renderer.renderStaticPage('/en', 'https://themegaradio.com');
  assert.equal(page.pageData.topGenres, undefined);
  assert.equal(page.pageData.pageType, 'home');
  const html = renderer.generateHtmlBody({ pageType: 'home', language: page.language,
    translations: page.translations, additionalData: page.pageData, urlTranslations: page.urlTranslations });
  assert.match(html, /class="hero-container/);
  assert.match(html, /href="\/en\/genres\/pop"/);
});

test('required translation failures are not masked by optional genre fallback', async () => {
  translationsFail = true;
  await assert.rejects(renderer.renderStaticPage('/en', 'https://themegaradio.com'), /required translations unavailable/);
  assert.equal(calls, 0);
  assert.equal(pages.size, 0);
});
