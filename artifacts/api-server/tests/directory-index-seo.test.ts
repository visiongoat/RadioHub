import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { buildDirectoryIndexSeo, DIRECTORY_INDEX_SEO, type DirectoryIndexKind } from '@workspace/seo-shared/directory-index-seo';
import { generateSeoTags, generateLanguageUrls, SITEMAP_PRIORITY_LANGUAGES, truncateAtWordBoundary } from '@workspace/seo-shared/seo-config';
import { translateUrl, URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';

const languages = SITEMAP_PRIORITY_LANGUAGES.universal14;
mock.module('../src/seo/qualified-languages', { namedExports: {
  getCachedQualifiedLanguages: async () => [...languages],
  getCachedQualifiedLanguagesSync: () => [...languages],
  getQualifiedLanguagesState: async () => ({languages:[...languages]}),
  QualifiedLanguagesUnavailableError: class extends Error {},
} });
mock.module('../src/services/precomputed-genres', { namedExports: {
  PrecomputedGenresService: { getGenres: async () => ({ genres: [], total: 0 }) },
} });
let renderer: import('../src/seo-renderer').SeoRenderer;
before(async () => { const { SeoRenderer } = await import('../src/seo-renderer'); renderer = new SeoRenderer(); });
const origin = 'https://themegaradio.com';
const urlMap = new Map(Object.entries(URL_TRANSLATIONS).flatMap(([language, values]) =>
  Object.entries(values).map(([key,value]) => [`${language}:${key}`,value] as [string,string])));
const decode = (text: string) => text.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');

for (const kind of ['genres','regions'] as const) {
  test(`${kind}: all14 locale templates have distinct titles/descriptions and expected scripts`, () => {
    assert.equal(new Set(languages.map(language => DIRECTORY_INDEX_SEO[language][kind].title)).size,14);
    assert.equal(new Set(languages.map(language => DIRECTORY_INDEX_SEO[language][kind].description)).size,14);
    const scripts: Record<string,RegExp> = { ar:/\p{Script=Arabic}/u, he:/\p{Script=Hebrew}/u,
      ru:/\p{Script=Cyrillic}/u, zh:/\p{Script=Han}/u, ja:/[\p{Script=Hiragana}\p{Script=Katakana}]/u,
      ko:/\p{Script=Hangul}/u, hi:/\p{Script=Devanagari}/u };
    for (const language of languages) {
      const entry = DIRECTORY_INDEX_SEO[language][kind];
      for (const value of Object.values(entry)) {
        assert.ok(value.trim());
        if (scripts[language]) assert.match(value,scripts[language]);
      }
    }
  });
  for (const language of languages) {
    test(`${language}/${kind}: shared/SSR metadata and visible H1 match without canonical/hreflang changes`, async () => {
      const path = `/${kind}`, localizedPath = translateUrl(path,language), originalPath = `/${language}${localizedPath}`;
      const expected = buildDirectoryIndexSeo(kind,language);
      const shared = generateSeoTags(kind,language,{},path,origin,undefined,originalPath,originalPath,urlMap);
      const actual = await renderer.generateEnhancedSeoTags(kind,language,{},path,origin,undefined,undefined,originalPath,originalPath,urlMap);
      for (const tags of [shared,actual]) {
        assert.equal(tags.title,expected.title);
        assert.equal(tags.description,expected.description);
        assert.equal(tags.ogTitle,expected.title);
        assert.equal(tags.ogDescription,expected.description);
        assert.equal(tags.twitterTitle,expected.title);
        assert.equal(tags.twitterDescription,expected.description);
        assert.equal(tags.canonical,origin+originalPath);
        assert.doesNotMatch(tags.robots || '',/noindex/);
      }
      assert.deepEqual(actual.hreflangs,generateLanguageUrls(path,origin,language,urlMap,actual.canonical,[...languages]));
      assert.equal(actual.hreflangs.length,15);
      const head = renderer.generateHtmlHead(actual,language,{},path,undefined,urlMap);
      const body = renderer.generateHtmlBody({pageType:kind,language,translations:{},seoTags:actual,cleanPath:path,urlTranslations:urlMap});
      assert.equal(decode(/<title>(.*?)<\/title>/.exec(head)![1]),expected.title);
      assert.equal(decode(/<meta name="description" content="([^"]*)"/.exec(head)![1]),truncateAtWordBoundary(expected.description,160));
      assert.equal(decode(/<h1[^>]*>(.*?)<\/h1>/.exec(body)![1]),expected.h1);
    });
  }
}

test('blank/key-placeholder/exact English seed values use localized copy, custom text remains authoritative', () => {
  for (const kind of ['genres','regions'] as DirectoryIndexKind[]) for (const language of languages) {
    const english = DIRECTORY_INDEX_SEO.en[kind];
    const template = DIRECTORY_INDEX_SEO[language][kind];
    for (const translations of [{}, { [`${kind}_page_title`]:' ', [`${kind}_page_description`]:' ' },
      { [`${kind}_page_title`]:`${kind}_page_title`, [`${kind}_page_description`]:`${kind}_page_description` },
      { [`${kind}_page_title`]:english.title, [`${kind}_page_description`]:english.description }]) {
      const before = JSON.stringify(translations);
      assert.deepEqual(buildDirectoryIndexSeo(kind,language,translations),template);
      assert.equal(JSON.stringify(translations),before);
    }
    const custom = { [`${kind}_page_title`]:'Eigene Auswahl — Sender entdecken | Mega Radio',
      [`${kind}_page_description`]:'Eigene redaktionelle Beschreibung für dieses Verzeichnis.' };
    assert.deepEqual(buildDirectoryIndexSeo(kind,language,custom), {
      title:custom[`${kind}_page_title`],description:custom[`${kind}_page_description`],h1:'Eigene Auswahl',
    });
    assert.equal(buildDirectoryIndexSeo(kind,language,{...custom,[`${kind}_page_h1`]:'Eigene Überschrift'}).h1,'Eigene Überschrift');
  }
});

test('genre/country details use localized genre names in specific metadata', async () => {
  const { buildGenreSeo } = await import('@workspace/seo-shared/genre-seo-templates');
  const { buildCountrySeo } = await import('@workspace/seo-shared/region-seo-templates');
  const jazzNames: Record<string, string> = { en:'Jazz', de:'Jazz', fr:'Jazz', es:'Jazz', it:'Jazz', pt:'Jazz',
    tr:'Caz', ru:'Джаз', ar:'جاز', zh:'爵士', ja:'ジャズ', ko:'재즈', hi:'जैज़', he:'ג׳אז' };
  for (const language of languages) {
    const genre = await renderer.generateEnhancedSeoTags('genres',language,{},'/genres/jazz',origin,undefined,{genreName:'Jazz'});
    const country = await renderer.generateEnhancedSeoTags('regions',language,{},'/regions/germany',origin,undefined,{country:'Germany'});
    assert.equal(genre.title,buildGenreSeo(jazzNames[language],language,{}).title);
    assert.equal(genre.description,buildGenreSeo(jazzNames[language],language,{}).description);
    assert.equal(country.title,buildCountrySeo('Germany',language,{}).title);
    assert.equal(country.description,buildCountrySeo('Germany',language,{}).description);
  }
});
