import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { CrewPayrollTab } from "@/components/CrewPayrollTab";
import { ContractMilestonePayables } from "@/components/ContractMilestonePayables";
import { HardHat } from "lucide-react";

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/crew-payroll")({
  component: () => (
    <>
      <AppShell>
        <PageTitle title={i18n.t("crew_payroll.crew_payroll_technical")} />
        <div className="text-xs text-muted-foreground -mt-4 mb-4" dir="rtl">
          مسير رواتب طاقم العمل
        </div>
        <p className="text-sm text-muted-foreground mb-4 inline-flex items-center gap-2">
          <HardHat className="size-4 text-primary" />
          Approved & paid entries post to Top Sheet actuals; contract totals feed the Cash Flow
          engine.
        </p>
        <ContractMilestonePayables kind="crew" />
        <CrewPayrollTab kind="crew" />
      </AppShell>
    </>
  ),
});
