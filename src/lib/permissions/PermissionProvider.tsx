// ═══════════════════════════════════════════════════════════════════
// src/lib/permissions/PermissionProvider.tsx
// Phase 4 — Permission State Layer provider.
//
// Owns the loading race explicitly: gated chrome is NEVER rendered
// until the server-verified permission snapshot has resolved. While
// loading, a full-screen skeleton is shown instead of children, so no
// sidebar item, button, or route can flicker into view and then
// disappear (or worse, briefly appear for a denied user).
//
// On fetch/validation failure the provider fails closed: children are
// replaced by a blocking error screen with a manual retry.
// ═══════════════════════════════════════════════════════════════════

import { createContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { myPermissionsQueryOptions } from "./queries";
import { EMPTY_PERMISSION_STATE, buildPermissionState, type PermissionState } from "./types";

export const PermissionContext = createContext<PermissionState>(EMPTY_PERMISSION_STATE);

/** Full-screen skeleton shown while the permission snapshot resolves. */
export function PermissionLoadingScreen() {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-background"
      role="status"
      aria-busy="true"
      aria-label={t("rbac.loadingPermissions")}
    >
      <div dir="ltr" className="flex items-center gap-2">
        <img
          src="/kwalis-logo-dark.png"
          alt=""
          className="w-36 h-auto object-contain opacity-90 block dark:hidden"
        />
        <img
          src="/kwalis-logo.png"
          alt=""
          className="w-36 h-auto object-contain opacity-90 hidden dark:block"
        />
      </div>

      <div className="flex w-64 flex-col gap-3">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <span className="sr-only">{t("rbac.loadingPermissions")}</span>
    </div>
  );
}

/** Fail-closed blocking state when the snapshot cannot be loaded. */
function PermissionErrorScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <ShieldAlert className="size-10 text-destructive" />
      <p className="max-w-md text-sm text-muted-foreground">{t("rbac.permissionsLoadError")}</p>
      <Button variant="outline" onClick={onRetry}>
        {t("rbac.retry")}
      </Button>
    </div>
  );
}

export function PermissionProvider({ children }: { children: ReactNode }) {
  const query = useQuery(myPermissionsQueryOptions());

  const state = useMemo<PermissionState>(() => {
    if (query.isPending) return EMPTY_PERMISSION_STATE;
    if (query.isError || !query.data) return { ...EMPTY_PERMISSION_STATE, status: "error" };
    return buildPermissionState(query.data);
  }, [query.isPending, query.isError, query.data]);

  // The loading race is handled HERE, once — descendants only ever render
  // against a fully resolved, server-verified snapshot.
  if (state.status === "loading") return <PermissionLoadingScreen />;
  if (state.status === "error") {
    return <PermissionErrorScreen onRetry={() => void query.refetch()} />;
  }

  return <PermissionContext.Provider value={state}>{children}</PermissionContext.Provider>;
}
