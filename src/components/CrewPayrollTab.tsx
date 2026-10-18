import { useMemo, useRef, useState, useCallback } from "react";
import { loadXlsx } from "@/lib/lazy-export-libs";
import { Modal } from "@/components/Modal";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useStore, formatUSD, type PayrollRow, type PaymentLedgerEntry } from "@/lib/store";
import { toast } from "sonner";
import {
  Users,
  Plus,
  DollarSign,
  ChevronRight,
  Paperclip,
  Save,
  X,
  TrendingUp,
  Trash2,
  CheckSquare,
  Square,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  Loader2,
  Search,
  Lock,
  Unlock,
  Pencil,
  ExternalLink,
  FileSearch,
} from "lucide-react";
import { useExportAction } from "@/hooks/use-export-action";
import { useCan } from "@/lib/rbac";
import { HEADER_ACCOUNTS } from "@/lib/data";
import { exportPdfReport } from "@/lib/export-pdf";
import { recordAudit } from "@/lib/audit-log";
import { useProjectLock } from "@/lib/project-lock";
import { useNavigate } from "@tanstack/react-router";
import { SearchableSelect } from "@/components/SearchableSelect";

import { useTranslation } from "react-i18next";
type StructureMode = "weekly" | "milestone";
type PayrollKindFilter = "crew" | "cast" | "vendor" | "both";

/**
 * Payroll tab — filterable by kind. Renders freelancer payroll rows for the
 * selected kind(s), lets an authorized user record individual payments and
 * configure the payment structure. Payments write through the store's
 * `setPayrollLedger` which already rolls up into the Top Sheet actuals and
 * — via `payroll.totalAmount` — into the Cash Flow "Approved Expenditures" KPI.
 */
export function CrewPayrollTab({
  kind = "both",
  heading,
}: { kind?: PayrollKindFilter; heading?: string } = {}) {
  const { t } = useTranslation();
  const { run, isPending } = useExportAction();

  const payroll = useStore((s) => s.payroll);
  const invoices = useStore((s) => s.invoices);
  const navigate = useNavigate();
  const baseRows = useMemo(
    () =>
      payroll.filter((r) =>
        kind === "both" ? r.kind === "crew" || r.kind === "cast" : r.kind === kind,
      ),
    [payroll, kind],
  );

  // For vendor payables rows, resolve the source invoice via refId `invoice:<id>:<i>`.
  const resolveSourceInvoice = useCallback(
    (refId: string) => {
      if (!refId.startsWith("invoice:")) return null;
      const invId = refId.split(":")[1];
      if (!invId) return null;
      return invoices.find((iv) => iv.id === invId) ?? null;
    },
    [invoices],
  );

  type StatusFilter = "all" | "Pending Approval" | "Approved" | "Paid";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = baseRows;
    if (statusFilter !== "all") {
      out = out.filter((r) => (r.ledger ?? []).some((e) => e.status === statusFilter));
    }
    if (q) {
      out = out.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.refId.toLowerCase().includes(q) ||
          (r.budgetCode ?? "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [baseRows, statusFilter, search]);

  const [structureFor, setStructureFor] = useState<PayrollRow | null>(null);
  const [payFor, setPayFor] = useState<PayrollRow | null>(null);
  const [entriesFor, setEntriesFor] = useState<PayrollRow | null>(null);
  const can = useCan();
  const { locked, toggle: toggleLock, projectId } = useProjectLock();
  const canEdit = can("payroll.execute") && !locked;
  const canApprove = can("payroll.approve") && !locked;
  const setLedgerFn = useStore((s) => s.setPayrollLedger);

  const emptyLabel =
    kind === "cast"
      ? "No cast payroll contracts yet. Create contracts in the Cast module — they appear here for payment tracking."
      : kind === "crew"
        ? "No crew payroll contracts yet. Create contracts in the Crew module — they appear here for payment tracking."
        : kind === "vendor"
          ? "No vendor invoice milestones yet. Book invoices in Accounting — future-dated milestones appear here as payables."
          : "No crew or cast payroll contracts yet. Create contracts in the Crew or Cast module — they appear here for payment tracking.";
  const label =
    kind === "cast"
      ? "Cast (Talent) Contracts"
      : kind === "crew"
        ? "Crew (Technical) Contracts"
        : kind === "vendor"
          ? "Vendor Invoice Milestones"
          : "Freelancer Contracts";
  const moduleLabel =
    kind === "cast"
      ? "Cast Payables"
      : kind === "crew"
        ? "Crew Payables"
        : kind === "vendor"
          ? "Vendor Payables"
          : "Payables";

  // ─── Pagination ───
  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  // Clamp page when filters/data change.
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  );

  // ─── Selection state for bulk actions (persists across pages) ───
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<null | "approve" | "pay">(null);

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // "Select all" scopes are page-aware.
  const allPageSelected = pagedRows.length > 0 && pagedRows.every((r) => selected.has(r.id));
  const allFilteredSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const togglePageSelection = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pagedRows.forEach((r) => next.delete(r.id));
      else pagedRows.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  // Preview counts of eligible ledger entries across selected rows
  const bulkCounts = useMemo(() => {
    let pending = 0,
      approved = 0;
    for (const r of selectedRows) {
      for (const e of r.ledger ?? []) {
        if (e.status === "Pending Approval") pending++;
        else if (e.status === "Approved") approved++;
      }
    }
    return { pending, approved };
  }, [selectedRows]);

  const runBulkApprove = async () => {
    if (!canApprove || bulkCounts.pending === 0) return;
    setBulkBusy("approve");
    const nowIso = new Date().toISOString();
    let touchedRows = 0,
      failedRows = 0,
      entriesApproved = 0;
    const touchedRefIds: string[] = [];
    for (const r of selectedRows) {
      const ledger = r.ledger ?? [];
      const pendingCount = ledger.filter((e) => e.status === "Pending Approval").length;
      if (pendingCount === 0) continue;
      const next = ledger.map((e) =>
        e.status === "Pending Approval"
          ? { ...e, status: "Approved" as const, approvedAt: nowIso, updatedAt: nowIso as any }
          : e,
      );
      try {
        await setLedgerFn(r.refId, next);
        touchedRows++;
        entriesApproved += pendingCount;
        touchedRefIds.push(r.refId);
      } catch {
        failedRows++;
      }
    }
    setBulkBusy(null);
    // Audit log
    recordAudit({
      category: "other",
      action: `${moduleLabel.toLowerCase().replace(/\s/g, "_")}.bulk_approve`,
      severity: failedRows > 0 ? "warning" : "info",
      summary: `Bulk approve — ${entriesApproved} entr${entriesApproved === 1 ? "y" : "ies"} across ${touchedRows} row${touchedRows === 1 ? "" : "s"} (${failedRows} failed)`,
      entity: moduleLabel,
      details: {
        module: moduleLabel,
        kind,
        performedAt: nowIso,
        rowsAffected: touchedRows,
        rowsFailed: failedRows,
        entriesApproved,
        refIds: touchedRefIds,
      },
    });
    if (failedRows > 0) {
      toast.error(
        `Bulk approve: ${entriesApproved} entries on ${touchedRows} row${touchedRows === 1 ? "" : "s"} updated, ${failedRows} failed.`,
      );
    } else {
      toast.success(
        `Approved ${entriesApproved} entr${entriesApproved === 1 ? "y" : "ies"} across ${touchedRows} row${touchedRows === 1 ? "" : "s"}.`,
      );
    }
  };

  const runBulkMarkPaid = async () => {
    if (!canEdit || bulkCounts.approved === 0) return;
    if (
      !window.confirm(
        `Mark ${bulkCounts.approved} approved entr${bulkCounts.approved === 1 ? "y" : "ies"} across ${selectedRows.length} row${selectedRows.length === 1 ? "" : "s"} as Paid?\n\nThis will post to Top Sheet actuals and Cash Flow.`,
      )
    )
      return;
    setBulkBusy("pay");
    const nowIso = new Date().toISOString();
    let touchedRows = 0,
      failedRows = 0,
      entriesPaid = 0;
    const touchedRefIds: string[] = [];
    for (const r of selectedRows) {
      const ledger = r.ledger ?? [];
      const approvedCount = ledger.filter((e) => e.status === "Approved").length;
      if (approvedCount === 0) continue;
      const next = ledger.map((e) =>
        e.status === "Approved"
          ? { ...e, status: "Paid" as const, paidAt: nowIso, updatedAt: nowIso as any }
          : e,
      );
      try {
        await setLedgerFn(r.refId, next);
        touchedRows++;
        entriesPaid += approvedCount;
        touchedRefIds.push(r.refId);
      } catch {
        failedRows++;
      }
    }
    setBulkBusy(null);
    recordAudit({
      category: "other",
      action: `${moduleLabel.toLowerCase().replace(/\s/g, "_")}.bulk_mark_paid`,
      severity: failedRows > 0 ? "warning" : "info",
      summary: `Bulk mark paid — ${entriesPaid} entr${entriesPaid === 1 ? "y" : "ies"} across ${touchedRows} row${touchedRows === 1 ? "" : "s"} (${failedRows} failed)`,
      entity: moduleLabel,
      details: {
        module: moduleLabel,
        kind,
        performedAt: nowIso,
        rowsAffected: touchedRows,
        rowsFailed: failedRows,
        entriesPaid,
        refIds: touchedRefIds,
      },
    });
    if (failedRows > 0) {
      toast.error(
        `Mark Paid: ${entriesPaid} entries on ${touchedRows} row${touchedRows === 1 ? "" : "s"} updated, ${failedRows} failed.`,
      );
    } else {
      toast.success(
        `Marked ${entriesPaid} entr${entriesPaid === 1 ? "y" : "ies"} as Paid across ${touchedRows} row${touchedRows === 1 ? "" : "s"}.`,
      );
    }
  };

  // ─── Export helpers ───
  // Export columns mirror the on-screen Cast/Crew Payroll table:
  //   Beneficiary | Kind | Budget | Total | Paid | Remaining | Structure | Pending / Approved / Paid counts
  // Ledger detail respects the active status filter — when a specific status
  // is selected, only entries matching that status are exported.
  const buildExportRows = () => {
    // If a selection exists, export selection; otherwise export the full filtered view
    // (across all pages, not just the current page).
    const src = selectedRows.length > 0 ? selectedRows : rows;
    return src.map((r) => {
      const ledger = r.ledger ?? [];
      const paidAmt = ledger
        .filter((e) => e.status === "Paid")
        .reduce((s, e) => s + Number(e.amount || 0), 0);
      const total = Number(r.totalAmount || 0);
      const slots = r.percents?.length ?? 0;
      const pct = total > 0 ? Math.round((paidAmt / total) * 100) : 0;
      return {
        Beneficiary: r.name,
        RefID: r.refId,
        Kind: r.kind,
        Budget: r.budgetCode ?? "Not linked",
        Total: total,
        Paid: paidAmt,
        Remaining: Math.max(0, total - paidAmt),
        Structure: slots > 0 ? `${slots} slot${slots > 1 ? "s" : ""} · ${pct}% paid` : "Not set",
        PendingCount: ledger.filter((e) => e.status === "Pending Approval").length,
        ApprovedCount: ledger.filter((e) => e.status === "Approved").length,
        PaidCount: ledger.filter((e) => e.status === "Paid").length,
      };
    });
  };

  const buildLedgerRows = () => {
    const src = selectedRows.length > 0 ? selectedRows : rows;
    const out: Record<string, any>[] = [];
    for (const r of src) {
      for (const e of r.ledger ?? []) {
        // Respect active status filter for ledger detail.
        if (statusFilter !== "all" && e.status !== statusFilter) continue;
        out.push({
          Beneficiary: r.name,
          RefID: r.refId,
          Kind: r.kind,
          Budget: r.budgetCode ?? "",
          Status: e.status ?? "Pending Approval",
          Date: e.date,
          Amount: Number(e.amount || 0),
          BankRef: e.bankRef ?? "",
          ApprovedAt: (e as any).approvedAt ?? "",
          PaidAt: (e as any).paidAt ?? "",
        });
      }
    }
    return out;
  };

  const stamp = () => new Date().toISOString().slice(0, 10);
  const filterSuffix =
    statusFilter === "all" ? "all" : statusFilter.toLowerCase().replace(/\s+/g, "-");
  const scopeLabel =
    selectedRows.length > 0
      ? `Selection (${selectedRows.length}) · Filter: ${statusFilter}`
      : `Filter: ${statusFilter} · ${rows.length} row${rows.length === 1 ? "" : "s"}`;

  const exportXlsx = async () => {
    const summary = buildExportRows();
    const detail = buildLedgerRows();
    if (summary.length === 0) {
      toast.error(t("crewpayrolltab.nothing_to_export_in_the_current_view"));
      return;
    }
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, ws1, "Contracts");
    const ws2 = XLSX.utils.json_to_sheet(detail);
    XLSX.utils.book_append_sheet(wb, ws2, "Ledger");
    XLSX.writeFile(wb, `${moduleLabel.replace(/\s/g, "_")}_${filterSuffix}_${stamp()}.xlsx`);
    toast.success(
      `Exported ${summary.length} contract${summary.length === 1 ? "" : "s"} · ${detail.length} ledger entr${detail.length === 1 ? "y" : "ies"} to Excel.`,
    );
  };

  const exportPdf = async () => {
    const summary = buildExportRows();
    const detail = buildLedgerRows();
    if (summary.length === 0) {
      toast.error(t("crewpayrolltab.nothing_to_export_in_the_current_view"));
      return;
    }
    await exportPdfReport(
      `${moduleLabel.replace(/\s/g, "_")}_${filterSuffix}_${stamp()}.pdf`,
      [
        {
          title: `${moduleLabel} — Contracts`,
          subtitle: `${scopeLabel} · Generated ${new Date().toLocaleString()}`,
          headers: [
            "Beneficiary",
            "Kind",
            "Budget",
            "Total",
            "Paid",
            "Remaining",
            "Structure",
            "Pending",
            "Approved",
            "Paid #",
          ],
          rows: summary.map((r) => [
            r.Beneficiary,
            r.Kind,
            r.Budget,
            formatUSD(r.Total),
            formatUSD(r.Paid),
            formatUSD(r.Remaining),
            r.Structure,
            String(r.PendingCount),
            String(r.ApprovedCount),
            String(r.PaidCount),
          ]),
          numericColumns: [3, 4, 5],
        },
        {
          title: `${moduleLabel} — Payment Ledger`,
          subtitle: `${detail.length} entr${detail.length === 1 ? "y" : "ies"} · ${scopeLabel}`,
          headers: [
            "Beneficiary",
            "Ref ID",
            "Status",
            "Date",
            "Amount",
            "Bank Ref",
            "Approved At",
            "Paid At",
          ],
          rows: detail.map((e) => [
            e.Beneficiary,
            e.RefID,
            e.Status,
            e.Date,
            formatUSD(e.Amount),
            e.BankRef,
            e.ApprovedAt ? new Date(e.ApprovedAt).toLocaleString() : "",
            e.PaidAt ? new Date(e.PaidAt).toLocaleString() : "",
          ]),
          numericColumns: [4],
        },
      ],
      { documentTitle: `${moduleLabel} Report` },
    );
    toast.success(
      `Exported ${summary.length} contract${summary.length === 1 ? "" : "s"} · ${detail.length} ledger entr${detail.length === 1 ? "y" : "ies"} to PDF.`,
    );
  };

  const totals = useMemo(() => {
    const total = baseRows.reduce((a, r) => a + Number(r.totalAmount || 0), 0);
    const paid = baseRows.reduce(
      (a, r) =>
        a +
        (r.ledger ?? [])
          .filter((e) => e.status === "Paid")
          .reduce((s, e) => s + Number(e.amount || 0), 0),
      0,
    );
    const approved = baseRows.reduce(
      (a, r) =>
        a +
        (r.ledger ?? [])
          .filter((e) => e.status === "Approved")
          .reduce((s, e) => s + Number(e.amount || 0), 0),
      0,
    );
    const pending = baseRows.reduce(
      (a, r) =>
        a +
        (r.ledger ?? [])
          .filter((e) => e.status === "Pending Approval")
          .reduce((s, e) => s + Number(e.amount || 0), 0),
      0,
    );
    // Row-level counts for the filter chips
    const rowCounts = {
      all: baseRows.length,
      "Pending Approval": baseRows.filter((r) =>
        (r.ledger ?? []).some((e) => e.status === "Pending Approval"),
      ).length,
      Approved: baseRows.filter((r) => (r.ledger ?? []).some((e) => e.status === "Approved"))
        .length,
      Paid: baseRows.filter((r) => (r.ledger ?? []).some((e) => e.status === "Paid")).length,
    };
    return { total, paid, approved, pending, remaining: Math.max(0, total - paid), rowCounts };
  }, [baseRows]);

  const filterChips: { key: StatusFilter; label: string; tone: string }[] = [
    { key: "all", label: "All", tone: "bg-surface text-foreground border-border" },
    {
      key: "Pending Approval",
      label: "Pending",
      tone: "bg-warning/15 text-warning border-warning/40",
    },
    { key: "Approved", label: "Approved", tone: "bg-info/15 text-info border-info/40" },
    { key: "Paid", label: "Paid", tone: "bg-success/15 text-success border-success/40" },
  ];

  return (
    <div>
      {heading && <h2 className="text-lg font-semibold text-foreground mb-3">{heading}</h2>}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          label={label}
          value={String(rows.length)}
          icon={<Users className="size-4" />}
        />
        <SummaryCard
          label="Committed"
          value={formatUSD(totals.total)}
          icon={<DollarSign className="size-4" />}
        />
        <SummaryCard
          label="Pending Approval"
          value={formatUSD(totals.pending)}
          icon={<TrendingUp className="size-4" />}
        />
        <SummaryCard
          label="Paid to Date"
          value={formatUSD(totals.paid)}
          sub={`Approved ${formatUSD(totals.approved)} · Remaining ${formatUSD(totals.remaining)}`}
          icon={<TrendingUp className="size-4" />}
        />
      </div>

      {/* Lock banner + toggle */}
      <div
        className={`flex flex-wrap items-center gap-2 mb-3 rounded-xl border px-3 py-2 ${locked ? "border-warning/40 bg-warning/10" : "border-border bg-surface-2/60"}`}
      >
        {locked ? (
          <Lock className="size-4 text-warning" />
        ) : (
          <Unlock className="size-4 text-muted-foreground" />
        )}
        <span className={`text-xs font-semibold ${locked ? "text-warning" : "text-foreground"}`}>
          {locked
            ? "Project version LOCKED — payroll & budget edits disabled"
            : "Project version unlocked"}
        </span>
        <button
          onClick={() => {
            if (!projectId) {
              toast.error(t("crewpayrolltab.no_active_project"));
              return;
            }
            if (
              !window.confirm(
                locked
                  ? "Unlock this project version? Payroll and budget edits will be re-enabled."
                  : "Lock this project version? Payroll, structure changes, approvals, and budget adjustments will be disabled until unlocked.",
              )
            )
              return;
            toggleLock();
            toast.success(locked ? "Project unlocked." : "Project locked.");
          }}
          disabled={!projectId}
          className={`ml-auto inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-semibold transition disabled:opacity-40 ${locked ? "border-warning/60 bg-warning/20 text-warning hover:bg-warning/30" : "border-border hover:bg-muted text-foreground"}`}
        >
          {locked ? (
            <>
              <Unlock className="size-3.5" /> Unlock
            </>
          ) : (
            <>
              <Lock className="size-3.5" />
              {t("crewpayrolltab.lock_version")}
            </>
          )}
        </button>
      </div>

      {/* Search + status filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("crewpayrolltab.search_name_ref_id_budget_code")}
            className="bg-surface-2 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-brand/60 w-72"
          />
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground ml-1">
          {t("crewpayrolltab.filter_by_status")}
        </span>
        {filterChips.map((c) => {
          const active = statusFilter === c.key;
          const count = totals.rowCounts[c.key];
          return (
            <button
              key={c.key}
              onClick={() => setStatusFilter(c.key)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition ${c.tone} ${active ? "ring-2 ring-brand/60 shadow" : "opacity-80 hover:opacity-100"}`}
            >
              {c.label}
              <span className="text-[10px] font-mono opacity-80">{count}</span>
            </button>
          );
        })}
        {(search || statusFilter !== "all") && (
          <button
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Reset
          </button>
        )}
      </div>

      {/* Bulk action + export toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3 rounded-xl border border-border bg-surface-2/60 px-3 py-2">
        <button
          onClick={togglePageSelection}
          disabled={pagedRows.length === 0}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40"
          title={allPageSelected ? "Deselect current page" : "Select current page"}
        >
          {allPageSelected ? <CheckSquare className="size-3.5" /> : <Square className="size-3.5" />}
          {allPageSelected ? "Deselect page" : "Select page"}
        </button>
        {!allFilteredSelected && rows.length > pagedRows.length && (
          <button
            onClick={selectAllFiltered}
            className="text-[11px] text-brand hover:underline underline-offset-2"
            title={`Select all ${rows.length} rows across all pages`}
          >
            Select all {rows.length}
          </button>
        )}
        <span className="text-[11px] text-muted-foreground">
          {selected.size > 0
            ? `${selected.size} selected across pages · ${bulkCounts.pending} pending · ${bulkCounts.approved} approved`
            : "No rows selected"}
        </span>
        {selected.size > 0 && (
          <button
            onClick={clearSelection}
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Clear
          </button>
        )}

        <div className="mx-2 h-5 w-px bg-surface-2" />

        <button
          onClick={runBulkApprove}
          disabled={!canApprove || bulkBusy !== null || bulkCounts.pending === 0}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-info/20 text-info border border-info/40 hover:bg-info/30 disabled:opacity-40"
          title={
            !canApprove
              ? "Requires payroll.approve permission"
              : bulkCounts.pending === 0
                ? "No pending entries in selection"
                : `Approve ${bulkCounts.pending} pending entr${bulkCounts.pending === 1 ? "y" : "ies"}`
          }
        >
          {bulkBusy === "approve" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          Approve {bulkCounts.pending > 0 ? `(${bulkCounts.pending})` : ""}
        </button>
        <button
          onClick={runBulkMarkPaid}
          disabled={!canEdit || bulkBusy !== null || bulkCounts.approved === 0}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-success/20 text-success border border-success/40 hover:bg-success/30 disabled:opacity-40"
          title={
            !canEdit
              ? "Requires payroll.execute permission"
              : bulkCounts.approved === 0
                ? "No approved entries in selection"
                : `Mark ${bulkCounts.approved} approved entr${bulkCounts.approved === 1 ? "y" : "ies"} as Paid`
          }
        >
          {bulkBusy === "pay" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <DollarSign className="size-3.5" />
          )}
          Mark Paid {bulkCounts.approved > 0 ? `(${bulkCounts.approved})` : ""}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground hidden sm:inline">
            Export {selected.size > 0 ? "selection" : "filtered view"}
          </span>
          <button
            onClick={() => run("xlsx", exportXlsx)}
            disabled={rows.length === 0 || isPending("xlsx")}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-success/40 text-success bg-success/10 hover:bg-success/20 disabled:opacity-40"
            title={t("crewpayrolltab.export_contracts_ledger_to_excel")}
          >
            {isPending("xlsx") ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-3.5" />
            )}{" "}
            Excel
          </button>
          <button
            onClick={() => run("pdf", exportPdf)}
            disabled={rows.length === 0 || isPending("pdf")}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-destructive/40 text-destructive bg-destructive/10 hover:bg-destructive/20 disabled:opacity-40"
            title={t("crewpayrolltab.export_contracts_ledger_to_pdf")}
          >
            {isPending("pdf") ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileText className="size-3.5" />
            )}{" "}
            PDF
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-x-auto">
        <table className="app-table w-full">
          <thead>
            <tr className="text-xs uppercase tracking-widest text-muted-foreground">
              <th className="w-8 px-3 py-3">
                <button
                  onClick={togglePageSelection}
                  disabled={pagedRows.length === 0}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                  aria-label={allPageSelected ? "Deselect page" : "Select page"}
                >
                  {allPageSelected ? (
                    <CheckSquare className="size-4" />
                  ) : (
                    <Square className="size-4" />
                  )}
                </button>
              </th>
              <th className="text-left px-4 py-3 font-medium">Beneficiary</th>
              <th className="text-left px-4 py-3 font-medium">Kind</th>
              <th className="text-left px-4 py-3 font-medium">Budget</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-right px-4 py-3 font-medium">Paid</th>
              <th className="text-right px-4 py-3 font-medium">{t("crewpayrolltab.remaining")}</th>
              <th className="text-left px-4 py-3 font-medium">Structure</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  {statusFilter === "all"
                    ? emptyLabel
                    : `No contracts with ${statusFilter} ledger entries. Clear the filter to see all.`}
                </td>
              </tr>
            )}
            {pagedRows.map((r) => {
              const ledger = r.ledger ?? [];
              const paidAmt = ledger
                .filter((e) => e.status === "Paid")
                .reduce((s, e) => s + Number(e.amount || 0), 0);
              const approvedAmt = ledger
                .filter((e) => e.status === "Approved")
                .reduce((s, e) => s + Number(e.amount || 0), 0);
              const pendingAmt = ledger
                .filter((e) => e.status === "Pending Approval")
                .reduce((s, e) => s + Number(e.amount || 0), 0);
              const paid = paidAmt;
              const pending = pendingAmt + approvedAmt;
              const total = Number(r.totalAmount || 0);
              const remaining = Math.max(0, total - paid);
              const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
              const slots = r.percents?.length ?? 0;
              const pendingCount = ledger.filter((e) => e.status === "Pending Approval").length;
              const approvedCount = ledger.filter((e) => e.status === "Approved").length;
              const paidCount = ledger.filter((e) => e.status === "Paid").length;
              const isSelected = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={`border-t border-border hover:bg-card/[0.02] ${isSelected ? "bg-brand/10" : ""}`}
                >
                  <td className="px-3 py-3 align-top">
                    <button
                      onClick={() => toggleRow(r.id)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={isSelected ? "Deselect row" : "Select row"}
                    >
                      {isSelected ? (
                        <CheckSquare className="size-4 text-brand" />
                      ) : (
                        <Square className="size-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const srcInv = r.kind === "vendor" ? resolveSourceInvoice(r.refId) : null;
                      return (
                        <>
                          {srcInv ? (
                            <button
                              type="button"
                              onClick={() =>
                                navigate({
                                  to: "/accounting",
                                  search: { tab: "invoices", focus: srcInv.id } as any,
                                })
                              }
                              className="font-medium text-foreground hover:text-brand underline underline-offset-2 decoration-dotted decoration-brand/60 text-left inline-flex items-center gap-1"
                              title={`Open source invoice #${srcInv.invoiceNo || srcInv.id.slice(0, 6)}`}
                            >
                              <FileSearch className="size-3.5 text-brand/80" />
                              <span>{r.name}</span>
                            </button>
                          ) : (
                            <div className="font-medium text-foreground">{r.name}</div>
                          )}
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {r.refId}
                          </div>
                          {srcInv && (srcInv.invoiceUrl || srcInv.receiptUrl) && (
                            <div className="mt-1 flex items-center gap-1 flex-wrap">
                              {srcInv.invoiceUrl && (
                                <a
                                  href={srcInv.invoiceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={t("crewpayrolltab.open_invoice_document")}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-info/15 text-info text-[10px] font-semibold hover:bg-info/25 border border-info/30"
                                >
                                  <ExternalLink className="size-3" /> Inv
                                </a>
                              )}
                              {srcInv.receiptUrl && (
                                <a
                                  href={srcInv.receiptUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={t("crewpayrolltab.open_receipt_document")}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-info/15 text-info text-[10px] font-semibold hover:bg-info/25 border border-info/30"
                                >
                                  <ExternalLink className="size-3" /> Rcpt
                                </a>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-border bg-surface-2">
                      {r.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {r.budgetCode ? (
                      <span className="font-mono text-xs">{r.budgetCode}</span>
                    ) : (
                      <span className="text-destructive text-xs">
                        {t("crewpayrolltab.not_linked")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {formatUSD(total)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-success">
                    {formatUSD(paid)}
                    {pending > 0 && (
                      <div className="text-[10px] text-warning font-normal">
                        + {formatUSD(pending)} pending
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatUSD(remaining)}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs">
                      {slots > 0
                        ? `${slots} slot${slots > 1 ? "s" : ""} · ${pct}% paid`
                        : "Not set"}
                    </div>
                    <div className="mt-1 h-1.5 w-24 rounded-full bg-surface-2 overflow-hidden">
                      <div
                        className="h-full bg-success/70"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => ledger.length > 0 && setEntriesFor(r)}
                        disabled={pendingCount === 0}
                        title={t("crewpayrolltab.pending_approval_entries")}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border transition ${
                          pendingCount > 0
                            ? "bg-warning/15 text-warning border-warning/40 hover:bg-warning/25 cursor-pointer"
                            : "bg-card/[0.03] text-muted-foreground border-border opacity-60"
                        }`}
                      >
                        ● Pending <span className="font-mono">{pendingCount}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => approvedCount > 0 && setEntriesFor(r)}
                        disabled={approvedCount === 0}
                        title={t("crewpayrolltab.approved_awaiting_payment")}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border transition ${
                          approvedCount > 0
                            ? "bg-info/15 text-info border-info/40 hover:bg-info/25 cursor-pointer"
                            : "bg-card/[0.03] text-muted-foreground border-border opacity-60"
                        }`}
                      >
                        ● Approved <span className="font-mono">{approvedCount}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => paidCount > 0 && setEntriesFor(r)}
                        disabled={paidCount === 0}
                        title={t("crewpayrolltab.paid_entries_posted_to_top_sheet_and_cash")}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border transition ${
                          paidCount > 0
                            ? "bg-success/15 text-success border-success/40 hover:bg-success/25 cursor-pointer"
                            : "bg-card/[0.03] text-muted-foreground border-border opacity-60"
                        }`}
                      >
                        ● Paid <span className="font-mono">{paidCount}</span>
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <button
                        onClick={() => setEntriesFor(r)}
                        disabled={ledger.length === 0}
                        className="relative text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40"
                      >
                        Entries
                        {pendingCount + approvedCount > 0 && (
                          <span className="ml-1 inline-flex items-center justify-center min-w-4 h-4 px-1 text-[9px] font-semibold rounded-full bg-warning/20 text-warning border border-warning/40">
                            {pendingCount + approvedCount}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => setStructureFor(r)}
                        disabled={!canEdit}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40"
                      >
                        Structure
                      </button>
                      <button
                        onClick={() => setPayFor(r)}
                        disabled={!canEdit || !r.budgetCode || remaining <= 0}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-brand text-brand-foreground font-semibold disabled:opacity-40"
                        title={
                          !r.budgetCode
                            ? "Link a budget code first"
                            : remaining <= 0
                              ? "Fully paid"
                              : undefined
                        }
                      >
                        <Plus className="size-3.5" /> Pay
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Showing{" "}
            <span className="font-mono text-foreground">{(safePage - 1) * pageSize + 1}</span>–
            <span className="font-mono text-foreground">
              {Math.min(safePage * pageSize, rows.length)}
            </span>{" "}
            of <span className="font-mono text-foreground">{rows.length}</span>
          </span>
          <div className="flex items-center gap-1 ml-2">
            <span className="text-[10px] uppercase tracking-widest">Rows</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="bg-surface-2 border border-border rounded px-1.5 py-0.5 text-foreground text-xs"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2 font-mono text-foreground">
              {safePage} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
        <ChevronRight className="size-3.5" />
        {t("crewpayrolltab.new_payments_enter")}
        <span className="font-semibold text-warning">{t("crewpayrolltab.pending_approval")}</span>,
        then require Approval and Mark-as-Paid before posting to the Top Sheet actuals.
      </div>

      {structureFor && <StructureModal row={structureFor} onClose={() => setStructureFor(null)} />}
      {payFor && <RecordPayrollPaymentModal row={payFor} onClose={() => setPayFor(null)} />}
      {entriesFor && <EntriesApprovalModal row={entriesFor} onClose={() => setEntriesFor(null)} />}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─────────────────────── Structure Modal ───────────────────────

function StructureModal({ row, onClose }: { row: PayrollRow; onClose: () => void }) {
  const { t } = useTranslation();

  const setLedger = useStore((s) => s.setPayrollLedger);
  const updatePayrollGlAccount = useStore((s) => s.updatePayrollGlAccount);
  const budget = useStore((s) => s.budget);
  const [mode, setMode] = useState<StructureMode>(
    row.percents &&
      row.percents.length > 0 &&
      row.percents.every((p) => Math.abs(p - row.percents[0]) < 0.5)
      ? "weekly"
      : "milestone",
  );
  const [weeks, setWeeks] = useState<number>(Math.max(1, row.percents?.length || 4));
  const [milestones, setMilestones] = useState<number[]>(
    row.percents && row.percents.length > 0 ? [...row.percents] : [25, 25, 25, 25],
  );
  const [budgetCode, setBudgetCode] = useState<string>(row.budgetCode ?? "");
  const [saving, setSaving] = useState(false);

  const budgetCodes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of budget) {
      if (!b.mainCode) continue;
      if (!seen.has(b.mainCode)) seen.set(b.mainCode, b.description ?? "");
    }
    return Array.from(seen.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, label]) => ({ value: code, code, label }));
  }, [budget]);

  const milestoneSum = milestones.reduce((a, b) => a + Number(b || 0), 0);

  const addMilestone = () => setMilestones((prev) => [...prev, 0]);
  const removeMilestone = (idx: number) =>
    setMilestones((prev) => prev.filter((_, i) => i !== idx));
  const updateMilestone = (idx: number, val: number) =>
    setMilestones((prev) => prev.map((v, i) => (i === idx ? val : v)));

  const save = async () => {
    if (mode === "milestone" && Math.abs(milestoneSum - 100) > 0.5) {
      toast.error(`Milestones must sum to 100% (currently ${milestoneSum.toFixed(1)}%).`);
      return;
    }
    if (!budgetCode.trim()) {
      toast.error(t("crewpayrolltab.select_a_budget_gl_account_code_first"));
      return;
    }
    setSaving(true);
    try {
      // Persist budget code
      if (budgetCode !== row.budgetCode) {
        const { error } = await supabase
          .from("payroll" as any)
          .update({ budget_code: budgetCode })
          .eq("id", row.id);
        if (error) throw error;
        // Local sync
        useStore.setState((s) => ({
          payroll: s.payroll.map((p) => (p.id === row.id ? { ...p, budgetCode } : p)),
        }));
      }

      // Compute new percents; keep existing ledger entries intact so paid amounts don't disappear.
      const newPercents =
        mode === "weekly"
          ? Array.from({ length: Math.max(1, weeks) }, () => +(100 / Math.max(1, weeks)).toFixed(4))
          : milestones.map((v) => +Number(v || 0).toFixed(4));

      const total = Number(row.totalAmount || 0);
      const existingLedger = (row.ledger ?? []).slice(0, newPercents.length);
      const paddedLedger: PaymentLedgerEntry[] = existingLedger;
      // Only re-write payments / percents; setPayrollLedger recomputes percents from amounts.
      // To preserve pure structure changes with no payments yet, write only when ledger empty.
      if ((row.ledger?.length ?? 0) === 0) {
        // No payments yet — just save percents directly (no ledger sync needed).
        const payments = newPercents.map(() => "Upcoming" as const);
        const receipts = newPercents.map(() => null);
        const { error } = await supabase
          .from("payroll" as any)
          .update({ percents: newPercents, payments, receipts, ledger: [] })
          .eq("id", row.id);
        if (error) throw error;
        useStore.setState((s) => ({
          payroll: s.payroll.map((p) =>
            p.id === row.id ? { ...p, percents: newPercents, payments, receipts, ledger: [] } : p,
          ),
        }));
      } else {
        await setLedger(row.refId, paddedLedger);
      }

      toast.success(t("crewpayrolltab.payment_structure_updated"));
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update structure");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title={`Payment Structure — ${row.name}`}>
      <div className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
            Budget / GL Code *
          </div>
          <SearchableSelect
            value={budgetCode}
            onChange={setBudgetCode}
            options={budgetCodes}
            placeholder={t("crewpayrolltab.select_budget_code")}
            searchPlaceholder="Search code or description…"
            emptyValueLabel="— Unassigned —"
          />
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
            {t("crewpayrolltab.structure_mode")}
          </div>
          <div className="inline-flex rounded-xl border border-border bg-surface-2 p-1">
            {(["weekly", "milestone"] as StructureMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  mode === m
                    ? "bg-brand text-brand-foreground"
                    : "text-foreground/70 hover:bg-muted"
                }`}
              >
                {m === "weekly" ? "Weekly" : "Milestone %"}
              </button>
            ))}
          </div>
        </div>

        {mode === "weekly" ? (
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("crewpayrolltab.number_of_weekly_payments")}
            </span>
            <input
              type="number"
              min={1}
              max={52}
              value={weeks}
              onChange={(e) => setWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
              className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-foreground outline-none"
            />
            <div className="text-[11px] text-muted-foreground mt-1">
              Each week ≈ {formatUSD(Number(row.totalAmount || 0) / Math.max(1, weeks))} (
              {(100 / Math.max(1, weeks)).toFixed(2)}%)
            </div>
          </label>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                {t("crewpayrolltab.milestones")}
              </span>
              <button
                onClick={addMilestone}
                className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-muted"
              >
                <Plus className="size-3" /> Add
              </button>
            </div>
            <div className="space-y-1.5">
              {milestones.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16">#{i + 1}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={m}
                    onChange={(e) => updateMilestone(i, Number(e.target.value) || 0)}
                    className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm outline-none"
                  />
                  <span className="text-xs text-muted-foreground w-24 text-right">
                    {formatUSD(((Number(row.totalAmount) || 0) * (Number(m) || 0)) / 100)}
                  </span>
                  <button
                    onClick={() => removeMilestone(i)}
                    className="p-1.5 text-destructive hover:bg-destructive/10 rounded"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div
              className={`text-xs mt-2 ${Math.abs(milestoneSum - 100) < 0.5 ? "text-success" : "text-destructive"}`}
            >
              Total: {milestoneSum.toFixed(1)}%{" "}
              {Math.abs(milestoneSum - 100) < 0.5 ? "✓" : "(must equal 100%)"}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand text-brand-foreground font-semibold disabled:opacity-50"
          >
            <Save className="size-3.5" /> {saving ? "Saving…" : "Save Structure"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────── Payment Modal ───────────────────────

function RecordPayrollPaymentModal({ row, onClose }: { row: PayrollRow; onClose: () => void }) {
  const { t } = useTranslation();

  const setLedger = useStore((s) => s.setPayrollLedger);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const paid = (row.ledger ?? []).reduce((s, e) => s + Number(e.amount || 0), 0);
  const remaining = Math.max(0, Number(row.totalAmount || 0) - paid);

  const [amount, setAmount] = useState<number>(Number(remaining.toFixed(2)));
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [bankRef, setBankRef] = useState<string>("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const exceeds = amount > remaining + 0.005;

  const submit = async () => {
    if (amount <= 0) return toast.error(t("crewpayrolltab.amount_must_be_greater_than_zero"));
    if (exceeds) return toast.error(`Amount exceeds remaining balance (${formatUSD(remaining)}).`);
    if (!proofFile) return toast.error(t("crewpayrolltab.proof_of_payment_is_required"));
    setSubmitting(true);
    try {
      // Upload proof to contracts bucket
      const ext = proofFile.name.split(".").pop() || "pdf";
      const path = `payroll/${row.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("contracts")
        .upload(path, proofFile, { upsert: false });
      if (upErr) throw upErr;

      const newEntry: PaymentLedgerEntry = {
        id: crypto.randomUUID(),
        date,
        amount: Number(amount.toFixed(2)),
        bankRef: bankRef.trim(),
        proofPath: path,
        status: "Pending Approval",
      };
      const nextLedger = [...(row.ledger ?? []), newEntry];
      await setLedger(row.refId, nextLedger);
      toast.success(`Payment of ${formatUSD(amount)} recorded — awaiting approval.`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to record payment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} title={`Record Payment — ${row.name}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Info label="Total Contract" value={formatUSD(row.totalAmount)} />
          <Info label="Paid to Date" value={formatUSD(paid)} tone="text-success" />
          <Info label="Remaining" value={formatUSD(remaining)} tone="text-warning" />
          <Info label="Budget Code" value={row.budgetCode ?? "—"} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Amount *
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
              className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-3 py-2 outline-none focus:ring-2 ring-brand"
            />
            {exceeds && (
              <div className="text-[11px] text-destructive mt-1">
                {t("crewpayrolltab.exceeds_remaining_balance")}
              </div>
            )}
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Payment Date *
            </span>
            <DateInput value={date} onChange={setDate} />
          </label>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Bank / Reference #
          </span>
          <input
            value={bankRef}
            onChange={(e) => setBankRef(e.target.value)}
            placeholder={t("crewpayrolltab.transfer_ref_check_number")}
            className="mt-1 w-full bg-surface-2 border border-border rounded-lg px-3 py-2 outline-none focus:ring-2 ring-brand"
          />
        </label>

        <div>
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Proof of Payment *
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted text-sm"
            >
              <Paperclip className="size-4" /> {proofFile ? proofFile.name : "Choose file…"}
            </button>
            {proofFile && (
              <button
                onClick={() => setProofFile(null)}
                className="p-1.5 rounded text-destructive hover:bg-destructive/10"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || exceeds || !proofFile || amount <= 0}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-brand text-brand-foreground font-semibold disabled:opacity-50"
          >
            <DollarSign className="size-3.5" /> {submitting ? "Saving…" : "Record Payment"}
          </button>
        </div>

        {!activeProjectId && (
          <div className="text-[11px] text-warning">
            No active project detected — actuals may not roll up.
          </div>
        )}
      </div>
    </Modal>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

// ─────────────────────── Entries / Approval Workflow ───────────────────────

function EntriesApprovalModal({ row, onClose }: { row: PayrollRow; onClose: () => void }) {
  const { t } = useTranslation();

  const setLedger = useStore((s) => s.setPayrollLedger);
  const can = useCan();
  const canApprove = can("payroll.approve");
  const canPay = can("payroll.execute");
  const canEdit = can("payroll.execute");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ amount: number; date: string; memo: string }>({
    amount: 0,
    date: "",
    memo: "",
  });
  const ledger = row.ledger ?? [];

  const patchEntry = async (entryId: string, patch: Partial<PaymentLedgerEntry>) => {
    setBusyId(entryId);
    try {
      const nowIso = new Date().toISOString();
      const next = ledger.map((e) =>
        e.id === entryId
          ? { ...e, ...patch, ...(patch.status ? ({ updatedAt: nowIso } as any) : {}) }
          : e,
      );
      await setLedger(row.refId, next);
      const label =
        patch.status === "Approved"
          ? "approved"
          : patch.status === "Paid"
            ? "marked as paid — Top Sheet updated"
            : patch.status === "Rejected"
              ? "rejected"
              : "updated";
      toast.success(`Payment ${label}.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update entry.");
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (e: PaymentLedgerEntry) => {
    setEditingId(e.id);
    setDraft({ amount: Number(e.amount) || 0, date: e.date || "", memo: e.memo ?? "" });
  };

  const saveEdit = async (entryId: string) => {
    if (draft.amount <= 0) {
      toast.error("Amount must be greater than 0.");
      return;
    }
    if (!draft.date) {
      toast.error(t("crewpayrolltab.due_date_is_required"));
      return;
    }
    await patchEntry(entryId, {
      amount: +draft.amount.toFixed(2),
      date: draft.date,
      memo: draft.memo.trim() || null,
    });
    setEditingId(null);
  };

  const statusStyle = (s?: PaymentLedgerEntry["status"]) => {
    switch (s) {
      case "Approved":
        return "bg-info/15 text-info border-info/30";
      case "Paid":
        return "bg-success/15 text-success border-success/30";
      case "Rejected":
        return "bg-destructive/15 text-destructive border-destructive/30";
      default:
        return "bg-warning/15 text-warning border-warning/30";
    }
  };

  return (
    <Modal onClose={onClose} title={`Payment Entries — ${row.name}`}>
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground">
          {t("crewpayrolltab.approval_workflow")}
          <b className="text-warning">Pending</b> → <b className="text-info">Approved</b> →{" "}
          <b className="text-success">Paid</b>. Only paid entries post to the Top Sheet actuals
          column. Pending entries can be manually overridden (amount / due date / memo).
        </div>
        {ledger.length === 0 ? (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
            {t("crewpayrolltab.no_payment_entries_yet")}
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {ledger.map((e, i) => {
              const status = e.status ?? "Pending Approval";
              const busy = busyId === e.id;
              const isEditing = editingId === e.id;
              const canOverride = status === "Pending Approval" && canEdit;
              return (
                <div
                  key={e.id}
                  className="rounded-lg border border-border bg-surface-2/50 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">
                          #{i + 1} · {formatUSD(e.amount)}
                        </span>
                        <span
                          className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${statusStyle(status)}`}
                        >
                          {status}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {e.date}
                        {e.bankRef ? ` · Ref ${e.bankRef}` : ""}
                      </div>
                      {e.memo && (
                        <div className="text-[11px] text-info italic mt-0.5">Memo: {e.memo}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {canOverride && !isEditing && (
                        <button
                          onClick={() => startEdit(e)}
                          disabled={busy}
                          title={t(
                            "crewpayrolltab.manual_override_edit_milestone_amount_due_date_memo",
                          )}
                          className="text-xs px-2 py-1.5 rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1 disabled:opacity-40"
                        >
                          <Pencil className="size-3.5" /> Edit
                        </button>
                      )}
                      {status === "Pending Approval" && !isEditing && (
                        <>
                          <button
                            onClick={() =>
                              patchEntry(e.id, {
                                status: "Approved",
                                approvedAt: new Date().toISOString(),
                              })
                            }
                            disabled={!canApprove || busy}
                            className="text-xs px-2.5 py-1.5 rounded-lg bg-info/20 text-info border border-info/40 hover:bg-info/30 disabled:opacity-40"
                            title={!canApprove ? "Requires payroll.approve permission" : undefined}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              const reason =
                                window.prompt("Reason for rejection (optional):", "") ?? "";
                              patchEntry(e.id, {
                                status: "Rejected",
                                rejectionReason: reason || null,
                              });
                            }}
                            disabled={!canApprove || busy}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {status === "Approved" && (
                        <button
                          onClick={() =>
                            patchEntry(e.id, { status: "Paid", paidAt: new Date().toISOString() })
                          }
                          disabled={!canPay || busy}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-success/20 text-success border border-success/40 hover:bg-success/30 disabled:opacity-40"
                          title={!canPay ? "Requires payroll.execute permission" : undefined}
                        >
                          <DollarSign className="size-3 inline -mt-0.5" />
                          {t("crewpayrolltab.mark_paid")}
                        </button>
                      )}
                      {status === "Rejected" && e.rejectionReason && (
                        <span className="text-[11px] text-destructive italic">
                          {e.rejectionReason}
                        </span>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-2">
                      <label className="text-[11px] text-muted-foreground">
                        Amount
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={draft.amount}
                          onChange={(ev) => setDraft({ ...draft, amount: +ev.target.value })}
                          className="mt-1 w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-sm text-foreground"
                        />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        {t("crewpayrolltab.due_date")}
                        <input
                          type="date"
                          value={draft.date}
                          onChange={(ev) => setDraft({ ...draft, date: ev.target.value })}
                          className="mt-1 w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-sm text-foreground"
                        />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        {t("crewpayrolltab.memo_note")}
                        <input
                          type="text"
                          placeholder={t("crewpayrolltab.eg_partial_payment")}
                          value={draft.memo}
                          onChange={(ev) => setDraft({ ...draft, memo: ev.target.value })}
                          className="mt-1 w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-sm text-foreground"
                        />
                      </label>
                      <div className="col-span-3 flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(e.id)}
                          disabled={busy}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-brand text-brand-foreground font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                        >
                          <Save className="size-3.5" />
                          {t("crewpayrolltab.save_override")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-end pt-2 border-t border-border">
          <button
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// suppress unused warning for HEADER_ACCOUNTS import if tree-shaken later
void HEADER_ACCOUNTS;

/** Talent-only payroll (Cast). Feeds Cash Flow "Approved Expenditures" via payroll.totalAmount. */
export function CastPayrollTab({ heading }: { heading?: string } = {}) {
  return <CrewPayrollTab kind="cast" heading={heading} />;
}

/** Technical-only payroll (Crew). Feeds Cash Flow "Approved Expenditures" via payroll.totalAmount. */
export function CrewOnlyPayrollTab({ heading }: { heading?: string } = {}) {
  return <CrewPayrollTab kind="crew" heading={heading} />;
}
