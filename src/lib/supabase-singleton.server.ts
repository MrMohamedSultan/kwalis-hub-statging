/**
 * Centralized server-side Supabase client singletons.
 *
 * Why: every `createClient()` call allocates its own auth/realtime machinery and
 * its own fetch/keep-alive agent. Spawning one per request (or per React render
 * on the client) multiplies open sockets against PostgREST and, downstream, the
 * database's connection pool. On a serverless runtime the same isolate is reused
 * across many invocations, so the correct pattern is to build each distinct
 * client ONCE per isolate and reuse it.
 *
 * The instances are parked on `globalThis` so module re-evaluation (HMR in dev,
 * duplicated bundles in prod) can never produce a second copy.
 *
 * SECURITY: these clients use the publishable (anon) key only — RLS always
 * applies. Per-user clients are keyed by the caller's bearer token, so no
 * request can ever observe another user's authorization header. Service-role
 * access stays in `@/integrations/supabase/client.server` (already a singleton).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

type Registry = {
  anon?: Client;
  byToken: Map<string, Client>;
};

const GLOBAL_KEY = "__kwalis_supabase_singletons__";

function registry(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { byToken: new Map() };
  return g[GLOBAL_KEY]!;
}

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase environment variable(s): " +
        [!url ? "SUPABASE_URL" : null, !key ? "SUPABASE_PUBLISHABLE_KEY" : null]
          .filter(Boolean)
          .join(", "),
    );
  }
  return { url, key };
}

const AUTH_OPTS = {
  storage: undefined,
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

/**
 * Anonymous, publishable-key client for public reads from server code.
 * One instance per isolate.
 */
export function getServerSupabase(): Client {
  const reg = registry();
  if (!reg.anon) {
    const { url, key } = env();
    reg.anon = createClient<Database>(url, key, { auth: { ...AUTH_OPTS } });
  }
  return reg.anon;
}

/** Bound the per-token cache so a long-lived isolate cannot grow without limit. */
const MAX_TOKEN_CLIENTS = 50;

/**
 * Publishable-key client that acts as the signed-in caller (RLS applies as that
 * user). Reused for repeated calls carrying the same bearer token instead of
 * allocating a fresh client per tool call / request.
 */
export function getServerSupabaseForToken(token: string): Client {
  if (!token) throw new Error("A bearer token is required");
  const reg = registry();
  const cached = reg.byToken.get(token);
  if (cached) {
    // Refresh LRU recency.
    reg.byToken.delete(token);
    reg.byToken.set(token, cached);
    return cached;
  }

  const { url, key } = env();
  const client = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { ...AUTH_OPTS },
  });

  if (reg.byToken.size >= MAX_TOKEN_CLIENTS) {
    const oldest = reg.byToken.keys().next().value as string | undefined;
    if (oldest) reg.byToken.delete(oldest);
  }
  reg.byToken.set(token, client);
  return client;
}
