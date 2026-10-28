// =====================================================================
// BudgetVsActualPanel — "Budget vs Spend" tab of the Budget page.
//
// The budget grid itself stays clean (lines, quantities, rates, totals).
// Money that has moved against the budget lives here, in a report-style
// table, one row per ACCOUNT CODE:
//   budget     = sum of the code's lines (selected version)
//   committed  = issued but not consumed      ┐
//   actual     = incurred cost                ├ v_budget_code_position
//   paid       = cash out the door            ┘ (doctrine layer)
//   remaining  = budget − actual − committed
// Actuals are reported per code, so a code shared by several lines (e.g.
// three Executive Producers on 1201) is shown ONCE with its total — never
// repeated on every line.
// =====================================================================
import { formatDate } from "@/lib/date-format";
import { formatAmount } from "@/lib/format-number";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useStore, lineTotalSAR, type BudgetLine } from "@/lib/store";
import { HEADER_ACCOUNTS } from "@/lib/data";
import { fetchCodePosition, type CodePositionRow } from "@/lib/dashboard/real-financials";
import { BudgetLineActualsModal } from "@/components/BudgetLineActualsModal";
import { Button } from "@/components/ui/button";

type Focus = "actual" | "committed" | "paid";

type CodeRow = {
  code: string;
  description: string;
  headerCode: string;
  lineIds: string[];
  lines: number;
  budget: number;
  committed: number;
  actual: number;
  paid: number;
};

type HeaderGroup = {
  headerCode: string;
  headerName: string;
  rows: CodeRow[];
  totals: Totals;
};

type Totals = { budget: number; committed: number; actual: number; paid: number };

const zero = (): Totals => ({ budget: 0, committed: 0, actual: 0, paid: 0 });
const add = (t: Totals, r: Totals) => {
  t.budget += r.budget;
  t.committed += r.committed;
  t.actual += r.actual;
  t.paid += r.paid;
};
const remaining = (r: Totals) => r.budget - r.actual - r.committed;
const usedPct = (r: Totals) => (r.budget > 0 ? ((r.actual + r.committed) / r.budget) * 100 : 0);

const fmt = (n: number) => formatAmount(Math.round(n), 0);

const UNBUDGETED = "__unbudgeted__";

export function BudgetVsActualPanel({ isDraft }: { isDraft: boolean }) {
  const { t } = useTranslation();
  const projectId = useStore((s) => s.activeProjectId);
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const budget = useStore((s) => s.budget);
  const [position, setPosition] = useState<CodePositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [breakdown, setBreakdown] = useState<{
    lineId: string;
    label: string;
    focus: Focus;
  } | null>(null);

  async function load() {
    if (!projectId) return;
    setLoading(true);
    try {
      setPosition(await fetchCodePosition(projectId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("budgetVsActual.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const { groups, grand } = useMemo(() => {
    const headerName = new Map(HEADER_ACCOUNTS.map((h) => [h.code, h.name] as const));
    const byCode = new Map<string, CodeRow>();
    const live = budget.filter((l: BudgetLine) => !l.excluded);
    for (const l of live) {
      const code = (l.mainCode || "").trim() || "—";
      const row =
        byCode.get(code) ??
        ({
          code,
          description: l.description || "",
          headerCode: l.headerCode || "",
          lineIds: [],
          lines: 0,
          budget: 0,
          committed: 0,
          actual: 0,
          paid: 0,
        } as CodeRow);
      row.lineIds.push(l.id);
      row.lines += 1;
      row.budget += lineTotalSAR(l);
      byCode.set(code, row);
    }
    // Money on codes that have no budget line lands in its own group.
    for (const p of position) {
      const code = p.budget_code?.trim();
      if (!code) continue;
      const row =
        byCode.get(code) ??
        ({
          code,
          description: t("budgetVsActual.noBudgetLine"),
          headerCode: UNBUDGETED,
          lineIds: [],
          lines: 0,
          budget: 0,
          committed: 0,
          actual: 0,
          paid: 0,
        } as CodeRow);
      row.committed = p.committed_sar;
      row.actual = p.actual_sar;
      row.paid = p.paid_sar;
      byCode.set(code, row);
    }

    const groupMap = new Map<string, HeaderGroup>();
    for (const row of byCode.values()) {
      const key = row.headerCode || "—";
      const g =
        groupMap.get(key) ??
        ({
          headerCode: key,
          headerName:
            key === UNBUDGETED ? t("budgetVsActual.unbudgeted") : (headerName.get(key) ?? ""),
          rows: [],
          totals: zero(),
        } as HeaderGroup);
      g.rows.push(row);
      add(g.totals, row);
      groupMap.set(key, g);
    }
    const groups = [...groupMap.values()]
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => a.code.localeCompare(b.code)) }))
      .sort((a, b) =>
        a.headerCode === UNBUDGETED
          ? 1
          : b.headerCode === UNBUDGETED
            ? -1
            : a.headerCode.localeCompare(b.headerCode),
      );
    const grand = zero();
    for (const g of groups) add(grand, g.totals);
    return { groups, grand };
  }, [budget, position, t]);

  async function exportExcel() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "KwalisHUB";
    const ws = wb.addWorksheet("Budget vs Spend", { views: [{ state: "frozen", ySplit: 3 }] });
    ws.columns = [
      { width: 12 },
      { width: 42 },
      { width: 8 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 9 },
    ];
    ws.getRow(1).values = [
      `${project?.code ?? ""} ${project?.name ?? ""} — Budget vs Spend (SAR) — ${formatDate(new Date())}`,
    ];
    ws.getRow(1).font = { bold: true, size: 13 };
    ws.getRow(1).height = 32;
    ws.getRow(3).values = [
      "Code",
      "Description",
      "Lines",
      "Budget",
      "Committed",
      "Actual",
      "Paid",
      "Remaining",
      "% Used",
    ];
    ws.getRow(3).font = { bold: true };
    let r = 4;
    const numFmt = "#,##0";
    const writeRow = (vals: (string | number)[], bold = false) => {
      const row = ws.getRow(r++);
      row.values = vals;
      if (bold) row.font = { bold: true };
      for (const c of [4, 5, 6, 7, 8]) row.getCell(c).numFmt = numFmt;
      row.getCell(9).numFmt = "0.0";
    };
    for (const g of groups) {
      writeRow([g.headerCode === UNBUDGETED ? "" : g.headerCode, g.headerName], true);
      for (const c of g.rows) {
        writeRow([
          c.code,
          c.description,
          c.lines,
          Math.round(c.budget),
          Math.round(c.committed),
          Math.round(c.actual),
          Math.round(c.paid),
          Math.round(remaining(c)),
          Number(usedPct(c).toFixed(1)),
        ]);
      }
      writeRow(
        [
          "",
          `Subtotal ${g.headerName}`,
          "",
          Math.round(g.totals.budget),
          Math.round(g.totals.committed),
          Math.round(g.totals.actual),
          Math.round(g.totals.paid),
          Math.round(remaining(g.totals)),
          Number(usedPct(g.totals).toFixed(1)),
        ],
        true,
      );
      r++;
    }
    writeRow(
      [
        "",
        "GRAND TOTAL",
        "",
        Math.round(grand.budget),
        Math.round(grand.committed),
        Math.round(grand.actual),
        Math.round(grand.paid),
        Math.round(remaining(grand)),
        Number(usedPct(grand).toFixed(1)),
      ],
      true,
    );
    // Shared Kwalis Hub identity + standard file name (G02).
    const { saveBrandedWorkbook } = await import("@/lib/export/xlsx-report");
    await saveBrandedWorkbook(wb, "Budget vs Spend", undefined, {
      logo: { col: 7.05, row: 0.05, maxWidth: 120, maxHeight: 38 },
    });
  }

  const money = (n: number, tone = "") => (
    <span className={`tabular-nums whitespace-nowrap ${tone}`} dir="ltr">
      {fmt(n)}
    </span>
  );
  const clickable = (row: CodeRow, focus: Focus, value: number, tone: string) =>
    row.lineIds.length > 0 && value !== 0 ? (
      <button
        type="button"
        className={`hover:underline ${tone}`}
        onClick={() =>
          setBreakdown({ lineId: row.lineIds[0], label: `${row.code} · ${row.description}`, focus })
        }
      >
        {money(value)}
      </button>
    ) : (
      money(value, value === 0 ? "text-muted-foreground" : tone)
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t("budgetVsActual.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("budgetVsActual.subtitle")}</p>
          {isDraft && <p className="mt-1 text-xs text-warning">{t("budgetVsActual.draftNote")}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            {t("budgetVsActual.refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportExcel()} disabled={loading}>
            <FileSpreadsheet className="size-4" />
            {t("budgetVsActual.exportExcel")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {(
          [
            ["budget", grand.budget, ""],
            ["committed", grand.committed, "text-warning"],
            ["actual", grand.actual, "text-success"],
            ["paid", grand.paid, "text-info"],
            ["remaining", remaining(grand), remaining(grand) < 0 ? "text-destructive" : ""],
          ] as const
        ).map(([k, v, tone]) => (
          <div key={k} className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{t(`budgetVsActual.col.${k}`)}</div>
            <div className={`text-base font-semibold ${tone}`}>
              <span className="me-1 text-[11px] font-medium text-muted-foreground">SAR</span>
              {money(v)}
            </div>
          </div>
        ))}
      </div>

      {loading && position.length === 0 ? (
        <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t("budgetVsActual.loading")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-start font-medium">{t("budgetVsActual.col.code")}</th>
                <th className="px-2 py-2 text-start font-medium">
                  {t("budgetVsActual.col.description")}
                </th>
                <th className="px-2 py-2 text-end font-medium">{t("budgetVsActual.col.lines")}</th>
                {(["budget", "committed", "actual", "paid", "remaining"] as const).map((k) => (
                  <th key={k} className="px-2 py-2 text-end font-medium">
                    {t(`budgetVsActual.col.${k}`)}
                  </th>
                ))}
                <th className="px-2 py-2 text-end font-medium">{t("budgetVsActual.col.used")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.headerCode}>
                  <tr className="bg-surface-2/60">
                    <td colSpan={9} className="px-2 py-1.5 font-semibold">
                      {g.headerCode === UNBUDGETED ? "" : `${g.headerCode} · `}
                      {g.headerName}
                    </td>
                  </tr>
                  {g.rows.map((c) => {
                    const rem = remaining(c);
                    const pct = usedPct(c);
                    return (
                      <tr key={c.code} className="border-t border-border/50">
                        <td className="px-2 py-1.5 font-mono">{c.code}</td>
                        <td className="px-2 py-1.5">{c.description}</td>
                        <td className="px-2 py-1.5 text-end text-muted-foreground">
                          {c.lines || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-end">{money(c.budget)}</td>
                        <td className="px-2 py-1.5 text-end">
                          {clickable(c, "committed", c.committed, "text-warning")}
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          {clickable(c, "actual", c.actual, "text-success")}
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          {clickable(c, "paid", c.paid, "text-info")}
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          {money(rem, rem < 0 ? "text-destructive font-semibold" : "")}
                        </td>
                        <td
                          className={`px-2 py-1.5 text-end tabular-nums ${pct > 100 ? "text-destructive font-semibold" : pct > 85 ? "text-warning" : "text-muted-foreground"}`}
                        >
                          {c.budget > 0 ? `${pct.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-border font-semibold">
                    <td />
                    <td className="px-2 py-1.5">
                      {t("budgetVsActual.subtotal")} {g.headerName}
                    </td>
                    <td />
                    <td className="px-2 py-1.5 text-end">{money(g.totals.budget)}</td>
                    <td className="px-2 py-1.5 text-end">{money(g.totals.committed)}</td>
                    <td className="px-2 py-1.5 text-end">{money(g.totals.actual)}</td>
                    <td className="px-2 py-1.5 text-end">{money(g.totals.paid)}</td>
                    <td className="px-2 py-1.5 text-end">{money(remaining(g.totals))}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">
                      {g.totals.budget > 0 ? `${usedPct(g.totals).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                </Fragment>
              ))}
              <tr className="border-t-2 border-border bg-muted/40 font-bold">
                <td />
                <td className="px-2 py-2">{t("budgetVsActual.grandTotal")}</td>
                <td />
                <td className="px-2 py-2 text-end">{money(grand.budget)}</td>
                <td className="px-2 py-2 text-end">{money(grand.committed)}</td>
                <td className="px-2 py-2 text-end">{money(grand.actual)}</td>
                <td className="px-2 py-2 text-end">{money(grand.paid)}</td>
                <td className="px-2 py-2 text-end">{money(remaining(grand))}</td>
                <td className="px-2 py-2 text-end tabular-nums">
                  {grand.budget > 0 ? `${usedPct(grand).toFixed(1)}%` : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {breakdown && projectId && (
        <BudgetLineActualsModal
          lineId={breakdown.lineId}
          projectId={projectId}
          lineLabel={breakdown.label}
          focus={breakdown.focus}
          onClose={() => setBreakdown(null)}
        />
      )}
    </div>
  );
}
