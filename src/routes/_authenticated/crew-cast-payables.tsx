import { guardRoutePermission } from "@/lib/route-permission-guard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { LockGuard } from "@/components/chrome/LockGuard";
// Legacy table kept in repo but no longer rendered here:
// import { CrewPayrollTab } from "@/components/CrewPayrollTab";

import { PayablesGridConnected } from "@/components/payables/PayablesGridConnected";
import { HardHat, Drama, Wallet } from "lucide-react";

import { useTranslation } from "react-i18next";
type Kind = "crew" | "cast";
const STORAGE_KEY = "crew-cast-payables.tab";

/**
 * Accounts Payable → Crew & Cast Payables.
 *
 * Payroll and contract obligations for crew and cast that are ready for
 * payment. A single tab switcher between the two lets accountants act on
 * both talent groups from one dedicated screen.
 */
export const Route = createFileRoute("/_authenticated/crew-cast-payables")({
  // Server-verified gate: typing the URL directly cannot bypass this.
  beforeLoad: () => guardRoutePermission("payroll.view"),
  validateSearch: (search: Record<string, unknown>): { kind?: Kind } => {
    const k = search.kind;
    return k === "crew" || k === "cast" ? { kind: k } : {};
  },
  component: CrewCastPayablesPage,
});

function CrewCastPayablesPage() {
  const { t } = useTranslation();

  const search = Route.useSearch();
  const [kind, setKind] = useState<Kind>(() => {
    if (search.kind) return search.kind;
    if (typeof window !== "undefined") {
      const s = window.localStorage.getItem(STORAGE_KEY);
      if (s === "crew" || s === "cast") return s;
    }
    return "crew";
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, kind);
  }, [kind]);

  return (
    <>
      <AppShell>
        <PageTitle title={t("crew_cast_payables.crew_cast_payables")} />
        <div className="text-xs text-muted-foreground -mt-4 mb-4" dir="rtl">
          مستحقات الطاقم والممثلين
        </div>

        <div className="rounded-xl border border-success/25 bg-success/5 p-3 mb-6">
          <div className="flex items-start gap-3">
            <Wallet className="size-4 mt-0.5 text-success shrink-0" />
            <div className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-success">
                {t("crew_cast_payables.this_is_where_payments_are_executed")}
              </span>{" "}
              Amounts arrive here automatically from approved payroll runs prepared in{" "}
              <Link
                to="/payroll-hub"
                className="font-semibold text-success underline decoration-dotted hover:text-success"
              >
                {t("crew_cast_payables.payroll_hub")}
              </Link>{" "}
              (timesheets, rate cards, overtime). Release the payment and attach proof of payment
              here — that step actualizes the Top Sheet.
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-surface/60 border border-border p-2 mb-6 inline-flex gap-2">
          <button
            onClick={() => setKind("crew")}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
              kind === "crew"
                ? "bg-gradient-to-b from-card to-card text-white ring-1 ring-border"
                : "text-foreground/80 hover:bg-muted"
            }`}
          >
            <HardHat className="size-4" />
            {t("crew_cast_payables.crew_payables")}
          </button>
          <button
            onClick={() => setKind("cast")}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
              kind === "cast"
                ? "bg-gradient-to-b from-card to-card text-white ring-1 ring-border"
                : "text-foreground/80 hover:bg-muted"
            }`}
          >
            <Drama className="size-4" />
            {t("crew_cast_payables.cast_payables")}
          </button>
        </div>

        <LockGuard scopeLabel="Crew & Cast Payables">
          <PayablesGridConnected key={kind} category={kind} />
          {/* Legacy payables table hidden — superseded by PayablesGrid above.
        <div className="mt-6">
          {kind === "crew" ? (
            <CrewPayrollTab kind="crew" heading="Crew Payables — Technical" />
          ) : (
            <CrewPayrollTab kind="cast" heading="Cast Payables — Talent" />
          )}
        </div>
        */}
        </LockGuard>
      </AppShell>
    </>
  );
}
