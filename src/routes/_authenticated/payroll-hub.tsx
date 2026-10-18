import { useState } from "react";
import { guardRoutePermission } from "@/lib/route-permission-guard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Banknote, Clock, LayoutGrid, Split, Timer, Wallet } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { ProjectMetaStrip } from "@/components/ProjectMetaStrip";
import { SectionCard } from "@/components/chrome/SectionCard";
import { TabStrip } from "@/components/chrome/TabStrip";
import { RateCardsPanel } from "@/components/payroll-hub/RateCardsPanel";
import { TimesheetsPanel } from "@/components/payroll-hub/TimesheetsPanel";
import { BulkPayrollRunPanel } from "@/components/payroll-hub/BulkPayrollRunPanel";
import { MultiLineSplitEditor } from "@/components/payroll-hub/MultiLineSplitEditor";
import { OvertimeLogPanel } from "@/components/payroll-hub/OvertimeLogPanel";
import { useStore } from "@/lib/store";
import { useScope } from "@/lib/payroll-hub";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/payroll-hub")({
  // Server-verified gate: typing the URL directly cannot bypass this.
  beforeLoad: () => guardRoutePermission("payroll.view"),
  head: () => ({
    meta: [
      {
        title: "Payroll Hub — Kwalis HUB",
      },
      {
        name: "description",
        content: "Rate cards, timesheets, bulk payroll runs, and multi-line budget splits.",
      },
    ],
  }),
  component: PayrollHubPage,
});

type TabKey = "rates" | "timesheets" | "overtime" | "runs" | "splits";

function PayrollHubPage() {
  const { t } = useTranslation();

  const [tab, setTab] = useState<TabKey>("rates");

  return (
    <>
      <AppShell>
        <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-4">
          <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Banknote className="size-6 text-primary" /> Payroll Hub
              </h1>
              <p className="text-sm text-muted-foreground">
                Rate cards → Timesheets → Overtime → Bulk Payroll Runs → Budget splits. Preparation
                and approval only — no payments are executed here.
              </p>
            </div>
          </header>

          <ProjectMetaStrip className="rounded-xl border border-border bg-surface-2 px-4 py-3" />

          <div className="rounded-xl border border-info/25 bg-info/5 p-3 md:p-4">
            <div className="flex items-start gap-3">
              <Wallet className="size-4 mt-0.5 text-info shrink-0" />
              <div className="flex-1 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-info">
                  {t("payroll_hub.how_the_payroll_workflow_ends_in_a_payment")}
                </span>
                <ol className="mt-2 grid gap-2 md:grid-cols-4">
                  {[
                    {
                      n: 1,
                      title: "Prepare here",
                      body: "Rate cards, timesheets and overtime feed a bulk payroll run in this hub.",
                    },
                    {
                      n: 2,
                      title: "Approve & post here",
                      body: "An approver posts the run — that locks the gross, WHT and net amounts.",
                    },
                    {
                      n: 3,
                      title: "Execute the payment",
                      body: "Approved amounts appear automatically in Crew & Cast Payables — release the payment and upload proof there.",
                      link: { to: "/crew-cast-payables", label: "Open Crew & Cast Payables →" },
                    },
                    {
                      n: 4,
                      title: "Top Sheet actualizes",
                      body: "Once the payment is released with proof, the amount posts to Top Sheet actuals and variances.",
                      link: { to: "/top-sheet-report", label: "Open Top Sheet Cost Report →" },
                    },
                  ].map((step) => (
                    <li
                      key={step.n}
                      className="rounded-lg border border-border bg-surface/50 p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-info/20 text-[10px] font-bold text-info">
                          {step.n}
                        </span>
                        <span className="font-semibold text-foreground">{step.title}</span>
                      </div>
                      <p className="mt-1">{step.body}</p>
                      {step.link && (
                        <Link
                          to={step.link.to}
                          className="mt-1.5 inline-block font-semibold text-info underline decoration-dotted hover:text-info"
                        >
                          {step.link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
                <span className="block mt-2" dir="rtl">
                  يُستخدم مركز الرواتب للتحضير والاعتماد فقط — تنفيذ الدفع يتم في «مستحقات الطاقم
                  والممثلين»، وبعد إثبات الدفع تُحدَّث «التقرير الأعلى» تلقائيًا.
                </span>
              </div>
            </div>
          </div>

          <TabStrip
            tabs={[
              { key: "rates", label: "Rate cards", icon: <LayoutGrid className="size-4" /> },
              { key: "timesheets", label: "Timesheets", icon: <Clock className="size-4" /> },
              { key: "overtime", label: "Overtime log", icon: <Timer className="size-4" /> },
              { key: "runs", label: "Bulk payroll runs", icon: <Banknote className="size-4" /> },
              { key: "splits", label: "Budget splits", icon: <Split className="size-4" /> },
            ]}
            value={tab}
            onChange={(k) => setTab(k as TabKey)}
          />

          <SectionCard>
            {tab === "rates" && <RateCardsPanel />}
            {tab === "timesheets" && <TimesheetsPanel />}
            {tab === "overtime" && <OvertimeLogPanel />}
            {tab === "runs" && <BulkPayrollRunPanel />}
            {tab === "splits" && <SplitsExplorer />}
          </SectionCard>
        </div>
      </AppShell>
    </>
  );
}

function SplitsExplorer() {
  const { t } = useTranslation();

  const { projectId } = useScope();
  const people = useStore((s) => s.people);
  const [selectedId, setSelectedId] = useState("");
  const person = people.find((p) => p.id === selectedId) ?? null;
  const contractTotal = person
    ? Number(person.dailyRate || 0) * Number(person.shootingDays || 0)
    : 0;

  if (!projectId) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {t("payroll_hub.select_a_project_to_allocate_contracts")}
      </div>
    );
  }

  const scoped = people.filter((p) => p.projectId === projectId);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{t("payroll_hub.multiline_budget_splits")}</h3>
        <p className="text-xs text-muted-foreground">
          Allocate a contract across multiple budget lines. Splits are saved per person and picked
          up automatically by payroll runs.
        </p>
      </div>
      <label className="flex flex-col gap-1 max-w-md">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {t("payroll_hub.person_cast_member")}
        </span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
        >
          <option value="">— select —</option>
          {scoped.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName} · {p.position || p.character || p.kind}
            </option>
          ))}
        </select>
      </label>

      {person ? (
        <MultiLineSplitEditor
          personId={person.id}
          totalAmount={contractTotal}
          currency={person.ccy || "USD"}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("payroll_hub.pick_a_person_above_to_edit_their_budgetline")}
        </p>
      )}
    </div>
  );
}
