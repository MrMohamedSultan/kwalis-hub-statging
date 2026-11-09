// ═══════════════════════════════════════════════════════════════════
// src/routes/_board/route.tsx
// ═══════════════════════════════════════════════════════════════════
// The former Board Member portal (/board/*). Since db/pending/206 board
// members work in the main app with a narrowed shell (src/lib/board-access.ts:
// Dashboard, Budget, Production Timeline, Cash flow, Notifications) and
// approve the budget on the Budget page. Old links keep working: every
// /board path forwards to its page in the main app.
// ═══════════════════════════════════════════════════════════════════

import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { legacyBoardPortalTarget } from "@/lib/board-access";

export const Route = createFileRoute("/_board")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user) {
      throw redirect({ to: "/auth" });
    }
    const target = legacyBoardPortalTarget(location.pathname);
    throw redirect({ to: target.to as "/", search: (target.search ?? {}) as never });
  },
  component: () => <Outlet />,
});
