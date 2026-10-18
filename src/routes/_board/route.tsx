// ═══════════════════════════════════════════════════════════════════
// src/routes/_board/route.tsx
// ═══════════════════════════════════════════════════════════════════
// Board Member layout route — the top-level gate for the entire
// /board/* namespace. Mirrors the _admin isolation pattern.
// ═══════════════════════════════════════════════════════════════════

import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { getAuthRolesSnapshot } from "@/lib/auth-roles";
import { ADMIN_LANDING, isBoardMember } from "@/lib/landing-redirect";

export const Route = createFileRoute("/_board")({
  ssr: false,
  beforeLoad: async () => {
    // ── Step 1: Authentication ──
    // Local session read (UX gate; RLS enforces server-side).
    const { data, error } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    if (error || !user) {
      throw redirect({ to: "/auth" });
    }

    // ── Step 2: Role verification ──
    // Platform roles live in `user_roles`; the executive/board title lives on
    // `profiles.executive_title` (never a `profiles.role` column).
    const roles = await getAuthRolesSnapshot();
    if (!isBoardMember(roles)) {
      if (roles.isSuperAdmin) throw redirect({ to: ADMIN_LANDING as "/" });
      throw redirect({ to: "/dashboard" });
    }

    return { user, roles, role: "board_member" as const };
  },
  component: BoardLayout,
});

function BoardLayout() {
  return (
    <AppShell forceMode="board">
      <Outlet />
    </AppShell>
  );
}
