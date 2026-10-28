// ═══════════════════════════════════════════════════════════════════
// X13 — Per Diem report: saved per diem batches of the project, grouped by
// person or by budget code, paid vs pending per currency and in SAR.
// Totals use the same formula as the database trigger (per-diem-calc.ts).
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { formatAmount } from "@/lib/format-number";
import { formatDate } from "@/lib/date-format";
import { exportReportPdf, exportReportXlsx, type ReportDoc } from "@/lib/export/xlsx-report";
import { groupPerDiem, perDiemRowTotal, perDiemTotals, toSar, type PerDiemLike } from "@/lib/per-diem-calc";

type Row = PerDiemLike & {
  id: string;
  person_id: string;
  period_start: string;
  period_end: string;
};

async function fetchPerDiem(projectId: string) {
  const { data, error } = await supabase
    .from("per_diem_ledger")
    .select("id, person_id, period_start, period_end, on_set_rate, off_set_rate, shoot_days, off_days, status, currency, budget_code")
    .eq("project_id", projectId)
    .order("period_start", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];
  const ids = [...new Set(rows.map((r) => r.person_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase.from("people").select("id, full_name").in("id", ids);
    for (const p of people ?? []) names.set(p.id, p.full_name ?? "");
  }
  return { rows, names };
}

const money = (n: number) => formatAmount(n, 2);
const ccyText = (m: Record<string, number>) =>
  Object.entries(m)
    .filter(([, v]) => v)
    .map(([c, v]) => `${money(v)} ${c}`)
    .join(" · ") || "—";

export function PerDiemReport() {
  const { t } = useTranslation();
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const projectId = project?.id ?? null;
  const sarPerUsd = project?.fxRate || 3.75;
  const [by, setBy] = useState<"person" | "code">("person");
  const [exporting, setExporting] = useState<null | "excel" | "pdf">(null);

  const q = useQuery({
    queryKey: ["per-diem-report", projectId],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: () => fetchPerDiem(projectId as string),
  });
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const names = q.data?.names ?? new Map<string, string>();
  const totals = useMemo(() => perDiemTotals(rows), [rows]);
  const groups = useMemo(() => groupPerDiem(rows, by), [rows, by]);
  const label = (key: string) =>
    by === "person" ? names.get(key) || t("platform.perDiem.unknownPerson") : key || t("platform.perDiem.noCode");

  const doc = (): ReportDoc => ({
    report: "Per Diem",
    title: t("platform.perDiem.title"),
    subtitle: `${project?.name ?? ""} · ${t("platform.perDiem.sarRate", { rate: sarPerUsd })}`,
    sections: [
      {
        title: by === "person" ? t("platform.perDiem.byPerson") : t("platform.perDiem.byCode"),
        columns: [
          { header: by === "person" ? t("platform.perDiem.person") : t("platform.perDiem.code") },
          { header: t("platform.perDiem.batches"), type: "integer" },
          { header: t("platform.perDiem.shootDays"), type: "integer" },
          { header: t("platform.perDiem.offDays"), type: "integer" },
          { header: t("platform.perDiem.paidSar"), type: "money" },
          { header: t("platform.perDiem.pendingSar"), type: "money" },
        ],
        rows: groups.map((g) => [
          label(g.key),
          g.rows,
          g.shootDays,
          g.offDays,
          toSar(g.paid, sarPerUsd),
          toSar(g.pending, sarPerUsd),
        ]),
        totals: [
          [
            t("platform.perDiem.total"),
            totals.rows,
            totals.days.shoot,
            totals.days.off,
            toSar(totals.paid, sarPerUsd),
            toSar(totals.pending, sarPerUsd),
          ],
        ],
      },
      {
        title: t("platform.perDiem.batchesTitle"),
        columns: [
          { header: t("platform.perDiem.person") },
          { header: t("platform.perDiem.from"), type: "date" },
          { header: t("platform.perDiem.to"), type: "date" },
          { header: t("platform.perDiem.code") },
          { header: t("platform.perDiem.shootDays"), type: "integer" },
          { header: t("platform.perDiem.offDays"), type: "integer" },
          { header: t("platform.perDiem.amount"), type: "money" },
          { header: t("platform.perDiem.currency") },
          { header: t("platform.perDiem.status") },
        ],
        rows: rows.map((r) => [
          names.get(r.person_id) ?? "",
          r.period_start,
          r.period_end,
          r.budget_code ?? "",
          r.shoot_days,
          r.off_days,
          perDiemRowTotal(r),
          r.currency,
          r.status === "paid" ? t("platform.perDiem.paid") : t("platform.perDiem.pending"),
        ]),
      },
    ],
  });

  const run = async (kind: "excel" | "pdf") => {
    setExporting(kind);
    try {
      if (kind === "excel") await exportReportXlsx(doc());
      else await exportReportPdf(doc());
    } catch (e) {
      console.error(e);
      toast.error(t("platform.perDiem.exportFailed"));
    } finally {
      setExporting(null);
    }
  };

  if (!projectId) return null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-surface p-1 text-xs">
          {(["person", "code"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setBy(k)}
              className={`px-3 py-1 rounded-md font-semibold ${by === k ? "bg-brand text-brand-foreground" : "text-muted-foreground"}`}
            >
              {k === "person" ? t("platform.perDiem.byPerson") : t("platform.perDiem.byCode")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!!exporting || rows.length === 0}
            onClick={() => void run("excel")}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-success/20 text-success border border-success/30 text-sm disabled:opacity-50"
          >
            {exporting === "excel" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
            {t("exports.export_excel")}
          </button>
          <button
            type="button"
            disabled={!!exporting || rows.length === 0}
            onClick={() => void run("pdf")}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/20 text-destructive border border-destructive/30 text-sm disabled:opacity-50"
          >
            {exporting === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            {t("exports.export_pdf")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Panel>
          <div className="text-xs text-muted-foreground">{t("platform.perDiem.paid")}</div>
          <div className="text-lg font-semibold tabular-nums" dir="ltr">{ccyText(totals.paid)}</div>
          <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">
            ≈ {money(toSar(totals.paid, sarPerUsd))} SAR
          </div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">{t("platform.perDiem.pending")}</div>
          <div className="text-lg font-semibold tabular-nums" dir="ltr">{ccyText(totals.pending)}</div>
          <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">
            ≈ {money(toSar(totals.pending, sarPerUsd))} SAR
          </div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">{t("platform.perDiem.days")}</div>
          <div className="text-lg font-semibold tabular-nums">
            {t("platform.perDiem.daysValue", { shoot: totals.days.shoot, off: totals.days.off })}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("platform.perDiem.batchesCount", { count: totals.rows })}
          </div>
        </Panel>
      </div>

      <Panel className="overflow-x-auto">
        {q.isLoading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("platform.perDiem.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-start py-2 pe-3">
                  {by === "person" ? t("platform.perDiem.person") : t("platform.perDiem.code")}
                </th>
                <th className="text-end py-2 px-3">{t("platform.perDiem.batches")}</th>
                <th className="text-end py-2 px-3">{t("platform.perDiem.shootDays")}</th>
                <th className="text-end py-2 px-3">{t("platform.perDiem.offDays")}</th>
                <th className="text-end py-2 px-3">{t("platform.perDiem.paid")}</th>
                <th className="text-end py-2 ps-3">{t("platform.perDiem.pending")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-t border-border">
                  <td className="py-2 pe-3">{label(g.key)}</td>
                  <td className="py-2 px-3 text-end tabular-nums">{g.rows}</td>
                  <td className="py-2 px-3 text-end tabular-nums">{g.shootDays}</td>
                  <td className="py-2 px-3 text-end tabular-nums">{g.offDays}</td>
                  <td className="py-2 px-3 text-end tabular-nums" dir="ltr">{ccyText(g.paid)}</td>
                  <td className="py-2 ps-3 text-end tabular-nums" dir="ltr">{ccyText(g.pending)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("platform.perDiem.period", {
              from: formatDate(rows[0].period_start),
              to: formatDate(rows.reduce((m, r) => (r.period_end > m ? r.period_end : m), "")),
            })}
          </p>
        )}
      </Panel>
    </div>
  );
}
