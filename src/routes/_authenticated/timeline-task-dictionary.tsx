import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  GanttChart,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Search,
  Globe,
  FolderLock,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AppShell, BackButton, Panel } from "@/components/AppShell";
import {
  useTimelineTaskTypes,
  createTaskType,
  updateTaskType,
  deleteTaskType,
  restoreTaskTypeDefault,
  useTimelineTaskTypeOverrides,
  TASK_CATEGORIES,
  TASK_COLORS,
  type TaskCategory,
  type TimelineTaskType,
} from "@/lib/timeline-task-types";
import { useCurrentUser } from "@/lib/rbac";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/_authenticated/timeline-task-dictionary")({
  component: () => (
    <AppShell>
      <TimelineTaskDictionaryPage />
    </AppShell>
  ),
});

type Draft = {
  id?: string;
  code: string;
  name: string;
  color: string;
  category: TaskCategory;
  requiredCount: number;
  sortOrder: number;
};

const EMPTY: Draft = {
  code: "",
  name: "",
  color: "bg-info",
  category: "Pre-Production",
  requiredCount: 0,
  sortOrder: 999,
};

function TimelineTaskDictionaryPage() {
  const { t } = useTranslation();
  const { rows, loading, error } = useTimelineTaskTypes();
  const overrides = useTimelineTaskTypeOverrides();
  useCurrentUser();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const canManage = !!activeProjectId;

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<TaskCategory | "all">("all");
  const [editor, setEditor] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (cat === "all" || r.category === cat) &&
        (!needle || r.name.toLowerCase().includes(needle) || r.code.toLowerCase().includes(needle)),
    );
  }, [rows, q, cat]);

  const editable = (_r: TimelineTaskType) => canManage;

  const openNew = () => setEditor({ ...EMPTY, sortOrder: rows.length + 1 });

  const openEdit = (r: TimelineTaskType) =>
    setEditor({
      id: r.id,
      code: r.code,
      name: r.name,
      color: r.color,
      category: r.category,
      requiredCount: r.requiredCount,
      sortOrder: r.sortOrder,
    });

  const save = async () => {
    if (!editor) return;
    if (!editor.code.trim() || !editor.name.trim()) {
      toast.error(
        t("timeline_dictionary.code_name_required", "Abbreviation and name are required"),
      );
      return;
    }
    if (editor.code.trim().length > 5) {
      toast.error(
        t("timeline_dictionary.code_too_long", "Abbreviation must be 5 characters or less"),
      );
      return;
    }
    setSaving(true);
    try {
      if (editor.id) {
        await updateTaskType(editor.id, {
          code: editor.code,
          name: editor.name,
          color: editor.color,
          category: editor.category,
          requiredCount: Number(editor.requiredCount) || 0,
          sortOrder: Number(editor.sortOrder) || 0,
        });
      } else {
        await createTaskType({
          code: editor.code,
          name: editor.name,
          color: editor.color,
          category: editor.category,
          requiredCount: Number(editor.requiredCount) || 0,
          sortOrder: Number(editor.sortOrder) || 0,
        });
      }
      toast.success(t("common.saved", "Saved"));
      setEditor(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const restore = async (overrideId: string, label: string) => {
    if (
      !window.confirm(
        t(
          "timeline_dictionary.restore_confirm",
          `Restore "${label}" to the platform default for this project?`,
        ),
      )
    )
      return;
    try {
      await restoreTaskTypeDefault(overrideId);
      toast.success(t("timeline_dictionary.restored", "Restored to platform default"));
    } catch (e: any) {
      toast.error(e?.message ?? "Restore failed");
    }
  };

  const remove = async (r: TimelineTaskType) => {
    if (!window.confirm(`Remove "${r.name}" from this project's task dictionary?`)) return;
    try {
      await deleteTaskType(r.id);
      toast.success(t("common.deleted", "Deleted"));
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <BackButton />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GanttChart className="size-5 text-brand" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {t("timeline_dictionary.title", "Timeline Task Dictionary")}
            </h1>
            <p className="text-xs text-muted-foreground">
              {t(
                "timeline_dictionary.subtitle",
                "Manage the task cards available in the Production Timeline bank. Changes are saved for the active project only.",
              )}
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90"
          >
            <Plus className="size-4" />
            {t("timeline_dictionary.new_task", "New task card")}
          </button>
        )}
      </div>

      <Panel className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute start-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("common.search", "Search")}
              className="w-full rounded-lg border border-border bg-surface ps-8 pe-3 py-2 text-sm text-foreground"
            />
          </div>
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value as TaskCategory | "all")}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          >
            <option value="all">{t("common.all", "All categories")}</option>
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <Panel className="p-0 overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">{t("common.loading", "Loading…")}</div>
        ) : error ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {t("timeline_dictionary.empty", "No task cards yet.")}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface text-muted-foreground">
              <tr className="text-start">
                <th className="px-3 py-2 text-start font-medium">
                  {t("timeline_dictionary.abbr", "Abbr.")}
                </th>
                <th className="px-3 py-2 text-start font-medium">{t("common.name", "Name")}</th>
                <th className="px-3 py-2 text-start font-medium">
                  {t("timeline_dictionary.category", "Category")}
                </th>
                <th className="px-3 py-2 text-start font-medium">
                  {t("timeline_dictionary.required", "Required")}
                </th>
                <th className="px-3 py-2 text-start font-medium">
                  {t("timeline_dictionary.scope", "Scope")}
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span
                      className={`${r.color} inline-flex size-8 items-center justify-center rounded-full text-[10px] font-extrabold ring-1 ring-border`}
                    >
                      {r.code}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-foreground">{r.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.category}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.requiredCount || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.projectId ? (
                      <span className="inline-flex items-center gap-1">
                        <FolderLock className="size-3.5" />
                        {r.isOverride
                          ? t("timeline_dictionary.project_override", "Project override")
                          : t("timeline_dictionary.project", "This project")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="size-3.5" />
                        {t("timeline_dictionary.default", "Platform default")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {r.isOverride && (
                        <button
                          disabled={!canManage}
                          onClick={() => restore(r.id, r.name)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                          title={t("timeline_dictionary.restore", "Restore to default")}
                        >
                          <RotateCcw className="size-4" />
                        </button>
                      )}
                      <button
                        disabled={!editable(r)}
                        onClick={() => openEdit(r)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                        title="Edit"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        disabled={!editable(r)}
                        onClick={() => remove(r)}
                        className="rounded p-1.5 text-destructive hover:bg-muted disabled:opacity-30"
                        title="Delete"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {overrides.filter((o) => o.hidden).length > 0 && (
        <Panel className="p-3 space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t("timeline_dictionary.hidden_title", "Hidden platform defaults")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t(
                "timeline_dictionary.hidden_subtitle",
                "These default cards are hidden for this project. Restore one to bring it back.",
              )}
            </p>
          </div>
          <ul className="divide-y divide-border">
            {overrides
              .filter((o) => o.hidden)
              .map((o) => (
                <li key={o.override.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <span
                      className={`${o.override.color} inline-flex size-7 items-center justify-center rounded-full text-[10px] font-extrabold ring-1 ring-border`}
                    >
                      {o.override.code}
                    </span>
                    {o.override.name}
                    <span className="text-xs text-muted-foreground">{o.override.category}</span>
                  </span>
                  <button
                    disabled={!canManage}
                    onClick={() => restore(o.override.id, o.override.name)}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <RotateCcw className="size-4" />
                    {t("timeline_dictionary.restore", "Restore to default")}
                  </button>
                </li>
              ))}
          </ul>
        </Panel>
      )}

      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4">
          <Panel className="w-full max-w-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                {editor.id
                  ? t("timeline_dictionary.edit_task", "Edit task card")
                  : t("timeline_dictionary.new_task", "New task card")}
              </h2>
              <button onClick={() => setEditor(null)} className="rounded p-1 hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground">
                {t("timeline_dictionary.abbr", "Abbreviation")}
                <input
                  value={editor.code}
                  maxLength={5}
                  onChange={(e) => setEditor({ ...editor, code: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                {t("timeline_dictionary.required", "Required count")}
                <input
                  type="number"
                  min={0}
                  value={editor.requiredCount}
                  onChange={(e) =>
                    setEditor({ ...editor, requiredCount: Number(e.target.value) || 0 })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="col-span-2 text-xs text-muted-foreground">
                {t("common.name", "Name")}
                <input
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                {t("timeline_dictionary.category", "Category")}
                <select
                  value={editor.category}
                  onChange={(e) =>
                    setEditor({ ...editor, category: e.target.value as TaskCategory })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                >
                  {TASK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                {t("timeline_dictionary.sort", "Sort order")}
                <input
                  type="number"
                  value={editor.sortOrder}
                  onChange={(e) => setEditor({ ...editor, sortOrder: Number(e.target.value) || 0 })}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                />
              </label>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground mb-1">
                  {t("timeline_dictionary.color", "Colour")}
                </div>
                <div className="flex flex-wrap gap-2">
                  {TASK_COLORS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setEditor({ ...editor, color: c.key })}
                      className={`${c.key} size-8 rounded-full ring-2 ${editor.color === c.key ? "ring-brand" : "ring-border"}`}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setEditor(null)}
                className="rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:bg-muted"
              >
                {t("common.cancel", "Cancel")}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Save className="size-4" />
                {t("common.save", "Save")}
              </button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
