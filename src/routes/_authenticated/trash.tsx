import { formatDateTime } from "@/lib/date-format";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { useTrash, type TrashEntityType } from "@/lib/trash-store";
import { useGlobalSearch, matchesQuery } from "@/lib/global-search";
import { Trash2, Undo2, AlertTriangle, Trash, Filter } from "lucide-react";
import { toast } from "sonner";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/trash")({
  component: () => (
    <AppShell>
      <TrashPage />
    </AppShell>
  ),
});

const TYPE_LABELS: Record<TrashEntityType, string> = {
  project: "Project",
  budget_line: "Budget Line",
  invoice: "Invoice",
  vendor: "Vendor",
  person: "Crew / Cast",
  payroll: "Payroll",
  receipt: "Petty Cash Receipt",
  purchase_order: "Purchase Order",
  other: "Other",
};

const TYPE_TONE: Record<TrashEntityType, string> = {
  project: "bg-info/15 text-info border-info/30",
  budget_line: "bg-success/15 text-success border-success/30",
  invoice: "bg-highlight/15 text-highlight border-highlight/30",
  vendor: "bg-warning/15 text-warning border-warning/30",
  person: "bg-destructive/15 text-destructive border-destructive/30",
  payroll: "bg-success/15 text-success border-success/30",
  receipt: "bg-warning/15 text-warning border-warning/30",
  purchase_order: "bg-highlight/15 text-highlight border-highlight/30",
  other: "bg-muted/15 text-foreground border-border",
};

function TrashPage() {
  const { t } = useTranslation();

  const items = useTrash((s) => s.items);
  const restore = useTrash((s) => s.restore);
  const purge = useTrash((s) => s.purge);
  const purgeAll = useTrash((s) => s.purgeAll);
  const q = useGlobalSearch((s) => s.query);
  const [typeFilter, setTypeFilter] = useState<TrashEntityType | "all">("all");
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (typeFilter !== "all" && it.entityType !== typeFilter) return false;
      return matchesQuery(q, it.title, it.subtitle, TYPE_LABELS[it.entityType], it.deletedBy);
    });
  }, [items, typeFilter, q]);

  const typeCounts = useMemo(() => {
    const c: Partial<Record<TrashEntityType, number>> = {};
    for (const it of items) c[it.entityType] = (c[it.entityType] ?? 0) + 1;
    return c;
  }, [items]);

  function fmtDate(iso: string) {
    try {
      return formatDateTime(iso);
    } catch {
      return iso;
    }
  }

  return (
    <>
      <PageTitle
        title={t("trash.trash")}
        action={
          items.length > 0 ? (
            <button
              onClick={() => setConfirmPurgeAll(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20"
            >
              <Trash className="size-3.5" />
              {t("trash.empty_trash")}
            </button>
          ) : undefined
        }
      />

      {items.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Filter className="size-3.5" /> Filter:
          </span>
          <button
            onClick={() => setTypeFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition border ${
              typeFilter === "all"
                ? "bg-brand text-brand-foreground border-transparent"
                : "border-border hover:bg-muted text-muted-foreground"
            }`}
          >
            All · {items.length}
          </button>
          {(Object.keys(TYPE_LABELS) as TrashEntityType[])
            .filter((k) => (typeCounts[k] ?? 0) > 0)
            .map((k) => (
              <button
                key={k}
                onClick={() => setTypeFilter(k)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition border ${
                  typeFilter === k
                    ? "bg-brand text-brand-foreground border-transparent"
                    : "border-border hover:bg-muted text-muted-foreground"
                }`}
              >
                {TYPE_LABELS[k]} · {typeCounts[k]}
              </button>
            ))}
        </div>
      )}

      {items.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="rounded-full bg-surface p-4">
              <Trash2 className="size-8 text-muted-foreground" />
            </div>
            <div className="text-lg font-semibold">{t("trash.trash_is_empty")}</div>
            <p className="max-w-md text-sm text-muted-foreground">
              Deleted projects, budget lines, invoices, and other records will appear here. You can
              restore them or permanently delete them within 30 days.
            </p>
          </div>
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("trash.no_deleted_items_match_the_current_filter")}
          </div>
        </Panel>
      ) : (
        <Panel className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="app-table w-full">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-start">Item</th>
                  <th className="px-4 py-3 text-start">Type</th>
                  <th className="px-4 py-3 text-start">Deleted</th>
                  <th className="px-4 py-3 text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id} className="border-t border-border hover:bg-muted">
                    <td className="px-4 py-3">
                      <div className="font-medium">{it.title}</div>
                      {it.subtitle && (
                        <div className="text-xs text-muted-foreground">{it.subtitle}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${TYPE_TONE[it.entityType]}`}
                      >
                        {TYPE_LABELS[it.entityType]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <div>{fmtDate(it.deletedAt)}</div>
                      {it.deletedBy && <div>by {it.deletedBy}</div>}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            restore(it.id);
                            toast.success(`Restored: ${it.title}`);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/20"
                        >
                          <Undo2 className="size-3.5" /> Restore
                        </button>
                        <button
                          onClick={() => setConfirmPurge(it.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20"
                        >
                          <Trash2 className="size-3.5" />
                          {t("trash.delete_permanently")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {confirmPurge && (
        <ConfirmModal
          title={t("trash.permanently_delete_this_item")}
          body="This action cannot be undone."
          confirmLabel="Delete permanently"
          onConfirm={() => {
            purge(confirmPurge);
            toast.success(t("trash.item_permanently_deleted"));
            setConfirmPurge(null);
          }}
          onClose={() => setConfirmPurge(null)}
        />
      )}

      {confirmPurgeAll && (
        <ConfirmModal
          title={t("trash.empty_the_trash")}
          body={`This will permanently delete all ${items.length} items. This action cannot be undone.`}
          confirmLabel="Empty trash"
          onConfirm={() => {
            purgeAll();
            toast.success(t("trash.trash_emptied"));
            setConfirmPurgeAll(false);
          }}
          onClose={() => setConfirmPurgeAll(false)}
        />
      )}
    </>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <div className="font-semibold">{title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-white hover:bg-destructive"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
