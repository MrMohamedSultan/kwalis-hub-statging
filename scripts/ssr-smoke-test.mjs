#!/usr/bin/env node
/**
 * SSR smoke test — boots the production server bundle under plain Node and
 * performs basic SSR route requests.
 *
 * Why this exists: the Nitro server bundle externalizes `cloudflare:workers`
 * (a virtual module only workerd provides at runtime). If any eagerly-loaded
 * chunk ever keeps a top-level `import "cloudflare:workers"`, importing the
 * bundle under Node throws ERR_MODULE_NOT_FOUND — this script fails in CI
 * before that regression reaches a deploy.
 *
 * Supports both server output shapes:
 *   - dist/server/index.mjs    (cloudflare-module: exports a fetch handler)
 *   - .output/server/index.mjs (node preset: self-listening server)
 *
 * Usage: node scripts/ssr-smoke-test.mjs [route ...]
 * Env:   SMOKE_PORT (default 3100), SMOKE_TIMEOUT_MS (default 60000)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.SMOKE_PORT || 3100);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 60000);
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTES = process.argv.length > 2 ? process.argv.slice(2) : ["/auth", "/"];

const timer = setTimeout(() => {
  console.error(`✗ SSR smoke test timed out after ${TIMEOUT_MS}ms`);
  process.exit(1);
}, TIMEOUT_MS);

const FORBIDDEN_BODY = /ERR_MODULE_NOT_FOUND|Cannot find module ['"]cloudflare:/;

async function checkRoutes() {
  let failed = false;
  for (const route of ROUTES) {
    try {
      const res = await fetch(BASE + route, { redirect: "manual" });
      const body = await res.text();
      if (res.status >= 400) {
        console.error(`✗ ${route} → HTTP ${res.status}`);
        failed = true;
      } else if (FORBIDDEN_BODY.test(body)) {
        console.error(`✗ ${route} → body contains a module-resolution error`);
        failed = true;
      } else {
        console.log(`✓ ${route} → HTTP ${res.status} (${body.length} bytes)`);
      }
    } catch (err) {
      console.error(`✗ ${route} → request failed: ${err.message}`);
      failed = true;
    }
  }
  return failed;
}

async function waitForServer() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (even 404/500) means the listener is up.
      await fetch(BASE + "/", { redirect: "manual" });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

/** cloudflare-module shape: import the fetch handler and wrap it in node:http. */
async function serveFetchHandler(entryPath) {
  const mod = await import(pathToFileURL(entryPath).href);
  const handler = mod.default ?? mod;
  if (typeof handler.fetch !== "function") {
    throw new Error(`${entryPath} does not export a fetch handler`);
  }
  const ctx = { waitUntil: () => {} };
  const server = http.createServer(async (req, res) => {
    try {
      const response = await handler.fetch(
        new Request(`${BASE}${req.url}`, { method: req.method, headers: req.headers }),
        process.env,
        ctx,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        for await (const chunk of response.body) res.write(chunk);
      }
      res.end();
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(err));
    }
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  return () => new Promise((r) => server.close(r));
}

/** node preset shape: the bundle starts its own listener when executed. */
function spawnNodeServer(entryPath) {
  const child = spawn(process.execPath, [entryPath], {
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[server] exited early with code ${code}`);
    }
  });
  return () => child.kill("SIGTERM");
}

const cfEntry = path.resolve("dist/server/index.mjs");
const nodeEntry = path.resolve(".output/server/index.mjs");

let stop;
if (existsSync(cfEntry)) {
  console.log(`Starting server bundle: ${cfEntry}`);
  // A top-level cloudflare:workers import anywhere eager throws right here.
  stop = await serveFetchHandler(cfEntry);
} else if (existsSync(nodeEntry)) {
  console.log(`Starting server bundle: ${nodeEntry}`);
  stop = spawnNodeServer(nodeEntry);
} else {
  console.error("✗ No server bundle found (expected dist/server or .output/server).");
  console.error("  Run `bun run build` before this smoke test.");
  process.exit(1);
}

try {
  if (!(await waitForServer())) {
    console.error("✗ Server did not start listening in time");
    process.exitCode = 1;
  } else if (await checkRoutes()) {
    process.exitCode = 1;
  } else {
    console.log("✓ SSR smoke test passed — server bundle boots and serves SSR routes");
  }
} finally {
  clearTimeout(timer);
  await stop();
}
