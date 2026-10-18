import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageTitle } from "@/components/AppShell";
import { LockGuard } from "@/components/chrome/LockGuard";
import { PayablesPage } from "@/components/payables/PayablesPage";

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
/** Accounts Payable → unified Crew / Cast / Vendor payables grid. */
export const Route = createFileRoute("/_authenticated/payables")({
  head: () => ({
    meta: [
      { title: "Payables — Crew, Cast & Vendors | Kwalis HUB" },
      {
        name: "description",
        content:
          "Flat, Excel-like payables grid: one row per contract with inline payment milestones for crew, cast and vendors.",
      },
      { property: "og:title", content: "Payables — Crew, Cast & Vendors | Kwalis HUB" },
      {
        property: "og:description",
        content:
          "Track contract milestones, request payments and mark them paid from a single production accounting grid.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <>
      <AppShell>
        <PageTitle title={i18n.t("payables.payables")} />
        <div className="-mt-4 mb-4 text-xs text-muted-foreground" dir="rtl">
          المستحقات — الطاقم والممثلون والموردون
        </div>
        <LockGuard scopeLabel="Payables">
          <PayablesPage />
        </LockGuard>
      </AppShell>
    </>
  ),
});
