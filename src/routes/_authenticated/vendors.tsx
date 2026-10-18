import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { LockGuard } from "@/components/chrome/LockGuard";
import { VendorTab } from "./accounting";

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/vendors")({
  component: () => (
    <>
      <AppShell>
        <PageTitle title={i18n.t("vendors.vendors")} />
        <div className="text-xs text-muted-foreground -mt-4 mb-4" dir="rtl">
          الموردون
        </div>
        <LockGuard scopeLabel="Vendors">
          <VendorTab />
        </LockGuard>
      </AppShell>
    </>
  ),
});
