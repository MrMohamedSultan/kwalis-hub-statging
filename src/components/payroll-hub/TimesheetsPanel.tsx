import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Save,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Send,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import {
  CADENCE_LABEL,
  computeTimesheetTotal,
  daysBetween,
  eachDay,
  formatMoney,
  useRateCards,
  useScope,
  useTimesheets,
  type Cadence,
  type Timesheet,
  type TimesheetEntry,
  type TimesheetStatus,
} from "@/lib/payroll-hub";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { PayrollHubField as Field, payrollHubInput as inputCls } from "./RateCardsPanel";

import { useTranslation } from "react-i18next";
const STATUS_TONE: Record<TimesheetStatus, string> = {
  draft: "bg-muted/20 text-foreground border-border",
  submitted: "bg-warning/15 text-warning border-warning/40",
  approved: "bg-info/15 text-info border-info/40",
  posted: "bg-success/15 text-success border-success/40",
  rejected: "bg-destructive/15 text-destructive border-destructive/40",
};

export function TimesheetsPanel() {
  const { t } = useTranslation();

  const { projectId, organizationId } = useScope();
  const { rows, entriesBySheet, loading, refresh } = useTimesheets();
  const { rows: rateCards } = useRateCards();
  const people = useStore((s) => s.people);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!projectId) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {t("timesheetspanel.select_a_project_to_manage_timesheets")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Timesheets</h3>
          <p className="text-xs text-muted-foreground">
            Track days worked / OT hours per pay period. Approved timesheets are pulled into the
            next Bulk Payroll Run.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110"
        >
          <Plus className="size-3.5" />
          {t("timesheetspanel.new_timesheet")}
        </button>
      </div>

      {showForm && (
        <NewTimesheetForm
          projectId={projectId}
          organizationId={organizationId}
          rateCards={rateCards}
          people={people}
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
          {t("timesheetspanel.no_timesheets_yet")}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((sheet) => (
            <TimesheetRow
              key={sheet.id}
              sheet={sheet}
              entries={entriesBySheet[sheet.id] ?? []}
              expanded={expanded === sheet.id}
              onToggle={() => setExpanded((v) => (v === sheet.id ? null : sheet.id))}
              onChanged={refresh}
              peopleName={people.find((p) => p.id === sheet.person_id)?.fullName ?? "—"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TimesheetRow({
  sheet,
  entries,
  expanded,
  onToggle,
  onChanged,
  peopleName,
}: {
  sheet: Timesheet;
  entries: TimesheetEntry[];
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  peopleName: string;
}) {
  const { t } = useTranslation();

  const total = useMemo(
    () =>
      computeTimesheetTotal(
        entries,
        Number(sheet.base_rate),
        Number(sheet.overtime_rate),
        "day",
        daysBetween(sheet.period_start, sheet.period_end),
      ),
    [entries, sheet],
  );
  const daysWorked = entries.filter((e) => e.worked).length;
  const otHours = entries.reduce((a, e) => a + Number(e.ot_hours || 0), 0);

  const transitionStatus = async (next: TimesheetStatus, extra: Partial<Timesheet> = {}) => {
    const nowIso = new Date().toISOString();
    const patch: Partial<Timesheet> = {
      status: next,
      ...extra,
      ...(next === "submitted" ? { submitted_at: nowIso } : {}),
      ...(next === "approved" ? { approved_at: nowIso, gross_amount: total } : {}),
    };
    const { error } = await supabase.from("timesheets").update(patch).eq("id", sheet.id);
    if (error) toast.error(error.message);
    else {
      toast.success(`Timesheet ${next}`);
      onChanged();
    }
  };

  const reject = async () => {
    const reason = window.prompt("Reason for rejection (visible in timesheet notes):", "");
    if (reason == null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error(t("timesheetspanel.a_rejection_reason_is_required"));
      return;
    }
    const prevNotes = (sheet.notes ?? "").trim();
    const stamp = new Date().toISOString().slice(0, 10);
    const combined = prevNotes
      ? `${prevNotes}\n[${stamp}] Rejected: ${trimmed}`
      : `[${stamp}] Rejected: ${trimmed}`;
    await transitionStatus("rejected", { notes: combined });
  };

  return (
    <div className="rounded-xl border border-border bg-surface-2/40">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? (
            <ChevronDown className="size-4 shrink-0" />
          ) : (
            <ChevronRight className="size-4 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium truncate">{peopleName}</div>
            <div className="text-xs text-muted-foreground">
              {sheet.period_start} → {sheet.period_end} · {daysWorked} days · {otHours}h OT
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="tabular-nums font-semibold">{formatMoney(total, sheet.currency)}</span>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
              STATUS_TONE[sheet.status as TimesheetStatus] ?? STATUS_TONE.draft
            }`}
          >
            {sheet.status}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border p-4 space-y-3">
          <TimesheetDays sheet={sheet} entries={entries} onChanged={onChanged} />
          {sheet.notes ? (
            <div className="rounded-md border border-border bg-surface-2/60 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
              {sheet.notes}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {sheet.status === "draft" && (
              <button
                type="button"
                onClick={() => void transitionStatus("submitted")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-warning/40 bg-warning/10 text-xs font-semibold text-warning hover:bg-warning/20"
              >
                <Send className="size-3.5" />
                {t("timesheetspanel.submit_for_approval")}
              </button>
            )}
            {sheet.status === "submitted" && (
              <>
                <button
                  type="button"
                  onClick={() => void reject()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/40 bg-destructive/10 text-xs font-semibold text-destructive hover:bg-destructive/20"
                >
                  <XCircle className="size-3.5" /> Reject
                </button>
                <button
                  type="button"
                  onClick={() => void transitionStatus("approved")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-success/40 bg-success/10 text-xs font-semibold text-success hover:bg-success/20"
                >
                  <CheckCircle2 className="size-3.5" /> Approve
                </button>
              </>
            )}
            {sheet.status === "rejected" && (
              <button
                type="button"
                onClick={() =>
                  void transitionStatus("draft", {
                    submitted_at: null,
                    approved_at: null,
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-semibold hover:bg-muted"
              >
                <RotateCcw className="size-3.5" />
                {t("timesheetspanel.reopen_as_draft")}
              </button>
            )}
            {sheet.status === "approved" && (
              <span className="text-[11px] text-muted-foreground self-center">
                Approved — locked. Included in the next payroll run.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TimesheetDays({
  sheet,
  entries,
  onChanged,
}: {
  sheet: Timesheet;
  entries: TimesheetEntry[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();

  const locked = sheet.status !== "draft";
  const map = new Map(entries.map((e) => [e.work_date, e]));
  const dates = eachDay(sheet.period_start, sheet.period_end);

  const upsert = async (date: string, patch: Partial<TimesheetEntry>) => {
    const existing = map.get(date);
    if (existing) {
      const { error } = await supabase
        .from("timesheet_entries")
        .update(patch)
        .eq("id", existing.id);
      if (error) toast.error(error.message);
      else onChanged();
      return;
    }
    const { error } = await supabase.from("timesheet_entries").insert({
      timesheet_id: sheet.id,
      organization_id: sheet.organization_id,
      project_id: sheet.project_id,
      work_date: date,
      hours: 0,
      ot_hours: 0,
      worked: true,
      ...patch,
    });
    if (error) toast.error(error.message);
    else onChanged();
  };

  return (
    <div className="overflow-auto rounded-lg border border-border max-h-[360px]">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-surface sticky top-0">
          <tr>
            <th className="text-left py-2 px-3">Date</th>
            <th className="text-center py-2 px-3">Worked</th>
            <th className="text-right py-2 px-3">Hours</th>
            <th className="text-right py-2 px-3">{t("timesheetspanel.ot_hrs")}</th>
            <th className="text-left py-2 px-3">Notes</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => {
            const e = map.get(d);
            return (
              <tr key={d} className="border-t border-border">
                <td className="py-1.5 px-3 tabular-nums text-muted-foreground">{d}</td>
                <td className="py-1.5 px-3 text-center">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={e?.worked ?? true}
                    onChange={(ev) => void upsert(d, { worked: ev.target.checked })}
                  />
                </td>
                <td className="py-1.5 px-3">
                  <input
                    type="number"
                    step="0.25"
                    disabled={locked}
                    defaultValue={e?.hours ?? 0}
                    onBlur={(ev) => void upsert(d, { hours: Number(ev.target.value) || 0 })}
                    className="w-20 text-right rounded border border-border bg-surface-2 px-2 py-0.5"
                  />
                </td>
                <td className="py-1.5 px-3">
                  <input
                    type="number"
                    step="0.25"
                    disabled={locked}
                    defaultValue={e?.ot_hours ?? 0}
                    onBlur={(ev) => void upsert(d, { ot_hours: Number(ev.target.value) || 0 })}
                    className="w-20 text-right rounded border border-border bg-surface-2 px-2 py-0.5"
                  />
                </td>
                <td className="py-1.5 px-3">
                  <input
                    type="text"
                    disabled={locked}
                    defaultValue={e?.notes ?? ""}
                    onBlur={(ev) => void upsert(d, { notes: ev.target.value })}
                    className="w-full rounded border border-border bg-surface-2 px-2 py-0.5"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NewTimesheetForm({
  projectId,
  organizationId,
  rateCards,
  people,
  onClose,
  onSaved,
}: {
  projectId: string;
  organizationId: string | null;
  rateCards: ReturnType<typeof useRateCards>["rows"];
  people: ReturnType<typeof useStore.getState>["people"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  const [personId, setPersonId] = useState("");
  const [rateCardId, setRateCardId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [baseRate, setBaseRate] = useState("");
  const [otRate, setOtRate] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [saving, setSaving] = useState(false);

  const applyRateCard = (id: string) => {
    setRateCardId(id);
    const rc = rateCards.find((r) => r.id === id);
    if (rc) {
      setBaseRate(String(rc.base_rate));
      setOtRate(String(rc.overtime_rate));
      setCurrency(rc.currency);
      if (rc.person_id) setPersonId(rc.person_id);
    }
  };

  const save = async () => {
    if (!personId) return toast.error("Pick a person");
    if (!periodStart || !periodEnd) return toast.error("Set the period");
    setSaving(true);
    const { error } = await supabase.from("timesheets").insert({
      project_id: projectId,
      organization_id: organizationId,
      person_id: personId,
      rate_card_id: rateCardId || null,
      period_start: periodStart,
      period_end: periodEnd,
      base_rate: Number(baseRate) || 0,
      overtime_rate: Number(otRate) || 0,
      currency,
      status: "draft",
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t("timesheetspanel.timesheet_created"));
      onSaved();
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-2/50 p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Person">
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className={inputCls}
          >
            <option value="">— select —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.position || p.character || "—"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rate card (optional)">
          <select
            value={rateCardId}
            onChange={(e) => applyRateCard(e.target.value)}
            className={inputCls}
          >
            <option value="">— none —</option>
            {rateCards.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} · {CADENCE_LABEL[r.cadence as Cadence]}
              </option>
            ))}
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
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Period end">
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Base rate">
          <input
            type="number"
            value={baseRate}
            onChange={(e) => setBaseRate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Overtime rate">
          <input
            type="number"
            value={otRate}
            onChange={(e) => setOtRate(e.target.value)}
            className={inputCls}
          />
        </Field>
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
          <Save className="size-3.5" /> Create
        </button>
      </div>
    </div>
  );
}
