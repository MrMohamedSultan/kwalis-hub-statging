import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { LockGuard } from "@/components/chrome/LockGuard";
import { FinancialSummary, InvoiceTab } from "./accounting";

import { useTranslation } from "react-i18next";
/**
 * Procurement → Invoices.
 */
export const Route = createFileRoute("/_authenticated/invoices")({
  validateSearch: (search: Record<string, unknown>): { focus?: string } => {
    const f = search.focus;
    return typeof f === "string" && f ? { focus: f } : {};
  },
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const { t } = useTranslation();

  const { focus } = Route.useSearch();
  return (
    <>
      <AppShell>
        <PageTitle title={t("invoices.invoices")} />
        <div className="text-xs text-muted-foreground -mt-4 mb-4" dir="rtl">
          الفواتير
        </div>
        <FinancialSummary />
        <LockGuard scopeLabel="Invoices">
          <InvoiceTab focus={focus} />
        </LockGuard>
      </AppShell>
    </>
  );
}
