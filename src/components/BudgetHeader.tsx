import { formatDateTime } from "@/lib/date-format";
import { useState, KeyboardEvent } from "react";
import { DateInput } from "@/components/ui/date-input";
import {
  CalendarClock,
  GitBranch,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
  Settings2,
} from "lucide-react";
import {
  useBudgetHeader,
  bumpVersion,
  defaultHeader,
  type BudgetHeaderField,
} from "@/lib/budget-header";
import { useCan } from "@/lib/rbac";

import { toast } from "sonner";

import { useTranslation } from "react-i18next";
export function BudgetHeader({
  projectName,
  projectCode,
}: {
  projectName: string;
  projectCode?: string | null;
}) {
  const { t } = useTranslation();

  const [meta] = useBudgetHeader();
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const canEdit = useCan()("budget.edit");

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border bg-muted/40">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("budgetheader.production_budget")}
          </div>
          <div className="text-xl font-bold text-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {projectCode && (
              <span className="inline-flex items-center rounded-md border border-brand/40 bg-brand/15 text-brand px-2 py-0.5 text-sm font-bold tracking-wider">
                {projectCode}
              </span>
            )}
            <span>{projectName || "Project"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-brand/15 text-brand border border-brand/30 font-semibold">
            <GitBranch className="size-3.5" /> {meta.version || "—"}
          </div>
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-muted border border-border text-foreground">
            <CalendarClock className="size-3.5" /> {meta.versionDate || "—"}
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted text-foreground"
            title={t("budgetheader.version_history")}
          >
            <History className="size-3.5" /> History
            <span className="ml-1 px-1.5 py-0 rounded bg-muted text-muted-foreground text-[10px] font-semibold">
              {meta.history.length}
            </span>
          </button>
          {canEdit && (
            <button
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted text-foreground"
            >
              <Settings2 className="size-3.5" /> Configure
            </button>
          )}
        </div>
      </div>

      {meta.fields.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px bg-border">
          {meta.fields.map((f) => (
            <div key={f.id} className="bg-card px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {f.label || "—"}
              </div>
              {f.values.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {f.values.map((v, i) => (
                    <span
                      key={`${f.id}-${i}`}
                      className="inline-flex items-center rounded-md bg-brand/15 text-brand border border-brand/30 px-1.5 py-0.5 text-xs font-medium max-w-[220px] truncate"
                      title={v}
                    >
                      {v}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground/70 mt-1">—</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="px-5 py-4 text-sm text-muted-foreground">
          {t("budgetheader.no_header_fields_configured_yet")}
        </div>
      )}

      {showSettings && <BudgetHeaderSettingsModal onClose={() => setShowSettings(false)} />}
      {showHistory && <BudgetHeaderHistoryModal onClose={() => setShowHistory(false)} />}
    </div>
  );
}

function BudgetHeaderHistoryModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  const [meta] = useBudgetHeader();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-card border border-border shadow-xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="text-sm font-semibold text-foreground flex items-center gap-2">
            <History className="size-4" />
            {t("budgetheader.budget_version_history")}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">
          {meta.history.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              {t("budgetheader.no_version_history_yet_save_the_header_once")}
            </div>
          ) : (
            <ol className="space-y-2">
              {meta.history.map((h, i) => (
                <li
                  key={`${h.savedAt}-${i}`}
                  className="rounded-lg border border-border bg-surface-2/50 px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <GitBranch className="size-3.5 text-brand" /> {h.version}
                      {i === 0 && (
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/30">
                          Current
                        </span>
                      )}
                    </div>
                    {h.note && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">{h.note}</div>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div>{h.versionDate}</div>
                    <div className="opacity-70">{formatDateTime(h.savedAt)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tag-based input for a single field. Users type a value and press Enter or
 *  comma to commit a chip; backspace on an empty input removes the last chip. */
function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();

  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const parts = raw
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(values.map((v) => v.toLowerCase()));
    const merged = [...values];
    for (const p of parts) {
      if (!seen.has(p.toLowerCase())) {
        merged.push(p);
        seen.add(p.toLowerCase());
      }
    }
    onChange(merged);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="flex-[1.5] min-w-0 bg-surface-2 border border-border rounded-lg px-2 py-1.5 focus-within:ring-2 ring-brand">
      <div className="flex flex-wrap gap-1 items-center">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 rounded-md bg-brand/15 text-brand border border-brand/30 px-1.5 py-0.5 text-xs font-medium"
          >
            <span className="max-w-[160px] truncate" title={v}>
              {v}
            </span>
            <button
              type="button"
              onClick={() => onChange(values.filter((_, ix) => ix !== i))}
              className="text-brand/70 hover:text-brand"
              aria-label={`Remove ${v}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft && commit(draft)}
          placeholder={values.length === 0 ? (placeholder ?? "Type a value and press Enter…") : ""}
          className="flex-1 min-w-[8ch] bg-transparent text-sm text-foreground outline-none px-1 py-0.5"
        />
      </div>
    </div>
  );
}

function BudgetHeaderSettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  const [meta, update, setFields, appendHistory, reset] = useBudgetHeader();
  const userEmail: string | null = null;
  const [version, setVersion] = useState(meta.version);
  const [versionDate, setVersionDate] = useState(meta.versionDate);
  const [fields, setLocalFields] = useState<BudgetHeaderField[]>(meta.fields);
  const [autoBump, setAutoBump] = useState(true);
  const [note, setNote] = useState("");

  const addField = () => {
    setLocalFields((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: "New Field", values: [] },
    ]);
  };
  const updateField = (id: string, patch: Partial<BudgetHeaderField>) => {
    setLocalFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };
  const removeField = (id: string) => setLocalFields((prev) => prev.filter((f) => f.id !== id));

  const save = () => {
    if (!version.trim()) {
      toast.error(t("budgetheader.budget_version_is_required"));
      return;
    }
    if (!versionDate) {
      toast.error(t("budgetheader.version_date_is_required"));
      return;
    }
    const cleaned: BudgetHeaderField[] = fields
      .map((f) => ({
        ...f,
        label: f.label.trim(),
        values: (f.values ?? []).map((v) => v.trim()).filter(Boolean),
      }))
      .filter((f) => f.label.length > 0);
    const nextVersion =
      autoBump && version.trim() === meta.version ? bumpVersion(version.trim()) : version.trim();
    const nextDate =
      autoBump && version.trim() === meta.version
        ? new Date().toISOString().slice(0, 10)
        : versionDate;
    update({ version: nextVersion, versionDate: nextDate });
    setFields(cleaned);
    appendHistory({
      version: nextVersion,
      versionDate: nextDate,
      savedBy: userEmail,
      note: note.trim() || undefined,
    });
    toast.success(`Budget header saved as ${nextVersion}.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-card border border-border shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <div className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Settings2 className="size-4" />
              {t("budgetheader.budget_header_settings")}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Configure the metadata shown at the top of the Top Sheet. Each field now supports
              multiple values (chips).
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Budget Version *
              </span>
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="v4.1"
                className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 ring-brand"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Version Date *
              </span>
              <DateInput
                value={versionDate}
                onChange={(v) => setVersionDate(v)}
                className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 ring-brand"
              />
            </label>
          </div>

          <div className="rounded-lg border border-border bg-surface-2/40 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-foreground/90 cursor-pointer">
              <input
                type="checkbox"
                checked={autoBump}
                onChange={(e) => setAutoBump(e.target.checked)}
                className="accent-brand"
              />
              {t("budgetheader.autoincrement_version_on_save")}
              <span className="text-xs text-muted-foreground">
                (→ {bumpVersion(version || "v1.0")})
              </span>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                {t("budgetheader.change_note")}
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("budgetheader.what_changed_in_this_version")}
                className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-2 ring-brand"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                {t("budgetheader.dynamic_fields_multivalue")}
              </div>
              <button
                onClick={addField}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted text-foreground/90"
              >
                <Plus className="size-3.5" />
                {t("budgetheader.add_field")}
              </button>
            </div>

            {fields.length === 0 ? (
              <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">
                {t("budgetheader.no_fields_yet_add_the_ones_you_want")}
              </div>
            ) : (
              <div className="space-y-2">
                {fields.map((f) => (
                  <div key={f.id} className="flex items-start gap-2">
                    <Pencil className="size-3.5 text-muted-foreground shrink-0 mt-3" />
                    <input
                      value={f.label}
                      onChange={(e) => updateField(f.id, { label: e.target.value })}
                      placeholder={t("budgetheader.label_eg_line_producer")}
                      className="flex-1 min-w-0 mt-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-2 ring-brand"
                    />
                    <TagInput
                      values={f.values}
                      onChange={(values) => updateField(f.id, { values })}
                      placeholder={t("budgetheader.type_a_value_press_enter")}
                    />
                    <button
                      onClick={() => removeField(f.id)}
                      className="p-2 mt-1 rounded-lg text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/30"
                      title={t("budgetheader.delete_field")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 text-[11px] text-muted-foreground">
              {t("budgetheader.tip_paste_a_commaseparated_list_to_add_multiple")}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border bg-surface-2/40">
          <button
            onClick={() => {
              if (
                !window.confirm(
                  t("budgetheader.reset_budget_header_fields_and_version_to_defaults"),
                )
              )
                return;
              reset({ keepHistory: true });
              const fresh = defaultHeader();
              setVersion(fresh.version);
              setVersionDate(fresh.versionDate);
              setLocalFields(fresh.fields);
              setNote("");
              toast.success(t("budgetheader.header_reset_to_defaults"));
            }}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg border border-border text-foreground/80 hover:bg-muted"
            title={t("budgetheader.reset_all_header_fields_to_defaults")}
          >
            <RotateCcw className="size-3.5" />
            {t("budgetheader.reset_to_defaults")}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand text-brand-foreground font-semibold"
            >
              <Save className="size-3.5" />
              {t("budgetheader.save_header")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
