import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { LockGuard } from "@/components/chrome/LockGuard";
import { parseOpenParam } from "@/lib/document-refs";
import { FinancialSummary, InvoiceTab } from "./accounting";

import { useTranslation } from "react-i18next";
/**
 * Procurement → Invoices.
 */
export const Route = createFileRoute("/_authenticated/invoices")({
  validateSearch: (search: Record<string, unknown>): { focus?: string; open?: string } => {
    const f = search.focus;
    const open = parseOpenParam(search.open);
    return {
      ...(typeof f === "string" && f ? { focus: f } : {}),
      ...(open ? { open } : {}),
    };
  },
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const { t } = useTranslation();

  const { focus, open } = Route.useSearch();
  return (
    <>
      <AppShell>
        <PageTitle title={t("invoices.invoices")} />
        <div className="text-xs text-muted-foreground -mt-4 mb-4" dir="rtl">
          الفواتير
        </div>
        <FinancialSummary />
        <LockGuard scopeLabel="Invoices">
          <InvoiceTab focus={open ?? focus} />
        </LockGuard>
      </AppShell>
    </>
  );
}
