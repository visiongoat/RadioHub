import { applyPublicStreamCors } from "./lib/public-stream-cors";
import express from "express";
import compression from "compression";
import { registerStreamProxyRoutes } from "./routes/stream-proxy-routes";
import { logger } from "./utils/logger";
import { geoBlockMiddleware } from "./middleware/geo-block";

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Geo-block FIRST — drop TCP connection from blocked countries (no response)
app.use(geoBlockMiddleware);

const ALLOWED_ORIGINS = [
  'https://themegaradio.com',
  'https://www.themegaradio.com',
  'https://api.themegaradio.com',
];

if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:5000', 'http://localhost:3000', 'http://localhost:4000');
}

if (process.env.EXTRA_CORS_ORIGINS) {
  ALLOWED_ORIGINS.push(...process.env.EXTRA_CORS_ORIGINS.split(',').map(s => s.trim()));
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, User-Agent');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  res.setHeader('Vary', 'Origin');
  applyPublicStreamCors(req, res);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    return void res.status(204).end();
  }
  next();
});

app.use(compression({
  filter: (req) => {
    if (req.path.startsWith('/api/stream/') && !req.path.includes('/resolve')) return false;
    if (req.path.startsWith('/api/image/')) return false;
    return true;
  }
}));

app.get('/healthz', (_req, res) => {
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  res.json({
    status: 'ok',
    service: 'stream-proxy',
    uptime: Math.round(process.uptime()),
    memory: { rss: rssMB, heap: Math.round(mem.heapUsed / 1024 / 1024), external: Math.round(mem.external / 1024 / 1024) },
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// GSC crawl-stats fix (2026-07-04): Googlebot-Image kept crawling old
// stream.themegaradio.com/api/image/<b64> proxied-favicon URLs it discovered
// from years-old page generations; the mostly-dead upstreams 5XX'd and
// Search Console flagged the host with "high failure rate" (95% of a
// ~6-req/day trickle). There is nothing indexable on this host -- audio
// proxying and image proxying only -- so tell every crawler to stay away.
// The canonical, indexable station logos live on the S3 bucket and the main
// host; blocking this host costs zero image-SEO.
app.get('/robots.txt', (_req, res) => {
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
  res.send('User-agent: *\nDisallow: /\n');
});
// Belt-and-braces for URLs Google already knows: explicit noindex on every
// response from this service.
app.use((_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

registerStreamProxyRoutes(app, { requireAdmin: (_req: any, _res: any, next: any) => next() });

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', service: 'stream-proxy' });
});

const RSS_WARNING_MB = parseInt(process.env.RSS_WARNING_MB || '400', 10);
const RSS_CRITICAL_MB = parseInt(process.env.RSS_CRITICAL_MB || '600', 10);
const RSS_RESTART_MB = parseInt(process.env.RSS_RESTART_MB || '800', 10);
const DIAG_INTERVAL_MS = 30_000;
let lastDiagTime = 0;

function startMemoryMonitor() {
  setInterval(async () => {
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const externalMB = Math.round(mem.external / 1024 / 1024);
    const now = Date.now();

    if (now - lastDiagTime > DIAG_INTERVAL_MS) {
      lastDiagTime = now;
      const { getActiveStreamCount, getStreamRegistrySize } = await import('./routes/stream-proxy-routes');
      console.log(`📊 PROXY DIAG: rss=${rssMB}MB heap=${heapMB}MB ext=${externalMB}MB streams=${getStreamRegistrySize()} active=${getActiveStreamCount()}`);
    }

    if (rssMB > RSS_RESTART_MB) {
      const { forceCloseAllStreams } = await import('./routes/stream-proxy-routes');
      forceCloseAllStreams(`PROXY RSS_RESTART rss=${rssMB}MB`);
      console.error(`🔄 PROXY RESTART: rss=${rssMB}MB — force closing all streams and restarting`);
      process.kill(process.pid, 'SIGTERM');
      return;
    }

    if (externalMB > 300 || rssMB > RSS_WARNING_MB) {
      const { forceCloseOldStreams, getStreamRegistrySize } = await import('./routes/stream-proxy-routes');
      const maxAge = externalMB > 500 ? 60_000 : 5 * 60_000;
      const closed = forceCloseOldStreams(maxAge);
      if (closed > 0) {
        console.log(`⚠️ PROXY PRESSURE: rss=${rssMB}MB ext=${externalMB}MB — closed ${closed} old streams, remaining=${getStreamRegistrySize()}`);
      }
    }

    if (rssMB > RSS_CRITICAL_MB) {
      const { forceCloseAllStreams } = await import('./routes/stream-proxy-routes');
      forceCloseAllStreams(`PROXY CRITICAL rss=${rssMB}MB ext=${externalMB}MB`);
      if (global.gc) {
        global.gc();
        console.log(`🧹 PROXY CRITICAL: Forced GC after closing all streams`);
      }
    }
  }, 10_000);
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Stream Proxy Service running on port ${PORT}`);
  console.log(`📊 Memory limits: warning=${RSS_WARNING_MB}MB critical=${RSS_CRITICAL_MB}MB restart=${RSS_RESTART_MB}MB`);
  startMemoryMonitor();
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.maxHeadersCount = 50;
server.timeout = 0;

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 PROXY ${signal}: Graceful shutdown starting...`);

  try {
    const { forceCloseAllStreams } = await import('./routes/stream-proxy-routes');
    const closed = forceCloseAllStreams(`shutdown-${signal}`);
    console.log(`🔪 Closed ${closed} active streams`);
  } catch {}

  server.close(() => {
    console.log('✅ PROXY: HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('⚠️ PROXY: Forced exit after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('💥 PROXY Uncaught Exception:', err.message);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 PROXY Unhandled Rejection:', reason);
});
