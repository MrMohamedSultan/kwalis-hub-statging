// ═══════════════════════════════════════════════════════════════════
// GL Transactions — unified ledger report tab.
// Read-only: no mutations, every amount comes from v_ledger_transactions.
// Summary totals are grouped per currency — mixed-currency figures are
// never silently added together. Table columns that are empty for every
// filtered row auto-hide (declared via column defs, nothing hardcoded).
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Lock, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStore } from "@/lib/store";
import { useGlAccounts } from "@/lib/gl-accounts";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { formatAmount } from "@/lib/format-number";
import { useCurrency } from "@/contexts/CurrencyContext";
import { convertAmount, formatRate, round2, useResolvedFxRate } from "@/lib/fx-resolution";

import {
  countsTowardTotals,
  humanRef,
  SOURCE_LABELS,
  useGlTransactions,
  type GlEntryKind,
  type GlTransaction,
  type GlTransactionSource,
} from "./gl-transactions-data";
import {
  exportGlTransactionsExcel,
  exportGlTransactionsPdf,
  type GlExportCurrencyMode,
} from "./gl-transactions-export";
import { GlTransactionDrawer } from "./GlTransactionDrawer";

const ALL_SOURCES = Object.keys(SOURCE_LABELS) as GlTransactionSource[];
const ALL_KINDS: GlEntryKind[] = ["actual", "commitment", "payment"];

/** One table column. `raw` drives the empty-column auto-hide: a column whose
 *  raw value is null/"" for EVERY filtered row is hidden, with a note. */
interface ColDef {
  key: string;
  label: string;
  className?: string;
  raw: (r: GlTransaction) => string | null | undefined;
  cell: (r: GlTransaction) => ReactNode;
}

const money = (v: number | null | undefined, ccy: string | null | undefined) =>
  v == null ? "—" : `${formatAmount(v, 2)}${ccy ? ` ${ccy}` : ""}`;

const num = "text-end tabular-nums whitespace-nowrap px-3 py-2";
const txt = "px-3 py-2 whitespace-nowrap";

/** Money columns rendered through the display-currency layer. */
type MoneyField = "amount" | "vat" | "wht" | "net";
const MONEY_KEYS = new Set(["amount", "vat", "wht", "net"]);

interface MoneyVal {
  /** Rounded display value (converted per-row, then rounded — never the reverse). */
  value: number | null;
  ccy: string | null;
  /** True when this figure was converted with the resolved FX rate. */
  converted: boolean;
}

/** Per-currency accumulators behind the summary cards. `actual` is GROSS
 *  (sum of AMOUNT) — WHT is a liability owed to the tax authority, never a
 *  reduction of cost; `net` only feeds the "Net of WHT" sublabel. */
interface SummaryLine {
  actual: number;
  committed: number;
  vat: number;
  wht: number;
  net: number;
}

function buildColumns(t: (k: string) => string, moneyCcy: string | null): ColDef[] {
  // Currency code lives in the column HEADER, not repeated down every cell —
  // bare numbers keep the grid readable and let NET fit without scrolling.
  const moneyLabel = (key: string) => (moneyCcy ? `${t(key)} (${moneyCcy})` : t(key));
  return [
    {
      key: "date",
      label: t("reports.gltx_col_date"),
      className: txt,
      raw: (r) => r.entry_date,
      cell: (r) => r.entry_date ?? "—",
    },
    {
      key: "source",
      label: t("reports.gltx_col_source"),
      className: txt,
      raw: (r) => r.source_type,
      cell: (r) => (
        <span className="text-[11px] px-2 py-0.5 rounded-full border bg-surface-2 text-muted-foreground border-border">
          {SOURCE_LABELS[r.source_type]}
        </span>
      ),
    },
    {
      key: "ref",
      label: t("reports.gltx_col_ref"),
      className: txt,
      raw: (r) => humanRef(r),
      cell: (r) => humanRef(r) ?? "—",
    },
    {
      key: "description",
      label: t("reports.gltx_col_description"),
      className: "px-3 py-2 min-w-[220px]",
      raw: (r) => r.description,
      cell: (r) => r.description ?? "—",
    },
    {
      key: "counterparty",
      label: t("reports.gltx_col_counterparty"),
      className: txt,
      raw: (r) => r.counterparty,
      cell: (r) => r.counterparty ?? "—",
    },
    {
      key: "budget_code",
      label: t("reports.gltx_col_budget_code"),
      className: `${txt} font-mono text-xs`,
      raw: (r) => r.budget_code,
      cell: (r) => r.budget_code ?? "—",
    },
    {
      key: "gl_account",
      label: t("reports.gltx_col_gl_account"),
      className: txt,
      raw: (r) => r.gl_account_id,
      cell: () => null, // resolved in cellFor() via glById
    },
    {
      key: "department",
      label: t("reports.gltx_col_department"),
      className: txt,
      raw: (r) => r.department,
      cell: (r) => r.department ?? "—",
    },
    {
      key: "kind",
      label: t("reports.gltx_col_kind"),
      className: txt,
      raw: (r) => r.entry_kind,
      cell: (r) =>
        r.entry_kind === "commitment" ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-warning/15 text-warning border-warning/30">
            {t("reports.gltx_commitment")}
          </span>
        ) : r.entry_kind === "payment" ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-accent/15 text-accent border-accent/30">
            {t("reports.gltx_payment")}
          </span>
        ) : (
          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-brand/15 text-brand border-brand/30">
            {t("reports.gltx_actual")}
          </span>
        ),
    },
    {
      key: "status",
      label: t("reports.gltx_col_status"),
      className: txt,
      raw: (r) => r.status,
      cell: (r) => r.status ?? "—",
    },
    {
      key: "qfe",
      label: t("reports.gltx_col_qfe"),
      className: txt,
      raw: (r) => (r.qfe_eligible ? "QFE" : null),
      cell: (r) =>
        r.qfe_eligible ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-accent/15 text-accent border-accent/30">
            {t("reports.gltx_qfe")}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "amount",
      label: moneyLabel("reports.gltx_col_amount"),
      className: num,
      raw: (r) => String(r.amount),
      cell: (r) => money(r.amount, r.resolvedCurrency),
    },
    {
      key: "vat",
      label: moneyLabel("reports.gltx_col_vat"),
      className: num,
      raw: (r) => String(r.vat_amount),
      cell: (r) => money(r.vat_amount, r.resolvedCurrency),
    },
    {
      key: "wht",
      label: moneyLabel("reports.gltx_wht"),
      className: num,
      // null until the view exposes wht_amount — auto-hides pre-migration.
      raw: (r) => (r.wht_amount == null ? null : String(r.wht_amount)),
      cell: (r) => money(r.wht_amount, r.resolvedCurrency),
    },
    {
      key: "net",
      label: moneyLabel("reports.gltx_net"),
      className: `${num} font-medium`,
      raw: (r) => String(r.total),
      cell: (r) => money(r.total, r.resolvedCurrency),
    },
  ];
}

export function GlTransactionsReport() {
  const { t } = useTranslation();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const { isReady, canView, canExport } = usePermissions();
  const { rows: glRows } = useGlAccounts();
  const glById = useMemo(() => Object.fromEntries(glRows.map((g) => [g.id, g])), [glRows]);

  const permitted = isReady && canView("gl_transactions");
  const allowExport = permitted && canExport("gl_transactions");

  // Gated: no request to the view fires at all without the view permission.
  const txQuery = useGlTransactions(activeProject?.id, permitted);
  const rows = useMemo(() => txQuery.data ?? [], [txQuery.data]);

  // ── Display currency: the EXISTING global SAR | USD toggle (shared
  //    context, no second control) + the honestly resolved FX rate. ────
  const { active: displayCcy } = useCurrency();
  const fxQuery = useResolvedFxRate(activeProject?.id);
  const fx = fxQuery.data ?? null; // null → never convert, show native

  // ── Filters ────────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [source, setSource] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [budgetCode, setBudgetCode] = useState("");
  const [glAccountId, setGlAccountId] = useState<string>("all");
  const [department, setDepartment] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [qfeOnly, setQfeOnly] = useState(false);
  const [selected, setSelected] = useState<GlTransaction | null>(null);
  const [exportMode, setExportMode] = useState<GlExportCurrencyMode>("both");

  useEffect(() => {
    setDateFrom("");
    setDateTo("");
    setSource("all");
    setSearch("");
    setBudgetCode("");
    setGlAccountId("all");
    setDepartment("");
    setKind("all");
    setQfeOnly(false);
    setSelected(null);
    setExportMode("both");
  }, [activeProject?.id]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (dateFrom && (!r.entry_date || r.entry_date < dateFrom)) return false;
        if (dateTo && (!r.entry_date || r.entry_date > dateTo)) return false;
        if (source !== "all" && r.source_type !== source) return false;
        if (search) {
          const q = search.toLowerCase();
          const hay = [humanRef(r), r.description, r.counterparty]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (budgetCode && !(r.budget_code ?? "").toLowerCase().includes(budgetCode.toLowerCase()))
          return false;
        if (glAccountId !== "all" && r.gl_account_id !== glAccountId) return false;
        if (department && !(r.department ?? "").toLowerCase().includes(department.toLowerCase()))
          return false;
        if (kind !== "all" && r.entry_kind !== kind) return false;
        if (qfeOnly && !r.qfe_eligible) return false;
        return true;
      }),
    [rows, dateFrom, dateTo, source, search, budgetCode, glAccountId, department, kind, qfeOnly],
  );

  // ── Display-currency layer (DISPLAY ONLY — nothing here is persisted).
  //    Each figure keeps its native value unless the global toggle's
  //    currency differs AND the resolved FX rate covers the pair; then it
  //    is converted and rounded to 2 decimals PER ROW. Totals sum the
  //    rounded rows, so they always match the visible column. ──────────
  const displayMap = useMemo(() => {
    const m = new Map<GlTransaction, Record<MoneyField, MoneyVal>>();
    for (const r of filtered) {
      const native = r.resolvedCurrency;
      const mk = (raw: number | null | undefined): MoneyVal => {
        const v = raw == null ? null : Number(raw);
        if (v == null || !Number.isFinite(v)) return { value: null, ccy: native, converted: false };
        if (fx && native && native.toUpperCase() !== displayCcy.toUpperCase()) {
          const c = convertAmount(fx, v, native, displayCcy);
          if (c != null) return { value: round2(c), ccy: displayCcy, converted: true };
        }
        return { value: v, ccy: native, converted: false };
      };
      m.set(r, {
        amount: mk(r.amount),
        vat: mk(r.vat_amount),
        wht: mk(r.wht_amount),
        net: mk(r.total),
      });
    }
    return m;
  }, [filtered, fx, displayCcy]);

  const anyConverted = useMemo(() => {
    for (const d of displayMap.values()) if (d.amount.converted) return true;
    return false;
  }, [displayMap]);

  // Currency code shown in the money column HEADERS. Uniform when conversion
  // is active (the toggle currency) or when every row shares one native
  // currency; null only for a genuinely mixed native set — then codes stay
  // in the cells so no figure loses its denomination.
  const tableCcy = useMemo(() => {
    if (anyConverted) return displayCcy.toUpperCase();
    const set = new Set(filtered.map((r) => r.resolvedCurrency?.toUpperCase()).filter(Boolean));
    return set.size === 1 ? ([...set][0] as string) : null;
  }, [filtered, anyConverted, displayCcy]);

  // ── Summary: grouped by DISPLAY currency — with conversion active that
  //    is a single currency; unconvertible rows stay native. ──────────
  const summary = useMemo(() => {
    const byCcy = new Map<string, SummaryLine>();
    for (const r of filtered) {
      if (!countsTowardTotals(r.status)) continue;
      const d = displayMap.get(r);
      if (!d) continue;
      const c = d.net.ccy ?? "—";
      const acc = byCcy.get(c) ?? { actual: 0, committed: 0, vat: 0, wht: 0, net: 0 };
      if (r.entry_kind === "actual") {
        // GROSS headline: the full expense incurred. Withholding tax is a
        // liability owed to the tax authority, not a reduction of cost —
        // the card sums AMOUNT and keeps NET visible as a sublabel only.
        acc.actual = round2(acc.actual + (d.amount.value ?? 0));
        acc.vat = round2(acc.vat + (d.vat.value ?? 0));
        acc.wht = round2(acc.wht + (d.wht.value ?? 0));
        acc.net = round2(acc.net + (d.net.value ?? 0));
      } else if (r.entry_kind === "commitment") {
        acc.committed = round2(acc.committed + (d.net.value ?? 0));
      }
      byCcy.set(c, acc);
    }
    const lines = [...byCcy.entries()].sort(
      (a, b) => b[1].actual + b[1].committed - (a[1].actual + a[1].committed),
    );
    return { count: filtered.length, lines };
  }, [filtered, displayMap]);

  // Per-kind row counts for the Transactions card caption — the quick
  // reconciliation read against the dashboard cards.
  const kindCounts = useMemo(() => {
    const c = { actual: 0, payment: 0, commitment: 0 };
    for (const r of filtered) {
      if (r.entry_kind === "actual") c.actual += 1;
      else if (r.entry_kind === "payment") c.payment += 1;
      else if (r.entry_kind === "commitment") c.commitment += 1;
    }
    return c;
  }, [filtered]);

  // ── Auto-hide: a column disappears when its raw value is empty for
  //    every row of the CURRENT filtered result. Nothing is hardcoded —
  //    add a column def and it participates automatically. ────────────
  const columns = useMemo(() => buildColumns(t, tableCcy), [t, tableCcy]);
  const { visibleCols, hiddenLabels } = useMemo(() => {
    if (filtered.length === 0) return { visibleCols: columns, hiddenLabels: [] as string[] };
    const visible: ColDef[] = [];
    const hidden: string[] = [];
    for (const c of columns) {
      const hasValue = filtered.some((r) => {
        const v = c.raw(r);
        return v != null && v !== "";
      });
      if (hasValue) visible.push(c);
      else hidden.push(c.label);
    }
    return { visibleCols: visible, hiddenLabels: hidden };
  }, [columns, filtered]);

  // GL account cell needs glById; money cells need the display-currency
  // layer — neither is available inside buildColumns.
  const cellFor = (c: ColDef, r: GlTransaction): ReactNode => {
    if (MONEY_KEYS.has(c.key)) {
      const d = displayMap.get(r);
      if (!d) return "—";
      const mv = d[c.key as MoneyField];
      return (
        <span className="inline-flex items-baseline justify-end gap-1">
          {money(mv.value, tableCcy && mv.ccy?.toUpperCase() === tableCcy ? null : mv.ccy)}
          {c.key === "amount" && d.amount.converted && (
            <sup
              className="text-warning text-[9px] leading-none"
              title={t("reports.gltx_converted_from", { ccy: r.resolvedCurrency })}
            >
              ●
            </sup>
          )}
        </span>
      );
    }
    if (c.key === "gl_account") {
      if (!r.gl_account_id) return "—";
      const gl = glById[r.gl_account_id];
      return gl ? `${gl.code} — ${gl.name}` : "—";
    }
    return c.cell(r);
  };

  // ── Sticky totals row, grouped by display currency. Values are the
  //    SUM OF THE ROUNDED ROWS — never converted separately. ──────────
  const totals = useMemo(() => {
    const byCcy = new Map<string, { amount: number; vat: number; wht: number; net: number }>();
    for (const r of filtered) {
      const d = displayMap.get(r);
      if (!d) continue;
      const c = d.net.ccy ?? "—";
      const acc = byCcy.get(c) ?? { amount: 0, vat: 0, wht: 0, net: 0 };
      acc.amount = round2(acc.amount + (d.amount.value ?? 0));
      acc.vat = round2(acc.vat + (d.vat.value ?? 0));
      acc.wht = round2(acc.wht + (d.wht.value ?? 0));
      acc.net = round2(acc.net + (d.net.value ?? 0));
      byCcy.set(c, acc);
    }
    return [...byCcy.entries()].sort((a, b) => b[1].net - a[1].net);
  }, [filtered, displayMap]);

  const totalFor = (key: "amount" | "vat" | "wht" | "net") =>
    totals.length === 0
      ? "0"
      : totals
          .map(([ccy, v]) =>
            tableCcy && totals.length === 1
              ? formatAmount(v[key], 2)
              : `${formatAmount(v[key], 2)} ${ccy}`,
          )
          .join(" · ");

  // ── Exports (gated on the RBAC export flag) — they receive exactly the
  //    filtered row set above, never the unfiltered dataset. ──────────
  const glName = (id: string | null): string => {
    if (!id) return "";
    const g = glById[id];
    return g ? `${g.code} · ${g.name}` : "";
  };
  const projectTag = activeProject?.code
    ? `${activeProject.code} — ${activeProject.name}`
    : (activeProject?.name ?? "Project");
  const projectSlug =
    (activeProject?.code ?? activeProject?.name ?? "project")
      .toString()
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "project";
  const exportMeta = { projectTag, projectSlug, dateFrom, dateTo, glName };

  const onExcel = () => {
    exportGlTransactionsExcel(filtered, exportMeta, { mode: exportMode, fx })
      .then(() => toast.success(t("reports.gltx_exported_excel")))
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  };
  const onPdf = () => {
    try {
      exportGlTransactionsPdf(filtered, exportMeta, { mode: exportMode, fx });
      toast.success(t("reports.gltx_exported_pdf"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (isReady && !permitted) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-10 text-center">
        <Lock className="size-8 mx-auto text-muted-foreground" />
        <div className="mt-3 font-semibold">{t("reports.gltx_locked_title")}</div>
        <div className="mt-1 text-sm text-muted-foreground">{t("reports.gltx_locked_body")}</div>
      </div>
    );
  }

  const summaryCard = (
    title: string,
    pick: (v: SummaryLine) => number,
    caption?: string,
    sub?: (v: SummaryLine) => number,
  ) => (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-0.5">
        {summary.lines.length === 0 && <div className="text-xl font-semibold tabular-nums">0</div>}
        {summary.lines.map(([ccy, v]) => (
          <div key={ccy}>
            <div className="text-xl font-semibold tabular-nums">
              {formatAmount(pick(v), 2)}{" "}
              <span className="text-xs font-medium text-muted-foreground">{ccy}</span>
            </div>
            {sub && v.wht !== 0 && (
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {t("reports.gltx_net_of_wht", {
                  value: `${formatAmount(sub(v), 2)} ${ccy}`,
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      {caption && (
        <div className="mt-2 text-[11px] leading-snug text-muted-foreground">{caption}</div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Summary — Total Actual is GROSS; WHT gets its own card so the
          tax liability is visible instead of silently netting cost down. */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("reports.gltx_transactions")}
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{summary.count}</div>
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {t("reports.gltx_count_breakdown", kindCounts)}
          </div>
        </div>
        {summaryCard(
          t("reports.gltx_total_actual"),
          (v) => v.actual,
          t("reports.gltx_gross_caption"),
          (v) => v.net,
        )}
        {summaryCard(t("reports.gltx_wht_total"), (v) => v.wht)}
        {summaryCard(
          t("reports.gltx_total_committed"),
          (v) => v.committed,
          t("reports.gltx_committed_caption"),
        )}
        {summaryCard(t("reports.gltx_vat_total"), (v) => v.vat)}
      </div>

      {/* FX rate line — MANDATORY whenever any figure on screen is
          converted; a hard notice when no rate is configured at all. */}
      {!fxQuery.isLoading && !fx && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <AlertTriangle className="size-4 text-warning shrink-0" />
          <span>{t("reports.gltx_no_rate")}</span>
          <Link to="/settings" className="underline font-medium">
            {t("reports.gltx_no_rate_cta")}
          </Link>
        </div>
      )}
      {fx && anyConverted && (
        <div className="px-1 text-xs text-muted-foreground">
          {t("reports.gltx_rate_line", {
            target: fx.targetCurrency,
            rate: formatRate(fx.rate),
            base: fx.baseCurrency,
          })}
          {" · "}
          {fx.effectiveFrom
            ? t("reports.gltx_rate_effective", { date: fx.effectiveFrom })
            : t("reports.gltx_rate_no_date")}
          {" · "}
          {t("reports.gltx_rate_source", { source: fx.source })}
          {" · "}
          {t("reports.gltx_rate_authority", {
            base: fx.baseCurrency,
            target: fx.targetCurrency,
          })}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("reports.gltx_from")}</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("reports.gltx_to")}</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("reports.gltx_source")}</label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("reports.gltx_all_sources")}</SelectItem>
                {ALL_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("reports.gltx_search")}</label>
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("reports.gltx_search_ph")}
                className="ps-8"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("reports.gltx_col_budget_code")}
            </label>
            <Input
              value={budgetCode}
              onChange={(e) => setBudgetCode(e.target.value)}
              placeholder="e.g. 5501"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("reports.gltx_col_gl_account")}
            </label>
            <Select value={glAccountId} onValueChange={setGlAccountId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("reports.gltx_all_kinds")}</SelectItem>
                {glRows.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.code} — {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("reports.gltx_department")}</label>
            <Input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Camera"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("reports.gltx_kind")}</label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("reports.gltx_all_kinds")}</SelectItem>
                {ALL_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`reports.gltx_${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("reports.gltx_qfe")}</label>
            <Select value={qfeOnly ? "qfe" : "all"} onValueChange={(v) => setQfeOnly(v === "qfe")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("reports.gltx_qfe_all")}</SelectItem>
                <SelectItem value="qfe">{t("reports.gltx_qfe_eligible")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {allowExport && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onExcel} disabled={txQuery.isLoading}>
              <FileSpreadsheet className="size-4 me-2" />
              {t("reports.gltx_export_excel")}
            </Button>
            <Button variant="outline" size="sm" onClick={onPdf} disabled={txQuery.isLoading}>
              <Download className="size-4 me-2" />
              {t("reports.gltx_export_pdf")}
            </Button>
            <div className="flex items-center gap-1.5 ms-2">
              <span className="text-xs text-muted-foreground">{t("reports.gltx_export_ccy")}</span>
              <Select
                value={exportMode}
                onValueChange={(v) => setExportMode(v as GlExportCurrencyMode)}
                disabled={!fx}
              >
                <SelectTrigger
                  className="h-8 w-32"
                  title={!fx ? t("reports.gltx_no_rate") : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">{t("reports.gltx_mode_both")}</SelectItem>
                  <SelectItem value="sar">{t("reports.gltx_mode_sar")}</SelectItem>
                  <SelectItem value="usd">{t("reports.gltx_mode_usd")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        {txQuery.isLoading && (
          <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            {t("reports.gltx_loading")}
          </div>
        )}
        {txQuery.isError && (
          <div className="p-8 text-center text-destructive text-sm">{t("reports.gltx_error")}</div>
        )}
        {!txQuery.isLoading && !txQuery.isError && (
          <>
            {hiddenLabels.length > 0 && (
              <div className="px-4 pt-3 text-[11px] text-muted-foreground">
                {t("reports.gltx_hidden_cols")}: {hiddenLabels.join(", ")}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    {visibleCols.map((c) => (
                      <th key={c.key} className={`${c.className ?? txt} font-medium text-start`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={`${r.source_type}-${r.id}`}
                      onClick={() => setSelected(r)}
                      className="border-b border-border/60 hover:bg-surface-2/50 transition-colors cursor-pointer"
                    >
                      {visibleCols.map((c) => (
                        <td key={c.key} className={c.className ?? txt}>
                          {cellFor(c, r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={visibleCols.length}
                        className="p-10 text-center text-muted-foreground"
                      >
                        {t("reports.gltx_empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="sticky bottom-0 bg-surface-2 border-t border-border text-sm font-semibold">
                      {visibleCols.map((c, i) => (
                        <td key={c.key} className={c.className ?? txt}>
                          {i === 0
                            ? t("reports.gltx_totals")
                            : c.key === "amount"
                              ? totalFor("amount")
                              : c.key === "vat"
                                ? totalFor("vat")
                                : c.key === "wht"
                                  ? totalFor("wht")
                                  : c.key === "net"
                                    ? totalFor("net")
                                    : ""}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {/* Legend for the conversion marker — a marker the reader cannot
                decode is worse than no marker at all. */}
            {anyConverted && filtered.length > 0 && (
              <div className="px-4 py-2 border-t border-border/60 text-[11px] text-muted-foreground">
                {t("reports.gltx_converted_legend", {
                  ccy:
                    fx && displayCcy.toUpperCase() === fx.baseCurrency.toUpperCase()
                      ? fx.targetCurrency
                      : (fx?.baseCurrency ?? displayCcy),
                })}
              </div>
            )}
          </>
        )}
      </div>

      {selected && <GlTransactionDrawer row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
