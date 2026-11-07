if (!process.env.FONTCONFIG_FILE || process.env.FONTCONFIG_FILE === '/dev/null') {
  process.env.FONTCONFIG_FILE = process.cwd() + '/fontconfig.conf';
}

// Sync job runs many concurrent batches each subscribing to close events on
// shared streams (logger/stdout). The default limit of 10 fires false-positive
// MaxListenersExceededWarnings under burst concurrency; 30 is safe for a
// single-pod deployment without hiding real leaks.
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 30;

import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import compression from "compression";
import crypto from "crypto";
import { rateLimit } from 'express-rate-limit';

declare module "express-session" {
  interface SessionData {
    user?: {
      userId: string;
      email: string;
      role: string;
      rememberMe: boolean;
    };
  }
}
import { registerRoutes } from "./routes";
import { seedPostgresDefaultLanguages, cleanupPostgresDescriptionPrefixes } from './services/postgres-bootstrap';
import { pgGenres } from './data/postgres-taxonomy-store';
import {
  closePostgres,
  getPostgresHealth,
  getPostgresMigrationStatus,
  getPostgresPool,
  postgresAvailable,
  initializePostgres,
} from "./postgres-runtime";
import { PostgresSessionStore } from "./data/postgres-session-store";
import { performanceCache } from "./performance-cache";
import { logger } from './utils/logger';
import { requestGracefulRestart, requestedShutdownExitCode } from './utils/graceful-restart';
import { initLogCollector } from './services/log-collector';
import { startOperation, endOperation, getActiveOperations, getGcStats, getActiveOperationsSummary, resetGcStats, initGcTracking } from './utils/operation-tracker';

import { geoBlockMiddleware } from './middleware/geo-block';
import { databaseMaintenanceMiddleware } from './middleware/database-maintenance';
import { privateApiCachePolicy, setHealthCacheHeaders } from './middleware/cache-policy';
import { createAdminSpaHandler, registerAdminAssets } from './admin-spa';

const app = express();
// Allows a staging/read-serving replica to boot the production code path without
// starting provider calls or background mutations. Manual admin actions remain explicit.
const backgroundJobsEnabled = process.env.BACKGROUND_JOBS_ENABLED !== 'false';
let startupReady = false;

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Geo-block FIRST — drop TCP connection from blocked countries (no response)
app.use(geoBlockMiddleware);
app.use(['/api/admin', '/api/auth'], privateApiCachePolicy);
app.use(databaseMaintenanceMiddleware);
app.use('/api/test', (_req, res, next) => {
  if (process.env.NODE_ENV === 'production') return void res.status(404).json({ error: 'Not found' });
  next();
});

function getFrameOptionsHeader(): string | null {
  if (process.env.CLICKJACKING_MITIGATION) {
    return process.env.CLICKJACKING_MITIGATION;
  }
  return 'DENY';
}

const SEARCH_BOT_RE = /\b(googlebot|google-inspectiontool|apis-google|adsbot-google|mediapartners-google|storebot-google|bingbot|bingpreview|slurp|duckduckbot|baiduspider|yandexbot|applebot)\b/i;

const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: true,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    if (!req.path.startsWith('/api') || req.path === '/api/health' || req.path === '/health' || req.path === '/healthz') return true;
    const ua = req.headers['user-agent'] || '';
    if (SEARCH_BOT_RE.test(ua)) return true;
    return false;
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: true,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts, please try again in 15 minutes.' },
  skip: (req) => {
    const ua = req.headers['user-agent'] || '';
    return SEARCH_BOT_RE.test(ua);
  }
});

function getHstsHeader(): string {
  if (process.env.HSTS_MAX_AGE) {
    const maxAge = process.env.HSTS_MAX_AGE;
    const includeSubdomains = process.env.HSTS_INCLUDE_SUBDOMAINS !== 'false' ? '; includeSubDomains' : '';
    const preload = process.env.HSTS_PRELOAD === 'true' ? '; preload' : '';
    return `max-age=${maxAge}${includeSubdomains}${preload}`;
  }
  const hstsPhase = process.env.HSTS_PHASE || 'confident';
  const hstsConfigs: Record<string, string> = {
    testing: 'max-age=60',
    initial: 'max-age=3600; includeSubDomains',
    confident: 'max-age=604800; includeSubDomains',
    production: 'max-age=31536000; includeSubDomains; preload'
  };
  return hstsConfigs[hstsPhase] || hstsConfigs.confident;
}

const API_DRAIN_TIMEOUT_MS = 125_000;
const API_SHUTDOWN_TIMEOUT_MS = 130_000;

let uncaughtExitScheduled = false;
function scheduleFatalExit(label: string) {
  if (uncaughtExitScheduled) return;
  uncaughtExitScheduled = true;
  console.error(`🚨 ${label} — scheduling fail-fast exit in 1s for clean restart`);
  setTimeout(() => {
    requestGracefulRestart();
    setTimeout(() => process.exit(1), API_SHUTDOWN_TIMEOUT_MS).unref();
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

import path from 'path';

const distPublicPath = path.join(process.cwd(), 'dist', 'public');
const publicPath = path.join(process.cwd(), 'public');

// S1 FIX (2026-05-08): the early "Disallow: /" handler shadowed the proper
// allow-list robots.txt registered later in seo-sitemap-routes.ts (the first
// matching `app.get` wins). Removed so the real handler — which advertises
// the sitemap and only blocks /api/admin etc — is the one that responds.

app.get(['/healthz', '/health', '/api/health'], async (req, res) => {
  setHealthCacheHeaders(res);
  if (req.path === '/healthz') {
    return void res.status(200).type('text/plain').send('ok');
  }

  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const externalMB = Math.round(mem.external / 1024 / 1024);
  const arrayBuffersMB = Math.round((mem.arrayBuffers || 0) / 1024 / 1024);

  const uptimeSeconds = Math.round(process.uptime());
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptimeFormatted = `${days}d ${hours}h ${minutes}m ${seconds}s`;

  const os = await import('os');
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const totalMemGB = Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10;
  const freeMemGB = Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10;

  const heapPercent = Math.round((heapMB / 4096) * 100);
  let memoryHealth = 'healthy';
  if (heapMB > 3500) memoryHealth = 'critical';
  else if (heapMB > 3000) memoryHealth = 'warning';

  const postgres = await getPostgresHealth();
  const migration = postgres.status === 'connected'
    ? await getPostgresMigrationStatus().catch(() => null)
    : null;

  res.status(postgres.status === 'connected' && startupReady ? 200 : 503).json({
    status: postgres.status === 'connected' && startupReady ? 'ok' : 'degraded',
    service: 'backend-api',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    memory: {
      heapUsed: `${heapMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      heapLimit: '4096MB',
      heapUsagePercent: `${heapPercent}%`,
      rss: `${rssMB}MB`,
      external: `${externalMB}MB`,
      arrayBuffers: `${arrayBuffersMB}MB`,
      health: memoryHealth
    },
    uptime: {
      seconds: uptimeSeconds,
      formatted: uptimeFormatted
    },
    database: {
      engine: 'postgresql',
      status: postgres.status,
      latencyMs: postgres.latencyMs,
      postgres,
      migration,
    },
    system: {
      cpuCores: cpus.length,
      loadAverage: {
        '1min': Math.round(loadAvg[0] * 100) / 100,
        '5min': Math.round(loadAvg[1] * 100) / 100,
        '15min': Math.round(loadAvg[2] * 100) / 100
      },
      totalMemory: `${totalMemGB}GB`,
      freeMemory: `${freeMemGB}GB`
    },
    node: {
      version: process.version,
      maxOldSpaceSize: '4096MB',
      execArgv: process.execArgv,
      gcAvailable: typeof (globalThis as any).gc === 'function'
    },
    diagnostics: {
      activeOperations: (() => { try { return getActiveOperations().slice(0, 10); } catch { return []; } })(),
      gcStats: (() => { try { return getGcStats(); } catch { return {}; } })(),
      nativeMemoryMB: rssMB - heapTotalMB,
      activeHandles: (() => {
        try {
          const handles = (process as any)._getActiveHandles();
          const tc: Record<string, number> = {};
          for (const h of handles) { const n = h?.constructor?.name || 'Unknown'; tc[n] = (tc[n] || 0) + 1; }
          return tc;
        } catch { return {}; }
      })(),
      ldPreload: process.env.LD_PRELOAD || 'not set',
      mallocConf: process.env.MALLOC_CONF || 'not set',
      allocator: process.env.LD_PRELOAD?.includes('jemalloc') ? 'jemalloc' : 'glibc'
    }
  });
});

app.get('/readyz', async (_req, res) => {
  setHealthCacheHeaders(res);
  const postgres = await getPostgresHealth();
  const ready = startupReady && postgres.status === 'connected';
  res.status(ready ? 200 : 503).json({ ready,database:'postgresql',postgres:postgres.status });
});

const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'https://themegaradio.com').split(',').map(s => s.trim());
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://themegaradio.com';
if (!CORS_ALLOWED_ORIGINS.includes(FRONTEND_URL)) {
  CORS_ALLOWED_ORIGINS.push(FRONTEND_URL);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  // CRITICAL: always emit Vary: Origin so Cloudflare/CDN doesn't cache an
  // ACAO header for one origin and replay it for another. Without this, a
  // credentialed POST from themegaradio.com can fail intermittently.
  // CRITICAL: `Origin` for the ACAO mirroring above; `Accept-Encoding`
  // so a gzipped JSON response isn't replayed to a client that didn't
  // negotiate gzip (and vice versa) once Cloudflare/CDN caches it.
  res.header('Vary', 'Origin, Accept-Encoding');
  const isAllowed = !!origin && (
    CORS_ALLOWED_ORIGINS.includes(origin) ||
    /^https:\/\/([a-z0-9-]+\.)*themegaradio\.com$/i.test(origin)
  );
  if (isAllowed) {
    res.header('Access-Control-Allow-Origin', origin!);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  // Note: do NOT emit '*' for unknown origins when credentials are in play —
  // browsers reject 'ACAO: *' on credentialed requests anyway, and emitting
  // it just hides real misconfigurations.
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range, X-API-Key, X-API-User-Token, X-MegaRadio-Platform');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  res.header('Access-Control-Max-Age', '86400');

  res.header('X-Content-Type-Options', 'nosniff');
  // SEO: API responses are JSON and must NEVER be indexed even if a stray
  // referrer link leaks the URL. robots.txt blocks /api/ but external links
  // can still trigger indexing without a page-level signal.
  res.header('X-Robots-Tag', 'noindex, nofollow');
  const frameOptions = getFrameOptionsHeader();
  if (frameOptions) res.header('X-Frame-Options', frameOptions);
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  if (process.env.NODE_ENV === 'production' || req.secure || req.get('x-forwarded-proto') === 'https') {
    res.header('Strict-Transport-Security', getHstsHeader());
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

app.use('/api', globalApiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/mobile/login', authLimiter);
app.use('/api/auth/apple', authLimiter);
app.use('/api/auth/google', authLimiter);
app.use('/api/auth/token-session', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/admin/login', authLimiter);

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api') || ['/api/health','/api/stream/','/api/image-proxy/'].some(p=>req.path.startsWith(p))) return next();
  if (!startupReady || !(await postgresAvailable())) {
    return void res.status(503).json({ error:'Service temporarily unavailable, please retry in a few seconds' });
  }
  next();
});

const enableEmbeddedProxy = process.env.ENABLE_EMBEDDED_PROXY === 'true' || process.env.NODE_ENV !== 'production';

app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development' || req.hostname === 'localhost' || req.hostname === '127.0.0.1') {
    return next();
  }
  if (req.path === '/api/health' || req.path === '/health' || req.path === '/healthz') {
    return next();
  }
  const isHttpOnly = !req.secure && req.get('x-forwarded-proto') !== 'https';
  if (isHttpOnly) {
    const host = req.get('host') || req.hostname;
    return void res.redirect(301, `https://${host}${req.url}`);
  }
  next();
});

app.use((req, res, next) => {
  if (/\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|map|json)$/i.test(req.path)) {
    return next();
  }

  const requestStartedAt = Date.now();
  req.setTimeout(30000, () => {
    if (!res.headersSent) {
      console.error(`⏰ Request timeout after ${Date.now() - requestStartedAt}ms (socket limit ${req.socket.timeout}ms): ${req.method} ${req.path}`);
      res.status(504).send('Gateway Timeout');
    }
  });
  next();
});

const BOT_UA_RE = /bot|crawl|spider|slurp|baidu|yandex|duckduck|bingpreview|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|googlebot|google-inspectiontool|chrome-lighthouse|pingdom|uptimerobot/i;
// S15 + C-A2 FIX (2026-05-08):
// - Always gzip XML/sitemap/robots regardless of UA.
// - Always gzip text/json/javascript/xml/svg responses for ALL clients
//   including Googlebot/Bingbot. The historical bot-skip rule was a holdover
//   from very old crawlers; Googlebot, Bingbot, Yandex, AppleBot, GPTBot
//   etc. all support and PREFER gzip — serving them raw HTML/JSON wastes
//   crawl budget and inflates page-load latency in GSC.
const SITEMAP_PATH_RE = /^\/(sitemap[\w-]*\.xml|robots\.txt)$/i;
app.use(compression({
  level: 1,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['upgrade']) return false;
    if (SITEMAP_PATH_RE.test(req.path)) return true;
    const contentType = res.getHeader('Content-Type') as string;
    if (contentType && /text|json|javascript|xml|svg/.test(contentType)) return true;
    return compression.filter(req, res);
  }
}));

// A page-view report contains only a sanitized path and one referral enum.
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
// text/csv uploads (e.g. SEMrush CSV import) — larger limit, separate from JSON budget
app.use(express.text({ limit: '10mb', type: ['text/csv', 'text/plain'] }));

// 2026-05-15: Replaced sendFile of /app/public/api-docs.html (which never
// existed in the prod image — Railway logs were full of `ENOENT: no such
// file or directory, stat '/app/public/api-docs.html'`). The api-server's
// `/` is informational only; the browsable API docs live at /api-docs in
// the SPA artifact. Serve a minimal inline page so the route returns 200
// and points operators / curl probes at the right places.
app.get('/', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(
      '<!doctype html><meta charset="utf-8">' +
        '<title>Mega Radio API</title>' +
        '<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#222}code{background:#f4f4f5;padding:2px 6px;border-radius:4px}</style>' +
        '<h1>Mega Radio API</h1>' +
        '<p>This host serves the JSON API for <a href="https://themegaradio.com">themegaradio.com</a>.</p>' +
        '<ul>' +
          '<li>Health: <code>GET /healthz</code></li>' +
          '<li>API base: <code>/api/*</code></li>' +
          '<li>Browsable docs: <a href="https://themegaradio.com/api-docs">themegaradio.com/api-docs</a></li>' +
        '</ul>',
    );
});

registerAdminAssets(app, distPublicPath);

// Serve locally-processed station logos. When S3 is not configured, logo-processor.ts
// writes WebP files to public/station-logos/ — this makes them reachable from both the
// API domain (api.themegaradio.com/station-logos/...) and the admin SPA.
const stationLogosPath = path.resolve(process.cwd(), 'public', 'station-logos');
app.use('/station-logos', express.static(stationLogosPath, {
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    });
  },
}));

const sendAdminSpa = createAdminSpaHandler(distPublicPath);
app.get('/admin', sendAdminSpa);
app.get('/admin/*path', sendAdminSpa);
app.get('/admin-login', sendAdminSpa);

const useSecureCookies = process.env.NODE_ENV === 'production';

if (useSecureCookies && !process.env.SESSION_SECRET) {
  console.error('🚨 FATAL: SESSION_SECRET environment variable is required in production');
  process.exit(1);
}

// Production env hygiene — surface common misconfigs at boot instead of
// having login silently fail later.
if (process.env.NODE_ENV === 'production') {
  if (!process.env.GOOGLE_CALLBACK_URL) {
    console.error('🚨 PROD WARNING: GOOGLE_CALLBACK_URL is not set — Passport will fall back to FRONTEND_URL/api/auth/google/callback which is the wrong host on Railway!');
  }
  if (!process.env.COOKIE_DOMAIN) {
    console.error('🚨 PROD WARNING: COOKIE_DOMAIN is not set — set it to ".themegaradio.com" so the session cookie works across api.themegaradio.com and themegaradio.com.');
  }
  if (!process.env.FRONTEND_URL) {
    console.error('🚨 PROD WARNING: FRONTEND_URL is not set — OAuth will redirect to default https://themegaradio.com.');
  }
}

const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

const sessionConfig: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'radio-station-dev-only-secret-do-not-use-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: useSecureCookies,
    httpOnly: true,
    maxAge: 3 * 24 * 60 * 60 * 1000,
    // Force sameSite='none' whenever the cookie is secure. The frontend
    // (themegaradio.com) and the API
    // (api.themegaradio.com) are different origins from the browser's POV,
    // so the session cookie MUST be SameSite=None;Secure to be sent on the
    // POST /api/auth/token-session call after the OAuth redirect.
    sameSite: useSecureCookies ? 'none' : 'lax',
    domain: cookieDomain,
    path: '/'
  },
  name: 'connect.sid',
  proxy: true,
  rolling: false
};

logger.log(`🔐 API Session config: secure=${useSecureCookies}, NODE_ENV=${process.env.NODE_ENV}, cookieDomain=${cookieDomain || 'auto'}, sameSite=${useSecureCookies ? 'none' : 'lax'}`);

sessionConfig.store = new PostgresSessionStore(getPostgresPool());
logger.log('🔐 Using PostgreSQL session store');

app.use(session(sessionConfig));

(async () => {
  initLogCollector();
  await initializePostgres();
  await seedPostgresDefaultLanguages();

  const server = await registerRoutes(app, { mode: 'api-only' });
  startupReady = true;

  server.on('upgrade', async (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

    if (!startupReady || !(await postgresAvailable())) {
      try { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); } finally { socket.destroy(); }
      return;
    }

    if (pathname === '/ws/metadata') {
      server.metadataWss.handleUpgrade(request, socket, head, (ws) => {
        server.metadataWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/cast') {
      server.castWss.handleUpgrade(request, socket, head, (ws) => {
        server.castWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/chat') {
      server.chatWss.handleUpgrade(request, socket, head, (ws) => {
        server.chatWss.emit('connection', ws, request);
      });
    } else {
      // Unknown WS path — must destroy socket to prevent leak. Without this,
      // an unhandled upgrade request keeps the underlying TCP socket open indefinitely.
      try { socket.destroy(); } catch {}
    }
  });

  server.timeout = 120000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  // Slowloris / hung client mitigation. Without requestTimeout, a slow client
  // can hold a connection until headersTimeout (70s) per request indefinitely.
  // 120s gives multer 5MB chat uploads on slow mobile (~50KB/s) enough headroom
  // while still cutting off truly stuck clients.
  (server as any).requestTimeout = 120_000;
  server.maxHeadersCount = 100;
  (server as any).maxRequestsPerSocket = 1000;
  server.maxConnections = 300;
  (app as any)._httpServer = server;

  let isShuttingDown = false;
  // Watchdog timer is created later inside server.listen(). Hoisted reference
  // so gracefulShutdown can clearInterval it immediately and prevent the race
  // where the watchdog fires SIGTERM mid-shutdown and double-kills the process.
  let watchdogTimerRef: NodeJS.Timeout | null = null;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    startupReady = false;
    // External deployment signals remain successful; internal recovery must
    // exit nonzero so Railway ON_FAILURE does not leave the API stopped.
    const shutdownExitCode = requestedShutdownExitCode();
    if (watchdogTimerRef) { try { clearInterval(watchdogTimerRef); } catch {} watchdogTimerRef = null; }
    console.log(`\n🛑 ${signal} received — starting graceful shutdown...`);
    const shutdownTimeout = setTimeout(() => {
      console.error('🚨 Graceful shutdown timed out (130s) — forcing exit');
      process.exit(1);
    }, API_SHUTDOWN_TIMEOUT_MS);
    let drainTimeout: ReturnType<typeof setTimeout> | undefined;

    try {
      // Close all WebSocket clients first so server.close() can resolve promptly.
      try {
        const wssList = [server.metadataWss, server.castWss, server.chatWss].filter(Boolean);
        for (const wss of wssList) {
          for (const client of wss.clients) {
            try { client.close(1001, 'server-shutdown'); } catch {}
          }
          try { wss.close(); } catch {}
        }
        console.log(`✅ Closed ${wssList.length} WebSocket server(s)`);
      } catch (wsErr: any) {
        console.warn('⚠️ Error closing WS servers:', wsErr?.message || wsErr);
      }

      await new Promise<void>((resolve, reject) => {
        drainTimeout = setTimeout(() => {
          server.closeAllConnections();
          reject(new Error('HTTP request drain timed out (125s)'));
        }, API_DRAIN_TIMEOUT_MS);
        server.close(error => {
          clearTimeout(drainTimeout);
          if (error) return reject(error);
          console.log('✅ HTTP server closed');
          resolve();
        });
      });

      await closePostgres();

      clearTimeout(shutdownTimeout);
      console.log('✅ Graceful shutdown complete');
      process.exit(shutdownExitCode);
    } catch (err: any) {
      console.error('❌ Error during shutdown:', err.message);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    } finally {
      clearTimeout(drainTimeout);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    console.error(`❌ Express error [${status}]: ${message}`);
  });

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({ port, host: "0.0.0.0", reusePort: process.platform !== 'win32' && process.platform !== 'darwin' }, () => {
    logger.log(`🚀 BACKEND-API: Listening on port ${port}`);
    logger.log(`🔗 CORS allowed origins: ${CORS_ALLOWED_ORIGINS.join(', ')}`);
    logger.log(`🔗 Frontend URL: ${FRONTEND_URL}`);

    void (async () => {
      if (process.env.NODE_ENV === 'development' || !backgroundJobsEnabled) return;
      try {
        const inits: Array<[string, () => Promise<void>]> = [
          ['scheduled cache clear', async () => { (await import('./services/scheduled-cache-clear')).scheduledCacheClearService.initialize(); }],
          ['scheduled logo processor', async () => { (await import('./services/scheduled-logo-processor')).scheduledLogoProcessor.initialize(); }],
          ['scheduled junk cleanup', async () => { (await import('./services/scheduled-junk-cleanup')).scheduledJunkCleanup.initialize(); }],
          ['scheduled admin-setting-history prune', async () => { (await import('./services/scheduled-admin-setting-history-prune')).scheduledAdminSettingHistoryPrune.initialize(); }],
          ['scheduled backfill', async () => { (await import('./services/scheduled-backfill')).scheduledBackfill.initialize(); }],
          ['scheduled station sync', async () => { (await import('./services/scheduled-station-sync')).scheduledStationSync.initialize(); }],
          ['scheduled stream health', async () => { (await import('./services/scheduled-stream-health')).scheduledStreamHealth.initialize(); }],
          ['scheduled duplicate merge', async () => { (await import('./services/scheduled-duplicate-merge')).scheduledDuplicateMerge.initialize(); }],
          ['scheduled coverage snapshot', async () => { (await import('./services/scheduled-coverage-snapshot')).scheduledCoverageSnapshot.initialize(); }],
          ['scheduled genre-slug cleanup', async () => { (await import('./services/scheduled-genre-slug-cleanup')).scheduledGenreSlugCleanup.initialize(); }],
          ['scheduled genre station-counts', async () => { (await import('./services/scheduled-genre-station-counts')).scheduledGenreStationCounts.initialize(); }],
          ['scheduled sitemap-diff', async () => { (await import('./services/scheduled-sitemap-diff')).scheduledSitemapDiff.initialize(); }],
          ['GSC inspection cron', async () => { (await import('./services/gsc-inspection')).gscInspectionService.initialize(); }],
          ['scheduled mapping-audit digest', async () => { (await import('./services/scheduled-mapping-audit-digest')).scheduledMappingAuditDigest.initialize(); }],
          ['scheduled stuck/resubmit digest', async () => { (await import('./services/scheduled-stuck-resubmit-digest')).scheduledStuckResubmitDigest.initialize(); }],
          ['scheduled description fill', async () => { (await import('./services/scheduled-description-fill')).scheduledDescriptionFill.initialize(); }],
          ['scheduled logo enrichment', async () => { (await import('./services/scheduled-logo-enrichment')).scheduledLogoEnrichment.initialize(); }],
        ];
        for (const [name, fn] of inits) {
          try { await fn(); logger.log(`✅ SCHEDULER: ${name} initialized`); }
          catch (e: any) { logger.warn(`⚠️ SCHEDULER: ${name} init failed: ${e?.message || e}`); }
        }
        logger.log(`✅ SCHEDULER: All ${inits.length} scheduled services registered (independent of cache warmup)`);
      } catch (err) {
        console.error('❌ SCHEDULER: Top-level init failure:', err);
      }
    })();

    void (async () => {
      try {
        // ARCHITECT FIX (2026-05-10): WARM TRANSLATIONS FIRST. Previously
        // `initializeQualifiedLanguages()` ran before the translation
        // cache was populated (warmupCaches() lives in a separate async
        // block that fires later), so live compute always returned 0
        // qualified langs at cold start and the system silently fell
        // back to the LKG. The LKG path works, but the misleading
        // `live compute returned 0` warning made the system look broken.
        // Pre-warming translations here means qualified-languages init
        // sees the populated cache and computes the real number directly.
        if (process.env.NODE_ENV !== 'development') {
          try {
            await performanceCache.warmupCaches();
            logger.log('🔥 SITEMAP-INIT: pre-warmed translation cache');
          } catch (warmErr) {
            logger.warn('⚠️ SITEMAP-INIT: translation pre-warm failed (will fall back to LKG):', (warmErr as Error)?.message);
          }
        }
        const { initializeQualifiedLanguages } = await import('./seo/qualified-languages');
        await initializeQualifiedLanguages();
        const { buildAllSitemapManifests, startManifestRefreshLoop } = await import('./seo/sitemap-manifest-builder');
        await buildAllSitemapManifests();
        startManifestRefreshLoop();
        logger.log('✅ BACKEND-API: Sitemap manifest subsystem initialized');
      } catch (err) {
        console.error('❌ BACKEND-API: Sitemap manifest init failed:', err);
      }
    })();

    let watchdogFailures = 0;
    let postgresDownSince: number | null = null;
    const WATCHDOG_MAX_FAILURES = 3;
    const WATCHDOG_INTERVAL = 30_000;
    const WATCHDOG_TIMEOUT = 5_000;
    // Atlas primary failover takes 30-60s in practice. 90s gives the app-level
    // reconnect loop two backoff windows to recover before we trigger a hard
    // restart. 3-minute window was unnecessarily user-hostile.
    const POSTGRES_DOWN_RESTART_MS = 90_000;

    const watchdogTimer = setInterval(async () => {
      if (isShuttingDown) { clearInterval(watchdogTimer); return; }
      // Expose for gracefulShutdown so it can stop us synchronously.
      watchdogTimerRef = watchdogTimer;
      try {
        const http = await import('http');
        const result = await new Promise<boolean>((resolve) => {
          const req = http.request(
            { hostname: '127.0.0.1', port, path: '/healthz', method: 'GET', timeout: WATCHDOG_TIMEOUT },
            (res) => {
              res.resume();
              resolve(res.statusCode === 200);
            }
          );
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
          req.end();
        });

        if (result) {
          if (watchdogFailures > 0) {
            console.log(`🐕 Watchdog: recovered after ${watchdogFailures} failure(s)`);
          }
          watchdogFailures = 0;
        } else {
          watchdogFailures++;
          console.error(`🐕 Watchdog: self-ping failed (${watchdogFailures}/${WATCHDOG_MAX_FAILURES})`);
          if (watchdogFailures >= WATCHDOG_MAX_FAILURES) {
            console.error(`🐕 Watchdog: ${WATCHDOG_MAX_FAILURES} consecutive failures — forcing restart`);
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

    logger.log(`🐕 Watchdog: enabled (interval=${WATCHDOG_INTERVAL/1000}s, maxFailures=${WATCHDOG_MAX_FAILURES})`);
  });

  (async () => {
    try {
      try {
        const unfinishedJobs = (await getPostgresPool().query(`SELECT job_id AS "jobId",last_processed_station_id AS "lastProcessedStationId"
          FROM bulk_description_jobs WHERE status='running' ORDER BY created_at DESC LIMIT 1`)).rows;

        if (unfinishedJobs.length > 0) {
          const job = unfinishedJobs[0];
          logger.log(`🔄 RESUMING: Found unfinished bulk AI job ${job.jobId}, resuming from station ${job.lastProcessedStationId || 'start'}`);
          logger.log(`📌 Bulk job ${job.jobId} will resume on next manual trigger or server optimization`);
        }
      } catch (resumeError) {
        logger.warn('⚠️ Could not check for unfinished jobs:', (resumeError as Error).message);
      }

      if (process.env.NODE_ENV !== 'development') {
        logger.log('🔥 BACKGROUND: Starting LIGHTWEIGHT cache warmup (on-demand for heavy caches)...');

        await performanceCache.warmupCaches();

        logger.log('⚡ SKIPPED: PrecomputedStations full cache — will populate on-demand per country');

        setImmediate(async () => {
          try {
            await performanceCache.warmupSimilarStations();
            logger.log('✅ BACKGROUND: Similar stations warmup completed');
          } catch (err) {
            logger.warn('⚠️ Similar stations warmup failed (will retry PostgreSQL on demand)');
          }
        });

        try {
          const CacheManagerModule = (await import('./cache')).default;
          const genres = (await pgGenres()).sort((a,b)=>b.stationCount-a.stationCount).slice(0,13);
          await CacheManagerModule.set('genres:discoverable:all:13', genres, { ttl: 600 });
          logger.log('✅ CACHE: Discoverable genres warmed up');
        } catch (err) {
          logger.warn('⚠️ Discoverable genres warmup failed (will cache on first request)');
        }

        logger.log('⚡ SKIPPED: Sitemap translations warmup — will populate on-demand per language');
      } else {
        logger.log('⚡ DEV MODE: All heavy cache warmups skipped (saves ~500MB RAM)');
        logger.log('⚡ Caches will be populated on-demand on first request');
      }

      const { loadDatabaseCountryLanguageMappings, loadDatabaseUrlTranslations } = await import('./seo/load-database-mappings');
      await loadDatabaseCountryLanguageMappings();
      await loadDatabaseUrlTranslations();

      if (process.env.NODE_ENV !== 'development' && backgroundJobsEnabled) {
        try {
          await cleanupPostgresDescriptionPrefixes();
        } catch (error: any) {
          logger.warn(`⚠️ Automatic cleanup failed:`, error.message);
        }
      }

      logger.log('✅ BACKGROUND: All cache warmup operations completed');

      if (process.env.NODE_ENV !== 'development' && backgroundJobsEnabled) {
        // Coverage backfill on boot (idempotent, gated on row count, can
        // safely live here since it's not a cron registration).
        try {
          const { maybeRunCoverageBackfillOnBoot } = await import('./services/coverage-backfill-on-boot');
          await maybeRunCoverageBackfillOnBoot();
        } catch (error: any) {
          logger.warn('⚠️ Failed to evaluate coverage boot backfill:', error.message);
        }

        // Task #368: idempotent duplicate Genre.slug scrub on boot.
        try {
          const { maybeRunDuplicateGenreSlugCleanupOnBoot } = await import(
            './services/duplicate-genre-slug-cleanup-on-boot'
          );
          await maybeRunDuplicateGenreSlugCleanupOnBoot();
        } catch (error: any) {
          logger.warn('⚠️ Failed to run boot duplicate-genre-slug cleanup:', error.message);
        }
      }

      if (process.env.NODE_ENV !== 'development' && backgroundJobsEnabled) {
        try {
          const { TranslationSyncService } = await import('./services/translation-sync');
          logger.log('🌍 BACKGROUND: Scanning for new translation keys...');
          const result = await TranslationSyncService.scanForNewKeys();
          if (result.keysAdded > 0) {
            logger.log(`✅ BACKGROUND: Found ${result.keysAdded} new translation keys (run 'Translate All Languages' in admin to translate)`);
          } else {
            logger.log('✅ BACKGROUND: All translation keys already synced');
          }
        } catch (error: any) {
          logger.warn('⚠️ BACKGROUND: Translation key scan failed:', error.message);
        }
      }

      logger.log('✅ BACKEND-API: All background tasks completed');
    } catch (error) {
      console.error('❌ BACKGROUND: Cache warmup failed:', error);
    }

    if (process.env.NODE_ENV !== 'development') {
      const { CacheManager } = await import('./cache');

      const ldPreload = process.env.LD_PRELOAD || 'not set';
      const mallocConf = process.env.MALLOC_CONF || 'not set';
      const allocator = ldPreload.includes('jemalloc') ? 'jemalloc ✅' : 'glibc (⚠️ RSS fragmentation risk)';
      console.log(`🔧 Memory allocator: ${allocator}`);
      console.log(`🔧 LD_PRELOAD=${ldPreload}`);
      console.log(`🔧 MALLOC_CONF=${mallocConf}`);

      let lastMemoryGcTime = 0;
      const MEMORY_GC_COOLDOWN = 10 * 60 * 1000;
      let lastMemoryWarningTime = 0;
      const MEMORY_WARNING_INTERVAL = 5 * 60 * 1000;
      // RSS_WARNING_MB env removed (v13): there is no warning-only action
      // between CRITICAL and RESTART; the periodic DIAG line already prints
      // RSS on every interval, so a separate warning branch would just be
      // duplicate noise. Only CRITICAL (log-only) and RESTART (SIGTERM)
      // matter now.
      const RSS_CRITICAL_MB = parseInt(process.env.RSS_CRITICAL_MB || '1700', 10);
      const RSS_RESTART_MB = parseInt(process.env.RSS_RESTART_MB || '2200', 10);

      const tryGc = () => {
        try {
          if (typeof (globalThis as any).gc === 'function') {
            (globalThis as any).gc();
          }
        } catch {}
      };

      const getHandleDiagnostics = () => {
        try {
          const handles = (process as any)._getActiveHandles();
          const typeCounts: Record<string, number> = {};
          for (const h of handles) {
            const name = h?.constructor?.name || 'Unknown';
            typeCounts[name] = (typeCounts[name] || 0) + 1;
          }
          return typeCounts;
        } catch { return {}; }
      };

      const getConnectionCount = (): Promise<number> => {
        return new Promise((resolve) => {
          const srv = (app as any)._httpServer;
          if (srv && typeof srv.getConnections === 'function') {
            srv.getConnections((err: any, count: number) => resolve(err ? -1 : count));
          } else {
            resolve(-1);
          }
        });
      };

      // Bot vs user request tracking (HTTP-level, since User-Agent is L7)
      const BOT_UA_RE = /\b(googlebot|google-inspectiontool|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|skype|pinterestbot|redditbot|crawler|spider|seobility|semrush|ahrefs|mozbot|majestic|screaming|frog|nutch|fastcrawler|genieo|demandbase|gptbot|chatgpt-user|ccbot|anthropic-ai|claude-web|bytespider|perplexitybot|applebot|cohere-ai)\b/i;
      const MAJOR_BOT_UA_RE = /\b(googlebot|google-inspectiontool|bingbot|yandexbot|slurp|duckduckbot|baiduspider|applebot)\b/i;
      let activeBotReqs = 0;
      let activeUserReqs = 0;
      let botReqsLastWindow = 0;
      let userReqsLastWindow = 0;
      let majorBotReqsLastWindow = 0;
      app.use((req: any, res: any, next: any) => {
        const ua = req.headers['user-agent'] || '';
        const isBot = BOT_UA_RE.test(ua);
        const isMajor = isBot && MAJOR_BOT_UA_RE.test(ua);
        if (isBot) { activeBotReqs++; botReqsLastWindow++; if (isMajor) majorBotReqsLastWindow++; }
        else { activeUserReqs++; userReqsLastWindow++; }
        res.once('close', () => {
          if (isBot) activeBotReqs = Math.max(0, activeBotReqs - 1);
          else activeUserReqs = Math.max(0, activeUserReqs - 1);
        });
        next();
      });

      let lastDiagLogTime = Date.now();
      const DIAG_LOG_INTERVAL = 2 * 60 * 1000;

      setTimeout(async () => {
        const mem = process.memoryUsage();
        const conns = await getConnectionCount();
        const handles = getHandleDiagnostics();
        const handleStr = Object.entries(handles).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
        const extMB = Math.round(mem.external / 1024 / 1024);
        const abMB = Math.round((mem.arrayBuffers || 0) / 1024 / 1024);
        const otherMB = rssMB - heapTotalMB - extMB - abMB;
        console.log(`📊 STARTUP DIAG: rss=${rssMB}MB heap=${heapMB}/${heapTotalMB}MB ext=${extMB}MB ab=${abMB}MB other≈${otherMB}MB | conns=${conns} | handles: ${handleStr}`);
      }, 10_000);

      // v13 NOTE: unconditional 60s tryGc() loop was REMOVED — global.gc()
      // every minute is exactly the force-GC pressure that produced the
      // 200→50→200 heap zigzag during May 16/17. GC is now hint-only
      // inside the DIAG block when heapMB > 3500 on a 10 min cooldown.
      console.log(`🔧 GC hint available: ${typeof (globalThis as any).gc === 'function'}`);

      setInterval(async () => {
        try {
        const mem = process.memoryUsage();
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
        const externalMB = Math.round(mem.external / 1024 / 1024);
        const abMB = Math.round((mem.arrayBuffers || 0) / 1024 / 1024);
        // v13: "native" eski formül (rss - heapTotal) yanıltıcıydı — V8 isolate,
        // JIT cache, jemalloc dirty page'ler, libuv buffer'ları dahil her şeyi
        // native gibi gösteriyordu. Yeni "other" = rss - heap - external - ab
        // operatör için daha az yanıltıcı. Yine de bu native C++ değil; V8
        // isolate + JIT + glibc/jemalloc artıkları içerir.
        const otherMB = rssMB - heapTotalMB - externalMB - abMB;
        const now = Date.now();

        if ((now - lastDiagLogTime) > DIAG_LOG_INTERVAL) {
          lastDiagLogTime = now;
          const conns = await getConnectionCount();
          const handles = getHandleDiagnostics();
          const handleStr = Object.entries(handles).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
          const winMin = Math.max(1, Math.round(DIAG_LOG_INTERVAL / 60000));
          const botRpm = Math.round(botReqsLastWindow / winMin);
          const userRpm = Math.round(userReqsLastWindow / winMin);
          const majorRpm = Math.round(majorBotReqsLastWindow / winMin);
          console.log(`📊 DIAG: rss=${rssMB}MB heap=${heapMB}/${heapTotalMB}MB ext=${externalMB}MB ab=${abMB}MB other≈${otherMB}MB | conns=${conns} | reqs active bot:${activeBotReqs} user:${activeUserReqs} | rpm bot:${botRpm}(major:${majorRpm}) user:${userRpm} | handles: ${handleStr}`);
          botReqsLastWindow = 0;
          userReqsLastWindow = 0;
          majorBotReqsLastWindow = 0;
        }

        if (rssMB > RSS_RESTART_MB) {
          const conns = await getConnectionCount();
          const handles = getHandleDiagnostics();
          const handleStr = Object.entries(handles).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
          console.error(`🔄 RSS RESTART: rss=${rssMB}MB heap=${heapMB}MB ext=${externalMB}MB other≈${otherMB}MB | conns=${conns} | handles: ${handleStr}`);
          requestGracefulRestart();
          return;
        }

        if (rssMB > RSS_CRITICAL_MB || heapMB > 3500) {
          if ((now - lastMemoryWarningTime) > MEMORY_WARNING_INTERVAL) {
            const conns = await getConnectionCount();
            console.warn(`⚠️ MEMORY HIGH: rss=${rssMB}MB heap=${heapMB}MB/${heapTotalMB}MB ext=${externalMB}MB other≈${otherMB}MB conns=${conns} — sadece gözlem, aksiyon yok`);
            lastMemoryWarningTime = now;
          }
          // V8 heap gerçekten yüksekse (>3500 MB) 10 dk'da bir hint GC.
          // Normal RSS yüksekliği için GC çağırmak işe yaramaz (heap zaten
          // küçük), sadece V8'i thrash eder.
          if (heapMB > 3500 && (now - lastMemoryGcTime) > MEMORY_GC_COOLDOWN) {
            lastMemoryGcTime = now;
            console.warn(`🧹 v13: heap=${heapMB}MB > 3500MB — hinting GC (no cache flush)`);
            tryGc();
          }
        }
        } catch (e: any) {
          // Never let DIAG interval crash the process via fail-fast
          console.error('⚠️ DIAG interval error (caught):', e?.message || e);
        }
      }, 30_000);

      await initGcTracking();

      let lastEventLoopCheck = Date.now();
      let lastBlockedLogTime = 0;
      const LAG_LOG_INTERVAL = 30 * 1000;
      setInterval(() => {
        const now = Date.now();
        const lag = now - lastEventLoopCheck - 5000;
        lastEventLoopCheck = now;
        if (lag > 5000) {
          if ((now - lastBlockedLogTime) > LAG_LOG_INTERVAL) {
            lastBlockedLogTime = now;
            const mem = process.memoryUsage();
            const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
            const rssMB = Math.round(mem.rss / 1024 / 1024);
            const extMB = Math.round(mem.external / 1024 / 1024);
            const abMB2 = Math.round((mem.arrayBuffers || 0) / 1024 / 1024);
            const otherMB2 = rssMB - Math.round(mem.heapTotal / 1024 / 1024) - extMB - abMB2;
            const gcStatsLocal = getGcStats();
            const ops = getActiveOperationsSummary();
            const handles = getHandleDiagnostics();
            const socketCount = (handles['Socket'] || 0) + (handles['TLSSocket'] || 0);
            console.error(`🚨 EVENT LOOP BLOCKED: ${lag}ms | heap=${heapMB}MB rss=${rssMB}MB ext=${extMB}MB other≈${otherMB2}MB sockets=${socketCount} | GC: count=${gcStatsLocal.count} max=${gcStatsLocal.maxMs}ms total=${gcStatsLocal.totalMs}ms | Active: ${ops}`);
            resetGcStats();
          }
        }
      }, 5000);

      setInterval(() => {
        void postgresAvailable().then(available => { if (!available) logger.error('PostgreSQL is unavailable'); });
      },30000).unref();
    }

  })();
})();
