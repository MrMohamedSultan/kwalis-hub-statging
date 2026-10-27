import { useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  PauseCircle,
  RotateCcw,
  Search,
  AlertTriangle,
  FileSpreadsheet,
  BadgeCheck,
  Banknote,
  Loader2,
  Upload,
} from "lucide-react";
import { useStore, formatUSD, type MilestoneStatus, type PayrollRow } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import { useProjectLock } from "@/lib/project-lock";
import { projectHeaderPairs } from "@/lib/project-metadata";
import { downloadBlob } from "@/lib/download";
import { Modal } from "@/components/Modal";
import { supabase } from "@/integrations/supabase/client";

import { useTranslation } from "react-i18next";
type Kind = "crew" | "cast";

type MilestoneRow = {
  key: string;
  payrollRowId: string;
  milestoneId: string;
  beneficiary: string;
  position: string;
  contractStatus: string;
  budgetCode: string | null;
  label: string;
  dueDate: string;
  amount: number;
  status: MilestoneStatus;
  /** Unpaid and due today or earlier. */
  overdue: boolean;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Strict, user-defined color logic for the aging report. */
function rowTone(m: MilestoneRow) {
  if (m.status === "Paid") {
    return {
      row: "bg-success/5 hover:bg-success/10",
      badge: "bg-success/15 text-success border-success/30",
      label: "Paid",
    };
  }
  if (m.status === "Approved") {
    return {
      row: "bg-info/5 hover:bg-info/10",
      badge: "bg-info/15 text-info border-info/30",
      label: "Approved",
    };
  }
  if (m.status === "Hold") {
    return {
      row: "bg-warning/5 hover:bg-warning/10",
      badge: "bg-warning/15 text-warning border-warning/30",
      label: "On Hold",
    };
  }
  if (m.overdue) {
    return {
      row: "bg-destructive/10 hover:bg-destructive/15",
      badge: "bg-destructive/15 text-destructive border-destructive/30",
      label: "Action Needed",
    };
  }
  return {
    row: "hover:bg-muted",
    badge: "bg-surface-2 text-muted-foreground border-border",
    label: "Upcoming",
  };
}

/** Flattened milestone rows → single-sheet .xlsx workbook. */
async function exportMilestonesXlsx(rows: MilestoneRow[], kind: Kind) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === "crew" ? "Crew Payables" : "Cast Payables");

  const header = projectHeaderPairs();
  header.forEach(([k, v]) => ws.addRow([k, v]));
  if (header.length) ws.addRow([]);

  const HEADERS = [
    "Beneficiary",
    "Position",
    "Contract Status",
    "Budget Code",
    "Milestone",
    "Due Date",
    "Amount (USD)",
    "Status",
    "Aging",
  ];
  const headRow = ws.addRow(HEADERS);
  headRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  rows.forEach((m) => {
    const r = ws.addRow([
      m.beneficiary,
      m.position,
      m.contractStatus,
      m.budgetCode ?? "",
      m.label,
      m.dueDate,
      Number(m.amount.toFixed(2)),
      m.status,
      rowTone(m).label,
    ]);
    r.getCell(7).numFmt = "#,##0.00";
  });

  const total = rows.reduce((s, m) => s + m.amount, 0);
  const totalRow = ws.addRow(["Total", "", "", "", "", "", Number(total.toFixed(2)), "", ""]);
  totalRow.font = { bold: true };
  totalRow.getCell(7).numFmt = "#,##0.00";

  ws.columns.forEach((c, i) => {
    c.width = [26, 20, 18, 14, 28, 14, 16, 12, 16][i] ?? 16;
  });
  ws.autoFilter = {
    from: { row: headRow.number, column: 1 },
    to: { row: headRow.number, column: HEADERS.length },
  };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buf)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(`${kind}-payables-milestones-${todayIso()}.xlsx`, blob);
}

/**
 * Crew & Cast Payables — milestone level.
 *
 * Unpacks the `payment_schedule` of every committed contract into one
 * actionable payable row per milestone, so flat-fee contracts show up here
 * without waiting for timesheets.
 */
export function ContractMilestonePayables({ kind }: { kind: Kind }) {
  const { t } = useTranslation();

  const payroll = useStore((s) => s.payroll);
  const people = useStore((s) => s.people);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setMilestoneStatus = useStore((s) => s.setMilestoneStatus);
  const can = useCan();
  const { locked } = useProjectLock();
  const canEdit = can("payroll.execute") && !locked;

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "all" | "overdue" | "upcoming" | "approved" | "hold" | "paid"
  >("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [executing, setExecuting] = useState<MilestoneRow | null>(null);

  const milestones = useMemo<MilestoneRow[]>(() => {
    const today = todayIso();
    const personByRef = new Map(people.map((p) => [p.id, p]));
    const out: MilestoneRow[] = [];

    for (const row of payroll as PayrollRow[]) {
      if (row.kind !== kind) continue;
      const person = personByRef.get(row.refId);
      // Legacy payroll rows without a linked contract still represent money owed.
      // Do not hide rows by contract status: a saved schedule is already an AP
      // obligation and must be visible even while the PDF workflow is pending.
      const contractStatus = person?.contractStatus ?? "Active";

      const schedule = Array.isArray(row.paymentSchedule) ? row.paymentSchedule : [];
      schedule.forEach((m, i) => {
        const base = Number(row.netPayable ?? row.totalAmount) || 0;
        const amount =
          m.amount !== null && m.amount !== undefined
            ? Number(m.amount)
            : (base * Number(m.percent ?? 0)) / 100;
        const status: MilestoneStatus =
          m.status === "Paid" || m.status === "Hold" || m.status === "Approved"
            ? m.status
            : row.payments?.[i] === "Paid"
              ? "Paid"
              : "Pending";
        out.push({
          key: `${row.id}:${m.id}`,
          payrollRowId: row.id,
          milestoneId: m.id,
          beneficiary: row.name,
          position: person?.position ?? "",
          contractStatus,
          budgetCode: row.budgetCode,
          label: m.label || `Milestone ${i + 1}`,
          dueDate: m.dueDate || "",
          amount,
          status,
          overdue: status === "Pending" && !!m.dueDate && m.dueDate <= today,
        });
      });
    }

    return out.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  }, [payroll, people, kind]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return milestones.filter((m) => {
      if (filter === "overdue" && !m.overdue) return false;
      if (filter === "upcoming" && !(m.status === "Pending" && !m.overdue)) return false;
      if (filter === "approved" && m.status !== "Approved") return false;
      if (filter === "hold" && m.status !== "Hold") return false;
      if (filter === "paid" && m.status !== "Paid") return false;
      if (
        q &&
        !m.beneficiary.toLowerCase().includes(q) &&
        !m.label.toLowerCase().includes(q) &&
        !(m.budgetCode ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [milestones, search, filter]);

  const totals = useMemo(() => {
    let overdue = 0,
      upcoming = 0,
      approved = 0,
      hold = 0,
      paid = 0;
    for (const m of milestones) {
      if (m.status === "Paid") paid += m.amount;
      else if (m.status === "Approved") approved += m.amount;
      else if (m.status === "Hold") hold += m.amount;
      else if (m.overdue) overdue += m.amount;
      else upcoming += m.amount;
    }
    return { overdue, upcoming, approved, hold, paid };
  }, [milestones]);

  const apply = async (m: MilestoneRow, status: MilestoneStatus) => {
    setBusy(m.key);
    try {
      await setMilestoneStatus(m.payrollRowId, m.milestoneId, status);
      toast.success(
        status === "Approved"
          ? `${m.label} approved — ready for execution.`
          : status === "Paid"
            ? `${m.label} marked as paid.`
            : status === "Hold"
              ? `${m.label} put on hold.`
              : `${m.label} reopened as pending.`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update the milestone.");
    } finally {
      setBusy(null);
    }
  };

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: "all", label: `All (${milestones.length})` },
    { key: "overdue", label: "Action Needed" },
    { key: "upcoming", label: "Upcoming" },
    { key: "approved", label: "Approved" },
    { key: "hold", label: "On Hold" },
    { key: "paid", label: "Paid" },
  ];

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-4 mb-6">
      <header className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold inline-flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" />
            {t("contractmilestonepayables.contract_payment_milestones")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every scheduled installment on committed {kind} contracts — actionable per milestone.
          </p>
        </div>
        <label className="ms-auto relative">
          <Search className="size-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("contractmilestonepayables.search_beneficiary_milestone_code")}
            className="ps-8 pe-3 py-1.5 text-xs rounded-lg bg-surface-2 border border-border outline-none focus:ring-2 ring-brand w-64 max-w-full"
          />
        </label>
        <button
          type="button"
          disabled={exporting || visible.length === 0}
          onClick={async () => {
            setExporting(true);
            try {
              await exportMilestonesXlsx(visible, kind);
              toast.success(`Exported ${visible.length} milestone rows to Excel.`);
            } catch (e: any) {
              toast.error(e?.message ?? "Could not export the milestones.");
            } finally {
              setExporting(false);
            }
          }}
          title={t("contractmilestonepayables.download_the_flattened_milestone_rows_as_an_excel")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-success/30 bg-success/10 text-success hover:bg-success/20 disabled:opacity-50"
        >
          <FileSpreadsheet className="size-3.5" />
          {exporting ? "Exporting…" : "Export to Excel"}
        </button>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
        <SummaryTile
          label="Overdue / Action Needed"
          value={totals.overdue}
          tone="text-destructive border-destructive/30 bg-destructive/10"
        />
        <SummaryTile
          label="Upcoming"
          value={totals.upcoming}
          tone="text-foreground border-border bg-surface-2"
        />
        <SummaryTile
          label="Approved (awaiting execution)"
          value={totals.approved}
          tone="text-info border-info/30 bg-info/10"
        />
        <SummaryTile
          label="On Hold"
          value={totals.hold}
          tone="text-warning border-warning/30 bg-warning/10"
        />
        <SummaryTile
          label="Paid"
          value={totals.paid}
          tone="text-success border-success/30 bg-success/10"
        />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
              filter === f.key
                ? "bg-brand/20 text-brand border-brand/40"
                : "bg-surface-2 text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-surface-2 text-muted-foreground text-[11px] uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-start">Beneficiary</th>
              <th className="px-3 py-2 text-start">Milestone</th>
              <th className="px-3 py-2 text-start">{t("contractmilestonepayables.due_date")}</th>
              <th className="px-3 py-2 text-end">Amount</th>
              <th className="px-3 py-2 text-start">Status</th>
              <th className="px-3 py-2 text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No contract milestones match this view. Add a payment schedule on an active {kind}{" "}
                  contract and it appears here instantly.
                </td>
              </tr>
            )}
            {visible.map((m) => {
              const tone = rowTone(m);
              return (
                <tr key={m.key} className={`border-t border-border transition ${tone.row}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{m.beneficiary}</div>
                    {(m.position || m.budgetCode) && (
                      <div className="text-[11px] text-muted-foreground">
                        {[m.position, m.budgetCode].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{m.label}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {m.dueDate || <span className="text-muted-foreground">—</span>}
                    {m.overdue && (
                      <span className="ms-1.5 inline-flex items-center gap-1 text-[10px] text-destructive">
                        <AlertTriangle className="size-3" /> due
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums font-semibold">
                    {formatUSD(m.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-md border text-[11px] font-semibold ${tone.badge}`}
                    >
                      {tone.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      {/* Maker: authorize the milestone — no documents required. */}
                      {m.status !== "Paid" && m.status !== "Approved" && (
                        <button
                          disabled={!canEdit || busy === m.key}
                          onClick={() => apply(m, "Approved")}
                          title={t(
                            "contractmilestonepayables.approve_this_milestone_for_payment_no_documents_required",
                          )}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-info/30 bg-info/10 text-info hover:bg-info/20 disabled:opacity-50"
                        >
                          <BadgeCheck className="size-3.5" /> Approve
                        </button>
                      )}
                      {/* Checker: execute the payment with mandatory proof. */}
                      {m.status === "Approved" && (
                        <button
                          disabled={!canEdit || busy === m.key}
                          onClick={() => setExecuting(m)}
                          title={t(
                            "contractmilestonepayables.execute_this_approved_payment_and_attach_proof_of",
                          )}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-success/30 bg-success/10 text-success hover:bg-success/20 disabled:opacity-50"
                        >
                          <Banknote className="size-3.5" />
                          {t("contractmilestonepayables.execute_payment")}
                        </button>
                      )}
                      {m.status !== "Hold" && m.status !== "Paid" && (
                        <button
                          disabled={!canEdit || busy === m.key}
                          onClick={() => apply(m, "Hold")}
                          title={t("contractmilestonepayables.put_this_milestone_on_hold")}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 disabled:opacity-50"
                        >
                          <PauseCircle className="size-3.5" /> Hold
                        </button>
                      )}
                      {m.status !== "Pending" && (
                        <button
                          disabled={!canEdit || busy === m.key}
                          onClick={() => apply(m, "Pending")}
                          title={t("contractmilestonepayables.reopen_this_milestone_as_pending")}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-border bg-surface-2 text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          <RotateCcw className="size-3.5" /> Reopen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!canEdit && (
        <p className="text-[11px] text-muted-foreground mt-2">
          {locked
            ? "Project is locked — milestone actions are read-only."
            : "You need the payments execution permission to change milestone status."}
        </p>
      )}

      {executing && (
        <ExecutePaymentModal
          milestone={executing}
          kind={kind}
          projectId={activeProjectId}
          onClose={() => setExecuting(null)}
          onDone={async (execution) => {
            setBusy(executing.key);
            try {
              await setMilestoneStatus(
                executing.payrollRowId,
                executing.milestoneId,
                "Paid",
                execution,
              );
              toast.success(`${executing.label} executed and marked as paid.`);
              setExecuting(null);
            } catch (e: any) {
              toast.error(e?.message ?? "Could not execute the payment.");
            } finally {
              setBusy(null);
            }
          }}
        />
      )}
    </section>
  );
}

/**
 * Checker step. Requires a proof-of-payment document before a milestone can
 * move from "Approved" to "Paid" — the file lands in the private `contracts`
 * bucket so it surfaces in the File Library under Proof of Payment.
 */
function ExecutePaymentModal({
  milestone,
  kind,
  projectId,
  onClose,
  onDone,
}: {
  milestone: MilestoneRow;
  kind: Kind;
  projectId: string | null;
  onClose: () => void;
  onDone: (execution: {
    proofPath: string;
    paidDate: string;
    paidRef: string | null;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();

  const [file, setFile] = useState<File | null>(null);
  const [paidDate, setPaidDate] = useState(todayIso());
  const [paidRef, setPaidRef] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast.error(
        t("contractmilestonepayables.proof_of_payment_is_mandatory_before_executing_this"),
      );
      return;
    }
    if (!projectId) {
      toast.error(t("contractmilestonepayables.an_active_project_is_required_to_execute_a"));
      return;
    }
    setSaving(true);
    try {
      const dot = file.name.lastIndexOf(".");
      const rawExt = dot > -1 ? file.name.slice(dot + 1) : "";
      const ext = rawExt
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 10)
        .toLowerCase();
      const path = `${projectId}/${kind}/${milestone.payrollRowId}/ledger-proof/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
      const { error } = await supabase.storage
        .from("contracts")
        .upload(path, file, { upsert: false });
      if (error) throw error;
      await onDone({ proofPath: path, paidDate, paidRef: paidRef.trim() || null });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to upload proof of payment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t("contractmilestonepayables.execute_payment_2")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
          <div className="font-semibold">{milestone.beneficiary}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {[milestone.label, milestone.budgetCode, milestone.dueDate].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-2 text-lg font-semibold tabular-nums">
            {formatUSD(milestone.amount)}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            <span className="block mb-1 text-muted-foreground">
              {t("contractmilestonepayables.payment_date")}
            </span>
            <DateInput
              value={paidDate}
              onChange={(v) => setPaidDate(v)}
              required
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border outline-none focus:ring-2 ring-brand"
            />
          </label>
          <label className="text-xs">
            <span className="block mb-1 text-muted-foreground">
              {t("contractmilestonepayables.bank_transfer_reference")}
            </span>
            <input
              value={paidRef}
              onChange={(e) => setPaidRef(e.target.value)}
              placeholder={t("contractmilestonepayables.eg_swift_iban_transfer_no")}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border outline-none focus:ring-2 ring-brand"
            />
          </label>
        </div>

        <label className="block text-xs">
          <span className="block mb-1 text-muted-foreground">
            {t("contractmilestonepayables.proof_of_payment")}
            <span className="text-destructive">(required)</span>
          </span>
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface-2 px-3 py-3">
            <Upload className="size-4 text-muted-foreground" />
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
          </div>
          {file && <div className="mt-1 text-[11px] text-success">Selected: {file.name}</div>}
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !file}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-success/30 bg-success/15 text-success hover:bg-success/25 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {saving ? "Recording…" : "Record payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${tone}`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="text-base font-semibold tabular-nums">{formatUSD(value)}</div>
    </div>
  );
}
