import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { partytownVite } from "@builder.io/partytown/utils";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    // 2026-05-12 perf: copy Partytown's runtime library into
    // dist/public/~partytown so that the `<script type="text/partytown">`
    // tags in index.html (Microsoft Clarity) and the `script.type =
    // 'text/partytown'` GA loader (src/lib/analytics.ts) can hand work
    // off to a Web Worker instead of running on the main thread.
    //
    // SCOPE: Clarity + GA only. Google AdSense and the Cast SDK
    // intentionally stay on the main thread for their synchronous DOM access.
    partytownVite({
      dest: path.resolve(import.meta.dirname, "dist/public/~partytown"),
    }),
  ],
  css: {
    postcss: {
      plugins: [
        (await import("tailwindcss")).default,
        (await import("autoprefixer")).default,
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  esbuild: {
    // Remove only debug output from release bundles, preserving argument side
    // effects and genuine console.warn/error diagnostics. Never override console.
    pure: process.env.NODE_ENV === 'production' ? ['console.log', 'console.debug', 'console.info'] : [],
  },
  build: {
    manifest: true,
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Target modern evergreen browsers only (all support native ESM, dynamic
    // import, optional chaining, nullish coalescing). Output is behaviourally
    // identical to the previous default ('modules') for these browsers but
    // avoids legacy transpilation/helpers → smaller, faster-parsing bundles.
    target: "es2020",
    // Every target browser supports <link rel="modulepreload"> natively, so
    // the injected polyfill + its synchronous shim is dead weight. Dropping it
    // removes ~1 KB from the entry and one blocking micro-task at startup.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // 2026-05-12 perf (PageSpeed mobile=43, TBT=1,120ms): the prior
        // setup produced 50+ tiny per-icon chunks (each 2.5–3 KiB) for
        // lucide-react. They were eagerly modulepreloaded with the entry,
        // adding 50+ HTTP request round-trips on the critical chain — by
        // far the largest TBT contributor in the network waterfall.
        //
        // SAFETY: this is a `manualChunks(id)` FUNCTION, not the array
        // form. It is evaluated AFTER Rollup's tree-shaking, so only
        // icons that are actually imported somewhere in the app end up
        // in the `icons` chunk. The 6 MB ballooning warning in the
        // earlier comment was caused by `manualChunks: { icons:
        // ['lucide-react'] }` (array form, which forces the whole
        // package's barrel index in). The function form below is the
        // safe pattern documented for this exact use-case.
        //
        // Result expected on rebuild:
        //   ~50 chunks × 2.5 KiB → 1 chunk × ~80 KiB gzipped (~40 KiB).
        //   PageSpeed mobile target: TBT < 600ms, score > 70.
        manualChunks(id: string) {
          // Group ALL used lucide-react icon modules into a single chunk.
          // Each icon ships as `lucide-react/dist/esm/icons/<name>.js` —
          // this matches both ESM and the rare CJS fallback paths.
          if (
            id.includes('node_modules/lucide-react/dist/esm/icons/') ||
            id.includes('node_modules/lucide-react/dist/cjs/icons/')
          ) {
            return 'icons-lucide';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: false,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
