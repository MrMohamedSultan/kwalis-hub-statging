// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

const cloudflareWorkersShim = fileURLToPath(
  new URL("./src/shims/cloudflare-workers.ts", import.meta.url),
);

const cloudflareWorkersShimPlugin = () => ({
  name: "cloudflare-workers-shim",
  enforce: "pre" as const,
  // Apply across every Vite environment (client, ssr, nitro) and reuse the
  // same instance during build so the resolver isn't dropped mid-pipeline.
  sharedDuringBuild: true,
  resolveId(id: string) {
    if (id === "cloudflare:workers" || id.startsWith("cloudflare:")) {
      return cloudflareWorkersShim;
    }
    return null;
  },
  // Some bundler passes (Nitro's Vercel pass) skip resolveId for dynamic
  // imports marked /* @vite-ignore */, leaving a bare "cloudflare:workers"
  // specifier Rollup cannot resolve. Rewrite it to the shim at source level.
  transform(code: string, id: string) {
    if (!id.includes("@lovable.dev/mcp-js")) return null;
    if (!code.includes("cloudflare:")) return null;
    const shimSpecifier = JSON.stringify(cloudflareWorkersShim);
    const next = code.replace(/(["'])cloudflare:workers\1/g, shimSpecifier);
    if (next === code) return null;
    return { code: next, map: null };
  },
});

// vite-plugin-pwa writes the worker on closeBundle, after Nitro has already
// copied dist/client into the deploy folder. Mirror the generated worker files
// into every static output dir that exists so /sw.js is actually served.
const copyServiceWorkerToStatic = () => ({
  name: "copy-sw-to-static",
  apply: "build" as const,
  closeBundle: {
    order: "post" as const,
    sequential: true,
    async handler() {
      const { existsSync } = await import("node:fs");
      const { readdir, copyFile } = await import("node:fs/promises");
      const { join } = await import("node:path");

      const source = "dist/client";
      const targets = [".vercel/output/static", "dist/public"].filter((dir) => existsSync(dir));
      if (!existsSync(source) || targets.length === 0) return;

      const files = (await readdir(source)).filter(
        (name) => name === "sw.js" || /^workbox-[\w-]+\.js$/.test(name),
      );
      for (const target of targets) {
        for (const file of files) {
          await copyFile(join(source, file), join(target, file));
        }
      }
    },
  },
});

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // The wrapper intentionally exposes only stable Nitro options. Nitro-specific
  // Rollup settings live in nitro.config.ts so the final server bundle reads them.
  // NITRO_PRESET=node-server builds a standalone Node server (used for the self-hosted
  // test server); Lovable/Vercel builds keep the default.
  nitro: { preset: process.env.NITRO_PRESET || "vercel" },
  vite: {
    plugins: [
      cloudflareWorkersShimPlugin(),
      copyServiceWorkerToStatic(),

      mcpPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        // TanStack Start emits the browser bundle to dist/client, which Nitro
        // copies to .vercel/output/static. Without this the plugin defaults to
        // dist/ and the worker is never deployed (404 on /sw.js).
        outDir: "dist/client",
        manifest: false,
        devOptions: { enabled: false },

        workbox: {
          navigateFallback: "/",
          navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//, /^\/\.mcp/, /^\/\.well-known/],
          // Never precache HTML: a precached app shell keeps pointing at the
          // previous build's JS/CSS hashes and makes UI fixes look "not deployed".
          globPatterns: ["**/*.{js,css,svg,png,ico,webp,woff,woff2}"],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,

          runtimeCaching: [
            {
              urlPattern: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                // Cache names are versioned: bumping the suffix orphans every
                // previous runtime cache, which register-sw then deletes.
                cacheName: "html-pages-v2",
                networkTimeoutSeconds: 3,
              },
            },
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && ["style", "script", "worker"].includes(request.destination),
              handler: "StaleWhileRevalidate",
              options: { cacheName: "static-assets-v2" },
            },
            {
              urlPattern: ({ request, sameOrigin }) =>
                sameOrigin && ["image", "font"].includes(request.destination),
              handler: "CacheFirst",
              options: {
                cacheName: "images-fonts-v2",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        // Force all Vite/Nitro environments to resolve the Workers-only virtual
        // module to a safe local shim when building for Vercel's Node runtime.
        "cloudflare:workers": cloudflareWorkersShim,
      },
    },
    build: {
      rollupOptions: {
        // Externalize virtual Cloudflare Workers modules so non-Workers targets
        // (e.g. Vercel/Nitro) don't try to resolve them at build time.
        external: [/^cloudflare:/, "cloudflare:workers"],
      },
    },
    optimizeDeps: {
      exclude: ["cloudflare:workers"],
    },
    ssr: {
      // Same externalization for the SSR bundle Nitro consumes on Vercel.
      external: ["cloudflare:workers"],
      noExternal: [],
    },
    // Vite 7 environments API — TanStack Start / Nitro builds run inside a
    // dedicated "nitro" environment on Vercel. Externalize the Cloudflare
    // virtual module there too, otherwise Rollup fails to resolve it while
    // bundling @lovable.dev/mcp-js for the Vercel serverless target.
    environments: {
      nitro: {
        resolve: {
          external: ["cloudflare:workers"],
          noExternal: [],
        },
        build: {
          rollupOptions: {
            external: [/^cloudflare:/, "cloudflare:workers"],
          },
        },
      },
      ssr: {
        resolve: {
          external: ["cloudflare:workers"],
          noExternal: [],
        },
        build: {
          rollupOptions: {
            external: [/^cloudflare:/, "cloudflare:workers"],
          },
        },
      },
    },
  },
});
