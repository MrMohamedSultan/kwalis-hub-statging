#!/usr/bin/env node
/**
 * Deployment smoke test — verifies a LIVE deployment is healthy.
 *
 * Checks:
 *   1. Key routes return HTTP < 400 and non-trivial HTML (not a stuck loader).
 *   2. The served HTML references JS assets that actually download.
 *   3. The backend URL + publishable key were inlined into the live bundle
 *      (catches "missing VITE_SUPABASE_* at build time" regressions in prod).
 *   4. The backend auth endpoint responds (connection restored / reachable).
 *
 * Usage: node scripts/deploy-smoke-test.mjs [baseUrl]
 * Env:   SMOKE_BASE_URL (default https://kwalishub.com), SMOKE_TIMEOUT_MS (30000)
 * Exit:  0 = healthy, 1 = any check failed
 */
const BASE = (process.argv[2] || process.env.SMOKE_BASE_URL || "https://kwalishub.com").replace(
  /\/$/,
  "",
);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const ROUTES = ["/", "/auth"];
const SUPABASE_HOST_RE = /https:\/\/([a-z0-9]+)\.supabase\.co/;
const PUBLISHABLE_KEY_RE = /sb_publishable_[A-Za-z0-9]{10,}/;

let failures = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg) => {
  console.error(`✗ ${msg}`);
  failures++;
};

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "manual", signal: ctrl.signal });
    return { status: res.status, body: await res.text(), headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

console.log(`Deployment smoke test → ${BASE}`);

// 1. Routes render
let indexHtml = "";
for (const route of ROUTES) {
  try {
    const { status, body } = await fetchText(BASE + route);
    if (status >= 400) {
      bad(`${route} → HTTP ${status}`);
    } else if (status < 300 && body.trim().length < 200) {
      bad(`${route} → body suspiciously small (${body.length} bytes) — possible stuck loader`);
    } else {
      ok(`${route} → HTTP ${status} (${body.length} bytes)`);
    }
    if (route === "/" && body.length > indexHtml.length) indexHtml = body;
  } catch (err) {
    bad(`${route} → request failed: ${err.message}`);
  }
}

// 2 + 3. Asset download + credential injection scan
const assetPaths = [
  ...new Set([...indexHtml.matchAll(/["'](\/assets\/[^"']+\.js)["']/g)].map((m) => m[1])),
];
if (assetPaths.length === 0) {
  bad("no JS assets referenced from index HTML");
} else {
  let foundUrl = false;
  let foundKey = false;
  let downloaded = 0;
  for (const p of assetPaths.slice(0, 12)) {
    try {
      const { status, body } = await fetchText(BASE + p);
      if (status >= 400) {
        bad(`asset ${p} → HTTP ${status}`);
        continue;
      }
      downloaded++;
      if (SUPABASE_HOST_RE.test(body)) foundUrl = true;
      if (PUBLISHABLE_KEY_RE.test(body)) foundKey = true;
    } catch (err) {
      bad(`asset ${p} → ${err.message}`);
    }
  }
  if (downloaded > 0) ok(`${downloaded}/${Math.min(assetPaths.length, 12)} JS assets download`);
  if (foundUrl) ok("backend URL inlined in live bundle");
  else bad("backend URL MISSING from live bundle — VITE_SUPABASE_URL was not set at build time");
  if (foundKey) ok("publishable key inlined in live bundle");
  else
    bad(
      "publishable key MISSING from live bundle — VITE_SUPABASE_PUBLISHABLE_KEY was not set at build time",
    );

  // 4. Backend reachable
  const hostMatch = SUPABASE_HOST_RE.exec(indexHtml) || null;
  if (foundUrl) {
    // Re-derive from any asset we scanned; simplest: use project ref from env if set.
    const ref = process.env.SMOKE_SUPABASE_REF;
    if (ref) {
      try {
        const { status } = await fetchText(`https://${ref}.supabase.co/auth/v1/health`);
        // Any HTTP response (even 401/404) proves reachability.
        ok(`backend auth endpoint reachable (HTTP ${status})`);
      } catch (err) {
        bad(`backend auth endpoint unreachable: ${err.message}`);
      }
    } else {
      console.log("  (set SMOKE_SUPABASE_REF to also ping the backend auth endpoint)");
    }
  }
  void hostMatch;
}

if (failures > 0) {
  console.error(`\n✗ Deployment smoke test FAILED (${failures} check${failures > 1 ? "s" : ""})`);
  process.exit(1);
}
console.log("\n✓ Deployment smoke test passed — live site serves and is wired to the backend");
