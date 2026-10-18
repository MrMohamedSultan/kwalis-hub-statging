import { useEffect } from "react";

/**
 * Boundary fallback used as the router-wide `defaultErrorComponent`.
 *
 * Without a default, a match that throws a non-Error value (e.g. `undefined`)
 * escapes every boundary — React logs "Uncaught undefined" from
 * <MatchInnerImpl> and the whole tree unmounts into a blank screen.
 */
export function RouteErrorFallback({ error, reset }: { error: unknown; reset?: () => void }) {
  useEffect(() => {
    // Preserve the raw value (may not be an Error) for Server/Client logs.
    console.error("[route-error]", error);
  }, [error]);

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Something went wrong while loading this screen.";

  return (
    <div className="min-h-[60vh] grid place-items-center bg-background text-foreground p-6">
      <div className="text-center max-w-md">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground mt-2 break-words">{message}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset?.()}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-sm font-medium"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-sm font-medium"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
