import { formatDate } from "@/lib/date-format";
import { createFileRoute } from "@tanstack/react-router";
import { formatAmount } from "@/lib/format-number";
import { assertUploadAllowed, safeStorageName } from "@/lib/upload-policy";
import { storageAudited } from "@/lib/storage-audit";
import { CurrencySymbol } from "@/components/ui/currency";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { useStore, formatUSD, paidPayrollAmount, hasMissingProof } from "@/lib/store";
import { STATUS_TONE, type Status } from "@/lib/data";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Paperclip, Calendar, FileCheck2, Upload, Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { PayrollRow } from "@/lib/store";
import { useServerFn } from "@tanstack/react-start";
import { recordAudit } from "@/lib/audit-log";
import {
  listMyOrganizations,
  listPayrollPayments,
  importPayrollPayments,
  deletePayrollPayment,
} from "@/lib/payroll-payments.functions";
import {
  parsePayrollTemplate,
  downloadPayrollTemplate,
  type PayrollPreview,
  type PayrollKind,
} from "@/lib/payrollImport";
import { useCan } from "@/lib/rbac";
import { useCanExportPersonalData } from "@/lib/use-personal-export";
import { usePermissionCheck, PermissionDeniedBanner } from "@/lib/permission-guard";
import { useGlAccounts } from "@/lib/gl-accounts";
import { useSupportingDocUrl, useSupportingDocsSync } from "@/lib/supporting-docs";
import { SupportingDocField } from "@/components/SupportingDocField";
import { AuditHistoryPanel } from "@/components/AuditHistoryPanel";
import { useLedgerSync } from "@/lib/ledger-sync";
import { contractHousingTotal, activeDaysForPerson } from "@/lib/housing";

type PayrollSearch = { kind?: "vendor" | "crew" | "cast" };

export const Route = createFileRoute("/_authenticated/payroll")({
  validateSearch: (s: Record<string, unknown>): PayrollSearch => {
    const k = s.kind;
    return { kind: k === "vendor" || k === "crew" || k === "cast" ? k : undefined };
  },
  component: () => (
    <AppShell>
      <PayrollPage />
    </AppShell>
  ),
});

type EditTarget = { rowId: string; idx: number } | null;

function PayrollPage() {
  useSupportingDocsSync(useStore((st) => st.activeProjectId)); // D08
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: "vendor" | "crew" | "cast" = search.kind ?? "cast";
  const setTab = (k: "vendor" | "crew" | "cast") =>
    navigate({ search: { kind: k }, replace: true });
  const [selected, setSelected] = useState<PayrollRow | null>(null);
  const [editing, setEditing] = useState<EditTarget>(null);

  const tabLabel = (k: "vendor" | "crew" | "cast") =>
    k === "vendor"
      ? t("nav.vendors", { defaultValue: "Vendors" })
      : k === "crew"
        ? t("nav.crewPayroll", { defaultValue: "طاقم العمل" })
        : t("nav.castPayroll", { defaultValue: "طاقم التمثيل" });

  return (
    <>
      <PageTitle title={t("nav.payroll")} />

      <div className="inline-flex gap-1 mb-5 p-1 rounded-full bg-surface border border-border">
        {(["cast", "crew", "vendor"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-6 py-2 rounded-full text-sm font-semibold capitalize transition ${
              tab === k
                ? "bg-brand text-brand-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tabLabel(k)}
          </button>
        ))}
      </div>

      <PayrollLedgerPanel kind={tab} />

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-background border-l border-border">
          {selected &&
            (selected.kind === "vendor" ? (
              <VendorDrawer
                row={selected}
                onEdit={(idx) => setEditing({ rowId: selected.id, idx })}
              />
            ) : (
              <PersonDrawer
                row={selected}
                onEdit={(idx) => setEditing({ rowId: selected.id, idx })}
              />
            ))}
        </SheetContent>
      </Sheet>

      <PaymentEditDialog target={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function PaymentBadge({
  status,
  hasReceipt,
  onClick,
}: {
  status: Status;
  hasReceipt: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition hover:scale-105 ${STATUS_TONE[status]}`}
    >
      {status}
      {hasReceipt && <FileCheck2 className="size-3.5" />}
    </button>
  );
}

function PaymentEditDialog({ target, onClose }: { target: EditTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const row = useStore((s) => (target ? s.payroll.find((r) => r.id === target.rowId) : null));
  const updatePayment = useStore((s) => s.updatePayment);
  const updatePayrollGlAccount = useStore((s) => s.updatePayrollGlAccount);
  const { rows: glAccounts } = useGlAccounts();
  const can = useCan();
  const { requireOrToast } = usePermissionCheck();
  const idx = target?.idx ?? 0;
  const currentStatus = row?.payments[idx] ?? "Upcoming";
  const currentReceipt = row?.receipts?.[idx] ?? null;
  const currentGl = row?.glAccountId ?? null;

  const [status, setStatus] = useState<Status>(currentStatus);
  const [glAccountId, setGlAccountId] = useState<string | null>(currentGl);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const canExecute = can("payroll.execute");
  const canApprove = can("payroll.approve");

  // reset when target changes
  const key = target ? `${target.rowId}-${target.idx}` : "";
  const [lastKey, setLastKey] = useState("");
  if (key !== lastKey) {
    setLastKey(key);
    setStatus(currentStatus);
    setGlAccountId(currentGl);
    setFile(null);
  }

  const handleViewReceipt = async () => {
    if (!currentReceipt) return;
    const { data, error } = await storageAudited
      .from("contracts")
      .createSignedUrl(currentReceipt, 60);
    if (error || !data) return toast.error("Could not open receipt");
    window.open(data.signedUrl, "_blank");
  };

  const handleSave = async () => {
    if (!target || !row) return;
    // Marking Paid requires approve authority; recording/uploading requires execute.
    if (status === "Paid" && status !== currentStatus) {
      if (!requireOrToast("payroll.approve", "approve payroll payments")) return;
    }
    if (file || status !== currentStatus) {
      if (!requireOrToast("payroll.execute", "execute & record payroll payments")) return;
    }
    setSaving(true);
    try {
      let receiptPath: string | null | undefined = undefined;
      if (file) {
        assertUploadAllowed(file);
        // X06: under the project folder so project-scoped storage policies apply.
        const pid = useStore.getState().activeProjectId;
        const path = `${pid ? `${pid}/` : ""}payroll/${row.id}/${target.idx}/${Date.now()}-${safeStorageName(file.name)}`;
        const { error } = await storageAudited
          .from("contracts")
          .upload(path, file, { upsert: false });
        if (error) throw error;
        receiptPath = path;
      }
      await updatePayment(row.id, target.idx, {
        status,
        ...(receiptPath !== undefined ? { receipt: receiptPath } : {}),
      });
      if ((glAccountId ?? null) !== (currentGl ?? null)) {
        await updatePayrollGlAccount(row.id, glAccountId);
      }
      toast.success(t("payroll.payment_updated"));
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Payment {idx + 1}
            {row ? ` — ${row.name}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!canExecute && !canApprove && (
            <PermissionDeniedBanner perm="payroll.execute" action="modify payroll payments" />
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t("common.status")}
            </label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as Status)}
              disabled={!canExecute && !canApprove}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Upcoming">{t("people.status.Upcoming")}</SelectItem>
                <SelectItem value="Due">{t("platform.ui.due")}</SelectItem>
                <SelectItem value="Paid" disabled={!canApprove}>
                  {t("people.paid")} {!canApprove && "(needs payroll.approve)"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              GL Account (optional)
            </label>
            <select
              value={glAccountId ?? ""}
              onChange={(e) => setGlAccountId(e.target.value || null)}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— None —</option>
              {(["ATL", "BTL", "Post-Production", "Admin & Other"] as const).map((cat) => {
                const items = glAccounts.filter((g) => g.category === cat && g.isActive);
                if (items.length === 0) return null;
                return (
                  <optgroup key={cat} label={cat}>
                    {items.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.code} — {g.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Applies to the whole payroll row — used to categorize for GL reports.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t("payroll.upload_payment_receipt")}
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={!canExecute}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              title={!canExecute ? "Permission required: payroll.execute" : undefined}
              className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-foreground file:text-xs file:font-medium hover:file:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {currentReceipt && !file && (
              <button
                onClick={handleViewReceipt}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
              >
                <Paperclip className="size-3.5" />
                {t("payroll.view_current_receipt")}
              </button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving || (!canExecute && !canApprove)}>
            {saving
              ? t("common.saving")
              : !canExecute && !canApprove
                ? "Permission Required"
                : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Legend({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`px-3 py-1 rounded-full border ${tone}`}>{children}</span>;
}

function PaidStats(row: PayrollRow) {
  const totalPaid = paidPayrollAmount(row);
  const remaining = row.totalAmount - totalPaid;
  return { totalPaid, remaining };
}

function StatCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-surface border border-border p-4" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-bold ${accent ?? "text-foreground"}`}>{value}</div>
      {hint && (
        <div className="mt-1 text-[10px] text-muted-foreground/70 leading-tight">{hint}</div>
      )}
    </div>
  );
}

function PaymentChip({
  row,
  idx,
  label,
  onEdit,
}: {
  row: PayrollRow;
  idx: number;
  label: string;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const status: Status = row.payments[idx];
  const hasReceipt = !!row.receipts?.[idx];
  const entry = row.ledger?.[idx];
  const missingProof = !!entry && !entry.proofPath;
  return (
    <button
      onClick={onEdit}
      className={`w-full text-start rounded-xl border p-3 transition hover:scale-[1.01] ${STATUS_TONE[status]}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold opacity-80">{label}</span>
        <span className="text-[10px] uppercase tracking-wider">{status}</span>
      </div>
      {entry && <div className="mt-1 text-xs font-semibold">{formatUSD(entry.amount)}</div>}
      <div className="mt-2 flex items-center gap-3 text-xs opacity-80 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <Calendar className="size-3" />
          {formatDate(entry?.date) || "—"}
        </span>
        <span className="inline-flex items-center gap-1">
          {hasReceipt ? <FileCheck2 className="size-3" /> : <Paperclip className="size-3" />}
          {hasReceipt ? t("ledger.proofShort") : t("ledger.attach")}
        </span>
        {entry?.bankRef && (
          <span className="text-[10px] opacity-80">
            {t("ledger.refShort")} {entry.bankRef}
          </span>
        )}
        {missingProof && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-destructive bg-destructive/25 border border-destructive/40 rounded px-1.5 py-0.5">
            {t("ledger.missingProof")}
          </span>
        )}
      </div>
    </button>
  );
}

function VendorDrawer({ row, onEdit }: { row: PayrollRow; onEdit: (idx: number) => void }) {
  const { t } = useTranslation();
  const vendors = useStore((s) => s.vendors);
  const invoices = useStore((s) => s.invoices);
  const vendor = vendors.find((v) => v.name === row.name);
  const invoiceTotal =
    invoices.filter((i) => i.vendorName === row.name).reduce((a, i) => a + i.price, 0) ||
    row.totalAmount;
  const { totalPaid, remaining } = PaidStats(row);
  const [docUrl, setDocUrl] = useSupportingDocUrl("payroll", row.id);

  return (
    <>
      <SheetHeader className="mb-5">
        <SheetTitle className="text-xl">{row.name}</SheetTitle>
        <div className="text-sm text-muted-foreground">{vendor?.category ?? "Vendor"}</div>
      </SheetHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label={t("platform.ui.invoiceTotal")} value={formatUSD(invoiceTotal)} />
        <StatCard
          label={t("platform.ui.totalPaid")}
          value={formatUSD(totalPaid)}
          accent="text-success"
        />
        <StatCard
          label={t("platform.ui.remaining")}
          value={formatUSD(remaining)}
          accent="text-destructive"
        />
      </div>

      <div className="mb-2 text-sm font-semibold text-muted-foreground">
        {t("people.paymentSchedule")}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {row.payments.map((_, i) => (
          <PaymentChip
            key={i}
            row={row}
            idx={i}
            label={`Payment ${i + 1}`}
            onEdit={() => onEdit(i)}
          />
        ))}
      </div>

      <div className="mt-6">
        <SupportingDocField value={docUrl} onChange={setDocUrl} />
      </div>

      <div className="mt-6 pt-4 border-t border-border">
        <AuditHistoryPanel tableName="payroll" recordId={row.id} />
      </div>
    </>
  );
}

function PersonDrawer({ row, onEdit }: { row: PayrollRow; onEdit: (idx: number) => void }) {
  const { t } = useTranslation();
  const people = useStore((s) => s.people);
  const person = people.find((p) => p.fullName === row.name);
  const { totalPaid, remaining } = PaidStats(row);
  const perDay = person?.dailyRate ?? 0;
  const [docUrl, setDocUrl] = useSupportingDocUrl("payroll", row.id);

  // Strict itemisation: wages are the ONLY base of Total Deal / percentages.
  // Per diem + housing are separate ledger lines mapped to their own GL codes.
  const activeDays = person ? activeDaysForPerson(person) : 0;
  const shootingDays = person?.shootingDays ?? 0;
  const baseGross = shootingDays * perDay;
  const totalPerDiem = shootingDays * (person?.onSetPerDiem ?? person?.perDiem ?? 0);
  const housingProrated = person ? contractHousingTotal(person) : 0;
  const whtAmt = Number((row as any).whtAmount ?? 0) || 0;
  const netPayable = Math.max(0, baseGross - whtAmt);

  return (
    <>
      <SheetHeader className="mb-5">
        <SheetTitle className="text-xl flex items-center gap-2">
          {row.name}
          {hasMissingProof(row) && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-destructive bg-destructive/15 border border-destructive/30 rounded px-1.5 py-0.5">
              {t("ledger.missingProof")}
            </span>
          )}
        </SheetTitle>
        <div className="text-sm text-muted-foreground">
          {person?.character || person?.position || (row.kind === "cast" ? "Cast" : "Crew")}
        </div>
      </SheetHeader>

      {/* Strict accounting itemisation — wages vs. per diem vs. housing */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard
          label={t("platform.ui.baseGrossPay")}
          value={formatUSD(baseGross)}
          hint={`${shootingDays}d × ${formatUSD(perDay)} — Wages GL`}
        />
        <StatCard
          label={t("platform.ui.totalPerDiem")}
          value={formatUSD(totalPerDiem)}
          hint="Meals/Per Diem GL — not in Total Deal"
        />
        <StatCard
          label={t("platform.ui.housingAllowance")}
          value={formatUSD(housingProrated)}
          hint={
            person && person.housingAllowance
              ? `${formatUSD(person.housingAllowance)}/mo ÷ 30 × ${activeDays}d — Accommodation GL`
              : "Monthly rate not set"
          }
        />
        <StatCard
          label={t("platform.ui.netPayable")}
          value={formatUSD(netPayable)}
          accent="text-success"
          hint={whtAmt > 0 ? `After 5% WHT (${formatUSD(whtAmt)})` : "Base − WHT"}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label={t("platform.ui.perDay")} value={formatUSD(perDay)} />
        <StatCard
          label={t("platform.ui.onSetPerDiem")}
          value={formatUSD(person?.onSetPerDiem ?? 0)}
        />
        <StatCard
          label={t("platform.ui.offSetPerDiem")}
          value={formatUSD(person?.offSetPerDiem ?? 0)}
        />
        <StatCard label={t("platform.ui.shootingDays")} value={String(shootingDays)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard
          label={t("platform.ui.contractTotalWages")}
          value={formatUSD(row.totalAmount)}
          hint="Payment schedule % applies to this only"
        />
        <StatCard
          label={t("platform.ui.totalPaid")}
          value={formatUSD(totalPaid)}
          accent="text-success"
        />
        <StatCard
          label={t("platform.ui.remaining")}
          value={formatUSD(remaining)}
          accent="text-destructive"
        />
      </div>

      <div className="mb-2 text-sm font-semibold text-muted-foreground">
        {t("people.paymentSchedule")}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {row.payments.map((_, i) => (
          <PaymentChip
            key={i}
            row={row}
            idx={i}
            label={`Payment ${i + 1}`}
            onEdit={() => onEdit(i)}
          />
        ))}
      </div>

      <div className="mt-6">
        <SupportingDocField value={docUrl} onChange={setDocUrl} />
      </div>

      <div className="mt-6 pt-4 border-t border-border">
        <AuditHistoryPanel tableName="payroll" recordId={row.id} />
      </div>
    </>
  );
}

// =====================================================================
// PayrollLedgerPanel — reads from new payroll_payments table
// =====================================================================
type LedgerRow = {
  id: string;
  kind: PayrollKind;
  beneficiary_name: string;
  company_name: string | null;
  iban: string | null;
  bank_name: string | null;
  department: string | null;
  position_role: string | null;
  currency: string;
  scheduled_payments: number[];
  paid_payments: number[];
  scheduled_total_sar: number;
  paid_total_sar: number;
  remaining_sar: number;
  reserved_budget_sar: number;
};

function PayrollLedgerPanel({ kind }: { kind: PayrollKind }) {
  const { t } = useTranslation();
  // IBAN / bank in the CSV: same rule as the crew / cast export (crewcast-csv)
  const canExportPersonal = useCanExportPersonalData();
  const fetchOrgs = useServerFn(listMyOrganizations);
  const fetchRows = useServerFn(listPayrollPayments);
  const doImport = useServerFn(importPayrollPayments);
  const doDelete = useServerFn(deletePayrollPayment);

  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ data: PayrollPreview; fileName: string } | null>(null);
  const [committing, setCommitting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "settled" | "partial" | "pending">(
    "all",
  );
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [showIssues, setShowIssues] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setLedgerKind = useLedgerSync((s) => s.setKind);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOrgs({})
      .then((list: any) => {
        setOrgs(list);
        if (list.length && !orgId) setOrgId(list[0].id);
      })
      .catch((e: any) => {
        const msg = e?.message ?? t("common.loadFailed", { defaultValue: "Failed to load" });
        setError(msg);
        toast.error(msg);
      });
  }, []);

  const reload = async (oid = orgId) => {
    if (!oid) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRows({ data: { organization_id: oid, kind } });
      setRows(data as LedgerRow[]);
      // Push totals into the sync bus so Top Sheet + Cash Flow update live.
      const paidTotal = (data as LedgerRow[]).reduce(
        (a, r) => a + Number(r.paid_total_sar ?? 0),
        0,
      );
      const schedTotal = (data as LedgerRow[]).reduce(
        (a, r) => a + Number(r.scheduled_total_sar ?? 0),
        0,
      );
      setLedgerKind(kind, paidTotal, schedTotal);
    } catch (e: any) {
      const msg =
        e?.message ?? t("common.loadFailed", { defaultValue: "Failed to load payroll ledger" });
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orgId) reload(orgId);
  }, [orgId, kind]);

  const onFile = async (f: File) => {
    try {
      const data = await parsePayrollTemplate(f);
      setPreview({ data, fileName: f.name });
      recordAudit({
        category: "validation",
        action: "payroll.template.parse",
        severity: data.rows.length > 0 ? "info" : "warning",
        entity: "payroll_payments",
        organization_id: orgId || null,
        summary: `Parsed payroll template "${f.name}" — ${data.rows.length} row(s) ready`,
        details: { fileName: f.name, parsedRows: data.rows.length },
      });
    } catch (e: any) {
      recordAudit({
        category: "validation",
        action: "payroll.template.parse",
        severity: "error",
        entity: "payroll_payments",
        organization_id: orgId || null,
        summary: `Failed to parse payroll template "${f.name}"`,
        details: { fileName: f.name, error: String(e?.message ?? e) },
      });
      toast.error(t("payroll.failed_to_parse") + (e?.message ?? "unknown"));
    }
  };

  const commit = async () => {
    if (!preview || !orgId) return;
    setCommitting(true);
    try {
      const res = await doImport({ data: { organization_id: orgId, rows: preview.data.rows } });
      const inserted = (res as any).inserted ?? 0;
      toast.success(`Imported ${inserted} row(s) into the ledger.`);
      recordAudit({
        category: "import",
        action: "payroll.template.import",
        severity: "info",
        entity: "payroll_payments",
        organization_id: orgId,
        summary: `Imported ${inserted} payroll row(s) from "${preview.fileName}"`,
        details: { fileName: preview.fileName, inserted },
      });
      setPreview(null);
      await reload();
    } catch (e: any) {
      recordAudit({
        category: "import",
        action: "payroll.template.import",
        severity: "error",
        entity: "payroll_payments",
        organization_id: orgId,
        summary: `Payroll import failed for "${preview.fileName}"`,
        details: { fileName: preview.fileName, error: String(e?.message ?? e) },
      });
      toast.error(e?.message ?? "Import failed");
    } finally {
      setCommitting(false);
    }
  };

  const removeRow = async (id: string) => {
    if (!confirm(t("ledger.confirmDelete", { defaultValue: "حذف هذا القيد من السجل؟" }))) return;
    try {
      await doDelete({ data: { id } });
      setRows((rs) => {
        const next = rs.filter((r) => r.id !== id);
        const paidTotal = next.reduce((a, r) => a + Number(r.paid_total_sar ?? 0), 0);
        const schedTotal = next.reduce((a, r) => a + Number(r.scheduled_total_sar ?? 0), 0);
        setLedgerKind(kind, paidTotal, schedTotal);
        return next;
      });
      toast.success(t("common.deleted", { defaultValue: "تم الحذف." }));
    } catch (e: any) {
      toast.error(e?.message ?? t("common.deleteFailed", { defaultValue: "فشل الحذف" }));
    }
  };

  // Background validation — runs on every fetched batch.
  const issues = useMemo(() => validateLedgerRows(rows), [rows]);
  const rowIssueMap = useMemo(() => {
    const m = new Map<string, LedgerIssue[]>();
    for (const i of issues) {
      if (!m.has(i.rowId)) m.set(i.rowId, []);
      m.get(i.rowId)!.push(i);
    }
    return m;
  }, [issues]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.department) set.add(r.department);
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (deptFilter !== "all" && (r.department ?? "") !== deptFilter) return false;
      const sched = Number(r.scheduled_total_sar ?? 0);
      const paid = Number(r.paid_total_sar ?? 0);
      const pct = sched > 0 ? (paid / sched) * 100 : 0;
      const status = pct >= 100 ? "settled" : pct > 0 ? "partial" : "pending";
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.beneficiary_name?.toLowerCase().includes(q) ||
        (r.company_name ?? "").toLowerCase().includes(q) ||
        (r.position_role ?? "").toLowerCase().includes(q) ||
        (r.department ?? "").toLowerCase().includes(q) ||
        (r.iban ?? "").toLowerCase().includes(q) ||
        (r.bank_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, deptFilter]);

  const total = filteredRows.reduce(
    (acc, r) => ({
      reserved: acc.reserved + Number(r.reserved_budget_sar ?? 0),
      scheduled: acc.scheduled + Number(r.scheduled_total_sar ?? 0),
      paid: acc.paid + Number(r.paid_total_sar ?? 0),
      remaining: acc.remaining + Number(r.remaining_sar ?? 0),
    }),
    { reserved: 0, scheduled: 0, paid: 0, remaining: 0 },
  );

  return (
    <Panel className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-sm font-semibold">
            {t("ledger.payrollTitle", {
              kind:
                kind === "crew"
                  ? t("nav.crewPayroll", { defaultValue: "طاقم العمل" })
                  : kind === "cast"
                    ? t("nav.castPayroll", { defaultValue: "طاقم التمثيل" })
                    : t("nav.vendors", { defaultValue: "الموردين" }),
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            Mirrors the Kwalis payroll template — 7 scheduled + 7 paid payment slots per
            beneficiary.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs"
          >
            {orgs.length === 0 && <option value="">{t("people.noOrgs")}</option>}
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => downloadPayrollTemplate()}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted"
          >
            <Download className="size-3.5" /> Template
          </button>
          <button
            onClick={() => {
              import("@/lib/export-csv").then(({ downloadCSV }) => {
                downloadCSV(
                  `payroll-${kind}-${new Date().toISOString().slice(0, 10)}`,
                  filteredRows.map((r) => ({
                    kind: r.kind,
                    beneficiary: r.beneficiary_name,
                    company: r.company_name ?? "",
                    department: r.department ?? "",
                    role: r.position_role ?? "",
                    currency: r.currency,
                    reserved_sar: r.reserved_budget_sar,
                    scheduled_total_sar: r.scheduled_total_sar,
                    paid_total_sar: r.paid_total_sar,
                    remaining_sar: r.remaining_sar,
                    ...(canExportPersonal(r.kind)
                      ? { iban: r.iban ?? "", bank: r.bank_name ?? "" }
                      : {}),
                  })),
                );
                toast.success(`Exported ${filteredRows.length} row(s)`);
              });
            }}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted"
          >
            <Download className="size-3.5" /> Export CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <button
            disabled={!orgId}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-brand text-brand-foreground font-semibold disabled:opacity-50"
          >
            <Upload className="size-3.5" />
            {t("payroll.import_payroll")}
          </button>
        </div>
      </div>

      {preview && (
        <div className="mb-4 rounded-xl border border-border bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-xs text-muted-foreground">Dry-run preview</div>
              <div className="text-sm font-semibold">{preview.fileName}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPreview(null)}
                disabled={committing}
                className="px-3 py-1.5 rounded-full border border-border text-xs hover:bg-muted"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={commit}
                disabled={committing || preview.data.rows.length === 0}
                className="px-3 py-1.5 rounded-full bg-brand text-brand-foreground text-xs font-semibold disabled:opacity-50"
              >
                {committing ? "Importing…" : `Commit ${preview.data.rows.length} row(s)`}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
            <Tile label={t("platform.ui.total")} v={preview.data.rows.length} />
            <Tile label={t("platform.ui.vendor")} v={preview.data.counts.vendor} />
            <Tile label={t("platform.ui.crew")} v={preview.data.counts.crew} />
            <Tile label={t("platform.ui.cast")} v={preview.data.counts.cast} />
          </div>
          {preview.data.mismatches.length > 0 && (
            <div className="max-h-32 overflow-auto rounded border border-warning/30 bg-warning/5 text-xs">
              {preview.data.mismatches.map((m, i) => (
                <div key={i} className="px-2 py-1 flex gap-2">
                  <span className="font-mono text-warning">row {m.row}</span>
                  <span className="text-muted-foreground">{m.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters + validation status */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("ledger.searchPlaceholder", {
            defaultValue: "🔍  ابحث بالاسم، الشركة، الآيبان، البنك…",
          })}
          className="flex-1 min-w-[200px] bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs"
        >
          <option value="all">{t("ledger.filterAllStatus", { defaultValue: "كل الحالات" })}</option>
          <option value="pending">
            {t("ledger.statusPending", { defaultValue: "قيد الانتظار" })}
          </option>
          <option value="partial">{t("ledger.statusPartial", { defaultValue: "جزئي" })}</option>
          <option value="settled">{t("ledger.statusSettled", { defaultValue: "مُسوَّى" })}</option>
        </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs"
        >
          <option value="all">{t("ledger.filterAllDepts", { defaultValue: "كل الأقسام" })}</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowIssues((v) => !v)}
          className={`text-xs px-3 py-1.5 rounded-full border ${
            issues.length === 0
              ? "border-success/30 bg-success/10 text-success"
              : "border-warning/40 bg-warning/10 text-warning"
          }`}
          title={t("ledger.validationTitle", { defaultValue: "تدقيق الصفوف في الخلفية" })}
        >
          {issues.length === 0
            ? t("ledger.validationOk", { defaultValue: "✓ جميع الصفوف صالحة" })
            : t("ledger.validationCount", {
                count: issues.length,
                defaultValue: `⚠ ${issues.length} تنبيه`,
              })}
        </button>
        <span className="text-[11px] text-muted-foreground ms-auto">
          {t("ledger.showingOf", {
            defaultValue: `عرض ${filteredRows.length} من ${rows.length}`,
            shown: filteredRows.length,
            total: rows.length,
          })}
        </span>
      </div>

      {error && !loading && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center justify-between gap-2">
          <span>⚠ {error}</span>
          <button
            onClick={() => reload()}
            className="text-[11px] px-2 py-1 rounded-full border border-border hover:bg-muted"
          >
            {t("common.retry", { defaultValue: "إعادة المحاولة" })}
          </button>
        </div>
      )}

      {showIssues && issues.length > 0 && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 max-h-48 overflow-auto">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-warning border-b border-warning/20 sticky top-0 bg-surface">
            Background validation — every row checked against template rules
          </div>
          {issues.map((iss, i) => (
            <div
              key={i}
              className="px-3 py-1.5 text-xs flex items-start gap-2 border-b border-border last:border-b-0"
            >
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                  iss.severity === "error"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-warning/15 text-warning"
                }`}
              >
                {iss.severity}
              </span>
              <span className="font-medium">{iss.beneficiary}</span>
              <span className="text-muted-foreground">{iss.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border max-h-[70vh]">
        <table className="app-table w-full text-xs">
          <thead className="text-muted-foreground bg-surface-2 sticky top-0 z-30">
            {/* Grouped header band — mirrors the template's banded column groups */}
            <tr className="text-[10px] uppercase tracking-wider">
              <th
                colSpan={6}
                className="text-start px-3 py-2.5 border-b border-border dark:border-border sticky left-0 z-20 bg-surface-2"
              >
                {t("ledger.groupBeneficiary", { defaultValue: "بيانات المستفيد" })}
              </th>
              <th
                colSpan={2}
                className="px-3 py-2.5 border-b border-l border-border dark:border-border bg-surface-2 text-center"
              >
                {t("ledger.groupAccount", { defaultValue: "الحساب" })}
              </th>
              <th
                colSpan={7}
                className="px-3 py-2.5 border-b border-l border-border dark:border-border border-t-2 border-t-sky-500/70 text-info dark:text-info text-center font-semibold bg-transparent"
              >
                {t("ledger.groupScheduled", { defaultValue: "الدفعات المجدولة" })}
              </th>
              <th
                colSpan={7}
                className="px-3 py-2.5 border-b border-l border-border dark:border-border border-t-2 border-t-emerald-500/70 text-success dark:text-success text-center font-semibold bg-transparent"
              >
                {t("ledger.groupPaid", { defaultValue: "الدفعات المسدَّدة" })}
              </th>
              <th
                colSpan={4}
                className="px-3 py-2.5 border-b border-l border-border dark:border-border bg-surface-2 text-center"
              >
                {t("ledger.groupTotals", { defaultValue: "الإجماليات" })}
              </th>
              <th className="border-b border-l border-border dark:border-border"></th>
            </tr>
            <tr>
              <th className="text-start px-3 py-2.5 font-medium sticky left-0 z-20 bg-surface-2">
                {t("ledger.colBeneficiary", { defaultValue: "المستفيد" })}
              </th>
              <th className="text-start px-3 py-2.5 font-medium">
                {kind === "vendor"
                  ? t("ledger.colCompany", { defaultValue: "الشركة" })
                  : t("ledger.colPosition", { defaultValue: "المسمى" })}
              </th>
              <th className="text-start px-3 py-2.5 font-medium">
                {t("ledger.colDept", { defaultValue: "القسم" })}
              </th>
              <th className="text-start px-3 py-2.5 font-medium">
                {t("ledger.colCcy", { defaultValue: "العملة" })}
              </th>
              <th className="text-start px-3 py-2.5 font-medium">
                {t("ledger.colBank", { defaultValue: "البنك" })}
              </th>
              <th className="text-start px-3 py-2.5 font-medium border-r border-border dark:border-border">
                {t("crewcast.iban")}
              </th>
              <th className="text-end px-3 py-2.5 font-medium">
                {t("ledger.colReserved", { defaultValue: "المحجوز" })}
              </th>
              <th className="text-end px-3 py-2.5 font-medium border-r border-border dark:border-border">
                {t("ledger.colSchedTotal", { defaultValue: "إجمالي مجدول" })}
              </th>
              {Array.from({ length: 7 }, (_, i) => (
                <th
                  key={`s${i}`}
                  className={`text-end px-3 py-2.5 font-medium text-info dark:text-info ${i === 6 ? "border-r border-border dark:border-border" : ""}`}
                >
                  S{i + 1}
                </th>
              ))}
              {Array.from({ length: 7 }, (_, i) => (
                <th
                  key={`p${i}`}
                  className={`text-end px-3 py-2.5 font-medium text-success dark:text-success ${i === 6 ? "border-r border-border dark:border-border" : ""}`}
                >
                  P{i + 1}
                </th>
              ))}
              <th className="text-end px-3 py-2.5 font-medium">
                {t("ledger.colPaidTotal", { defaultValue: "إجمالي مسدَّد" })}
              </th>
              <th className="text-end px-3 py-2.5 font-medium">
                {t("ledger.colRemaining", { defaultValue: "المتبقي" })}
              </th>
              <th className="text-end px-3 py-2.5 font-medium">%</th>
              <th className="text-end px-3 py-2.5 font-medium">
                {t("ledger.colStatus", { defaultValue: "الحالة" })}
              </th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk${i}`} className="border-t border-border">
                  <td colSpan={27} className="px-3 py-2">
                    <div className="h-4 rounded bg-surface animate-pulse" />
                  </td>
                </tr>
              ))}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={27} className="text-center py-10 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-2xl">📭</div>
                    <div className="text-sm font-medium">
                      {rows.length === 0
                        ? t("ledger.emptyImport", {
                            defaultValue: "لا توجد قيود بعد — استخدم زر «استيراد الرواتب» أعلاه.",
                          })
                        : t("ledger.emptyFilter", {
                            defaultValue: "لا توجد صفوف مطابقة للتصفية الحالية.",
                          })}
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {filteredRows.map((r) => {
              const sched = Number(r.scheduled_total_sar ?? 0);
              const paid = Number(r.paid_total_sar ?? 0);
              const pct = sched > 0 ? Math.round((paid / sched) * 100) : 0;
              const status = pct >= 100 ? "Settled" : pct > 0 ? "Partial" : "Pending";
              const statusTone =
                pct >= 100
                  ? "bg-success/15 text-success border-success/30"
                  : pct > 0
                    ? "bg-warning/15 text-warning border-warning/30"
                    : "bg-surface text-muted-foreground border-border";
              return (
                <tr key={r.id} className="border-t border-border hover:bg-muted group">
                  <td className="px-3 py-2 font-medium sticky left-0 z-10 bg-background group-hover:bg-[color:var(--surface-2,#1a1d24)]">
                    {r.beneficiary_name}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {kind === "vendor" ? (r.company_name ?? "—") : (r.position_role ?? "—")}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.department ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    <CurrencySymbol code={(r.currency ?? "SAR") as any} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.bank_name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px] border-r border-border">
                    {r.iban ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">{fmtN(r.reserved_budget_sar)}</td>
                  <td className="px-2 py-2 text-end tabular-nums font-semibold border-r border-border">
                    {fmtN(r.scheduled_total_sar)}
                  </td>
                  {Array.from({ length: 7 }, (_, i) => (
                    <td
                      key={`s${i}`}
                      className={`px-2 py-2 text-end tabular-nums ${i === 6 ? "border-r border-border" : ""}`}
                    >
                      {fmtN(r.scheduled_payments?.[i])}
                    </td>
                  ))}
                  {Array.from({ length: 7 }, (_, i) => (
                    <td
                      key={`p${i}`}
                      className={`px-2 py-2 text-end tabular-nums text-success ${i === 6 ? "border-r border-border" : ""}`}
                    >
                      {fmtN(r.paid_payments?.[i])}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-end tabular-nums text-success font-semibold">
                    {fmtN(r.paid_total_sar)}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums text-destructive">
                    {fmtN(r.remaining_sar)}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">{pct}%</td>
                  <td className="px-2 py-2 text-end">
                    <span
                      className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider ${statusTone}`}
                    >
                      {status}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-end">
                    <button
                      onClick={() => removeRow(r.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length > 0 && (
              <tr className="border-t border-border bg-surface-2 font-semibold">
                <td
                  colSpan={6}
                  className="px-3 py-2 text-end text-muted-foreground sticky left-0 z-10 bg-surface-2"
                >
                  {t("people.totals")}
                </td>
                <td className="px-2 py-2 text-end tabular-nums">{fmtN(total.reserved)}</td>
                <td className="px-2 py-2 text-end tabular-nums border-r border-border">
                  {fmtN(total.scheduled)}
                </td>
                <td colSpan={14}></td>
                <td className="px-2 py-2 text-end tabular-nums text-success">{fmtN(total.paid)}</td>
                <td className="px-2 py-2 text-end tabular-nums text-destructive">
                  {fmtN(total.remaining)}
                </td>
                <td colSpan={3}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Tile({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{v}</div>
    </div>
  );
}

function fmtN(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return formatAmount(n, 2);
}

// =====================================================================
// Background validator — checks every imported row against template rules.
// =====================================================================
export type LedgerIssue = {
  rowId: string;
  beneficiary: string;
  severity: "error" | "warning";
  code: string;
  message: string;
};

function validateLedgerRows(rows: LedgerRow[]): LedgerIssue[] {
  const issues: LedgerIssue[] = [];
  const seenIban = new Map<string, string>();
  for (const r of rows) {
    const name = r.beneficiary_name || "(unnamed)";
    const push = (severity: LedgerIssue["severity"], code: string, message: string) =>
      issues.push({ rowId: r.id, beneficiary: name, severity, code, message });

    if (!r.beneficiary_name?.trim()) push("error", "missing_name", "Beneficiary name is empty");
    if (!r.iban?.trim())
      push("warning", "missing_iban", "IBAN is missing — payments cannot be wired");
    else if (r.iban.replace(/\s/g, "").length < 15)
      push("warning", "iban_short", `IBAN looks too short (${r.iban})`);
    else {
      const norm = r.iban.replace(/\s/g, "").toUpperCase();
      const prev = seenIban.get(norm);
      if (prev && prev !== r.id)
        push("warning", "iban_duplicate", `Duplicate IBAN shared with another row`);
      seenIban.set(norm, r.id);
    }
    if (!r.bank_name?.trim()) push("warning", "missing_bank", "Bank name is missing");
    if (!r.department?.trim()) push("warning", "missing_dept", "Department is missing");
    if (!r.currency?.trim()) push("error", "missing_currency", "Currency is missing");

    const sched = Number(r.scheduled_total_sar ?? 0);
    const paid = Number(r.paid_total_sar ?? 0);
    if (sched === 0 && paid === 0)
      push("warning", "empty_payments", "No scheduled or paid payments recorded");
    if (paid > sched + 0.01)
      push(
        "error",
        "overpaid",
        `Paid total (${Math.round(paid)}) exceeds scheduled (${Math.round(sched)})`,
      );

    const schedSum = (r.scheduled_payments ?? []).reduce((a, n) => a + Number(n || 0), 0);
    if (Math.abs(schedSum - sched) > 1)
      push(
        "warning",
        "sched_mismatch",
        "Scheduled slot total does not match stored scheduled total",
      );
    const paidSum = (r.paid_payments ?? []).reduce((a, n) => a + Number(n || 0), 0);
    if (Math.abs(paidSum - paid) > 1)
      push("warning", "paid_mismatch", "Paid slot total does not match stored paid total");
  }
  return issues;
}
