import { generateSeoTags, getLanguageFromPath, DEFAULT_LANGUAGE, generateLanguageUrls, COUNTRY_TO_LANGUAGE, CODE_TO_COUNTRY, SEO_LANGUAGES, MAX_GENRE_DIRECTORY_PAGE, generateLocalizedStationTitle, truncateAtWordBoundary, normalizeSeoTitle, LOCALIZED_FLAG_WORD, getStationCountryName, getStationCountryQuery } from '@workspace/seo-shared/seo-config';
import { buildDirectoryIndexSeo } from '@workspace/seo-shared/directory-index-seo';
import { isStationDirectoryPath, isStationDirectoryData, type StationDirectoryData } from '@workspace/seo-shared/station-directory';
import { buildRegionBreadcrumbItems } from '@workspace/seo-shared/region-breadcrumbs';
import { canonicalizeCountry } from '@workspace/seo-shared/country-regions';
import { getStationImageAlt } from '@workspace/seo-shared/station-image-alt';
import { getKnownOgImageDimensions } from '@workspace/seo-shared/og-image-metadata';
import { normalizePublicStationLogoUrl } from '@workspace/seo-shared/station-logo-url';
import { getStationBroadcastLanguages, getSchemaCountry, generateOrganizationSchema, generateWebSiteSchema, generateDeveloperOrganizationSchema } from '@workspace/seo-shared/structured-data';
import { getStationPageCopy, getStationRelatedHeading, getStationStreamUnavailableNotice } from '@workspace/seo-shared/station-page-copy';
import { selectStationVisibleDescription } from '@workspace/seo-shared/station-description-template';
import { withPublicStationDeadline } from './utils/public-station-deadline';
import { withSeoReadDeadline } from './utils/seo-read-deadline';
import { resolveToDbName } from './utils/normalize-country';
import { pgSeoCatalog } from './data/postgres-seo-read-store';
import { boundedSeoReadQuery } from './data/postgres-seo-read-query';
import { readAzStationPage } from './data/postgres-az-station-store';
import { pgStoredGenreBySlug } from './data/postgres-taxonomy-store';
import { pgSeoMetadata } from './data/postgres-content-store';
import { pgLocalization } from './data/postgres-localization-store';
import { getHomeGenreNavigation } from './services/home-genre-navigation';
import { AZ_INDEX_KEYS, azDisplayLabel, matchAzIndexPath } from './seo/az-station-index';
import { isMissingSeoCatalogPage, isSeoCatalogPath, parseSeoCatalogPage, seoCatalogPageLinks } from './seo/catalog-pagination';
import { regionRouteExistence, canonicalRegionPath } from './seo/region-route-existence';
import { buildRegionStationScope } from './services/region-location-data';
import { matchesVerifiedLegacyStationTarget, verifiedLegacyStationAlias } from './seo/verified-legacy-station-alias';
import { withPilotEditorial } from './seo/indexing-pilot';
import { collectStationLinkTargets, resolveStationLinkLanguages, buildStationLinkUrl } from './seo/station-link-locale';
import { readSeoStationLinkMetadata } from './data/postgres-seo-station-link-store';
import { loadPublicDiscoveryStations, trendingPageSeo } from './seo/public-discovery';
import { resolveBareDiscoveryPath } from './seo/public-route-matchers';
import { relatedStationCards } from './seo/related-station-cards';

// The renderer only needs this small subset of the normalized catalog shape.
interface LeanStationCard {
  _id?: unknown;
  name?: string;
  slug?: string;
  favicon?: string;
  logoAssets?: unknown;
  country?: string;
  countryCode?: string;
  tags?: string;
  votes?: number;
  descriptions?: Record<string, unknown>;
  url?: string;
  homepage?: string;
  bitrate?: number;
  lastCheckOk?: boolean;
  isListVisible?: boolean;
  lastCheckOkTime?: Date;
  lastCheckTime?: Date;
  noIndex?: boolean;
}

const SSR_CARD_FIELDS = ['_id', 'name', 'slug', 'url', 'noIndex', 'isListVisible',
  'favicon', 'logoAssets', 'country', 'countryCode', 'tags', 'votes', 'genre'];
const SSR_METADATA_READER = { query: (text: string, values: any[]) => boundedSeoReadQuery(text, values, 'metadata') };
const SSR_GENRE_READER = { query: (text: string, values: any[]) => boundedSeoReadQuery(text, values, 'genre') };

// These shells have no public list. Their SEO API metadata must agree with
// the HTTP noindex policy even when robots allows crawlers to read the shell.
const PRIVATE_PAGE_ROOTS = new Set([
  'admin', 'admin-login', 'auth', 'login', 'signup', 'profile', 'favorites',
  'settings', 'notifications', 'messages', 'analytics', 'import-export',
  'dashboard', 'premium', 'premium-success', 'activate', 'activate-success',
  'reset-password', 'forgot-password', 'change-password', 'tv-login',
  'station-requests', 'station-submissions', 'request-station', 'status-monitoring', 'sync',
]);

type LeanSeoMetadataDoc = Record<string, any>;
import { performanceCache } from './performance-cache';
import { logger } from './utils/logger';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
import { renderLegalPageHtml } from '@workspace/seo-shared/legal-content-html';
import { trackOperation } from './utils/operation-tracker';
import { isJunkStation } from './seo/junk-station-rules';
import { buildGenreSeo } from '@workspace/seo-shared/genre-seo-templates';
import { buildCountrySeo, buildRegionSeo } from '@workspace/seo-shared/region-seo-templates';
import { buildSearchSeo } from '@workspace/seo-shared/search-seo-templates';
import { buildLegalSeo } from '@workspace/seo-shared/legal-seo-templates';
import { buildStaticPageSeo } from '@workspace/seo-shared/static-page-seo-templates';
import { renderStaticInformationBody } from './seo/static-information-body';
import { renderHomeFaqBody } from './seo/home-faq-body';
import { buildHomeSeo } from '@workspace/seo-shared/home-seo-templates';
import { getHomeHeroCopy } from '@workspace/seo-shared/home-hero-copy';
import { buildCommunityPageSeo } from '@workspace/seo-shared/community-page-seo-templates';
import { getLocalizedCountryName, getLocalizedRegionName } from '@workspace/seo-shared/country-name-translations';
import {
  getCanonicalGenreSlug,
  MIN_STATIONS_FOR_GENRE_INDEX,
} from './seo/genre-whitelist';
import { resolveFaqPageItems, resolveFaqPageText } from '@workspace/seo-shared/faq-schema';
import { loadBlogContent, buildBlogSeo, buildBlogSchema } from '@workspace/seo-shared/blog';
import { isBlogPath, parseBlogPath, BLOG_LABELS, isBlogLocale, blogPath } from '@workspace/seo-shared/blog-manifest';
import { renderBlogHtml } from '@workspace/seo-shared/blog-html';

// SEO audit fix (2026-05-12) — per-language fallback labels used by the
// regions/country page <title>+<h1> when the corresponding DB translation
// keys (`seo_radio_stations`, `seo_listen_live_online`) are missing. Without
// these, non-English pages fell back to English and produced half-translated
// titles like "Turkey Radio Stations — Canlı Dinle | Mega Radio" (the audit's
// "Multilingual URL Structure and Language Mismatch" finding). Keys cover the
// SEO_LANGUAGES set; anything outside falls back to English.
const LOCALIZED_RADIO_STATIONS: Record<string, string> = {
  en: 'Radio Stations', tr: 'Radyo İstasyonları', es: 'Estaciones de Radio',
  fr: 'Stations de Radio', de: 'Radiosender', it: 'Stazioni Radio',
  pt: 'Estações de Rádio', nl: 'Radiostations', ru: 'Радиостанции',
  ar: 'محطات الراديو', ja: 'ラジオ局', ko: '라디오 방송국',
  zh: '广播电台', hi: 'रेडियो स्टेशन', pl: 'Stacje Radiowe',
  sv: 'Radiostationer', da: 'Radiostationer', fi: 'Radioasemat',
  no: 'Radiostasjoner', cs: 'Rozhlasové Stanice', el: 'Ραδιοφωνικοί Σταθμοί',
  he: 'תחנות רדיו', hu: 'Rádióállomások', id: 'Stasiun Radio',
  ms: 'Stesen Radio', ro: 'Posturi de Radio', sk: 'Rozhlasové Stanice',
  th: 'สถานีวิทยุ', uk: 'Радіостанції', vi: 'Đài Phát Thanh',
  bg: 'Радиостанции', hr: 'Radio Postaje', sr: 'Радио станице',
  sl: 'Radijske Postaje', et: 'Raadiojaamad', lv: 'Radio Stacijas',
  lt: 'Radijo Stotys', fa: 'ایستگاه‌های رادیویی', ur: 'ریڈیو سٹیشنز',
  bn: 'রেডিও স্টেশন', ta: 'வானொலி நிலையங்கள்', tl: 'Mga Istasyon ng Radyo',
  te: 'రేడియో స్టేషన్లు', mr: 'रेडिओ स्टेशन्स', gu: 'રેડિયો સ્ટેશનો',
  kn: 'ರೇಡಿಯೋ ಕೇಂದ್ರಗಳು', ml: 'റേഡിയോ സ്റ്റേഷനുകൾ', pa: 'ਰੇਡੀਓ ਸਟੇਸ਼ਨ',
  sw: 'Vituo vya Redio', am: 'የራዲዮ ጣቢያዎች', zu: 'Iziteshi Zomsakazo',
  af: 'Radiostasies', sq: 'Stacione Radio', az: 'Radio Stansiyaları',
  hy: 'Ռադիոկայաններ', so: 'Idaacadaha Raadiyaha', bs: 'Radio Stanice',
};
const LOCALIZED_LISTEN_LIVE: Record<string, string> = {
  en: 'Listen Live Online', tr: 'Canlı Dinle', es: 'Escuchar en Vivo Online',
  fr: 'Écouter en Direct', de: 'Live Online Hören', it: 'Ascolta in Diretta Online',
  pt: 'Ouça ao Vivo Online', nl: 'Live Online Luisteren', ru: 'Слушать в Прямом Эфире',
  ar: 'استمع مباشرة عبر الإنترنت', ja: 'オンラインでライブ視聴', ko: '온라인 실시간 청취',
  zh: '在线直播收听', hi: 'लाइव ऑनलाइन सुनें', pl: 'Słuchaj na Żywo Online',
  sv: 'Lyssna Live Online', da: 'Lyt Live Online', fi: 'Kuuntele Suorana Verkossa',
  no: 'Lytt Live på Nett', cs: 'Poslouchejte Živě Online', el: 'Ακούστε Ζωντανά Online',
  he: 'האזינו בשידור חי באינטרנט', hu: 'Hallgasd Élőben Online', id: 'Dengarkan Langsung Online',
  ms: 'Dengar Langsung Dalam Talian', ro: 'Ascultă Live Online', sk: 'Počúvajte Naživo Online',
  th: 'ฟังสดออนไลน์', uk: 'Слухати в Прямому Ефірі', vi: 'Nghe Trực Tiếp Online',
  bg: 'Слушайте на Живо Онлайн', hr: 'Slušajte Uživo Online', sr: 'Слушајте Уживо Онлајн',
  sl: 'Poslušajte v Živo Online', et: 'Kuula Otse Internetis', lv: 'Klausieties Tiešraidē Online',
  lt: 'Klausykitės Tiesiogiai Internetu', fa: 'پخش زنده آنلاین', ur: 'لائیو آن لائن سنیں',
  bn: 'লাইভ অনলাইন শুনুন', ta: 'நேரலையில் இணையத்தில் கேளுங்கள்', tl: 'Makinig nang Live Online',
  te: 'ప్రత్యక్షంగా ఆన్‌లైన్‌లో వినండి', mr: 'थेट ऑनलाइन ऐका', gu: 'લાઇવ ઑનલાઇન સાંભળો',
  kn: 'ಲೈವ್ ಆನ್‌ಲೈನ್ ಆಲಿಸಿ', ml: 'തത്സമയം ഓൺലൈനിൽ കേൾക്കൂ', pa: 'ਲਾਈਵ ਔਨਲਾਈਨ ਸੁਣੋ',
  sw: 'Sikiliza Moja kwa Moja Mtandaoni', am: 'በቀጥታ በመስመር ላይ ያዳምጡ', zu: 'Lalela Bukhoma Online',
  af: 'Luister Regstreeks Aanlyn', sq: 'Dëgjo Live Online', az: 'Canlı Onlayn Dinləyin',
  hy: 'Ունկնդրեք ուղիղ առցանց', so: 'Ku dhageyso Toos ah Online', bs: 'Slušajte Uživo Online',
};

const SEO_RENDER_MAX_CONCURRENT = 2500;
const SEO_RENDER_TIMEOUT_MS = 10_000;
let seoRenderActive = 0;
let seoRenderRejected = 0;
let eventLoopLagMs = 0;
// Raised 500 → 800ms: under brisk crawl traffic the event loop briefly spikes
// above 500ms during JSON serialization of large hreflang/structured data
// blocks. Rejecting at 500ms made Googlebot see frequent overload errors and
// throttle its crawl rate. 800ms still protects against true overload while
// allowing normal SSR work to complete.
const EVENT_LOOP_LAG_THRESHOLD_MS = 800;

const eventLoopLagTimer = setInterval(() => {
  const start = Date.now();
  setImmediate(() => {
    eventLoopLagMs = Date.now() - start;
  });
}, 2000);
eventLoopLagTimer.unref();

export function getSeoRenderStats() {
  return { active: seoRenderActive, rejected: seoRenderRejected, eventLoopLag: eventLoopLagMs };
}

// Decoupled from the render budget (2026-07-01). It used to be
// SEO_RENDER_TIMEOUT_MS - 500 = 9500ms, meaning ONE slow enrichment query
// (genre/region popular-stations, cross-links) could consume almost the whole
// 10s render budget — pushing the render over SEO_RENDER_TIMEOUT, which falls
// back to a NOINDEX SPA shell with no <h1> (the "H1 missing / not indexed"
// symptom on genre/region pages). Cap every SSR query at 4s instead: the
// critical, index-covered lookups (station/genre by slug, translations) return
// in well under that, while a genuinely slow enrichment query now soft-fails to
// an empty grid FAST, leaving ample budget for generateHtmlBody to still emit a
// proper <h1>/<h2> and an indexable body.
const DB_QUERY_TIMEOUT_MS = 4_000;

function withSignal<T>(query: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve,reject) => {
    let settled = false;
    const finish = (error?: unknown,value?: T) => {
      if(settled)return;
      settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
      error ? reject(error) : resolve(value as T);
    };
    const onAbort = () => finish(new DOMException('Aborted','AbortError'));
    const timer=setTimeout(()=>finish(new Error('SEO database read budget exceeded')),DB_QUERY_TIMEOUT_MS);
    timer.unref();
    signal?.addEventListener('abort',onAbort,{once:true});
    Promise.resolve(query).then(value=>finish(undefined,value),error=>finish(error));
    if(signal?.aborted)onAbort();
  });
}

export interface StaticPageData {
  language: string;
  cleanPath: string;
  seoTags: any;
  translations: Record<string, string>;
  pageData?: any;
  urlTranslations?: Map<string, string>;
}

// Task #127: pure URL helpers live in `seo/url-helpers.ts` so the soft-404
// regression test suite can import them without booting the renderer
// (which registers setInterval handles for event-loop monitoring). Re-exported
// here to preserve the existing `buildLocalizedUrl` import path used across
// the codebase.
export {
  buildLocalizedUrl,
  VALID_CONTINENT_SLUGS,
  validateRegionRouteShape,
  isExactCountryPagePath,
} from './seo/url-helpers';
import {
  buildLocalizedUrl,
  VALID_CONTINENT_SLUGS,
  validateRegionRouteShape,
  isExactCountryPagePath,
} from './seo/url-helpers';

export class SeoRenderer {
  
  async getTranslationsForLanguage(language: string, signal?: AbortSignal): Promise<Record<string, string>> {
    const cached = performanceCache.getTranslations(language);
    if (cached) {
      return cached;
    }
    
    try {
      signal?.throwIfAborted();
      const translationMap = await pgLocalization().getTranslations(language);
      signal?.throwIfAborted();
      
      // Cache for future requests
      performanceCache.setTranslations(language, translationMap);
      
      return translationMap;
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      console.error(`❌ Failed to fetch translations for ${language}:`, error);
      throw error;
    }
  }
  
  /**
   * Fetch custom SEO metadata from database for a specific page
   * Returns null if no published metadata exists
   */
  async getCustomSeoMetadata(pageType: string, routeKey: string, language: string, signal?: AbortSignal): Promise<any | null> {
    try {
      const metadata = await withSignal<LeanSeoMetadataDoc | null>(
        pgSeoMetadata({
          pageType,routeKey: routeKey || '',language,status:'published',
        }, SSR_METADATA_READER),
        signal,
      );
      
      return metadata;
    } catch (error: any) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      logger.error(`❌ Failed to fetch custom SEO metadata:`, error);
      return null;
    }
  }
  
  /**
   * Apply custom SEO metadata to base SEO tags if available
   */
  applyCustomSeoMetadata(baseSeoTags: any, customMetadata: any): any {
    if (!customMetadata) return baseSeoTags;
    
    // Override with custom values if present
    if (customMetadata.title) baseSeoTags.title = customMetadata.title;
    if (customMetadata.description) baseSeoTags.description = customMetadata.description;
    if (customMetadata.ogTitle) baseSeoTags.ogTitle = customMetadata.ogTitle;
    if (customMetadata.ogDescription) baseSeoTags.ogDescription = customMetadata.ogDescription;
    if (customMetadata.ogImageUrl) baseSeoTags.ogImage = customMetadata.ogImageUrl;
    if (customMetadata.twitterTitle) baseSeoTags.twitterTitle = customMetadata.twitterTitle;
    if (customMetadata.twitterDescription) baseSeoTags.twitterDescription = customMetadata.twitterDescription;
    if (customMetadata.twitterImageUrl) baseSeoTags.twitterImage = customMetadata.twitterImageUrl;
    if (customMetadata.canonicalUrl) {
      // S11 FIX (2026-05-08): admin-supplied canonical can be relative
      // ("/en/about"), absolute on a different host, or missing scheme.
      // Normalize to an absolute URL on the request's domain so we never
      // emit a self-pointing/relative <link rel=canonical> (Google ignores
      // relative canonicals in the head and treats it as missing).
      const raw = String(customMetadata.canonicalUrl).trim();
      if (raw) {
        try {
          const base = baseSeoTags.canonical && /^https?:\/\//i.test(baseSeoTags.canonical)
            ? baseSeoTags.canonical
            : 'https://themegaradio.com/';
          const u = new URL(raw, base);
          baseSeoTags.canonical = u.toString();
        } catch {
          baseSeoTags.canonical = raw;
        }
      }
    }
    if (customMetadata.metaKeywords) baseSeoTags.keywords = customMetadata.metaKeywords;
    if (customMetadata.noIndex) baseSeoTags.noIndex = customMetadata.noIndex;
    if (customMetadata.noFollow) baseSeoTags.noFollow = customMetadata.noFollow;
    
    return baseSeoTags;
  }

  private finalizeSeoDirectives(seoTags: any, previousRobots = ''): any {
    const directives = `${seoTags.robots || 'index, follow'},${previousRobots}`.split(',')
      .map((directive: string) => directive.trim()).filter(Boolean);
    const noIndex = seoTags.noIndex === true
      || directives.some((directive: string) => /^(?:noindex|none)$/i.test(directive));
    const noFollow = seoTags.noFollow === true
      || directives.some((directive: string) => /^(?:nofollow|none)$/i.test(directive));

    // Restrictive flags and tokens win; keep unrelated preview/archive limits.
    return {
      ...seoTags,
      robots: [noIndex ? 'noindex' : 'index', noFollow ? 'nofollow' : 'follow',
        ...new Set(directives.filter((directive: string) => !/^(?:index|noindex|follow|nofollow|all|none)$/i.test(directive))),
      ].join(', '),
      ...(noIndex ? { noIndex: true, hreflangs: [], ogLocaleAlternates: [] } : {}),
      ...(noFollow ? { noFollow: true } : {}),
    };
  }
  
  async renderStaticPage(url: string, domain: string = '', preferredLanguage?: string): Promise<StaticPageData> {
    if (seoRenderActive >= SEO_RENDER_MAX_CONCURRENT || eventLoopLagMs > EVENT_LOOP_LAG_THRESHOLD_MS) {
      seoRenderRejected++;
      logger.log(`⚠️ SEO render rejected (active=${seoRenderActive}, lag=${eventLoopLagMs}ms, rejected=${seoRenderRejected}): ${url}`);
      throw new Error('SEO_RENDER_OVERLOADED');
    }

    seoRenderActive++;

    const abortController = new AbortController();
    let timerId: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        withSeoReadDeadline({ expiresAt: Date.now() + SEO_RENDER_TIMEOUT_MS, signal: abortController.signal },
          () => withPublicStationDeadline(() => this._doRenderStaticPage(url, domain, preferredLanguage, abortController.signal))),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(() => {
            abortController.abort();
            reject(new Error('SEO_RENDER_TIMEOUT'));
          }, SEO_RENDER_TIMEOUT_MS);
        })
      ]);
      clearTimeout(timerId);
      return result;
    } catch (err: any) {
      clearTimeout(timerId);
      if (!abortController.signal.aborted) abortController.abort();
      if (err?.message === 'SEO_RENDER_TIMEOUT' || err?.name === 'AbortError') {
        throw new Error('SEO_RENDER_TIMEOUT');
      }
      throw err;
    } finally {
      seoRenderActive--;
    }
  }

  private async _doRenderStaticPage(url: string, domain: string = '', preferredLanguage?: string, signal?: AbortSignal): Promise<StaticPageData> {
    return trackOperation('seo-render', async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const cleanUrl = url.split('?')[0].split('#')[0];

    // Get language from URL path, but prefer user's stored preference if available
    let { language, cleanPath } = resolveBareDiscoveryPath(cleanUrl) || getLanguageFromPath(cleanUrl);
    // Editorial URLs own their locale. A preference cookie must not substitute
    // another language at a crawlable, self-canonical article URL. No DB reads
    // are needed to render these versioned articles.
    if (isBlogPath(cleanPath)) {
      const route = parseBlogPath(cleanUrl);
      const missingBlog = (): StaticPageData => ({ language, cleanPath, translations: {}, urlTranslations: new Map(),
        seoTags: { title: '404 | MegaRadio', robots: 'noindex, follow', noIndex: true, hreflangs: [] },
        pageData: { pageType: 'blog', httpNotFound: true, notFound: true } });
      if (!route) return missingBlog();
      const content = await loadBlogContent(route.locale);
      const blog = { locale: route.locale, content, article: content.articles.find(a => a.id === route.id) };
      if (route.id && !blog.article) return missingBlog();
      const seoTags = buildBlogSeo(blog);
      return { language: seoTags.language || route.locale, cleanPath, translations: {}, urlTranslations: new Map(), seoTags,
        pageData: { pageType: 'blog', seoTags, blog, additionalData: { blog }, notFound: false } };
    }
    const pagination = parseSeoCatalogPage(url);
    // Validate before either pageData or HTML can alias an invalid request to
    // a cached valid slice. Non-paginated pages retain their query behaviour.
    if (isSeoCatalogPath(cleanPath) && (!pagination.valid
      || (cleanPath.startsWith('/genres/') && pagination.page > MAX_GENRE_DIRECTORY_PAGE))) {
      return { language, cleanPath, translations: {}, urlTranslations: new Map(),
        seoTags: { robots: 'noindex, follow', noIndex: true, hreflangs: [] },
        pageData: { pageType: 'stations', notFound: true, httpNotFound: true } };
    }
    
    // CRITICAL: Language/Country separation
    // If user has a stored language preference (from cookie), use that instead of country-derived language
    // This ensures a Turkish user viewing /de/ sees Turkish UI, not German
    if (preferredLanguage && preferredLanguage.toLowerCase() !== language.toLowerCase()) {
      // Validate the preferred language is enabled (case-insensitive comparison for hyphenated codes like pt-BR)
      const normalizedPref = preferredLanguage.toLowerCase();
      const matchedLang = SEO_LANGUAGES.find(l => l.code.toLowerCase() === normalizedPref && l.enabled);
      if (matchedLang) {
        logger.log(`🌍 SSR: Using stored language preference '${matchedLang.code}' instead of URL-derived '${language}'`);
        language = matchedLang.code; // Use the canonical casing from SEO_LANGUAGES
      }
    }
    
    // CRITICAL: Cache key uses cleanUrl (query/hash stripped) + preferredLanguage to avoid collision
    // Without this, /de/ cached in German would be served to Turkish users
    // Using cleanUrl prevents unbounded cache key cardinality from query params
    const normalizedLang = preferredLanguage?.toLowerCase();
    // The /stations catalog hub AND the /regions|/country country hubs render
    // a different slice of stations per `?page`, but the query string is
    // stripped from cleanUrl above — so page 2 would otherwise be served
    // page 1's cached HTML. Fold the clamped page number into the cache key
    // for those paginated hubs (bounded cardinality: ≤50 per URL).
    // See SEO re-audit 2026-06-20, internal-linking Component (a).
    let pageSuffix = '';
    if (
      cleanPath.startsWith('/stations') ||
      cleanPath.startsWith('/genres/') ||
      cleanPath.startsWith('/regions') ||
      cleanPath.startsWith('/country')
    ) {
      const pg = pagination.valid ? pagination.page : 1;
      if (pg > 1) pageSuffix = `|page=${pg}`;
    }
    const cacheKey = (normalizedLang ? `${cleanUrl}|lang=${normalizedLang}` : cleanUrl) + pageSuffix
      + (cleanPath === '/genres' ? `|genre-whitelist=${(await import('./seo/directory-hub-data')).genreDirectoryCacheRevision()}` : '');
    
    // Check cache for complete page data first
    const cachedPageData = performanceCache.getPageData(cacheKey);
    if (cachedPageData) {
      return cachedPageData;
    }
    
    const [translations, urlTranslations] = await Promise.all([
      this.getTranslationsForLanguage(language, signal),
      performanceCache.getUrlTranslations(),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    
    // Detect if this is a country-specific URL (e.g., /al/zhanret)
    const urlParts = url.split('/').filter(Boolean);
    let countryCode: string | undefined;
    // CRITICAL: Keep the language we already determined (possibly from cookie preference)
    // Only extract country code for URL building, NOT for language determination
    let actualLanguage = language;
    
    if (urlParts.length > 0) {
      const firstSegment = urlParts[0].toLowerCase();
      // Check if first segment is a country code
      if (COUNTRY_TO_LANGUAGE[firstSegment]) {
        countryCode = firstSegment;
        // DO NOT override actualLanguage here - language was already determined above
        // (either from path translation or preferredLanguage cookie)
        // This ensures a Turkish user on /de/ sees Turkish UI
      }
    }
    
    // A-Z station index (Task #11, 2026-07-03): /stations/a … /stations/0-9.
    // Detect BEFORE localizedPath so canonical/hreflang derive from the
    // normalized plural form even when the reverse translation produced the
    // singular (/station/a) — both middleware and sitemap emit the plural.
    const azLetter = matchAzIndexPath(cleanPath);
    if (azLetter) cleanPath = `/stations/${azLetter}`;

    // Build localized URL path for canonical URL
    // This translates English paths like /genres to language-specific paths like /zhanret (Albanian)
    const localizedPath = buildLocalizedUrl(cleanPath, actualLanguage, countryCode, urlTranslations);
    
    // Determine page type from path and extract relevant data
    let pageType = 'home';
    let stationData: any = null;
    let stationIdFallback: string | undefined;
    let additionalData: any = {};
    
    // Helper function to detect if path is a station path in ANY language
    const isStationPath = (path: string): { isStation: boolean; stationSlug?: string } => {
      // Check English paths (both singular and plural - some languages reverse-translate to 'stations')
      if (path.startsWith('/station/')) {
        return { isStation: true, stationSlug: path.split('/station/')[1] };
      }
      if (path.startsWith('/stations/')) {
        return { isStation: true, stationSlug: path.split('/stations/')[1] };
      }
      
      // Check all language translations for 'station' and 'stations' paths
      for (const [langCode, translations] of Object.entries(URL_TRANSLATIONS)) {
        const stationTranslation = translations.station;
        if (stationTranslation && path.startsWith(`/${stationTranslation}/`)) {
          return { isStation: true, stationSlug: path.split(`/${stationTranslation}/`)[1] };
        }
        
        // Also check 'stations' (plural) in case reverse translation gives plural form
        const stationsTranslation = translations.stations;
        if (stationsTranslation && stationsTranslation !== stationTranslation && path.startsWith(`/${stationsTranslation}/`)) {
          return { isStation: true, stationSlug: path.split(`/${stationsTranslation}/`)[1] };
        }
      }
      
      return { isStation: false };
    };
    
    // Enhanced page type detection with more specific routing.
    // A-Z index paths look exactly like /stations/<slug> so they must skip
    // the station-detail detection — cleanPath was normalized above and the
    // /stations branch below handles the letter listing.
    const stationCheck = azLetter ? { isStation: false as const } : isStationPath(cleanPath);
    let stationNotFound = false;
    if (stationCheck.isStation) {
      pageType = 'station';
      // Extract station slug from path
      const stationSlug = stationCheck.stationSlug;
      if (stationSlug) {
        try {
          stationData = await withSignal(pgSeoCatalog().findOne({ slug: stationSlug }), signal);

          // Fall back to slug aliases (old slugs from before transliteration fix).
          // When matched, signal a 301 redirect to the canonical URL so search
          // engines consolidate ranking on the new slug instead of indexing both.
          if (!stationData) {
            let aliasMatch: any = await withSignal(
              pgSeoCatalog().findMergedAlias(stationSlug).then(match => match ?? pgSeoCatalog().findOne({ slugAliases: stationSlug })),
              signal,
            );
            // Only repair reviewed historical spellings after every exact
            // identity lookup missed. Keep the normal junk/canonical gates below.
            const repairedAlias = !aliasMatch && verifiedLegacyStationAlias(stationSlug);
            if (repairedAlias) {
              aliasMatch = await withSignal(
                pgSeoCatalog().findOne({ slug: repairedAlias }).then(match => match
                  ?? pgSeoCatalog().findMergedAlias(repairedAlias).then(merged => merged
                    ?? pgSeoCatalog().findOne({ slugAliases: repairedAlias }))),
                signal,
              );
              if (aliasMatch && !matchesVerifiedLegacyStationTarget(stationSlug, aliasMatch._id, aliasMatch.redirectToSlug)) {
                aliasMatch = null;
              }
            }
            if (aliasMatch && aliasMatch.slug && aliasMatch.slug !== stationSlug) {
              const { isJunkStation, isNumericOnlySlug, canRenderLegacyStationInformation, getIndexableLanguagesForStation } = await import('./seo/junk-station-rules');
              // A retained duplicate can own historical aliases and an explicit
              // redirect. Resolve that single hop before its noindex gate, but
              // never promote a missing/excluded target or follow redirect chains.
              let aliasRedirectRejected = false;
              let aliasRedirectLanguage = actualLanguage;
              if (aliasMatch.redirectToSlug) {
                const target = await withSignal(pgSeoCatalog().findOne({ slug: aliasMatch.redirectToSlug }), signal);
                if (target && target.slug === aliasMatch.redirectToSlug
                    && target.slug !== aliasMatch.slug && target.slug !== stationSlug
                    && target.noIndex === false && !target.redirectToSlug
                    && !isNumericOnlySlug(target.slug) && !isJunkStation(target)) {
                  aliasMatch = target;
                  aliasRedirectLanguage = getIndexableLanguagesForStation(target).includes(actualLanguage) ? actualLanguage : 'en';
                } else {
                  aliasRedirectRejected = true;
                }
              }
              // JUNK GATE (Architect P1, Apr 2026): If the canonical target is
              // itself a junk station (noIndex:true or matches isJunkStation
              // heuristics), DO NOT 301 to it — that would tell Google "this
              // old URL = good new URL" and consolidate ranking onto a page we
              // explicitly want gone. Instead, signal stationIsJunk:true so
              // the HTTP layer in index.ts/index-web.ts serves 410 Gone for
              // the original alias URL too. Same gate the main station branch
              // uses (line ~503) to keep alias and canonical paths consistent.
              const aliasTargetIsJunk =
                aliasRedirectRejected || isJunkStation(aliasMatch)
                || (!!repairedAlias && aliasMatch.noIndex === true)
                || (aliasMatch.noIndex === true && !canRenderLegacyStationInformation(aliasMatch));
              if (aliasTargetIsJunk) {
                // CRITICAL: Do NOT set notFound:true — the HTTP-layer junk
                // handler in both index.ts:1068 and index-web.ts:719 gates on
                // `!stationNotFound && !!stationIsJunk`. Setting notFound here
                // would skip the 410 path and fall through to a generic 404,
                // which is a weaker signal to Google than 410 Gone.
                logger.log(`🚫 SEO ALIAS 410: ${cleanPath} (${stationSlug}) → ${aliasMatch.slug} is junk, serving 410 Gone`);
                return {
                  language,
                  cleanPath,
                  seoTags: { robots: 'noindex, follow', noIndex: true } as any,
                  translations: {},
                  pageData: {
                    stationIsJunk: true,
                    pageType: 'station',
                  } as any,
                };
              }

              // BUG FIX (Apr 2026): cleanPath comes from getLanguageFromPath() which
              // STRIPS the language prefix and REVERSE-TRANSLATES the path back to
              // English (e.g. "/ar/mahta/old-slug" -> cleanPath "/station/old-slug").
              // Previously we did `cleanPath.replace(stationSlug, newSlug)` which
              // produced "/station/new-slug" (no language prefix, no localized
              // segment) and triggered a 3-hop redirect chain back to /en/...,
              // causing massive "Crawled - currently not indexed" duplication in
              // Google Search Console. Now we rebuild the FULL localized canonical
              // (lang prefix + translated segment) so it's a single 301 hop to the
              // correct localized URL — preserving language signal and SEO equity.
              const englishCanonical = `/station/${aliasMatch.slug}`;
              const canonicalPath = buildLocalizedUrl(
                englishCanonical,
                aliasRedirectLanguage,
                aliasRedirectLanguage === actualLanguage ? countryCode : undefined,
                urlTranslations,
              );
              logger.log(`🔀 SEO ALIAS 301: ${cleanPath} (${stationSlug}) → ${canonicalPath} (${aliasMatch.slug})`);
              return {
                language,
                cleanPath,
                seoTags: {},
                translations: {},
                pageData: { redirectTo: canonicalPath },
              };
            }
            stationData = aliasMatch;
          }

          if (!stationData && stationSlug.match(/^[0-9a-fA-F]{24}$/)) {
            stationIdFallback = stationSlug;
            stationData = await withSignal(pgSeoCatalog().findById(stationSlug), signal);
          }

          // Retained duplicates may redirect only to one verified final record.
          // Match the alias gate above: never consolidate signals onto missing,
          // excluded, junk or chained destinations. Lookup errors deliberately
          // reach the outer transient-error handler (uncached 503), not this 410.
          if (stationData && stationData.redirectToSlug) {
            const canonicalSlug = stationData.redirectToSlug;
            const { isJunkStation, isNumericOnlySlug, getIndexableLanguagesForStation } = await import('./seo/junk-station-rules');
            const target = typeof canonicalSlug === 'string'
              && canonicalSlug !== stationData.slug && canonicalSlug !== stationSlug
              ? await withSignal(pgSeoCatalog().findOne({ slug: canonicalSlug }), signal)
              : null;
            if (!target || target.slug !== canonicalSlug || target.noIndex !== false
                || target.redirectToSlug || isNumericOnlySlug(target.slug) || isJunkStation(target)) {
              return {
                language,
                cleanPath,
                seoTags: { robots: 'noindex, follow', noIndex: true } as any,
                translations: {},
                pageData: { stationIsJunk: true, pageType: 'station' } as any,
              };
            }
            // Do not replace a substring: slugs such as "station" or "sta"
            // also occur in the route prefix and would produce the wrong URL.
            const englishCanonical = `/station/${canonicalSlug}`;
            const redirectLanguage = getIndexableLanguagesForStation(target).includes(actualLanguage) ? actualLanguage : 'en';
            const canonicalPath = buildLocalizedUrl(
              englishCanonical,
              redirectLanguage,
              redirectLanguage === actualLanguage ? countryCode : undefined,
              urlTranslations,
            );
            logger.log(`🔀 SEO FREQ-DUP 301: ${cleanPath} (${stationSlug}) → ${canonicalPath} (${canonicalSlug})`);
            return {
              language,
              cleanPath,
              seoTags: {},
              translations: {},
              pageData: { redirectTo: canonicalPath },
            };
          }

          if (stationData) stationData = withPilotEditorial(stationData);

          // If station truly doesn't exist, mark notFound and synthesize minimal data so SSR
          // can still render a 404 body (avoids 500). Caller (index-web.ts) maps this to HTTP 404,
          // preventing Google soft-404 spam signals.
          if (!stationData) {
            stationNotFound = true;
            const stationName = stationSlug
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase());
            stationData = {
              _id: null,
              name: stationName,
              slug: stationSlug,
              country: '',
              tags: '',
              url: '',
              favicon: '',
              description: '',
              notFound: true,
            };
          }
        } catch (error: any) {
          if (error?.name === 'AbortError' || signal?.aborted) throw error;
          // DB error — transient; don't mark notFound so the URL stays in
          // Google's crawl queue. Placeholder data is synthetic — flag it so
          // the HTTP layer returns a retryable 503, not a permanent 410/noindex.
          const stationName = stationSlug
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (l: string) => l.toUpperCase());
          stationData = {
            _id: null,
            name: stationName,
            slug: stationSlug,
            country: '',
            tags: '',
            url: '',
            favicon: '',
            description: '',
            _dbError: true,
          };
        }
      }
    } else if (cleanPath.startsWith('/genres')) {
      pageType = 'genres';
      if (cleanPath === '/genres') {
        try {
          const { loadGenreDirectoryHub } = await import('./seo/directory-hub-data');
          additionalData.directoryGenres = await withSignal(loadGenreDirectoryHub(), signal);
        } catch (error: any) {
          if (error?.name === 'AbortError' || signal?.aborted) throw error;
          additionalData.hubReadFailed = true;
          logger.warn('Genre directory reference data temporarily unavailable');
        }
      }
      // Extract genre slug if present for more specific SEO
      const pathParts = cleanPath.split('/');
      if (pathParts.length > 2) {
        // Task #102: Genre detail URLs with non-conforming slugs (containing
        // `"`, `%22`, spaces, or other unsafe chars) are leftover artifacts of
        // a sitemap bug that emitted unescaped tag-derived slugs. They render
        // empty thin pages and are the largest source of soft-404s. Reject
        // them at the SSR layer with notFound:true so index-web returns 404,
        // dropping them out of Google's index.
        // Guard against malformed percent-encoding (e.g. lone `%`) which
        // would throw URIError and bubble up as a 500. Treat undecodable
        // input as a not-found genre slug.
        let rawGenreSlug: string;
        try {
          rawGenreSlug = decodeURIComponent(pathParts[2]);
        } catch {
          rawGenreSlug = pathParts[2];
        }
        const SAFE_GENRE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
        if (pathParts.length !== 3 || !SAFE_GENRE_SLUG_RE.test(rawGenreSlug)) {
          stationNotFound = true;
          additionalData.notFound = true;
          if (pathParts.length !== 3) additionalData.httpNotFound = true;
          additionalData.genreSlug = rawGenreSlug;
          additionalData.genreName = rawGenreSlug;
        } else {
        const requestedSlug = pathParts[2];
        additionalData.genreSlug = requestedSlug;
        additionalData.genreName = requestedSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        // Task #104: gate the /genres/:slug surface against the genre whitelist.
        //   1. If the slug is on the whitelist → render normally (may still be
        //      noindex'ed below if it has <6 indexable popular stations).
        //   2. If the slug is a known close-match alias whose canonical IS on
        //      the whitelist → 301 redirect to the canonical localized URL so
        //      Google consolidates ranking on the real genre.
        //   3. Otherwise (raw tag noise — FM frequencies, city names, station
        //      brands, random tokens) → mark the page noindex; the URL is also
        //      already dropped from the sitemap by sitemap-manifest-builder.ts.
        const canonicalSlug = getCanonicalGenreSlug(requestedSlug);
        if (canonicalSlug && canonicalSlug !== requestedSlug.toLowerCase()) {
          // Aliased — emit a 301 to the canonical genre URL.
          const englishCanonicalPath = `/genres/${canonicalSlug}`;
          const canonicalLocalized = buildLocalizedUrl(
            englishCanonicalPath,
            actualLanguage,
            countryCode,
            urlTranslations,
          );
          logger.log(`🔀 SEO GENRE 301: ${cleanPath} → ${canonicalLocalized} (alias → ${canonicalSlug})`);
          return {
            language,
            cleanPath,
            seoTags: {},
            translations: {},
            pageData: { redirectTo: canonicalLocalized },
          };
        }
        if (!canonicalSlug) {
          // Not on the whitelist and not aliased — flag for noindex below.
          additionalData.genreNotWhitelisted = true;
        } else {
          // AUTHORITATIVE INDEX COUNT (2026-07-01, "Noindex page in sitemap" fix):
          // the sitemap publishes a genre when the denormalised Genre.stationCount
          // >= MIN_STATIONS_FOR_GENRE_INDEX (sitemap-manifest-builder.buildGenreChunks).
          // The visible top-stations grid below uses a live, CASE-SENSITIVE $regex
          // on `tags` that under-counts variant spellings ("J-Rock"/"jrock"/"J Rock"),
          // so a genre could be IN the sitemap yet get noindex'ed here — Ahrefs then
          // flags "Noindex page in sitemap". Read the SAME Genre.stationCount the
          // sitemap trusts and use it for the index decision so the two surfaces
          // never disagree.
          try {
            const genreDoc = await withSignal<{ stationCount?: number } | null>(
              pgStoredGenreBySlug(canonicalSlug, SSR_GENRE_READER),
              signal,
            );
            if (genreDoc && typeof genreDoc.stationCount === 'number') {
              additionalData.genreStationCount = genreDoc.stationCount;
            }
          } catch (e: any) {
            if (e?.name === 'AbortError' || signal?.aborted) throw e;
            // Non-fatal — but RECORD the failure: if this authoritative count
            // is unavailable AND the live grid under-counts (its case-sensitive
            // regex misses variant spellings), the thin-gate would noindex a
            // sitemap-published genre on a transient DB blip, and that noindex
            // HTML is cacheable for hours. The gate below treats a failed count
            // fetch like a failed grid fetch: don't de-index a whitelisted
            // genre on missing evidence.
            additionalData.genreCountFetchFailed = true;
          }
        }
        // The public genre URL represents a native, deterministic 15-card page.
        try {
          const term = pathParts[2].replace(/-/g, ' ');
          const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const { readSeoGenrePage, readSeoGenreQualityPage } = await import('./data/postgres-seo-directory-store');
          const explicitCountry = countryCode && !SEO_LANGUAGES.some(l => l.enabled && l.code.toLowerCase() === countryCode)
            ? CODE_TO_COUNTRY[countryCode] : undefined;
          const listed = await withSignal(readSeoGenrePage(canonicalSlug || requestedSlug, pagination.page, explicitCountry), signal);
          additionalData.popularStations = listed.stations
            .filter((s: any) => s.slug && s.isListVisible !== false && s.noIndex !== true && !isJunkStation(s));
          additionalData.catalogPage = pagination.page;
          additionalData.catalogTotalPages = Math.max(1, listed.totalPages);
          if (isMissingSeoCatalogPage(pagination.page, listed.totalPages, listed.stations)) additionalData.httpNotFound = true;
          if (typeof additionalData.genreStationCount !== 'number' && !additionalData.genreCountFetchFailed && !additionalData.httpNotFound) {
            try {
              const quality = await withSignal(readSeoGenreQualityPage(canonicalSlug || requestedSlug), signal);
              additionalData.genreQualitySampleCount = quality.stations.filter((s: any) => s.slug && s.isListVisible !== false && s.noIndex !== true && !isJunkStation(s)).length;
            } catch (error: any) {
              if (error?.name === 'AbortError' || signal?.aborted) throw error;
              additionalData.genreCountFetchFailed = true;
            }
          }

          // ---- Genre cross-link fetch (architect P1: B2) -----------------
          // "Top countries broadcasting <genre>" + "Related radio genres".
          // Same intent as the station-page cross-links: server-render
          // crawl edges so AI bots / first-pass crawlers walk between
          // genre and country/genre neighbours without needing the
          // React client. Skipped on noindex'd genre pages (handled
          // later by the genre safeguard block which sets seoTags.noIndex).
          try {
            const { GENRE_WHITELIST_SEED } = await import('./seo/genre-whitelist-seed');
            const { canonicalizeCountry, countrySlug, getRegionSlugForCountry } =
              await import('@workspace/seo-shared/country-regions');
            // INCIDENT 2026-05-14: SSR cross-link Station.find disabled —
            // the unindexable case-insensitive $regex on `tags` was
            // pile-up timing out under load and choking the cluster.
            // Renders an empty cross-link block until a covering
            // tag-prefix index + non-regex match are in place.
            const sample: any[] = [];
            void escapedTerm;
            void signal;
            // Tally counts on the CANONICAL country name so aliases
            // (e.g. "Türkiye" vs "Turkey") collapse onto the same slug.
            // Also resolve the world-region slug now so the rendered
            // links match the actual /regions/<region>/<country> route
            // shape (architect P1 review fix — earlier inline slugify
            // produced /regions/<countrySlug> which 404s).
            const counts = new Map<string, { count: number; canonical: string; region?: string }>();
            for (const s of sample as any[]) {
              const raw = String(s?.country || '').trim();
              if (!raw) continue;
              const canonical = canonicalizeCountry(raw);
              const slug = countrySlug(canonical);
              if (!slug) continue;
              const cur = counts.get(slug);
              if (cur) {
                cur.count += 1;
              } else {
                counts.set(slug, {
                  count: 1,
                  canonical,
                  region: getRegionSlugForCountry(canonical),
                });
              }
            }
            const topCountries = Array.from(counts.entries())
              .sort((a, b) => b[1].count - a[1].count)
              .slice(0, 10)
              .filter(([, v]) => !!v.region)
              .map(([slug, v]) => ({
                slug,
                country: v.canonical,
                region: v.region!,
                count: v.count,
              }));

            const currentGenreSlug = (additionalData.genreSlug || '').toLowerCase();
            const relatedGenres = Array.from(GENRE_WHITELIST_SEED)
              .filter((g) => g && g !== currentGenreSlug)
              .slice(0, 8);

            additionalData.crossLinks = {
              topCountries,
              relatedGenres,
            };
          } catch (e: any) {
            if (e?.name === 'AbortError' || signal?.aborted) throw e;
          }
        } catch (error: any) {
          if (error?.name === 'AbortError' || signal?.aborted) throw error;
          if (additionalData.popularStations === undefined) {
            additionalData.popularStationsFetchFailed = true;
            additionalData.hubReadFailed = true;
          }
        }
        }
      }
    } else if (azLetter) {
      // A-Z letter index (Task #11, 2026-07-03): /stations/<a-z|0-9> lists
      // EVERY indexable station whose slug starts with the letter — unlike
      // the hub below (top-2000 precomputed pool), this walks the whole
      // catalogue so the entire long tail gets a crawlable in-link. The
      // reader requires the matching C-collated slug/id index before reading
      // the ASCII range. Results follow the shared visibility policy,
      // cached at most60s per (letter, page), with concurrent misses coalesced.
      pageType = 'stations';
      additionalData.azLetter = azLetter;
      try {
        const PAGE_SIZE = 60;
        const page = pagination.page;
        const { publicStationCache } = await import('./public-station-cache');
        const azData = await publicStationCache.getOrSetSingleFlight(
          `az-index:${azLetter}:${page}`,
          () => readAzStationPage(azLetter, page, PAGE_SIZE),
          { ttl: 60 },
        );
        const catalog = ((azData?.docs as any[]) || [])
          .filter((s: any) => s && s.slug && s.isListVisible !== false && s.noIndex !== true && !isJunkStation(s));
        additionalData.catalogStations = catalog;
        // Mirror the hub: expose as popularStations too so the existing
        // ItemList + CollectionPage JSON-LD path emits structured data.
        additionalData.popularStations = catalog;
        additionalData.catalogPage = page;
        additionalData.catalogTotalPages = Math.max(Math.ceil(((azData?.total as number) || 0) / PAGE_SIZE), 1);
        if (isMissingSeoCatalogPage(page, additionalData.catalogTotalPages, catalog)) additionalData.httpNotFound = true;
      } catch (error: any) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        additionalData.hubReadFailed = true;
      }
    } else if (cleanPath.startsWith('/stations')) {
      pageType = 'stations';
      // Crawlable catalog hub: turn the previously dead /stations page (which
      // rendered only an <h1>) into a paginated, anchor-linked list of stations
      // sourced ENTIRELY from the precomputed SWR cache — zero live queries, no
      // regex (the 2026-05-14 incident pattern). This fans out thousands of
      // internal in-edges to station detail pages across all 14 langs, the
      // primary lever against the "Crawled – currently not indexed" backlog.
      // See SEO re-audit 2026-06-20, internal-linking Component (a).
      try {
        const PAGE_SIZE = 60;
        const page = pagination.page;
        const { PrecomputedStationsService } = await import('./services/precomputed-stations');
        const result = await PrecomputedStationsService.getGlobalStations(page, PAGE_SIZE);
        // Match the other grids' quality gate. Target locale qualification is
        // resolved in one bounded metadata read after the directory is ready.
        const catalog = (result?.stations || [])
          .filter((s: any) => s && s.slug && s.isListVisible !== false && s.noIndex !== true && !isJunkStation(s));
        additionalData.catalogStations = catalog;
        // Re-audit fix (HIGH): also expose the catalog as `popularStations` so
        // the existing ItemList + CollectionPage JSON-LD path (which keys off
        // popularStations) emits structured data for the hub. The body renders
        // from catalogStations, so this only adds the schema — no double HTML.
        additionalData.popularStations = catalog;
        additionalData.catalogPage = page;
        additionalData.catalogTotalPages = result?.totalPages || 1;
        if (isMissingSeoCatalogPage(page, additionalData.catalogTotalPages, catalog)) additionalData.httpNotFound = true;
      } catch (error: any) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        additionalData.hubReadFailed = true;
      }
    } else if (
      PRIVATE_PAGE_ROOTS.has(cleanPath.split('/')[1]) ||
      cleanPath === '/feedback' || cleanPath.startsWith('/feedback/') ||
      cleanPath === '/llms' || cleanPath.startsWith('/llms/') ||
      cleanPath === '/notifications' || cleanPath.startsWith('/notifications/') ||
      cleanPath === '/profile' || cleanPath.startsWith('/profile/') ||
      // Profile details have no privacy-aware SSR contract.
      cleanPath.startsWith('/users/')
    ) {
      // 2026-05-12 SEO audit: utility/account pages have no unique
      // public SEO content. Without an explicit branch they fell
      // through to pageType='home' and reused meta_title — creating
      // duplicate-meta audit errors per locale. Mark them noindex at
      // the renderer level (not just in robots.txt) so any crawler
      // that hits them sees a clear directive and they never enter
      // the duplicate-meta bucket. The branch is placed BEFORE
      // /users/ so the more general utility match wins for the
      // non-public surfaces.
      pageType = 'utility';
    } else if (cleanPath === '/users') {
      // 2026-05-12 SEO audit: previously /users had no pageType branch
      // and fell through to the home bucket, producing duplicate-title
      // audit errors (every locale's /users page reused meta_title).
      pageType = 'users';
    } else if (cleanPath === '/recommendations' || cleanPath === '/trending') {
      pageType = cleanPath.slice(1);
      try {
        additionalData.popularStations = await withSignal(
          loadPublicDiscoveryStations(pageType as 'trending' | 'recommendations'), signal);
      } catch (error: any) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        additionalData.hubReadFailed = true;
      }
    } else if (cleanPath.startsWith('/recommendations/') || cleanPath.startsWith('/trending/')) {
      pageType = 'utility';
    } else if (cleanPath.startsWith('/regions') || cleanPath.startsWith('/country')) {
      pageType = 'regions';
      if (cleanPath === '/regions') {
        try {
          const { loadRegionDirectoryHub } = await import('./seo/directory-hub-data');
          additionalData.directoryRegions = await withSignal(loadRegionDirectoryHub(), signal);
        } catch (error: any) {
          if (error?.name === 'AbortError' || signal?.aborted) throw error;
          additionalData.hubReadFailed = true;
          logger.warn('Region directory reference data temporarily unavailable');
        }
      }
      // Extract region/country information for more specific SEO
      const pathParts = cleanPath.split('/');

      // Task #127: route-shape detection + validation. The two URL families
      // share the same SSR pageType but have different slug semantics:
      //   /regions/<continent>[/<country>[/<city>]]   pathParts[2] = continent
      //   /country/<country>[/<city>]                 pathParts[2] = country
      // The continent whitelist applies ONLY to /regions/* — applying it to
      // /country/* would false-404 every valid country page (the v1 fix had
      // this regression). Logic extracted to `seo/url-helpers.ts` so the
      // regression suite can unit-test it without booting the renderer.
      const routeShape = validateRegionRouteShape(cleanPath);
      const existence = routeShape.ok && (routeShape.family === 'regions' ? pathParts.length > 3 : pathParts.length > 2)
        ? regionRouteExistence(cleanPath, await import('./seo/slug-existence')) : 'known';
      const canonicalGeography = routeShape.ok && existence === 'known' ? canonicalRegionPath(cleanPath) : null;
      if (canonicalGeography) {
        return { language, cleanPath, seoTags: {}, translations: {}, pageData: {
          redirectTo: buildLocalizedUrl(canonicalGeography, actualLanguage, countryCode, urlTranslations),
        } };
      }

      if (pathParts.length > 2) {
        additionalData.region = pathParts[2];
        // SEO audit fix (2026-05-12): the previous logic always took the
        // LAST path segment as regionName, which broke terminal listing
        // paths like `/regions/asia/turkey/stations` and
        // `/regions/asia/turkey/istanbul/stations` — the resulting H1/title
        // came out as "Stations Radio Stations — Listen Live Online" with
        // "Stations" as the country name. Now we strip the terminal listing
        // segment (`stations`, `cities`) before deriving regionName, so the
        // page correctly resolves to the parent geography (Turkey, Istanbul).
        // Note: `cleanPath` is already URL-translated to English by the
        // upstream pipeline, so checking the literal English segment is
        // sufficient (TR `/tr/bolgeler/asia/turkey/istasyonlar` becomes
        // `/regions/asia/turkey/stations` here).
        const TERMINAL_LISTING_SEGMENTS = new Set(['stations', 'cities']);
        const lastSegment = pathParts[pathParts.length - 1];
        const segmentForName =
          TERMINAL_LISTING_SEGMENTS.has(lastSegment.toLowerCase()) && pathParts.length > 3
            ? pathParts[pathParts.length - 2]
            : lastSegment;
        additionalData.regionName = segmentForName
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        const countryIndex = routeShape.family === 'country' ? 2 : 3;
        const countrySlug = pathParts[countryIndex];
        const citySlug = pathParts[countryIndex + 1];
        if (countrySlug) additionalData.country = countrySlug;
        if (citySlug && !TERMINAL_LISTING_SEGMENTS.has(citySlug)) additionalData.city = citySlug;

        if (!routeShape.ok || existence !== 'known') {
          // Task #127: route-shape failure → real 404. index-web.ts catch-all
          // maps notFound:true to HTTP 404 + 404 page body for bot traffic.
          stationNotFound = existence !== 'unavailable';
          additionalData.notFound = stationNotFound;
          additionalData.httpNotFound = stationNotFound;
          if (existence === 'unavailable') additionalData.hubReadFailed = true;
          additionalData.popularStations = [];
        } else if (routeShape.family === 'regions' && pathParts.length === 3) {
          // A continent lists its countries. Treating it as country="Europe"
          // yielded an empty indexable template and wasted station queries.
          try {
            const { loadContinentDirectory } = await import('./seo/directory-hub-data');
            additionalData.continentDirectory = await withSignal(loadContinentDirectory(pathParts[2]), signal);
          } catch (error: any) {
            if (error?.name === 'AbortError' || signal?.aborted) throw error;
            additionalData.hubReadFailed = true;
          }
        } else if (additionalData.city) {
          const displayCountry = String(additionalData.country).replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          const countryName = canonicalizeCountry(resolveToDbName(displayCountry) || displayCountry);
          const scope = buildRegionStationScope(countryName, additionalData.city);
          if (!scope) {
            additionalData.httpNotFound = true;
            additionalData.popularStations = [];
          } else {
            additionalData.countryName = countryName;
            additionalData.cityName = scope.cityName;
            additionalData.regionName = scope.cityName === 'ALL' ? countryName : scope.cityName;
            try {
              const { readSeoCityPage } = await import('./data/postgres-seo-directory-store');
              const listed = await withSignal(readSeoCityPage(countryName, additionalData.city, pagination.page), signal);
              additionalData.catalogStations = listed.stations.filter((s: any) => s.slug && s.isListVisible !== false && s.noIndex !== true && !isJunkStation(s));
              additionalData.popularStations = additionalData.catalogStations.slice(0, 12);
              additionalData.catalogPage = pagination.page;
              additionalData.catalogTotalPages = Math.max(1, listed.totalPages);
              if (isMissingSeoCatalogPage(pagination.page, listed.totalPages, listed.stations)) additionalData.httpNotFound = true;
              const cc = listed.stations[0]?.countryCode;
              if (typeof cc === 'string' && /^[a-z]{2}$/i.test(cc)) additionalData.countryCode = cc.toLowerCase();
            } catch (error: any) {
              if (error?.name === 'AbortError' || signal?.aborted) throw error;
              additionalData.hubReadFailed = true;
            }
          }
        } else {
          // DALGA 2 W2.2: Fetch top 12 stations from this country for SSR flag + <img> grid
          try {
            const displayName = additionalData.regionName as string;
            const geographyPath = TERMINAL_LISTING_SEGMENTS.has(lastSegment.toLowerCase())
              ? pathParts.slice(0, -1).join('/') : cleanPath;
            // Display slugs and stored country names differ; city names must stay untouched.
            const countryName = isExactCountryPagePath(geographyPath)
              ? resolveToDbName(displayName) || displayName : displayName;
            const topStations = await withSignal<LeanStationCard[]>(
              pgSeoCatalog().find({
                country: countryName,
                isListVisible: true,
                slug: { $exists: true, $ne: '' },
                noIndex: { $ne: true },
                votes: { $gt: 0 },
              }, { fields: SSR_CARD_FIELDS, sort: { votes: -1 }, limit: 24,
                sharedCardsKey: JSON.stringify(['country', countryName]) }),
              signal
            );
            // DALGA 2 W2.REVIEW P2: Junk gate via isJunkStation + noIndex (see W2.1 comment).
            const indexableStations = topStations.filter((s) =>
              s.isListVisible !== false && s.noIndex !== true && !isJunkStation(s)
            );
            additionalData.popularStations = indexableStations.slice(0, 12);
            // Pull lowercase ISO countryCode from first matching station for flagcdn.com
            const cc = topStations[0]?.countryCode;
            if (cc && typeof cc === 'string' && /^[a-z]{2}$/i.test(cc)) {
              additionalData.countryCode = cc.toLowerCase();
            }

            // ---- Full crawlable country catalogue (2026-07-01) ----------
            // The 12-station "popular" grid above only links a country's TOP
            // stations, leaving the long tail with zero internal in-links
            // ("no referring page" → Crawled-not-indexed). Paginate the
            // Per-country directory at 60/page, independently SWR-cached.
            // Native count + bounded projection include the long tail beyond
            // the popular pool's 3,000 cap, without reading archived articles.
            try {
              const CATALOG_PAGE_SIZE = 60;
              const page = pagination.page;
              const { PrecomputedStationsService } = await import('./services/precomputed-stations');
              const countryCatalog = await PrecomputedStationsService.getCountryStationsByName(
                countryName, page, CATALOG_PAGE_SIZE,
              );
              additionalData.catalogStations = (countryCatalog?.stations || [])
                .filter((s: any) => s && s.slug && s.isListVisible !== false && s.noIndex !== true && !isJunkStation(s));
              additionalData.catalogPage = page;
              additionalData.catalogTotalPages = countryCatalog?.totalPages || 1;
              if (isMissingSeoCatalogPage(page, additionalData.catalogTotalPages, additionalData.catalogStations)) additionalData.httpNotFound = true;
            } catch (err: any) {
              if (err?.name === 'AbortError' || signal?.aborted) throw err;
              additionalData.hubReadFailed = true;
            }

            // ---- Region cross-link fetch (architect P1: B3) --------------
            // "Popular genres in <country>" + "Neighbouring countries
            // (same continent)". Server-rendered so crawlers walk between
            // sibling country pages and from country → genre filter
            // pages without needing the React client to hydrate.
            try {
              const { GENRE_WHITELIST_SEED } = await import('./seo/genre-whitelist-seed');
              const { COUNTRY_TO_REGION_SLUG, canonicalizeCountry, countrySlug } =
                await import('@workspace/seo-shared/country-regions');

              // Architect P1 review fix: do not derive "popular genres
              // in country" from the 12-station popularStations slice —
              // it's too small and biased. Pull a wider tag-only sample
              // (200 highest-vote indexable stations from the same
              // country) so the genre tally is representative. This is
              // a tags+country only projection, capped at maxTimeMS
              // 3500, no impact on the popularStations grid above.
              const countryName = additionalData.regionName as string;
              const genreSample: Array<{ tags?: any }> = countryName
                ? (indexableStations as any[])
                : [];
              const tagCounts = new Map<string, number>();
              for (const s of genreSample as any[]) {
                const raw = Array.isArray(s?.tags)
                  ? s.tags
                  : (typeof s?.tags === 'string' ? String(s.tags).split(',') : []);
                for (const t of raw) {
                  const slug = String(t || '')
                    .trim()
                    .toLowerCase()
                    .replace(/\s+/g, '-');
                  if (!slug || !GENRE_WHITELIST_SEED.has(slug)) continue;
                  tagCounts.set(slug, (tagCounts.get(slug) || 0) + 1);
                }
              }
              const topGenres = Array.from(tagCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([slug, count]) => ({ slug, count }));

              // Neighbour countries: same world-region slug, exclude self.
              const selfCountryName = additionalData.regionName as string;
              const selfRegion = selfCountryName
                ? COUNTRY_TO_REGION_SLUG[canonicalizeCountry(selfCountryName)]
                : undefined;
              const selfSlug = selfCountryName ? countrySlug(selfCountryName) : '';
              const neighbours = selfRegion
                ? Object.entries(COUNTRY_TO_REGION_SLUG)
                    .filter(([name, region]) =>
                      region === selfRegion && countrySlug(name) !== selfSlug,
                    )
                    .map(([name]) => ({
                      name,
                      slug: countrySlug(name),
                      region: selfRegion,
                    }))
                    .slice(0, 12)
                : [];

              additionalData.crossLinks = {
                topGenres,
                neighbours,
                regionSlug: selfRegion || '',
              };
            } catch (e: any) {
              if (e?.name === 'AbortError' || signal?.aborted) throw e;
            }

            // SOFT-404 PROMOTION DISABLED (2026-05-12):
            // Previously this block ran a second Station.find with a
            // case-insensitive regex on `country: /^${regionName}$/i` and,
            // if zero indexable stations matched, did a Country.findOne with
            // the same regex; if BOTH came back empty we promoted the page
            // to HTTP 404. In practice this false-404'd every country page
            // whose DB row used a localized/diacritic name (e.g. slug
            // `turkey` vs DB `country: "Türkiye"`) — the regex `/^Turkey$/i`
            // never matches `Türkiye`, so popular countries were getting
            // de-indexed by Google despite having thousands of indexable
            // stations. Now that SSR is served to ALL visitors (not just
            // bots), this regression became immediately visible.
            //
            // The route-shape validator above (`validateRegionRouteShape`)
            // already enforces continent whitelist + safe slug shape, so
            // garbage URLs like `/regions/foo/bar` still 404. Real country
            // pages with sparse content render as 200 thin pages — Google
            // handles those gracefully via the canonical/hreflang signals
            // and the SSR popular-stations grid above. If we ever need to
            // re-introduce empty-country detection, do it via a slug→ISO
            // country-code mapping (not a name regex) so it's robust to
            // diacritics and language-specific spellings.
          } catch (error: any) {
            if (error?.name === 'AbortError' || signal?.aborted) throw error;
            additionalData.hubReadFailed = true;
          }
        }
      }
    } else if (cleanPath === '/tv') {
      pageType = 'tv';
    } else if (cleanPath.startsWith('/about')) {
      pageType = 'about';
    } else if (cleanPath.startsWith('/contact')) {
      pageType = 'contact';
    } else if (cleanPath.startsWith('/applications')) {
      pageType = 'applications';
    } else if (cleanPath.startsWith('/terms-and-conditions') || cleanPath.startsWith('/pages/terms-and-conditions')) {
      pageType = 'terms';
    } else if (cleanPath.startsWith('/privacy-policy') || cleanPath.startsWith('/pages/privacy-policy')) {
      pageType = 'privacy';
    } else if (cleanPath.startsWith('/search')) {
      pageType = 'search';
    } else if (cleanPath.startsWith('/faq')) {
      pageType = 'faq';
    } else if (cleanPath === '/' || cleanPath === '') {
      pageType = 'home';
      // Independent reads: taxonomy must not wait behind the station query.
      await Promise.all([(async () => {
      try {
        const popularStations = await withSignal<LeanStationCard[]>(
          pgSeoCatalog().find({
            votes: { $gt: 0 },
            isListVisible: true,
            slug: { $exists: true, $ne: '' },
            noIndex: { $ne: true },
          }, { fields: SSR_CARD_FIELDS, sort: { votes: -1 }, limit: 24,
            sharedCardsKey: JSON.stringify(['home']) }),
          signal
        );
        // Apply the junk-station gate (same as genre/region SSR surfaces) so the
        // homepage never internally links to stations that resolve to 410 Gone.
        additionalData.popularStations = popularStations
          .filter((s) => s.isListVisible !== false && s.noIndex !== true && !isJunkStation(s))
          .slice(0, 10);
      } catch (error: any) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        additionalData.hubReadFailed = true;
      }
      })(), (async () => {
      // Optional names/links refresh independently of first paint. The API and
      // all actual station lists retain their strict health-aware 60s caches.
      additionalData.topGenres = getHomeGenreNavigation();
      })()]);
    }
    
    // Generate enhanced SEO tags with additional context
    // Pass localized path to use translated paths in canonical URL
    // Also pass urlTranslations map for hreflang tags with translated paths
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const stationLinkQualification: { languages?: readonly string[] } = {};
    let seoTags = await this.generateEnhancedSeoTags(pageType, language, translations, cleanPath, domain, stationData, additionalData, cleanUrl, localizedPath, urlTranslations,
      pageType === 'stations' ? stationLinkQualification : undefined);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const initialRobots = seoTags.robots;

    // ---- ContentQuality safeguard (task #17 + architect P0) ---------------
    // 1) If the resolved station is junk (test feed, codec suffix, song name,
    //    -1/-2 collision) emit robots=noindex so Bing/Google stop reporting
    //    these as low-quality alternates. The request handler will upgrade
    //    this to a 410 Gone via the `stationIsJunk` flag surfaced on pageData.
    // 2) If the requested UI language is not in the station's "appropriate
    //    language set" (country/diaspora/broadcast lang + English), emit
    //    noindex on that language variant. The canonical/eligible languages
    //    remain indexable.
    // 3) Restrict hreflang alternates to the station's indexable-language set
    //    (eligible + English). Previously we advertised all ~57 enabled
    //    languages, which caused Google to crawl 57 variants per station and
    //    dump ~55 of them into "Crawled - currently not indexed".
    let stationIsJunkFlag = false;
    let langRedirectUrl: string | null = null;
    // The HTTP layer uses this retryable-data flag for any failed required
    // SEO read, including reference directories. Never cache an empty 200
    // HTML directory after a temporary outage.
    let stationDbErrorFlag = !!(stationData as any)?._dbError || additionalData.hubReadFailed === true
      || additionalData.stationQualificationFailed === true;
    if (pageType === 'station' && stationData && !stationNotFound && !stationDbErrorFlag) {
      try {
        const {
          isJunkStation,
          getIndexableLanguagesForStation,
          isStationIndexableInLanguage,
          isNumericOnlySlug,
          canRenderLegacyStationInformation,
        } = await import('./seo/junk-station-rules');
        const { getCachedQualifiedLanguages } = await import('./seo/qualified-languages');

        // Unified indexability gate — sitemap, SSR robots, hreflang, and the
        // 410 handler all derive their answer from these two calls. Never
        // branch on `isLanguageEligibleForStation` or `getEligibleLanguages`
        // here — that bypasses the translation-qualification check and can
        // re-introduce "Crawled - currently not indexed" regressions.
        const qualifiedLangs = await getCachedQualifiedLanguages();
        const legacyInformation = canRenderLegacyStationInformation(stationData);
        const isJunk = isJunkStation(stationData) || (stationData.noIndex === true && !legacyInformation);
        const indexable = getIndexableLanguagesForStation(stationData, qualifiedLangs);
        const langIneligible =
          !isJunk && !legacyInformation && !isStationIndexableInLanguage(stationData, language, qualifiedLangs);
        // Negative integer slugs (e.g. `-598`, `-2612`) are DB artifact IDs —
        // never valid station callsigns. Treat as junk → 410. Positive integer
        // slugs (e.g. `1234`) stay noindex-only in case they're callsign brands.
        const negativeNumericSlug = !isJunk && /^-\d+$/.test((stationData.slug || '').trim());
        // Numeric-only slugs (e.g. `1234`) → noindex but not 410, so
        // legitimate numeric-callsign brands are not lost.
        const numericOnlySlug = !isJunk && !negativeNumericSlug && isNumericOnlySlug(stationData.slug);

        if (legacyInformation) {
          // Preserve the unknown historical noindex, not a gone response or
          // an invented reindexing approval. Real localized content remains.
          seoTags.robots = 'noindex, follow';
          seoTags.noIndex = true;
        } else if (isJunk || numericOnlySlug || negativeNumericSlug) {
          // Junk / numeric-only: serve noindex (junk and negativeNumericSlug
          // are upgraded to 410 Gone by the HTTP layer via stationIsJunkFlag).
          seoTags.robots = 'noindex, follow';
          seoTags.noIndex = true;

          // Point canonical at the indexable main-language variant so search
          // engines consolidate any residual signals on the version we want
          // indexed. Use the SAME `indexable` array the hreflang loop below
          // uses — NOT a raw `getEligibleLanguages` call — so canonical and
          // hreflang never diverge (architect gate invariant). When the
          // station is junk (indexable === []), fall through to English; the
          // page is served as 410 Gone anyway, so canonical is mostly for
          // consistency with already-indexed copies.
          const canonicalLang = indexable.includes('en')
            ? 'en'
            : indexable[0] || 'en';
          if (canonicalLang && stationData.slug) {
            // Always resolve to a real route segment — never use the raw
            // language code as the segment (which would yield /xx/xx/slug).
            // Look up the translated `station` segment for the canonical
            // language; fall back to English `station` which is a guaranteed
            // valid route prefix served by the middleware.
            const translatedSegment =
              urlTranslations?.get(`${canonicalLang}:station`) || 'station';
            seoTags.canonical = `${domain}/${canonicalLang}/${translatedSegment}/${stationData.slug}`;
          }
        } else if (langIneligible && stationData.slug) {
          // Language-ineligible variant: 301 redirect to /en instead of
          // serving 200+noindex. Eliminates crawl-budget waste from Google
          // repeatedly visiting millions of language variants that can never
          // be indexed (57 langs × 43K stations = potential millions of
          // "Crawled - currently not indexed" entries in GSC).
          const enSegment = urlTranslations?.get('en:station') || 'station';
          langRedirectUrl = `${domain}/en/${enSegment}/${stationData.slug}`;
        }

        if (legacyInformation) {
          seoTags.hreflangs = [];
        } else if (isJunk || negativeNumericSlug) {
          // Signal to the HTTP layer to return 410 Gone instead of SSR'ing
          // the page. Also suppress ALL hreflang alternates — a noindex/
          // gone page must not expose alternates (Google policy).
          stationIsJunkFlag = true;
          seoTags.hreflangs = [];
        } else if (numericOnlySlug) {
          // Keep legitimate numeric callsigns playable (200 + noindex), but
          // do not advertise language alternates for these excluded URLs.
          // This is not a junk decision and must not become a 410 or 301.
          seoTags.hreflangs = [];
        } else if (!langIneligible) {
          // Hreflang alternates come from the SAME unified gate that the
          // sitemap uses — so the two surfaces advertise the exact same
          // (station × language) set. Passing `qualifiedLangs` here ensures
          // thin/partially-translated languages are excluded from both.
          // Skip hreflangs for lang-ineligible URLs — they redirect away.
          seoTags.hreflangs = generateLanguageUrls(
            cleanPath,
            domain,
            language,
            urlTranslations,
            seoTags.canonical,
            indexable,
          );
        }

        // ID consolidation belongs after the shared quality/qualification gate,
        // never in the lookup fallback. Verify the slug's exact owner as well:
        // the destination must serve this same persisted station, not an alias.
        if (stationIdFallback) {
          langRedirectUrl = null;
          const slug = stationData.slug;
          const redirectLanguage = indexable.includes(actualLanguage) ? actualLanguage : 'en';
          const safeSlug = typeof slug === 'string' && slug.length > 0 && slug === slug.trim()
            && !/[\\/?#%\s\u0000-\u001f\u007f-\u009f]/u.test(slug)
            && slug !== '.' && slug !== '..' && !matchAzIndexPath(`/station/${slug}`);
          if (!legacyInformation && !isJunk && !numericOnlySlug && !negativeNumericSlug
              && safeSlug && slug !== stationIdFallback
              && String(stationData._id).toLowerCase() === stationIdFallback.toLowerCase()
              && indexable.includes(redirectLanguage)) {
            const target = await withSignal(pgSeoCatalog().findOne({ slug }), signal);
            if (target?.slug === slug && String(target._id) === String(stationData._id)
                && !target.redirectToSlug
                && getIndexableLanguagesForStation(target, qualifiedLangs).includes(redirectLanguage)) {
              langRedirectUrl = buildLocalizedUrl(`/station/${slug}`, redirectLanguage,
                redirectLanguage === actualLanguage ? countryCode : undefined, urlTranslations);
            }
          }
        }
      } catch (e: any) {
        // Qualification can fail on a transient database/cache outage too.
        // Fail closed with an uncached 503, not a lasting noindex decision.
        if (e?.name === 'AbortError' || signal?.aborted) throw e;
        stationDbErrorFlag = true;
        langRedirectUrl = null;
        seoTags.hreflangs = [];
        try {
          const { logger } = await import('./utils/logger');
          logger.warn(
            `⚠️ seo-renderer: station indexability gate failed — temporarily unavailable: ${e?.message || e}`,
          );
        } catch {}
      }
    }

    // ---- Genre quality safeguard (task #104) ------------------------------
    // Companion to the sitemap whitelist filter in
    // sitemap-manifest-builder.ts/buildGenreChunks. Even though those URLs are
    // dropped from the sitemap, Googlebot may still rediscover them via old
    // backlinks or its own URL store, so the SSR layer must independently
    // emit `noindex` for:
    //   1. genre slugs not on the curated whitelist (raw tag noise — FM
    //      frequencies, city names, station/brand names, random tokens), and
    //   2. whitelisted genres that ended up with fewer than
    //      MIN_STATIONS_FOR_GENRE_INDEX indexable popular stations after
    //      filtering — a thin grid is the same soft-404 signal that put the
    //      whole template on Google's low-quality list.
    if (pageType === 'genres' && additionalData?.genreSlug) {
      const popularStations = (additionalData?.popularStations as any[] | undefined) || [];
      const fetchFailed = additionalData.popularStationsFetchFailed === true;
      // Prefer the manifest's stored count. A missing row uses the same global
      // bounded quality sample on every page, never the short current slice.
      // A failed count read is not evidence for excluding a healthy category.
      const authoritativeCount = additionalData.genreStationCount;
      const countFetchFailed = additionalData.genreCountFetchFailed === true;
      const tooThin = typeof authoritativeCount === 'number'
        ? authoritativeCount < MIN_STATIONS_FOR_GENRE_INDEX
        : (!fetchFailed && !countFetchFailed && typeof additionalData.genreQualitySampleCount === 'number'
          && additionalData.genreQualitySampleCount < MIN_STATIONS_FOR_GENRE_INDEX);
      if (additionalData.genreNotWhitelisted || tooThin) {
        seoTags.robots = 'noindex, follow';
        seoTags.noIndex = true;
        // Suppress hreflang alternates on noindex'd genre URLs so we don't
        // advertise 44 low-quality variants of the same thin page.
        seoTags.hreflangs = [];
      }
      // Task #127: Promote a NOT-whitelisted genre with ZERO indexable
      // stations from `noindex 200` to a real `404 Not Found`. Google had
      // been classifying these as soft-404s; a hard 404 drops them from
      // the index immediately. We keep the softer noindex-200 path for
      // whitelisted-but-thin genres because real users typing the URL
      // still see a useful (though sparse) genre grid.
      if (additionalData.genreNotWhitelisted && popularStations.length === 0 && !fetchFailed) {
        stationNotFound = true;
        additionalData.notFound = true;
      }
    }
    if (
      pageType === 'station' &&
      stationData &&
      !stationNotFound &&
      seoTags?.noIndex !== true
    ) {
      try {
        const selfId = stationData._id;
        const country = getStationCountryQuery(stationData);
        const primaryTag = (() => {
          const raw = Array.isArray(stationData.tags)
            ? stationData.tags
            : (typeof stationData.tags === 'string'
                ? String(stationData.tags).split(',')
                : []);
          for (const t of raw) {
            const trimmed = String(t || '').trim();
            if (trimmed) return trimmed;
          }
          return '';
        })();
        const stateName: string = (stationData.state || '').toString().trim();

        const sameCountryQ: Promise<any[]> = country
          ? withSignal<any[]>(
              relatedStationCards('country', country, selfId, 8),
              signal,
            ).catch(() => [])
          : Promise.resolve([]);
        const sameGenreQ: Promise<any[]> = Promise.resolve([]);
        const sameCityQ: Promise<any[]> = stateName
          ? withSignal<any[]>(
              relatedStationCards('state', stateName, selfId, 6),
              signal,
            ).catch(() => [])
          : Promise.resolve([]);
        const GENERIC_BRAND_TOKENS = new Set([
          'radio', 'radyo', 'rádio', 'rádió', 'радио', 'estación', 'estacion',
          'the', 'la', 'el', 'los', 'las', 'le', 'les', 'die', 'der', 'das',
          'mega', 'super', 'top', 'hit', 'hits', 'best', 'new', 'big', 'my',
          'web', 'online', 'free', 'live', 'station', 'music', 'musica', 'musik',
        ]);
        const brandToken: string = (() => {
          const first = String(stationData.name || '').trim().split(/\s+/)[0] || '';
          // Strip punctuation for the generic-token / length checks but keep
          // the ORIGINAL casing for the anchored prefix (case-sensitive =
          // index-friendly).
          const cleaned = first.replace(/[^\p{L}\p{N}]+/gu, '');
          if (cleaned.length < 4) return '';
          if (GENERIC_BRAND_TOKENS.has(cleaned.toLowerCase())) return '';
          return first;
        })();
        const samePublisherQ: Promise<any[]> = brandToken
          ? withSignal<any[]>(
              relatedStationCards('publisher', brandToken, selfId, 7),
              signal,
            ).catch(() => [])
          : Promise.resolve([]);

        const [sameCountry, sameGenre, sameCity, samePublisher] = await Promise.all([
          sameCountryQ.catch(() => []),
          sameGenreQ.catch(() => []),
          sameCityQ.catch(() => []),
          samePublisherQ.catch(() => []),
        ]);

        // Deduplicate across the lists so the same station never shows up
        // twice. Name-prefix matches take precedence, then
        // city, then genre, then country (broadest). Final caps: 6/6/8/8.
        const seen = new Set<string>();
        const dedupe = (arr: any[], cap: number) => {
          const out: any[] = [];
          for (const s of arr) {
            if (s?.isListVisible === false) continue;
            const key = String(s?._id || s?.slug || '');
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(s);
            if (out.length >= cap) break;
          }
          return out;
        };

        additionalData.crossLinks = {
          samePublisher: dedupe(samePublisher as any[], 6),
          sameCity: dedupe(sameCity as any[], 6),
          sameGenre: dedupe(sameGenre as any[], 8),
          sameCountry: dedupe(sameCountry as any[], 8),
          countryName: country || '',
          genreName: primaryTag,
          cityName: stateName,
          publisherBrand: brandToken,
        };
      } catch (e: any) {
        if (e?.name === 'AbortError' || signal?.aborted) throw e;
        // Non-fatal — render the page without cross-link sections rather
        // than failing on a transient database error. The base nav still renders.
      }
    }

    // Map internal pageTypes to database format
    const dbPageTypeMap: Record<string, string> = {
      'home': 'homepage',
      'station': 'station_detail',
      'genres': 'genre_detail',
      'regions': 'country_detail',
      'about': 'static',
      'contact': 'static',
      'terms': 'static',
      'privacy': 'static',
      'applications': 'static',
      'tv': 'static',
      'search': 'static',
      'faq': 'static'
    };
    
    const dbPageType = dbPageTypeMap[pageType] || pageType;
    
    // Extract routeKey for the page (matches admin UI storage format)
    // Admin stores full cleanPath minus language prefix (e.g., "genres/rock", "station/bbc-radio-1")
    let routeKey = '';
    if (pageType === 'station' && stationData?.slug) {
      // Station pages use slug directly for cleaner lookups
      routeKey = stationData.slug;
    } else if (pageType === 'genres') {
      // Genre pages: use cleanPath starting from /genres (e.g., "genres/rock")
      routeKey = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
    } else if (pageType === 'regions') {
      // Region pages: use cleanPath starting from /regions (e.g., "regions/europe/germany")
      routeKey = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
    } else if (pageType === 'home') {
      // Homepage: empty routeKey
      routeKey = '';
    } else if (['about', 'contact', 'terms', 'privacy', 'applications'].includes(pageType)) {
      // Static pages: use pageType as routeKey
      routeKey = pageType;
    }
    
    const customMetadata = await this.getCustomSeoMetadata(dbPageType, routeKey, language, signal);
    if (customMetadata) {
      logger.log(`🎯 Using custom SEO metadata for ${dbPageType}/${routeKey}/${language}`);
      seoTags = this.applyCustomSeoMetadata(seoTags, customMetadata);
    }
    if (additionalData.httpNotFound) {
      stationNotFound = true;
      seoTags = { ...seoTags, noIndex: true, robots: 'noindex, follow', hreflangs: [] };
    }
    // Resolve after all quality guards and admin overrides, before caching or
    // returning the same metadata to SSR and SPA navigation.
    seoTags = this.finalizeSeoDirectives(seoTags, initialRobots);
    if (stationIdFallback && seoTags.noIndex) langRedirectUrl = null;

    // Hydration must receive the same descriptions the HTML head emits.
    // Keep admin metadata precedence and all stored/full body text intact;
    // only apply the existing presentation limit to the returned head fields.
    seoTags = this.normalizeDescriptionTags(seoTags);

    // For the /stations hub AND the /regions|/country country hubs, each
    // paginated variant serves a different slice of stations (60/page) — the
    // canonical must include ?page=N so Google treats page 2 as its own URL,
    // not a duplicate of page 1. Without this patch the base generateSeoTags()
    // strips the query string from every canonical, collapsing all hub pages
    // into a single page-1 entry. We also append ?page=N to every hreflang
    // alternate so the per-language pagination cluster is consistent.
    const catalogPage = (additionalData?.catalogPage as number) || 1;
    if ((pageType === 'stations' || pageType === 'regions' || pageType === 'genres') && catalogPage > 1 && seoTags.canonical) {
      const pageUrl = (value: string) => {
        const parsed = new URL(value, domain || 'https://themegaradio.com');
        parsed.searchParams.set('page', String(catalogPage));
        parsed.hash = '';
        return parsed.href;
      };
      seoTags.canonical = pageUrl(seoTags.canonical);
      if (Array.isArray(seoTags.hreflangs)) {
        seoTags.hreflangs = seoTags.hreflangs.map((h: { hreflang: string; url: string }) => ({
          ...h,
          url: pageUrl(h.url),
        }));
      }
    }

    // Only directory links propagate the same href into the React DTO. Other
    // grids retain their existing locale until they have an equivalent contract.
    const stationLinkTargets = pageType === 'stations' && isStationDirectoryPath(cleanPath)
      ? collectStationLinkTargets(additionalData) : [];
    const qualifiedStationLinkLanguages = stationLinkQualification.languages;
    if (language !== 'en' && qualifiedStationLinkLanguages?.length && stationLinkTargets.length
      && !stationDbErrorFlag && !additionalData.httpNotFound && !langRedirectUrl) {
      try {
        // Reuse the successful initial qualification, never a second lookup or
        // the minimal hreflang fallback from a failed qualification read.
        const metadata = await readSeoStationLinkMetadata(stationLinkTargets.map(target => String(target._id)));
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        additionalData.stationLinkLanguages = resolveStationLinkLanguages(stationLinkTargets, metadata, language, qualifiedStationLinkLanguages);
      } catch (error: any) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        // Optional enrichment: unknown eligibility preserves the requested
        // locale instead of inventing an English fallback or an empty page.
      }
    }

    // Compile the static page data
    const pageData = {
      language,
      cleanPath,
      seoTags,
      translations,
      urlTranslations,
      pageData: {
        pageType,
        station: stationData,
        seoTags,
        ...additionalData,
        additionalData,
        notFound: stationNotFound || false,
        // Architect P0: surfaces junk-station detection to the HTTP layer so
        // it can upgrade the response from 200/noindex to 410 Gone. 410 is
        // how we tell Google "this URL is really gone, drop it from the
        // index fast" — 301 + noindex leaves URLs in the crawl queue for
        // months.
        stationIsJunk: stationIsJunkFlag,
        // Language-ineligible station variant: HTTP layer issues 301 → /en.
        // Avoids burning crawl budget on millions of noindex variants.
        ...(!stationDbErrorFlag && langRedirectUrl ? { redirectTo: langRedirectUrl } : {}),
        // Transient DB error: placeholder data, must not be indexed.
        ...(stationDbErrorFlag ? { stationDbError: true } : {}),
      }
    };
    
    // A failed lookup must be retried on the very next request. Caching its
    // synthetic data kept healthy station URLs unavailable after PG recovered.
    if (!stationDbErrorFlag && !additionalData.hubReadFailed && !additionalData.httpNotFound) performanceCache.setPageData(cacheKey, pageData);
    
    return pageData;
    }, url);
  }

  async generateEnhancedSeoTags(
    pageType: string, 
    language: string, 
    translations: Record<string, string>, 
    cleanPath: string, 
    domain: string, 
    stationData?: any, 
    additionalData?: any,
    originalPath?: string,  // Original URL path to preserve country codes
    translatedPath?: string,  // Translated path from database for canonical URL
    urlTranslations?: Map<string, string>,  // URL translations map for all languages
    qualifiedLanguagesResult?: { languages?: readonly string[] },
  ): Promise<any> {
    // Use the existing generateSeoTags function as base
    // Pass translated path to use localized paths in canonical URL (e.g., /sq/zhanret instead of /sq/genres)
    // Also pass urlTranslations map for generating hreflang tags with translated paths
    const baseSeoTags = generateSeoTags(pageType, language, translations, cleanPath, domain, stationData, originalPath, translatedPath, urlTranslations);
    
    // Helper to get translations from database — with English fallbacks for critical SEO keys
    // These keys are often empty in non-English DB → without fallbacks titles become "Pop  -  | Mega Radio"
    const SEO_KEY_FALLBACKS: Record<string, string> = {
      seo_radio_stations: 'Radio Stations',
      seo_listen_live_online: 'Listen Live Online',
      seo_listen_to_live_radio_from: 'Listen to live radio from',
      seo_discover_local: 'Discover local',
      seo_music_and_shows: 'music and shows',
      seo_radio_broadcasting_free: 'radio broadcasting for free',
      seo_regional_broadcasting: 'Regional Broadcasting',
      seo_explore_radio_stations_from: 'Explore radio stations from',
      seo_listen_to_regional_broadcasting: 'Listen to regional broadcasting',
      about_mega_radio: 'About Mega Radio - Free Online Radio Platform',
      about_mega_radio_description: 'Learn about Mega Radio, the free online radio platform with 60,000+ stations from 120+ countries. Stream music, news, sports, and talk radio worldwide.',
      contact_page_title: 'Contact Mega Radio - Get in Touch',
      contact_page_description: 'Contact the Mega Radio team for support, feedback, or partnership inquiries. We are here to help you with your free radio streaming experience worldwide.',
      search_page_title: 'Search Radio Stations — Find Live Radio by Name, Genre or Country | Mega Radio',
      search_page_description: 'Search 60,000+ live radio stations from 120+ countries on Mega Radio. Find your favourite station by name, genre, language, or country and listen free online.',
      search_page_h1: 'Search Live Radio Stations',
      faq_page_title: 'Radio Streaming FAQ — Common Questions about Online Radio | Mega Radio',
      faq_page_description: 'Frequently asked questions about Mega Radio: how to listen to online radio, supported devices, free streaming, mobile apps, station coverage, and account help.',
      faq_page_h1: 'Mega Radio Frequently Asked Questions',
    };
    const getTranslation = (key: string): string => {
      const val = translations[key]?.trim();
      return val ? val : (SEO_KEY_FALLBACKS[key] || '');
    };

    // Enhance with more specific content based on page type and additional data
    // Same logic as before, but using database translations
    if (pageType === 'regions' && additionalData) {
      // Use multilingual SEO templates (shared/region-seo-templates.ts).
      // Without this, every non-English language served the SAME English title
      // ("Germany Radio Stations - Regional Broadcasting | Mega Radio") and
      // description across ~120 countries × 44 languages. Google was collapsing
      // the duplicates into one EN canonical and dropping the rest.
      if (additionalData.country) {
        const countryName = additionalData.country.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        const place = additionalData.cityName && additionalData.cityName !== 'ALL'
          ? `${additionalData.cityName}, ${getLocalizedCountryName(additionalData.countryName || countryName, language)}` : countryName;
        const seo = buildCountrySeo(place, language, translations);
        baseSeoTags.title = seo.title;
        baseSeoTags.description = seo.description;
        baseSeoTags.keywords = seo.keywords;
        baseSeoTags.ogTitle = seo.title;
        baseSeoTags.ogDescription = seo.description;
        baseSeoTags.twitterTitle = seo.title;
        baseSeoTags.twitterDescription = seo.description;
      } else if (additionalData.region) {
        const regionName = additionalData.region.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        const seo = buildRegionSeo(regionName, language, translations);
        baseSeoTags.title = seo.title;
        baseSeoTags.description = seo.description;
        baseSeoTags.keywords = seo.keywords;
        baseSeoTags.ogTitle = seo.title;
        baseSeoTags.ogDescription = seo.description;
        baseSeoTags.twitterTitle = seo.title;
        baseSeoTags.twitterDescription = seo.description;
      }
    }
    
    if (pageType === 'genres' && additionalData?.genreName) {
      // Use multilingual SEO templates (server/seo/genre-seo-templates.ts).
      // DB translation keys win when ALL legacy keys are present in the requested
      // language; otherwise we fall back to the natural per-language template.
      // Without this, every non-English language showed English title fragments
      // ("Pop Radio Stations") and a fully-English description.
      const genreSeo = buildGenreSeo(additionalData.genreName, language, translations);
      baseSeoTags.title = genreSeo.title;
      baseSeoTags.description = genreSeo.description;
      baseSeoTags.keywords = genreSeo.keywords;
      // Mirror the localized genre title/description onto the social cards;
      // otherwise twitter:/og: fell back to generic English defaults while the
      // primary tags were localized. See SEO re-audit 2026-06-20, Finding E.
      baseSeoTags.ogTitle = genreSeo.title;
      baseSeoTags.ogDescription = genreSeo.description;
      baseSeoTags.twitterTitle = genreSeo.title;
      baseSeoTags.twitterDescription = genreSeo.description;
    }
    
    if (pageType === 'home') {
      // Item 2 (re-audit 2026-06-20): per-language home title/description.
      // Previously the home <title>/<meta> came only from DB keys and fell
      // back to ENGLISH for any language whose Translation rows were missing —
      // duplicate English meta across all 14 locales on the most important
      // page. buildHomeSeo applies dbTitle || per-lang template BEFORE the
      // English FINAL_TITLE_FALLBACK at the foot of generateHtmlHead.
      const homeSeo = buildHomeSeo(language, translations);
      baseSeoTags.title = homeSeo.title;
      baseSeoTags.description = homeSeo.description;
      baseSeoTags.ogTitle = homeSeo.title;
      baseSeoTags.ogDescription = homeSeo.description;
      baseSeoTags.twitterTitle = homeSeo.title;
      baseSeoTags.twitterDescription = homeSeo.description;
    }

    if (pageType === 'utility') {
      // 2026-05-12 SEO audit: see corresponding branch in determinePageType.
      // Utility surfaces (feedback / llms / notifications / profile) get a
      // distinct title per URL so they never clash with home, AND get a
      // hard noindex directive so they're explicitly excluded from search.
      const utilityLabel = cleanPath.split('/').filter(Boolean)[0] || 'page';
      const titleLabel = utilityLabel.charAt(0).toUpperCase() + utilityLabel.slice(1);
      baseSeoTags.title = `${titleLabel} | Mega Radio`;
      baseSeoTags.description = `Mega Radio ${utilityLabel} page.`;
      baseSeoTags.robots = 'noindex, follow';
      (baseSeoTags as any).noIndex = true;
      baseSeoTags.ogType = 'website';
    }

    if (pageType === 'users' || pageType === 'recommendations' || pageType === 'stations') {
      // 2026-05-12 SEO audit fix: every locale must ship a distinct,
      // localized title + description for these three surfaces.
      // Without this override, /tr/kullanicilar and /tr/tavsiyeler
      // reused the home meta_title (duplicate-title audit error) and
      // /tr/istasyon reused the home meta_description (duplicate-meta
      // audit error). Mirrors the buildStaticPageSeo / buildLegalSeo
      // override pattern. DB keys take precedence when present in the
      // requested language so admins can still override per-locale.
      const communitySeo = buildCommunityPageSeo(pageType, language, translations);
      baseSeoTags.title = communitySeo.title;
      baseSeoTags.description = communitySeo.description;
      if (communitySeo.keywords) baseSeoTags.keywords = communitySeo.keywords;
      baseSeoTags.ogType = 'website';

      // A-Z letter pages (Task #11): every letter needs a UNIQUE title and
      // description or all 27 pages become a duplicate-title cluster. Insert
      // the letter label before the "| Mega Radio" brand suffix when present.
      if (pageType === 'stations' && additionalData?.azLetter) {
        const disp = azDisplayLabel(String(additionalData.azLetter));
        const t = String(baseSeoTags.title || '');
        const brandIdx = t.lastIndexOf(' | ');
        baseSeoTags.title = brandIdx > 0
          ? `${t.slice(0, brandIdx)} — ${disp}${t.slice(brandIdx)}`
          : `${t} — ${disp}`;
        baseSeoTags.description = `${String(baseSeoTags.description || '').replace(/\.?\s*$/, '')} — ${disp}.`;
      }
    }

    if (pageType === 'trending') {
      const copy = trendingPageSeo(language, translations);
      baseSeoTags.title = copy.title;
      baseSeoTags.description = copy.description;
      baseSeoTags.ogType = 'website';
    }
    if (pageType === 'trending' || pageType === 'recommendations') {
      baseSeoTags.ogTitle = baseSeoTags.twitterTitle = baseSeoTags.title;
      baseSeoTags.ogDescription = baseSeoTags.twitterDescription = baseSeoTags.description;
      // Genuine empty lists have no public catalog content to index. Failures
      // remain retryable 503s via hubReadFailed, never permanent noindex gates.
      if (!additionalData?.hubReadFailed && !additionalData?.popularStations?.length) {
        baseSeoTags.noIndex = true;
        baseSeoTags.robots = 'noindex, follow';
      }
    }

    if (pageType === 'about' || pageType === 'contact' || pageType === 'applications') {
      // Use multilingual SEO templates (lib/seo-shared/static-page-seo-templates.ts).
      // DB translation keys (about_mega_radio/_description, contact_page_title/_description,
      // applications_page_seo_title/_description) win when present in the requested
      // language; otherwise we fall back to the natural per-language template so non-top-15
      // languages don't all serve the SAME English title and description across
      // /xx/about, /xx/contact and /xx/applications (the same duplicate-content trap
      // regions, genres, search and legal had before they were localised).
      const staticSeo = buildStaticPageSeo(pageType, language, translations);
      baseSeoTags.title = staticSeo.title;
      baseSeoTags.description = staticSeo.description;
      baseSeoTags.ogType = 'website';
    }
    
    if (pageType === 'tv') {
      baseSeoTags.title = `${getTranslation('tv_login_title') || 'Connect Your TV'} | Mega Radio`;
      baseSeoTags.description = getTranslation('tv_enter_code_description') || 'Open Mega Radio on your TV and enter the 6-digit code displayed on the screen.';
      baseSeoTags.ogType = 'website';
    }
    
    if (pageType === 'terms' || pageType === 'privacy') {
      // Use multilingual SEO templates (lib/seo-shared/legal-seo-templates.ts).
      // DB translation keys (terms_page_title/_description, privacy_page_title/_description)
      // win when present in the requested language; otherwise we fall back to the
      // natural per-language template so non-top-15 languages don't all serve the SAME
      // English title and description across /xx/terms-and-conditions and
      // /xx/privacy-policy (the same duplicate-content trap regions, genres and
      // search had before they were localised).
      const legalSeo = buildLegalSeo(pageType, language, translations);
      baseSeoTags.title = legalSeo.title;
      baseSeoTags.description = legalSeo.description;
      baseSeoTags.ogType = 'website';
    }

    if (pageType === 'search') {
      // Use multilingual SEO templates (shared/search-seo-templates.ts).
      // DB translation keys (search_page_title/_description) win when present in
      // the requested language; otherwise we fall back to the natural per-language
      // template so non-top-15 languages don't all serve the SAME English title and
      // description (which Google previously collapsed as duplicates the same way
      // it did for regions and genres before those were localised).
      const searchSeo = buildSearchSeo(language, translations);
      baseSeoTags.title = searchSeo.title;
      baseSeoTags.description = searchSeo.description;
      baseSeoTags.keywords = searchSeo.keywords;
      baseSeoTags.ogType = 'website';
      // Search result pages should not be indexed (Google guidance) but should be crawlable for links
      baseSeoTags.robots = 'noindex, follow';
      // AUDIT FIX (2026-07-02): the meta said noindex but the noIndex FLAG was
      // never set, so (a) index-web's forceNoIndex didn't fire and the default
      // `X-Robots-Tag: index, follow` header contradicted the meta on cache
      // MISS, and (b) the hreflang block below still advertised all qualified
      // alternates on a noindex page (Google: don't emit alternates for
      // noindex). Set the flag AND suppress alternates, mirroring the utility-
      // page branch. The hreflang generation below is skipped via noIndex.
      baseSeoTags.noIndex = true;
    }

    if (pageType === 'faq') {
      const faq = resolveFaqPageText(language, translations);
      baseSeoTags.title = faq.title;
      baseSeoTags.description = faq.description;
      baseSeoTags.ogTitle = faq.title;
      baseSeoTags.ogDescription = faq.description;
      baseSeoTags.twitterTitle = faq.title;
      baseSeoTags.twitterDescription = faq.description;
      baseSeoTags.ogType = 'website';
    }

    // Station pages use the Open Graph `music.radio_station` object type.
    // Previously fell back to `website`, which tells Facebook / Perplexity
    // nothing about the content type and reduces entity-matching confidence.
    if (pageType === 'station') {
      baseSeoTags.ogType = 'music.radio_station';
    }

    // Generate comprehensive hreflang tags for all pages with translated paths.
    // CRITICAL SEO FIX: Pass canonical URL for self-referential hreflang.
    // ARCHITECT P0 FIX (2026-04-30): non-station pages MUST advertise only the
    // qualified-language set so they don't expose 57 alternates while sitemaps
    // expose 10 (the original Bing 1023-empty-sitemap root cause). Station
    // pages override this below in renderStaticPage with the per-station
    // indexable set (eligible ∩ qualified).
    let allowedLanguages: string[] | undefined;
    if (qualifiedLanguagesResult) delete qualifiedLanguagesResult.languages;
    try {
      const { getCachedQualifiedLanguages } = await import('./seo/qualified-languages');
      allowedLanguages = await getCachedQualifiedLanguages();
      if (qualifiedLanguagesResult) qualifiedLanguagesResult.languages = [...allowedLanguages];
    } catch (e: any) {
      // FAIL-CLOSED (Webmaster #1 HIGH-2 fix, 2026-04-30): if the cache is
      // unavailable mid-request we MUST NOT fall back to all 57 enabled
      // SEO_LANGUAGES — that exact 58-vs-≤10 mismatch caused the original
      // 1023-empty-Bing-sitemap incident. Instead, restrict alternates to a
      // minimal safe set: the current rendering language + English. Ensures
      // (a) self-referential hreflang is always present, (b) we never expose
      // a language not also present in some sitemap, (c) sitemap-routes will
      // independently 503/410 anyway via getQualifiedLanguagesState().
      if (pageType === 'station') additionalData.stationQualificationFailed = true;
      const minimalSet = Array.from(new Set([language, 'en'])).filter(Boolean);
      allowedLanguages = minimalSet;
      try {
        logger.warn(`⚠️ generateEnhancedSeoTags: qualified-languages unavailable — falling back to MINIMAL set [${minimalSet.join(',')}] (${e?.message || e})`);
      } catch {}
    }
    // FAIL-CLOSED guard #2: even when getCachedQualifiedLanguages() succeeded,
    // if the rendering language somehow isn't in the qualified set the page
    // would lose its self-referential hreflang (Search Console warning:
    // "Page does not have an hreflang tag pointing to itself"). Inject the
    // current language defensively. This addresses Webmaster #1 HIGH-1.
    if (Array.isArray(allowedLanguages) && language && !allowedLanguages.includes(language)) {
      allowedLanguages = [...allowedLanguages, language];
    }
    // AUDIT FIX (2026-07-02): never advertise hreflang alternates on a page
    // this function itself marked noindex (search, utility). Previously this
    // assignment ran unconditionally and re-populated hreflangs AFTER the
    // noindex branches, so noindex search pages advertised 14 alternates +
    // x-default — contradictory signals Google parks as "crawled, not indexed".
    // (Station-specific noindex/hreflang gating happens later in
    // renderStaticPage and is unaffected.)
    if (baseSeoTags.noIndex === true) {
      baseSeoTags.hreflangs = [];
    } else {
      baseSeoTags.hreflangs = generateLanguageUrls(
        cleanPath,
        domain,
        language,
        urlTranslations,
        baseSeoTags.canonical,
        allowedLanguages,
      );
    }

    // AUDIT FIX (2026-07-02, og:locale bloat): generateSeoTags builds
    // og:locale:alternate from ALL 57 enabled SEO_LANGUAGES (56 alternates,
    // ~3 KB of head on every page), while hreflang is correctly capped to the
    // qualified/universal-14 set — and 40+ of those og locales point at
    // language variants that 301 to /en. Facebook-only signal, but keep it
    // consistent with hreflang: filter by the same allow-list (locale prefix
    // before '_' is the language code, e.g. tr_TR→tr, zh_CN→zh, bare 'tl'→tl).
    if (Array.isArray(baseSeoTags.ogLocaleAlternates)) {
      if (baseSeoTags.noIndex === true) {
        baseSeoTags.ogLocaleAlternates = [];
      } else if (Array.isArray(allowedLanguages)) {
        const allowSet = new Set(allowedLanguages.map((l) => l.toLowerCase()));
        baseSeoTags.ogLocaleAlternates = baseSeoTags.ogLocaleAlternates.filter(
          (locale: string) => allowSet.has(locale.split('_')[0].toLowerCase()),
        );
      }
    }

    return this.finalizeSeoDirectives(baseSeoTags);
  }
  
  private escapeHtml(input: string): string {
    if (!input) return '';
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * Pick a valid logo URL from a station object. Trims whitespace and requires
   * http(s) scheme so SSR <img> never renders a broken `src`. Used by both
   * home popular-stations grid and station detail page (DALGA 1).
   */
  private pickLogoUrl(station: any): string | null {
    // Prefer processed logos; owned S3 objects use the stable same-origin path.
    const s3Candidates = [station?.logoAssets?.webp256, station?.logoAssets?.webp96];
    for (const c of s3Candidates) {
      if (typeof c === 'string') {
        const trimmed = c.trim();
        if (trimmed && /^https?:\/\//i.test(trimmed)) {
          const owned = normalizePublicStationLogoUrl(c);
          return owned === c ? trimmed : owned;
        }
      }
    }
    // 2) Fallback: the station's RAW external favicon. Emitting it directly is
    //    what triggered Ahrefs "Page has broken image" — a large share of favicon
    //    hosts 403 non-browser crawler UAs (mangoradio.de, icecast.walmradio.com:8443,
    //    …) even though the image is fine in a browser. Route it through our own
    //    /api/image proxy: the proxy re-fetches with a desktop-browser User-Agent
    //    (so it succeeds where the bot was 403'd) and serves the bytes from
    //    themegaradio.com, so the <img> resolves 200 on our domain regardless of
    //    the origin's bot policy. CDN-cached (s-maxage=7d), so no origin hammering.
    const fav = station?.favicon;
    if (typeof fav === 'string') {
      const trimmed = fav.trim();
      if (trimmed && /^https?:\/\//i.test(trimmed)) {
        const owned = normalizePublicStationLogoUrl(fav);
        if (owned !== fav) return owned;
        const encoded = Buffer.from(trimmed, 'utf8')
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        return `/api/image/${encoded}?w=256`;
      }
    }
    return null;
  }

  /**
   * Build the breadcrumb trail used by BOTH the BreadcrumbList JSON-LD
   * (in `generateHtmlHead`) and the visible `<nav class="breadcrumb">`
   * (in `generateHtmlBody`). Sourcing them from one place is what
   * Task #280 asks for: Google flags a BreadcrumbList whose items don't
   * appear as visible links in the body as deceptive markup, the same
   * class of bug Tasks #129/#164/#208 fixed for FAQPage.
   *
   * Returns an empty array for the homepage (no crumbs).
   */
  private computeBreadcrumbItems(
    language: string,
    cleanPath: string,
    urlTranslations: Map<string, string> | undefined,
    stationData: any,
    getLocalizedText: (key: string, fallback: string) => string,
  ): Array<{ name: string; path: string }> {
    if (!cleanPath || cleanPath === '/' || cleanPath === '') return [];
    const regionItems = buildRegionBreadcrumbItems({
      language, cleanPath, getLocalizedText, urlTranslations,
    });
    if (regionItems) return regionItems;

    const items: Array<{ name: string; path: string }> = [
      { name: getLocalizedText('nav_home', 'Home'), path: `/${language}` },
    ];

    const pathSegments = cleanPath.split('/').filter(Boolean);
    const translateSeg = (seg: string): string => {
      if (!language || language === 'en') return seg;
      if (!urlTranslations || urlTranslations.size === 0) return seg;
      return urlTranslations.get(`${language}:${seg}`) || seg;
    };
    let currentPath = '';

    for (let i = 0; i < pathSegments.length; i++) {
      const segment = pathSegments[i];
      if (pathSegments[0] === 'profile' && pathSegments.length === 2 && segment === 'settings') continue;
      const isLastSegment = i === pathSegments.length - 1;
      const isStationDetailSlug = isLastSegment && (cleanPath.includes('/station/') || cleanPath.includes('/stations/'));
      const segForUrl = isStationDetailSlug ? segment : translateSeg(segment);
      currentPath += '/' + segForUrl;

      if (isStationDetailSlug) {
        const name = stationData?.name || segment.replace(/-/g, ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        items.push({ name, path: `/${language}${currentPath}` });
      } else if (segment !== 'stations' && segment !== 'station') {
        const translationKey = `nav_${segment}`;
        const displayName = segment === 'faq'
          ? resolveFaqPageText(language, { nav_faq: getLocalizedText('nav_faq', '') }).navLabel
          : getLocalizedText(translationKey, segment.replace(/-/g, ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
        // Match the client: profile links always target the single settings screen.
        const profileSegment = urlTranslations?.get(`${language}:profile`) || URL_TRANSLATIONS[language]?.profile || 'profile';
        const settingsSegment = urlTranslations?.get(`${language}:settings`) || URL_TRANSLATIONS[language]?.settings || 'settings';
        const path = i === 0 && segment === 'profile'
          ? `/${language}/${profileSegment}/${settingsSegment}` : `/${language}${currentPath}`;
        items.push({ name: displayName, path });
      }
    }

    if (cleanPath.includes('/stations') || cleanPath.includes('/station/')) {
      const idx = items.findIndex(b => !b.path.includes('/station'));
      const stationsName = getLocalizedText('nav_stations', 'Stations');
      if (idx >= 0 && !items.find(b => b.name.toLowerCase() === stationsName.toLowerCase())) {
        // The collection crumb targets the plural directory, never the
        // singular station-detail prefix. Keep SSR HTML and JSON-LD aligned
        // with the client even before optional URL overrides are cached.
        const stationSegment = urlTranslations?.get(`${language}:stations`)
          || URL_TRANSLATIONS[language]?.stations || 'stations';
        items.splice(idx + 1, 0, { name: stationsName, path: `/${language}/${stationSegment}` });
      }
    }

    return items;
  }

  private getH1Text(pageType: string, language: string, translations: Record<string, string>, seoTags?: any, stationData?: any, additionalData?: any): string {
    // Return plain text: generateHtmlBody escapes every H1 exactly once.
    // Helper function to get localized text from DATABASE ONLY (no hardcoded translations)
    const FALLBACK_TEXTS: Record<string, string> = {
      genres_page_title: 'Radio Genres — Browse All Music Genres | Mega Radio',
      stations_page_title: 'Radio Stations — Browse All Stations | Mega Radio',
      regions_page_title: 'Radio by Region — Browse Stations by Region | Mega Radio',
      hero_worlds_best_radio: 'Mega Radio: Listen to Free Live Radio & Music',
      about_mega_radio: 'About Mega Radio - Free Online Radio Platform',
      contact_page_title: 'Contact Mega Radio - Get in Touch',
      search_page_h1: 'Search Live Radio Stations',
      faq_page_h1: 'Mega Radio Frequently Asked Questions',
    };
    const getLocalizedText = (key: string): string => {
      const val = translations[key]?.trim();
      return val ? val : (FALLBACK_TEXTS[key] || '');
    };

    // Semrush 2026-05-13 audit: 2,039 pages had identical <title> and <h1>
    // because both used the same template strings (architect's investigation
    // confirmed). Google explicitly warns this looks "over-optimized". The
    // strategy below keeps each <title> keyword-rich (best for SERP CTR)
    // and renders a SHORTER, page-focused <h1> derived from but distinct
    // from the title.
    //
    // `deriveH1FromTitle` covers BOTH layout patterns we use:
    //   1. "About Mega Radio — Free Online Radio Platform"  → "About Mega Radio"
    //      (static-page-seo-templates.ts puts the brand in the MIDDLE; first
    //      em-dash segment is the focused heading.)
    //   2. "Terms and Conditions — Mega Radio"              → "Terms and Conditions"
    //      (legal-seo-templates.ts puts brand at the END; same split rule
    //      still gives the correct heading.)
    //   3. "Foo Bar | Mega Radio"                           → "Foo Bar"
    //      (genre / region listing fallbacks; pipe-suffix branch.)
    //   4. "تواصل مع Mega Radio" (no separator, brand mid-sentence)
    //      → "تواصل مع" (final fallback strips standalone "Mega Radio"
    //      anywhere in the string and collapses whitespace).
    const deriveH1FromTitle = (s: string): string => {
      const emDashIdx = s.indexOf(' — ');
      if (emDashIdx > 0) return s.slice(0, emDashIdx).trim();
      const pipeStripped = s.replace(/\s*\|\s*Mega\s+Radio\s*$/i, '').trim();
      if (pipeStripped && pipeStripped !== s) return pipeStripped;
      // Final fallback for single-phrase titles with brand mid-sentence
      // (e.g. AR contact "تواصل مع Mega Radio"). Strip the standalone
      // brand token anywhere it appears, collapse whitespace. Returns
      // input unchanged if removal would leave an empty string.
      const brandStripped = s
        .replace(/\s*Mega\s+Radio\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return brandStripped && brandStripped !== s ? brandStripped : s;
    };

    switch (pageType) {
      case 'home':
        // Keep visible brand copy identical to the app, independent of legacy
        // hero translations. Metadata continues to use buildHomeSeo.
        return getHomeHeroCopy(language).headline;
      
      case 'station':
        if (stationData) {
          // H1 = the bare station name, to EXACTLY match the JS-rendered <h1>
          // in the SPA (stations/[id].tsx renders `{station.name}` only). The
          // SSR body is replaced by the SPA on load (it is not React-hydrated),
          // so Googlebot's rendered view already indexes the bare-name h1; a
          // richer SSR h1 ("{name} {country}") only appears to non-JS crawlers
          // and site-audit tools as a raw-vs-rendered mismatch. Location
          // keywords are retained in <title>, meta description, breadcrumbs and
          // the "About {station}" <h2>, so keyword coverage is unaffected.
          if (stationData.name && stationData.name.trim()) {
            return stationData.name.trim();
          }
          // Fallback only when the name is missing: derive from the title minus CTA.
          const fullTitle = generateLocalizedStationTitle(stationData, language, translations);
          const dashIdx = fullTitle.lastIndexOf(' — ');
          const h1Source = dashIdx > 0 ? fullTitle.slice(0, dashIdx) : fullTitle;
          return h1Source;
        }
        return deriveH1FromTitle(getLocalizedText('stations_page_title'));
      
      case 'genres':
        if (additionalData?.genreName) {
          // Use multilingual helper so TR/DE/ES/etc. don't show English "Radio Stations"
          // when the legacy DB keys are missing (which is the current production state).
          const genreSeo = buildGenreSeo(additionalData.genreName, language, translations);
          // H1 = bare genreSeo.h1 (no " | Mega Radio" suffix) — title in
          // genre-seo-templates.ts already carries the brand suffix.
          return genreSeo.h1;
        }
        return buildDirectoryIndexSeo('genres', language, translations).h1;
      
      case 'regions':
        if (additionalData?.regionName) {
          // SEO audit fix (2026-05-12): previously the title interpolated raw
          // English `regionName` (e.g. "Turkey") with two i18n keys that fell
          // back to English when the DB translation was missing. Result on a
          // TR page was the half-translated "Turkey Radio Stations — Canlı
          // Dinle | Mega Radio" — exactly the "language mismatch" issue the
          // audit flagged. Now we (a) localize the country name itself via
          // `getLocalizedCountryName` so "Turkey" → "Türkiye" / "Almanya" /
          // "Italia", and (b) fall back to LOCALIZED_LABELS (per-language
          // hand-curated copy) when the DB key is missing instead of dumping
          // English into a non-English page.
          const isContinent = !additionalData.country && VALID_CONTINENT_SLUGS.has(String(additionalData.region || '').toLowerCase());
          const localizedRegion = additionalData.cityName && additionalData.cityName !== 'ALL'
            ? `${additionalData.cityName}, ${getLocalizedCountryName(additionalData.countryName, language)}` : isContinent
            ? getLocalizedRegionName(additionalData.regionName, language)
            : getLocalizedCountryName(additionalData.regionName, language);
          const radioStationsText = translations['seo_radio_stations']?.trim()
              || LOCALIZED_RADIO_STATIONS[language]
              || 'Radio Stations';
          // H1 = "{region} {radio_stations}" — drop "— Listen Live | Mega
          // Radio" tail (kept on <title>) so the visible heading differs.
          return `${localizedRegion} ${radioStationsText}`;
        }
        return buildDirectoryIndexSeo('regions', language, translations).h1;
      
      case 'users':
      case 'stations':
      case 'recommendations':
        return deriveH1FromTitle(buildCommunityPageSeo(pageType, language, translations).title);

      case 'trending':
        return trendingPageSeo(language, translations).h1;
      
      case 'about':
        return deriveH1FromTitle(buildStaticPageSeo('about', language, translations).title);

      case 'contact':
        return deriveH1FromTitle(buildStaticPageSeo('contact', language, translations).title);

      case 'applications':
        return deriveH1FromTitle(buildStaticPageSeo('applications', language, translations).title);
      
      case 'terms':
        return deriveH1FromTitle(buildLegalSeo('terms', language, translations).title);

      case 'privacy':
        return deriveH1FromTitle(buildLegalSeo('privacy', language, translations).title);

      case 'search':
        return buildSearchSeo(language, translations).h1;

      case 'faq':
        return resolveFaqPageText(language, translations).h1;

      default:
        return getLocalizedText('hero_worlds_best_radio') || FALLBACK_TEXTS.hero_worlds_best_radio;
    }
  }

  buildStationDirectoryData(source: {
    language: string; cleanPath: string; translations?: Record<string, string>;
    seoTags?: any; urlTranslations?: Map<string, string>; pageData?: Record<string, any>;
  }): StationDirectoryData | undefined {
    const data = source.pageData;
    if (!isStationDirectoryPath(source.cleanPath) || data?.pageType !== 'stations'
      || data.httpNotFound || data.stationDbError || data.hubReadFailed
      || !Array.isArray(data.catalogStations) || data.catalogStations.length > 60) return undefined;
    const translations = source.translations || {};
    const localizedText = (key: string, fallback: string) => translations[key]?.trim() || fallback;
    const localUrl = (path: string) => buildLocalizedUrl(path, source.language, undefined, source.urlTranslations);
    const letter = matchAzIndexPath(source.cleanPath);
    const base = localUrl(letter ? `/stations/${letter}` : '/stations');
    const currentPage = data.catalogPage;
    const totalPages = data.catalogTotalPages;
    if (!Number.isSafeInteger(currentPage) || currentPage < 1
      || !Number.isSafeInteger(totalPages) || totalPages < currentPage) return undefined;
    const h1 = this.getH1Text('stations', source.language, translations, source.seoTags, undefined, data.additionalData);
    const result: StationDirectoryData = {
      h1: letter ? `${h1 || 'Radio Stations'} — ${azDisplayLabel(letter)}` : (h1 || 'Radio Stations'),
      letter, currentPage, totalPages,
      navLabel: localizedText('stations_az_nav', 'Radio stations A to Z'),
      paginationLabel: localizedText('pagination', 'Pagination'),
      stations: data.catalogStations.map((station: LeanStationCard) => ({
        href: buildStationLinkUrl(station, source.language, data.stationLinkLanguages, source.urlTranslations),
        name: station.name || 'Radio Station',
        logoUrl: this.pickLogoUrl(station),
        alt: getStationImageAlt(station, source.language, localizedText),
      })),
      letters: AZ_INDEX_KEYS.map(key => ({
        label: azDisplayLabel(key), href: localUrl(`/stations/${key}`), current: key === letter,
      })),
      pages: seoCatalogPageLinks(currentPage, totalPages).map(page => ({
        page, href: page === 1 ? base : `${base}?page=${page}`, current: page === currentPage,
        ...(page === currentPage - 1 ? { rel: 'prev' as const }
          : page === currentPage + 1 ? { rel: 'next' as const } : {}),
      })),
    };
    return isStationDirectoryData(result) ? result : undefined;
  }

  generateHtmlBody(pageData: { pageType: string; language: string; translations: Record<string, string>; seoTags?: any; stationData?: any; additionalData?: any; urlTranslations?: Map<string, string>; cleanPath?: string }): string {
    const { pageType, language, translations, seoTags, stationData, additionalData, urlTranslations, cleanPath } = pageData;
    if (pageType === 'blog' && additionalData?.blog) return renderBlogHtml(additionalData.blog);
    const h1Text = this.getH1Text(pageType, language, translations, seoTags, stationData, additionalData);

    // Visible breadcrumb trail — Task #280. Rendered above <main> on every
    // non-home page so the BreadcrumbList JSON-LD emitted in
    // `generateHtmlHead` has matching visible <a> links in the body.
    // Without this, Google flags the schema as deceptive markup (same
    // class of bug Tasks #129/#164/#208 fixed for FAQPage).
    let breadcrumbHtml = '';
    if (pageType !== 'home' && cleanPath) {
      const getLocalizedText = (key: string, fallback: string): string =>
        translations[key] || fallback;
      const breadcrumbItems = this.computeBreadcrumbItems(
        language,
        cleanPath,
        urlTranslations,
        stationData,
        getLocalizedText,
      );
      if (breadcrumbItems.length > 0) {
        breadcrumbHtml = `<nav aria-label="breadcrumb" class="breadcrumb"><ol>${breadcrumbItems
          .map(
            (it) =>
              `<li><a href="${this.escapeHtml(it.path)}">${this.escapeHtml(it.name)}</a></li>`,
          )
          .join('')}</ol></nav>`;
      }
    }
    
    // Generate a minimal but semantic HTML body for SEO
    const getLocalizedText = (key: string, fallback: string): string => {
      return translations[key] || fallback;
    };

    let content = '';
    
    switch (pageType) {
      case 'home': {
        const heroCopy = getHomeHeroCopy(language);
        // LCP fix (PageSpeed 2026-07-03): the SSR body is what paints first
        // (React later repaints over it — see replit.md, body is replaced not
        // hydrated). Without the hero image here, the page's largest paint
        // was the REACT-rendered hero at ~8s on mobile (after the JS + API
        // waterfall), which is exactly what Lighthouse reported as LCP 8.4s.
        // Rendering the SAME <picture> markup the SPA hero uses (identical
        // URLs, classes and intrinsic size, styled by the same .hero-container
        // rules in the render-blocking stylesheet) makes the hero paint with
        // first contentful paint and allows reuse of the downloaded resource.
        // This is not hydration: createRoot replaces the server DOM, and the
        // replacement image can still register a later LCP. Preserving that
        // first node requires a matching shared server/client rendering tree.
        content = `
          <main class="pt-[70px] md:pt-[80px] lg:pt-[90px] xl:pt-[105px]">
            <div class="hero-container overflow-visible">
              <picture>
                <source media="(min-width: 768px)" srcset="/images/hero-bg.webp" type="image/webp">
                <img src="/images/hero-bg-430w.webp" alt="" class="absolute inset-0 w-full h-full object-cover pointer-events-none z-0" aria-hidden="true" fetchpriority="high" decoding="async" width="1920" height="600">
              </picture>
              <div class="hero-section text-center relative z-10">
                <div class="home-hero-copy" dir="${heroCopy.direction}">
                  <p class="home-hero-eyebrow">${this.escapeHtml(heroCopy.eyebrow)}</p>
                  <h1 class="home-hero-title">${this.escapeHtml(h1Text)}</h1>
                  <p class="home-hero-tagline">${this.escapeHtml(heroCopy.tagline)}</p>
                </div>
              </div>
            </div>

            <!-- SEO Opening Paragraph - Uses H1 Keywords -->
            <section class="intro-section">
              <p>${this.escapeHtml(getLocalizedText('seo_opening_paragraph', buildHomeSeo(language, translations).description).replace('{h1}', h1Text))}</p>
            </section>
            
            <!-- SEO Navigation Links -->
            <nav class="main-navigation">
              <h2>${this.escapeHtml(getLocalizedText('explore_mega_radio', LOCALIZED_RADIO_STATIONS[language] || 'Radio Stations'))}</h2>
              <ul>
                <li><a href="/${language}/${urlTranslations?.get(`${language}:genres`) || 'genres'}">${this.escapeHtml(getLocalizedText('nav_genres', 'Radio Genres'))}</a></li>
                <li><a href="/${language}/${urlTranslations?.get(`${language}:regions`) || 'regions'}">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio by Country'))}</a></li>
                <li><a href="/${language}/${urlTranslations?.get(`${language}:stations`) || 'stations'}">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="/${language}/${urlTranslations?.get(`${language}:recommendations`) || 'recommendations'}">${this.escapeHtml(getLocalizedText('nav_for_you', 'For You'))}</a></li>
                <li><a href="/${language}/${urlTranslations?.get(`${language}:users`) || 'users'}">${this.escapeHtml(getLocalizedText('nav_users', 'Community'))}</a></li>
              </ul>
            </nav>
            
            ${additionalData?.popularStations && additionalData.popularStations.length > 0 ? `
            <!-- Popular Radio Stations - SEO image surface for Bing/Google image indexing -->
            <section class="popular-stations">
              <h2>${this.escapeHtml(getLocalizedText('popular_stations', 'Popular Radio Stations'))}</h2>
              <ul class="popular-stations-list">
                ${additionalData.popularStations.map((station: any) => {
                  const slug = station.slug || station._id;
                  // Prefix-all canonical: /<lang>/<localized-station>/<slug> for ALL languages including English
                  const stationSegment = urlTranslations?.get(`${language}:station`) || 'station';
                  const stationUrl = `/${language}/${stationSegment}/${slug}`;
                  const logo = this.pickLogoUrl(station);
                  const stationName = this.escapeHtml(station.name || 'Radio Station');
                  const altText = this.escapeHtml(getStationImageAlt(station, language, getLocalizedText));
                  return `
                    <li>
                      <a href="${stationUrl}">
                        ${logo ? `<img src="${this.escapeHtml(logo)}" alt="${altText}" width="256" height="256" loading="lazy" decoding="async">` : ''}
                        <h3>${stationName}</h3>
                      </a>
                    </li>
                  `;
                }).join('')}
              </ul>
            </section>
            ` : ''}

            <!-- Popular Genres Links -->
            <section class="popular-genres">
              <h2>${this.escapeHtml(getLocalizedText('popular_genres_title', 'Popular Radio Genres'))}</h2>
              <ul>
                ${(() => {
                  const genSeg = urlTranslations?.get(`${language}:genres`) || 'genres';
                  if (additionalData?.topGenres && additionalData.topGenres.length > 0) {
                    return (additionalData.topGenres as Array<{ slug: string; name: string; count: number }>).map(g =>
                      `<li><a href="/${language}/${genSeg}/${this.escapeHtml(g.slug)}">${this.escapeHtml(g.name)}</a></li>`
                    ).join('');
                  }
                  return [
                    ['pop',       getLocalizedText('genre_pop_radio',       'Pop Radio Stations')],
                    ['rock',      getLocalizedText('genre_rock_radio',      'Rock Radio Stations')],
                    ['jazz',      getLocalizedText('genre_jazz_radio',      'Jazz Radio Stations')],
                    ['classical', getLocalizedText('genre_classical_radio', 'Classical Radio Stations')],
                    ['electronic',getLocalizedText('genre_electronic_radio','Electronic Radio Stations')],
                    ['country',   getLocalizedText('genre_country_radio',   'Country Radio Stations')],
                    ['hip-hop',   getLocalizedText('genre_hiphop_radio',    'Hip Hop Radio Stations')],
                    ['reggae',    getLocalizedText('genre_reggae_radio',    'Reggae Radio Stations')],
                  ].map(([slug, label]) => `<li><a href="/${language}/${genSeg}/${slug}">${this.escapeHtml(label as string)}</a></li>`).join('');
                })()}
              </ul>
            </section>
            
            <!-- Major Countries Links -->
            <section class="popular-countries">
              <h2>${this.escapeHtml(getLocalizedText('popular_countries_title', 'Radio Stations by Country'))}</h2>
              ${(() => {
                const regSeg = urlTranslations?.get(`${language}:regions`) || 'regions';
                const countries: Array<[string, string, string]> = [
                  ['north-america', 'united-states',  getLocalizedText('country_usa_radio',       'United States Radio')],
                  ['europe',        'united-kingdom',  getLocalizedText('country_uk_radio',        'United Kingdom Radio')],
                  ['europe',        'germany',         getLocalizedText('country_germany_radio',   'Germany Radio')],
                  ['europe',        'france',          getLocalizedText('country_france_radio',    'France Radio')],
                  ['north-america', 'canada',          getLocalizedText('country_canada_radio',    'Canada Radio')],
                  ['oceania',       'australia',       getLocalizedText('country_australia_radio', 'Australia Radio')],
                  ['south-america', 'brazil',          getLocalizedText('country_brazil_radio',    'Brazil Radio')],
                  ['europe',        'italy',           getLocalizedText('country_italy_radio',     'Italy Radio')],
                  ['europe',        'spain',           getLocalizedText('country_spain_radio',     'Spain Radio')],
                  ['asia',          'turkey',          getLocalizedText('country_turkey_radio',    'Turkey Radio')],
                  ['asia',          'japan',           getLocalizedText('country_japan_radio',     'Japan Radio')],
                  ['asia',          'india',           getLocalizedText('country_india_radio',     'India Radio')],
                ];
                return `<ul>${countries.map(([region, slug, label]) =>
                  `<li><a href="/${language}/${regSeg}/${region}/${slug}">${this.escapeHtml(label)}</a></li>`
                ).join('')}</ul>`;
              })()}
            </section>
            
            ${renderHomeFaqBody(language, translations, buildLocalizedUrl('/faq', language, undefined, urlTranslations))}

            <nav class="footer-links">
              <ul>
                <li><a href="/${language}/faq">${this.escapeHtml(resolveFaqPageText(language, translations).label)}</a></li>
                ${isBlogLocale(language) ? `<li><a href="${blogPath(language)}">${this.escapeHtml(BLOG_LABELS[language])}</a></li>` : ''}
                <li><a href="/${language}/${urlTranslations?.get(`${language}:about`) || 'about'}">${this.escapeHtml(getLocalizedText('nav_about', 'About Us'))}</a></li>
                <li><a href="/${language}/${urlTranslations?.get(`${language}:contact`) || 'contact'}">${this.escapeHtml(getLocalizedText('nav_contact', 'Contact'))}</a></li>
                <li><a href="/${language}/${urlTranslations?.get(`${language}:privacy-policy`) || 'privacy-policy'}">${this.escapeHtml(getLocalizedText('nav_privacy', 'Privacy Policy'))}</a></li>
                <li><a href="/${language}/${urlTranslations?.get(`${language}:terms-and-conditions`) || 'terms-and-conditions'}">${this.escapeHtml(getLocalizedText('nav_terms', 'Terms of Service'))}</a></li>
                <li><a href="/${language}/${urlTranslations?.get(`${language}:applications`) || 'applications'}">${this.escapeHtml(getLocalizedText('nav_apps', 'Mobile Apps'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        break;
      }
      
      case 'station':
        content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            ${stationData?.isListVisible === false ? `<p id="station-stream-unavailable" role="status">${this.escapeHtml(getStationStreamUnavailableNotice(language))}</p>` : ''}
            ${stationData ? `
              <div class="station-info">
                ${(() => {
                  // Station logo - SEO image surface for Google/Bing image indexing (DALGA 1 W1.1)
                  // pickLogoUrl: trim + http(s) scheme guard (architect P1) — never render broken src
                  // fetchpriority intentionally NOT "high": logo is not always LCP; let browser decide (architect P1)
                  const logo = this.pickLogoUrl(stationData);
                  if (!logo) return '';
                  const name = this.escapeHtml(stationData.name || 'Radio Station');
                  const countryName = getStationCountryName(stationData, language);
                  const country = this.escapeHtml(countryName);
                  const altText = getStationImageAlt(stationData, language, getLocalizedText);
                  const caption = country ? `${name} — ${country}` : name;
                  return `
                <figure class="station-logo">
                  <img src="${this.escapeHtml(logo)}" alt="${this.escapeHtml(altText)}" width="256" height="256" loading="eager" decoding="async">
                  <figcaption>${caption}</figcaption>
                </figure>`;
                })()}
                <!-- AI-Generated Description (unique per station) -->
                <h2>${this.escapeHtml(getStationPageCopy(language, translations).about)}</h2>
                <!-- DALGA 4: H1-keyword echo intro (single sentence, station-specific interpolation: name + country) -->
                ${(() => {
                  const introTemplate = getStationPageCopy(language, translations).intro;
                  const stationName = stationData.name || 'Radio Station';
                  const country = getStationCountryName(stationData, language);
                  const introText = introTemplate
                    .replace(/\{STATION(?:_NAME)?\}/gi, () => stationName)
                    .replace(/\{COUNTRY\}/g, () => country);
                  return `<p class="station-intro">${this.escapeHtml(introText)}</p>`;
                })()}
                ${(() => {
                  const fullText = selectStationVisibleDescription(stationData, language, getStationCountryName(stationData, "en"));
                  if (fullText && fullText.length > 300) {
                    // Preserve leading punctuation and a final fragment without
                    // ASCII sentence punctuation (including mixed CJK text).
                    const sentences = fullText.match(/[^.!?]*[.!?]+|[^.!?]+$/g) || [fullText];
                    const paragraphs = [];
                    let currentParagraph = '';
                    for (const sentence of sentences) {
                      currentParagraph += sentence;
                      if (currentParagraph.length > 400) {
                        paragraphs.push(currentParagraph.trim());
                        currentParagraph = '';
                      }
                    }
                    if (currentParagraph.trim()) {
                      paragraphs.push(currentParagraph.trim());
                    }
                    return paragraphs.map(p => '<p>' + this.escapeHtml(p) + '</p>').join('');
                  } else if (fullText) {
                    return '<p>' + this.escapeHtml(fullText) + '</p>';
                  }
                  return '';
                })()}
                <!-- DALGA 4: Station-specific outro (25-35 words, interpolation: name + country + tags — NOT scaled boilerplate) -->
                ${(() => {
                  const outroTemplate = getStationPageCopy(language, translations).outro;
                  const stationName = stationData.name || 'Radio Station';
                  const country = getStationCountryName(stationData, language);
                  const tagList = (stationData.tags || '')
                    .split(/[,;]/)
                    .map((t: string) => t.trim())
                    .filter((t: string) => t.length > 0)
                    .slice(0, 3)
                    .join(', ');
                  const genres = tagList || getLocalizedText('seo_live_radio', 'live radio');
                  const outroText = outroTemplate
                    .replace(/\{STATION\}/g, () => stationName)
                    .replace(/\{COUNTRY\}/g, () => country)
                    .replace(/\{GENRES\}/g, () => genres);
                  return `<p class="station-outro">${this.escapeHtml(outroText)}</p>`;
                })()}
                
                <!-- Station Details -->
                <section class="station-details">
                  <h2>${this.escapeHtml(getStationPageCopy(language, translations).information)}</h2>
                  ${(() => {
                    // Visible listener rating (radio.at parity). Google's review
                    // snippet policy requires the aggregate rating to be VISIBLE
                    // on the page, not just in JSON-LD — this line is the visible
                    // counterpart of the AggregateRating emitted in the head.
                    // Same gate as the schema: >=3 REAL ratings collected through
                    // our own /api/stations/:id/rate widget (never derived from
                    // Radio-Browser `votes`, which are one-way likes, not stars).
                    const rc = Number((stationData as any).totalRatings || 0);
                    const ra = Number((stationData as any).averageRating || 0);
                    if (rc < 3 || !(ra >= 1 && ra <= 5)) return '';
                    const rounded = (Math.round(ra * 10) / 10).toFixed(1);
                    const label = this.escapeHtml(getStationPageCopy(language, translations).listenerRating);
                    return `
                  <p class="station-rating"><strong>${label}:</strong> ★ ${rounded} / 5 · ${rc}</p>`;
                  })()}
                  ${getStationCountryName(stationData, language) ? `
                  <p><strong>${this.escapeHtml(getLocalizedText('country', 'Country'))}:</strong> ${this.escapeHtml(getStationCountryName(stationData, language))}</p>
                  ` : ''}
                  ${stationData.tags ? `
                  <p><strong>${this.escapeHtml(getLocalizedText('genres', 'Genres'))}:</strong> ${stationData.tags.split(',').slice(0, 6).map((tag: string) => this.escapeHtml(tag.trim())).join(', ')}</p>
                  ` : ''}
                  ${(() => {
                    let homepage: URL;
                    try {
                      homepage = new URL(stationData.homepage);
                      if (!['http:', 'https:'].includes(homepage.protocol) || homepage.username || homepage.password) return '';
                    } catch { return ''; }
                    // A stream is not the station's official website. Missing
                    // homepages must not silently fall back to the audio URL.
                    const websiteLabel = this.escapeHtml(
                      getStationPageCopy(language, translations).website,
                    );
                    const stationName = this.escapeHtml(stationData.name || '');
                    const anchorText = stationName
                      ? `${websiteLabel} — ${stationName}`
                      : websiteLabel;
                    return `
                  <p><strong>${websiteLabel}:</strong> <a href="${this.escapeHtml(homepage.href)}" target="_blank" rel="noopener noreferrer nofollow">${anchorText}</a></p>`;
                  })()}
                </section>
                
                ${(() => {
                  // ---- Cross-link sections (architect P0: GEO + crawl) ---
                  // Server-rendered "Discover more" lists so AI bots and a
                  // crawler's first pass discover neighbouring stations
                  // without needing the React client to hydrate. Data is
                  // fetched in parallel up in renderStaticPage and stored
                  // on additionalData.crossLinks; if the fetch produced
                  // empty arrays the corresponding section is silently
                  // skipped (no empty <ul>). Sizes are capped at 8/8/6
                  // and de-duplicated across lists.
                  const xl = (additionalData as any)?.crossLinks;
                  if (!xl) return '';
                  const stationSegment =
                    urlTranslations?.get(`${language}:station`) || 'station';
                  const renderItem = (s: any) => {
                    const slug = s?.slug || s?._id;
                    if (!slug) return '';
                    const url = `/${language}/${stationSegment}/${slug}`;
                    const name = this.escapeHtml(s?.name || 'Radio Station');
                    return `<li><a href="${url}">${name}</a></li>`;
                  };
                  const sections: string[] = [];
                  if (xl.samePublisher?.length) {
                    // Name-prefix matches do not establish common ownership.
                    const heading = this.escapeHtml(getStationRelatedHeading(language, 'country', '', translations));
                    sections.push(`
                <section class="related-stations related-stations--publisher">
                  <h2>${heading}</h2>
                  <ul>${xl.samePublisher.map(renderItem).join('')}</ul>
                </section>`);
                  }
                  if (xl.sameCountry?.length && getStationCountryName(stationData, language)) {
                    const localizedCountry = getStationCountryName(stationData, language);
                    const heading = this.escapeHtml(getStationRelatedHeading(language, 'country', localizedCountry, translations));
                    sections.push(`
                <section class="related-stations related-stations--country">
                  <h2>${heading}</h2>
                  <ul>${xl.sameCountry.map(renderItem).join('')}</ul>
                </section>`);
                  }
                  if (xl.sameGenre?.length) {
                    const genreLabel = xl.genreName
                      ? this.escapeHtml(String(xl.genreName))
                      : '';
                    const heading = genreLabel
                      ? `${this.escapeHtml(getLocalizedText('more_genre_stations', 'More radio stations in'))} ${genreLabel}`
                      : this.escapeHtml(getLocalizedText('related_stations', 'Related stations'));
                    sections.push(`
                <section class="related-stations related-stations--genre">
                  <h2>${heading}</h2>
                  <ul>${xl.sameGenre.map(renderItem).join('')}</ul>
                </section>`);
                  }
                  if (xl.sameCity?.length) {
                    const cityLabel = xl.cityName
                      ? String(xl.cityName)
                      : '';
                    const heading = this.escapeHtml(getStationRelatedHeading(language, 'city', cityLabel, translations));
                    sections.push(`
                <section class="related-stations related-stations--city">
                  <h2>${heading}</h2>
                  <ul>${xl.sameCity.map(renderItem).join('')}</ul>
                </section>`);
                  }
                  return sections.join('\n');
                })()}

                <!-- Navigation -->
                <nav class="explore-nav">
                  <ul>
                    <li><a href="${this.escapeHtml(buildLocalizedUrl('/genres', language, undefined, urlTranslations))}">${this.escapeHtml(getLocalizedText('nav_genres', 'Browse All Radio Genres'))}</a></li>
                    <li><a href="${this.escapeHtml(buildLocalizedUrl('/regions', language, undefined, urlTranslations))}">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio Stations by Country'))}</a></li>
                    <li><a href="${this.escapeHtml(buildLocalizedUrl('/stations', language, undefined, urlTranslations))}">${this.escapeHtml(getLocalizedText('nav_stations', 'Explore All Stations'))}</a></li>
                    <li><a href="/${language}">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
                  </ul>
                </nav>
              </div>
            ` : ''}
          </main>
        `;
        break;
      
      case 'genres':
        {
          const genreName = additionalData?.genreName || '';
          const langPrefix = `/${language}`;
          if (!genreName) {
            const hub = buildDirectoryIndexSeo('genres', language, translations);
            const genresPath = buildLocalizedUrl('/genres', language, undefined, urlTranslations || new Map());
            content = `<main lang="${this.escapeHtml(language)}" dir="${language === 'ar' || language === 'he' ? 'rtl' : 'ltr'}">
              <h1>${this.escapeHtml(h1Text)}</h1>
              <p>${this.escapeHtml(hub.description)}</p>
              <ul class="genre-directory">
                ${(additionalData?.directoryGenres || []).map((genre: { slug: string; name: string }) =>
                  `<li><a href="${this.escapeHtml(`${genresPath}/${encodeURIComponent(genre.slug)}`)}">${this.escapeHtml(genre.name)}</a></li>`).join('')}
              </ul>
            </main>`;
            break;
          }
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            ${genreName ? (() => {
              // Multilingual body intro/availability — see shared/genre-seo-templates.ts.
              // Replaces the old per-key i18n approach which left TR/DE/etc. body fragments in English.
              const genreSeo = buildGenreSeo(genreName, language, translations);
              return `
            <section>
              <p>${this.escapeHtml(genreSeo.bodyIntro)}</p>
              <p>${this.escapeHtml(genreSeo.bodyAvailability)}</p>
            </section>`;
            })() : ''}
            ${additionalData?.popularStations && additionalData.popularStations.length > 0 ? `
            <!-- DALGA 2 W2.1: Top stations for this genre — SEO image surface -->
            <section class="popular-stations">
              <h2>${this.escapeHtml(getLocalizedText('popular_stations', 'Popular Radio Stations'))}</h2>
              <ul class="popular-stations-list">
                ${additionalData.popularStations.map((station: any) => {
                  const slug = station.slug || station._id;
                  const stationUrl = buildLocalizedUrl(`/station/${slug}`, language, undefined, urlTranslations);
                  const logo = this.pickLogoUrl(station);
                  const stationName = this.escapeHtml(station.name || 'Radio Station');
                  const altText = this.escapeHtml(getStationImageAlt(station, language, getLocalizedText));
                  return `
                    <li>
                      <a href="${stationUrl}">
                        ${logo ? `<img src="${this.escapeHtml(logo)}" alt="${altText}" width="256" height="256" loading="lazy" decoding="async">` : ''}
                        <h3>${stationName}</h3>
                      </a>
                    </li>`;
                }).join('')}
              </ul>
            </section>
            ` : ''}
            ${(() => {
              const current = additionalData?.catalogPage || 1;
              const total = additionalData?.catalogTotalPages || 1;
              if (total > 1) {
                const base = (seoTags?.canonical || buildLocalizedUrl(cleanPath || '/genres', language, undefined, urlTranslations)).split('?')[0];
                return `<nav class="pagination" aria-label="${this.escapeHtml(getLocalizedText('pagination', 'Pagination'))}"><ul>${seoCatalogPageLinks(current, total).map(page =>
                  page === current ? `<li><span aria-current="page">${page}</span></li>`
                    : `<li><a href="${this.escapeHtml(page === 1 ? base : `${base}?page=${page}`)}"${page === current - 1 ? ' rel="prev"' : page === current + 1 ? ' rel="next"' : ''}>${page}</a></li>`
                ).join('')}</ul></nav>`;
              }
              return '';
            })()}
            ${(() => {
              // ---- Cross-link sections (architect P1: B2) ----------------
              // "Top countries broadcasting <genre>" links to the country
              // pages so crawlers walk genre → country, and "Related
              // genres" links to other whitelisted genre slugs. Skipped
              // entirely on noindex pages (architect P1 review fix —
              // emitting crawl edges from a noindex page wastes budget).
              if (seoTags?.noIndex === true) return '';
              const xl = (additionalData as any)?.crossLinks;
              if (!xl) return '';
              const sections: string[] = [];
              const regionsSegment =
                urlTranslations?.get(`${language}:regions`) || 'regions';
              const genresSegment =
                urlTranslations?.get(`${language}:genres`) || 'genres';
              if (Array.isArray(xl.topCountries) && xl.topCountries.length > 0) {
                const heading = this.escapeHtml(
                  getLocalizedText(
                    'top_countries_for_genre',
                    'Top countries broadcasting this genre',
                  ),
                );
                sections.push(`
            <section class="related-genres related-genres--countries">
              <h2>${heading}</h2>
              <ul>${xl.topCountries
                .map((c: any) => {
                  const cslug = String(c?.slug || '').trim();
                  const region = String(c?.region || '').trim();
                  const cname = String(c?.country || '').trim();
                  if (!cslug || !region || !cname) return '';
                  return `<li><a href="${langPrefix}/${regionsSegment}/${this.escapeHtml(region)}/${this.escapeHtml(cslug)}">${this.escapeHtml(getLocalizedCountryName(cname, language))}</a></li>`;
                })
                .join('')}</ul>
            </section>`);
              }
              if (Array.isArray(xl.relatedGenres) && xl.relatedGenres.length > 0) {
                const heading = this.escapeHtml(
                  getLocalizedText('related_genres', 'Related radio genres'),
                );
                sections.push(`
            <section class="related-genres related-genres--genres">
              <h2>${heading}</h2>
              <ul>${xl.relatedGenres
                .map((g: string) => {
                  const label = String(g)
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, (l) => l.toUpperCase());
                  return `<li><a href="${langPrefix}/${genresSegment}/${this.escapeHtml(g)}">${this.escapeHtml(label)}</a></li>`;
                })
                .join('')}</ul>
            </section>`);
              }
              return sections.join('\n');
            })()}
            ${genreName ? `
            <section class="genre-faq">
              <h2>${this.escapeHtml(getLocalizedText('faq_section_title', 'Frequently Asked Questions'))}</h2>
              <dl>
                <dt>${this.escapeHtml(getLocalizedText('faq_q_genre_listen', 'How do I listen to {GENRE} radio stations?').replace(/\{GENRE\}/g, genreName))}</dt>
                <dd>${this.escapeHtml(getLocalizedText('faq_a_genre_listen', 'Select any {GENRE} station from the list above to start streaming instantly. No download or account required — just click and listen for free on any device.').replace(/\{GENRE\}/g, genreName))}</dd>
                <dt>${this.escapeHtml(getLocalizedText('faq_q_genre_free', 'Are {GENRE} radio stations free?').replace(/\{GENRE\}/g, genreName))}</dt>
                <dd>${this.escapeHtml(getLocalizedText('faq_a_genre_free', 'Yes. All radio stations on Mega Radio, including {GENRE} stations, are completely free to listen to with no subscription or registration required.').replace(/\{GENRE\}/g, genreName))}</dd>
              </dl>
            </section>` : ''}
            <nav>
              <ul>
                <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:genres`) || 'genres'}">${this.escapeHtml(getLocalizedText('nav_genres', 'All Radio Genres'))}</a></li>
                <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:stations`) || 'stations'}">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:regions`) || 'regions'}">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio by Country'))}</a></li>
                <li><a href="${langPrefix}">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      case 'regions':
        {
          const regionName = additionalData?.regionName || additionalData?.country || additionalData?.region || '';
          const langPrefix = `/${language}`;
          if (!regionName) {
            const hub = buildDirectoryIndexSeo('regions', language, translations);
            content = `<main lang="${this.escapeHtml(language)}" dir="${language === 'ar' || language === 'he' ? 'rtl' : 'ltr'}">
              <h1>${this.escapeHtml(h1Text)}</h1>
              <p>${this.escapeHtml(hub.description)}</p>
              ${(additionalData?.directoryRegions || []).map((region: { slug: string; name: string; countries: Array<{ slug: string; name: string }> }) => {
                const regionPath = buildLocalizedUrl(`/regions/${region.slug}`, language, undefined, urlTranslations || new Map());
                return `<section><h2><a href="${this.escapeHtml(regionPath)}">${this.escapeHtml(getLocalizedRegionName(region.name, language))}</a></h2>
                  <ul>${region.countries.map(country => {
                    const countryPath = buildLocalizedUrl(`/regions/${region.slug}/${country.slug}`, language, undefined, urlTranslations || new Map());
                    return `<li><a href="${this.escapeHtml(countryPath)}">${this.escapeHtml(getLocalizedCountryName(country.name, language))}</a></li>`;
                  }).join('')}</ul></section>`;
              }).join('')}
            </main>`;
            break;
          }
          if (additionalData?.continentDirectory) {
            const directory = additionalData.continentDirectory as { slug: string; name: string; countries: Array<{ slug: string; name: string }> };
            const regionSeo = buildRegionSeo(directory.name, language, translations);
            const allRegions = buildLocalizedUrl('/regions', language, undefined, urlTranslations || new Map());
            content = `<main lang="${this.escapeHtml(language)}" dir="${language === 'ar' || language === 'he' ? 'rtl' : 'ltr'}">
              <h1>${this.escapeHtml(h1Text)}</h1>
              <p>${this.escapeHtml(regionSeo.bodyIntro)}</p>
              <ul class="country-directory">${directory.countries.map(country => {
                const path = buildLocalizedUrl(`/regions/${directory.slug}/${country.slug}`, language, undefined, urlTranslations || new Map());
                return `<li><a href="${this.escapeHtml(path)}">${this.escapeHtml(getLocalizedCountryName(country.name, language))}</a></li>`;
              }).join('')}</ul>
              <nav><a href="${this.escapeHtml(allRegions)}">${this.escapeHtml(buildDirectoryIndexSeo('regions', language, translations).h1)}</a></nav>
            </main>`;
            break;
          }
          const cc = additionalData?.countryCode;
          const flagSrc = cc && /^[a-z]{2}$/i.test(cc) ? `https://flagcdn.com/w320/${cc.toLowerCase()}.png` : '';
          const flagCountry = additionalData?.countryName ? getLocalizedCountryName(additionalData.countryName, language) : regionName;
          // Multilingual body intro/availability — see shared/region-seo-templates.ts.
          // Without this every language reused the same English fallback fragments.
          const locationName = additionalData?.cityName && additionalData.cityName !== 'ALL'
            ? `${additionalData.cityName}, ${getLocalizedCountryName(additionalData.countryName, language)}` : regionName;
          const regionSeo = regionName
            ? (additionalData?.country
                ? buildCountrySeo(locationName, language, translations)
                : buildRegionSeo(regionName, language, translations))
            : null;
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            ${flagSrc ? `
            <!-- DALGA 2 W2.2: Country flag — SEO image surface -->
            <figure class="country-flag">
              <img src="${flagSrc}" alt="${this.escapeHtml(flagCountry)} ${this.escapeHtml(getLocalizedText('country_flag', LOCALIZED_FLAG_WORD[language] || 'flag'))}" width="320" height="213" loading="eager" decoding="async">
              <figcaption>${this.escapeHtml(flagCountry)}</figcaption>
            </figure>
            ` : ''}
            ${regionSeo ? `
            <section>
              <p>${this.escapeHtml(regionSeo.bodyIntro)}</p>
              <p>${this.escapeHtml(regionSeo.bodyAvailability)}</p>
            </section>` : ''}
            ${additionalData?.popularStations && additionalData.popularStations.length > 0 ? `
            <!-- DALGA 2 W2.2: Top stations from this country — SEO image surface -->
            <section class="popular-stations">
              <h2>${this.escapeHtml(getLocalizedText('popular_stations', 'Popular Radio Stations'))}</h2>
              <ul class="popular-stations-list">
                ${additionalData.popularStations.map((station: any) => {
                  const slug = station.slug || station._id;
                  const stationSegment = urlTranslations?.get(`${language}:station`) || 'station';
                  const stationUrl = `/${language}/${stationSegment}/${slug}`;
                  const logo = this.pickLogoUrl(station);
                  const stationName = this.escapeHtml(station.name || 'Radio Station');
                  const altText = this.escapeHtml(getStationImageAlt(station, language, getLocalizedText));
                  // Orphan-link fix (2026-07-01): previously `if (!logo) return ''`
                  // silently dropped every logo-less station from the country
                  // page — so those stations got ZERO internal in-links ("no
                  // referring page" → Crawled-not-indexed). Always emit the
                  // crawlable <a>; the logo <img> is optional (matches the genre
                  // grid). Long-tail stations without a logo now get a link too.
                  return `
                    <li>
                      <a href="${stationUrl}">
                        ${logo ? `<img src="${this.escapeHtml(logo)}" alt="${altText}" width="256" height="256" loading="lazy" decoding="async">` : ''}
                        <h3>${stationName}</h3>
                      </a>
                    </li>`;
                }).join('')}
              </ul>
            </section>
            ` : ''}
            ${(() => {
              // ---- Full crawlable country catalogue + pagination ---------
              // Every station has a country, so paginating the SWR-cached
              // per-country list here (60/page, ≤50 pages) gives the entire
              // long tail an internal in-link — the fix for "no referring
              // page → Crawled-not-indexed" on deep stations. Data is set in
              // the region fetch above via getCountryStationsByName (cache
              // read, no per-request deep-skip DB query). Mirrors /stations.
              const cats = (additionalData?.catalogStations as any[] | undefined) || [];
              if (!cats.length) return '';
              const curPage = (additionalData?.catalogPage as number) || 1;
              const totalPages = (additionalData?.catalogTotalPages as number) || 1;
              // Strip any existing query (the canonical already carries
              // ?page=N on pages >1) so pagination hrefs never double up to
              // "...?page=2?page=3".
              const base = ((seoTags?.canonical && /^https?:\/\//i.test(seoTags.canonical))
                ? seoTags.canonical
                : buildLocalizedUrl(cleanPath || '/regions', language, undefined, urlTranslations)
              ).split('?')[0];
              return `
            <section class="all-stations">
              <h2>${this.escapeHtml(getLocalizedText('all_stations', LOCALIZED_RADIO_STATIONS[language] || 'Radio Stations'))}</h2>
              <ul class="popular-stations-list">
                ${cats.map((station: any) => {
                  const slug = station.slug || station._id;
                  const stationUrl = buildLocalizedUrl(`/station/${slug}`, language, undefined, urlTranslations);
                  const logo = this.pickLogoUrl(station);
                  const stationName = this.escapeHtml(station.name || 'Radio Station');
                  const altText = this.escapeHtml(getStationImageAlt(station, language, getLocalizedText));
                  return `
                    <li>
                      <a href="${stationUrl}">
                        ${logo ? `<img src="${this.escapeHtml(logo)}" alt="${altText}" width="256" height="256" loading="lazy" decoding="async">` : ''}
                        <h3>${stationName}</h3>
                      </a>
                    </li>`;
                }).join('')}
              </ul>
              ${totalPages > 1 ? `
              <nav class="pagination" aria-label="${this.escapeHtml(getLocalizedText('pagination', 'Pagination'))}">
                <ul>
                  ${seoCatalogPageLinks(curPage, totalPages).map((n) => {
                    if (n === curPage) return `<li><span aria-current="page">${n}</span></li>`;
                    const href = n === 1 ? base : `${base}?page=${n}`;
                    const rel = n === curPage - 1 ? ' rel="prev"' : n === curPage + 1 ? ' rel="next"' : '';
                    return `<li><a href="${href}"${rel}>${n}</a></li>`;
                  }).join('')}
                </ul>
              </nav>` : ''}
            </section>`;
            })()}
            ${(() => {
              // ---- Cross-link sections (architect P1: B3) ----------------
              // "Popular genres in <country>" links to genre pages so
              // crawlers walk country → genre, and "Other countries in
              // <continent>" links to sibling country pages within the
              // same world region (data from COUNTRY_TO_REGION_SLUG).
              // Skipped on noindex pages (architect P1 review fix).
              if (seoTags?.noIndex === true) return '';
              const xl = (additionalData as any)?.crossLinks;
              if (!xl) return '';
              const sections: string[] = [];
              const regionsSegment =
                urlTranslations?.get(`${language}:regions`) || 'regions';
              const genresSegment =
                urlTranslations?.get(`${language}:genres`) || 'genres';
              if (Array.isArray(xl.topGenres) && xl.topGenres.length > 0) {
                const heading = regionName
                  ? `${this.escapeHtml(getLocalizedText('popular_genres_in', 'Popular radio genres in'))} ${this.escapeHtml(regionName)}`
                  : this.escapeHtml(getLocalizedText('popular_genres', 'Popular radio genres'));
                sections.push(`
            <section class="related-regions related-regions--genres">
              <h2>${heading}</h2>
              <ul>${xl.topGenres
                .map((g: any) => {
                  const slug = String(g?.slug || '').trim();
                  if (!slug) return '';
                  const label = slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
                  return `<li><a href="${langPrefix}/${genresSegment}/${this.escapeHtml(slug)}">${this.escapeHtml(label)}</a></li>`;
                })
                .join('')}</ul>
            </section>`);
              }
              if (Array.isArray(xl.neighbours) && xl.neighbours.length > 0) {
                const heading = this.escapeHtml(
                  getLocalizedText('other_countries_region', 'Other countries in this region'),
                );
                sections.push(`
            <section class="related-regions related-regions--neighbours">
              <h2>${heading}</h2>
              <ul>${xl.neighbours
                .map((n: any) => {
                  const slug = String(n?.slug || '').trim();
                  const name = String(n?.name || '').trim();
                  const region = String(n?.region || xl.regionSlug || '').trim();
                  if (!slug || !name || !region) return '';
                  return `<li><a href="${langPrefix}/${regionsSegment}/${this.escapeHtml(region)}/${this.escapeHtml(slug)}">${this.escapeHtml(getLocalizedCountryName(name, language))}</a></li>`;
                })
                .join('')}</ul>
            </section>`);
              }
              return sections.join('\n');
            })()}
            <nav>
              <ul>
                <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:regions`) || 'regions'}">${this.escapeHtml(getLocalizedText('nav_regions', 'All Regions'))}</a></li>
                <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:stations`) || 'stations'}">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:genres`) || 'genres'}">${this.escapeHtml(getLocalizedText('nav_genres', 'Radio Genres'))}</a></li>
                <li><a href="${langPrefix}">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      case 'terms':
      case 'privacy':
        content = renderLegalPageHtml(pageType, language);
        break;

      case 'search':
        {
          const langPrefix = `/${language}`;
          const searchSeo = buildSearchSeo(language, translations);
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            <section class="search-intro">
              <p>${this.escapeHtml(searchSeo.bodyIntro)}</p>
              <p>${this.escapeHtml(getLocalizedText('search_how_to', 'Type a station name, genre, city, or country into the search box to find matching radio stations from our library of 60,000+ stations worldwide. Results update instantly as you type.'))}</p>
            </section>
            <section class="search-tips">
              <h2>${this.escapeHtml(getLocalizedText('search_tips_title', 'Search Tips'))}</h2>
              <ul>
                <li>${this.escapeHtml(getLocalizedText('search_tip_name', 'Search by station name — for example "BBC Radio 1" or "RFI".'))}</li>
                <li>${this.escapeHtml(getLocalizedText('search_tip_genre', 'Search by genre — for example "jazz", "classical", or "hip-hop".'))}</li>
                <li>${this.escapeHtml(getLocalizedText('search_tip_country', 'Search by country or city — for example "Germany" or "Istanbul".'))}</li>
                <li>${this.escapeHtml(getLocalizedText('search_tip_language', 'Search in your own language — station names and genres are available in dozens of languages.'))}</li>
              </ul>
            </section>
            <section class="search-browse">
              <h2>${this.escapeHtml(getLocalizedText('search_browse_title', 'Browse Without Searching'))}</h2>
              <p>${this.escapeHtml(getLocalizedText('search_browse_intro', 'Not sure what to search for? Browse our curated categories to discover great radio stations.'))}</p>
              <nav>
                <ul>
                  <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:genres`) || 'genres'}">${this.escapeHtml(getLocalizedText('nav_genres', 'Browse Radio Genres'))}</a></li>
                  <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:regions`) || 'regions'}">${this.escapeHtml(getLocalizedText('nav_regions', 'Radio by Country'))}</a></li>
                  <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:stations`) || 'stations'}">${this.escapeHtml(getLocalizedText('nav_stations', 'All Stations'))}</a></li>
                  <li><a href="${langPrefix}">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
                </ul>
              </nav>
            </section>
          </main>
        `;
        }
        break;

      case 'faq':
        {
          const langPrefix = `/${language}`;
          const copy = resolveFaqPageText(language, translations);
          const localizedPath = (segment: string) => `${langPrefix}/${urlTranslations?.get(`${language}:${segment}`) || URL_TRANSLATIONS[language]?.[segment] || segment}`;
          // Task #129: render every FAQ Q&A server-side as <h2>+<p> so
          // Googlebot sees the exact text referenced by the FAQPage JSON-LD
          // on first fetch (no schema/visible-content mismatch).
          const faqBlocks = resolveFaqPageItems(language, getLocalizedText).map((item) => `
              <section id="${item.id}">
                <h2>${this.escapeHtml(item.question)}</h2>
                <p>${this.escapeHtml(item.answer)}</p>
              </section>`).join('');
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            <section>
              <p>${this.escapeHtml(copy.intro)}</p>
            </section>${faqBlocks}
            <section>
              <h2>${this.escapeHtml(copy.helpTitle)}</h2>
              <p>${this.escapeHtml(copy.helpText)}</p>
            </section>
            <nav>
              <ul>
                <li><a href="${langPrefix}">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
                <li><a href="${localizedPath('about')}">${this.escapeHtml(getLocalizedText('nav_about', copy.about))}</a></li>
                <li><a href="${localizedPath('contact')}">${this.escapeHtml(getLocalizedText('nav_contact', copy.contact))}</a></li>
                <li><a href="${localizedPath('search')}">${this.escapeHtml(getLocalizedText('nav_search', copy.search))}</a></li>
                <li><a href="${localizedPath('stations')}">${this.escapeHtml(copy.stations)}</a></li>
                <li><a href="${localizedPath('genres')}">${this.escapeHtml(copy.genres)}</a></li>
                <li><a href="${localizedPath('regions')}">${this.escapeHtml(copy.regions)}</a></li>
                <li><a href="${localizedPath('applications')}">${this.escapeHtml(copy.applications)}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      case 'about':
      case 'contact':
      case 'applications':
        content = renderStaticInformationBody(pageType, language, translations);
        break;

      case 'users':
        {
          const langPrefix = `/${language}`;
          content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            <section class="users-intro">
              <p>${this.escapeHtml(getLocalizedText('users_page_intro', 'Join the Mega Radio community. Discover what other listeners are tuning in to, share your favourite radio stations, and explore personalised recommendations from 60,000+ live stations worldwide.'))}</p>
              <p>${this.escapeHtml(getLocalizedText('users_page_features', 'Create a free account to save your favourite stations, follow other listeners, and get personalised radio suggestions based on your listening history. All community features are available at no cost.'))}</p>
            </section>
            <nav>
              <ul>
                <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:stations`) || 'stations'}">${this.escapeHtml(getLocalizedText('nav_stations', 'Browse Stations'))}</a></li>
                <li><a href="${langPrefix}/${urlTranslations?.get(`${language}:genres`) || 'genres'}">${this.escapeHtml(getLocalizedText('nav_genres', 'Radio Genres'))}</a></li>
                <li><a href="${langPrefix}/recommendations">${this.escapeHtml(getLocalizedText('nav_for_you', 'For You'))}</a></li>
                <li><a href="${langPrefix}">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      case 'trending':
      case 'recommendations':
        content = `
          <main>
            <h1>${this.escapeHtml(h1Text)}</h1>
            <p>${this.escapeHtml(seoTags?.description || '')}</p>
            <ul class="popular-stations-list">
              ${(additionalData?.popularStations || []).map((station: any) => {
                const href = buildStationLinkUrl(station, language, undefined, urlTranslations);
                return `<li><a href="${this.escapeHtml(href)}">${this.escapeHtml(station.name || '')}</a></li>`;
              }).join('')}
            </ul>
          </main>`;
        break;

      case 'stations':
        {
          // Crawlable catalog hub (Component (a)). All localized URLs go through
          // buildLocalizedUrl so the in-page links match the canonical/hreflang
          // exactly (URL_TRANSLATIONS-localized segments + station-slug skip).
          const cats = (additionalData?.catalogStations as any[] | undefined) || [];
          const curPage = (additionalData?.catalogPage as number) || 1;
          const totalPages = (additionalData?.catalogTotalPages as number) || 1;
          const stationsBase = buildLocalizedUrl('/stations', language, undefined, urlTranslations);
          const genresHref = buildLocalizedUrl('/genres', language, undefined, urlTranslations);
          // A-Z index (Task #11): letter pages get a letter-suffixed H1 and
          // paginate under their own base URL; the hub and every letter page
          // render the same 27-link A-Z rail so crawlers reach the full
          // catalogue from any of them.
          const azLetterKey = (additionalData?.azLetter as string | undefined) || '';
          const azH1 = azLetterKey
            ? `${h1Text || 'Radio Stations'} — ${azDisplayLabel(azLetterKey)}`
            : (h1Text || 'Radio Stations');
          const paginationBase = azLetterKey
            ? buildLocalizedUrl(`/stations/${azLetterKey}`, language, undefined, urlTranslations)
            : stationsBase;
          const azNav = `
            <nav class="az-index" aria-label="${this.escapeHtml(getLocalizedText('stations_az_nav', 'Radio stations A to Z'))}">
              <ul>
                ${AZ_INDEX_KEYS.map((k) => {
                  const label = this.escapeHtml(azDisplayLabel(k));
                  if (k === azLetterKey) return `<li><span aria-current="page">${label}</span></li>`;
                  const href = buildLocalizedUrl(`/stations/${k}`, language, undefined, urlTranslations);
                  return `<li><a href="${href}">${label}</a></li>`;
                }).join('')}
              </ul>
            </nav>`;
          content = `
          <main>
            <h1>${this.escapeHtml(azH1)}</h1>
            ${azNav}
            ${cats.length > 0 ? `
            <section class="popular-stations">
              <h2>${this.escapeHtml(getLocalizedText('all_stations', LOCALIZED_RADIO_STATIONS[language] || 'Radio Stations'))}</h2>
              <ul class="popular-stations-list">
                ${cats.map((station: any) => {
                  const stationUrl = buildStationLinkUrl(station, language, additionalData?.stationLinkLanguages, urlTranslations);
                  const logo = this.pickLogoUrl(station);
                  const stationName = this.escapeHtml(station.name || 'Radio Station');
                  const altText = this.escapeHtml(getStationImageAlt(station, language, getLocalizedText));
                  return `
                    <li>
                      <a href="${stationUrl}">
                        ${logo ? `<img src="${this.escapeHtml(logo)}" alt="${altText}" width="256" height="256" loading="lazy" decoding="async">` : ''}
                        <h3>${stationName}</h3>
                      </a>
                    </li>`;
                }).join('')}
              </ul>
            </section>
            ${totalPages > 1 ? `
            <nav class="pagination" aria-label="${this.escapeHtml(getLocalizedText('pagination', 'Pagination'))}">
              <ul>
                ${seoCatalogPageLinks(curPage, totalPages).map((n) => {
                  if (n === curPage) {
                    return `<li><span aria-current="page">${n}</span></li>`;
                  }
                  const href = n === 1 ? paginationBase : `${paginationBase}?page=${n}`;
                  const rel = n === curPage - 1 ? ' rel="prev"' : n === curPage + 1 ? ' rel="next"' : '';
                  return `<li><a href="${href}"${rel}>${n}</a></li>`;
                }).join('')}
              </ul>
            </nav>` : ''}
            ` : ''}
            <nav>
              <ul>
                <li><a href="${genresHref}">${this.escapeHtml(getLocalizedText('nav_genres', 'Radio Genres'))}</a></li>
                <li><a href="/${language}">${this.escapeHtml(getLocalizedText('nav_home', 'Home'))}</a></li>
              </ul>
            </nav>
          </main>
        `;
        }
        break;

      default:
        {
          // Safety net: never emit empty <h1>. If h1Text is somehow blank, fall back to brand H1.
          const safeH1 = (h1Text && h1Text.trim()) ? h1Text : 'Mega Radio: Free Live Radio from 120+ Countries';
          content = `
          <main>
            <h1>${this.escapeHtml(safeH1)}</h1>
          </main>
        `;
        }
        break;
    }

    return breadcrumbHtml + content;
  }

  // One schema builder for both the initial HTML and in-app navigation.
  // The two scopes allow the client to replace page entities without deleting
  // the shared organization/site entities or third-party JSON-LD.
  generateStructuredData(seoTags: any, language: string = 'en', translations: Record<string, string> = {}, cleanPath: string = '', stationData?: any, urlTranslations?: Map<string, string>, additionalData?: any): { global: any[]; page: any[] } {
    // Get base domain for structured data
    const baseDomain = seoTags.canonical ? new URL(seoTags.canonical).origin : 'https://themegaradio.com';
    
    // Helper to get localized text
    const getLocalizedText = (key: string, fallback: string): string => {
      return translations[key] || fallback;
    };

    // One locale-aware builder avoids SSR/client discrepancies and English
    // fallback prose. Identity and schema vocabulary stay stable across locales.
    const schemaDomain = new URL(baseDomain).host;
    // An article's BCP47 tag need not be a routable site locale (zh-Hant-HK).
    const schemaLanguage = additionalData?.blog?.locale || language;
    const websiteSchema = generateWebSiteSchema(schemaDomain, schemaLanguage, translations);
    const organizationSchema = generateOrganizationSchema(schemaDomain, schemaLanguage, translations);
    const visionGoOrgSchema = generateDeveloperOrganizationSchema(schemaLanguage);
    if (additionalData?.blog) return {
      global: [websiteSchema, organizationSchema, visionGoOrgSchema],
      page: buildBlogSchema(additionalData.blog),
    };

    // LOCALIZED: BreadcrumbList with proper translated paths.
    // Items come from the shared `computeBreadcrumbItems` helper so the
    // JSON-LD here and the visible `<nav class="breadcrumb">` rendered in
    // `generateHtmlBody` always reference the same names + paths
    // (Task #280 — visible-content guard for BreadcrumbList).
    let breadcrumbSchema: any = null;
    if (additionalData?.pageType !== 'home') {
      const breadcrumbItems = this.computeBreadcrumbItems(
        language,
        cleanPath,
        urlTranslations,
        stationData,
        getLocalizedText,
      );
      if (breadcrumbItems.length > 0) {
        breadcrumbSchema = {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": breadcrumbItems.map((it, idx) => ({
            "@type": "ListItem",
            "position": idx + 1,
            "name": it.name,
            "item": baseDomain + it.path,
          })),
        };
      }
    }

    // Only the dedicated FAQ route renders these Q&A in the React interface.
    // Home/genre SSR-only Q&A disappear on mount, so marking them as visible
    // FAQs in persistent JSON-LD would misrepresent the rendered page.
    let faqPageSchema: any = null;
    if (additionalData?.pageType === 'faq') {
      const faqUrl = seoTags.canonical || `${baseDomain}/${language}/faq`;
      faqPageSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "@id": `${faqUrl}#faq`,
        "url": faqUrl,
        "inLanguage": language,
        "mainEntity": resolveFaqPageItems(language, getLocalizedText).map((item) => ({
          "@type": "Question",
          "@id": `${faqUrl}#${item.id}`,
          "url": `${faqUrl}#${item.id}`,
          "name": item.question,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": item.answer,
          },
        })),
      };
    }

    // ItemList Schema for popular stations on homepage
    // Prefix-all canonical + localized station segment for ALL languages (DALGA 2 W2.3 fix)
    let popularStationsSchema: any = null;
    if (additionalData?.popularStations && additionalData.popularStations.length > 0) {
      const stationSegmentForJsonLd = urlTranslations?.get(`${language}:station`) || 'station';
      const stationItems = additionalData.popularStations.map((station: any, index: number) => {
        const stationUrl = additionalData.pageType === 'stations' && isStationDirectoryPath(cleanPath)
          ? `${baseDomain}${buildStationLinkUrl(station, language, additionalData?.stationLinkLanguages, urlTranslations)}`
          : `${baseDomain}/${language}/${stationSegmentForJsonLd}/${station.slug || station._id}`;
        // SEO audit 2026-06, Finding C1: only emit a verified absolute image;
        // omit `image` rather than ship the shared `default-station.png`
        // placeholder (or a relative local-disk filename) to Google.
        const stationLogoRaw =
          station.logoAssets?.webp256 || station.logoAssets?.webp96 || station.favicon || '';
        const ownedLogo = normalizePublicStationLogoUrl(stationLogoRaw);
        const stationLogo = /^https?:\/\//i.test(stationLogoRaw)
          ? (ownedLogo.startsWith('/station-logos/') ? `${baseDomain}${ownedLogo}` : stationLogoRaw) : null;
        const rawTags: any = station.tags;
        const stationGenres: string[] = (Array.isArray(rawTags)
          ? rawTags
          : (typeof rawTags === 'string' ? rawTags.split(',') : [])
        ).map((t: any) => String(t).trim()).filter(Boolean).slice(0, 3);
        const schemaCountry = getSchemaCountry(station, language);
        // 2026-05-12 SEO audit: each ItemList child also flipped from
        // RadioStation → RadioBroadcastService for the same reason as the
        // top-level station schema. `address` removed (not on Service);
        // `genre` replaced with Service.category (default ["Music"]) so the
        // taxonomy field is always populated.
        const childKeywords: string[] = stationGenres.length > 0 ? stationGenres : ["Music"];
        return {
          "@type": "ListItem",
          "position": index + 1,
          "item": {
            "@type": "RadioBroadcastService",
            "@id": stationUrl,
            "name": station.name,
            "url": stationUrl,
            ...(stationLogo && { "image": stationLogo }),
            "broadcaster": {
              "@type": "Organization",
              "name": station.name,
            },
            ...(schemaCountry && {
              "areaServed": schemaCountry.name,
            }),
            "category": childKeywords,
          },
        };
      });

      popularStationsSchema = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": getLocalizedText('popular_stations', 'Popular Radio Stations'),
        "description": getLocalizedText('faq_seo_intro', 'Discover the most popular radio stations on Mega Radio'),
        "numberOfItems": stationItems.length,
        "itemListElement": stationItems
      };
    }

    if (cleanPath === '/genres' && additionalData?.directoryGenres?.length > 0 && seoTags?.noIndex !== true) {
      const genresPath = buildLocalizedUrl('/genres', language, undefined, urlTranslations || new Map());
      popularStationsSchema = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: buildDirectoryIndexSeo('genres', language, translations).h1,
        numberOfItems: additionalData.directoryGenres.length,
        itemListElement: additionalData.directoryGenres.map((genre: { slug: string; name: string }, index: number) => ({
          '@type': 'ListItem', position: index + 1, name: genre.name,
          url: `${baseDomain}${genresPath}/${encodeURIComponent(genre.slug)}`,
        })),
      };
    }

    // ---- CollectionPage schema (architect P1: A3) ----------------------
    // For listing-style pages (genres / regions / stations) wrap the
    // existing ItemList inside a CollectionPage so Google understands
    // these URLs as curated lists of entities (better surface for
    // sitelinks + AI overview citations) rather than generic article
    // pages. Skipped on noindex'd listings — emitting structured data
    // for a page we tell Google not to index is wasted markup.
    // Derive pageType from cleanPath (generateHtmlHead doesn't receive it
    // as a parameter; cleanPath is the canonical post-language strip).
    const collectionPageType: 'genres' | 'regions' | 'country' | 'stations' | null =
      cleanPath === '/genres' || cleanPath.startsWith('/genres/')
        ? 'genres'
        : cleanPath === '/regions' || cleanPath.startsWith('/regions/')
        ? 'regions'
        // /country/<x> is the same logical page as /regions/<continent>/<country>
        // (both render pageType='regions' + an ItemList of popular stations), so
        // emit the same CollectionPage>ItemList wrapper for structured-data
        // parity between the two URL shapes. See SEO re-audit 2026-06-20, Item 1.
        : cleanPath === '/country' || cleanPath.startsWith('/country/')
        ? 'country'
        : cleanPath === '/stations' || cleanPath.startsWith('/stations/')
        ? 'stations'
        : null;
    let collectionPageSchema: any = null;
    if (
      popularStationsSchema &&
      collectionPageType &&
      seoTags?.noIndex !== true
    ) {
      const canonicalUrl = seoTags?.canonical || `${baseDomain}${cleanPath}`;
      collectionPageSchema = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${canonicalUrl}#collection`,
        "url": canonicalUrl,
        "name": seoTags?.title || 'Mega Radio',
        "description":
          seoTags?.description ||
          getLocalizedText('faq_seo_intro', 'Discover radio stations on Mega Radio'),
        "inLanguage": language,
        "isPartOf": { "@id": `${baseDomain}/#website` },
        "mainEntity": popularStationsSchema,
      };
    }

    // RadioStation Schema for individual station pages
    // Prefix-all canonical + localized station segment for ALL languages (DALGA 2 W2.3 fix)
    let radioStationSchema: any = null;
    // stationWebPageSchema — WebPage with SpeakableSpecification pointing at
    //    the SSR body's <h1> and .station-intro (voice-assistant / AI-answer
    //    surface). speakable is only valid on Article/WebPage, hence the
    //    separate entity.
    let stationWebPageSchema: any = null;
    if (stationData) {
      const stationSegmentForRadioJsonLd = urlTranslations?.get(`${language}:station`) || 'station';
      const stationUrl = `${baseDomain}/${language}/${stationSegmentForRadioJsonLd}/${stationData.slug || stationData._id}`;
      // SEO audit 2026-06, Finding C1: only treat an absolute (http) asset as a
      // real station image. Previously this fell back to a shared
      // `default-station.png` placeholder for the ~53.5% of stations with no
      // logo, which made Google index one generic placeholder as the
      // "official" image for tens of thousands of stations (or 404 if the
      // asset was missing). Local-disk mode also stores RELATIVE filenames in
      // logoAssets.webpNNN, so we additionally require an http(s) URL to avoid
      // emitting an invalid relative `image`/`logo`. When no verified image
      // exists we omit both properties (the image sitemap already does this).
      const stationLogoRaw =
        stationData.logoAssets?.webp256 ||
        stationData.logoAssets?.webp96 ||
        stationData.favicon ||
        '';
      const ownedLogo = normalizePublicStationLogoUrl(stationLogoRaw);
      const stationLogo = /^https?:\/\//i.test(stationLogoRaw)
        ? (ownedLogo.startsWith('/station-logos/') ? `${baseDomain}${ownedLogo}` : stationLogoRaw) : null;
      
      // Free-form tags cannot verify a broadcast frequency, even with numbers.

      // Task #372: source the schema description from the SAME copy the
      // visible station body renders (including legacy and English fallbacks)
      // so AI-rewritten / per-language strings can't drift into the JSON-LD
      // and trigger Google's "deceptive markup" warning. `aiDescription` is
      // intentionally NOT used here because the visible body never renders
      // it — see generateHtmlBody case 'station' (~line 1461).
      const schemaDescriptionSource = selectStationVisibleDescription(stationData, language, getStationCountryName(stationData, "en"));

      // 2026-05-12 SEO audit (138 invalid items): switched primary type
      // from RadioStation → RadioBroadcastService. RadioStation extends
      // LocalBusiness > Organization, and validators reject every
      // BroadcastService-only field on it (broadcaster, broadcast*,
      // inLanguage). RadioBroadcastService extends BroadcastService and
      // legitimizes them all. Removed: broadcastFormat (NOT in schema.org),
      // broadcastLanguage (NOT in schema.org), genre (NOT on Service).
      // Tags use Service.category; keywords is not defined on Service. Keep
      // ["Music"] default so we never ship empty/missing taxonomy.
      // Catalog geography is service coverage, not a physical address.
      const stationTagsForKeywords: string[] = (() => {
        const raw = Array.isArray(stationData.tags)
          ? stationData.tags
          : (typeof stationData.tags === 'string'
              ? String(stationData.tags).split(',')
              : []);
        return raw.map((t: any) => String(t).trim()).filter(Boolean);
      })();
      const stationKeywords: string[] = stationTagsForKeywords.length > 0
        ? stationTagsForKeywords.slice(0, 8)
        : ["Music"];

      const stationBroadcaster: any = {
        "@type": "Organization",
        "@id": `${stationUrl}#broadcaster`,
        "name": stationData.name,
        ...(stationData.homepage && { "url": stationData.homepage }),
      };
      const schemaCountry = getSchemaCountry(stationData, language);

      // Bitrate/codec remain in the visible station details. additionalProperty
      // is not defined on Service; do not invent an identifier or product for it.

      // Real listener ratings remain on the broadcast service. A catalogue
      // country does not verify a physical LocalBusiness or its address.
      // Denormalized onto the Station doc by POST /api/stations/:id/rate
      // (translation-admin-routes.ts → calculateStationRatingStats).
      const realRatingCount = Number((stationData as any).totalRatings || 0);
      const realRatingAvg = Number((stationData as any).averageRating || 0);
      const aggregateRatingSchema =
        realRatingCount >= 3 && realRatingAvg >= 1 && realRatingAvg <= 5
          ? {
              "@type": "AggregateRating",
              "ratingValue": Math.round(realRatingAvg * 10) / 10,
              "ratingCount": realRatingCount,
              "bestRating": 5,
              "worstRating": 1,
            }
          : null;

      const broadcastLanguages = getStationBroadcastLanguages(stationData);
      radioStationSchema = {
        "@context": "https://schema.org",
        "@type": "RadioBroadcastService",
        "@id": `${stationUrl}#radiostation`,
        "name": stationData.name,
        "broadcastDisplayName": stationData.name,
        "description": schemaDescriptionSource,
        "url": stationUrl,
        ...(stationLogo && { "logo": stationLogo, "image": stationLogo }),
        ...(stationData.homepage && { "sameAs": stationData.homepage }),
        ...(schemaCountry && {
          "areaServed": schemaCountry.name,
        }),
        "broadcaster": stationBroadcaster,
        "potentialAction": {
          "@type": "ListenAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": stationUrl,
            "actionPlatform": [
              "https://schema.org/DesktopWebPlatform",
              "https://schema.org/MobileWebPlatform",
              "https://schema.org/IOSPlatform",
              "https://schema.org/AndroidPlatform"
            ]
          }
        },
        "category": stationKeywords,
        // BroadcastService describes the actual stream. The translated page's
        // language belongs on WebPage below; unknown broadcast language is omitted.
        ...(broadcastLanguages && { "inLanguage": broadcastLanguages }),
        // Preserve genuine ratings without asserting rich-result eligibility.
        ...(aggregateRatingSchema && { "aggregateRating": aggregateRatingSchema }),
      };

      // Speakable WebPage (voice assistants / AI answers — radio.at parity).
      // cssSelector targets exist in the SSR body: the <h1> and the
      // .station-intro sentence rendered in generateHtmlBody case 'station'.
      if (!stationData.notFound) {
        stationWebPageSchema = {
          "@context": "https://schema.org",
          "@type": "WebPage",
          "@id": `${stationUrl}#webpage`,
          "name": stationData.name,
          "url": stationUrl,
          "inLanguage": language,
          "isAccessibleForFree": true,
          "speakable": {
            "@type": "SpeakableSpecification",
            "cssSelector": ["h1", ".station-intro"],
          },
          "mainEntity": { "@id": `${stationUrl}#radiostation` },
        };
      }
    }
    
    return {
      global: [websiteSchema, organizationSchema, visionGoOrgSchema],
      page: [
        breadcrumbSchema,
        faqPageSchema,
        ...(seoTags?.noIndex !== true ? [radioStationSchema, stationWebPageSchema, popularStationsSchema] : []),
        collectionPageSchema,
      ].filter(Boolean),
    };
  }

  private normalizeDescriptionTags(seoTags: any): any {
    const fallback = 'Mega Radio is your free online radio platform with 60,000+ live stations from 120+ countries.';
    const normalize = (raw: any): string => truncateAtWordBoundary(String(raw || '').trim() || fallback, 160);
    return {
      ...seoTags,
      description: normalize(seoTags.description),
      ogDescription: normalize(seoTags.ogDescription || seoTags.description),
      twitterDescription: normalize(seoTags.twitterDescription || seoTags.description),
    };
  }

  generateHtmlHead(seoTags: any, language: string = 'en', translations: Record<string, string> = {}, cleanPath: string = '', stationData?: any, urlTranslations?: Map<string, string>, additionalData?: any): string {
    const structuredData = this.generateStructuredData(seoTags, language, translations, cleanPath, stationData, urlTranslations, additionalData);
    let ogDomain = 'themegaradio.com';
    if (seoTags.domain) ogDomain = seoTags.domain.replace(/^https?:\/\//, '');
    let ogImage = seoTags.ogImage || `https://${ogDomain}/api/og-image`;
    if (stationData?.slug) ogImage = `https://${ogDomain}/api/og-image/${stationData.slug}`;
    const ogImageDimensions = getKnownOgImageDimensions(ogImage, `https://${ogDomain}`);
    const twitterImage = seoTags.twitterImage || ogImage;

    // SAFETY NET: cap descriptions at the same 160-character word boundary
    // used in page-data (including hydration). The legacy English padding tail
    // ("Listen free on Mega Radio — 60,000+ stations…") was REMOVED because
    // it bled English copy into non-English descriptions. Per-language
    // padding (when needed) is now done inside getStationMetaDescription
    // using that language's own translation map.
    const FINAL_TITLE_FALLBACK = 'Mega Radio: Free Live Radio from 120+ Countries';
    // Semrush 2026-05-13 audit: 444+ pages had <title> > 70 chars (mostly
    // station-detail pages whose country part renders as the verbose UN
    // long-form, e.g. "The United Kingdom Of Great Britain And Northern
    // Ireland" or "The United States Of America"). Cap every emitted
    // <title> / og:title / twitter:title at 70 characters with
    // word-boundary truncation. NOTE: this runs AFTER getH1Text() so
    // <h1> derivation (which uses the FULL untruncated title) is
    // unaffected — only the HTML emission is capped.
    const ensureTitleLength = normalizeSeoTitle;
    const descriptions = this.normalizeDescriptionTags(seoTags);
    // CRITICAL: every dynamic value below MUST go through escapeHtml() before
    // being interpolated into the HTML head — station names, descriptions,
    // OG image URLs, canonical/hreflang URLs and any other DB-sourced string
    // can legitimately contain `"`, `<`, `>` or `&` which would otherwise
    // break the head markup (HTML attribute boundaries) and constitute an
    // SSR XSS vector if user-controlled. Architect Semrush review 2026-05-13.
    const esc = (s: any) => this.escapeHtml(String(s ?? ''));
    // JSON-LD safe-stringify: escape `</` so a station name or description
    // containing the literal string "</script>" cannot break out of the
    // `<script type="application/ld+json">` element. Also escapes the
    // U+2028 / U+2029 line separators which are valid in JSON but invalid
    // bare in JavaScript source — defensive only, JSON-LD is parsed as
    // JSON not JS, but cheap to keep. See OWASP "JSON in HTML script
    // blocks" cheat sheet.
    const jsonLd = (v: any) => JSON.stringify(v, null, 2)
      .replace(/<\/(script)/gi, '<\\/$1')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    const safeTitle = esc(ensureTitleLength(seoTags.title, FINAL_TITLE_FALLBACK));
    const safeDescription = esc(descriptions.description);
    const safeOgTitle = esc(ensureTitleLength(seoTags.ogTitle, ensureTitleLength(seoTags.title, FINAL_TITLE_FALLBACK)));
    const safeOgDescription = esc(descriptions.ogDescription);
    const safeTwitterTitle = esc(ensureTitleLength(seoTags.twitterTitle, ensureTitleLength(seoTags.title, FINAL_TITLE_FALLBACK)));
    const safeTwitterDescription = esc(descriptions.twitterDescription);
    const safeOgType = esc(seoTags.ogType || 'website');
    const safeCanonical = esc(seoTags.canonical || '');
    const safeOgImage = esc(ogImage);
    const safeOgLocale = esc(seoTags.ogLocale || 'en_US');
    const safeTwitterImage = esc(twitterImage);
    const safeRobots = esc(seoTags.robots || 'index, follow');

    return `
    <title>${safeTitle}</title>
    ${additionalData?.blog ? '<link rel="stylesheet" href="/blog.css?v=20260925">' : ''}
    <meta name="description" content="${safeDescription}">
    <meta name="author" content="MegaRadio">
    
    <!-- Enhanced Open Graph tags -->
    <meta property="og:title" content="${safeOgTitle}">
    <meta property="og:description" content="${safeOgDescription}">
    <meta property="og:type" content="${safeOgType}">
    <meta property="og:url" content="${safeCanonical}">
    <meta property="og:image" content="${safeOgImage}">
    ${seoTags.ogImageAlt ? `<meta property="og:image:alt" content="${esc(seoTags.ogImageAlt)}">` : ''}
    ${seoTags.ogType === 'article' && seoTags.articlePublishedTime ? `<meta property="article:published_time" content="${esc(seoTags.articlePublishedTime)}">` : ''}
    ${seoTags.ogType === 'article' && seoTags.articleModifiedTime ? `<meta property="article:modified_time" content="${esc(seoTags.articleModifiedTime)}">` : ''}
    ${ogImageDimensions ? `<meta property="og:image:width" content="${ogImageDimensions.width}">\n    <meta property="og:image:height" content="${ogImageDimensions.height}">` : ''}
    <meta property="og:site_name" content="MegaRadio">
    <meta property="og:locale" content="${safeOgLocale}">
    ${(seoTags.ogLocaleAlternates || []).map((locale: string) => `<meta property="og:locale:alternate" content="${esc(locale)}">`).join('\n    ')}
    
    <!-- Enhanced Twitter Card tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTwitterTitle}">
    <meta name="twitter:description" content="${safeTwitterDescription}">
    <meta name="twitter:image" content="${safeTwitterImage}">
    ${seoTags.twitterImageAlt ? `<meta name="twitter:image:alt" content="${esc(seoTags.twitterImageAlt)}">` : ''}
    <meta name="twitter:site" content="@MegaRadio">
    <meta name="twitter:creator" content="@MegaRadio">
    
    <!-- Additional meta tags -->
    <meta name="robots" content="${safeRobots}">
    <meta name="theme-color" content="#1a1a2e">
    <meta name="msapplication-TileColor" content="#1a1a2e">
    
    ${seoTags.canonical ? `<link rel="canonical" href="${safeCanonical}" data-managed="seo-head">` : ''}
    ${seoTags.hreflangs ? seoTags.hreflangs.map((h: any) => `<link rel="alternate" hreflang="${esc(h.hreflang)}" href="${esc(h.url)}" data-managed="seo-head">`).join('\n    ') : ''}
    
    <!-- JSON-LD Structured Data for Rich Snippets -->
    ${structuredData.global.map(schema => `<script type="application/ld+json" data-managed="seo-structured-data" data-schema-scope="global">${jsonLd(schema)}</script>`).join('\n    ')}
    ${structuredData.page.map(schema => `<script type="application/ld+json" data-managed="seo-structured-data" data-schema-scope="page">${jsonLd(schema)}</script>`).join('\n    ')}`;
  }
}
