import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, Settings as SettingsIcon, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import {
  EMPTY_PROJECT_METADATA,
  fetchProjectMetadata,
  saveProjectMetadata,
  type ProjectMetadata,
} from "@/lib/project-metadata";
import { ProjectCurrencyPanel } from "@/components/CurrencyFxSettings";

import { useTranslation } from "react-i18next";
/**
 * Per-project settings modal. Exposes the USD → SAR exchange rate (persisted on
 * `public.projects.fx_rate`) plus the production header metadata (Production
 * Company, Producer, Line Producer, Prepared By, Budget Setting, Prep/Shoot
 * Days, Filming Locations) that populates the Budget and Top Sheet headers
 * across the app.
 */
export function ProjectSettingsDialog() {
  const { t } = useTranslation();

  const activeId = useStore((s) => s.activeProjectId);
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const setProjectFxRate = useStore((s) => s.setProjectFxRate);

  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState<string>("3.75");
  const [meta, setMeta] = useState<ProjectMetadata>(EMPTY_PROJECT_METADATA);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (!open || !project) return;
    setRate(String(project.fxRate ?? 3.75));
    setStatus("idle");
    setStatusMsg("");
    let cancelled = false;
    void fetchProjectMetadata(project.id).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [open, project]);

  if (!activeId || !project) return null;

  const onSave = async () => {
    const n = Number(rate);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(t("projectsettingsdialog.enter_a_positive_exchange_rate"));
      return;
    }
    if (meta.shootDays != null && (!Number.isFinite(meta.shootDays) || meta.shootDays < 0)) {
      toast.error(t("projectsettingsdialog.shoot_days_must_be_a_positive_number"));
      return;
    }
    if (meta.prepDays != null && (!Number.isFinite(meta.prepDays) || meta.prepDays < 0)) {
      toast.error(t("projectsettingsdialog.prep_days_must_be_a_positive_number"));
      return;
    }
    setSaving(true);
    setStatus("saving");
    setStatusMsg("Saving changes…");
    try {
      // Metadata publishes optimistically (headers repaint instantly) and
      // rolls back automatically if the write fails.
      await saveProjectMetadata(activeId, meta);
      await setProjectFxRate(activeId, n);
      setStatus("saved");
      setStatusMsg("All changes saved");
      toast.success(t("projectsettingsdialog.project_settings_saved"));
      setTimeout(() => setOpen(false), 500);
    } catch (err: any) {
      setStatus("error");
      setStatusMsg(err?.message ?? "Failed to save project settings.");
      toast.error(err?.message ?? "Failed to save project settings — changes were reverted.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-lg bg-surface-2 border border-border text-foreground text-sm px-3 py-2 focus:outline-none focus:border-brand";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("projectsettingsdialog.project_settings_2")}
        aria-label={t("projectsettingsdialog.project_settings_2")}
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SettingsIcon className="size-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("projectsettingsdialog.project_settings_2")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-popover text-popover-foreground border border-border shadow-2xl">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
              <div>
                <div className="text-sm font-semibold">
                  {t("projectsettingsdialog.project_settings")}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
                  {project.code ? `${project.code} · ` : ""}
                  {project.name}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-accent"
                aria-label={t("projectsettingsdialog.close_settings")}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="px-5 py-5 space-y-5">
              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("projectsettingsdialog.production_header")}
                </div>
                <div>
                  <label
                    className="block text-xs font-semibold text-foreground mb-1.5"
                    htmlFor="ps-prod-co"
                  >
                    {t("projectsettingsdialog.production_company")}
                  </label>
                  <input
                    id="ps-prod-co"
                    type="text"
                    value={meta.productionCompany}
                    onChange={(e) => setMeta({ ...meta, productionCompany: e.target.value })}
                    placeholder={t("projectsettingsdialog.eg_kwalis_studios")}
                    className={inputCls}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t("projectsettingsdialog.separate_multiple_companies_with_commas")}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      className="block text-xs font-semibold text-foreground mb-1.5"
                      htmlFor="ps-producer"
                    >
                      Producer
                    </label>
                    <input
                      id="ps-producer"
                      type="text"
                      value={meta.producer}
                      onChange={(e) => setMeta({ ...meta, producer: e.target.value })}
                      placeholder="Full name"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs font-semibold text-foreground mb-1.5"
                      htmlFor="ps-line-producer"
                    >
                      {t("projectsettingsdialog.line_producer")}
                    </label>
                    <input
                      id="ps-line-producer"
                      type="text"
                      value={meta.lineProducer}
                      onChange={(e) => setMeta({ ...meta, lineProducer: e.target.value })}
                      placeholder="Full name"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs font-semibold text-foreground mb-1.5"
                      htmlFor="ps-prepared-by"
                    >
                      {t("projectsettingsdialog.prepared_by")}
                    </label>
                    <input
                      id="ps-prepared-by"
                      type="text"
                      value={meta.preparedBy}
                      onChange={(e) => setMeta({ ...meta, preparedBy: e.target.value })}
                      placeholder={t("projectsettingsdialog.budget_preparer")}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs font-semibold text-foreground mb-1.5"
                      htmlFor="ps-budget-setting"
                    >
                      {t("projectsettingsdialog.budget_setting")}
                    </label>
                    <input
                      id="ps-budget-setting"
                      type="text"
                      value={meta.budgetSetting}
                      onChange={(e) => setMeta({ ...meta, budgetSetting: e.target.value })}
                      placeholder={t("projectsettingsdialog.eg_riyadh_studio_location")}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      className="block text-xs font-semibold text-foreground mb-1.5"
                      htmlFor="ps-prep-days"
                    >
                      {t("projectsettingsdialog.prep_days")}
                    </label>
                    <input
                      id="ps-prep-days"
                      type="number"
                      min={0}
                      step={1}
                      dir="ltr"
                      value={meta.prepDays ?? ""}
                      onChange={(e) =>
                        setMeta({
                          ...meta,
                          prepDays: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      placeholder="0"
                      className={`${inputCls} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-xs font-semibold text-foreground mb-1.5"
                      htmlFor="ps-shoot-days"
                    >
                      Shoot Days
                    </label>
                    <input
                      id="ps-shoot-days"
                      type="number"
                      min={0}
                      step={1}
                      dir="ltr"
                      value={meta.shootDays ?? ""}
                      onChange={(e) =>
                        setMeta({
                          ...meta,
                          shootDays: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      placeholder="0"
                      className={`${inputCls} tabular-nums`}
                    />
                  </div>
                  <div className="col-span-2">
                    <label
                      className="block text-xs font-semibold text-foreground mb-1.5"
                      htmlFor="ps-locations"
                    >
                      {t("projectsettingsdialog.filming_locations")}
                    </label>
                    <input
                      id="ps-locations"
                      type="text"
                      value={meta.filmingLocations}
                      onChange={(e) => setMeta({ ...meta, filmingLocations: e.target.value })}
                      placeholder={t("projectsettingsdialog.riyadh_alula")}
                      className={inputCls}
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3 border-t border-border pt-5">
                <ProjectCurrencyPanel
                  projectId={activeId}
                  onSaved={(usd) => {
                    if (usd && usd > 0) {
                      setRate(String(usd));
                      void setProjectFxRate(activeId, usd);
                    }
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  The base currency and rates drive all dual-currency displays (budget rows, section
                  subtotals, macro cards, reports).
                </p>
              </section>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-surface-2 rounded-b-2xl">
              <div
                aria-live="polite"
                className={`flex items-center gap-1.5 text-xs font-medium ${
                  status === "error"
                    ? "text-destructive"
                    : status === "saved"
                      ? "text-success"
                      : "text-muted-foreground"
                }`}
              >
                {status === "saving" && <Loader2 className="size-3.5 animate-spin" />}
                {status === "saved" && <Check className="size-3.5" />}
                {status === "error" && <AlertCircle className="size-3.5" />}
                <span className="truncate max-w-[260px]">{status === "idle" ? "" : statusMsg}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={onSave}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-white hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
