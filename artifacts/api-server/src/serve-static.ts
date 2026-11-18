import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import type { ServerResponse } from 'node:http';
import { isKnownSpaShellRoute } from './seo/spa-shell-route';

// HTML contains the current deployment's hashed asset URLs. Caches may retain
// it for conditional requests, but must validate before reuse after a deploy.
// Immutable caching remains appropriate for the existing hashed assets only.
export const HTML_CACHE_CONTROL = 'public, no-cache, max-age=0, must-revalidate';

// Public images must not inherit the non-SEO SPA shell's noindex. Unrelated
// assets, private routes and missing files retain their existing policy.
const PUBLIC_BRAND_IMAGES = new Set([
  'favicon.ico', 'favicon.svg', 'favicon.png', 'apple-touch-icon.png', 'header-logo-80w.webp',
  'logo-icon.webp', 'images/logo-icon.webp',
]);

function revalidateSuccessfulHtml(res: Pick<ServerResponse, 'statusCode' | 'getHeader' | 'setHeader' | 'removeHeader'>) {
  if (res.statusCode >= 400 || /\bno-store\b/i.test(String(res.getHeader('Cache-Control') || ''))) return;
  res.setHeader('Cache-Control', HTML_CACHE_CONTROL);
  res.removeHeader('Expires');
}

export function log(message: string, source = "express") {
  if (process.env.NODE_ENV === 'production') return;
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

export function serveStatic(app: Express, distPath = path.resolve(import.meta.dirname, "public")) {

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // The TV package contains posters only; versioned videos stream from our edge.
  app.use('/media/tv-atmospheres', express.static(path.join(distPath, 'media/tv-atmospheres'), {
    etag:true, lastModified:true, maxAge:'1y', immutable:true,
    setHeaders:(res)=>{res.set({'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges','X-Content-Type-Options':'nosniff'});},
  }));

  const staticFiles = express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) revalidateSuccessfulHtml(res);
      const relative = path.relative(distPath, filePath).split(path.sep).join('/');
      if (PUBLIC_BRAND_IMAGES.has(relative)
        || /^(?:images\/|uploads\/genres\/).+\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(relative)) {
        res.removeHeader('X-Robots-Tag');
      }
      if (['favicon.ico', 'favicon.png', 'favicon.svg', 'apple-touch-icon.png'].includes(relative)) {
        res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
        res.removeHeader('Expires');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
    },
  });
  app.use((req, res, next) => {
    const originalRobots = res.getHeader('X-Robots-Tag');
    staticFiles(req, res, error => {
      // setHeaders precedes conditional/range validation in express.static.
      // A real image file can still become a 412/416 error, not an image.
      if (error && !res.headersSent && originalRobots !== undefined) {
        res.setHeader('X-Robots-Tag', originalRobots);
      }
      next(error);
    });
  });

  // Missing build chunks and genre uploads are files, not SPA navigations.
  // A 200 HTML shell at an image URL silently breaks the carousel and can
  // poison an edge/browser cache. Existing files were served above.
  app.use(['/assets', '/uploads/genres'], (_req, res) => {
    res.removeHeader('Expires');
    res.status(404).set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).type('text/plain').send('Not found');
  });

  // Unknown sitemap probes are files, not client-side page routes. Registered
  // manifests (including their intentional 503/410 responses) run before this.
  app.get(/\/(?:[^/]*sitemap[^/]*)\.xml$/i, (_req, res) => {
    res.status(404).set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }).type('text/plain').send('Sitemap not found');
  });

  app.use("/*splat", (req, res) => {
    if (res.statusCode < 400 && !isKnownSpaShellRoute(req.originalUrl)) {
      res.removeHeader('Expires');
      res.status(404).set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, follow' });
    }
    revalidateSuccessfulHtml(res);
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
