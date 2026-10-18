#!/usr/bin/env node
/**
 * Post-build env-injection check.
 *
 * Why this exists: the browser Supabase client reads import.meta.env.VITE_SUPABASE_*,
 * which Vite inlines at BUILD time. If a build ever runs without those bindings
 * (e.g. a deploy that raced binding regeneration), the site renders but every
 * auth/DB call fails at runtime with "Missing Supabase environment variable(s)".
 * This script scans the built client assets and fails the build before that
 * regression can ship.
 *
 * Usage: node scripts/check-env-injection.mjs
 * Runs AFTER `vite build` (expects dist/client or .output/public assets).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const CANDIDATE_DIRS = ["dist/client", "dist", ".output/public"];
const SUPABASE_HOST_RE = /https:\/\/[a-z0-9]+\.supabase\.co/;
const PUBLISHABLE_KEY_RE = /sb_publishable_[A-Za-z0-9]{10,}/;
const MISSING_ENV_MSG = /Missing Supabase environment variable\(s\)/;

function collectJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectJsFiles(full, out);
    else if (entry.endsWith(".js") || entry.endsWith(".html")) out.push(full);
  }
  return out;
}

const root = CANDIDATE_DIRS.find((d) => existsSync(d));
if (!root) {
  console.error("✗ No build output found (checked: " + CANDIDATE_DIRS.join(", ") + ")");
  console.error("  Run `bun run build` before this check.");
  process.exit(1);
}

const files = collectJsFiles(root);
if (files.length === 0) {
  console.error(`✗ No JS/HTML assets found under ${root}`);
  process.exit(1);
}

let foundUrl = false;
let foundKey = false;
const missingMsgHits = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (SUPABASE_HOST_RE.test(content)) foundUrl = true;
  if (PUBLISHABLE_KEY_RE.test(content)) foundKey = true;
  // The error message string itself is expected (it's in the client source);
  // what matters is whether the real values are ALSO present.
  if (MISSING_ENV_MSG.test(content)) missingMsgHits.push(file);
}

let failed = false;
if (!foundUrl) {
  console.error("✗ VITE_SUPABASE_URL was NOT inlined into any built asset.");
  console.error("  The deploy would boot without a backend connection.");
  failed = true;
} else {
  console.log("✓ Supabase URL found in built assets");
}
if (!foundKey) {
  console.error("✗ VITE_SUPABASE_PUBLISHABLE_KEY was NOT inlined into any built asset.");
  failed = true;
} else {
  console.log("✓ Publishable key found in built assets");
}

if (failed) {
  console.error("");
  console.error("Fix: ensure VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are set");
  console.error("in the build environment (Lovable injects them automatically for Cloud");
  console.error("projects; for external CI add them to the workflow env). Then rebuild.");
  process.exit(1);
}

console.log(`✓ Env-injection check passed (${files.length} assets scanned under ${root})`);
