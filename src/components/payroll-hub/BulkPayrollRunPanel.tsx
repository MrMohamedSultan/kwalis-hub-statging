import { formatDateTime, formatDate } from "@/lib/date-format";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { toast } from "sonner";
import {
  Plus,
  Save,
  Send,
  CheckCircle2,
  Rocket,
  ChevronDown,
  ChevronRight,
  Download,
  ShieldAlert,
  History,
  Clock,
  Undo2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import {
  RUN_STATUS_TONE,
  formatMoney,
  usePayrollRuns,
  useScope,
  useTimesheets,
  type PayrollRun,
  type PayrollRunItem,
  type PayrollRunStatus,
} from "@/lib/payroll-hub";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { PayrollHubField as Field, payrollHubInput as inputCls } from "./RateCardsPanel";
import { downloadCSV } from "@/lib/export-csv";
import { useCanExportPersonalData } from "@/lib/use-personal-export";
import { checkBudgetCodes, hasBlockingIssue, type MappingIssue } from "@/lib/budget-mapping-check";
import { BudgetMappingWarning } from "@/components/BudgetMappingWarning";

import { useTranslation } from "react-i18next";
type ApprovalEvent = {
  id: string;
  created_at: string;
  actor_email: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
};

/** An approved, not-yet-paid overtime entry available to a payroll run. */
type ApprovedOvertime = {
  id: string;
  person_id: string | null;
  person_name: string;
  person_kind: string;
  work_date: string;
  units: number;
  overtime_unit: string;
  overtime_rate: number;
  amount: number;
  currency: string;
  budget_code: string | null;
};

/** Aggregated overtime for one beneficiary — becomes a distinct payslip line. */
type OvertimeLine = {
  key: string;
  personId: string | null;
  personName: string;
  currency: string;
  budgetCode: string | null;
  units: number;
  amount: number;
  entryIds: string[];
  /** units logged per `rate|unit` bucket, used to render the payslip breakdown. */
  parts: Record<string, number>;
};

/** "5 hours @ 50.00/hour" style breakdown for an aggregated overtime line. */
function overtimeBreakdown(parts: Record<string, number>): string {
  return Object.entries(parts)
    .map(([k, units]) => {
      const [rate, unit] = k.split("|");
      return `${Number(units).toLocaleString()} ${unit}${Number(units) === 1 ? "" : "s"} @ ${Number(
        rate,
      ).toFixed(2)}/${unit}`;
    })
    .join(" + ");
}

export function BulkPayrollRunPanel() {
  const { t } = useTranslation();

  const { projectId, organizationId } = useScope();
  const { rows, itemsByRun, loading, refresh } = usePayrollRuns();
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!projectId) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {t("bulkpayrollrunpanel.select_a_project_to_run_payroll")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{t("bulkpayrollrunpanel.bulk_payroll_runs")}</h3>
          <p className="text-xs text-muted-foreground">
            Batch approved timesheets into a single payroll run. Posted runs push entries into the
            payroll ledger and Top Sheet.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110"
        >
          <Plus className="size-3.5" />
          {t("bulkpayrollrunpanel.new_run")}
        </button>
      </div>

      {showForm && (
        <NewRunForm
          projectId={projectId}
          organizationId={organizationId}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}

      {loading ? (
        <TableSkeleton rows={4} cols={6} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {t("bulkpayrollrunpanel.no_payroll_runs_yet")}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              items={itemsByRun[run.id] ?? []}
              expanded={expanded === run.id}
              onToggle={() => setExpanded((v) => (v === run.id ? null : run.id))}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  items,
  expanded,
  onToggle,
  onChanged,
}: {
  run: PayrollRun;
  items: PayrollRunItem[];
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();

  const gross = items.reduce((a, i) => a + Number(i.gross || 0), 0);
  const net = items.reduce((a, i) => a + Number(i.net || 0), 0);
  const wht = items.reduce((a, i) => a + Number(i.wht_amount || 0), 0);
  const [busy, setBusy] = useState(false);
  const people = useStore((s) => s.people);
  const [canApprove, setCanApprove] = useState<boolean>(false);
  const [events, setEvents] = useState<ApprovalEvent[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  // Budget Code mapping check for every line in this run — surfaced before
  // submit/approve/post so unmapped costs never slip into the ledger.
  const [mappingIssues, setMappingIssues] = useState<MappingIssue[]>([]);
  useEffect(() => {
    if (!expanded || items.length === 0) {
      setMappingIssues([]);
      return;
    }
    let cancelled = false;
    checkBudgetCodes(
      items.map((it) => ({
        subject: it.beneficiary_name ?? "Line",
        code: it.budget_code,
      })),
    )
      .then((res) => {
        if (!cancelled) setMappingIssues(res);
      })
      .catch(() => {
        if (!cancelled) setMappingIssues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, items]);
  const mappingBlocked = hasBlockingIssue(mappingIssues);

  const refreshEvents = useCallback(async () => {
    const { data } = await supabase
      .from("payroll_approval_events" as never)
      .select("*")
      .eq("payroll_run_id", run.id)
      .order("created_at", { ascending: false });
    setEvents((data as ApprovalEvent[] | null) ?? []);
  }, [run.id]);

  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents, run.status]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.rpc as any)("can_approve_payroll", {
        _uid: (await supabase.auth.getUser()).data.user?.id,
        _org: run.organization_id,
        _proj: run.project_id,
      });
      if (!cancelled) setCanApprove(Boolean(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [run.organization_id, run.project_id]);

  // IBAN / bank only for users allowed to export that contract's personal data
  const canExportPersonal = useCanExportPersonalData();
  const exportCsv = () => {
    if (items.length === 0) {
      toast.error(t("bulkpayrollrunpanel.no_items_to_export"));
      return;
    }
    const bankAllowed = items.map((it) =>
      canExportPersonal(people.find((p) => p.id === it.person_id)?.kind),
    );
    const withBank = bankAllowed.some(Boolean);
    const rows = items.map((it, idx) => {
      const person = people.find((p) => p.id === it.person_id);
      const iban = bankAllowed[idx] ? person?.iban || "" : "";
      const bank = bankAllowed[idx] ? person?.bank || "" : "";
      const row: Record<string, unknown> = {
        "#": idx + 1,
        Beneficiary: it.beneficiary_name ?? "",
        Role: it.role ?? person?.position ?? person?.character ?? "",
        Breakdown: it.notes ?? "",
        "Budget Code": it.budget_code ?? "",
        Cadence: it.cadence ?? "",
        Rate: Number(it.rate ?? 0),
        Units: Number(it.units ?? 0),
        Gross: Number(it.gross ?? 0),
        Allowances: Number(it.allowances ?? 0),
        Deductions: Number(it.deductions ?? 0),
        "WHT %": Number(it.wht_percent ?? 0),
        "WHT Amount": Number(it.wht_amount ?? 0),
        Net: Number(it.net ?? it.gross ?? 0),
        Currency: it.currency ?? run.currency,
      };
      if (withBank) Object.assign(row, { IBAN: iban, Bank: bank });
      return row;
    });
    const totalsRow = {
      "#": "",
      Beneficiary: "TOTAL",
      Role: "",
      Breakdown: "",
      "Budget Code": "",
      Cadence: "",
      Rate: "",
      Units: "",
      Gross: gross,
      Allowances: "",
      Deductions: "",
      "WHT %": "",
      "WHT Amount": wht,
      Net: net || gross,
      Currency: run.currency,
    } as Record<string, unknown>;
    if (withBank) Object.assign(totalsRow, { IBAN: "", Bank: "" });
    const safeLabel = (run.label || "payroll-run").replace(/[^\w-]+/g, "_");
    downloadCSV(`${safeLabel}_${run.period_start}_${run.period_end}.csv`, [
      ...rows,
      totalsRow,
    ] as Record<string, unknown>[]);
    toast.success(t("bulkpayrollrunpanel.payroll_run_exported"));
  };

  const transition = async (next: PayrollRunStatus) => {
    // Never let a run advance with missing / header-account budget mapping.
    const gate = await checkBudgetCodes(
      items.map((it) => ({
        subject: it.beneficiary_name ?? "Line",
        code: it.budget_code,
      })),
    );
    setMappingIssues(gate);
    if (hasBlockingIssue(gate)) {
      toast.error(
        `Budget Code mapping incomplete — ${
          gate.filter((i) => i.severity === "error").length
        } line(s) are unmapped or point at a Header Account. Fix the mapping before ${next === "posted" ? "posting" : next}.`,
      );
      return;
    }
    if (gate.length > 0) {
      const proceed = window.confirm(
        `Budget Code mapping warnings:\n\n${gate
          .map((i) => `• ${i.subject ? `${i.subject}: ` : ""}${i.message}`)
          .join("\n")}\n\nContinue to "${next}"?`,
      );
      if (!proceed) return;
    }
    setBusy(true);
    const nowIso = new Date().toISOString();
    const patch: {
      status: PayrollRunStatus;
      submitted_at?: string;
      approved_at?: string;
      posted_at?: string;
      gross_total: number;
      net_total: number;
      wht_total: number;
    } = {
      status: next,
      gross_total: gross,
      net_total: net || gross,
      wht_total: wht,
    };
    if (next === "submitted") patch.submitted_at = nowIso;
    if (next === "approved") patch.approved_at = nowIso;

    if (next === "posted") {
      // B21 — one payment path: posting never marks anything paid. The
      // database (post_payroll_run, db/pending/176) turns every line into an
      // instalment + a payment request on Payment Approvals, refuses timesheet
      // lines for people paid through contract instalments, and settles the
      // attached overtime so it cannot be put in another run.
      const { error: totalsErr } = await supabase
        .from("payroll_runs")
        .update({ gross_total: gross, net_total: net || gross, wht_total: wht })
        .eq("id", run.id);
      if (totalsErr) {
        toast.error(totalsErr.message);
        setBusy(false);
        return;
      }
      const { data, error: postErr } = await (supabase.rpc as any)("post_payroll_run", {
        _run: run.id,
      });
      setBusy(false);
      if (postErr) {
        toast.error(postErr.message);
        return;
      }
      const n = Number((data as { payment_requests?: number } | null)?.payment_requests ?? 0);
      toast.success(t("approvals.payroll.posted", { count: n }));
      onChanged();
      return;
    }

    const { error } = await supabase.from("payroll_runs").update(patch).eq("id", run.id);
    if (error) {
      toast.error(error.message);
      setBusy(false);
      return;
    }

    setBusy(false);
    toast.success(`Run ${next}`);
    onChanged();
  };

  /**
   * Reverse a posted run. All state changes (overtime back to approved+unpaid,
   * ledger rows marked unpaid, run back to cancelled, audit event) happen inside
   * one database function call, so they commit or roll back together.
   */
  const reverseRun = async () => {
    const reason = window.prompt(
      `Reverse "${run.label}"?\n\nApproved overtime goes back to approved (unpaid) and posted ledger entries are marked unpaid.\n\nReason (recorded in the audit trail):`,
      "",
    );
    if (reason === null) return;
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("reverse_payroll_run", {
      _run: run.id,
      _reason: reason,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const res = (data ?? {}) as { overtime_reverted?: number; ledger_unpaid?: number };
    toast.success(
      `Run reversed · ${res.overtime_reverted ?? 0} overtime entr${
        (res.overtime_reverted ?? 0) === 1 ? "y" : "ies"
      } restored, ${res.ledger_unpaid ?? 0} ledger row(s) marked unpaid`,
    );
    void refreshEvents();
    onChanged();
  };

  return (
    <div className="rounded-xl border border-border bg-surface-2/40">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-start hover:bg-muted"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? (
            <ChevronDown className="size-4 shrink-0" />
          ) : (
            <ChevronRight className="size-4 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium truncate">{run.label}</div>
            <div className="text-xs text-muted-foreground">
              {formatDate(run.period_start)} → {formatDate(run.period_end)} · {items.length} line
              {items.length === 1 ? "" : "s"} · {run.kind}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="tabular-nums font-semibold">{formatMoney(gross, run.currency)}</span>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
              RUN_STATUS_TONE[run.status as PayrollRunStatus] ?? RUN_STATUS_TONE.draft
            }`}
          >
            {run.status}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border p-4 space-y-3">
          <BudgetMappingWarning issues={mappingIssues} />
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("bulkpayrollrunpanel.no_items_in_this_run")}
            </p>
          ) : (
            <div className="overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-surface">
                  <tr>
                    <th className="text-start py-2 px-3">Beneficiary</th>
                    <th className="text-start py-2 px-3">Role</th>
                    <th className="text-start py-2 px-3">Budget</th>
                    <th className="text-end py-2 px-3">Gross</th>
                    <th className="text-end py-2 px-3">WHT</th>
                    <th className="text-end py-2 px-3">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t border-border">
                      <td className="py-1.5 px-3">{it.beneficiary_name}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">
                        {it.role ?? "—"}
                        {it.notes && (
                          <div className="text-[11px] text-muted-foreground/80" dir="ltr">
                            {it.notes} {it.currency ?? run.currency}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-muted-foreground">{it.budget_code ?? "—"}</td>
                      <td className="py-1.5 px-3 text-end tabular-nums">
                        {formatMoney(Number(it.gross), run.currency)}
                      </td>
                      <td className="py-1.5 px-3 text-end tabular-nums text-muted-foreground">
                        {formatMoney(Number(it.wht_amount || 0), run.currency)}
                      </td>
                      <td className="py-1.5 px-3 text-end tabular-nums font-medium">
                        {formatMoney(Number(it.net || it.gross), run.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAudit((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-semibold hover:bg-muted"
              title={t("bulkpayrollrunpanel.show_approval_audit_trail")}
            >
              <History className="size-3.5" />
              Audit trail{events.length ? ` (${events.length})` : ""}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={items.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
              title={t("bulkpayrollrunpanel.export_payroll_run_to_csv_for_banking_reporting")}
            >
              <Download className="size-3.5" /> Export CSV
            </button>
            {run.status === "draft" && (
              <button
                type="button"
                disabled={busy || mappingBlocked}
                onClick={() => void transition("submitted")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-warning/40 bg-warning/10 text-xs font-semibold text-warning hover:bg-warning/20 disabled:opacity-50"
              >
                <Send className="size-3.5" /> Submit
              </button>
            )}
            {run.status === "submitted" && (
              <button
                type="button"
                disabled={busy || !canApprove || mappingBlocked}
                onClick={() => void transition("approved")}
                title={
                  canApprove ? "Approve payroll run" : "Requires approver / admin / finance role"
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-info/40 bg-info/10 text-xs font-semibold text-info hover:bg-info/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {canApprove ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <ShieldAlert className="size-3.5" />
                )}
                Approve
              </button>
            )}
            {run.status === "approved" && (
              <button
                type="button"
                disabled={busy || !canApprove || mappingBlocked}
                onClick={() => void transition("posted")}
                title={canApprove ? "Post to ledger" : "Requires approver / admin / finance role"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-success/40 bg-success/10 text-xs font-semibold text-success hover:bg-success/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {canApprove ? (
                  <Rocket className="size-3.5" />
                ) : (
                  <ShieldAlert className="size-3.5" />
                )}
                Post to ledger
              </button>
            )}
            {run.status === "posted" && (
              <button
                type="button"
                disabled={busy || !canApprove}
                onClick={() => void reverseRun()}
                title={
                  canApprove
                    ? "Reverse this posted run — overtime returns to approved (unpaid) and ledger entries are marked unpaid"
                    : "Requires approver / admin / finance role"
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/40 bg-destructive/10 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {canApprove ? <Undo2 className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
                Reverse payroll run
              </button>
            )}
          </div>
          {run.status === "submitted" && !canApprove && (
            <div className="text-[11px] text-warning flex items-center gap-1 justify-end">
              <ShieldAlert className="size-3" />
              {t("bulkpayrollrunpanel.you_dont_have_approval_rights_on_this_project")}
            </div>
          )}
          {showAudit && (
            <div className="mt-2 rounded-lg border border-border bg-surface-2/60 overflow-hidden">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border">
                {t("bulkpayrollrunpanel.approval_audit_trail")}
              </div>
              {events.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  {t("bulkpayrollrunpanel.no_transitions_recorded_yet")}
                </div>
              ) : (
                <ol className="divide-y divide-border">
                  {events.map((ev) => (
                    <li
                      key={ev.id}
                      className="px-3 py-2 text-xs flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold">
                          {ev.from_status ?? "—"} → {ev.to_status ?? ev.action}
                        </div>
                        <div className="text-muted-foreground truncate">
                          {ev.actor_email ?? "system"}
                          {ev.note ? ` — ${ev.note}` : ""}
                        </div>
                      </div>
                      <time className="text-muted-foreground shrink-0">
                        {formatDateTime(ev.created_at)}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewRunForm({
  projectId,
  organizationId,
  onClose,
  onSaved,
}: {
  projectId: string;
  organizationId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"crew" | "cast" | "vendor" | "mixed">("crew");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [payDate, setPayDate] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [saving, setSaving] = useState(false);

  const { rows: sheets, entriesBySheet } = useTimesheets();
  const people = useStore((s) => s.people);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const eligible = useMemo(
    () =>
      sheets.filter(
        (s) =>
          s.status === "approved" &&
          (!periodStart || s.period_end >= periodStart) &&
          (!periodEnd || s.period_start <= periodEnd),
      ),
    [sheets, periodStart, periodEnd],
  );

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const s of eligible) next[s.id] = true;
    setSelected(next);
  }, [eligible]);

  // ── Approved, unpaid overtime available for this run ────────────────────
  const [otRows, setOtRows] = useState<ApprovedOvertime[]>([]);
  const [otSelected, setOtSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("overtime_entries")
        .select(
          "id, person_id, person_name, person_kind, work_date, units, overtime_unit, overtime_rate, amount, currency, budget_code",
        )
        .eq("project_id", projectId)
        .eq("status", "approved")
        .is("payroll_run_id", null)
        .order("work_date", { ascending: true });
      if (cancelled) return;
      if (error) {
        setOtRows([]);
        return;
      }
      setOtRows((data ?? []) as unknown as ApprovedOvertime[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /** Approved overtime inside the run period and matching the run kind. */
  const eligibleOvertime = useMemo(
    () =>
      otRows.filter(
        (o) =>
          (!periodStart || o.work_date >= periodStart) &&
          (!periodEnd || o.work_date <= periodEnd) &&
          (kind === "mixed" || o.person_kind === kind),
      ),
    [otRows, periodStart, periodEnd, kind],
  );

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const o of eligibleOvertime) next[o.id] = true;
    setOtSelected(next);
  }, [eligibleOvertime]);

  /** One aggregated "Approved overtime" line per person + currency. */
  const overtimeLines = useMemo(() => {
    const map = new Map<string, OvertimeLine>();
    for (const o of eligibleOvertime) {
      if (!otSelected[o.id]) continue;
      const key = `${o.person_id ?? o.person_name}|${o.currency}`;
      const line: OvertimeLine = map.get(key) ?? {
        key,
        personId: o.person_id,
        personName: o.person_name,
        currency: o.currency,
        budgetCode: o.budget_code,
        units: 0,
        amount: 0,
        entryIds: [] as string[],
        parts: {},
      };
      line.units += Number(o.units || 0);
      line.amount += Number(o.amount || 0);
      line.entryIds.push(o.id);
      const bucket = `${Number(o.overtime_rate || 0)}|${o.overtime_unit}`;
      line.parts[bucket] = (line.parts[bucket] ?? 0) + Number(o.units || 0);
      line.budgetCode = line.budgetCode ?? o.budget_code;
      map.set(key, line);
    }
    return [...map.values()];
  }, [eligibleOvertime, otSelected]);

  const save = async () => {
    if (!label.trim()) return toast.error(t("bulkpayrollrunpanel.label_is_required"));
    if (!periodStart || !periodEnd) return toast.error(t("bulkpayrollrunpanel.set_the_period"));
    setSaving(true);

    const { data: run, error } = await supabase
      .from("payroll_runs")
      .insert({
        project_id: projectId,
        organization_id: organizationId,
        label: label.trim(),
        kind,
        period_start: periodStart,
        period_end: periodEnd,
        pay_date: payDate || null,
        currency,
        status: "draft",
      })
      .select("*")
      .single();

    if (error || !run) {
      setSaving(false);
      toast.error(error?.message ?? "Failed to create run");
      return;
    }

    const chosen = eligible.filter((s) => selected[s.id]);
    if (chosen.length > 0) {
      const items = chosen.map((s) => {
        const person = people.find((p) => p.id === s.person_id);
        const gross = Number(s.gross_amount || 0);
        return {
          payroll_run_id: run.id,
          organization_id: organizationId,
          project_id: projectId,
          person_id: s.person_id,
          timesheet_id: s.id,
          beneficiary_name: person?.fullName ?? "—",
          role: person?.position || person?.character || null,
          cadence: "day",
          rate: Number(s.base_rate || 0),
          units: 0,
          gross,
          allowances: 0,
          deductions: 0,
          wht_percent: 0,
          wht_amount: 0,
          net: gross,
          currency: s.currency,
          budget_code: null,
        };
      });
      const { error: e2 } = await supabase.from("payroll_run_items").insert(items);
      if (e2) toast.error(`Run created, items failed: ${e2.message}`);
    }

    // Approved overtime rides along as its own line per beneficiary — the base
    // deal calculation above is never modified.
    if (overtimeLines.length > 0) {
      const otItems = overtimeLines.map((l) => ({
        payroll_run_id: run.id,
        organization_id: organizationId,
        project_id: projectId,
        person_id: l.personId,
        beneficiary_name: l.personName,
        role: "Approved overtime",
        cadence: "milestone" as const,
        rate: l.units > 0 ? +(l.amount / l.units).toFixed(2) : 0,
        units: l.units,
        gross: +l.amount.toFixed(2),
        allowances: 0,
        deductions: 0,
        wht_percent: 0,
        wht_amount: 0,
        net: +l.amount.toFixed(2),
        currency: l.currency,
        budget_code: l.budgetCode,
        notes: overtimeBreakdown(l.parts),
      }));
      const { error: e3 } = await supabase.from("payroll_run_items").insert(otItems);
      if (e3) {
        toast.error(`Run created, overtime lines failed: ${e3.message}`);
      } else {
        const ids = overtimeLines.flatMap((l) => l.entryIds);
        const { error: e4 } = await supabase
          .from("overtime_entries")
          .update({ payroll_run_id: run.id })
          .in("id", ids);
        if (e4) toast.error(`Overtime added but not locked to the run: ${e4.message}`);
      }
    }

    setSaving(false);
    toast.success(
      overtimeLines.length > 0
        ? `Run created · ${overtimeLines.length} approved-overtime line${overtimeLines.length === 1 ? "" : "s"} attached`
        : "Run created",
    );
    onSaved();
  };

  return (
    <div className="rounded-xl border border-border bg-surface-2/50 p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Run label">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("bulkpayrollrunpanel.week_12_crew")}
            className={inputCls}
          />
        </Field>
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "crew" | "cast" | "vendor" | "mixed")}
            className={inputCls}
          >
            <option value="crew">Crew</option>
            <option value="cast">Cast</option>
            <option value="vendor">Vendors</option>
            <option value="mixed">Mixed</option>
          </select>
        </Field>
        <Field label="Currency">
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className={inputCls}
          />
        </Field>
        <Field label="Period start">
          <DateInput value={periodStart} onChange={(v) => setPeriodStart(v)} className={inputCls} />
        </Field>
        <Field label="Period end">
          <DateInput value={periodEnd} onChange={(v) => setPeriodEnd(v)} className={inputCls} />
        </Field>
        <Field label="Pay date">
          <DateInput value={payDate} onChange={(v) => setPayDate(v)} className={inputCls} />
        </Field>
      </div>

      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Eligible approved timesheets ({eligible.length})
        </div>
        {eligible.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("bulkpayrollrunpanel.no_approved_timesheets_in_this_range")}
          </p>
        ) : (
          <div className="rounded-lg border border-border max-h-56 overflow-auto">
            {eligible.map((s) => {
              const person = people.find((p) => p.id === s.person_id);
              const daysWorked = (entriesBySheet[s.id] ?? []).filter((e) => e.worked).length;
              return (
                <label
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-0 hover:bg-muted cursor-pointer text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={!!selected[s.id]}
                      onChange={(e) =>
                        setSelected((v) => ({
                          ...v,
                          [s.id]: e.target.checked,
                        }))
                      }
                    />
                    <span className="truncate">
                      {person?.fullName ?? "—"}{" "}
                      <span className="text-muted-foreground">
                        · {formatDate(s.period_start)} → {formatDate(s.period_end)} · {daysWorked}d
                      </span>
                    </span>
                  </div>
                  <span className="tabular-nums text-xs">
                    {formatMoney(Number(s.gross_amount || 0), s.currency)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Clock className="size-3.5" /> Approved overtime ({eligibleOvertime.length})
        </div>
        {eligibleOvertime.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No approved, unpaid overtime for this period. Only entries approved in the Overtime log
            are payable.
          </p>
        ) : (
          <>
            <div className="rounded-lg border border-border max-h-56 overflow-auto">
              {eligibleOvertime.map((o) => (
                <label
                  key={o.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-0 hover:bg-muted cursor-pointer text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={!!otSelected[o.id]}
                      onChange={(e) => setOtSelected((v) => ({ ...v, [o.id]: e.target.checked }))}
                    />
                    <span className="truncate">
                      {o.person_name}{" "}
                      <span className="text-muted-foreground">
                        · {formatDate(o.work_date)} · {Number(o.units).toLocaleString()}{" "}
                        {o.overtime_unit}(s)
                      </span>
                    </span>
                  </div>
                  <span className="tabular-nums text-xs">
                    {formatMoney(Number(o.amount || 0), o.currency)}
                  </span>
                </label>
              ))}
            </div>
            {overtimeLines.length > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Adds {overtimeLines.length} "Approved overtime" line
                {overtimeLines.length === 1 ? "" : "s"} on top of the base contract amounts. These
                entries are marked paid when the run is posted.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 disabled:opacity-50"
        >
          <Save className="size-3.5" />
          {t("bulkpayrollrunpanel.create_run")}
        </button>
      </div>
    </div>
  );
}
