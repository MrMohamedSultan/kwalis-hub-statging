import { createFileRoute } from "@tanstack/react-router";
import { formatAmount } from "@/lib/format-number";
import { assertUploadAllowed } from "@/lib/upload-policy";
import { DateInput } from "@/components/ui/date-input";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { downloadCSV } from "@/lib/export-csv";
import { DocumentPreviewModal } from "@/components/DocumentPreviewModal";
import { TablePagination, paginate, type PageSize } from "@/components/TablePagination";
import {
  PaymentSourceDialog,
  PAYMENT_SOURCE_OPTIONS,
  type PaymentSource,
} from "@/components/PaymentSourceDialog";
import { BudgetCodeSelector } from "@/components/BudgetCodeSelector";
import {
  PawPrint,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
  Search,
  Upload,
  Download,
  Paperclip,
  CheckCircle2,
  Clock,
  CircleDollarSign,
  X,
  Eye,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/picture-assets")({
  component: () => (
    <AppShell>
      <PictureAssetsPage />
    </AppShell>
  ),
});

type Kind = "picture_vehicle" | "animal" | "other";
type PayStatus = "pending" | "partial" | "paid";

type Row = {
  id?: string;
  kind: Kind;
  description: string;
  usage: string;
  owner_name: string;
  owner_contact: string;
  owner_id_number: string;
  owner_nationality: "" | "saudi" | "non_saudi";
  contract_url: string;
  contract_file_path: string;
  contract_file_name: string;
  owner_id_doc_path: string;
  owner_id_doc_name: string;
  vehicle_license_path: string;
  vehicle_license_name: string;
  budget_code: string;
  agreed_cost: number;
  currency: string;
  payment_status: PayStatus;
  preferred_payment_method: string;
  payment_source: string;
  payment_reference: string;
  paid_amount: number | null;
  paid_at: string;
  start_date: string;
  end_date: string;
  notes: string;
};

const emptyRow = (): Row => ({
  kind: "picture_vehicle",
  description: "",
  usage: "",
  owner_name: "",
  owner_contact: "",
  owner_id_number: "",
  owner_nationality: "",
  contract_url: "",
  contract_file_path: "",
  contract_file_name: "",
  owner_id_doc_path: "",
  owner_id_doc_name: "",
  vehicle_license_path: "",
  vehicle_license_name: "",
  budget_code: "",
  agreed_cost: 0,
  currency: "SAR",
  payment_status: "pending",
  preferred_payment_method: "bank_transfer",
  payment_source: "",
  payment_reference: "",
  paid_amount: null,
  paid_at: "",
  start_date: "",
  end_date: "",
  notes: "",
});

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "picture_vehicle", label: "Picture Vehicle" },
  { value: "animal", label: "Animal" },
  { value: "other", label: "Other" },
];

const STATUS_OPTIONS: { value: PayStatus; label: string; className: string }[] = [
  {
    value: "pending",
    label: "Pending",
    className: "bg-warning/15 text-warning dark:text-warning border-warning/40",
  },
  {
    value: "partial",
    label: "Partial",
    className: "bg-info/15 text-info dark:text-info border-info/40",
  },
  {
    value: "paid",
    label: "Paid",
    className: "bg-success/15 text-success dark:text-success border-success/40",
  },
];

const BUCKET = "contracts";

function paymentSourceLabel(v: string): string {
  return PAYMENT_SOURCE_OPTIONS.find((o) => o.value === v)?.label ?? "";
}

function PictureAssetsPage() {
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);

  const [rows, setRows] = useState<Row[]>([]);
  const [budgetCodes, setBudgetCodes] = useState<{ code: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<Kind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<PayStatus | "all">("all");
  const [budgetFilter, setBudgetFilter] = useState<string>("all");

  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [page, setPage] = useState(0);

  const [modalRow, setModalRow] = useState<Row | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [preview, setPreview] = useState<{
    bucket?: string;
    path?: string;
    url?: string;
    name: string;
  } | null>(null);
  const [paymentRow, setPaymentRow] = useState<Row | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);

  useEffect(() => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [assetsRes, budgetRes] = await Promise.all([
        supabase
          .from("picture_assets" as any)
          .select("*")
          .eq("project_id", activeProjectId)
          .order("created_at", { ascending: false }),
        supabase
          .from("v_active_budget_lines" as any)
          .select("main_code,description")
          .eq("project_id", activeProjectId)
          .not("main_code", "is", null),
      ]);
      if (cancelled) return;
      if (assetsRes.error) {
        toast.error(t("picture_assets.failed_to_load_picture_assets"));
        setLoading(false);
        return;
      }
      setRows(
        ((assetsRes.data as any[]) ?? []).map((r: any) => ({
          id: r.id,
          kind: (r.kind ?? "picture_vehicle") as Kind,
          description: r.description ?? "",
          usage: r.usage ?? "",
          owner_name: r.owner_name ?? "",
          owner_contact: r.owner_contact ?? "",
          owner_id_number: r.owner_id_number ?? "",
          owner_nationality: (r.owner_nationality ?? "") as Row["owner_nationality"],
          contract_url: r.contract_url ?? "",
          contract_file_path: r.contract_file_path ?? "",
          contract_file_name: r.contract_file_name ?? "",
          owner_id_doc_path: r.owner_id_doc_path ?? "",
          owner_id_doc_name: r.owner_id_doc_name ?? "",
          vehicle_license_path: r.vehicle_license_path ?? "",
          vehicle_license_name: r.vehicle_license_name ?? "",
          budget_code: r.budget_code ?? "",
          agreed_cost: Number(r.agreed_cost ?? 0),
          currency: r.currency ?? "SAR",
          payment_status: (r.payment_status ?? "pending") as PayStatus,
          preferred_payment_method: r.preferred_payment_method ?? "",
          payment_source: r.payment_source ?? "",
          payment_reference: r.payment_reference ?? "",
          paid_amount: r.paid_amount != null ? Number(r.paid_amount) : null,
          paid_at: r.paid_at ? String(r.paid_at).slice(0, 10) : "",
          start_date: r.start_date ?? "",
          end_date: r.end_date ?? "",
          notes: r.notes ?? "",
        })),
      );
      const seen = new Map<string, string>();
      for (const bl of (budgetRes.data ?? []) as any[]) {
        const code = String(bl.main_code ?? "").trim();
        if (!code || seen.has(code)) continue;
        seen.set(code, bl.description ?? "");
      }
      setBudgetCodes(
        [...seen.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, label]) => ({ code, label })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (statusFilter !== "all" && r.payment_status !== statusFilter) return false;
      if (budgetFilter !== "all") {
        if (budgetFilter === "__none" ? r.budget_code : r.budget_code !== budgetFilter)
          return false;
      }
      if (!q) return true;
      return (
        r.description.toLowerCase().includes(q) ||
        r.usage.toLowerCase().includes(q) ||
        r.owner_name.toLowerCase().includes(q) ||
        r.owner_contact.toLowerCase().includes(q) ||
        r.owner_id_number.toLowerCase().includes(q) ||
        r.budget_code.toLowerCase().includes(q) ||
        r.notes.toLowerCase().includes(q)
      );
    });
  }, [rows, search, kindFilter, statusFilter, budgetFilter]);

  useEffect(() => {
    setPage(0);
  }, [search, kindFilter, statusFilter, budgetFilter]);
  const { pageRows, clampedPage } = paginate(filtered, pageSize, page);

  const totals = useMemo(() => {
    let agreed = 0,
      paidCount = 0,
      pendingCount = 0,
      paidAmt = 0;
    for (const r of rows) {
      const cost = Number(r.agreed_cost) || 0;
      agreed += cost;
      if (r.payment_status === "paid") {
        paidCount++;
        paidAmt += r.paid_amount ?? cost;
      } else if (r.payment_status === "pending") pendingCount++;
    }
    return { agreed, paidCount, pendingCount, paidAmt };
  }, [rows]);

  const openCreate = () => {
    setModalRow(emptyRow());
    setModalMode("create");
  };
  const openEdit = (row: Row) => {
    setModalRow({ ...row });
    setModalMode("edit");
  };
  const closeModal = () => setModalRow(null);

  const persist = async (payload: any, id?: string) => {
    if (!activeProjectId) return { error: new Error("No active project") as any };
    const record = { ...payload, project_id: activeProjectId };
    if (id)
      return await supabase
        .from("picture_assets" as any)
        .update(record)
        .eq("id", id)
        .select("*")
        .single();
    return await supabase
      .from("picture_assets" as any)
      .insert(record)
      .select("*")
      .single();
  };

  const applyResult = (res: any) => {
    if (res.error) {
      toast.error(`Save failed: ${res.error.message}`);
      return false;
    }
    const r: any = res.data;
    const next: Row = {
      id: r.id,
      kind: r.kind,
      description: r.description ?? "",
      usage: r.usage ?? "",
      owner_name: r.owner_name ?? "",
      owner_contact: r.owner_contact ?? "",
      owner_id_number: r.owner_id_number ?? "",
      owner_nationality: (r.owner_nationality ?? "") as Row["owner_nationality"],
      contract_url: r.contract_url ?? "",
      contract_file_path: r.contract_file_path ?? "",
      contract_file_name: r.contract_file_name ?? "",
      owner_id_doc_path: r.owner_id_doc_path ?? "",
      owner_id_doc_name: r.owner_id_doc_name ?? "",
      vehicle_license_path: r.vehicle_license_path ?? "",
      vehicle_license_name: r.vehicle_license_name ?? "",
      budget_code: r.budget_code ?? "",
      agreed_cost: Number(r.agreed_cost ?? 0),
      currency: r.currency ?? "SAR",
      payment_status: r.payment_status ?? "pending",
      preferred_payment_method: r.preferred_payment_method ?? "",
      payment_source: r.payment_source ?? "",
      payment_reference: r.payment_reference ?? "",
      paid_amount: r.paid_amount != null ? Number(r.paid_amount) : null,
      paid_at: r.paid_at ? String(r.paid_at).slice(0, 10) : "",
      start_date: r.start_date ?? "",
      end_date: r.end_date ?? "",
      notes: r.notes ?? "",
    };
    setRows((prev) => {
      const idx = prev.findIndex((x) => x.id === next.id);
      if (idx === -1) return [next, ...prev];
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
    return true;
  };

  const remove = async (row: Row) => {
    if (!row.id) return;
    if (!confirm(`Delete "${row.description}"?`)) return;
    for (const p of [row.contract_file_path, row.owner_id_doc_path, row.vehicle_license_path]) {
      if (p)
        await supabase.storage
          .from(BUCKET)
          .remove([p])
          .catch(() => {});
    }
    const { error } = await supabase
      .from("picture_assets" as any)
      .delete()
      .eq("id", row.id);
    if (error) return toast.error(`Delete failed: ${error.message}`);
    setRows((prev) => prev.filter((x) => x.id !== row.id));
    toast.success(t("picture_assets.deleted"));
  };

  const quickStatus = async (row: Row, status: PayStatus) => {
    if (status === "paid") {
      setPaymentRow(row);
      return;
    }
    if (!row.id) return;
    const patch = {
      payment_status: status,
      payment_source: null,
      payment_reference: null,
      paid_amount: null,
      paid_at: null,
    };
    const { error } = await supabase
      .from("picture_assets" as any)
      .update(patch)
      .eq("id", row.id);
    if (error) return toast.error(`Update failed: ${error.message}`);
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              payment_status: status,
              payment_source: "",
              payment_reference: "",
              paid_amount: null,
              paid_at: "",
            }
          : r,
      ),
    );
    toast.success(`Marked ${status}`);
  };

  const confirmPayment = async (result: {
    source: PaymentSource;
    reference: string;
    amount: number | null;
    paidAt: string;
  }) => {
    if (!paymentRow?.id) return;
    setSavingPayment(true);
    const patch = {
      payment_status: "paid",
      payment_source: result.source,
      payment_reference: result.reference || null,
      paid_amount: result.amount ?? paymentRow.agreed_cost,
      paid_at: result.paidAt,
    };
    const { error } = await supabase
      .from("picture_assets" as any)
      .update(patch)
      .eq("id", paymentRow.id);
    setSavingPayment(false);
    if (error) return toast.error(`Save failed: ${error.message}`);
    setRows((prev) =>
      prev.map((r) =>
        r.id === paymentRow.id
          ? ({ ...r, ...patch, paid_amount: patch.paid_amount, paid_at: patch.paid_at } as Row)
          : r,
      ),
    );
    setPaymentRow(null);
    toast.success(`Payment recorded via ${paymentSourceLabel(result.source)}`);
  };

  const exportCSV = () => {
    const data = filtered.map((r) => ({
      Type: KIND_OPTIONS.find((k) => k.value === r.kind)?.label ?? r.kind,
      Description: r.description,
      "Usage / Character": r.usage,
      "Owner Name": r.owner_name,
      "Owner Contact": r.owner_contact,
      "Owner ID #": r.owner_id_number,
      "Owner Nationality":
        r.owner_nationality === "saudi"
          ? "Saudi"
          : r.owner_nationality === "non_saudi"
            ? "Non-Saudi"
            : "",
      "Budget Code": r.budget_code,
      "Agreed Cost": Number(r.agreed_cost || 0).toFixed(2),
      Currency: r.currency,
      "Payment Status": r.payment_status,
      "Paid Amount": r.paid_amount != null ? r.paid_amount.toFixed(2) : "",
      "Payment Source": paymentSourceLabel(r.payment_source),
      "Payment Reference": r.payment_reference,
      "Paid Date": r.paid_at,
      "Start Date": r.start_date,
      "End Date": r.end_date,
      "Contract URL": r.contract_url,
      "Contract File": r.contract_file_name,
      "Owner ID File": r.owner_id_doc_name,
      "Vehicle License File": r.vehicle_license_name,
      Notes: (r.notes || "").replace(/\r?\n/g, " "),
    }));
    downloadCSV(`picture-assets-${new Date().toISOString().slice(0, 10)}`, data);
  };

  if (!activeProjectId) {
    return (
      <div className="p-6">
        <PageTitle title={t("picture_assets.picture_vehicles_animals")} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageTitle title={t("picture_assets.picture_vehicles_animals")} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Panel>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("picture_assets.registered_assets")}
          </div>
          <div className="text-2xl font-semibold mt-1">{rows.length}</div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("picture_assets.total_agreed_cost")}
          </div>
          <div className="text-2xl font-semibold mt-1">{formatAmount(totals.agreed, 0)} SAR</div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            {t("picture_assets.paid_to_date")}
          </div>
          <div className="text-2xl font-semibold mt-1 text-success">
            {formatAmount(totals.paidAmt, 0)} SAR
          </div>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            Payment Status
          </div>
          <div className="text-sm mt-2 space-y-0.5">
            <div>
              <span className="text-success">●</span> {totals.paidCount} paid
            </div>
            <div>
              <span className="text-warning">●</span> {totals.pendingCount} pending
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <PawPrint className="size-5 text-brand" />
            <div className="text-sm text-muted-foreground">
              {filtered.length} of {rows.length} record{rows.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-border dark:border-border hover:bg-black/5 dark:hover:bg-muted px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              <Download className="size-3" /> Export CSV
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1 rounded-lg bg-brand/90 hover:bg-brand text-white px-3 py-1.5 text-xs font-medium"
            >
              <Plus className="size-3" />
              {t("picture_assets.add_record")}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("picture_assets.search_description_owner_id_budget_code")}
              className="w-full bg-surface-2 border border-border dark:border-border rounded-lg pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
            />
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as any)}
            className="bg-surface-2 border border-border dark:border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
          >
            <option value="all">{t("picture_assets.all_types")}</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-surface-2 border border-border dark:border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
          >
            <option value="all">{t("picture_assets.all_statuses")}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={budgetFilter}
            onChange={(e) => setBudgetFilter(e.target.value)}
            className="bg-surface-2 border border-border dark:border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand max-w-[220px]"
          >
            <option value="all">{t("picture_assets.all_budget_codes")}</option>
            <option value="__none">— Unassigned —</option>
            {budgetCodes.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code}
                {b.label ? ` · ${b.label}` : ""}
              </option>
            ))}
          </select>
          {(search || kindFilter !== "all" || statusFilter !== "all" || budgetFilter !== "all") && (
            <button
              onClick={() => {
                setSearch("");
                setKindFilter("all");
                setStatusFilter("all");
                setBudgetFilter("all");
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              {t("picture_assets.clear_filters")}
            </button>
          )}
        </div>

        {loading ? (
          <TableSkeleton rows={5} cols={9} />
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {rows.length === 0
              ? 'No picture vehicles or animals registered yet. Click "Add Record" to start.'
              : "No records match the current filters."}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="app-table w-full">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border dark:border-border">
                    {[
                      "Type",
                      "Description",
                      "Owner",
                      "Budget Code",
                      "Agreed Cost",
                      "Status",
                      "Payment Source",
                      "Docs",
                      "Quick",
                      "",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-start text-xs uppercase tracking-wider font-medium"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr
                      key={row.id ?? `new-${row.description}`}
                      className="border-b border-border dark:border-border align-middle hover:bg-black/[0.02] dark:hover:bg-card/[0.02]"
                    >
                      <td className="px-3 py-2 text-sm">
                        {KIND_OPTIONS.find((k) => k.value === row.kind)?.label ?? row.kind}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-sm font-medium">
                          {row.description || (
                            <span className="italic text-muted-foreground">Untitled</span>
                          )}
                        </div>
                        {row.usage && (
                          <div className="text-[11px] text-muted-foreground truncate max-w-[240px]">
                            {row.usage}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-sm">{row.owner_name || "—"}</div>
                        {row.owner_contact && (
                          <div className="text-[11px] text-muted-foreground">
                            {row.owner_contact}
                          </div>
                        )}
                        {row.owner_id_number && (
                          <div className="text-[11px] text-muted-foreground">
                            ID: {row.owner_id_number}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {row.budget_code || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-sm text-end whitespace-nowrap tabular-nums">
                        {formatAmount(Number(row.agreed_cost || 0), 2)} {row.currency}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_OPTIONS.find((s) => s.value === row.payment_status)?.className ?? ""}`}
                        >
                          {STATUS_OPTIONS.find((s) => s.value === row.payment_status)?.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.payment_source ? (
                          <div>
                            <div className="font-medium">
                              {paymentSourceLabel(row.payment_source)}
                            </div>
                            {row.payment_reference && (
                              <div className="text-muted-foreground">
                                Ref: {row.payment_reference}
                              </div>
                            )}
                            {row.paid_at && (
                              <div className="text-muted-foreground">{row.paid_at}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {row.contract_file_path && (
                            <button
                              onClick={() =>
                                setPreview({
                                  bucket: BUCKET,
                                  path: row.contract_file_path,
                                  name: row.contract_file_name || "Contract",
                                })
                              }
                              title={t("picture_assets.preview_contract")}
                              className="p-1 rounded-md border border-border hover:bg-muted"
                            >
                              <Paperclip className="size-3" />
                            </button>
                          )}
                          {row.contract_url && (
                            <button
                              onClick={() =>
                                setPreview({ url: row.contract_url, name: "Contract link" })
                              }
                              title={t("picture_assets.preview_contract_url")}
                              className="p-1 rounded-md border border-border hover:bg-muted"
                            >
                              <ExternalLink className="size-3" />
                            </button>
                          )}
                          {row.owner_id_doc_path && (
                            <button
                              onClick={() =>
                                setPreview({
                                  bucket: BUCKET,
                                  path: row.owner_id_doc_path,
                                  name: row.owner_id_doc_name || "Owner ID",
                                })
                              }
                              title={t("picture_assets.preview_owner_id")}
                              className="p-1 rounded-md border border-border hover:bg-muted text-info dark:text-info"
                            >
                              <Eye className="size-3" />
                            </button>
                          )}
                          {row.vehicle_license_path && (
                            <button
                              onClick={() =>
                                setPreview({
                                  bucket: BUCKET,
                                  path: row.vehicle_license_path,
                                  name: row.vehicle_license_name || "License",
                                })
                              }
                              title={t("picture_assets.preview_vehicle_license")}
                              className="p-1 rounded-md border border-border hover:bg-muted text-highlight dark:text-highlight"
                            >
                              <Eye className="size-3" />
                            </button>
                          )}
                          {!row.contract_file_path &&
                            !row.contract_url &&
                            !row.owner_id_doc_path &&
                            !row.vehicle_license_path && (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => quickStatus(row, "pending")}
                            disabled={row.payment_status === "pending"}
                            title={t("picture_assets.mark_pending")}
                            className="p-1 rounded-md border border-warning/40 text-warning dark:text-warning hover:bg-warning/10 disabled:opacity-40"
                          >
                            <Clock className="size-3" />
                          </button>
                          <button
                            onClick={() => quickStatus(row, "partial")}
                            disabled={row.payment_status === "partial"}
                            title={t("picture_assets.mark_partial")}
                            className="p-1 rounded-md border border-info/40 text-info dark:text-info hover:bg-info/10 disabled:opacity-40"
                          >
                            <CircleDollarSign className="size-3" />
                          </button>
                          <button
                            onClick={() => quickStatus(row, "paid")}
                            disabled={row.payment_status === "paid"}
                            title={t("picture_assets.record_payment")}
                            className="p-1 rounded-md border border-success/40 text-success dark:text-success hover:bg-success/10 disabled:opacity-40"
                          >
                            <CheckCircle2 className="size-3" />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-end whitespace-nowrap">
                        <button
                          onClick={() => openEdit(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border hover:bg-muted px-2 py-1 text-xs font-medium me-1"
                        >
                          <Pencil className="size-3" /> Edit
                        </button>
                        <button
                          onClick={() => remove(row)}
                          className="inline-flex items-center gap-1 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive dark:text-destructive px-2 py-1 text-xs font-medium"
                          aria-label={t("picture_assets.delete_record")}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              total={filtered.length}
              pageSize={pageSize}
              page={clampedPage}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}

        <div className="mt-1 text-[11px] text-muted-foreground">
          Costs assigned to a budget code aggregate into the Cost Report as commitments (and as paid
          amounts when marked Paid).
        </div>
      </Panel>

      {modalRow && (
        <AssetModal
          row={modalRow}
          mode={modalMode}
          budgetCodes={budgetCodes}
          projectId={activeProjectId}
          onClose={closeModal}
          onSaved={(saved) => {
            applyResult(saved);
            closeModal();
          }}
          onPreview={(bucket, path, name) => setPreview({ bucket, path, name })}
        />
      )}

      <DocumentPreviewModal
        open={!!preview}
        onClose={() => setPreview(null)}
        bucket={preview?.bucket}
        path={preview?.path}
        url={preview?.url}
        fileName={preview?.name}
      />

      <PaymentSourceDialog
        open={!!paymentRow}
        onClose={() => setPaymentRow(null)}
        onConfirm={confirmPayment}
        submitting={savingPayment}
        title={paymentRow ? `Record Payment — ${paymentRow.description}` : "Record Payment"}
        defaultAmount={paymentRow?.agreed_cost ?? null}
        currency={paymentRow?.currency ?? "SAR"}
      />
    </div>
  );
}

/* ------------------------- Add / Edit Asset Modal ------------------------- */

function AssetModal({
  row: initial,
  mode,
  projectId,
  budgetCodes,
  onClose,
  onSaved,
  onPreview,
}: {
  row: Row;
  mode: "create" | "edit";
  projectId: string;
  budgetCodes: { code: string; label: string }[];
  onClose: () => void;
  onSaved: (res: any) => void;
  onPreview: (bucket: string, path: string, name: string) => void;
}) {
  const { t } = useTranslation();

  const [row, setRow] = useState<Row>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<null | "contract" | "id" | "license">(null);
  const contractInput = useRef<HTMLInputElement>(null);
  const idInput = useRef<HTMLInputElement>(null);
  const licenseInput = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Row>) => setRow((r) => ({ ...r, ...patch }));

  const uploadTo = async (slot: "contract" | "id" | "license", file: File) => {
    setUploading(slot);
    assertUploadAllowed(file);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${projectId}/picture-assets/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    setUploading(null);
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      return;
    }
    if (slot === "contract") set({ contract_file_path: path, contract_file_name: file.name });
    else if (slot === "id") set({ owner_id_doc_path: path, owner_id_doc_name: file.name });
    else set({ vehicle_license_path: path, vehicle_license_name: file.name });
    toast.success(t("picture_assets.file_uploaded"));
  };

  const detach = async (slot: "contract" | "id" | "license") => {
    const path =
      slot === "contract"
        ? row.contract_file_path
        : slot === "id"
          ? row.owner_id_doc_path
          : row.vehicle_license_path;
    if (!path) return;
    if (!confirm(t("picture_assets.detach_this_file"))) return;
    await supabase.storage
      .from(BUCKET)
      .remove([path])
      .catch(() => {});
    if (slot === "contract") set({ contract_file_path: "", contract_file_name: "" });
    else if (slot === "id") set({ owner_id_doc_path: "", owner_id_doc_name: "" });
    else set({ vehicle_license_path: "", vehicle_license_name: "" });
  };

  const save = async () => {
    if (!row.description.trim()) {
      toast.error(t("picture_assets.description_is_required"));
      return;
    }
    if (!row.owner_name.trim()) {
      toast.error(t("picture_assets.owner_name_is_required"));
      return;
    }
    if (!row.owner_id_number.trim()) {
      toast.error(t("picture_assets.owner_id_number_is_required"));
      return;
    }
    if (!row.owner_nationality) {
      toast.error(t("picture_assets.owner_nationality_is_required"));
      return;
    }
    setSaving(true);
    const payload = {
      kind: row.kind,
      description: row.description.trim(),
      usage: row.usage.trim() || null,
      owner_name: row.owner_name.trim() || null,
      owner_contact: row.owner_contact.trim() || null,
      owner_id_number: row.owner_id_number.trim() || null,
      owner_nationality: row.owner_nationality || null,
      contract_url: row.contract_url.trim() || null,
      contract_file_path: row.contract_file_path || null,
      contract_file_name: row.contract_file_name || null,
      owner_id_doc_path: row.owner_id_doc_path || null,
      owner_id_doc_name: row.owner_id_doc_name || null,
      vehicle_license_path: row.vehicle_license_path || null,
      vehicle_license_name: row.vehicle_license_name || null,
      budget_code: row.budget_code.trim() || null,
      agreed_cost: Number(row.agreed_cost) || 0,
      currency: row.currency || "SAR",
      payment_status: row.payment_status,
      start_date: row.start_date || null,
      end_date: row.end_date || null,
      notes: row.notes || null,
    };
    const res =
      mode === "edit" && row.id
        ? await supabase
            .from("picture_assets" as any)
            .update({ ...payload, project_id: projectId })
            .eq("id", row.id)
            .select("*")
            .single()
        : await supabase
            .from("picture_assets" as any)
            .insert({ ...payload, project_id: projectId })
            .select("*")
            .single();
    setSaving(false);
    onSaved(res);
  };

  const FileSlot = ({
    label,
    slot,
    required,
  }: {
    label: string;
    slot: "contract" | "id" | "license";
    required?: boolean;
  }) => {
    const path =
      slot === "contract"
        ? row.contract_file_path
        : slot === "id"
          ? row.owner_id_doc_path
          : row.vehicle_license_path;
    const name =
      slot === "contract"
        ? row.contract_file_name
        : slot === "id"
          ? row.owner_id_doc_name
          : row.vehicle_license_name;
    const ref = slot === "contract" ? contractInput : slot === "id" ? idInput : licenseInput;
    return (
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
          {required && " *"}
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            ref={ref}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadTo(slot, f);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => ref.current?.click()}
            disabled={uploading === slot}
            className="inline-flex items-center gap-1 rounded-md border border-border hover:bg-muted px-2 py-1 text-xs disabled:opacity-40"
          >
            {uploading === slot ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
            {path ? "Replace" : "Upload"}
          </button>
          {path && (
            <>
              <button
                type="button"
                onClick={() => onPreview(BUCKET, path, name || label)}
                className="inline-flex items-center gap-1 rounded-md border border-brand/40 text-brand hover:bg-brand/10 px-2 py-1 text-xs"
              >
                <Eye className="size-3" />{" "}
                <span className="max-w-[140px] truncate">{name || "file"}</span>
              </button>
              <button
                type="button"
                onClick={() => detach(slot)}
                className="text-destructive hover:text-destructive"
                aria-label={t("picture_assets.detach")}
              >
                <Trash2 className="size-3" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[55] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card text-card-foreground border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold">
            {mode === "edit" ? "Edit Asset" : "Add Picture Vehicle / Animal"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Type *
              </label>
              <select
                value={row.kind}
                onChange={(e) => set({ kind: e.target.value as Kind })}
                className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Description *
              </label>
              <input
                type="text"
                value={row.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder={t("picture_assets.eg_1970_ford_mustang")}
                className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("picture_assets.usage_character")}
              </label>
              <input
                type="text"
                value={row.usage}
                onChange={(e) => set({ usage: e.target.value })}
                placeholder={t("picture_assets.eg_ahmeds_personal_car")}
                className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
              />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
              Owner
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Owner Name *
                </label>
                <input
                  type="text"
                  value={row.owner_name}
                  onChange={(e) => set({ owner_name: e.target.value })}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("picture_assets.owner_contact")}
                </label>
                <input
                  type="text"
                  value={row.owner_contact}
                  onChange={(e) => set({ owner_contact: e.target.value })}
                  placeholder={t("picture_assets.phone_email")}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Owner ID Number *
                </label>
                <input
                  type="text"
                  value={row.owner_id_number}
                  onChange={(e) => set({ owner_id_number: e.target.value })}
                  placeholder={t("picture_assets.national_id_iqama")}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Owner Nationality *
                </label>
                <select
                  value={row.owner_nationality}
                  onChange={(e) =>
                    set({ owner_nationality: e.target.value as Row["owner_nationality"] })
                  }
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                >
                  <option value="">— Select —</option>
                  <option value="saudi">Saudi</option>
                  <option value="non_saudi">Non-Saudi</option>
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("picture_assets.used_for_saudi_film_commission_rebate_eligibility_reporting")}
                </p>
              </div>
              <FileSlot label="Owner ID Document" slot="id" />
              <FileSlot label="Vehicle License Document" slot="license" />
              <FileSlot label="Signed Contract / Release" slot="contract" />
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("picture_assets.contract_url_optional")}
                </label>
                <input
                  type="url"
                  value={row.contract_url}
                  onChange={(e) => set({ contract_url: e.target.value })}
                  placeholder="https://…"
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
              Financial
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Budget Code
                </label>
                <div className="mt-1">
                  <BudgetCodeSelector
                    value={row.budget_code}
                    onChange={(code) => set({ budget_code: code })}
                    allowEmpty
                    emptyLabel="— Unassigned —"
                    restrictToCodes={
                      budgetCodes.length ? budgetCodes.map((b) => b.code) : undefined
                    }
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Agreed Cost ({row.currency})
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={row.agreed_cost}
                  onChange={(e) => set({ agreed_cost: Number(e.target.value) || 0 })}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm text-end outline-none focus:ring-2 ring-brand"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </label>
                <select
                  value={row.payment_status}
                  onChange={(e) => set({ payment_status: e.target.value as PayStatus })}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {row.payment_status === "paid" && (
                  <p className="mt-1 text-[11px] text-warning dark:text-warning">
                    Use the "Record Payment" quick action in the table to capture payment source.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </label>
                <select
                  value={row.payment_status}
                  onChange={(e) => set({ payment_status: e.target.value as PayStatus })}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {row.payment_status === "paid" && (
                  <p className="mt-1 text-[11px] text-warning dark:text-warning">
                    Use the "Record Payment" quick action in the table to capture payment source.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("picture_assets.start_date")}
                </label>
                <DateInput
                  value={row.start_date}
                  onChange={(v) => set({ start_date: v })}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("picture_assets.end_date")}
                </label>
                <DateInput
                  value={row.end_date}
                  onChange={(v) => set({ end_date: v })}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Notes
                </label>
                <textarea
                  value={row.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  rows={2}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-brand hover:bg-brand/90 text-white px-4 py-1.5 text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1"
          >
            {saving && <Loader2 className="size-3 animate-spin" />}{" "}
            {mode === "edit" ? "Save Changes" : "Create Record"}
          </button>
        </div>
      </div>
    </div>
  );
}
