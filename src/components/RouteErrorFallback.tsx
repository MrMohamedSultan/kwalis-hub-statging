import { UnexpectedErrorPage } from "@/components/ErrorPages";

/**
 * Boundary fallback used as the router-wide `defaultErrorComponent`.
 *
 * Without a default, a match that throws a non-Error value (e.g. `undefined`)
 * escapes every boundary — React logs "Uncaught undefined" from
 * <MatchInnerImpl> and the whole tree unmounts into a blank screen.
 * X22: the friendly page never shows the raw message in production.
 */
export function RouteErrorFallback({ error, reset }: { error: unknown; reset?: () => void }) {
  return <UnexpectedErrorPage error={error} reset={reset} />;
}
