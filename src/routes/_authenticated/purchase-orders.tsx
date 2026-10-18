import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Plus, X as XIcon, RotateCcw, Check } from "lucide-react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useStore, formatUSD } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import { PermissionDeniedBanner } from "@/lib/permission-guard";
import { SearchableSelect } from "@/components/SearchableSelect";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/purchase-orders")({
  component: () => (
    <AppShell>
      <PurchaseOrdersPage />
    </AppShell>
  ),
});

type Vendor = { id: string; name: string; category: string | null };
type PO = {
  id: string;
  po_number: string;
  vendor_name: string;
  description: string;
  budget_code: string | null;
  linked_budget_line_id: string | null;
  amount: number;
  status: string;
  date: string | null;
  notes: string | null;
  created_at: string;
};

const PO_STATUSES = ["Draft", "Open", "Approved", "Issued", "Closed", "Cancelled"] as const;

function PurchaseOrdersPage() {
  const { t } = useTranslation();

  const can = useCan();
  const roles = useAuthRoles();
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const budget = useStore((s) => s.budget);
  const projectId = activeProject?.id ?? null;
  const orgId = activeProject?.organizationId ?? null;

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState<PO | "new" | null>(null);

  const budgetLines = useMemo(
    () =>
      budget
        .filter((l) => !l.excluded)
        .map((l) => ({ id: l.id, code: l.mainCode, desc: l.description })),
    [budget],
  );

  async function reload() {
    if (!projectId) return;
    setLoading(true);
    const [v, p] = await Promise.all([
      supabase
        .from("vendors")
        .select("id, name, category")
        .eq("project_id", projectId)
        .order("name"),
      supabase
        .from("purchase_orders")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
    ]);
    setVendors((v.data ?? []) as Vendor[]);
    setPos((p.data ?? []) as unknown as PO[]);
    setLoading(false);
  }

  useEffect(() => {
    if (projectId && roles.loaded) void reload();
  }, [projectId, roles.loaded]);

  // Wait for auth/roles and active project to resolve before evaluating permissions
  if (!roles.loaded || !projectId) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (!can("accounting.view"))
    return <PermissionDeniedBanner perm="accounting.view" action="View Purchase Orders" />;
  const canEdit = can("invoices.add");
  const canApprove = can("invoices.approve");

  const totals = pos.reduce(
    (acc, p) => {
      const isCommitted = p.status === "Approved"; // Only Approved POs roll into Budget "Committed"
      const isPending = p.status === "Draft" || p.status === "Open";
      return {
        total: acc.total + (Number(p.amount) || 0),
        committed: acc.committed + (isCommitted ? Number(p.amount) || 0 : 0),
        pending: acc.pending + (isPending ? 1 : 0),
      };
    },
    { total: 0, committed: 0, pending: 0 },
  );

  return (
    <>
      <PageTitle
        title="Purchase Orders"
        action={
          canEdit ? (
            <button
              onClick={() => setShowForm("new")}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:opacity-90"
            >
              <Plus className="size-4" />
              {t("purchase_orders.new_po")}
            </button>
          ) : null
        }
      />

      <div className="grid gap-3 md:grid-cols-3 mb-6">
        {[
          {
            label: "Total POs Value",
            value: formatUSD(totals.total),
            tone: "from-info/20 to-info/5 border-info/30",
          },
          {
            label: "Committed (Approved only)",
            value: formatUSD(totals.committed),
            tone: "from-success/20 to-success/5 border-success/30",
          },
          {
            label: "Awaiting Approval",
            value: String(totals.pending),
            tone: "from-warning/20 to-warning/5 border-warning/30",
          },
        ].map((c) => (
          <div key={c.label} className={`rounded-2xl border bg-gradient-to-br p-4 ${c.tone}`}>
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <ClipboardList className="size-4" />
              {c.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-surface/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-semibold flex items-center justify-between">
          <span>Purchase Orders</span>
          <button
            onClick={reload}
            className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Refresh
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-start p-3">PO #</th>
              <th className="text-start p-3">Vendor</th>
              <th className="text-start p-3">Description</th>
              <th className="text-start p-3">Budget Line</th>
              <th className="text-end p-3">Amount</th>
              <th className="text-start p-3">Status</th>
              <th className="text-end p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              pos.map((p) => {
                const line = budgetLines.find((l) => l.id === p.linked_budget_line_id);
                return (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-3 font-mono text-xs">{p.po_number}</td>
                    <td className="p-3">{p.vendor_name}</td>
                    <td className="p-3">{p.description}</td>
                    <td className="p-3">
                      {line ? `${line.code} — ${line.desc}` : (p.budget_code ?? "—")}
                    </td>
                    <td className="p-3 text-end tabular-nums">
                      {formatUSD(Number(p.amount) || 0)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                          p.status === "Approved" || p.status === "Issued"
                            ? "bg-success/20 text-success"
                            : p.status === "Open"
                              ? "bg-warning/20 text-warning"
                              : p.status === "Cancelled"
                                ? "bg-destructive/20 text-destructive"
                                : "bg-surface-2 text-muted-foreground"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="p-3 text-end space-x-1">
                      {canEdit && (
                        <button
                          onClick={() => setShowForm(p)}
                          className="text-xs px-2 py-1 rounded-lg bg-surface-2 hover:bg-muted"
                        >
                          Edit
                        </button>
                      )}
                      {canApprove && p.status !== "Approved" && p.status !== "Cancelled" && (
                        <>
                          <button
                            onClick={async () => {
                              const { error } = await supabase
                                .from("purchase_orders")
                                .update({ status: "Approved" })
                                .eq("id", p.id);
                              if (error) toast.error(error.message);
                              else {
                                toast.success(t("purchase_orders.po_approved_committed_rolled_up"));
                                void reload();
                              }
                            }}
                            className="text-xs px-2 py-1 rounded-lg bg-success/15 hover:bg-success/25 text-success inline-flex items-center gap-1"
                          >
                            <Check className="size-3" />
                            Approve
                          </button>
                          <button
                            onClick={async () => {
                              const { error } = await supabase
                                .from("purchase_orders")
                                .update({ status: "Cancelled" })
                                .eq("id", p.id);
                              if (error) toast.error(error.message);
                              else {
                                toast.success(t("purchase_orders.po_rejected"));
                                void reload();
                              }
                            }}
                            className="text-xs px-2 py-1 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive inline-flex items-center gap-1"
                          >
                            <XIcon className="size-3" />
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            {!loading && pos.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  {t("purchase_orders.no_purchase_orders_yet")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <POForm
          initial={showForm === "new" ? null : showForm}
          vendors={vendors}
          budgetLines={budgetLines}
          onClose={() => setShowForm(null)}
          onSave={async (v) => {
            const selected = budgetLines.find((l) => l.id === v.linked_budget_line_id);
            if (showForm !== "new" && showForm) {
              const { error } = await supabase
                .from("purchase_orders")
                .update({
                  po_number: v.po_number,
                  vendor_name: v.vendor_name,
                  description: v.description,
                  amount: v.amount,
                  status: v.status,
                  budget_code: selected?.code ?? null,
                  linked_budget_line_id: v.linked_budget_line_id || null,
                  notes: v.notes,
                })
                .eq("id", showForm.id);
              if (error) return toast.error(error.message);
              toast.success(t("purchase_orders.po_updated"));
            } else {
              const { error } = await supabase.from("purchase_orders").insert({
                project_id: projectId,
                organization_id: orgId,
                po_number: v.po_number,
                vendor_name: v.vendor_name,
                description: v.description,
                amount: v.amount,
                status: v.status,
                budget_code: selected?.code ?? null,
                linked_budget_line_id: v.linked_budget_line_id || null,
                notes: v.notes,
                date: new Date().toISOString().slice(0, 10),
              });
              if (error) return toast.error(error.message);
              toast.success(t("purchase_orders.po_created"));
            }
            setShowForm(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

function POForm({
  initial,
  vendors,
  budgetLines,
  onClose,
  onSave,
}: {
  initial: PO | null;
  vendors: Vendor[];
  budgetLines: { id: string; code: string; desc: string }[];
  onClose: () => void;
  onSave: (v: {
    po_number: string;
    vendor_name: string;
    description: string;
    amount: number;
    status: string;
    linked_budget_line_id: string;
    notes: string;
  }) => void;
}) {
  const { t } = useTranslation();

  const [po, setPo] = useState(initial?.po_number ?? `PO-${Date.now().toString().slice(-6)}`);
  const [vendor, setVendor] = useState(initial?.vendor_name ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(initial ? Number(initial.amount) : 0);
  const [status, setStatus] = useState<string>(initial?.status ?? "Draft");
  const [lineId, setLineId] = useState(initial?.linked_budget_line_id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardList className="size-4" />
            {initial ? "Edit Purchase Order" : "New Purchase Order"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <XIcon className="size-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!vendor) return toast.error(t("purchase_orders.vendor_required"));
            if (!desc) return toast.error(t("purchase_orders.description_required"));
            if (amount <= 0) return toast.error("Amount must be > 0");
            onSave({
              po_number: po,
              vendor_name: vendor,
              description: desc,
              amount,
              status,
              linked_budget_line_id: lineId,
              notes,
            });
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="PO Number">
              <input
                value={po}
                onChange={(e) => setPo(e.target.value)}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              >
                {PO_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Vendor">
            <input
              list="vendors-list"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              placeholder={t("purchase_orders.select_or_type_vendor_name")}
            />
            <datalist id="vendors-list">
              {vendors.map((v) => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Description">
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Budget Line">
            <SearchableSelect
              value={lineId}
              onChange={setLineId}
              options={budgetLines.map((l) => ({ value: l.id, code: l.code, label: l.desc }))}
              placeholder={t("purchase_orders.select_budget_line")}
              searchPlaceholder="Search code or description…"
              emptyValueLabel="— No budget line —"
            />
          </Field>

          <Field label="Amount (USD)">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              min={0}
              step="0.01"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-surface hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-semibold"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
