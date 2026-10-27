import { useEffect, useId, useMemo, useState } from "react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  headerOptions,
  lineById,
  loadProjectBudgetLines,
  cachedProjectBudgetLines,
  subAccountLines,
  subAccountOptions,
} from "@/lib/budget-mapping-options";
import { startBudgetCacheRealtime, subscribeBudgetCaches } from "@/lib/budget-cache-bus";
import { useTranslation } from "react-i18next";
import {
  countLinesWithCode,
  disambiguatedLineLabel,
  headerNameForBudgetLine,
  lineNameForBudgetLine,
  parentHeaderCodeForLine,
  type ProjectBudgetLine,
} from "@/lib/project-budget-lines";

export type BudgetMappingValue = {
  headerCode: string;
  /** budget_lines.id — the authoritative mapping key. */
  lineId: string | null;
  /** Convenience mirror of the picked line's code. */
  code: string;
  line: ProjectBudgetLine | null;
};

type Props = {
  headerCode: string;
  lineId: string | null;
  onChange: (value: BudgetMappingValue) => void;
  /** Pre-loaded project lines; fetched from the active project when omitted. */
  lines?: ProjectBudgetLine[];
  projectId?: string | null;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  headerLabel?: string;
  subLabel?: string;
  /** Show the resolved header / sub-account / row id preview strip. */
  showPreview?: boolean;
};

/**
 * Universal cascading Header Account → Sub-Account mapping picker.
 *
 * The header dropdown lists ONLY real parent categories (codes ending in 00);
 * the sub-account dropdown lists the executable line items beneath the chosen
 * header and binds to the unique budget_lines row id, so duplicate codes
 * (three "1401" cast roles) stay individually selectable.
 */
export function BudgetMappingSelect({
  headerCode,
  lineId,
  onChange,
  lines: linesProp,
  projectId,
  required = false,
  disabled = false,
  className,
  headerLabel = "Header Account",
  subLabel = "Sub-Account (Budget Code)",
  showPreview = true,
}: Props) {
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const scopedProjectId = projectId ?? activeProjectId;
  const uid = useId();
  const headerFieldId = `${uid}-header`;
  const subFieldId = `${uid}-sub`;
  const previewId = `${uid}-preview`;
  const cachedRows =
    !linesProp && scopedProjectId ? cachedProjectBudgetLines(scopedProjectId) : null;
  const [fetched, setFetched] = useState<ProjectBudgetLine[]>(() => cachedRows ?? []);
  const [loading, setLoading] = useState(() => !linesProp && !!scopedProjectId && !cachedRows);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (linesProp || !scopedProjectId) {
      setLoading(false);
      return;
    }
    startBudgetCacheRealtime();
    let cancelled = false;

    const run = (useCache: boolean) => {
      if (cancelled) return;
      const cached = useCache ? cachedProjectBudgetLines(scopedProjectId) : null;
      if (cached) {
        setFetched(cached);
        setLoading(false);
        setLoadError(null);
        return;
      }
      setLoading(true);
      setLoadError(null);
      loadProjectBudgetLines(scopedProjectId)
        .then((rows) => {
          if (cancelled) return;
          setFetched(rows);
          setLoading(false);
        })
        .catch((e: any) => {
          if (cancelled) return;
          setFetched([]);
          setLoadError(
            e?.message
              ? `Could not load budget accounts: ${e.message}`
              : "Could not load budget accounts.",
          );
          setLoading(false);
        });
    };

    run(true);

    // Refetch whenever budget lines or the Master COA change anywhere in the
    // app (this tab or another user), so descriptions are never stale.
    const unsubscribe = subscribeBudgetCaches((event) => {
      if (event.projectId && event.projectId !== scopedProjectId) return;
      run(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [linesProp, scopedProjectId]);

  const lines = linesProp ?? fetched;
  const headers = useMemo(() => headerOptions(lines), [lines]);
  const subAccounts = useMemo(() => subAccountLines(lines, headerCode), [lines, headerCode]);
  const subOptions = useMemo(() => subAccountOptions(lines, headerCode), [lines, headerCode]);

  const selectedLine = useMemo(() => lineById(lines, lineId), [lines, lineId]);
  const duplicateCount = selectedLine ? countLinesWithCode(lines, selectedLine.mainCode) : 0;

  // Keep the header in sync when a line is restored from a saved record.
  useEffect(() => {
    if (!selectedLine) return;
    const parent = parentHeaderCodeForLine(selectedLine);
    if (parent && parent !== headerCode) {
      onChange({
        headerCode: parent,
        lineId: selectedLine.id,
        code: selectedLine.mainCode,
        line: selectedLine,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLine]);

  return (
    <div className={cn("contents", className)}>
      <div className="text-sm">
        <label htmlFor={headerFieldId} className="text-muted-foreground mb-1 block">
          {headerLabel}
          {required && <span className="text-destructive"> *</span>}
        </label>
        <SearchableSelect
          id={headerFieldId}
          ariaLabel={headerLabel}
          ariaDescribedBy={showPreview ? previewId : undefined}
          value={headerCode}
          disabled={disabled || loading}
          loading={loading}
          errorLabel={loadError ?? undefined}
          onChange={(v) => onChange({ headerCode: v, lineId: null, code: "", line: null })}
          options={headers}
          placeholder={t("budgetmappingselect.select_header_category")}
          emptyValueLabel="— Unassigned (map later) —"
          searchPlaceholder="Search header code or name…"
          emptyLabel="No matching header category."
        />
      </div>

      <div className="text-sm">
        <label htmlFor={subFieldId} className="text-muted-foreground mb-1 block">
          {subLabel}
          {required && <span className="text-destructive"> *</span>}
        </label>
        <SearchableSelect
          id={subFieldId}
          ariaLabel={subLabel}
          ariaDescribedBy={showPreview ? previewId : undefined}
          value={lineId ?? ""}
          disabled={disabled || loading || !headerCode}
          loading={loading}
          errorLabel={loadError ?? undefined}

          onChange={(v) => {
            const picked = subAccounts.find((line) => line.id === v) ?? null;
            onChange({
              headerCode: picked ? parentHeaderCodeForLine(picked) : headerCode,
              lineId: picked?.id ?? null,
              code: picked?.mainCode ?? "",
              line: picked,
            });
          }}
          options={subOptions}
          placeholder={headerCode ? "— Select sub-account —" : "Pick a header first"}
          emptyValueLabel="— Unassigned (map later) —"
          searchPlaceholder="Search sub-account code, description or name…"
          emptyLabel={headerCode ? "No sub-accounts under this header." : "Pick a header first."}
        />
        {selectedLine && duplicateCount > 1 && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            Code {selectedLine.mainCode} is used by {duplicateCount} budget rows — linked to “
            {disambiguatedLineLabel(selectedLine, lines)}”.
          </div>
        )}
      </div>

      {showPreview && (
        <div
          id={previewId}
          role="status"
          aria-live="polite"
          data-testid="budget-mapping-preview"
          className="col-span-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-[11px] text-muted-foreground"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <span className="uppercase tracking-wide">Header</span>{" "}
              <span className="font-mono text-foreground">{headerCode || "—"}</span>
              {headerCode && (
                <span className="text-foreground">
                  {" "}
                  {headerNameForBudgetLine(headerCode, lines)}
                </span>
              )}
            </span>
            <span>
              <span className="uppercase tracking-wide">Sub-account</span>{" "}
              <span className="text-foreground">
                {selectedLine
                  ? `${selectedLine.mainCode} — ${lineNameForBudgetLine(selectedLine)}`
                  : "— not selected —"}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
