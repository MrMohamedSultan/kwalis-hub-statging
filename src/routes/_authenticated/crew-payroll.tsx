import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Retired: the old Crew Payroll screen set instalment statuses by hand,
 * which the database now refuses (approval workflow, db/pending/176).
 * Instalments are requested, approved and paid from Crew & Cast Payables.
 */
export const Route = createFileRoute("/_authenticated/crew-payroll")({
  beforeLoad: () => {
    throw redirect({ to: "/crew-cast-payables", search: { kind: "crew" }, replace: true });
  },
});
