// ═══════════════════════════════════════════════════════════════════
// src/routes/_platform-hub/route.tsx
// ═══════════════════════════════════════════════════════════════════
// Platform Hub layout route — the gate for the entire /platform-hub/*
// namespace. Super Admins only; everyone else is bounced to their own
// branch. Isolation is achieved by ROUTING, never by a mode flag.
// ═══════════════════════════════════════════════════════════════════

import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { getAuthRolesSnapshot } from "@/lib/auth-roles";
import { BOARD_LANDING, ORG_LANDING, isBoardMember } from "@/lib/landing-redirect";

export const Route = createFileRoute("/_platform-hub")({
  ssr: false,
  beforeLoad: async () => {
    // Local session read (UX gate; RLS enforces server-side).
    const { data, error } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    if (error || !user) {
      throw redirect({ to: "/auth" });
    }

    // Platform roles live in `user_roles` (never on `profiles.role`).
    const roles = await getAuthRolesSnapshot();
    if (!roles.isSuperAdmin) {
      if (isBoardMember(roles)) throw redirect({ to: BOARD_LANDING as "/" });
      throw redirect({ to: ORG_LANDING as "/" });
    }

    return { user, roles, role: "super_admin" as const };
  },
  component: PlatformHubLayout,
});

function PlatformHubLayout() {
  return (
    <AppShell forceMode="platform">
      <Outlet />
    </AppShell>
  );
}
