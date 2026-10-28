// Shared bits of the Film Commission Rebate report: status pill, money,
// export buttons, simple table.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatAmount } from "@/lib/format-number";
import { formatDate } from "@/lib/date-format";
import { statusTone } from "./rebate-calc";
import type { EligibilityStatus } from "./rebate-types";

export const thCls = "px-3 py-2 text-start font-semibold text-muted-foreground whitespace-nowrap";
export const thNumCls = "px-3 py-2 text-end font-semibold text-muted-foreground whitespace-nowrap";
export const tdCls = "px-3 py-2 align-top";
export const tdNumCls = "px-3 py-2 text-end tabular-nums whitespace-nowrap align-top";

export function Money({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  return <span className={v < 0 ? "text-destructive" : undefined}>{formatAmount(v, 2)}</span>;
}

export function DateText({ v }: { v: string | null | undefined }) {
  return <span className="whitespace-nowrap">{v ? formatDate(v) : "—"}</span>;
}

const toneCls = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
} as const;

export function StatusPill({ status }: { status: EligibilityStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneCls[statusTone(status)]}`}
    >
      {t(`rebate.status.${status}`)}
    </span>
  );
}

export function Flags({ flags }: { flags: readonly string[] | undefined }) {
  const { t } = useTranslation();
  if (!flags?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f}
          className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning"
          title={t(`rebate.flag.${f}`, { defaultValue: f })}
        >
          {t(`rebate.flag.${f}`, { defaultValue: f })}
        </span>
      ))}
    </div>
  );
}

export function ExportButtons({
  onExport,
  disabled,
  size = "sm",
}: {
  onExport: (kind: "excel" | "pdf") => Promise<unknown>;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<null | "excel" | "pdf">(null);
  const run = async (kind: "excel" | "pdf") => {
    if (busy) return;
    setBusy(kind);
    try {
      await onExport(kind);
      toast.success(t(kind === "excel" ? "rebate.exported_excel" : "rebate.exported_pdf"));
    } catch (e) {
      console.error(e);
      toast.error(t("rebate.export_failed"));
    } finally {
      setBusy(null);
    }
  };
  const cls =
    size === "md"
      ? "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
      : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => run("excel")}
        disabled={disabled || busy !== null}
        className={`${cls} border border-success/30 bg-success/15 text-success hover:bg-success/25 disabled:opacity-40`}
      >
        {busy === "excel" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FileSpreadsheet className="size-3.5" />
        )}
        {t("rebate.export_excel")}
      </button>
      <button
        type="button"
        onClick={() => run("pdf")}
        disabled={disabled || busy !== null}
        className={`${cls} border border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/25 disabled:opacity-40`}
      >
        {busy === "pdf" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FileText className="size-3.5" />
        )}
        {t("rebate.export_pdf")}
      </button>
    </div>
  );
}

export function SectionHeader({
  title,
  hint,
  actions,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-base font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {actions}
    </div>
  );
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-8 text-center text-sm text-muted-foreground">
        {text}
      </td>
    </tr>
  );
}

export function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "brand" | "success" | "warning";
}) {
  const ring =
    tone === "success"
      ? "border-success/40"
      : tone === "warning"
        ? "border-warning/40"
        : tone === "brand"
          ? "border-brand/40"
          : "border-border";
  return (
    <div className={`rounded-xl border ${ring} bg-surface p-4`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
