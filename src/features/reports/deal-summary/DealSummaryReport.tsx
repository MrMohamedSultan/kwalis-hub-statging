// ═══════════════════════════════════════════════════════════════════
// N09 — Crew & Cast Deal Summary: one row per person with all contracts.
// Contracts are grouped by person profile (E01, people.person_id); a
// contract not yet linked to a profile is its own row. Figures come from
// src/lib/deal-summary.ts (the single place they are defined).
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, FileText, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { formatAmount } from "@/lib/format-number";
import { downloadCSV } from "@/lib/export-csv";
import { exportPdfReport } from "@/lib/export-pdf";
import { usePersons } from "@/lib/persons";
import { normalizeName } from "@/lib/person-match";
import {
  computeDealSummary,
  dealSummaryTotals,
  type DealInstalment,
  type DealPayment,
} from "@/lib/deal-summary";

const db = supabase as unknown as { from: (t: string) => any };

async function fetchDealInputs(projectId: string) {
  const [inst, pays] = await Promise.all([
    db
      .from("v_payroll_instalments")
      .select("payroll_id, status, gross_amount, net_amount")
      .eq("project_id", projectId)
      .limit(20000),
    db
      .from("payments")
      .select("source_id, amount")
      .eq("project_id", projectId)
      .eq("source_type", "payroll")
      .limit(20000),
  ]);
  const instalments: DealInstalment[] = ((inst.data ?? []) as any[]).map((r) => ({
    payrollId: String(r.payroll_id),
    status: String(r.status ?? ""),
    grossAmount: Number(r.gross_amount) || 0,
    netAmount: Number(r.net_amount) || 0,
  }));
  const payments: DealPayment[] = ((pays.data ?? []) as any[]).map((r) => ({
    sourceId: r.source_id ? String(r.source_id) : null,
    amount: Number(r.amount) || 0,
  }));
  return { instalments, payments };
}

const money = (n: number) => formatAmount(n, 2);

export function DealSummaryReport() {
  const { t, i18n } = useTranslation();
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const people = useStore((s) => s.people);
  const payroll = useStore((s) => s.payroll);
  const { persons } = usePersons(project?.organizationId ?? null);
  const [kind, setKind] = useState<"all" | "crew" | "cast">("all");
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["deal-summary-inputs", project?.id],
    enabled: !!project?.id,
    staleTime: 60_000,
    queryFn: () => fetchDealInputs(project!.id),
  });

  const rows = useMemo(() => {
    const personNames = new Map(persons.map((p) => [p.id, p.fullName]));
    const all = computeDealSummary({
      contracts: people.map((p) => ({
        id: p.id,
        personId: p.personId ?? null,
        fullName: p.fullName,
        kind: p.kind,
        position: p.position,
        character: p.character,
      })),
      payroll: payroll.map((r) => ({
        id: r.id,
        refId: r.refId,
        totalAmount: r.totalAmount,
        netPayable: r.netPayable ?? null,
      })),
      instalments: q.data?.instalments ?? [],
      payments: q.data?.payments ?? [],
      personNames,
    });
    const n = normalizeName(search);
    return all.filter(
      (r) =>
        (kind === "all" || r.kinds.includes(kind)) &&
        (!n || normalizeName(`${r.name} ${r.roles.join(" ")}`).includes(n)),
    );
  }, [people, payroll, persons, q.data, kind, search]);
  const totals = dealSummaryTotals(rows);

  const headers = [
    t("people.deal.person"),
    t("people.deal.type"),
    t("people.deal.roles"),
    t("people.deal.contracts"),
    t("people.deal.value"),
    t("people.deal.paid"),
    t("people.deal.payable"),
    t("people.deal.commitment"),
    t("people.deal.wht"),
  ];
  const kindLabel = (k: string[]) => k.map((x) => t(`people.deal.kind_${x}`)).join(" / ");
  const tableRows = rows.map((r) => [
    r.name,
    kindLabel(r.kinds),
    r.roles.join(", "),
    String(r.contracts),
    money(r.value),
    money(r.paid),
    money(r.payable),
    money(r.commitment),
    money(r.wht),
  ]);
  const totalRow = [
    t("people.deal.total"),
    "",
    "",
    String(totals.contracts),
    money(totals.value),
    money(totals.paid),
    money(totals.payable),
    money(totals.commitment),
    money(totals.wht),
  ];
  const slug = project?.code ?? "project";
  const exportCsv = () =>
    downloadCSV(
      `deal-summary-${slug}.csv`,
      [...tableRows, totalRow].map((cells) =>
        Object.fromEntries(headers.map((h, i) => [h, cells[i]])),
      ),
      headers,
    );
  const exportPdf = () =>
    void exportPdfReport(
      `deal-summary-${slug}.pdf`,
      [
        {
          title: t("people.deal.title"),
          subtitle: `${project?.code ?? ""} ${project?.name ?? ""} · SAR`,
          headers,
          rows: [...tableRows, totalRow],
          numericColumns: [3, 4, 5, 6, 7, 8],
        },
      ],
      {
        documentTitle: `Kwalis Hub — ${t("people.deal.title")}`,
        direction: i18n.language === "ar" ? "rtl" : "ltr",
      },
    );

  const input =
    "rounded-lg bg-surface-2 border border-border px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-brand/40";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("people.deal.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("people.deal.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-40"
          >
            <Download className="size-3.5" />
            {t("refs.export_csv")}
          </button>
          <button
            type="button"
            onClick={exportPdf}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-40"
          >
            <FileText className="size-3.5" />
            {t("refs.export_pdf")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("people.deal.type")}
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className={input}
          >
            <option value="all">{t("people.deal.kind_all")}</option>
            <option value="crew">{t("people.deal.kind_crew")}</option>
            <option value="cast">{t("people.deal.kind_cast")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground min-w-[180px] flex-1">
          {t("people.deal.search")}
          <input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            className={input}
          />
        </label>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted-foreground">
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-2 font-medium ${i >= 3 ? "text-end" : "text-start"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={headers.length}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    {t("people.deal.empty")}
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.key} className="border-t border-border/60">
                  {tableRows[i].map((c, j) => (
                    <td
                      key={j}
                      className={`px-3 py-2 ${j >= 3 ? "text-end tabular-nums" : "text-start"}`}
                    >
                      {j === 0 ? (
                        <bdi>
                          {c}
                          {!r.personId && (
                            <span className="ms-2 text-[10px] text-warning">
                              {t("people.deal.no_profile")}
                            </span>
                          )}
                        </bdi>
                      ) : (
                        c
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-surface-2 font-semibold">
                <tr>
                  {totalRow.map((c, j) => (
                    <td
                      key={j}
                      className={`px-3 py-2 ${j >= 3 ? "text-end tabular-nums" : "text-start"}`}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t("people.deal.definitions")}</p>
    </div>
  );
}
