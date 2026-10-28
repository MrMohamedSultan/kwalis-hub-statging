import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  BookOpen,
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, BackButton } from "@/components/AppShell";
import {
  useGlAccounts,
  GL_CATEGORIES,
  createGlAccount,
  updateGlAccount,
  deleteGlAccount,
  type GlAccount,
  type GlAccountCategory,
} from "@/lib/gl-accounts";
import { useCan } from "@/lib/rbac";
import { PermissionDeniedBanner, GuardedButton } from "@/lib/permission-guard";
import { downloadCSV } from "@/lib/export-csv";
import { exportPdfReport } from "@/lib/export-pdf";
import { useSearchHotkey } from "@/hooks/use-search-hotkey";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/gl-accounts")({
  component: () => (
    <AppShell>
      <GlAccountsPage />
    </AppShell>
  ),
});

type Draft = {
  id?: string;
  code: string;
  name: string;
  category: GlAccountCategory;
  description: string;
};

const EMPTY_DRAFT: Draft = { code: "", name: "", category: "ATL", description: "" };

function GlAccountsPage() {
  const { t } = useTranslation();

  const { rows, loading, error } = useGlAccounts();
  const can = useCan();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<GlAccountCategory | "all">("all");
  const [editor, setEditor] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const searchRef = useSearchHotkey<HTMLInputElement>();

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (cat !== "all" && r.category !== cat) return false;
      if (!s) return true;
      return (
        r.code.toLowerCase().includes(s) ||
        r.name.toLowerCase().includes(s) ||
        (r.description ?? "").toLowerCase().includes(s)
      );
    });
  }, [rows, q, cat]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage],
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.category] = (m[r.category] ?? 0) + 1;
    return m;
  }, [rows]);

  if (!can("gl.view")) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <BackButton />
        <PermissionDeniedBanner perm="gl.view" action="view the GL Chart of Accounts" />
      </div>
    );
  }

  const exportCsv = () => {
    downloadCSV(
      "gl-accounts",
      filtered.map((r) => ({
        Code: r.code,
        Name: r.name,
        Category: r.category,
        Description: r.description ?? "",
        Active: r.isActive ? "Yes" : "No",
      })),
      ["Code", "Name", "Category", "Description", "Active"],
    );
    toast.success(`Exported ${filtered.length} GL accounts to Excel.`);
  };

  const exportPdf = () => {
    const rows = filtered.map((r) => [
      r.code,
      r.name,
      r.category,
      r.description ?? "",
      r.isActive ? "Yes" : "No",
    ]);
    exportPdfReport(
      "gl-accounts.pdf",
      [
        {
          title: "GL Chart of Accounts",
          subtitle: `${filtered.length} accounts${cat === "all" ? "" : ` · ${cat}`}`,
          headers: ["Code", "Name", "Category", "Description", "Active"],
          rows,
        },
      ],
      { documentTitle: "GL Chart of Accounts" },
    );
    toast.success(`Exported ${filtered.length} GL accounts to PDF.`);
  };

  const startNew = () => setEditor({ ...EMPTY_DRAFT });
  const startEdit = (r: GlAccount) =>
    setEditor({
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      description: r.description ?? "",
    });

  const save = async () => {
    if (!editor) return;
    if (!editor.code.trim() || !editor.name.trim()) {
      toast.error(t("gl_accounts.code_and_name_are_required"));
      return;
    }
    setSaving(true);
    try {
      if (editor.id) {
        await updateGlAccount(editor.id, {
          code: editor.code.trim(),
          name: editor.name.trim(),
          category: editor.category,
          description: editor.description.trim() || null,
        });
        toast.success(t("gl_accounts.gl_account_updated"));
      } else {
        await createGlAccount({
          code: editor.code.trim(),
          name: editor.name.trim(),
          category: editor.category,
          description: editor.description.trim() || null,
        });
        toast.success(t("gl_accounts.gl_account_created"));
      }
      setEditor(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save GL account.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: GlAccount) => {
    if (
      !confirm(
        `Delete GL account "${r.code} · ${r.name}"?\nTransactions referencing it will be un-categorized.`,
      )
    )
      return;
    try {
      await deleteGlAccount(r.id);
      toast.success(t("gl_accounts.gl_account_deleted"));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete GL account.");
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <BackButton />
      <div className="flex items-center gap-3 justify-between flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-brand/15 text-brand grid place-items-center">
            <BookOpen className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("gl_accounts.gl_accounts")}</h1>
            <p className="text-sm text-muted-foreground">
              Film Production Chart of Accounts. Used to categorize transactions for GL and
              Compliance reports.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-success/20 text-success border border-success/30 hover:bg-success/30 text-sm font-semibold"
          >
            <FileSpreadsheet className="size-4" /> Excel
          </button>
          <button
            onClick={exportPdf}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/20 text-destructive border border-destructive/30 hover:bg-destructive/30 text-sm font-semibold"
          >
            <FileText className="size-4" /> PDF
          </button>
          <GuardedButton
            perm="gl.manage"
            actionLabel="manage the Chart of Accounts"
            onClick={startNew}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-brand text-brand-foreground text-sm font-semibold"
          >
            <Plus className="size-4" />
            {t("gl_accounts.new_account")}
          </GuardedButton>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {GL_CATEGORIES.map((c) => (
          <div key={c.key} className="rounded-xl border border-border bg-surface-2 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {c.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{counts[c.key] ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{c.hint}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder={t("gl_accounts.search_code_name_description_press")}
            className="w-full bg-surface-2 border border-border rounded-xl pl-9 pr-12 py-2 text-sm"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-muted-foreground">
            /
          </kbd>
        </div>
        <select
          value={cat}
          onChange={(e) => {
            setCat(e.target.value as any);
            setPage(1);
          }}
          className="bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm"
        >
          <option value="all">All categories</option>
          {GL_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-border bg-surface-2 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-start px-3 py-2 font-medium">Code</th>
              <th className="text-start px-3 py-2 font-medium">Name</th>
              <th className="text-start px-3 py-2 font-medium">Category</th>
              <th className="text-start px-3 py-2 font-medium">Description</th>
              <th className="text-end px-3 py-2 font-medium w-[1%]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {error && !loading && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-destructive">
                  {error}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              pageRows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex text-[11px] px-2 py-0.5 rounded-full bg-surface border border-border">
                      {r.category}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.description ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-end">
                    <GuardedButton
                      perm="gl.manage"
                      actionLabel="edit GL accounts"
                      onClick={() => startEdit(r)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface hover:bg-muted text-xs me-1"
                    >
                      <Pencil className="size-3" /> Edit
                    </GuardedButton>
                    <GuardedButton
                      perm="gl.manage"
                      actionLabel="delete GL accounts"
                      onClick={() => remove(r)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-destructive/15 text-destructive hover:bg-destructive/25 text-xs"
                    >
                      <Trash2 className="size-3" /> Delete
                    </GuardedButton>
                  </td>
                </tr>
              ))}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  {t("gl_accounts.no_accounts_match")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > pageSize && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            Showing {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="size-3" /> Prev
            </button>
            <span className="px-2">
              Page {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface hover:bg-muted disabled:opacity-40"
            >
              Next <ChevronRight className="size-3" />
            </button>
          </div>
        </div>
      )}

      {editor && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={() => !saving && setEditor(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editor.id ? "Edit GL Account" : "New GL Account"}
              </h2>
              <button onClick={() => setEditor(null)} className="p-1 rounded-lg hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground col-span-1">
                Code
                <input
                  value={editor.code}
                  onChange={(e) => setEditor({ ...editor, code: e.target.value })}
                  placeholder="GL-1000"
                  className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm text-foreground font-mono"
                />
              </label>
              <label className="text-xs text-muted-foreground col-span-1">
                Category
                <select
                  value={editor.category}
                  onChange={(e) =>
                    setEditor({ ...editor, category: e.target.value as GlAccountCategory })
                  }
                  className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm text-foreground"
                >
                  {GL_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.key}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground col-span-2">
                Name
                <input
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground col-span-2">
                Description
                <textarea
                  value={editor.description}
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                  rows={3}
                  className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm text-foreground"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEditor(null)}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg bg-surface hover:bg-muted text-sm"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg bg-brand text-brand-foreground text-sm font-semibold inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Save className="size-3.5" /> {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
