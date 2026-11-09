import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { formatAmount } from "@/lib/format-number";
import type { TelfazTotals, TelfazValidation } from "@/lib/budget-telfaz-format";
import type { ImportTarget } from "@/lib/budget-import-target";

const money = (n: number | null) => (n === null ? "—" : formatAmount(n, 2));

function StatusBadge({ status }: { status: TelfazTotals["status"] }) {
  const { t } = useTranslation();
  const cls =
    status === "match"
      ? "border-success/40 bg-success/10 text-success"
      : status === "explained"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {t(`budget.telfaz.status_${status}`)}
    </span>
  );
}

/** Why the imported figure differs from the file's own subtotal / Top Sheet. */
function reasons(
  tt: TelfazTotals,
  t: (k: string, o?: Record<string, unknown>) => string,
): string[] {
  const out: string[] = [];
  if (tt.fileSar !== null && Math.abs(tt.rowsSar - tt.fileSar) >= 0.01)
    out.push(
      t("budget.telfaz.reason_subtotal_sar", { rows: money(tt.rowsSar), file: money(tt.fileSar) }),
    );
  if (tt.fileUsd !== null && Math.abs(tt.rowsUsd - tt.fileUsd) >= 0.01)
    out.push(
      t("budget.telfaz.reason_subtotal_usd", { rows: money(tt.rowsUsd), file: money(tt.fileUsd) }),
    );
  if (Math.abs(tt.sarKeptUsdDelta) >= 0.01)
    out.push(t("budget.telfaz.reason_sar_kept", { usd: money(tt.sarKeptUsdDelta) }));
  if (tt.excludedUsd > 0)
    out.push(t("budget.telfaz.reason_included", { usd: money(tt.excludedUsd) }));
  return out;
}

/**
 * Validation summary of a workbook in the client's own budget layout:
 * per sheet and per section, the file's total next to what Kwalis will
 * import (SAR and USD at the file's rate), every adjustment and every row
 * that was not turned into a line.
 */
export function TelfazImportCheck({ validation }: { validation: TelfazValidation }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const v = validation;
  const cell = "px-2 py-1.5 text-end tabular-nums whitespace-nowrap";
  const skippedShown = v.skipped.filter((s) => s.reason !== "included_in_production");
  return (
    <section
      className="mt-5 rounded-2xl border border-border bg-surface-2 p-4 text-sm"
      aria-label={t("budget.telfaz.title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div className="font-semibold">{t("budget.telfaz.title")}</div>
          <div className="text-xs text-muted-foreground">
            {t("budget.telfaz.subtitle", { fx: v.fx })}
          </div>
        </div>
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${v.ok ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive"}`}
        >
          {v.ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          {v.ok ? t("budget.telfaz.all_rows_read") : t("budget.telfaz.rows_missing")}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface-1 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-start">{t("budget.telfaz.col_section")}</th>
              <th className={cell}>{t("budget.telfaz.col_lines")}</th>
              <th className={cell}>{t("budget.telfaz.col_file_sar")}</th>
              <th className={cell}>{t("budget.telfaz.col_parsed_sar")}</th>
              <th className={cell}>{t("budget.telfaz.col_file_usd")}</th>
              <th className={cell}>{t("budget.telfaz.col_parsed_usd")}</th>
              <th className="px-2 py-1.5 text-start">{t("budget.telfaz.col_check")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {v.sheets.map((s) => (
              <SheetRows
                key={s.sheet}
                sheet={s}
                open={!!open[s.sheet]}
                onToggle={() => setOpen((o) => ({ ...o, [s.sheet]: !o[s.sheet] }))}
                cell={cell}
              />
            ))}
            <tr className="bg-surface-1 font-semibold">
              <td className="px-2 py-1.5">{t("budget.telfaz.grand_total")}</td>
              <td className={cell}>{v.sheets.reduce((a, s) => a + s.lines, 0)}</td>
              <td className={cell}>{money(v.grand.fileSar)}</td>
              <td className={cell}>{money(v.grand.parsedSar)}</td>
              <td className={cell}>{money(v.grand.fileUsd)}</td>
              <td className={cell}>{money(v.grand.parsedUsd)}</td>
              <td className="px-2 py-1.5">
                <StatusBadge status={v.grand.status} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground flex gap-1.5">
        <Info className="size-3.5 shrink-0 mt-px" />
        {t("budget.telfaz.legend")}
      </p>

      {v.adjustments.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium">
            {t("budget.telfaz.adjustments", { count: v.adjustments.length })}
          </summary>
          <ul className="mt-2 max-h-64 overflow-auto rounded-lg border border-border divide-y divide-border text-xs">
            {v.adjustments.map((a, i) => (
              <li key={i} className="px-3 py-1.5 flex flex-wrap gap-x-2">
                <span className="text-muted-foreground tabular-nums">
                  {a.sheet} · {t("budget.telfaz.row_n", { row: a.row })}
                </span>
                <span className="font-mono">{a.code}</span>
                <span>{a.description}</span>
                <span className="text-muted-foreground">
                  — {t(`budget.telfaz.kind_${a.kind}`)}: {a.detail}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {skippedShown.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium">
            {t("budget.telfaz.skipped", { count: skippedShown.length })}
          </summary>
          <ul className="mt-2 max-h-64 overflow-auto rounded-lg border border-border divide-y divide-border text-xs">
            {skippedShown.map((s, i) => (
              <li key={i} className="px-3 py-1.5 flex flex-wrap gap-x-2">
                <span className="text-muted-foreground tabular-nums">
                  {s.sheet} · {t("budget.telfaz.row_n", { row: s.row })}
                </span>
                <span className="font-mono">{s.code || "—"}</span>
                <span>{s.item || "—"}</span>
                <span className="text-muted-foreground">
                  — {t(`budget.telfaz.skip_${s.reason}`)}
                </span>
                {(Math.abs(s.usd) > 0.005 || Math.abs(s.sar) > 0.005) && (
                  <span className="text-destructive tabular-nums">
                    {money(s.sar)} SAR / {money(s.usd)} USD
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function SheetRows({
  sheet: s,
  open,
  onToggle,
  cell,
}: {
  sheet: TelfazValidation["sheets"][number];
  open: boolean;
  onToggle: () => void;
  cell: string;
}) {
  const { t } = useTranslation();
  const why = reasons(s, t);
  return (
    <>
      <tr className="font-medium">
        <td className="px-2 py-1.5">
          <button
            type="button"
            onClick={onToggle}
            className="text-start hover:underline"
            aria-expanded={open}
          >
            {open ? "▾" : "▸"} {s.sheet}
          </button>
        </td>
        <td className={cell}>{s.lines}</td>
        <td className={cell}>{money(s.fileSar)}</td>
        <td className={cell}>{money(s.parsedSar)}</td>
        <td className={cell}>{money(s.fileUsd)}</td>
        <td className={cell}>{money(s.parsedUsd)}</td>
        <td className="px-2 py-1.5">
          <StatusBadge status={s.status} />
          {why.length > 0 && (
            <ul className="mt-1 text-[10px] text-muted-foreground list-disc ps-4">
              {why.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </td>
      </tr>
      {open &&
        s.sections.map((sec) => {
          const w = reasons(sec, t);
          return (
            <tr key={`${s.sheet}-${sec.code}`} className="text-muted-foreground">
              <td className="px-2 py-1 ps-6">
                <span className="font-mono">{sec.code}</span> {sec.name}
              </td>
              <td className={cell}>{sec.lines}</td>
              <td className={cell}>{money(sec.fileSar)}</td>
              <td className={cell}>{money(sec.parsedSar)}</td>
              <td className={cell}>{money(sec.fileUsd)}</td>
              <td className={cell}>{money(sec.parsedUsd)}</td>
              <td className="px-2 py-1">
                <StatusBadge status={sec.status} />
                {w.length > 0 && (
                  <ul className="mt-1 text-[10px] list-disc ps-4">
                    {w.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          );
        })}
    </>
  );
}

/** Where the commit lands when the selected version already has lines. */
export function ImportTargetPicker({
  options,
  value,
  onChange,
  existingLines,
  existingMatches,
  versionName,
}: {
  options: ImportTarget[];
  value: ImportTarget;
  onChange: (t: ImportTarget) => void;
  existingLines: number;
  existingMatches: number;
  versionName: string;
}) {
  const { t } = useTranslation();
  if (options.length <= 1) return null;
  return (
    <fieldset className="mt-5 rounded-2xl border border-warning/40 bg-warning/5 p-4 text-sm">
      <legend className="px-1 text-xs font-semibold text-warning">
        {t("budget.import_target.title")}
      </legend>
      <p className="text-xs text-muted-foreground mb-2">
        {t("budget.import_target.intro", { count: existingLines, version: versionName })}
        {existingMatches > 0 && (
          <span className="ms-1 font-medium text-warning">
            {t("budget.import_target.matches", { count: existingMatches })}
          </span>
        )}
      </p>
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <label key={o} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="budget-import-target"
              className="mt-1"
              checked={value === o}
              onChange={() => onChange(o)}
            />
            <span>
              <span className="font-medium">{t(`budget.import_target.${o}`)}</span>
              <span className="block text-xs text-muted-foreground">
                {t(`budget.import_target.${o}_hint`)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
