import { applyPublicStreamCors } from "./lib/public-stream-cors";
if (!process.env.FONTCONFIG_FILE || process.env.FONTCONFIG_FILE === '/dev/null') {
  process.env.FONTCONFIG_FILE = process.cwd() + '/fontconfig.conf';
}

import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import fs from "fs";
import path from "path";
import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import { createProxyMiddleware } from 'http-proxy-middleware';
import { forwardApiRequest } from './middleware/forward-api-request';
import { webRequestTimeout, WEB_API_PROXY_TIMEOUTS, sendWebApiProxyError } from './middleware/web-request-timeout';
import { publicImageProxyHeaders } from './middleware/public-image-headers';
import { createStationLogoDelivery } from './middleware/station-logo-delivery';
import { seedPostgresDefaultLanguages } from "./services/postgres-bootstrap";
import { closePostgres, initializePostgres, getPostgresHealth, postgresAvailable } from "./postgres-runtime";
import { performanceCache } from "./performance-cache";
import { CacheManager } from "./cache";
import { htmlLangMiddleware, precomputeTranslationScripts } from "./html-lang-middleware";
import { logger } from './utils/logger';
import { urlRedirectMiddleware } from './url-redirect-middleware';
import { stationCountryValidator } from './station-country-validator';
import { serveStatic, log, HTML_CACHE_CONTROL } from "./serve-static";
import { createAdminSpaHandler } from './admin-spa';
import { SeoRenderer, getSeoRenderStats } from './seo-renderer';
import { markSeoTemporarilyUnavailable } from './seo/temporary-unavailable';
import { capturePublicStationDeadline } from './utils/public-station-deadline';
import { parseSeoCatalogPage } from './seo/catalog-pagination';
import { sendSeoNotFound } from './seo/send-seo-not-found';
import { buildPublicSeoRouteMatchers, collectSeoTranslations, decodePublicSeoPath } from './seo/public-route-matchers';
import { buildPublicRoutePreloads } from './seo/frontend-asset-preloads';
import { renderStationBootstrap } from './seo/station-bootstrap';
import { renderTranslationBootstrap } from './seo/translation-bootstrap';
import { registerSeoSitemapRoutes } from './routes/seo-sitemap-routes';
import { registerLlmsTxtRoutes } from './seo/llms-txt-routes';
import { startOperation, endOperation, getActiveOperations, getGcStats } from './utils/operation-tracker';
import { requestGracefulRestart, requestedShutdownExitCode } from './utils/graceful-restart';
import { createWebShutdown, WEB_SHUTDOWN_TIMEOUT_MS } from './utils/web-shutdown';
import { COUNTRY_TO_LANGUAGE, SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';

import { geoBlockMiddleware } from './middleware/geo-block';
import { createVisitorActivityMiddleware } from './middleware/visitor-activity';
import { privateApiCachePolicy, setHealthCacheHeaders } from './middleware/cache-policy';

// Country-prefix duplicate canonical fix (Bing DALGA A)
// SEO_LANGUAGES'da OLMAYAN ama COUNTRY_TO_LANGUAGE'da bulunan 2-harf prefix'leri
// (ör. /ph, /us, /au, /ca, /gb, /nz) /<mapped-lang> hedefine 301 redirect.
// Aksi halde /ph içinde /en içeriği render olup self-canonical /ph kalıyor → Google
// "Duplicate without user-selected canonical" cezası.
const _seoLangCodes = new Set(SEO_LANGUAGES.filter(l => l.enabled).map(l => l.code));
const COUNTRY_PREFIX_REDIRECTS = new Map<string, string>();
for (const [country, lang] of Object.entries(COUNTRY_TO_LANGUAGE)) {
  if (!_seoLangCodes.has(country) && _seoLangCodes.has(lang)) {
    COUNTRY_PREFIX_REDIRECTS.set(country, lang);
  }
}

// Auth path noindex regex (Bing DALGA B1)
// Mevcut robots.txt Disallow varken Google "indexed though blocked" raporlayabiliyor.
// Sayfa fetch edilebilir olmalı + X-Robots-Tag noindex header dönmeli.
// Tüm auth varyantları kapsanır: /auth/*, login, signup, sign-in, sign-up, register,
// forgot-password, reset-password, change-password (her biri opsiyonel /<lang>/ prefix ile).
const AUTH_NOINDEX_PATH = /^(?:\/[a-z]{2})?\/(?:auth(?:\/.*)?|login|signup|sign-in|sign-up|register|forgot-password|reset-password|change-password)(?:\/|$)/i;

const app = express();
let startupReady = false;

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Geo-block FIRST — drop TCP connection from blocked countries (no response)
app.use(geoBlockMiddleware);
// Web serves SSR directly; qualified browser navigation is explicitly reported
// by the client. Only sampled known automation is observed here, never /api.
app.use(createVisitorActivityMiddleware(undefined, { botsOnly: true }));
app.use(['/api/admin', '/api/auth'], privateApiCachePolicy);

let uncaughtExitScheduled = false;
function scheduleFatalExit(label: string) {
  if (uncaughtExitScheduled) return;
  uncaughtExitScheduled = true;
  console.error(`🚨 ${label} — scheduling fail-fast exit in 1s for clean restart`);
  setTimeout(() => {
    requestGracefulRestart();
    setTimeout(() => process.exit(1), WEB_SHUTDOWN_TIMEOUT_MS).unref();
  }, 1000).unref();
}

process.on('uncaughtException', (err) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack?.split('\n').slice(0, 5).join('\n'));
  scheduleFatalExit('UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || reason || 'unknown';
  console.error('🚨 UNHANDLED REJECTION:', msg);
  if (reason?.stack) console.error(reason.stack.split('\n').slice(0, 5).join('\n'));
  scheduleFatalExit('UNHANDLED_REJECTION');
});

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:5000';
const STREAM_PROXY_URL = process.env.STREAM_PROXY_URL || process.env.VITE_STREAM_PROXY_URL || 'https://stream.themegaradio.com';

app.get('/healthz', (_req, res) => {
  setHealthCacheHeaders(res);
  res.status(200).type('text/plain').send('ok');
});
app.get('/readyz', async (_req,res) => {
  setHealthCacheHeaders(res);
  const postgres = await getPostgresHealth();
  const ready = startupReady && postgres.status === 'connected';
  res.status(ready ? 200 : 503).json({ ready,database:'postgresql',postgres:postgres.status });
});

// Public text guides must precede language redirects, static delivery and SSR.
registerLlmsTxtRoutes(app, { homeDiscovery: true });

app.get('/health', async (_req, res) => {
  setHealthCacheHeaders(res);
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const ssrStats = getSeoRenderStats();
  const cacheStats = performanceCache.getStats();
  res.status(200).json({
    status: 'ok',
    service: 'frontend-web',
    timestamp: new Date().toISOString(),
    memory: { heapUsed: `${heapMB}MB`, rss: `${rssMB}MB` },
    ssr: {
      activeRenders: ssrStats.active,
      maxConcurrent: 5,
      totalRejected: ssrStats.rejected,
      eventLoopLagMs: ssrStats.eventLoopLag
    },
    cache: {
      seoHtml: {
        keys: cacheStats.seoHtml.keys,
        hits: cacheStats.seoHtml.stats.hits,
        misses: cacheStats.seoHtml.stats.misses,
        hitRate: cacheStats.seoHtml.stats.hits + cacheStats.seoHtml.stats.misses > 0
          ? Math.round((cacheStats.seoHtml.stats.hits / (cacheStats.seoHtml.stats.hits + cacheStats.seoHtml.stats.misses)) * 10000) / 100
          : 0
      },
      pageData: {
        keys: cacheStats.pageData.keys,
        hits: cacheStats.pageData.stats.hits,
        misses: cacheStats.pageData.stats.misses,
        hitRate: cacheStats.pageData.stats.hits + cacheStats.pageData.stats.misses > 0
          ? Math.round((cacheStats.pageData.stats.hits / (cacheStats.pageData.stats.hits + cacheStats.pageData.stats.misses)) * 10000) / 100
          : 0
      }
    },
    uptime: Math.round(process.uptime()),
    backendUrl: BACKEND_API_URL
  });
});

function getFrameOptionsHeader(): string | null {
  if (process.env.CLICKJACKING_MITIGATION) return process.env.CLICKJACKING_MITIGATION;
  return 'DENY';
}

function getHstsHeader(): string {
  if (process.env.HSTS_MAX_AGE) {
    const maxAge = process.env.HSTS_MAX_AGE;
    const includeSubdomains = process.env.HSTS_INCLUDE_SUBDOMAINS !== 'false' ? '; includeSubDomains' : '';
    const preload = process.env.HSTS_PRELOAD === 'true' ? '; preload' : '';
    return `max-age=${maxAge}${includeSubdomains}${preload}`;
  }
  // Default to the year-long `production` preset in real production so we
  // never accidentally ship the lower `confident` (1 week) max-age to
  // crawlers/users when the env var is forgotten on a new deploy. Lower
  // environments still default to `confident` to avoid pinning a long
  // HSTS on a non-production host by accident.
  const hstsPhase =
    process.env.HSTS_PHASE ||
    (process.env.NODE_ENV === 'production' ? 'production' : 'confident');
  const hstsConfigs: Record<string, string> = {
    testing: 'max-age=60',
    initial: 'max-age=3600; includeSubDomains',
    confident: 'max-age=604800; includeSubDomains',
    production: 'max-age=31536000; includeSubDomains; preload'
  };
  return hstsConfigs[hstsPhase] || hstsConfigs.confident;
}

// 410 Gone for static assets removed during monorepo migration.
// Google may still know these URLs from earlier crawls. 410 describes their
// deliberate removal; Google treats 404 and 410 alike for indexing.
const GONE_ASSET_PATHS = new Set([
  '/images/heroleft-300w.webp',
  '/images/heroleft-500w.webp',
  '/images/heroleft.png',
  '/assets/fonts/ubuntu-400.ttf',
  '/assets/fonts/ubuntu-700.ttf',
  '/fonts/ubuntu-400.ttf',
  '/fonts/ubuntu-700.ttf',
]);
app.get('/*path', (req, res, next) => {
  if (GONE_ASSET_PATHS.has(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    res.status(410).end();
    return;
  }
  next();
});

// Country-prefix 301 redirect (Bing DALGA A) - run BEFORE everything else
app.use((req, res, next) => {
  const m = req.path.match(/^\/([a-z]{2})(\/.*)?$/i);
  if (m) {
    const prefix = m[1].toLowerCase();
    const target = COUNTRY_PREFIX_REDIRECTS.get(prefix);
    if (target) {
      const rest = m[2] || '';
      const qIdx = req.originalUrl.indexOf('?');
      const queryString = qIdx >= 0 ? req.originalUrl.substring(qIdx) : '';
      return void res.redirect(301, `/${target}${rest}${queryString}`);
    }
  }
  next();
});

app.use((req, res, next) => {
  res.removeHeader('X-Robots-Tag');
  // Auth pages (login/signup/forgot-password/...) -> noindex (Bing DALGA B1)
  if (AUTH_NOINDEX_PATH.test(req.path)) {
    res.header('X-Robots-Tag', 'noindex, follow');
  } else {
    res.header('X-Robots-Tag', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
  }

  res.header('X-Content-Type-Options', 'nosniff');
  // Vary on User-Agent (bot vs SPA SSR branch), Accept-Language (lang
  // detection), Accept-Encoding (gzip), and CF-IPCountry (geo) so CDN
  // caches don't poison cross-locale or cross-bot variants.
  res.header('Vary', 'Accept-Encoding, User-Agent, Accept-Language, CF-IPCountry');
  const frameOptions = getFrameOptionsHeader();
  if (frameOptions) res.header('X-Frame-Options', frameOptions);
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  if (process.env.NODE_ENV === 'production' || req.secure || req.get('x-forwarded-proto') === 'https') {
    res.header('Strict-Transport-Security', getHstsHeader());
  }

  if (req.path.startsWith('/cast-receiver')) {
    next();
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.clarity.ms https://scripts.clarity.ms https://analytics.ahrefs.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com https://pagead2.googlesyndication.com https://www.gstatic.com https://adservice.google.com https://tpc.googlesyndication.com https://*.adtrafficquality.google https://partner.googleadservices.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://securepubads.g.doubleclick.net https://fundingchoicesmessages.google.com https://consent.google.com https://www.google.com https://flowalive-sdk.s3.eu-central-1.amazonaws.com https://*.paddle.com https://public.profitwell.com",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://*.paddle.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "media-src 'self' https: blob:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https://pagead2.googlesyndication.com https://tpc.googlesyndication.com https://googleads.g.doubleclick.net https://www.google.com https://*.adtrafficquality.google https://securepubads.g.doubleclick.net https://fundingchoicesmessages.google.com https://consent.google.com https://*.paddle.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (isProduction) {
    cspDirectives.push("upgrade-insecure-requests");
    res.header('Content-Security-Policy', cspDirectives.join('; '));
  } else {
    res.header('Content-Security-Policy-Report-Only', cspDirectives.join('; '));
  }

  // Note: `Expect-CT` was removed (deprecated and ignored by all modern
  // browsers as of Chrome 107 / 2022). CT is now enforced unconditionally
  // by browsers for any cert chain shipped after 2018, so the header was
  // pure noise.

  if (req.method === 'OPTIONS') {
    // This middleware terminates preflights before /api/stream forwarding.
    // Reuse the exact anonymous-media policy; private paths remain unchanged.
    applyPublicStreamCors(req, res);
    res.sendStatus(200);
    return;
  }

  next();
});

// =================================================================
// Unified canonical-URL middleware
//
// Previously HTTPS, www→non-www, and trailing-slash were three separate
// 301 redirects. A request like http://www.themegaradio.com/foo/ would
// chain through 3 redirects which Google penalizes (long redirect chain
// = wasted crawl budget). This single middleware computes the final
// canonical form and emits ONE 301.
//
// Order of operations: protocol → hostname → trailing slash. Final URL
// is built once and compared to the original; if anything changed we
// emit a single 301.
// =================================================================
app.use((req, res, next) => {
  // Skip in dev/preview and on health endpoints
  if (process.env.NODE_ENV === 'development' || req.hostname === 'localhost' || req.hostname === '127.0.0.1') {
    return next();
  }
  if (req.path === '/health' || req.path === '/healthz') return next();

  const originalProtocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const originalHost = (req.get('host') || req.hostname).toLowerCase();
  const originalPath = req.path;

  let targetProtocol = originalProtocol;
  let targetHost = originalHost;
  let targetPath = originalPath;

  // 1. HTTPS (skip in dev/replit preview where x-forwarded-proto isn't set)
  const isPreview = req.hostname.includes('replit.dev') || req.hostname === 'localhost';
  if (!isPreview && originalProtocol === 'http') {
    targetProtocol = 'https';
  }

  // 2. www → non-www
  if (targetHost === 'www.themegaradio.com') {
    targetHost = 'themegaradio.com';
  }

  // 3. Strip trailing slash (except root, except files)
  if (targetPath.length > 1 && targetPath.endsWith('/')) {
    const segs = targetPath.split('/');
    const lastSeg = segs[segs.length - 2];
    if (!lastSeg || !lastSeg.includes('.')) {
      targetPath = targetPath.slice(0, -1);
    }
  }

  // 4. Consolidate the legacy /pages/{privacy-policy,terms-and-conditions}
  //    duplicates onto the canonical clean URL. Both path shapes render the
  //    SAME component and each self-canonicals, so Google saw a duplicate-
  //    content pair with split link equity. Redirect the /pages/ form → the
  //    clean form (the one the sitemap advertises) so there is exactly one
  //    indexable legal URL. Preserves an optional /{lang} prefix.
  targetPath = targetPath.replace(
    /^(\/[a-z]{2})?\/pages\/(privacy-policy|terms-and-conditions)$/,
    (_m, lang, slug) => `${lang || ''}/${slug}`,
  );

  const protocolChanged = targetProtocol !== originalProtocol;
  const hostChanged = targetHost !== originalHost;
  const pathChanged = targetPath !== originalPath;

  if (protocolChanged || hostChanged || pathChanged) {
    // Extract raw query from originalUrl. CRITICAL: do NOT compute it as
    // `req.url.slice(req.path.length)` — req.path is URL-decoded while
    // req.url is raw, so their lengths diverge for any path containing
    // percent-encoded characters. Using indexOf('?') on the raw originalUrl
    // is encoding-safe and preserves the query verbatim.
    const qIdx = req.originalUrl.indexOf('?');
    const query = qIdx >= 0 ? req.originalUrl.substring(qIdx) : '';
    // For protocol/host changes we must build absolute URL; otherwise
    // a relative path keeps the redirect cheap.
    const target = (protocolChanged || hostChanged)
      ? `${targetProtocol}://${targetHost}${targetPath}${query}`
      : `${targetPath}${query}`;
    return void res.redirect(301, target);
  }

  next();
});

app.use(webRequestTimeout);

app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/healthz') || req.path.startsWith('/health') || /\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|map|json)$/i.test(req.path)) {
    return next();
  }
  const opId = startOperation('http-request', `${req.method} ${req.path}`);
  let cleaned = false;
  const cleanup = () => { if (!cleaned) { cleaned = true; endOperation(opId); } };
  res.on('finish', cleanup);
  res.on('close', cleanup);
  next();
});

app.use(urlRedirectMiddleware);
app.use(stationCountryValidator);

// C-A2 FIX (2026-05-08): aligned with index-api.ts. Always gzip text-like
// responses (HTML/JSON/JS/XML/SVG) for ALL clients including Googlebot,
// Bingbot, GPTBot, ApplebOt etc. Modern crawlers all support and PREFER
// gzip — serving them raw HTML wastes crawl budget and inflates page-load
// latency in GSC.
app.use(compression({
  level: 1,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['upgrade']) return false;
    const contentType = res.getHeader('Content-Type') as string;
    if (contentType && /text|json|javascript|xml|svg/.test(contentType)) return true;
    return compression.filter(req, res);
  }
}));

app.use('/api/visitor-activity/page-view', (req,res,next)=>{
  if(req.method==='POST' && !req.is('application/json')) return void res.status(415).json({error:'Expected JSON page view'});
  next();
}, express.json({ limit: '2kb' }));
app.use(express.json({
  limit: '2mb',
  // Capture the raw body for webhook HMAC verification (Stripe/Paddle).
  // Without this, the global JSON parser consumes the stream and webhook
  // handlers that re-read req.on('data') hang until timeout.
  verify: (req, _res, buf) => { (req as any).rawBody = buf.toString('utf8'); },
}));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

app.use((req, res, next) => {
  const url = req.url;
  const path = url.split('?')[0]; // strip query string for matching

  // 🚨 CRITICAL: Service worker, web app manifest, and the firebase messaging
  // worker MUST NEVER be long-cached. Browsers cap SW caching to ~24h
  // automatically, but Cloudflare/CDNs honour whatever max-age we send. A long
  // max-age here means SW updates won't reach users for that duration even
  // after a fresh deploy. Always serve these with no-cache so the browser
  // re-validates on every load.
  if (
    path === '/sw.js' ||
    path === '/firebase-messaging-sw.js' ||
    path === '/service-worker.js' ||
    path === '/manifest.json' ||
    path === '/manifest.webmanifest'
  ) {
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Content-Type-Options': 'nosniff',
    });
    return next();
  }

  const ext = url.split('.').pop()?.toLowerCase();
  if (ext && ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'json', 'xml'].includes(ext)) {
    if (url.includes('/assets/') || url.includes('-') || url.includes('.min.')) {
      res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Expires': new Date(Date.now() + 31536000 * 1000).toUTCString() });
    } else {
      res.set({ 'Cache-Control': 'public, max-age=31536000, must-revalidate', 'Expires': new Date(Date.now() + 31536000 * 1000).toUTCString() });
    }
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Vary': 'Accept-Encoding' });
  }
  next();
});

app.use('/cast-receiver', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Cache-Control': 'public, max-age=3600',
  });
  if (req.method === 'OPTIONS') return void res.sendStatus(200);
  next();
}, express.static(path.resolve(process.cwd(), "client/public/cast-receiver"), { etag: true, lastModified: true }));

const publicPath = path.resolve(process.cwd(), "public");
app.use(express.static(publicPath, { etag: true, lastModified: true, setHeaders: (res) => { res.set('X-Content-Type-Options', 'nosniff'); } }));

const imagesPath = path.resolve(process.cwd(), "images");
app.use('/station-images', express.static(imagesPath, { etag: true, lastModified: true, setHeaders: (res) => { res.set({ 'Cache-Control': 'public, max-age=86400, must-revalidate', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Accept-Encoding' }); } }));

const stationLogosPath = path.resolve(process.cwd(), "station-logos");
app.use('/station-logos', express.static(stationLogosPath, { etag: true, lastModified: true, setHeaders: (res) => { res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Accept-Encoding' }); } }));
// Containers may lack local logo files. Processed WebPs are delivered from
// the public bucket at the same stable path; legacy originals retain their
// existing redirect fallback and never fall through to an HTML SPA shell.
const STATION_LOGOS_S3_BASE =
  process.env.STATION_LOGOS_BASE_URL ||
  'https://megaradio-station-logos.s3.eu-north-1.amazonaws.com/station-logos';
app.use('/station-logos', createStationLogoDelivery({ baseUrl: STATION_LOGOS_S3_BASE }));
app.use('/station-logos', (req, res) => {
  // Path shape gate: exactly folder/file with safe characters — no
  // traversal, nothing smuggled into the bucket URL. Anything else is a
  // genuine 404.
  if (!/^\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(req.path) || req.path.includes('..')) {
    res.status(404).set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send('Not found');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.redirect(302, `${STATION_LOGOS_S3_BASE}${req.path}`);
});

const apiProxy = createProxyMiddleware({
  target: BACKEND_API_URL,
  changeOrigin: true,
  ws: false,
  ...WEB_API_PROXY_TIMEOUTS,
  cookieDomainRewrite: {
    '*': ''
  },
  on: {
    error: (err, req, res) => {
      console.error(`❌ Proxy error for ${(req as any).url}:`, err.message);
      sendWebApiProxyError(res);
    },
    proxyReq: (proxyReq, req) => {
      proxyReq.setHeader('X-Forwarded-For', (req as any).ip || (req as any).connection?.remoteAddress || '');
      proxyReq.setHeader('X-Forwarded-Host', (req as any).hostname || '');
      proxyReq.setHeader('X-Forwarded-Proto', (req as any).protocol || 'https');
      const incomingHeaders = (req as any).headers || {};
      if (incomingHeaders['cf-ipcountry']) proxyReq.setHeader('CF-IPCountry', incomingHeaders['cf-ipcountry']);
      if (incomingHeaders['cf-connecting-ip']) proxyReq.setHeader('CF-Connecting-IP', incomingHeaders['cf-connecting-ip']);
      if (incomingHeaders['cf-ray']) proxyReq.setHeader('CF-Ray', incomingHeaders['cf-ray']);
      if (incomingHeaders['x-real-ip']) proxyReq.setHeader('X-Real-IP', incomingHeaders['x-real-ip']);
      if ((req as any).body && (req as any).headers['content-type']) {
        const contentType = (req as any).headers['content-type'];
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const bodyData = new URLSearchParams((req as any).body).toString();
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        } else if (contentType.includes('application/json')) {
          const bodyData = JSON.stringify((req as any).body);
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      }
    }
  }
});

// /admin* is fully client-side (React/Wouter). Serve index.html so that
// direct navigation to any sub-route (e.g. /admin/stripe-plans) mounts the
// SPA and lets Wouter handle routing. Keep X-Robots-Tag so crawlers never
// index admin pages — no change to the SEO posture.
// Match serveStatic/getProdAssetTags; preserve public SSR and remove only
// explicitly marked public preloads/analytics from this private shell.
const sendAdminSpa = createAdminSpaHandler(path.resolve(import.meta.dirname, 'public'));
app.get('/admin-login', sendAdminSpa);
app.get('/admin', sendAdminSpa);
app.get('/admin/*path', sendAdminSpa);

// Server-side proxy for /api/image/* and /api/stream/* — forwards to the
// dedicated stream-proxy service at STREAM_PROXY_URL. This means clients can
// keep using relative paths (e.g. /api/image/<base64>) and we don't depend on
// VITE_STREAM_PROXY_URL being injected into the client build. Without this,
// production was returning 410 Gone for every logo/image request because the
// client fell through to a same-origin URL when the build env var was missing.
const streamServiceProxy = createProxyMiddleware({
  target: STREAM_PROXY_URL,
  changeOrigin: true,
  // The destination needs the full /api/image|stream path. The mount wrappers
  // below restore req.originalUrl after Express strips the mounted prefix.
  on: {
    proxyRes: publicImageProxyHeaders,
    error: (err: any, _req: any, res: any) => {
      console.error('❌ Stream-service proxy error:', err?.message || err);
      try {
        if (res && !res.headersSent) {
          res.status(502).json({ error: 'Stream service unavailable' });
        }
      } catch {}
    }
  }
});
app.use('/api/image', forwardApiRequest(streamServiceProxy));
app.use('/api/stream', forwardApiRequest(streamServiceProxy));

(async () => {
  await initializePostgres();
  await seedPostgresDefaultLanguages();

  // The local SEO registrar also installs admin maintenance paths with a
  // deny-only stub. Delegate these to the authenticated API BEFORE that stub
  // can shadow them; public page-data and sitemap XML still remain local.
  app.use('/api/admin', forwardApiRequest(apiProxy));

  const seoSitemapDeps = {
    requireAdmin: (_req: any, res: any, next: any) => {
      res.status(403).json({ error: 'Admin routes only available on API service' });
    }
  };
  await registerSeoSitemapRoutes(app, seoSitemapDeps);
  startupReady = true;
  logger.log('✅ SEO/Sitemap routes registered on frontend-web (handles /api/seo/page-data locally)');

  app.use('/api', forwardApiRequest(apiProxy));

  const server = createServer(app);

  const wsProxy = createProxyMiddleware({
    target: BACKEND_API_URL,
    changeOrigin: true,
    ws: true,
    timeout: 0,
    on: {
      error: (err, req) => {
        console.error(`❌ WS Proxy error:`, err.message);
      }
    }
  });

  app.use('/ws', wsProxy);

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '', `http://${req.headers.host}`).pathname;
    if (pathname.startsWith('/ws/')) {
      wsProxy.upgrade!(req, socket as import('net').Socket, head);
    } else {
      // Unknown WS path — destroy socket to prevent leak (otherwise TCP stays open indefinitely).
      try { socket.destroy(); } catch {}
    }
  });

  const seoRenderer = new SeoRenderer();

  // ── Universal SSR template loader ────────────────────────────────────────
  // Read the production Vite index.html ONCE at startup so we can inject the
  // real hashed asset tags (`/assets/index-XXXXX.js` + `.css` + modulepreload
  // hints) into every SSR response. Without this the SSR template hard-coded
  // `<script src="/src/main.tsx">`, which only works in Vite dev — in
  // production that path falls through to the SPA index.html (text/html, not
  // JS) so React never mounts. Previously we hid this bug by only serving
  // SSR HTML to bots; now that we serve SSR HTML to *every* visitor we MUST
  // emit the correct asset URLs or the page would be a dead static snapshot
  // for real users.
  //
  // Returns empty strings in dev / when the build isn't present, in which
  // case the SSR template falls back to its original `/src/main.tsx` tag —
  // safe because dev only runs the SSR path against the Vite dev server
  // anyway (which DOES serve `/src/main.tsx`).
  interface ProdAssetTags { scripts: string; styles: string; preloads: string; recovery: string; routePreloads?: Record<string, string>; }
  let prodAssetTagsCache: ProdAssetTags | null = null;
  function getProdAssetTags(): ProdAssetTags {
    if (prodAssetTagsCache !== null) return prodAssetTagsCache;
    try {
      const indexPath = path.resolve(import.meta.dirname, 'public', 'index.html');
      if (!fs.existsSync(indexPath)) {
        prodAssetTagsCache = { scripts: '', styles: '', preloads: '', recovery: '' };
        logger.log(`📦 SSR template: prod index.html not found at ${indexPath} (dev mode — using /src/main.tsx fallback)`);
        return prodAssetTagsCache;
      }
      const html = fs.readFileSync(indexPath, 'utf8');
      const scripts = Array.from(html.matchAll(/<script\b[^>]*\bsrc="\/assets\/[^"]+\.js"[^>]*><\/script>/g)).map(m => m[0]).join('\n    ');
      const styles = Array.from(html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/assets\/[^"]+\.css"[^>]*>/g)).map(m => m[0]).join('\n    ');
      const preloads = Array.from(html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*>/g)).map(m => m[0]).join('\n    ');
      const recovery = html.match(/<script\b[^>]*\bid="app-load-recovery"[^>]*>[\s\S]*?<\/script>/)?.[0] || '';
      prodAssetTagsCache = { scripts, styles, preloads, recovery };
      // Optional across rolling upgrades/dev: missing manifest must not discard
      // the valid entry script/CSS tags or prevent rendering the site.
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(indexPath), '.vite', 'manifest.json'), 'utf8'));
        prodAssetTagsCache.routePreloads = buildPublicRoutePreloads(manifest, `${scripts}\n${styles}\n${preloads}`);
      } catch { /* Existing builds without a manifest keep the original tags. */ }
      logger.log(`📦 SSR template loaded: ${scripts.split('<script').length - 1} scripts, ${styles.split('<link').length - 1} styles, ${preloads.split('<link').length - 1} modulepreloads`);
    } catch (e: any) {
      logger.log(`⚠️ SSR template load failed: ${e?.message || e} — falling back to dev tag`);
      prodAssetTagsCache = { scripts: '', styles: '', preloads: '', recovery: '' };
    }
    return prodAssetTagsCache;
  }
  // Warm the cache at startup so the first SSR request doesn't pay the IO.
  getProdAssetTags();

  const seoRegionAlts = collectSeoTranslations('regions');
  const seoGenreAlts = collectSeoTranslations('genres');
  const seoStationSingularAlts = collectSeoTranslations('station');
  const seoStationPluralAlts = collectSeoTranslations('stations');

  const SEO_PRECOMPILED_REGEX = {
    ...buildPublicSeoRouteMatchers(),
    botDetect: /\b(googlebot|google-inspectiontool|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|skype|pinterestbot|redditbot|crawler|spider|seobility|semrush|ahrefs|mozbot|majestic|screaming|frog|nutch|fastcrawler|genieo|demandbase|gptbot|chatgpt-user|ccbot|anthropic-ai|claude-web|bytespider|perplexitybot|applebot|cohere-ai)\b/i
  };

  const botRateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const BOT_RATE_LIMIT_WINDOW = 60_000;
  const BOT_RATE_LIMIT_MAX_MINOR = 60;
  // MAJOR bots are exempt from the 60 req/min/IP rate limit applied below.
  // 2026-05-12: Added the AI crawler family (GPTBot, ChatGPT-User,
  // OAI-SearchBot, ClaudeBot/Claude-Web/anthropic-ai, PerplexityBot/
  // Perplexity-User, CCBot, Bytespider, cohere-ai, Google-Extended,
  // Meta-ExternalAgent, Amazonbot, DuckAssistBot, YouBot, Diffbot,
  // Applebot-Extended) so they can crawl the whole site without getting
  // 429'd mid-crawl — paired with the robots.txt Allow stanzas this
  // makes the site fully open to AI search/LLM training surfaces.
  const MAJOR_SEARCH_BOT_RE = /\b(googlebot|google-inspectiontool|apis-google|adsbot-google|mediapartners-google|storebot-google|google-extended|bingbot|bingpreview|yandexbot|slurp|duckduckbot|baiduspider|applebot|applebot-extended|gptbot|chatgpt-user|oai-searchbot|ccbot|anthropic-ai|claude-web|claudebot|bytespider|perplexitybot|perplexity-user|cohere-ai|meta-externalagent|amazonbot|duckassistbot|youbot|diffbot)\b/i;
  // AI_SCRAPER_RE removed (2026-05-12) — previously this list was used to
  // hard-403 GPTBot, ChatGPT-User, CCBot, anthropic-ai, claude-web,
  // bytespider, perplexitybot, cohere-ai. The SEO audit (30/04/2026) flagged
  // these 403s as "Crawler and Bot Blocking — Active Access Denial" causing
  // AI invisibility (no presence in ChatGPT/Claude/Perplexity answers). Per
  // user direction (2026-05-12), AI crawlers are now ALLOWED. Same change
  // also stripped the AI bot Disallow stanzas from /robots.txt.

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of botRateLimitMap) {
      if (now > entry.resetAt) botRateLimitMap.delete(ip);
    }
  }, 60_000);

  // Pre-SSR language-ineligibility redirect: for non-universal language station
  // URLs, do a single lean DB lookup to check eligibility and 301 to /en before
  // the full SSR render runs. Saves 100–300ms per ineligible URL hit.
  const { langIneligibilityRedirectMiddleware } = await import('./middleware/lang-ineligibility-redirect');
  app.use(langIneligibilityRedirectMiddleware);

  app.use(async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const url = req.originalUrl;
    const userAgent = req.get('user-agent') || '';

    const cleanUrlForMatching = decodePublicSeoPath(url);
    if (cleanUrlForMatching === null) {
      return sendSeoNotFound(res, '<!doctype html><title>Not found</title><h1>Not found</h1>');
    }

    const isStationPage = SEO_PRECOMPILED_REGEX.stationPage.test(cleanUrlForMatching);
    const isHomepage = SEO_PRECOMPILED_REGEX.homepage.test(cleanUrlForMatching);
    const isRegionsPage = SEO_PRECOMPILED_REGEX.regionsPage.test(cleanUrlForMatching);
    const isGenresPage = SEO_PRECOMPILED_REGEX.genresPage.test(cleanUrlForMatching);
    const isAboutPage = SEO_PRECOMPILED_REGEX.aboutPage.test(cleanUrlForMatching);
    const isContactPage = SEO_PRECOMPILED_REGEX.contactPage.test(cleanUrlForMatching);
    const isPrivacyPage = SEO_PRECOMPILED_REGEX.privacyPage.test(cleanUrlForMatching);
    const isCountryPage = SEO_PRECOMPILED_REGEX.countryPage.test(cleanUrlForMatching);
    const isStationsPage = SEO_PRECOMPILED_REGEX.stationsPage.test(cleanUrlForMatching);
    const isSearchPage = SEO_PRECOMPILED_REGEX.searchPage.test(cleanUrlForMatching);
    const isFaqPage = SEO_PRECOMPILED_REGEX.faqPage.test(cleanUrlForMatching);
    const isTermsPage = SEO_PRECOMPILED_REGEX.termsPage.test(cleanUrlForMatching);
    const isApplicationsPage = SEO_PRECOMPILED_REGEX.applicationsPage.test(cleanUrlForMatching);
    const isUsersPage = SEO_PRECOMPILED_REGEX.usersPage.test(cleanUrlForMatching);
    const isBlogPage = SEO_PRECOMPILED_REGEX.blogPage.test(cleanUrlForMatching);
    const isDiscoveryPage = SEO_PRECOMPILED_REGEX.discoveryPage.test(cleanUrlForMatching);

    const isSeoEligiblePage = isBlogPage || isStationPage || isHomepage || isRegionsPage || isGenresPage || isAboutPage || isContactPage || isPrivacyPage || isCountryPage || isStationsPage || isSearchPage || isFaqPage || isTermsPage || isApplicationsPage || isUsersPage || isDiscoveryPage;
    const isBot = SEO_PRECOMPILED_REGEX.botDetect.test(userAgent);

    // CLOAKING FIX (2026-05-12): SSR is now served to ALL visitors on SEO
    // eligible pages, not just bots. Previously the `!isBot` short-circuit
    // here meant bots got a fully-rendered HTML with localized title/meta/
    // hreflang/JSON-LD while real users got a generic SPA shell with the
    // default English title — textbook Dynamic Rendering, which Google
    // deprecated in 2022 and treats as a cloaking signal under the spam
    // algorithm. Now everyone gets the same HTML, eliminating the risk.
    //
    // Performance: the origin's SEO cache avoids repeated rendering, while
    // HTML ETags allow conditional validation across deployments. Hashed
    // assets retain long-lived caching. Login/profile/settings
    // are filtered out by `isSeoEligiblePage === false` and still hit the
    // SPA fallback as before.
    if (!isSeoEligiblePage) {
      // Non-SEO SPA shells (profile, settings, admin, etc.) have no real
      // content — mark noindex so Googlebot doesn't file them as soft-404s.
      res.setHeader('X-Robots-Tag', 'noindex, follow');
      return next();
    }

    // Bot rate limiting only applies to actual bots — real users go straight
    // to the SSR pipeline below.
    if (isBot) {
      const isMajorBot = MAJOR_SEARCH_BOT_RE.test(userAgent);
      if (isMajorBot) {
        // Google/Bing/major search bots are never rate limited
      } else {
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        let botEntry = botRateLimitMap.get(clientIp);
        if (!botEntry || now > botEntry.resetAt) {
          botEntry = { count: 0, resetAt: now + BOT_RATE_LIMIT_WINDOW };
          botRateLimitMap.set(clientIp, botEntry);
        }
        botEntry.count++;
        if (botEntry.count > BOT_RATE_LIMIT_MAX_MINOR) {
          res.status(429).set({ 'Retry-After': '60' }).send('Too Many Requests');
          return;
        }
      }
    }

    const cleanUrl = url.split('?')[0].split('#')[0];
    // PAGINATION CACHE KEY (2026-07-02 audit P1): the renderer keys its
    // pageData cache with a `|page=N` suffix for paginated hubs, but this HTML
    // cache keyed on the query-stripped cleanUrl only — so /en/stations?page=7
    // HTML (canonical …?page=7) was cached under /en/stations and served for
    // the sitemap-submitted page-1 URL ("sitemap URL canonicalizes to another
    // URL"). Mirror the renderer's validated page suffix without truncating
    // real later pages. Invalid parameters must not reuse page-one HTML.
    const parsedPage = parseSeoCatalogPage(url);
    const pageNum = parsedPage.valid ? parsedPage.page : 1;
    const seoHtmlKey = pageNum > 1 ? `${cleanUrl}|page=${pageNum}` : cleanUrl;
    const cachedHtml = parsedPage.valid ? performanceCache.getSeoHtml(seoHtmlKey) : undefined;
    if (cachedHtml) {
      // Cache-HIT junk guard: a station URL whose pageData cache reports
      // stationIsJunk must serve 410 even if a stale SSR HTML is still in
      // cache from a previous deploy. The pageData cache uses the same key
      // and would have been (re)written as junk by the renderer.
      const cachedPage: any = performanceCache.getPageData(seoHtmlKey);
      if (cachedPage?.pageData?.httpNotFound) {
        sendSeoNotFound(res, cachedHtml);
        return;
      }
      if (cachedPage?.pageData?.stationIsJunk) {
        const { sendJunkGone } = await import('./seo/send-junk-gone');
        sendJunkGone(res);
        return;
      }
      // Cache-hit redirect guard: if the renderer marked this URL as a
      // language-ineligible redirect (e.g. /am/station/foo → /en/station/foo),
      // honour the 301 even when stale noindex HTML is still in cache. Without
      // this, cached noindex HTML is served indefinitely and Google keeps
      // reporting the URL as "Crawled - currently not indexed".
      if (cachedPage?.pageData?.redirectTo) {
        const qIdx = req.originalUrl.indexOf('?');
        const queryString = qIdx >= 0 ? req.originalUrl.substring(qIdx) : '';
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
        res.redirect(301, cachedPage.pageData.redirectTo + queryString);
        return;
      }
      // Mirror <meta robots> on the X-Robots-Tag header so the two never
      // contradict (Google parks contradictions in "Crawled - not indexed").
      // pageData and seoHtml caches can diverge, so fall back to scanning the
      // cached HTML when seoTags is missing.
      const cachedNoIndex =
        cachedPage?.seoTags?.noIndex === true ||
        /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(cachedHtml);
      if (cachedNoIndex) {
        res.removeHeader('X-Robots-Tag');
        res.setHeader('X-Robots-Tag', 'noindex, follow');
      }
      // HTML references chunks from this deployment only. Revalidate in both
      // browsers and CDNs instead of relying on an unverified deploy purge.
      // The in-process SEO cache and HTTP ETags still avoid repeated work.
      res.status(200).set({
        'Content-Type': 'text/html',
        'Cache-Control': HTML_CACHE_CONTROL,
        'X-SEO-Cache': 'HIT'
      }).send(cachedHtml);
      return;
    }

    let responded = false;
    const safeNext = () => {
      if (!responded && !res.headersSent) {
        responded = true;
        clearTimeout(reqTimeout);
        next();
      }
    };

    const reqTimeout = setTimeout(() => {
      if (!responded && !res.headersSent) {
        responded = true;
        clearTimeout(reqTimeout);
        logger.log(`⏰ SEO request timeout (15s), falling back to SPA (503): ${url}`);
        markSeoTemporarilyUnavailable(res);
        next();
      }
    }, 15000);

    try {
      const productionDomain = 'https://themegaradio.com';
      const actualHost = req.get('host') || 'themegaradio.com';
      const ogImageDomain = actualHost.includes('replit') ? `https://${actualHost}` : productionDomain;

      // SEO-CACHE SAFETY (2026-07-02 audit P1): the preferredLanguage cookie
      // used to override the URL-derived render language here (a TR-cookied
      // visitor on /de/sender/x got Turkish HTML with a /tr canonical). But
      // this response is cached PUBLICLY — origin seoHtml cache + conditional
      // HTTP caches — keyed by URL only. One cookied visitor therefore
      // poisoned the URL for every
      // subsequent visitor INCLUDING Googlebot (wrong lang + wrong canonical =
      // hreflang/canonical chaos in GSC). The URL is the single source of
      // truth for SSR language; a user's preferred UI language is applied
      // client-side after React mounts (the SPA replaces the SSR body anyway),
      // so users lose nothing.
      const { value: seoData, expiresAt: sourceExpiresAt } = await capturePublicStationDeadline(
        () => seoRenderer.renderStaticPage(url, productionDomain),
      );
      // CRITICAL: seoData.seoTags is shared from a `useClones: false` cache and
      // is frozen on write — clone before overriding the domain so that this
      // request-specific value doesn't poison cached SEO data for others.
      const seoTags = { ...seoData.seoTags, domain: ogImageDomain };
      const pageType = seoData.pageData?.pageType || 'unknown';

      // RTL FIX (2026-05-08): emit dir="rtl" for right-to-left languages
      // so the SSR HTML renders correctly for Googlebot / Bingbot. Without
      // this, Arabic/Hebrew/Persian/Urdu pages were flagged as having
      // mixed-direction content vs the language attribute.
      const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);
      const htmlDir = RTL_LANGS.has((seoData.language || '').toLowerCase().split('-')[0]) ? 'rtl' : 'ltr';
      // Inject the production Vite asset tags (real hashed JS/CSS bundles +
      // modulepreload hints) so the browser can actually mount React on top
      // of this SSR HTML. See `getProdAssetTags()` for the rationale.
      const prodTags = getProdAssetTags();
      let htmlContent = `<!DOCTYPE html>
<html lang="${seoData.language}" dir="${htmlDir}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="yandex-verification" content="2af3c8203c89a3d9" />
    <meta name="yandex-verification" content="57c83c6ab08ec3ba" />
    ${prodTags.recovery}
    ${seoRenderer.generateHtmlHead(seoTags, seoData.language, seoData.translations || {}, seoData.cleanPath, seoData.pageData?.station, seoData.urlTranslations, seoData.pageData)}
    <link rel="icon" type="image/vnd.microsoft.icon" sizes="64x64" href="/favicon.ico">
    <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="manifest" href="/manifest.json">
    <meta name="apple-mobile-web-app-title" content="Mega Radio">
    <meta name="apple-mobile-web-app-capable" content="no" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="application-name" content="Mega Radio">
    <meta name="msapplication-TileImage" content="/apple-touch-icon.png">
    <!-- 2026-05-12 perf (PageSpeed mobile=43): removed dead preloads
         (ubuntu-400.ttf, ubuntu-700.ttf — files do not exist, were 404s)
         and an unused preconnect to unpkg.com (Lighthouse flagged it). -->
    <!-- flagcdn serves the country-flag hero on every region/country SSR page
         (eager <img>, seo-renderer.ts:2467). preconnect (not just dns-prefetch)
         warms the TLS+TCP handshake so the flag paints sooner. -->
    <!-- No \`crossorigin\`: flags are plain no-cors <img> fetches; a CORS-mode
         preconnect would not be reused for them (wasted handshake). -->
    <link rel="preconnect" href="https://flagcdn.com">
    <link rel="dns-prefetch" href="https://flagcdn.com">
    <link rel="dns-prefetch" href="https://api.ipify.org">
    <!-- LCP: the header logo is above-the-fold on every page. The production
         SSR head (served to 100% of traffic) previously shipped no image
         preloads at all, so the logo was discovered late by the preload
         scanner. Preload it with high priority. Matches the asset used by
         HeaderBrand's original high-resolution /logo-icon.webp asset. -->
    <link rel="preload" as="image" href="/logo-icon.webp" fetchpriority="high">
    <!-- Only preload the small shared Latin subsets, not every alphabet.
         Unicode-range selects the other unchanged glyphs when required.
         The 600 and 700 faces have identical metrics and share one source. -->
    <link rel="preload" as="font" href="/fonts/ubuntu-400-latin.woff2" type="font/woff2" crossorigin>
    <link rel="preload" as="font" href="/fonts/ubuntu-500-latin.woff2" type="font/woff2" crossorigin>
    <link rel="preload" as="font" href="/fonts/ubuntu-700-latin.woff2" type="font/woff2" crossorigin>
    ${pageType === 'home' ? '<link rel="preload" as="image" href="/images/hero-bg-430w.webp" type="image/webp" media="(max-width: 767px)" fetchpriority="high"><link rel="preload" as="image" href="/images/hero-bg.webp" type="image/webp" media="(min-width: 768px)" fetchpriority="high">' : ''}
    ${prodTags.styles}
    ${prodTags.preloads}
    ${prodTags.routePreloads?.[pageType] || ''}
    <style>
      body { font-family: 'Ubuntu', system-ui, sans-serif; margin: 0; padding: 0; background-color: #0a0a0a; color: #ffffff; line-height: 1.5; }
      *, *::before, *::after { box-sizing: border-box; }
      img { height: auto; max-width: 100%; display: block; }
      .container-critical { max-width: 1200px; margin: 0 auto; padding: 0 1rem; }
      /* Responsive .container and .hero-container geometry belongs to the
         production stylesheet above. Legacy global fallbacks here overrode
         its mobile 255px hero and desktop widths even after React mounted. */
      button { font-family: inherit; }
      a { color: inherit; text-decoration: none; }
      .grid-stations { display: grid; grid-template-columns: 1fr; gap: 1rem; }
      @media (min-width: 640px) { .grid-stations { grid-template-columns: repeat(2, 1fr); } }
      @media (min-width: 768px) { .grid-stations { grid-template-columns: repeat(3, 1fr); } }
      .skeleton-placeholder { background: #404040; border-radius: 0.5rem; animation: pulse 2s infinite; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    </style>
    <!-- BroadcastService JSON-LD intentionally removed to avoid dual-primary
         entity conflict with the RadioStation block emitted from
         seo-renderer.ts. Search engines were seeing two competing primary
         entities at the same @id-less URL. -->

  </head>
  <body>
    <div id="root">
      <div id="ssr-content">
        ${seoRenderer.generateHtmlBody({
          pageType: seoData.pageData?.pageType || 'home',
          language: seoData.language,
          translations: seoData.translations,
          seoTags: seoTags,
          stationData: seoData.pageData?.station,
          additionalData: seoData.pageData?.additionalData || {},
          urlTranslations: seoData.urlTranslations,
          cleanPath: seoData.cleanPath
        })}
      </div>
    </div>
    ${renderTranslationBootstrap(seoData.language, seoData.translations, pageType)}
    ${pageType === 'station' && !seoData.pageData?.notFound && !seoData.pageData?.stationIsJunk ? renderStationBootstrap(seoData.pageData?.station, seoData.language) : ''}
    ${prodTags.scripts || '<script type="module" src="/src/main.tsx"></script>'}
    ${(() => {
      const topGenres = seoData.pageData?.additionalData?.topGenres;
      if (!topGenres || !Array.isArray(topGenres) || topGenres.length === 0) return '';
      const safeJson = JSON.stringify({ genres: { data: topGenres } }).replace(/<\//g, '\\u003c/');
      return `<script id="initial-data">window.__INITIAL_DATA__=${safeJson};</script>`;
    })()}
    <script>
      window.performance = window.performance || {};
      window.performance.mark && window.performance.mark('body-start');
      document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
          var belowFoldElements = document.querySelectorAll('.below-fold');
          belowFoldElements.forEach(function(el) { el.style.visibility = 'visible'; });
          window.performance.mark && window.performance.mark('critical-content-loaded');
        }, 100);
      });
    </script>
  </body>
</html>`;

      if (!responded && !res.headersSent) {
        responded = true;
        clearTimeout(reqTimeout);

        // Slug-alias 301: when SSR resolved the station via a slugAlias rather
        // than the canonical slug, redirect to the canonical URL so Google /
        // Bing consolidate ranking and don't keep indexing the old broken slug.
        const redirectTo = seoData.pageData?.redirectTo;
        if (redirectTo && typeof redirectTo === 'string') {
          const qIdx = req.originalUrl.indexOf('?');
          const queryString = qIdx >= 0 ? req.originalUrl.substring(qIdx) : '';
          // Short cache (5 min) so when an alias is removed from the DB,
          // CDN/browser stale 301s clear quickly instead of being cached
          // indefinitely as heuristic fresh.
          res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
          res.redirect(301, redirectTo + queryString);
          return;
        }

        // Handle transient data failures BEFORE the permanent quality gates.
        // Synthetic station placeholders have no stream URL; treating them as
        // junk used to turn a brief database read failure into a cached 410.
        // Publication may happen after the renderer's source data expires.
        if (seoData.pageData?.stationDbError || sourceExpiresAt <= Date.now()) {
          markSeoTemporarilyUnavailable(res);
          next();
          return;
        }
        if (seoData.pageData?.httpNotFound) {
          sendSeoNotFound(res, htmlContent);
          return;
        }

        const stationNotFound = !!seoData.pageData?.notFound;
        // Architect P0: excluded station URLs (test feeds, verified duplicates, or DB records with
        // noIndex:true) must return 410 Gone — NOT 200/noindex and NOT 301.
        // This is the catalog's exclusion policy, not a guarantee that Google
        // will remove the URL immediately or stop recrawling it.
        // Must mirror the same check in server/index.ts (dev/monolith).
        const stationIsJunk =
          !stationNotFound && !!seoData.pageData?.stationIsJunk;

        if (stationIsJunk) {
          // Do NOT cache SSR HTML for junk URLs — shared helper keeps the
          // status/body/cache-control consistent with the cache-HIT branch.
          const { sendJunkGone } = await import('./seo/send-junk-gone');
          sendJunkGone(res);
          return;
        }

        // Not-found station pages: deleted stations, renamed slugs, or
        // country-code prefixed URLs (/bh/, /cz/, /ir/…) where the station
        // no longer exists in PostgreSQL. Keep the existing 410 response for
        // absent catalog records. Google treats 404 and 410 alike. Transient
        // database failures take the explicit 503 path above, never this path.
        if (stationNotFound) {
          // Return the same absent-record response for every station route.
          const { sendJunkGone } = await import('./seo/send-junk-gone');
          sendJunkGone(res);
          return;
        }

        // Only complete, current documents may enter the HTML cache.
        const stationDbError = !!seoData.pageData?.stationDbError;
        if (!stationNotFound && !stationDbError) {
          performanceCache.setSeoHtml(seoHtmlKey, htmlContent, 'bot', sourceExpiresAt);
        }
        // Soft-404 guard (2026-05-15): when the SSR resolves to "not
        // found", we MUST emit noindex on BOTH the X-Robots-Tag header
        // AND the in-body <meta name="robots"> tag. Previously the body
        // still said `index, follow` because seoTags.noIndex was not set
        // for notFound pages — Google sees a contradictory 404+indexable
        // signal and parks the URL as "soft 404". Force-rewrite the meta
        // tag in the rendered HTML so the two signals always agree.
        const forceNoIndex = stationNotFound || stationDbError || seoTags?.noIndex === true;
        if (forceNoIndex) {
          res.removeHeader('X-Robots-Tag');
          // X-Robots-Tag header takes precedence over any conflicting in-body meta
          // tag per Google/Bing spec — no fragile regex HTML rewrite needed.
          res.setHeader('X-Robots-Tag', 'noindex, follow');
        }
        res.status(stationNotFound ? 404 : 200).set({
          'Content-Type': 'text/html',
          // Same revalidation policy as the HTML cache-HIT branch.
          'Cache-Control': (stationNotFound || stationDbError)
            ? 'no-store'
            : HTML_CACHE_CONTROL,
          'X-SEO-Cache': 'MISS'
        }).send(htmlContent);
      }
    } catch (error: any) {
      if (!responded && !res.headersSent) {
        responded = true;
        clearTimeout(reqTimeout);
        const errMsg = error?.message || '';
        const isOverload = errMsg === 'SEO_RENDER_OVERLOADED' || errMsg === 'SEO_RENDER_TIMEOUT';
        logger.log(`⚠️ SSR error (${isOverload ? 'overload' : 'render'}), falling back to SPA (503): ${url} — ${errMsg}`);
        markSeoTemporarilyUnavailable(res);
        next();
      }
    }
  });

  app.use(htmlLangMiddleware);

  // Bare top-level country/genre slug → 301 to canonical SEO URL.
  // Mounted BEFORE slug-shape-404 so requests like `/en/turkey` or
  // `/tr/pop` (which the SPA serves as a blank shell with no canonical
  // tag and would otherwise be dropped by Google as soft-404 duplicates)
  // get redirected to `/en/regions/asia/turkey` / `/tr/genres/pop`. The
  // SSR layer at the target then emits the proper localized canonical
  // and hreflang, so Googlebot consolidates ranking on the right URL.
  const { bareSlugRedirectMiddleware } = await import('./middleware/bare-slug-redirect');
  app.use((req, res, next) => {
    if (res.statusCode === 503) return next();
    return bareSlugRedirectMiddleware(req, res, next);
  });

  // Task #158: lightweight slug-shape 404 for non-bot visitors. Bots
  // already get a proper 404 from the SSR catch-all above; this fills
  // the gap for browser users who hit junk URLs like
  // `/regions/regio's/germany` or `/genres/<unknown>` and otherwise see
  // a blank loading screen with HTTP 200 (the SPA shell).
  const { createSlugShape404Middleware } = await import('./middleware/slug-shape-404');
  const slugShape404Middleware = createSlugShape404Middleware({
    regionsAlts: seoRegionAlts,
    genresAlts: seoGenreAlts,
    stationSingularAlts: seoStationSingularAlts,
    stationsPluralAlts: seoStationPluralAlts,
  });
  app.use((req, res, next) => {
    if (res.statusCode === 503) return next();
    return slugShape404Middleware(req, res, next);
  });

  serveStatic(app);

  const webServers: Parameters<typeof createWebShutdown>[0]['servers'] = [server];

  // Optional HTTPS server for Cloudflare Origin SSL ("Full (strict)" mode).
  // Set SSL_CERT and SSL_KEY environment variables (raw PEM content) to enable.
  // The certificate must be a Cloudflare Origin Certificate for *.themegaradio.com.
  // In Railway: add these as environment variables in the service settings.
  // The HTTP server remains active alongside HTTPS for internal health checks.
  const sslCert = process.env.SSL_CERT;
  const sslKey = process.env.SSL_KEY;
  if (sslCert && sslKey) {
    try {
      const httpsServer = createHttpsServer({ cert: sslCert, key: sslKey }, app);
      const sslPort = parseInt(process.env.SSL_PORT || '443', 10);
      httpsServer.on('upgrade', (req, socket, head) => {
        const pathname = new URL(req.url || '', `https://${req.headers.host}`).pathname;
        if (pathname.startsWith('/ws/')) {
          wsProxy.upgrade!(req, socket as import('net').Socket, head);
        } else {
          try { socket.destroy(); } catch {}
        }
      });
      httpsServer.listen({ port: sslPort, host: '0.0.0.0' }, () => {
        logger.log(`🔒 FRONTEND-WEB: HTTPS listening on port ${sslPort} (Cloudflare Origin SSL)`);
      });
      webServers.push(httpsServer);
    } catch (err: any) {
      logger.warn(`⚠️ HTTPS server failed to start (bad cert/key?): ${err?.message}`);
    }
  }

  let isShuttingDown = false;
  let watchdogTimerRef: ReturnType<typeof setInterval> | undefined;

  const port = parseInt(process.env.PORT || '3000', 10);
  server.listen({ port, host: "0.0.0.0", reusePort: process.platform !== 'win32' && process.platform !== 'darwin' }, () => {
    logger.log(`🚀 FRONTEND-WEB: Listening on port ${port}`);
    logger.log(`🔗 Backend API URL: ${BACKEND_API_URL}`);

    let watchdogFailures = 0;
    let postgresDownSince: number | null = null;
    const WATCHDOG_MAX_FAILURES = 3;
    const WATCHDOG_INTERVAL = 30_000;
    const WATCHDOG_TIMEOUT = 5_000;
    const POSTGRES_DOWN_RESTART_MS = 3 * 60_000;

    const watchdogTimer = setInterval(async () => {
      if (isShuttingDown) { clearInterval(watchdogTimer); return; }
      try {
        const http = await import('http');
        const ok = await new Promise<boolean>((resolve) => {
          const req = http.request(
            { hostname: '127.0.0.1', port, path: '/healthz', method: 'GET', timeout: WATCHDOG_TIMEOUT },
            (res) => { res.resume(); resolve(res.statusCode === 200); }
          );
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
          req.end();
        });
        if (ok) {
          if (watchdogFailures > 0) console.log(`🐕 Watchdog: recovered after ${watchdogFailures} failure(s)`);
          watchdogFailures = 0;
        } else {
          watchdogFailures++;
          console.error(`🐕 Watchdog: self-ping failed (${watchdogFailures}/${WATCHDOG_MAX_FAILURES})`);
          if (watchdogFailures >= WATCHDOG_MAX_FAILURES) {
            console.error(`🐕 Watchdog: forcing restart`);
            requestGracefulRestart();
          }
        }

        if (await postgresAvailable()) {
          postgresDownSince = null;
        } else {
          if (postgresDownSince === null) postgresDownSince = Date.now();
          if (Date.now()-postgresDownSince >= POSTGRES_DOWN_RESTART_MS) {
            console.error('PostgreSQL unavailable beyond watchdog deadline; restarting');
            requestGracefulRestart();
          }
        }
      } catch (err: any) {
        watchdogFailures++;
        console.error(`🐕 Watchdog error: ${err.message} (${watchdogFailures}/${WATCHDOG_MAX_FAILURES})`);
        if (watchdogFailures >= WATCHDOG_MAX_FAILURES) {
          console.error(`🐕 Watchdog: forcing restart after error`);
          requestGracefulRestart();
        }
      }
    }, WATCHDOG_INTERVAL);
    watchdogTimerRef = watchdogTimer;

    logger.log(`🐕 Watchdog: enabled (interval=${WATCHDOG_INTERVAL/1000}s, maxFailures=${WATCHDOG_MAX_FAILURES})`);
  });

  server.timeout = 120000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  const gracefulShutdown = createWebShutdown({
    servers: webServers,
    onStart: signal => {
      isShuttingDown = true;
      startupReady = false;
      clearInterval(watchdogTimerRef);
      console.log(`\n🛑 ${signal} received — starting graceful shutdown...`);
    },
    closeResources: closePostgres,
    exitCode: requestedShutdownExitCode,
  });

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  const RSS_WARNING_MB = 7000;
  const RSS_CRITICAL_MB = 9000;
  const RSS_RESTART_MB = 12000;
  let lastMemoryLog = 0;

  setInterval(() => {
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const now = Date.now();

    if (rssMB > RSS_RESTART_MB) {
      logger.log(`🚨 MEMORY CRITICAL: RSS=${rssMB}MB > ${RSS_RESTART_MB}MB — triggering graceful restart`);
      requestGracefulRestart();
      return;
    }

    if (rssMB > RSS_CRITICAL_MB || heapMB > 1500) {
      logger.log(`⚠️ MEMORY HIGH: RSS=${rssMB}MB, Heap=${heapMB}MB — clearing all caches`);
      performanceCache.clearSeoHtml();
      performanceCache.clearPageData();
      CacheManager.clearByPattern('sitemap');
      if (global.gc) { global.gc(); }
    } else if (rssMB > RSS_WARNING_MB) {
      if (now - lastMemoryLog > 60000) {
        lastMemoryLog = now;
        logger.log(`⚠️ MEMORY WARNING: RSS=${rssMB}MB, Heap=${heapMB}MB — clearing SEO HTML cache`);
      }
      performanceCache.clearSeoHtml();
    }
  }, 30000);

  (async () => {
    try {
      if (process.env.NODE_ENV !== 'development') {
        await performanceCache.warmupCaches();
        precomputeTranslationScripts();
        logger.log('✅ FRONTEND-WEB: Cache warmup completed');
      }

      const { loadDatabaseCountryLanguageMappings, loadDatabaseUrlTranslations } = await import('./seo/load-database-mappings');
      await loadDatabaseCountryLanguageMappings();
      await loadDatabaseUrlTranslations();

      try {
        const { loadSlugExistence, startSlugExistenceRefresh } = await import('./seo/slug-existence');
        await loadSlugExistence();
        startSlugExistenceRefresh();
      } catch (err) {
        console.error('❌ FRONTEND-WEB: Slug-existence init failed:', err);
      }

      // Sitemap subsystem (manifest-driven, refactored 2026-04-30):
      //   1. initializeQualifiedLanguages() — fail-closed warm-up + LKG seed.
      //   2. buildAllSitemapManifests() — first build (idempotent, skips if fresh).
      //   3. startManifestRefreshLoop() — periodic rebuild every 6h.
      // Done in background so server starts accepting requests immediately;
      // sitemap routes return 503 + Retry-After until manifests are ready.
      try {
        // ARCHITECT FIX (2026-05-10): pre-warm translations BEFORE qualified-
        // languages init so live compute sees a populated cache instead of
        // returning 0 and silently falling back to LKG. See index-api.ts for
        // full rationale. warmupCaches() is memoized so the parallel
        // background-tasks block above won't re-run it.
        // INCIDENT 2026-05-15 v7 — duplicate `performanceCache.warmupCaches()`
        // call removed. The block at L1124-1130 already awaits the same call
        // before this point in the boot sequence (the `await` on L1127
        // completes before the qualified-languages init starts at L1168),
        // and warmupCaches() is memoized so a second call returned the same
        // cached promise instantly anyway. Dropping the dead call removes a
        // misleading "🔥 SITEMAP-INIT: pre-warmed translation cache" log
        // line that suggested a second warmup ran when none did.
        const { initializeQualifiedLanguages } = await import('./seo/qualified-languages');
        await initializeQualifiedLanguages();
        const { buildAllSitemapManifests, startManifestRefreshLoop } = await import('./seo/sitemap-manifest-builder');
        await buildAllSitemapManifests();
        startManifestRefreshLoop();
        logger.log('✅ FRONTEND-WEB: Sitemap manifest subsystem initialized');
      } catch (err) {
        console.error('❌ FRONTEND-WEB: Sitemap manifest init failed:', err);
      }
    } catch (error) {
      console.error('❌ FRONTEND-WEB: Background tasks failed:', error);
    }
  })();
})();
