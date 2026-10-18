import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  // Optional preset override for CI smoke tests: NITRO_PRESET=node produces a
  // plain Node server bundle (.output/server/index.mjs) that GitHub runners can
  // boot directly. When unset, this key is undefined and the platform-selected
  // preset (Cloudflare locally, Vercel on Vercel) stays in charge.
  preset: process.env["NITRO_PRESET"] ?? undefined,
  rollupConfig: {
    external: ["cloudflare:workers"],
  },
});
