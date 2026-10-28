import { createFileRoute } from "@tanstack/react-router";

/**
 * X25 — health endpoint for uptime monitoring (docs/MONITORING.md).
 *
 *   GET /api/health  → 200 {"status":"ok",...}   app and database answer
 *                    → 503 {"status":"degraded"} database or auth unreachable
 *
 * It calls public.health_check() and /auth/v1/health with the PUBLIC
 * (publishable) key only, returns no data, no versions of dependencies and
 * no secrets, and is safe to expose without a session.
 */
const STARTED_AT = Date.now();

async function probe(url: string, init: RequestInit): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(3000) });
    return { ok: res.ok, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY;
        const headers = { "Cache-Control": "no-store" };
        if (!url || !key) {
          return Response.json(
            { status: "degraded", app: "up", db: "not configured" },
            { status: 503, headers },
          );
        }
        const base = url.replace(/\/+$/, "");
        const [db, auth] = await Promise.all([
          probe(`${base}/rest/v1/rpc/health_check`, {
            method: "POST",
            // New-style sb_publishable_ keys are not JWTs: send them as apikey only.
            headers: key.startsWith("sb_")
              ? { apikey: key, "Content-Type": "application/json" }
              : { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: "{}",
          }),
          probe(`${base}/auth/v1/health`, { headers: { apikey: key } }),
        ]);
        const ok = db.ok && auth.ok;
        return Response.json(
          {
            status: ok ? "ok" : "degraded",
            app: "up",
            uptime_s: Math.round((Date.now() - STARTED_AT) / 1000),
            db: db.ok ? "up" : "down",
            db_ms: db.ms,
            auth: auth.ok ? "up" : "down",
            checked_at: new Date().toISOString(),
          },
          { status: ok ? 200 : 503, headers },
        );
      },
    },
  },
});
