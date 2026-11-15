import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getStationRelatedHeading } from '@workspace/seo-shared/station-page-copy';
import { getStationEditorial } from '@workspace/seo-shared/station-editorial';

// Exercise real SSR markup without starting the database or background cache.
mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      getTranslations: () => null, setTranslations: () => {},
      getPageData: () => null, setPageData: () => {},
      getUrlTranslations: async () => new Map(),
      getStats: () => ({ hits: 0, misses: 0 }),
    },
    PerformanceCache: class {}, deepFreeze: <T,>(value: T) => value,
  },
});

let renderer: {
  generateHtmlBody(input: any): string;
  generateStructuredData(seoTags: any, language?: string, translations?: Record<string, string>, cleanPath?: string, stationData?: any): { global: any[]; page: any[] };
};
before(async () => {
  const { SeoRenderer } = await import('../src/seo-renderer');
  renderer = new SeoRenderer();
});

function stationBody(language: string, translations: Record<string, string> = {}, crossLinks: Record<string, unknown> = {}, station: Record<string, unknown> = {}) {
  return renderer.generateHtmlBody({
    pageType: 'station', language, translations,
    stationData: { name: 'Example Radio', slug: 'example-radio', country: 'Germany', descriptions: {}, ...station },
    urlTranslations: new Map([[`${language}:station`, language === 'de' ? 'sender' : 'station']]),
    additionalData: { crossLinks: {
      sameCountry: [{ name: 'Country & Radio', slug: 'country-radio' }],
      sameCity: [{ name: 'City Radio', slug: 'city-radio' }],
      countryName: 'Germany', cityName: 'Hamburg', ...crossLinks,
    } },
  });
}

function section(body: string, kind: 'country' | 'city') {
  return body.match(new RegExp(`<section class="related-stations related-stations--${kind}">([\\s\\S]*?)</section>`))?.[1] || '';
}

test('German Ö3 merge survivor retains the complete pilot in initial HTML below related stations', () => {
  const summary = 'Kurzer Überblick über Ö3.';
  const station = { _id: '68a8c483bd66579311ab2ffe', slug: 'orf-hitradio-o3', name: 'ORF Hitradio Ö3 | HQ', descriptions: { de: summary } };
  const editorial = getStationEditorial(station, 'de')!;
  const body = stationBody('de', {}, { samePublisher: [{ name: 'Related Radio', slug: 'related-radio' }] }, station);
  for (const text of [editorial.historyText, ...editorial.paragraphs, ...editorial.questions.flatMap(item => [item.question, item.answer])]) {
    assert.ok(body.includes(text), text);
  }
  assert.ok(body.includes('https://oe3.orf.at/sendungen/'));
  assert.ok(!body.includes('class="station-intro"'));
  assert.ok(!body.includes('class="station-outro"'));
  assert.equal((body.match(/<h1\b/g) || []).length, 1);
  assert.equal((body.match(/<details>/g) || []).length, 3);
  assert.ok(body.includes(editorial.summary));
  assert.ok(!body.includes(summary));
  for (const kind of ['publisher', 'country', 'city']) {
    const relatedIndex = body.indexOf(`class="related-stations related-stations--${kind}"`);
    assert.ok(relatedIndex > body.indexOf(editorial.summary));
    assert.ok(body.indexOf('class="station-editorial"') > relatedIndex);
  }
  assert.ok(!stationBody('en', {}, {}, station).includes('class="station-editorial"'));
  assert.ok(!stationBody('de').includes('class="station-editorial"'));
});

test('pilot summary matches structured data and does not override other stations or locales', () => {
  const station = { _id: '68a8c483bd66579311ab2ffa', slug: 'orf-hitradio-o3', name: 'ORF Hitradio Ö3',
    descriptions: { de: 'Stored German description.', en: 'Stored English description.' } };
  for (const language of ACTIVE_SITEMAP_LANGUAGES) {
    const expected = language === 'de' ? getStationEditorial(station, 'de')!.summary : station.descriptions.en;
    assert.ok(stationBody(language, {}, {}, station).includes(expected));
    const schema = renderer.generateStructuredData({}, language, {}, `/station/${station.slug}`, station);
    assert.equal(schema.page.find(item => item['@type'] === 'RadioBroadcastService')?.description, expected);
  }
  assert.ok(stationBody('de', {}, {}, { ...station, _id: 'other-record' }).includes(station.descriptions.de));
});

for (const language of ACTIVE_SITEMAP_LANGUAGES) {
  test(`${language}: all country/city headings have localized fallback text`, () => {
    for (const kind of ['country', 'city'] as const) {
      for (const location of ['Test Location', '']) {
        const heading = getStationRelatedHeading(language, kind, location);
        assert.ok(heading.trim());
        assert.doesNotMatch(heading, /\{location\}|similar_in_country|stations_in_city/);
        if (location) assert.ok(heading.includes(location));
        if (language !== 'en') assert.notEqual(heading, getStationRelatedHeading('en', kind, location));
      }
    }
  });
}

for (const fixture of [
  { language: 'en', country: 'More radio stations from Germany', city: 'Radio stations in Hamburg' },
  { language: 'de', country: 'Weitere Radiosender aus Deutschland', city: 'Radiosender in Hamburg' },
  { language: 'tr', country: 'Almanya ülkesindeki diğer radyo istasyonları', city: 'Hamburg şehrindeki radyo istasyonları' },
]) {
  test(`${fixture.language}: actual station SSR localizes related headings and preserves crawlable links`, () => {
    const body = stationBody(fixture.language);
    assert.ok(section(body, 'country').includes(`<h2>${fixture.country}</h2>`));
    assert.ok(section(body, 'city').includes(`<h2>${fixture.city}</h2>`));
    const segment = fixture.language === 'de' ? 'sender' : 'station';
    assert.ok(section(body, 'country').includes(`href="/${fixture.language}/${segment}/country-radio">Country &amp; Radio</a>`));
    assert.ok(section(body, 'city').includes(`href="/${fixture.language}/${segment}/city-radio">City Radio</a>`));
    assert.equal((body.match(/<h1\b/g) || []).length, 1);
  });
}

test('default locale stays English and locale variants use the base-language fallback', () => {
  for (const language of ['', 'unknown', 'en-US']) {
    assert.equal(getStationRelatedHeading(language, 'country', 'Germany'), 'More radio stations from Germany');
    assert.equal(getStationRelatedHeading(language, 'city', ''), 'Nearby stations');
  }
  assert.equal(getStationRelatedHeading(' DE_at ', 'country', 'Deutschland'), 'Weitere Radiosender aus Deutschland');
  assert.equal(getStationRelatedHeading('tr-TR', 'city', 'Ankara'), 'Ankara şehrindeki radyo istasyonları');
});

test('English seeds, missing-key echoes and blanks do not replace a localized fallback', () => {
  const seeds = {
    similar_in_country: 'More radio stations from', stations_in_city: 'Radio stations in',
    similar_stations: 'Similar stations', nearby_stations: 'Nearby stations',
  };
  for (const language of ['de', 'tr']) {
    for (const kind of ['country', 'city'] as const) {
      for (const location of ['Test Location', '']) {
        const fallback = getStationRelatedHeading(language, kind, location);
        assert.equal(getStationRelatedHeading(language, kind, location, seeds), fallback);
        assert.equal(getStationRelatedHeading(language, kind, location, Object.fromEntries(Object.keys(seeds).map(key => [key, key]))), fallback);
        assert.equal(getStationRelatedHeading(language, kind, location, Object.fromEntries(Object.keys(seeds).map(key => [key, '  ']))), fallback);
      }
    }
    const body = stationBody(language, seeds);
    assert.doesNotMatch(section(body, 'country') + section(body, 'city'), /More radio stations from|Radio stations in/);
  }
  assert.equal(getStationRelatedHeading('de', 'city', 'Hamburg', { stations_in_city: 'Radio stations in {location}' }), 'Radiosender in Hamburg');
});

test('localized database prefixes and location templates remain honored and are escaped once', () => {
  assert.equal(getStationRelatedHeading('de', 'country', 'Deutschland', { similar_in_country: '  Sender aus  ' }), 'Sender aus Deutschland');
  assert.equal(getStationRelatedHeading('tr', 'city', 'Ankara', { stations_in_city: '{location} radyoları' }), 'Ankara radyoları');
  assert.equal(getStationRelatedHeading('en', 'city', '$& Town'), 'Radio stations in $& Town');
  assert.equal(getStationRelatedHeading('de', 'city', '$& Stadt', { stations_in_city: 'Sender in {location}' }), 'Sender in $& Stadt');
  assert.equal(getStationRelatedHeading('de', 'country', '', { similar_stations: 'Weitere Empfehlungen' }), 'Weitere Empfehlungen');
  const body = stationBody('de', { stations_in_city: 'Sender & Musik in {location}' }, { cityName: '<script>alert("x")</script> & Hamburg' });
  assert.ok(section(body, 'city').includes('Sender &amp; Musik in &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Hamburg'));
  assert.doesNotMatch(section(body, 'city'), /<script>|&amp;amp;|&amp;lt;/);
});

test('unknown-country rails stay absent while missing cities use localized generic headings', () => {
  const known = stationBody('de', {}, { countryName: '', cityName: '' });
  assert.ok(section(known, 'country').includes('<h2>Weitere Radiosender aus Deutschland</h2>'));
  const body = stationBody('de', {}, { countryName: '', cityName: '' }, { country: 'Unknown', countryCode: null });
  assert.equal(section(body, 'country'), '');
  assert.ok(section(body, 'city').includes('<h2>Sender in der Nähe</h2>'));
  const empty = stationBody('tr', {}, { sameCountry: [], sameCity: [] });
  assert.equal(section(empty, 'country'), '');
  assert.equal(section(empty, 'city'), '');
});
