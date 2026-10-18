import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { RoleManagementPage } from "@/components/role-management/RoleManagementPage";
import { redirect } from "@tanstack/react-router";
import { peekAuthRoles, requireRoles } from "@/lib/auth-roles";

const allowed = (r: { isSuperAdmin: boolean; adminOrgIds: string[] }) =>
  r.isSuperAdmin || r.adminOrgIds.length > 0;

export const Route = createFileRoute("/_authenticated/role-management")({
  // Workspace-level role matrix: platform owners or org owners/admins only.
  // Warm navigations resolve synchronously (no pending screen).
  beforeLoad: () => {
    const cached = peekAuthRoles();
    if (cached?.userId) {
      if (!allowed(cached)) throw redirect({ to: "/dashboard" });
      return;
    }
    return requireRoles(allowed, "/dashboard");
  },
  head: () => ({
    meta: [
      { title: "Role Management — Kwalis HUB" },
      {
        name: "description",
        content: "Fine-grained role and permission matrix administration.",
      },
      { property: "og:title", content: "Role Management — Kwalis HUB" },
      {
        property: "og:description",
        content: "Fine-grained role and permission matrix administration.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <RoleManagementPage />
    </AppShell>
  ),
});
