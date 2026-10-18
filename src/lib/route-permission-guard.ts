// ============================================================
// Server-trusted route gate for approval / workflow screens.
//
// Use inside a route's `beforeLoad`:
//
//   export const Route = createFileRoute("/_authenticated/payment-approvals")({
//     beforeLoad: () => guardRoutePermission("payments.approve"),
//     component: PaymentApprovalsPage,
//   });
//
// The decision is made by the server (`checkRoutePermission`), which
// resolves super-admin status, org role and custom roles such as
// "Board Member". Typing the URL directly therefore cannot bypass it.
// Client-side <RouteGuard> stays in place as a rendering fallback.
// ============================================================
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { checkRoutePermission } from "@/lib/rbac-permissions.functions";
import { useStore } from "@/lib/store";
import type { Permission } from "@/lib/rbac";

export async function guardRoutePermission(
  perm: Permission,
  redirectTo: string = "/dashboard",
): Promise<void> {
  // Only meaningful in the browser: the _authenticated subtree is ssr:false
  // and the bearer token lives in the client session.
  if (typeof window === "undefined") return;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw redirect({ to: "/auth" });
  }

  let allowed = false;
  try {
    // Pass the active scope so the org-aware permission matrix resolves for
    // the project/organization the user is actually working in.
    const s = useStore.getState();
    const projectId = s.activeProjectId ?? null;
    const orgId = projectId
      ? (s.projects.find((p) => p.id === projectId)?.organizationId ?? null)
      : null;
    const result = await checkRoutePermission({ data: { perm, orgId, projectId } });
    allowed = !!result?.allowed;
  } catch (err) {
    // Network/transport failure — fail closed for approval screens.
    console.warn("[rbac] route permission check failed", err);
    allowed = false;
  }

  if (!allowed) {
    throw redirect({ to: redirectTo as never });
  }
}
