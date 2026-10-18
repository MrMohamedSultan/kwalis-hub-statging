// Vercel builds the app for a Node/Nitro runtime, but @lovable.dev/mcp-js can
// lazily import Cloudflare's virtual Workers module while checking metrics env.
// This shim provides the minimal compatible export so the Vercel bundle can
// resolve that import without depending on a Cloudflare-only runtime module.
export const env: Record<string, string | undefined> = {};

export default { env };
