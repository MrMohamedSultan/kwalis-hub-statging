/**
 * Permission-denied audit logger.
 *
 * Fires a server-side audit_logs entry (category="auth", severity="warning",
 * action="permission.denied") whenever a user is stopped by a permission
 * gate — GuardedButton clicks, requireOrToast checks, PermissionDeniedBanner
 * views, and section-level AccessDenied panels.
 *
 * Fire-and-forget with a short in-memory dedupe window so a single UI
 * interaction (e.g. a disabled button clicked repeatedly) produces one row.
 */
import { useStore } from "@/lib/store";
import { logAuditEvent } from "@/lib/audit.functions";
import type { Permission } from "@/lib/rbac";

const DEDUPE_MS = 15_000;
const recent = new Map<string, number>();

export type PermissionDenialContext = {
  perm: Permission | string;
  action: string; // human-readable, e.g. "export top sheet"
  surface?: string; // component/panel where denial happened
  route?: string; // pathname
  extra?: Record<string, unknown>;
};

export function logPermissionDenied(ctx: PermissionDenialContext) {
  try {
    const route =
      ctx.route ?? (typeof window !== "undefined" ? window.location.pathname : undefined);
    const key = `${ctx.perm}|${ctx.action}|${ctx.surface ?? ""}|${route ?? ""}`;
    const now = Date.now();
    const last = recent.get(key) ?? 0;
    if (now - last < DEDUPE_MS) return;
    recent.set(key, now);

    // Resolve active org/project from the app store (best-effort).
    const state = useStore.getState();
    const projectId = state.activeProjectId ?? null;
    const project = state.projects?.find((p) => p.id === projectId) ?? null;
    const orgId = project?.organizationId ?? null;

    void logAuditEvent({
      data: {
        category: "auth",
        severity: "warning",
        action: "permission.denied",
        entity: String(ctx.perm),
        summary: `Permission denied: ${ctx.action} (missing "${ctx.perm}")`,
        organization_id: orgId,
        project_id: projectId,
        details: {
          permission: ctx.perm,
          attempted_action: ctx.action,
          surface: ctx.surface ?? null,
          route: route ?? null,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          ...ctx.extra,
        },
      },
    }).catch(() => {
      /* audit best-effort — never surface to user */
    });
  } catch {
    /* swallow — logging failures must not break the UI */
  }
}
