import type { QueryClient } from "@tanstack/react-query";

const clients = new Set<QueryClient>();

export function registerProjectQueryClient(client: QueryClient) {
  clients.add(client);
  return () => {
    clients.delete(client);
  };
}

const PROJECT_SCOPED_QUERY_PREFIXES = new Set([
  "active-project",
  "budget",
  "budget-actuals",
  "budget-status",
  "executive",
  "executive-dashboard-lists",
  "fx-audit-log",
  "gl-transactions",
  "gltx-audit",
  "gltx-record",
  "operational-dashboard-lists",
  "permissions",
  "project",
  "project-fx-settings",
  "project-members",
  "project-metadata",
  "projects",
  "real-financials-v2",
  "resolved-fx-rate",
  "topsheet",
]);

function isProjectScopedQuery(
  key: readonly unknown[],
  projectId: string | null,
  previousProjectId: string | null,
) {
  const prefix = typeof key[0] === "string" ? key[0] : "";
  if (PROJECT_SCOPED_QUERY_PREFIXES.has(prefix)) return true;
  if (!projectId && !previousProjectId) return true;
  return key.some((part) => part === projectId || part === previousProjectId);
}

export async function invalidateActiveProjectQueryCaches(
  projectId: string | null,
  previousProjectId: string | null = null,
) {
  if (clients.size === 0) return;
  await Promise.all(
    Array.from(clients).map(async (client) => {
      await client.cancelQueries();
      client.removeQueries({
        predicate: (query) => {
          const key = query.queryKey;
          if (!Array.isArray(key)) return false;
          return isProjectScopedQuery(key, projectId, previousProjectId);
        },
      });
      await client.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          if (!Array.isArray(key)) return false;
          return isProjectScopedQuery(key, projectId, previousProjectId);
        },
        refetchType: "active",
      });
    }),
  );
}
