import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteErrorFallback } from "./components/RouteErrorFallback";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Global caching doctrine: data stays fresh for 5 minutes and lives
        // in cache for 10. This stops the refetch storms where every route
        // change / window focus re-pulled the massive budget, invoice and
        // payment tables. Individual queries can still opt out by setting
        // their own staleTime.
        staleTime: 5 * 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Warm the next route (code chunk + loader) on hover/focus so sidebar tab
    // switches feel instantaneous. Query still owns data freshness.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 0,
    // Every match gets a boundary, so a thrown non-Error (e.g. `undefined`)
    // can never unmount the tree into a blank screen.
    defaultErrorComponent: ({ error, reset }) => <RouteErrorFallback error={error} reset={reset} />,
  });

  return router;
};
