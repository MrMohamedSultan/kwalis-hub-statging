import { createFileRoute } from "@tanstack/react-router";
import { formatAmount } from "@/lib/format-number";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Plus, X as XIcon, RotateCcw, Check } from "lucide-react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useStore, formatUSD } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import { PermissionDeniedBanner } from "@/lib/permission-guard";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CurrencyFxFields, useProjectFx } from "@/components/ap/CurrencyFxFields";
import { useHasColumn } from "@/lib/persons";
import type { FxRateSource } from "@/lib/fx-dated";
import { toBaseAmount } from "@/lib/ap-calc";
import { invoicedOnPo, poIsCommitment, poOpenCommitment } from "@/lib/budget-position";
import { humanizeDbError } from "@/lib/db-errors";
import { parseOpenParam, refMatches, refNoOf } from "@/lib/document-refs";
import { RefFilterInput, RefText } from "@/components/refs/RefListTools";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/purchase-orders")({
  validateSearch: (s: Record<string, unknown>): { open?: string } => {
    const open = parseOpenParam(s.open);
    return open ? { open } : {};
  },
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
  vendor_id?: string | null;
  description: string;
  budget_code: string | null;
  linked_budget_line_id: string | null;
  amount: number;
  currency?: string | null;
  fx_rate?: number | null;
  amount_original?: number | null;
  status: string;
  date: string | null;
  notes: string | null;
  created_at: string;
  created_by?: string | null;
  approved_by?: string | null;
};

/** States the maker may set; Approved / Issued are reached through "Approve" by someone else (B10). */
const EDITABLE_STATUSES = ["Draft", "Open", "Closed", "Cancelled"] as const;
const APPROVED_STATES = ["Approved", "Issued"];
const isApproved = (s: string) => APPROVED_STATES.includes(s);

function PurchaseOrdersPage() {
  const { t } = useTranslation();

  const can = useCan();
  const roles = useAuthRoles();
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const budget = useStore((s) => s.budget);
  const invoices = useStore((s) => s.invoices);
  const projectId = activeProject?.id ?? null;
  const orgId = activeProject?.organizationId ?? null;
  const fx = useProjectFx(projectId);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  // G08: filter by the Kwalis reference number
  const [refQuery, setRefQuery] = useState("");
  const shownPos = useMemo(
    () => (refQuery.trim() ? pos.filter((p) => refMatches(refNoOf(p), refQuery)) : pos),
    [pos, refQuery],
  );
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState<PO | "new" | null>(null);
  const [me, setMe] = useState<string | null>(null);
  // G11: ?open=<id> opens that purchase order once the list is loaded.
  const { open: openId } = Route.useSearch();
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || openedRef.current === openId) return;
    const po = pos.find((p) => p.id === openId);
    if (!po) return;
    openedRef.current = openId;
    setShowForm(po);
  }, [openId, pos]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

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

  // Keep the shared store (invoice PO picker, Remaining Budget card) in step.
  const refreshStore = () => void useStore.getState().reloadScopedData();

  useEffect(() => {
    if (projectId && roles.loaded) void reload();
  }, [projectId, roles.loaded]);

  // Wait for auth/roles and active project to resolve before evaluating permissions
  if (!roles.loaded || !projectId) {
    return <div className="p-6 text-muted-foreground">{t("common.loading")}</div>;
  }
  if (!can("accounting.view"))
    return <PermissionDeniedBanner perm="accounting.view" action="View Purchase Orders" />;
  const canEdit = can("invoices.add");
  const canApprove = can("invoices.approve");

  const invoiceLinks = invoices.map((i) => ({
    price: i.price,
    purchaseOrderId: i.purchaseOrderId,
  }));
  const totals = pos.reduce(
    (acc, p) => {
      const isPending = p.status === "Draft" || p.status === "Open";
      return {
        total: acc.total + (poIsCommitment(p.status) ? Number(p.amount) || 0 : 0),
        open:
          acc.open +
          poOpenCommitment(
            { id: p.id, amount: Number(p.amount) || 0, status: p.status },
            invoiceLinks,
          ),
        pending: acc.pending + (isPending ? 1 : 0),
      };
    },
    { total: 0, open: 0, pending: 0 },
  );

  const setStatus = async (p: PO, status: string, okMsg: string) => {
    const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", p.id);
    if (error) toast.error(humanizeDbError(error));
    else {
      toast.success(okMsg);
      void reload();
      refreshStore();
    }
  };

  return (
    <>
      <PageTitle
        title={t("ap.purchase_orders")}
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
            label: t("ap.po_total_value"),
            value: formatUSD(totals.total),
            tone: "from-info/20 to-info/5 border-info/30",
          },
          {
            label: t("ap.po_open_commitment"),
            value: formatUSD(totals.open),
            tone: "from-success/20 to-success/5 border-success/30",
          },
          {
            label: t("ap.awaiting_approval"),
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
          <span>{t("ap.purchase_orders")}</span>
          <div className="flex items-center gap-3">
            <RefFilterInput value={refQuery} onChange={setRefQuery} />
            <button
              onClick={reload}
              className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
              {t("ap.refresh")}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-start p-3">{t("polish.refs.ref_no")}</th>
                <th className="text-start p-3">{t("ap.po_number")}</th>
                <th className="text-start p-3">{t("ap.vendor")}</th>
                <th className="text-start p-3">{t("ap.description")}</th>
                <th className="text-start p-3">{t("ap.budget_line")}</th>
                <th className="text-end p-3">{t("ap.amount")}</th>
                <th className="text-end p-3">{t("ap.invoiced")}</th>
                <th className="text-start p-3">{t("common.status")}</th>
                <th className="text-end p-3">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-muted-foreground">
                    {t("common.loading")}
                  </td>
                </tr>
              )}
              {!loading && refQuery.trim() && shownPos.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-muted-foreground">
                    {t("polish.refs.no_match")}
                  </td>
                </tr>
              )}
              {!loading &&
                shownPos.map((p) => {
                  const line = budgetLines.find((l) => l.id === p.linked_budget_line_id);
                  const invoiced = invoicedOnPo(p.id, invoiceLinks);
                  const ownPo = !!me && p.created_by === me;
                  return (
                    <tr key={p.id} className="border-t border-border">
                      <td className="p-3">
                        <RefText refNo={refNoOf(p)} />
                      </td>
                      <td className="p-3 font-mono text-xs">{p.po_number}</td>
                      <td className="p-3">{p.vendor_name}</td>
                      <td className="p-3">{p.description}</td>
                      <td className="p-3">
                        {line ? `${line.code} — ${line.desc}` : (p.budget_code ?? "—")}
                      </td>
                      <td className="p-3 text-end tabular-nums">
                        {formatUSD(Number(p.amount) || 0)}
                        {p.currency &&
                          p.currency !== fx.baseCurrency &&
                          p.amount_original != null && (
                            <div className="text-[10px] text-muted-foreground" dir="ltr">
                              {formatAmount(Number(p.amount_original), 2)} {p.currency} ×{" "}
                              {Number(p.fx_rate ?? 1)}
                            </div>
                          )}
                      </td>
                      <td className="p-3 text-end tabular-nums text-muted-foreground">
                        {invoiced > 0 ? formatUSD(invoiced) : "—"}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                            isApproved(p.status)
                              ? "bg-success/20 text-success"
                              : p.status === "Open"
                                ? "bg-warning/20 text-warning"
                                : p.status === "Cancelled"
                                  ? "bg-destructive/20 text-destructive"
                                  : "bg-surface-2 text-muted-foreground"
                          }`}
                        >
                          {t(`ap.po_status.${p.status}`, { defaultValue: p.status })}
                        </span>
                      </td>
                      <td className="p-3 text-end space-x-1 rtl:space-x-reverse whitespace-nowrap">
                        {canEdit && (
                          <button
                            onClick={() => setShowForm(p)}
                            className="text-xs px-2 py-1 rounded-lg bg-surface-2 hover:bg-muted"
                          >
                            {t("common.edit")}
                          </button>
                        )}
                        {canApprove && !isApproved(p.status) && p.status !== "Cancelled" && (
                          <>
                            <button
                              disabled={ownPo}
                              title={ownPo ? t("ap.maker_checker_own_po") : undefined}
                              onClick={() =>
                                setStatus(
                                  p,
                                  "Approved",
                                  t("purchase_orders.po_approved_committed_rolled_up"),
                                )
                              }
                              className="text-xs px-2 py-1 rounded-lg bg-success/15 hover:bg-success/25 text-success inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Check className="size-3" />
                              {t("ap.approve")}
                            </button>
                            <button
                              onClick={() =>
                                setStatus(p, "Cancelled", t("purchase_orders.po_rejected"))
                              }
                              className="text-xs px-2 py-1 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive inline-flex items-center gap-1"
                            >
                              <XIcon className="size-3" />
                              {t("ap.reject")}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {!loading && pos.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground">
                    {t("purchase_orders.no_purchase_orders_yet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <POForm
          initial={showForm === "new" ? null : showForm}
          vendors={vendors}
          budgetLines={budgetLines}
          fx={fx}
          onClose={() => setShowForm(null)}
          onSave={async (v) => {
            const selected = budgetLines.find((l) => l.id === v.linked_budget_line_id);
            const vendor = vendors.find((x) => x.id === v.vendor_id);
            const row = {
              vendor_name: vendor?.name ?? v.vendor_name,
              vendor_id: vendor?.id ?? null,
              description: v.description,
              amount: v.amount,
              currency: v.currency,
              fx_rate: v.fx_rate,
              amount_original: v.amount_original,
              status: v.status,
              budget_code: selected?.code ?? null,
              linked_budget_line_id: v.linked_budget_line_id || null,
              notes: v.notes,
              ...(v.fx_rate_source !== undefined
                ? { fx_rate_source: v.fx_rate_source, fx_rate_date: v.fx_rate_date ?? null }
                : {}),
            };
            if (showForm !== "new" && showForm) {
              const { error } = await supabase
                .from("purchase_orders")
                .update(row as any)
                .eq("id", showForm.id);
              if (error) return toast.error(humanizeDbError(error));
              toast.success(t("purchase_orders.po_updated"));
            } else {
              const { error } = await supabase.from("purchase_orders").insert({
                ...row,
                project_id: projectId,
                organization_id: orgId,
                // Empty → the database assigns <PROJECT CODE>-PO-0001 (B11).
                po_number: "",
                date: new Date().toISOString().slice(0, 10),
              } as any);
              if (error) return toast.error(humanizeDbError(error));
              toast.success(t("purchase_orders.po_created"));
            }
            setShowForm(null);
            void reload();
            refreshStore();
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
  fx,
  onClose,
  onSave,
}: {
  initial: PO | null;
  vendors: Vendor[];
  budgetLines: { id: string; code: string; desc: string }[];
  fx: ReturnType<typeof useProjectFx>;
  onClose: () => void;
  onSave: (v: {
    vendor_id: string;
    vendor_name: string;
    description: string;
    amount: number;
    currency: string;
    fx_rate: number;
    amount_original: number;
    status: string;
    linked_budget_line_id: string;
    notes: string;
    fx_rate_source?: string | null;
    fx_rate_date?: string | null;
  }) => void;
}) {
  const { t } = useTranslation();
  const inputCls = "w-full rounded-lg bg-background border border-border px-3 py-2 text-sm";

  const initialVendorId =
    initial?.vendor_id ?? vendors.find((v) => v.name === initial?.vendor_name)?.id ?? "";
  const [vendorId, setVendorId] = useState(initialVendorId);
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? fx.baseCurrency);
  const [fxRate, setFxRate] = useState<number>(Number(initial?.fx_rate ?? 1) || 1);
  // D03 (db/pending/190): source and date of the rate
  const po190 = useHasColumn("purchase_orders", "fx_rate_source");
  const activeProjectId = useStore((s) => s.activeProjectId);
  const poDate =
    (initial as { date?: string | null } | null)?.date ?? new Date().toISOString().slice(0, 10);
  const [fxSource, setFxSource] = useState<FxRateSource | null>(
    (initial as { fx_rate_source?: FxRateSource | null } | null)?.fx_rate_source ?? null,
  );
  const [fxDate, setFxDate] = useState<string | null>(
    (initial as { fx_rate_date?: string | null } | null)?.fx_rate_date ?? null,
  );
  const [original, setOriginal] = useState<number>(
    initial ? Number(initial.amount_original ?? initial.amount) : 0,
  );
  const [status, setStatus] = useState<string>(initial?.status ?? "Draft");
  const [lineId, setLineId] = useState(initial?.linked_budget_line_id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const approvedNow = !!initial && isApproved(initial.status);
  const isBase = currency === fx.baseCurrency;
  const baseAmount = toBaseAmount(original, isBase ? 1 : fxRate);
  const statusOptions = approvedNow
    ? [initial!.status, ...EDITABLE_STATUSES]
    : [...EDITABLE_STATUSES].filter((s) => (initial ? true : s === "Draft" || s === "Open"));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardList className="size-4" />
            {initial ? t("ap.edit_po") : t("ap.new_po")}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <XIcon className="size-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!vendorId) return toast.error(t("purchase_orders.vendor_required"));
            if (!desc) return toast.error(t("purchase_orders.description_required"));
            if (original <= 0) return toast.error(t("ap.amount_positive"));
            if (!isBase && !(fxRate > 0)) return toast.error(t("ap.fx_rate_required"));
            onSave({
              vendor_id: vendorId,
              vendor_name: vendors.find((v) => v.id === vendorId)?.name ?? "",
              description: desc,
              amount: baseAmount,
              currency,
              fx_rate: isBase ? 1 : fxRate,
              amount_original: original,
              status,
              linked_budget_line_id: lineId,
              notes,
              ...(po190
                ? {
                    fx_rate_source: isBase ? null : (fxSource ?? "manual"),
                    fx_rate_date: isBase ? null : fxDate,
                  }
                : {}),
            });
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("ap.po_number")}>
              <input
                value={initial?.po_number ?? ""}
                placeholder={t("ap.po_number_auto")}
                readOnly
                className={`${inputCls} bg-surface text-muted-foreground font-mono`}
              />
            </Field>
            <Field label={t("common.status")}>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={inputCls}
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {t(`ap.po_status.${s}`, { defaultValue: s })}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {!approvedNow && (
            <p className="text-[11px] text-muted-foreground">{t("ap.po_approval_hint")}</p>
          )}
          <Field label={t("ap.vendor")}>
            <SearchableSelect
              value={vendorId}
              onChange={setVendorId}
              options={vendors.map((v) => ({
                value: v.id,
                label: v.name,
                keywords: v.category ?? undefined,
              }))}
              placeholder={t("ap.select_vendor")}
              searchPlaceholder={t("ap.search_vendor")}
              allowEmpty={false}
            />
            {vendors.length === 0 && (
              <div className="mt-1 text-[11px] text-warning">{t("ap.no_vendors_hint")}</div>
            )}
          </Field>
          <Field label={t("ap.description")}>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("ap.budget_line")}>
            <SearchableSelect
              value={lineId}
              onChange={setLineId}
              options={budgetLines.map((l) => ({ value: l.id, code: l.code, label: l.desc }))}
              placeholder={t("purchase_orders.select_budget_line")}
              searchPlaceholder={t("ap.search_budget_line")}
              emptyValueLabel={t("ap.no_budget_line")}
            />
          </Field>
          <CurrencyFxFields
            fx={fx}
            currency={currency}
            fxRate={fxRate}
            inputCls={inputCls}
            projectId={po190 ? activeProjectId : null}
            date={poDate}
            rateSource={fxSource}
            rateDate={fxDate}
            onChange={(v) => {
              setCurrency(v.currency);
              setFxRate(v.fxRate);
              if (v.fxRateSource !== undefined) {
                setFxSource(v.fxRateSource ?? null);
                setFxDate(v.fxRateDate ?? null);
              }
            }}
          />
          <Field label={t("ap.amount_in", { ccy: currency })}>
            <input
              type="number"
              value={original}
              onChange={(e) => setOriginal(Number(e.target.value))}
              className={inputCls}
              min={0}
              step="0.01"
              dir="ltr"
            />
            {!isBase && (
              <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                {t("ap.equals_base", {
                  amount: formatAmount(baseAmount, 2),
                  base: fx.baseCurrency,
                })}
              </div>
            )}
          </Field>
          <Field label={t("common.notes")}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-surface hover:bg-muted"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-semibold"
            >
              {t("ap.save")}
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
