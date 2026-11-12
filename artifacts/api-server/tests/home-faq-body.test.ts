import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import { HOME_FAQ_ITEM_IDS, resolveHomeFaqContent } from '@workspace/seo-shared/faq-schema';
import { renderHomeFaqBody } from '../src/seo/home-faq-body';
import { renderHomeStationGuideBody } from '../src/seo/home-station-guide-body';
import { buildLocalizedUrl } from '../src/seo/url-helpers';

mock.module(new URL('../src/performance-cache.ts', import.meta.url).href, {
  namedExports: {
    performanceCache: {
      getTranslations: () => null, setTranslations: () => {}, getPageData: () => null,
      setPageData: () => {}, getUrlTranslations: async () => new Map(), getStats: () => ({}),
    }, PerformanceCache: class {}, deepFreeze: <T,>(value: T) => value,
  },
});
mock.module(new URL('../src/seo/qualified-languages.ts', import.meta.url).href, {
  namedExports: { getCachedQualifiedLanguages: async () => ['en'] },
});
let renderer: any;
before(async () => { const { SeoRenderer } = await import('../src/seo-renderer'); renderer = new SeoRenderer(); });

for (const language of ['en', 'de', 'tr', 'es', 'fr', 'pt', 'it', 'ru', 'ar', 'zh', 'ja', 'ko', 'hi', 'he']) {
  test(`${language} home SSR includes the shared FAQ exactly once without the former keyword-heavy block`, () => {
    const copy = resolveHomeFaqContent(language);
    const href = buildLocalizedUrl('/faq', language);
    const fragment = renderHomeFaqBody(language, {}, href);
    const body = renderer.generateHtmlBody({ pageType: 'home', language, translations: {},
      seoTags: { title: 'Home', canonical: `https://themegaradio.com/${language}`, domain: 'https://themegaradio.com' },
      cleanPath: '/', popularStations: [], genres: [], countries: [], urlTranslations: new Map(),
    });
    assert.ok(body.includes(fragment));
    const guide = renderHomeStationGuideBody(language);
    if (language === 'en' || language === 'fr') {
      assert.ok(body.includes(guide));
      const pilotPath = language === 'en' ? '/de/sender/orf-hitradio-o3' : '/fr/station/radio-couleur-chartreuse';
      assert.equal(body.split(`href="${pilotPath}"`).length - 1, 1);
      assert.ok(guide.includes(`lang="${language}"`));
      assert.ok(body.indexOf(guide) < body.indexOf(fragment));
    } else {
      assert.equal(guide, '');
      assert.ok(!body.includes('data-testid="home-station-guide"'));
    }
    assert.equal((body.match(/data-testid="home-faq"/g) || []).length, 1);
    assert.equal((fragment.match(/<details /g) || []).length, 8);
    assert.ok(fragment.includes(`lang="${language}" dir="${copy.direction}"`));
    assert.ok(fragment.includes(`href="${href}"`));
    for (const id of HOME_FAQ_ITEM_IDS) assert.ok(fragment.includes(`id="home-${id}"`));
    assert.ok(!body.includes('class="about-section"'));
    assert.ok(!body.includes('class="faq-section"'));
    assert.ok(!fragment.includes('FAQPage'));
  });
}

test('custom HTML-like copy and link values are escaped rather than executed', () => {
  const html = renderHomeFaqBody('tr', {
    footer_faq: '<img onerror="bad">', faq_help_platform_answer: '</p><script>bad</script>',
    faq_is_radio_free: '<b>Question</b>', faq_is_radio_free_answer: 'Answer & "quotes"',
  }, '/tr/faq?example="&');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;b&gt;Question&lt;/b&gt;'));
  assert.ok(html.includes('Answer &amp; &quot;quotes&quot;'));
  assert.ok(html.includes('href="/tr/faq?example=&quot;&amp;"'));
});
