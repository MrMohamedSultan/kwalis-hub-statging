// Add forms for Company Overhead: a company employee (E04 — also opened from
// "New contract" on Crew / Cast when the person is a company employee) and
// an office rent / equipment share (R25).
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { useCostReportRows } from "@/lib/cost-report";
import { monthsBetween } from "@/features/reports/live-balance/live-balance";
import { allocatedCost } from "./overhead-calc";
import { useOverheadMutations, type ItemInput } from "./overhead-data";

const fieldCls = "flex flex-col gap-1 text-xs text-muted-foreground";
const selectCls = "h-9 rounded-md border border-border bg-input ps-2 pe-8 text-sm text-foreground";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={fieldCls}>
      {label}
      {children}
    </label>
  );
}

function useActiveIds() {
  const projectId = useStore((s) => s.activeProjectId);
  const orgId = useStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.organizationId ?? null,
  );
  return { projectId, orgId };
}

/** Budget line picker: optional; empty = "unbudgeted". */
function BudgetCodeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const { projectId } = useActiveIds();
  const q = useCostReportRows(projectId);
  const codes = useMemo(
    () =>
      Array.from(
        new Map(
          (q.data ?? [])
            .filter((r) => r.budgetCode && r.budget > 0)
            .map((r) => [r.budgetCode!, r.description ?? ""]),
        ).entries(),
      ).sort((a, b) => a[0].localeCompare(b[0])),
    [q.data],
  );
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      <option value="">{t("taxlive.oh.unbudgeted")}</option>
      {codes.map(([c, d]) => (
        <option key={c} value={c}>
          {c} {d}
        </option>
      ))}
    </select>
  );
}

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function CompanyEmployeeDialog({
  open,
  onClose,
  defaultName = "",
}: {
  open: boolean;
  onClose: () => void;
  defaultName?: string;
}) {
  const { t } = useTranslation();
  const { projectId, orgId } = useActiveIds();
  const m = useOverheadMutations(projectId, orgId);
  const [f, setF] = useState({
    name: defaultName,
    position: "",
    monthly: "",
    alloc: "100",
    start: "",
    end: "",
    code: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const months = f.start && f.end ? monthsBetween(f.start, f.end) : 0;
  const preview = allocatedCost(Number(f.monthly) || 0, Number(f.alloc) || 0, months);
  const submit = async () => {
    setBusy(true);
    try {
      await m.addStaff({
        employee_name: f.name,
        position: f.position,
        monthly_cost: Number(f.monthly),
        allocation_pct: Number(f.alloc),
        start_date: f.start,
        end_date: f.end,
        budget_code: f.code,
        notes: f.notes,
      });
      toast.success(t("taxlive.oh.saved"));
      onClose();
    } catch (e: any) {
      toast.error(
        e?.issues ? t("taxlive.oh.invalid") : (e?.message ?? t("taxlive.common.saveFailed")),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("taxlive.oh.addEmployee")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("taxlive.oh.employeeHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("taxlive.oh.col.name")}>
            <Input value={f.name} maxLength={200} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label={t("taxlive.oh.col.position")}>
            <Input
              value={f.position}
              maxLength={200}
              onChange={(e) => set("position", e.target.value)}
            />
          </Field>
          <Field label={t("taxlive.oh.col.monthlyCost")}>
            <Input
              type="number"
              min="0"
              step="0.01"
              dir="ltr"
              value={f.monthly}
              onChange={(e) => set("monthly", e.target.value)}
            />
          </Field>
          <Field label={t("taxlive.oh.col.allocation")}>
            <Input
              type="number"
              min="1"
              max="100"
              step="0.01"
              dir="ltr"
              value={f.alloc}
              onChange={(e) => set("alloc", e.target.value)}
            />
          </Field>
          <Field label={t("taxlive.oh.col.start")}>
            <Input type="date" value={f.start} onChange={(e) => set("start", e.target.value)} />
          </Field>
          <Field label={t("taxlive.oh.col.end")}>
            <Input type="date" value={f.end} onChange={(e) => set("end", e.target.value)} />
          </Field>
          <Field label={t("taxlive.oh.col.budgetLine")}>
            <BudgetCodeSelect value={f.code} onChange={(v) => set("code", v)} />
          </Field>
          <Field label={t("taxlive.oh.col.notes")}>
            <Input
              value={f.notes}
              maxLength={2000}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("taxlive.oh.preview", { months: months.toFixed(2), amount: preview.toFixed(2) })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !f.name.trim() || !f.monthly || !f.start || !f.end}
            onClick={() => void submit()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground disabled:opacity-50"
          >
            {t("taxlive.common.save")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OverheadItemDialog({
  open,
  kind,
  onClose,
}: {
  open: boolean;
  kind: "office_rent" | "equipment";
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { projectId, orgId } = useActiveIds();
  const m = useOverheadMutations(projectId, orgId);
  const [f, setF] = useState({
    label: "",
    basis: "monthly" as ItemInput["basis"],
    monthly: "",
    pct: "",
    alloc: "100",
    start: "",
    end: "",
    code: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const submit = async () => {
    setBusy(true);
    try {
      await m.addItem({
        kind,
        label: f.label,
        basis: f.basis,
        monthly_amount: f.basis === "monthly" ? numOrNull(f.monthly) : null,
        pct_of_budget: f.basis === "pct_budget" ? numOrNull(f.pct) : null,
        allocation_pct: Number(f.alloc),
        start_date: f.start || null,
        end_date: f.end || null,
        budget_code: f.code,
        notes: f.notes,
      });
      toast.success(t("taxlive.oh.saved"));
      onClose();
    } catch (e: any) {
      toast.error(
        e?.issues ? t("taxlive.oh.invalid") : (e?.message ?? t("taxlive.common.saveFailed")),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(`taxlive.oh.add.${kind}`)}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("taxlive.oh.col.label")}>
            <Input value={f.label} maxLength={200} onChange={(e) => set("label", e.target.value)} />
          </Field>
          <Field label={t("taxlive.oh.col.basis")}>
            <select
              value={f.basis}
              onChange={(e) => set("basis", e.target.value)}
              className={selectCls}
            >
              <option value="monthly">{t("taxlive.oh.basis.monthly")}</option>
              <option value="pct_budget">{t("taxlive.oh.basis.pct_budget")}</option>
            </select>
          </Field>
          {f.basis === "monthly" ? (
            <>
              <Field label={t("taxlive.oh.col.monthlyAmount")}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  dir="ltr"
                  value={f.monthly}
                  onChange={(e) => set("monthly", e.target.value)}
                />
              </Field>
              <Field label={t("taxlive.oh.col.allocation")}>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  step="0.01"
                  dir="ltr"
                  value={f.alloc}
                  onChange={(e) => set("alloc", e.target.value)}
                />
              </Field>
              <Field label={t("taxlive.oh.col.start")}>
                <Input type="date" value={f.start} onChange={(e) => set("start", e.target.value)} />
              </Field>
              <Field label={t("taxlive.oh.col.end")}>
                <Input type="date" value={f.end} onChange={(e) => set("end", e.target.value)} />
              </Field>
            </>
          ) : (
            <Field label={t("taxlive.oh.col.pctOfBudget")}>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.001"
                dir="ltr"
                value={f.pct}
                onChange={(e) => set("pct", e.target.value)}
              />
            </Field>
          )}
          <Field label={t("taxlive.oh.col.budgetLine")}>
            <BudgetCodeSelect value={f.code} onChange={(v) => set("code", v)} />
          </Field>
          <Field label={t("taxlive.oh.col.notes")}>
            <Input
              value={f.notes}
              maxLength={2000}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !f.label.trim()}
            onClick={() => void submit()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground disabled:opacity-50"
          >
            {t("taxlive.common.save")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
