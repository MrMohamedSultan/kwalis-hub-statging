// ============================================================
// Audited storage access.
//
// Wraps `supabase.storage` so that *denied* reads on private
// document buckets (receipts, contracts, support-attachments,
// project-files…) are recorded in `audit_logs` for security
// monitoring. Successful reads are NOT logged — only refusals.
//
// Usage is a drop-in swap:
//
//   import { storageAudited } from "@/lib/storage-audit";
//   const { data, error } = await storageAudited
//     .from("receipts").createSignedUrl(path, 300);
//
// Every other method (upload, remove, list, getPublicUrl…) is
// forwarded untouched, so behaviour is identical.
// ============================================================
import { supabase } from "@/integrations/supabase/client";
import { recordAudit } from "@/lib/audit-log";

/** Storage methods whose failure means "this user may not read this object". */
const READ_METHODS = new Set(["createSignedUrl", "createSignedUrls", "download"]);

/**
 * Storage refuses unauthorised reads with a generic "Object not found"
 * (400/404) so that object existence is not leaked. Treat those, plus
 * explicit authorisation errors, as denials worth recording.
 */
function isDenial(error: unknown): boolean {
  if (!error) return false;
  const e = error as { message?: string; statusCode?: string | number; status?: number };
  const msg = String(e.message ?? "").toLowerCase();
  const code = String(e.statusCode ?? e.status ?? "");
  return (
    code === "400" ||
    code === "401" ||
    code === "403" ||
    code === "404" ||
    msg.includes("not found") ||
    msg.includes("unauthorized") ||
    msg.includes("not authorized") ||
    msg.includes("permission") ||
    msg.includes("row-level security") ||
    msg.includes("violates")
  );
}

// De-duplicate identical denials so a re-rendering list cannot flood the log.
const seen = new Map<string, number>();
const DEDUPE_WINDOW_MS = 60_000;

function shouldLog(key: string): boolean {
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  seen.set(key, now);
  if (seen.size > 200) {
    for (const [k, t] of seen) if (now - t > DEDUPE_WINDOW_MS) seen.delete(k);
  }
  return true;
}

/** Only the folder prefix is logged — never a full signed URL or token. */
function safePath(path: unknown): string {
  const p = typeof path === "string" ? path : Array.isArray(path) ? path.join(",") : "";
  return p.split("?")[0].slice(0, 200);
}

export function logDeniedStorageRead(
  bucket: string,
  method: string,
  path: unknown,
  error: unknown,
): void {
  const p = safePath(path);
  if (!shouldLog(`${bucket}:${method}:${p}`)) return;
  recordAudit({
    category: "auth",
    action: "storage.read_denied",
    severity: "warning",
    entity: `${bucket}/${p}`,
    summary: `Denied ${method} on private bucket "${bucket}"`,
    details: {
      bucket,
      method,
      path: p,
      reason: String((error as { message?: string })?.message ?? "denied").slice(0, 300),
    },
  });
}

type BucketApi = ReturnType<typeof supabase.storage.from>;

function wrapBucket(bucket: string): BucketApi {
  const api = supabase.storage.from(bucket);
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string" || !READ_METHODS.has(prop)) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        return Promise.resolve(result).then((res) => {
          const err = (res as { error?: unknown } | null)?.error;
          if (isDenial(err)) logDeniedStorageRead(bucket, prop, args[0], err);
          return res;
        });
      };
    },
  }) as BucketApi;
}

/** Drop-in replacement for `supabase.storage` that audits denied reads. */
export const storageAudited = {
  from: wrapBucket,
};
