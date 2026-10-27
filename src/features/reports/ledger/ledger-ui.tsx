// Shared bits of the ledger report tabs: period filter, export buttons,
// phase badge, money cell.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { formatAmount } from "@/lib/format-number";
import { monthRange } from "@/lib/ledger-calc";
import {
  exportLedgerPdf,
  exportLedgerXlsx,
  ledgerFileName,
  type LedgerExportTable,
} from "./ledger-export";

export const numCls = "text-end tabular-nums whitespace-nowrap px-3 py-2";
export const txtCls = "px-3 py-2 whitespace-nowrap";
export const thCls = "px-3 py-2 text-start font-semibold text-muted-foreground whitespace-nowrap";
export const thNumCls = "px-3 py-2 text-end font-semibold text-muted-foreground whitespace-nowrap";

/** Amount cell: blank for zero, negative in the destructive tone. */
export function Money({ v, blankZero = false }: { v: number; blankZero?: boolean }) {
  if (blankZero && Math.abs(v) < 0.005) return <span className="text-muted-foreground">—</span>;
  return <span className={v < 0 ? "text-destructive" : undefined}>{formatAmount(v, 2)}</span>;
}

export function PeriodFilter({
  from,
  to,
  onChange,
  children,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [month, setMonth] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("journal.month")}
        <Input
          type="month"
          value={month}
          className="h-9 w-40"
          onChange={(e) => {
            setMonth(e.target.value);
            const r = monthRange(e.target.value);
            onChange(r.from, r.to);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("journal.from")}
        <Input
          type="date"
          value={from}
          className="h-9 w-40"
          onChange={(e) => {
            setMonth("");
            onChange(e.target.value, to);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("journal.to")}
        <Input
          type="date"
          value={to}
          className="h-9 w-40"
          onChange={(e) => {
            setMonth("");
            onChange(from, e.target.value);
          }}
        />
      </label>
      {children}
    </div>
  );
}

export function ExportButtons({
  build,
  projectCode,
  report,
  disabled,
}: {
  build: () => LedgerExportTable;
  projectCode: string | null;
  report: string;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState<null | "xlsx" | "pdf">(null);
  const rtl = i18n.language?.startsWith("ar") ?? false;
  const run = async (kind: "xlsx" | "pdf") => {
    if (busy) return;
    setBusy(kind);
    try {
      const table = build();
      const name = ledgerFileName(projectCode, report, kind);
      if (kind === "xlsx") await exportLedgerXlsx(name, table, rtl);
      else await exportLedgerPdf(name, table, rtl);
      toast.success(t("journal.exported"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const cls =
    "inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => run("xlsx")}
        className={`${cls} bg-success/20 text-success border-success/30 hover:bg-success/30`}
      >
        {busy === "xlsx" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="size-4" />
        )}
        {t("journal.export_excel")}
      </button>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => run("pdf")}
        className={`${cls} bg-destructive/20 text-destructive border-destructive/30 hover:bg-destructive/30`}
      >
        {busy === "pdf" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileText className="size-4" />
        )}
        {t("journal.export_pdf")}
      </button>
    </div>
  );
}

export function PhaseBadge({ phase }: { phase: number | undefined }) {
  const { t } = useTranslation();
  if (!phase) return null;
  return (
    <span
      className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground"
      title={phase === 2 ? t("journal.phase2_hint") : t("journal.phase1_hint")}
    >
      {phase === 2 ? t("journal.phase2") : t("journal.phase1")}
    </span>
  );
}

export function StateLine({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
}) {
  const { t } = useTranslation();
  if (loading)
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("journal.loading")}
      </div>
    );
  if (error) return <div className="py-6 text-sm text-destructive">{error}</div>;
  if (empty)
    return <div className="py-6 text-sm text-muted-foreground">{t("journal.no_lines")}</div>;
  return null;
}

/** Account label "9100 · Project Bank Account". */
export const accountLabel = (code: string | null, name: string | null) =>
  [code, name].filter(Boolean).join(" · ") || "—";
