// Settings → Organization: the organization's budget templates (D20).
// Org admins upload a template (Excel / CSV: Group · Header code · Header
// name · Code · Description), pick the default one, or go back to the
// built-in template. Everyone in the organization reads them.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Star, Trash2, Upload } from "lucide-react";
import { useAuthRoles } from "@/lib/auth-roles";
import { loadXlsx } from "@/lib/lazy-export-libs";
import { humanizeDbError } from "@/lib/db-errors";
import {
  MAX_TEMPLATE_LINES,
  budgetTemplateKey,
  builtinTemplateLines,
  deleteBudgetTemplate,
  listBudgetTemplates,
  parseTemplateSheet,
  BudgetTemplateSchema,
  saveBudgetTemplate,
  setDefaultBudgetTemplate,
  templateHeaders,
  templateToSheet,
  type BudgetTemplateRow,
} from "@/lib/budget-template";

export function BudgetTemplatePanel({ organizationId }: { organizationId: string | null }) {
  const { t } = useTranslation();
  const roles = useAuthRoles();
  const qc = useQueryClient();
  const canEdit =
    !!organizationId && (roles.isSuperAdmin || roles.adminOrgIds.includes(organizationId));
  const [rows, setRows] = useState<BudgetTemplateRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!organizationId) return setRows([]);
    try {
      setRows(await listBudgetTemplates(organizationId));
    } catch {
      setRows([]);
    }
  }, [organizationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const changed = async () => {
    await load();
    await qc.invalidateQueries({ queryKey: budgetTemplateKey(organizationId) });
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await changed();
    } catch (e: any) {
      toast.error(humanizeDbError(e) || e?.message || t("closeout.template.failed"));
    } finally {
      setBusy(false);
    }
  };

  const downloadBuiltin = async () => {
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(templateToSheet(builtinTemplateLines()));
    ws["!cols"] = [{ wch: 8 }, { wch: 12 }, { wch: 36 }, { wch: 12 }, { wch: 48 }];
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    const { writeBrandedSheetJs } = await import("@/lib/export/sheetjs-branding");
    // the branded header rows sit above the column headers; the importer finds them
    await writeBrandedSheetJs(XLSX, wb, "Budget Template", t("closeout.template.builtin"));
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !organizationId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("closeout.template.too_big"));
      return;
    }
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
    const { lines, errors } = parseTemplateSheet(aoa);
    if (errors.some((e) => e.problem === "columns")) {
      toast.error(t("closeout.template.bad_columns"));
      return;
    }
    if (!lines.length) {
      toast.error(t("closeout.template.empty"));
      return;
    }
    if (lines.length > MAX_TEMPLATE_LINES) {
      toast.error(t("closeout.template.too_many", { max: MAX_TEMPLATE_LINES }));
      return;
    }
    if (errors.length) {
      toast.error(
        t("closeout.template.row_errors", {
          count: errors.length,
          rows: errors
            .slice(0, 8)
            .map((e) => e.row)
            .join(", "),
          interpolation: { escapeValue: false },
        }),
      );
      return;
    }
    const tplName = (name.trim() || file.name.replace(/\.(xlsx|xls|csv)$/i, "")).slice(0, 120);
    if (!BudgetTemplateSchema.safeParse({ name: tplName, lines }).success) {
      toast.error(t("closeout.template.invalid"));
      return;
    }
    await act(
      () => saveBudgetTemplate({ organizationId, name: tplName, lines }),
      t("closeout.template.saved", {
        name: tplName,
        lines: lines.length,
        headers: templateHeaders(lines).length,
      }),
    );
    setName("");
  };

  const current = rows.find((r) => r.is_default) ?? null;

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{t("closeout.template.title")}</h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{t("closeout.template.explain")}</p>
      <div className="mb-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
        {current
          ? t("closeout.template.in_use", { name: current.name })
          : t("closeout.template.in_use_builtin")}
      </div>

      <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
        <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <span>
            {t("closeout.template.builtin")}{" "}
            <span className="text-xs text-muted-foreground">
              {t("closeout.template.count", { lines: builtinTemplateLines().length })}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void downloadBuiltin()}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              <Download className="size-3" /> {t("closeout.template.download")}
            </button>
            {canEdit && current && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => setDefaultBudgetTemplate(organizationId!, null),
                    t("closeout.template.default_builtin"),
                  )
                }
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                <Star className="size-3" /> {t("closeout.template.use")}
              </button>
            )}
          </span>
        </li>
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
          >
            <span>
              {r.name}{" "}
              <span className="text-xs text-muted-foreground">
                {t("closeout.template.count", { lines: r.lines?.length ?? 0 })}
              </span>
              {r.is_default && (
                <span className="ms-2 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                  {t("closeout.template.default")}
                </span>
              )}
            </span>
            {canEdit && (
              <span className="flex items-center gap-1">
                {!r.is_default && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => setDefaultBudgetTemplate(organizationId!, r.id),
                        t("closeout.template.default_set", { name: r.name }),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <Star className="size-3" /> {t("closeout.template.use")}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("closeout.template.delete")}
                  title={t("closeout.template.delete")}
                  onClick={() => {
                    if (!confirm(t("closeout.template.confirm_delete", { name: r.name }))) return;
                    void act(() => deleteBudgetTemplate(r.id), t("closeout.template.deleted"));
                  }}
                  className="rounded-lg p-1.5 text-destructive hover:bg-destructive/15 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs text-muted-foreground">
              {t("closeout.template.name")}
            </span>
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Upload className="size-3.5" /> {t("closeout.template.upload")}
          </button>
          <p className="w-full text-xs text-muted-foreground">{t("closeout.template.columns")}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("closeout.template.admins_only")}</p>
      )}
    </div>
  );
}
