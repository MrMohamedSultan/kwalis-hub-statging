import { useSyncExternalStore } from "react";
import type { AuthRolesSnapshot } from "@/lib/auth-roles";
import type { PermissionState } from "@/lib/permissions/types";
import { viewableOperationalModules } from "@/lib/permissions/landing";

let workModeUserId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function canEnterExecutiveWorkMode(
  roles: AuthRolesSnapshot,
  permissions: PermissionState,
): boolean {
  return (
    roles.isSuperAdmin ||
    roles.isAdmin ||
    roles.adminOrgIds.length > 0 ||
    viewableOperationalModules(permissions).length > 0
  );
}

export function enableExecutiveWorkMode(userId: string) {
  if (workModeUserId === userId) return;
  workModeUserId = userId;
  emit();
}

export function clearExecutiveWorkMode() {
  if (workModeUserId === null) return;
  workModeUserId = null;
  emit();
}

export function isExecutiveWorkMode(userId: string | null): boolean {
  return Boolean(userId && workModeUserId === userId);
}

export function useExecutiveWorkMode(userId: string | null): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => isExecutiveWorkMode(userId),
    () => false,
  );
}