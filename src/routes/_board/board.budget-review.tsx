// ═══════════════════════════════════════════════════════════════════
// src/routes/_board/board.budget-review.tsx
// ═══════════════════════════════════════════════════════════════════
// Former board budget review. It approved by writing projects.budget_status
// directly, which the database refuses since db/pending/206. Board members
// now review and decide on the Budget page (Status & approvals →
// decide_budget_approval). This route only forwards there; it reads and
// writes nothing.
// ═══════════════════════════════════════════════════════════════════
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_board/board/budget-review")({
  validateSearch: (search: Record<string, unknown>) => ({
    projectId: (search.projectId as string) || "",
  }),
  beforeLoad: () => {
    throw redirect({ to: "/budget" as "/", search: { focus: "governance" } as never });
  },
  component: () => null,
});
