// Overtime tracking log.
// Actual overtime is calculated from the overtime_rate / overtime_unit saved on
// each contract (public.people) — the contract total itself is never touched.
import { formatDate } from "@/lib/date-format";
import { DateInput } from "@/components/ui/date-input";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  FileDown,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore, OVERTIME_UNIT_LABEL, normalizeDealType, type OvertimeUnit } from "@/lib/store";
import { formatMoney, useScope } from "@/lib/payroll-hub";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { downloadCSV } from "@/lib/export-csv";
import { exportPdfReport } from "@/lib/export-pdf";

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
type OvertimeStatus = "pending" | "approved" | "rejected" | "paid";

type OvertimeRow = {
  id: string;
  person_id: string | null;
  person_name: string;
  person_kind: string;
  work_date: string;
  units: number;
  overtime_rate: number;
  overtime_unit: OvertimeUnit;
  amount: number;
  adjustment: number | null;
  adjustment_reason: string | null;
  currency: string;
  budget_code: string | null;
  status: OvertimeStatus;
  approved_by: string | null;
  approved_at: string | null;
  payroll_run_id: string | null;
  notes: string | null;
};

/** Base (rate × units) before any manual adjustment. */
const baseAmount = (r: OvertimeRow) => Number(r.overtime_rate || 0) * Number(r.units || 0);

const STATUS_TONE: Record<OvertimeStatus, string> = {
  pending: "bg-warning/15 text-warning border-warning/40",
  approved: "bg-info/15 text-info border-info/40",
  rejected: "bg-destructive/15 text-destructive border-destructive/40",
  paid: "bg-success/15 text-success border-success/40",
};

export function OvertimeLogPanel() {
  const { t } = useTranslation();

  const { projectId, organizationId } = useScope();
  const people = useStore((s) => s.people);
  const [rows, setRows] = useState<OvertimeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Contracts of the active project that carry an overtime setup.
  const contracts = useMemo(
    () =>
      people
        .filter((p) => p.projectId === projectId)
        .map((p) => ({
          id: p.id,
          fullName: p.fullName,
          kind: p.kind,
          role: p.position || p.character || p.kind,
          dealType: normalizeDealType(p.dealType),
          rate: Number(p.overtimeRate ?? 0),
          unit: (p.overtimeUnit ?? "hour") as OvertimeUnit,
          ccy: p.ccy || "SAR",
          hasSetup: Number(p.overtimeRate ?? 0) > 0 && !!p.overtimeUnit,
        })),
    [people, projectId],
  );

  const [personId, setPersonId] = useState("");
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [units, setUnits] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [adjustment, setAdjustment] = useState<number>(0);
  const [adjustmentReason, setAdjustmentReason] = useState("");

  const selected = contracts.find((c) => c.id === personId) ?? null;
  const previewBase = selected ? Number(selected.rate) * Math.max(units, 0) : 0;
  const previewAmount = previewBase + (selected ? adjustment : 0);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRows([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("overtime_entries")
      .select("*")
      .eq("project_id", projectId)
      .order("work_date", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as unknown as OvertimeRow[]);
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Approval rights: only project approvers / finance / admins may approve overtime
  // (mirrors the server-side trigger, which is the real gate).
  const [canApprove, setCanApprove] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) return setCanApprove(false);
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { data } = await (supabase.rpc as any)("can_approve_payroll", {
        _uid: uid,
        _org: organizationId,
        _proj: projectId,
      });
      if (!cancelled) setCanApprove(Boolean(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, organizationId]);

  // Display names for approvers (audit trail).
  const [approverNames, setApproverNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = [...new Set(rows.map((r) => r.approved_by).filter(Boolean) as string[])];
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const p of (data ?? []) as { id: string; display_name: string | null }[]) {
        map[p.id] = p.display_name ?? p.id.slice(0, 8);
      }
      setApproverNames(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const totals = useMemo(() => {
    const byCcy: Record<
      string,
      Record<OvertimeStatus, number> & { units: number; base: number; adjustment: number }
    > = {};
    for (const r of rows) {
      const b = (byCcy[r.currency] ??= {
        pending: 0,
        approved: 0,
        rejected: 0,
        paid: 0,
        units: 0,
        base: 0,
        adjustment: 0,
      });
      b[r.status] += Number(r.amount || 0);
      b.units += Number(r.units || 0);
      b.base += baseAmount(r);
      b.adjustment += Number(r.adjustment || 0);
    }
    return byCcy;
  }, [rows]);

  /** Approved (and already paid) entries — the payable overtime log. */
  const approvedRows = useMemo(
    () => rows.filter((r) => r.status === "approved" || r.status === "paid"),
    [rows],
  );

  const approvedTotals = useMemo(() => {
    const byCcy: Record<
      string,
      { units: number; base: number; adjustment: number; total: number }
    > = {};
    for (const r of approvedRows) {
      const b = (byCcy[r.currency] ??= { units: 0, base: 0, adjustment: 0, total: 0 });
      b.units += Number(r.units || 0);
      b.base += baseAmount(r);
      b.adjustment += Number(r.adjustment || 0);
      b.total += Number(r.amount || 0);
    }
    return byCcy;
  }, [approvedRows]);

  const exportCsv = () => {
    if (approvedRows.length === 0)
      return toast.error(t("overtimelogpanel.no_approved_overtime_to_export"));
    const rowsOut: Record<string, string | number>[] = approvedRows.map((r) => ({
      Person: r.person_name,
      Type: r.person_kind,
      Date: r.work_date,
      Units: Number(r.units || 0),
      Unit: OVERTIME_UNIT_LABEL[r.overtime_unit] ?? r.overtime_unit,
      Rate: Number(r.overtime_rate || 0),
      "Calculated amount": +baseAmount(r).toFixed(2),
      "Adjustment (variance)": +Number(r.adjustment || 0).toFixed(2),
      "Actual amount": +Number(r.amount || 0).toFixed(2),
      Currency: r.currency,
      Status: r.status,
      Notes: r.notes ?? "",
      "Adjustment reason": r.adjustment_reason ?? "",
    }));
    for (const [ccy, t] of Object.entries(approvedTotals)) {
      rowsOut.push({
        Person: `TOTAL ${ccy}`,
        Type: "",
        Date: "",
        Units: +t.units.toFixed(2),
        Unit: "",
        Rate: 0,
        "Calculated amount": +t.base.toFixed(2),
        "Adjustment (variance)": +t.adjustment.toFixed(2),
        "Actual amount": +t.total.toFixed(2),
        Currency: ccy,
        Status: "",
        Notes: "",
        "Adjustment reason": "",
      });
    }
    downloadCSV(`overtime-approved-${new Date().toISOString().slice(0, 10)}`, rowsOut);
    toast.success(t("overtimelogpanel.csv_exported"));
  };

  const exportPdf = () => {
    if (approvedRows.length === 0)
      return toast.error(t("overtimelogpanel.no_approved_overtime_to_export"));
    const body = approvedRows.map((r) => [
      r.person_name,
      r.person_kind,
      r.work_date,
      Number(r.units || 0).toLocaleString(),
      `${formatMoney(Number(r.overtime_rate || 0), r.currency)} / ${
        OVERTIME_UNIT_LABEL[r.overtime_unit] ?? r.overtime_unit
      }`,
      formatMoney(baseAmount(r), r.currency),
      Number(r.adjustment || 0) === 0 ? "—" : formatMoney(Number(r.adjustment || 0), r.currency),
      formatMoney(Number(r.amount || 0), r.currency),
      r.status,
    ]);
    const totalRows = Object.entries(approvedTotals).map(([ccy, t]) => [
      `TOTAL ${ccy}`,
      "",
      "",
      t.units.toLocaleString(),
      "",
      formatMoney(t.base, ccy),
      formatMoney(t.adjustment, ccy),
      formatMoney(t.total, ccy),
      "",
    ]);
    exportPdfReport(
      `overtime-approved-${new Date().toISOString().slice(0, 10)}`,
      [
        {
          title: "Approved overtime log",
          subtitle: "Actual overtime = units × contract overtime rate, plus manual adjustments",
          headers: [
            "Person",
            "Type",
            "Date",
            "Units",
            "Rate / unit",
            "Calculated",
            "Variance",
            "Actual",
            "Status",
          ],
          rows: [...body, ...totalRows],
          numericColumns: [3, 5, 6, 7],
        },
      ],
      { documentTitle: "Approved overtime log" },
    );
    toast.success(t("overtimelogpanel.pdf_exported"));
  };

  if (!projectId) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {t("overtimelogpanel.select_a_project_to_track_overtime")}
      </div>
    );
  }

  const addEntry = async () => {
    if (!selected) return toast.error(t("overtimelogpanel.select_a_contract_first"));
    if (!selected.hasSetup) {
      return toast.error(
        `${selected.fullName} has no overtime rate/unit on their contract. Set it in the contract modal first.`,
      );
    }
    if (!workDate) return toast.error(t("overtimelogpanel.work_date_is_required"));
    if (!(units > 0))
      return toast.error(t("overtimelogpanel.overtime_units_must_be_greater_than_zero"));
    if (adjustment !== 0 && !adjustmentReason.trim()) {
      return toast.error(t("overtimelogpanel.add_a_reason_for_the_manual_adjustment"));
    }

    const total = +(selected.rate * units + adjustment).toFixed(2);
    setSaving(true);
    const { error } = await supabase.from("overtime_entries").insert({
      organization_id: organizationId,
      project_id: projectId,
      person_id: selected.id,
      person_name: selected.fullName,
      person_kind: selected.kind,
      work_date: workDate,
      units,
      overtime_rate: selected.rate,
      overtime_unit: selected.unit,
      amount: total,
      adjustment: +adjustment.toFixed(2),
      adjustment_reason: adjustmentReason.trim() || null,
      currency: selected.ccy,
      notes: notes.trim() || null,
      status: "pending",
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(
      `Logged ${units} ${OVERTIME_UNIT_LABEL[selected.unit].toLowerCase()}(s) · ${formatMoney(
        total,
        selected.ccy,
      )}`,
    );
    setUnits(0);
    setNotes("");
    setAdjustment(0);
    setAdjustmentReason("");
    void refresh();
  };

  const setStatus = async (row: OvertimeRow, status: OvertimeStatus) => {
    if (row.status === "paid")
      return toast.error(t("overtimelogpanel.paid_overtime_is_locked_it_was_settled_in"));
    if (status === "approved" && !canApprove) {
      return toast.error(
        t("overtimelogpanel.only_approvers_admin_line_producer_finance_can_approve"),
      );
    }

    const { error } = await supabase.from("overtime_entries").update({ status }).eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${status}`);
    void refresh();
  };

  const remove = async (row: OvertimeRow) => {
    if (!confirm(`Delete overtime entry for ${row.person_name} on ${row.work_date}?`)) return;
    const { error } = await supabase.from("overtime_entries").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success(t("overtimelogpanel.entry_deleted"));
    void refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            {t("overtimelogpanel.overtime_log")}
          </h3>
          <p className="text-xs text-muted-foreground">
            Actual overtime = units worked × the overtime rate saved on the contract, plus any
            manual adjustment. Rates and units are read from each contract's overtime setup and
            snapshotted per entry.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-semibold hover:bg-surface-2/70"
          >
            <FileDown className="size-4" />
            {t("overtimelogpanel.approved_csv")}
          </button>
          <button
            onClick={exportPdf}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-semibold hover:bg-surface-2/70"
          >
            <FileText className="size-4" />
            {t("overtimelogpanel.approved_pdf")}
          </button>
        </div>
      </div>

      {/* Entry form */}
      <div className="rounded-xl border border-border bg-surface-2/60 p-3 grid gap-3 md:grid-cols-5">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Contract
          </span>
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
          >
            <option value="">— select —</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName} · {c.role}
                {c.hasSetup
                  ? ` · ${c.rate}/${OVERTIME_UNIT_LABEL[c.unit].toLowerCase()}`
                  : " · no OT setup"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {t("overtimelogpanel.work_date")}
          </span>
          <DateInput
            value={workDate}
            onChange={(v) => setWorkDate(v)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Units{" "}
            {selected?.hasSetup ? `(${OVERTIME_UNIT_LABEL[selected.unit].toLowerCase()}s)` : ""}
          </span>
          <input
            type="number"
            min={0}
            step="0.25"
            value={units || ""}
            onChange={(e) => setUnits(+e.target.value || 0)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Calculated
          </span>
          <div
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-semibold tabular-nums"
            dir="ltr"
          >
            {selected ? formatMoney(previewAmount, selected.ccy) : "—"}
          </div>
          {selected && adjustment !== 0 && (
            <span className="text-[10px] text-muted-foreground" dir="ltr">
              {formatMoney(previewBase, selected.ccy)} {adjustment > 0 ? "+" : "−"}{" "}
              {formatMoney(Math.abs(adjustment), selected.ccy)}
            </span>
          )}
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {t("overtimelogpanel.adjustment_optional")}
          </span>
          <input
            type="number"
            step="0.01"
            value={adjustment || ""}
            onChange={(e) => setAdjustment(+e.target.value || 0)}
            placeholder="0.00"
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Adjustment reason {adjustment !== 0 ? "(required)" : ""}
          </span>
          <input
            value={adjustmentReason}
            onChange={(e) => setAdjustmentReason(e.target.value)}
            placeholder={t("overtimelogpanel.meal_penalty_rounding_agreed_uplift")}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Notes (optional)
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("overtimelogpanel.night_shoot_extended_unit_call")}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={addEntry}
          disabled={saving}
          className="self-end inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          <Plus className="size-4" /> {saving ? "Saving…" : "Log overtime"}
        </button>
      </div>

      {/* Totals */}
      {Object.keys(totals).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(totals).map(([ccy, t]) => (
            <div key={ccy} className="rounded-xl border border-border bg-surface-2/60 p-3 text-sm">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                {ccy} · {t.units.toLocaleString()} units
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending</span>
                <span className="tabular-nums">{formatMoney(t.pending, ccy)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {i18n.t("overtimelogpanel.approved_payable")}
                </span>
                <span className="tabular-nums">{formatMoney(t.approved, ccy)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rejected</span>
                <span className="tabular-nums">{formatMoney(t.rejected, ccy)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-muted-foreground">Paid</span>
                <span className="tabular-nums">{formatMoney(t.paid, ccy)}</span>
              </div>

              {t.adjustment !== 0 && (
                <div className="flex justify-between text-[11px] pt-1 border-t border-border mt-1">
                  <span className="text-muted-foreground">
                    {i18n.t("overtimelogpanel.variance_adjustments")}
                  </span>
                  <span className="tabular-nums" dir="ltr">
                    {formatMoney(t.adjustment, ccy)}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Log table */}
      {loading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          {t("overtimelogpanel.no_overtime_logged_yet_for_this_project")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-start px-3 py-2">Person</th>
                <th className="text-start px-3 py-2">Date</th>
                <th className="text-end px-3 py-2">Units</th>
                <th className="text-start px-3 py-2">{t("overtimelogpanel.rate_unit")}</th>
                <th className="text-end px-3 py-2">Calculated</th>
                <th className="text-end px-3 py-2">Variance</th>
                <th className="text-end px-3 py-2">Actual</th>
                <th className="text-start px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/40">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.person_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.person_kind}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDate(r.work_date) || r.work_date}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {Number(r.units).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" dir="ltr">
                    {formatMoney(Number(r.overtime_rate), r.currency)} /{" "}
                    {OVERTIME_UNIT_LABEL[r.overtime_unit] ?? r.overtime_unit}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                    {formatMoney(baseAmount(r), r.currency)}
                  </td>
                  <td
                    className="px-3 py-2 text-end tabular-nums"
                    dir="ltr"
                    title={r.adjustment_reason ?? ""}
                  >
                    {Number(r.adjustment || 0) === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      formatMoney(Number(r.adjustment), r.currency)
                    )}
                  </td>
                  <td className="px-3 py-2 text-end font-semibold tabular-nums" dir="ltr">
                    {formatMoney(Number(r.amount), r.currency)}
                  </td>

                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[r.status]}`}
                    >
                      {r.status}
                    </span>
                    {r.status === "paid" && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        via payroll run
                      </div>
                    )}
                    {r.approved_at && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        by{" "}
                        {r.approved_by
                          ? (approverNames[r.approved_by] ?? r.approved_by.slice(0, 8))
                          : "—"}{" "}
                        · {formatDate(r.approved_at)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {r.status === "pending" && (
                        <>
                          <button
                            onClick={() => setStatus(r, "approved")}
                            disabled={!canApprove}
                            title={
                              canApprove
                                ? "Approve — makes this overtime payable in payroll"
                                : "Requires approver / admin / finance role"
                            }
                            className="rounded-md border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <CheckCircle2 className="size-4 text-info" />
                          </button>
                          <button
                            onClick={() => setStatus(r, "rejected")}
                            title={t("overtimelogpanel.reject")}
                            className="rounded-md border border-border p-1.5 hover:bg-surface-2"
                          >
                            <XCircle className="size-4 text-destructive" />
                          </button>
                        </>
                      )}
                      {(r.status === "approved" || r.status === "rejected") && (
                        <button
                          onClick={() => setStatus(r, "pending")}
                          title={t("overtimelogpanel.return_to_pending")}
                          className="rounded-md border border-border p-1.5 hover:bg-surface-2"
                        >
                          <RotateCcw className="size-4 text-warning" />
                        </button>
                      )}
                      {r.status !== "paid" && (
                        <button
                          onClick={() => remove(r)}
                          title="Delete"
                          className="rounded-md border border-border p-1.5 hover:bg-surface-2"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
