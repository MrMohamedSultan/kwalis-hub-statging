/**
 * X22 — what an error screen may show. Technical messages (SQL, stack
 * traces, internal ids) are for developers: in a production build the user
 * only sees the friendly text of the page; the raw value still goes to the
 * console for support.
 */
export function userFacingErrorMessage(error: unknown, isDev: boolean): string | undefined {
  if (!isDev) return undefined;
  if (error instanceof Error) return error.message || undefined;
  if (typeof error === "string") return error || undefined;
  return undefined;
}

/** A refusal by RLS / a permission check (Postgres 42501, PostgREST 403). */
export function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; status?: unknown; message?: unknown };
  if (e.code === "42501" || e.status === 403) return true;
  const m = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return m.includes("permission denied") || m.includes("row-level security");
}

export const IS_DEV = Boolean(import.meta.env?.DEV);
