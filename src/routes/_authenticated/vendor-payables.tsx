import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { LockGuard } from "@/components/chrome/LockGuard";
// Legacy table kept in repo but no longer rendered here:
// import { CrewPayrollTab } from "@/components/CrewPayrollTab";

import { PayablesGridConnected } from "@/components/payables/PayablesGridConnected";

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
/**
 * Accounts Payable → Vendor Payables.
 */
export const Route = createFileRoute("/_authenticated/vendor-payables")({
  component: () => (
    <>
      <AppShell>
        <PageTitle title={i18n.t("vendor_payables.vendor_payables")} />
        <div className="text-xs text-muted-foreground -mt-4 mb-4" dir="rtl">
          مستحقات الموردين
        </div>
        <LockGuard scopeLabel="Vendor Payables">
          <PayablesGridConnected category="vendor" />
          {/* Legacy payables table hidden — superseded by PayablesGrid above.
          <div className="mt-6">
            <CrewPayrollTab kind="vendor" heading="Vendor Payables — Ready for Payment" />
          </div>
          */}
        </LockGuard>
      </AppShell>
    </>
  ),
});
