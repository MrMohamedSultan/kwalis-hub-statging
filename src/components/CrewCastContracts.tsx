import { COUNTRIES } from "@/lib/countries";
import { assertUploadAllowed } from "@/lib/upload-policy";
import {
  WhtTreatmentSelector,
  type WhtTreatment,
} from "@/components/contracts/WhtTreatmentSelector";
import {
  CONTRACT_CURRENCIES,
  CREW_POSITIONS,
  DEFAULT_BASE_CURRENCY,
  ID_TYPES,
  POSITION_OTHER,
  SAUDI_ARABIA,
  computeWht,
  displayDaysAndRate,
  guessIdType,
  normalizeIban,
  positionSelectValue,
  rateToBase,
  resolveWhtRate,
  suggestTaxResidency,
  validateIban,
  validateIdNumber,
  validateSwift,
  whtInBase,
  ibanCountryCode,
  ibanLength,
  type IdType,
  type TaxResidency,
  type WhtRateRule,
} from "@/lib/contract-terms";
import { useCurrencyStore } from "@/stores/useCurrencyStore";
import { storageAudited } from "@/lib/storage-audit";
import { BankPicker, validateBankPicker } from "@/components/BankPicker";
import { PersonPicker } from "@/components/people/PersonPicker";
import { PeopleProfilesPanel } from "@/components/people/PeopleProfilesPanel";
import { usePersons, profileToContractPatch } from "@/lib/persons";
import { findSimilarPersons } from "@/lib/person-match";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { TablePagination, usePagedRows } from "@/components/TablePagination";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { TableEmptyRow } from "@/components/ui/empty-state";
import {
  useStore,
  formatUSD,
  generateId,
  CONTRACT_STATUSES,
  normalizeDealType,
  DEAL_TYPES,
  DEAL_TYPE_LABEL,
  OVERTIME_UNITS,
  OVERTIME_UNIT_LABEL,
} from "@/lib/store";
import type {
  Person,
  Invoice,
  ContractStatus,
  DealType,
  OvertimeUnit,
  PaymentScheduleItem,
} from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Paperclip,
  Plus,
  Trash2,
  FileText,
  Pencil,
  Check,
  ChevronDown,
  Calendar,
  Copy,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { fetchCanAdminRebateSettings } from "@/lib/rebate-settings";
import { buildCrewCastCsv } from "@/lib/crewcast-csv";
import { useTranslation } from "react-i18next";
import { checkInstalmentSchedule } from "@/lib/instalments";
import { DateInput } from "@/components/ui/date-input";
import { DatePickerPill } from "@/components/ui/date-picker-pill";
import { humanizeDbError } from "@/lib/db-errors";
import { LockGuard } from "@/components/chrome/LockGuard";
import { AttachmentsButton } from "@/components/AttachmentsModal";
import { BudgetMappingSelect } from "@/components/BudgetMappingSelect";
import {
  countLinesWithCode,
  disambiguatedLineLabel,
  fetchLineCommitments,
  fetchProjectBudgetLines,
  parentHeaderCodeForLine,
  projectBudgetLineTotal,
  subAccountsForHeader,
  sumLineCommitments,
  type ProjectBudgetLine,
} from "@/lib/project-budget-lines";

import {
  evaluateMapping,
  fetchMasterCodes,
  hasBlockingIssue,
  type MasterCodeInfo,
} from "@/lib/budget-mapping-check";
import { BudgetMappingWarning } from "@/components/BudgetMappingWarning";
import {
  PaymentSplitFields,
  ScheduleRemainderHint,
  SCHEDULE_PCT_TOLERANCE,
  isScheduleTotalValid,
  resolveSplitAmount,
  toCents,
} from "@/components/PaymentSplitFields";
import { useUnsavedChangesWarning, useDirtyTracker } from "@/hooks/useUnsavedChangesWarning";
import { validatePaymentSchedule } from "@/lib/payment-schedule-validation";

import {
  AttachmentUrlField,
  AttachmentLinkBadge,
  isValidAttachmentUrl,
  normalizeAttachmentUrl,
} from "@/components/AttachmentUrlField";
import { useFormDraft, draftKey, recordVersion } from "@/lib/form-drafts";
import { findDuplicateAttachmentUrl, type AttachmentUrlRecord } from "@/lib/cloud-links";
import { StoredFileBadge } from "@/components/StoredFileBadge";
import { downloadBlob } from "@/lib/download";
import { formatAmount } from "@/lib/format-number";
import { PersonTypeNewButton } from "@/features/reports/company-overhead/PersonTypeNewButton";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s()-]{6,19}$/;

/**
 * Project base currency — every stored figure (budget lines, payroll totals,
 * payments) is in it. Contract rates stay in the contract's own currency.
 */
function useBaseCurrency(): string {
  return useCurrencyStore((s) => s.projectFxRate?.baseCurrency || DEFAULT_BASE_CURRENCY);
}

/** Position slug for the contracts.positions.* labels. */
const positionKey = (p: string) => p.toLowerCase().replace(/[^a-z0-9]+/g, "_");

/** WHT rate table (db/pending/090): the organization's rows, then platform rows. */
function useWhtRateRules(organizationId: string | null | undefined): WhtRateRule[] {
  const [rules, setRules] = useState<WhtRateRule[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("wht_rate_rules")
          .select("organization_id, service_type, rate_pct");
        if (cancelled || error) return;
        setRules(
          ((data ?? []) as any[])
            .filter((r) => !r.organization_id || r.organization_id === organizationId)
            .map((r) => ({
              serviceType: String(r.service_type),
              ratePct: Number(r.rate_pct),
              orgSpecific: !!r.organization_id,
            })),
        );
      } catch {
        /* table not reachable — resolveWhtRate falls back to 5% */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);
  return rules;
}

function validateContact(phone?: string | null, email?: string | null): Record<string, string> {
  const errs: Record<string, string> = {};
  const p = (phone ?? "").trim();
  const e = (email ?? "").trim();
  if (p && !PHONE_RE.test(p)) {
    errs.phoneNumber = "Enter a valid phone number (7–20 digits, optional +country code).";
  }
  if (e && !EMAIL_RE.test(e)) {
    errs.email = "Enter a valid email address (name@example.com).";
  }
  return errs;
}

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();

  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={async (ev) => {
        ev.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
          toast.success(`${label} copied`);
        } catch {
          toast.error(t("crewcastcontracts.clipboard_unavailable"));
        }
      }}
      className="shrink-0 grid place-items-center size-6 rounded-md border border-border bg-surface-2 text-muted-foreground hover:text-foreground hover:bg-muted"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

function ContactCell({ phone, email }: { phone?: string | null; email?: string | null }) {
  const { t } = useTranslation();
  const p = (phone ?? "").trim();
  const e = (email ?? "").trim();
  if (!p && !e) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {p && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
          <a href={`tel:${p}`} className="truncate font-mono text-xs hover:underline">
            {p}
          </a>
          <CopyValueButton value={p} label={t("platform.ui.phoneNumber")} />
        </div>
      )}
      {e && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
          <a href={`mailto:${e}`} className="truncate text-xs hover:underline">
            {e}
          </a>
          <CopyValueButton value={e} label={t("platform.ui.email")} />
        </div>
      )}
    </div>
  );
}

const STATUS_TONE: Record<ContractStatus, string> = {
  "Missing Data": "bg-muted/15 text-foreground border-border",
  "Pending Contract": "bg-warning/15 text-warning border-warning/30",
  "Signed - Awaiting Review": "bg-info/15 text-info border-info/30",
  Active: "bg-success/15 text-success border-success/30",
};

function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_TONE[status]}`}
    >
      {status}
    </span>
  );
}

/** Platform standard: grouped amount followed by the ISO code ("1,200 USD"). */
function formatCcy(n: number, ccy: string | undefined): string {
  const code = ccy || "USD";
  const amt = formatAmount(Number.isFinite(n) ? n : 0, 2);
  return `${amt} ${code}`;
}

/**
 * Rate inputs accept decimals (66.67) but never sub-cent precision.
 * Returns `null` when the typed value carries more than 2 decimals, so the
 * caller can ignore the keystroke and keep the previous value.
 */
/**
 * Shows the attachment currently stored on the record so an editor can confirm
 * (or reopen) it before saving — and warns loudly when the form is about to
 * replace or wipe it.
 */
function StoredAttachmentCard({
  stored,
  current,
  onRestore,
  className = "",
}: {
  stored: string;
  current: string;
  onRestore: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  if (!stored) return null;
  const normalizedCurrent = normalizeAttachmentUrl(current);
  const cleared = !normalizedCurrent;
  const replaced = !cleared && normalizedCurrent !== stored;
  const tone = cleared
    ? "border-destructive/40 bg-destructive/10"
    : replaced
      ? "border-warning/40 bg-warning/10"
      : "border-border bg-muted/40";

  return (
    <div className={`rounded-xl border p-3 text-xs ${tone} ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          {t("crewcastcontracts.saved_attachment")}
        </span>
        <AttachmentLinkBadge url={stored} />
      </div>
      <a
        href={stored}
        target="_blank"
        rel="noopener noreferrer"
        title={stored}
        className="mt-1 block break-all text-info underline underline-offset-2 dark:text-info"
      >
        {stored}
      </a>
      {(cleared || replaced) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={
              cleared ? "text-destructive dark:text-destructive" : "text-warning dark:text-warning"
            }
          >
            {cleared
              ? "Saving now will remove this attachment."
              : "Saving now will replace this attachment with the URL above."}
          </span>
          <button
            type="button"
            onClick={onRestore}
            className="rounded-lg border border-border px-2 py-1 font-semibold hover:bg-muted"
          >
            {t("crewcastcontracts.keep_saved_link")}
          </button>
        </div>
      )}
    </div>
  );
}

function acceptRateInput(raw: string): number | null | undefined {
  if (raw === "") return null; // cleared
  if (!/^-?\d*(\.\d{0,2})?$/.test(raw)) return undefined; // reject 3+ decimals
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

type PaymentLedgerRow = {
  id: string;
  date: string;
  amount: number;
  bankRef: string;
  /** Existing uploaded proof path (persisted). */
  proofPath: string | null;
  /** New file staged for upload. */
  proofFile: File | null;
};
type PaymentScheduleRow = {
  id: string;
  label: string;
  percent: number;
  dueDate: string;
  amount: number;
} & Partial<
  Pick<
    PaymentScheduleItem,
    | "status"
    | "proofPath"
    | "paidDate"
    | "paidRef"
    | "paymentMethod"
    | "sourceAccount"
    | "receiptUrl"
    | "paidNotes"
  >
>;
type ContractExtras = {
  paymentLedger: PaymentLedgerRow[];
  attachmentPath: string | null;
  weeklyRate?: number;
  weeks?: number;
  paymentSchedule: PaymentScheduleRow[];
  /** Contract value (gross) in the project base currency. */
  contractAmount: number;
  whtPercent: number;
  /** Base currency. */
  whtAmount: number;
  /** Base currency — instalments are built on it. */
  netPayable: number;
  whtTreatment: WhtTreatment;
};

export function PeoplePage({
  kind,
  title,
  openId,
}: {
  kind: "crew" | "cast";
  title: string;
  /** G11 deep link: a contract (payroll row) id or a person id to open. */
  openId?: string;
}) {
  const { t } = useTranslation();
  const {
    people,
    payroll,
    addPerson,
    updatePerson,
    removePerson,
    addPayroll,
    syncPayrollForContract,
    setPayrollLedger,
    ensureBudgetCode,
  } = useStore();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const storeReady = useStore((s) => s.ready);
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const baseCurrency = useBaseCurrency();
  // Contact / bank / money columns of the CSV export: same rule as the DB's
  // get_crew_cast_list contact data (197) — rebate settings admin, or edit
  // rights on these contracts.
  const perms = usePermissions();
  const [rebateAdmin, setRebateAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    setRebateAdmin(false);
    if (activeProjectId)
      void fetchCanAdminRebateSettings(activeProjectId).then((v) => live && setRebateAdmin(v));
    return () => {
      live = false;
    };
  }, [activeProjectId]);
  const canExportSensitive =
    rebateAdmin || perms.canEdit(kind === "cast" ? "cast-contracts" : "crew-contracts");
  const list = useMemo(() => people.filter((p) => p.kind === kind), [people, kind]);
  // Only one page of contracts is mounted at a time — selection and filtering
  // still operate on the full `list`.
  const { pageRows: pagedList, paginationProps: peoplePagination } = usePagedRows(list, 20);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [template, setTemplate] = useState<Person | null>(null);
  const [modRequest, setModRequest] = useState<Person | null>(null);
  const [modReason, setModReason] = useState<"Overtime" | "Contract Addendum">("Overtime");
  const [modDescription, setModDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showProfiles, setShowProfiles] = useState(false);

  // Drop selections that no longer exist in the list
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of prev) if (list.some((p) => p.id === id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  const allSelected = list.length > 0 && selected.size === list.length;
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(list.map((p) => p.id)));
  const clearSelection = () => setSelected(new Set());

  /**
   * Figures shown for one contract. Rates stay in the contract currency; the
   * contract value is the GROSS (an exclusive / gross-up deal carries its WHT
   * on top); payments are compared with the stored base-currency total.
   */
  const contractFigures = (p: Person) => {
    const pr = payroll.find((r) => r.refId === p.id);
    const { days, daily, total } = displayDaysAndRate(p);
    const ratePct = p.whtRate ?? pr?.whtPercent ?? 0;
    const gross = computeWht(total, ratePct, p.whtTreatment ?? "inclusive").gross;
    const paid = (pr?.ledger ?? []).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const grossBase = pr ? pr.totalAmount : gross;
    return { pr, days, daily, gross, grossBase, paid, remaining: Math.max(0, grossBase - paid) };
  };

  const openNew = () => {
    setEditing(null);
    setTemplate(null);
    setOpen(true);
  };
  const openEdit = (p: Person) => {
    setTemplate(null);
    setEditing(p);
    setOpen(true);
  };
  // G11: ?open=<id> opens that contract once the store has loaded.
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || !storeReady || openedRef.current === openId) return;
    const personId = payroll.find((r) => r.id === openId)?.refId ?? openId;
    const person = people.find((p) => p.id === personId);
    if (!person) return;
    openedRef.current = openId;
    openEdit(person);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, storeReady, people, payroll]);
  const close = () => {
    setOpen(false);
    setEditing(null);
    setTemplate(null);
  };
  /**
   * Duplicate: reuse the person's contract data as a clean template. Every
   * unique/system identifier (row id, signed contract file, approval trail,
   * status, cloud attachment) is stripped so nothing is linked to the original
   * record and the copy starts as a fresh draft.
   */
  const openDuplicate = (p: Person) => {
    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      ...rest
    } = p as Person & { createdAt?: string; updatedAt?: string };
    setEditing(null);
    setTemplate({
      ...(rest as Person),
      id: generateId(),
      contractStatus: "Pending Contract",
      contractPath: null,
      attachmentUrl: null,
      approvalStatus: null,
      approvalReason: null,
      approvalDescription: null,
    } as Person);
    setOpen(true);
  };
  const openModRequest = (p: Person) => {
    setModRequest(p);
    setModReason("Overtime");
    setModDescription("");
  };
  const closeModRequest = () => setModRequest(null);

  const onDelete = async (p: Person) => {
    if (
      !confirm(
        `Delete ${title.toLowerCase()} "${p.fullName}"? This removes their payroll record too.`,
      )
    )
      return;
    await removePerson(p.id);
    toast.success(`${p.fullName} deleted`);
  };

  const onBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} selected ${title.toLowerCase()} record(s)? Their payroll rows will be removed too.`,
      )
    )
      return;
    for (const id of ids) {
      await removePerson(id);
    }
    clearSelection();
    toast.success(`${ids.length} ${title.toLowerCase()} record(s) deleted`);
  };

  const onBulkExport = () => {
    const rows = list.filter((p) => selected.has(p.id));
    if (rows.length === 0) return;
    // Contract value = base rate only (wages), gross of WHT. Per diem/housing are itemized separately.
    const csv = buildCrewCastCsv(
      rows.map((p) => {
        const fig = contractFigures(p);
        return {
          fullName: p.fullName,
          role: (kind === "cast" ? p.character || p.position : p.position) ?? "",
          nationality: p.nationality,
          idType: p.idType ?? "",
          idNumber: p.idNumber,
          phoneNumber: p.phoneNumber ?? "",
          email: p.email ?? "",
          iban: p.iban,
          bank: p.bank,
          startDate: p.startDate,
          endDate: p.endDate,
          currency: p.ccy ?? "",
          days: fig.days,
          daily: fig.daily,
          perDiem: p.perDiem,
          gross: fig.gross,
          whtTreatment: p.whtTreatment ?? "inclusive",
          taxResidency: p.taxResidency ?? "",
          status: p.contractStatus ?? "Pending Contract",
        };
      }),
      {
        kind,
        includeSensitive: canExportSensitive,
        label: (id) => t(`polish.crewcast_csv.${id}`),
      },
    );
    // BOM so Excel opens the Arabic headers as UTF-8.
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(`${kind}-selected-${new Date().toISOString().slice(0, 10)}.csv`, blob);
    toast.success(t("polish.crewcast_csv.exported", { count: rows.length }), {
      description: canExportSensitive ? undefined : t("polish.crewcast_csv.limited"),
    });
    clearSelection();
  };

  return (
    <>
      <PageTitle
        title={title}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowProfiles(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface hover:bg-muted text-sm font-medium"
            >
              {t("people.profiles_button")}
            </button>
            {/* E04: project freelancer (contract) or company employee (overhead) */}
            <PersonTypeNewButton
              label={t("crewcastcontracts.new_contract")}
              onFreelancer={openNew}
            />
          </div>
        }
      />

      {showProfiles && (
        <PeopleProfilesPanel
          organizationId={activeProject?.organizationId ?? null}
          contracts={people}
          onClose={() => setShowProfiles(false)}
        />
      )}
      <LockGuard scopeLabel={`${title}`}>
        <Panel>
          {selected.size > 0 && (
            <div className="mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-brand/40 bg-brand/10">
              <div className="text-sm font-medium">
                {selected.size} item{selected.size === 1 ? "" : "s"} selected
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onBulkExport}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 border border-border hover:bg-muted"
                >
                  {t("crewcastcontracts.export_selected")}
                </button>
                <button
                  onClick={onBulkDelete}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive/15 border border-destructive/30 text-destructive hover:bg-destructive/25"
                >
                  {t("crewcastcontracts.delete_selected")}
                </button>
                <button
                  onClick={clearSelection}
                  className="px-2 py-1.5 rounded-lg text-xs hover:bg-muted"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="app-table w-full">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      aria-label={t("crewcastcontracts.select_all")}
                      checked={allSelected}
                      onChange={toggleAll}
                      className="size-4 cursor-pointer accent-[var(--brand)]"
                    />
                  </th>
                  {[
                    ["fullName", "cc.fullName"],
                    ["position", "cc.position"],
                    ["nationality", "cc.nationality"],
                    ["id", "cc.id"],
                  ]
                    .map(([k, tk]) => (
                      <th
                        key={k}
                        data-card-label={t(`crewcast.${k}`)}
                        className="text-start px-3 py-2 font-medium text-xs uppercase tracking-wider"
                      >
                        {t(`crewcast.${k}`)}
                      </th>
                    ))
                    .concat(
                      <th
                        key="contact"
                        data-card-label={t("platform.ui.contact")}
                        className="text-start px-3 py-2 font-medium text-xs uppercase tracking-wider"
                      >
                        {t("crewcastcontracts.contact")}
                      </th>,
                    )}
                  {[
                    ["iban", "cc.iban"],
                    ["bank", "cc.bank"],
                    ["start", "cc.start"],
                    ["end", "cc.end"],
                    ["days", "cc.days"],
                    ["daily", "cc.daily"],
                    ["perDiem", "cc.perDiem"],
                    ["total", "cc.total"],
                    ["status", "cc.status"],
                    ["actions", "cc.actions"],
                  ].map(([k, tk]) => (
                    <th
                      key={k}
                      data-card-label={t(`crewcast.${k}`)}
                      className="text-start px-3 py-2 font-medium text-xs uppercase tracking-wider"
                    >
                      {t(`crewcast.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedList.map((p) => {
                  const status: ContractStatus = (p.contractStatus ??
                    "Pending Contract") as ContractStatus;
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-border"
                      data-state={selected.has(p.id) ? "selected" : undefined}
                    >
                      <td className="px-3 py-3 w-10">
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.fullName}`}
                          checked={selected.has(p.id)}
                          onChange={() => toggleOne(p.id)}
                          className="size-4 cursor-pointer accent-[var(--brand)]"
                        />
                      </td>
                      <td className="px-3 py-3 font-medium">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="flex items-center gap-2 text-start hover:underline"
                          title={t("crewcast.recordPayment")}
                        >
                          <span>{p.fullName}</span>
                          {(() => {
                            const pr = payroll.find((r) => r.refId === p.id);
                            const missing =
                              !!pr?.ledger?.length && pr.ledger.some((e) => !e.proofPath);
                            return missing ? (
                              <span
                                className="text-[10px] font-semibold uppercase tracking-wider text-destructive bg-destructive/15 border border-destructive/30 rounded px-1.5 py-0.5 whitespace-nowrap"
                                title={t("ledger.missingProofTooltip")}
                              >
                                {t("ledger.missingProof")}
                              </span>
                            ) : null;
                          })()}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        {kind === "cast" ? p.character || p.position : p.position}
                      </td>
                      <td className="px-3 py-3">{p.nationality}</td>
                      <td className="px-3 py-3 font-mono text-xs">{p.idNumber}</td>
                      <td
                        className="px-3 py-3 min-w-[180px]"
                        data-card-label={t("platform.ui.contact")}
                      >
                        <ContactCell phone={p.phoneNumber} email={p.email} />
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">{p.iban}</td>
                      <td className="px-3 py-3">{p.bank}</td>
                      <td className="px-3 py-3">{p.startDate}</td>
                      <td className="px-3 py-3">{p.endDate}</td>
                      {(() => {
                        // Base rate only — per diem/housing are separate ledger lines.
                        const fig = contractFigures(p);
                        const money2 = (n: number) => formatUSD(n);
                        return (
                          <>
                            <td className="px-3 py-3 text-center">{fig.days}</td>
                            <td className="px-3 py-3 whitespace-nowrap" dir="ltr">
                              {formatCcy(fig.daily, p.ccy)}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap" dir="ltr">
                              {formatCcy(p.perDiem, p.ccy)}
                            </td>
                            <td className="px-3 py-3 font-semibold">
                              <div dir="ltr" className="whitespace-nowrap">
                                {formatCcy(fig.gross, p.ccy)}
                              </div>
                              {fig.pr && (p.ccy || DEFAULT_BASE_CURRENCY) !== baseCurrency && (
                                <div className="text-[10px] font-normal text-muted-foreground">
                                  ≈ {money2(fig.grossBase)}
                                </div>
                              )}
                              {fig.paid > 0 && (
                                <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                                  <span className="text-success">
                                    {t("crewcast.paidToDate")}: {money2(fig.paid)}
                                  </span>
                                  {" · "}
                                  <span className="text-warning">
                                    {t("crewcast.remainingBalance")}: {money2(fig.remaining)}
                                  </span>
                                </div>
                              )}
                            </td>
                          </>
                        );
                      })()}
                      <td className="px-3 py-3">
                        <select
                          value={status}
                          onChange={async (e) => {
                            const next = e.target.value as ContractStatus;
                            try {
                              await updatePerson(p.id, { contractStatus: next });
                              toast.success(`${p.fullName} status → ${next}`);
                            } catch (err: any) {
                              // e.g. maker-checker: the creator cannot approve (db/pending/176)
                              toast.error(err?.message ?? t("approvals.contractApproveFailed"));
                            }
                          }}
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold outline-none focus:ring-2 ring-brand ${STATUS_TONE[status]}`}
                        >
                          {(
                            [
                              "Missing Data",
                              "Pending Contract",
                              "Signed - Awaiting Review",
                              "Active",
                            ] as ContractStatus[]
                          ).map((s) => (
                            <option key={s} value={s} className="bg-surface-2 text-foreground">
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        {(() => {
                          const locked =
                            status === "Signed - Awaiting Review" || status === "Active";
                          const approval = p.approvalStatus ?? null;
                          const unlocked = approval === "Approved";
                          const editDisabled = locked && !unlocked;
                          return (
                            <div className="flex items-center gap-1 flex-wrap">
                              {status !== "Active" && (
                                <button
                                  onClick={async () => {
                                    try {
                                      await updatePerson(p.id, { contractStatus: "Active" });
                                      toast.success(`${p.fullName} contract approved`);
                                    } catch (err: any) {
                                      toast.error(
                                        err?.message ?? t("approvals.contractApproveFailed"),
                                      );
                                    }
                                  }}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-success/15 text-success border border-success/30 hover:bg-success/25"
                                  title={t("crewcastcontracts.approve_contract_active")}
                                >
                                  <Check className="size-3.5" /> Approve
                                </button>
                              )}
                              {locked && !approval && (
                                <button
                                  onClick={() => openModRequest(p)}
                                  className="px-2 py-1 rounded-lg text-xs bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25"
                                  title={t(
                                    "crewcastcontracts.request_modification_overtime_addendum",
                                  )}
                                >
                                  {t("crewcastcontracts.request_modification")}
                                </button>
                              )}
                              {approval === "Pending Admin Approval" && (
                                <>
                                  <span
                                    className="px-2 py-1 rounded-lg text-xs bg-warning/15 text-warning border border-warning/30"
                                    title={p.approvalDescription ?? ""}
                                  >
                                    Pending Approval · {p.approvalReason}
                                  </span>
                                  <button
                                    onClick={async () => {
                                      await updatePerson(p.id, { approvalStatus: "Approved" });
                                      toast.success(
                                        `${p.fullName}: modification approved — form unlocked`,
                                      );
                                    }}
                                    className="px-2 py-1 rounded-lg text-xs bg-info/15 text-info border border-info/30 hover:bg-info/25"
                                    title={t(
                                      "crewcastcontracts.admin_approve_modification_request",
                                    )}
                                  >
                                    {t("crewcastcontracts.admin_approve")}
                                  </button>
                                  <button
                                    onClick={async () => {
                                      await updatePerson(p.id, {
                                        approvalStatus: null,
                                        approvalReason: null,
                                        approvalDescription: null,
                                      });
                                      toast.success(t("crewcastcontracts.request_cancelled"));
                                    }}
                                    className="px-2 py-1 rounded-lg text-xs hover:bg-muted"
                                    title={t("crewcastcontracts.cancel_request")}
                                  >
                                    {t("platform.ui.cancel")}
                                  </button>
                                </>
                              )}
                              {unlocked && (
                                <span className="px-2 py-1 rounded-lg text-xs bg-success/15 text-success border border-success/30">
                                  Unlocked
                                </span>
                              )}
                              <button
                                onClick={() => !editDisabled && openEdit(p)}
                                disabled={editDisabled}
                                className={`p-1.5 rounded-lg ${editDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"}`}
                                title={
                                  editDisabled ? "Locked — request modification to edit" : "Edit"
                                }
                              >
                                <Pencil className="size-4" />
                              </button>
                              <AttachmentLinkBadge
                                url={p.attachmentUrl}
                                compact
                                title={`Open cloud attachment for ${p.fullName}`}
                              />
                              <AttachmentsButton
                                entityType={kind === "cast" ? "cast" : "crew"}
                                entityId={p.id}
                                entityLabel={p.fullName}
                              />
                              <button
                                onClick={() => openDuplicate(p)}
                                className="p-1.5 rounded-lg hover:bg-muted"
                                title={t("crewcastcontracts.duplicate_as_a_new_draft_contract")}
                                aria-label={`Duplicate contract for ${p.fullName}`}
                              >
                                <Copy className="size-4" />
                              </button>
                              <button
                                onClick={() => onDelete(p)}
                                className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive"
                                title={t("platform.ui.delete")}
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
                {!storeReady && list.length === 0 && (
                  <tr>
                    <td colSpan={15} className="p-0">
                      <TableSkeleton rows={6} cols={6} />
                    </td>
                  </tr>
                )}
                {storeReady && list.length === 0 && (
                  <TableEmptyRow
                    colSpan={15}
                    title={`No ${kind} contracts yet`}
                    description={`Create a ${kind} contract to track deal terms, payment schedules and payroll sync for this project.`}
                  />
                )}
              </tbody>
            </table>
            <TablePagination {...peoplePagination} />
          </div>
        </Panel>

        {open && (
          <Modal
            onClose={close}
            title={`${editing ? "Edit" : template ? "Duplicate" : "New"} ${title} Contract`}
          >
            <ContractFormGate
              kind={kind}
              initial={editing ?? template}
              isDuplicate={!!template}
              onSubmit={async (p, budgetCode, extras) => {
                const total = extras.contractAmount;
                // Contract status logic: uploading a PDF flips status to "Signed - Awaiting Review";
                // otherwise keep the existing status (or default to "Pending Contract" for new entries).
                const uploadedNow = !!extras.attachmentPath;
                const prevStatus: ContractStatus = (editing?.contractStatus ??
                  "Pending Contract") as ContractStatus;
                const nextStatus: ContractStatus = uploadedNow
                  ? "Signed - Awaiting Review"
                  : editing
                    ? prevStatus
                    : "Pending Contract";
                const nextPath = extras.attachmentPath ?? editing?.contractPath ?? null;
                const personWithStatus: Person = {
                  ...p,
                  projectId: activeProjectId,
                  organizationId: activeProject?.organizationId ?? null,
                  contractStatus: nextStatus,
                  contractPath: nextPath,
                  // Re-lock after admin-approved modification is saved
                  approvalStatus:
                    editing?.approvalStatus === "Approved"
                      ? null
                      : (editing?.approvalStatus ?? null),
                  approvalReason:
                    editing?.approvalStatus === "Approved"
                      ? null
                      : (editing?.approvalReason ?? null),
                  approvalDescription:
                    editing?.approvalStatus === "Approved"
                      ? null
                      : (editing?.approvalDescription ?? null),
                };

                const ledgerEntries = extras.paymentLedger.map((r) => ({
                  id: r.id,
                  date: r.date,
                  amount: Number(r.amount) || 0,
                  bankRef: r.bankRef,
                  proofPath: r.proofPath,
                }));

                try {
                  if (editing) {
                    await updatePerson(editing.id, personWithStatus);
                    // Keep payroll in sync with the contract (source of truth)
                    await syncPayrollForContract(editing.id, {
                      name: p.fullName,
                      kind,
                      totalAmount: total,
                      budgetCode: budgetCode || null,
                      paymentSchedule: extras.paymentSchedule,
                      whtPercent: extras.whtPercent,
                      whtAmount: extras.whtAmount,
                      netPayable: extras.netPayable,
                      whtTreatment: extras.whtTreatment,
                    });
                    await setPayrollLedger(editing.id, ledgerEntries);
                    if (budgetCode) {
                      try {
                        await ensureBudgetCode(budgetCode);
                      } catch (e) {
                        console.error(e);
                      }
                    }
                    toast.success(
                      uploadedNow
                        ? `${p.fullName} updated — contract submitted for review`
                        : `${p.fullName} updated`,
                    );
                  } else {
                    const submitPayload = {
                      ...personWithStatus,
                      kind,
                      projectId: activeProjectId,
                      organizationId: activeProject?.organizationId ?? null,
                    };
                    console.log("SUBMIT PAYLOAD:", submitPayload);
                    await addPerson(submitPayload);
                    await addPayroll({
                      id: generateId(),
                      refId: p.id,
                      name: p.fullName,
                      kind,
                      totalAmount: total,
                      payments: [],
                      receipts: [],
                      percents: [],
                      budgetCode: budgetCode || null,
                      ledger: [],
                      paymentSchedule: extras.paymentSchedule,
                      whtPercent: extras.whtPercent,
                      whtAmount: extras.whtAmount,
                      netPayable: extras.netPayable,
                      whtTreatment: extras.whtTreatment,
                    });
                    if (ledgerEntries.length > 0) {
                      await setPayrollLedger(p.id, ledgerEntries);
                    }

                    // Ensure the master_budget row exists so future Paid txns can attach.
                    if (budgetCode) {
                      try {
                        await ensureBudgetCode(budgetCode);
                      } catch (e) {
                        console.error(e);
                      }
                    }
                    toast.success(
                      uploadedNow
                        ? `${p.fullName} added — contract submitted for review`
                        : `${p.fullName} added to ${title}`,
                    );
                  }
                  close();
                } catch (err) {
                  toast.error(humanizeDbError(err));
                }
              }}
            />
          </Modal>
        )}

        {modRequest && (
          <Modal onClose={closeModRequest} title={`Request Modification — ${modRequest.fullName}`}>
            <form
              className="grid gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!modDescription.trim()) {
                  toast.error(t("crewcastcontracts.please_add_a_brief_description"));
                  return;
                }
                await updatePerson(modRequest.id, {
                  approvalStatus: "Pending Admin Approval",
                  approvalReason: modReason,
                  approvalDescription: modDescription.trim(),
                });
                toast.success(
                  t("crewcastcontracts.modification_request_submitted_for_admin_approval"),
                );
                closeModRequest();
              }}
            >
              <label className="text-sm">
                <div className="text-muted-foreground mb-1">{t("platform.ui.reason")}</div>
                <select
                  value={modReason}
                  onChange={(e) => setModReason(e.target.value as "Overtime" | "Contract Addendum")}
                  className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
                >
                  <option value="Overtime">{t("platform.ui.overtime")}</option>
                  <option value="Contract Addendum">
                    {t("crewcastcontracts.contract_addendum")}
                  </option>
                </select>
              </label>
              <label className="text-sm">
                <div className="text-muted-foreground mb-1">{t("platform.ui.description")}</div>
                <textarea
                  value={modDescription}
                  onChange={(e) => setModDescription(e.target.value)}
                  rows={4}
                  placeholder={t("crewcastcontracts.briefly_describe_the_requested_change")}
                  className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand resize-none"
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeModRequest}
                  className="px-4 py-2 rounded-xl hover:bg-muted text-sm"
                >
                  {t("platform.ui.cancel")}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-brand text-brand-foreground font-semibold text-sm"
                >
                  {t("crewcastcontracts.submit_request")}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </LockGuard>
    </>
  );
}

export function Modal({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm grid place-items-center z-50 p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl border border-border p-6 max-w-2xl w-full max-h-[90vh] overflow-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button onClick={onClose} className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SearchableCountrySelect({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return COUNTRIES;
    const q = query.toLowerCase();
    return COUNTRIES.filter((c) => c.toLowerCase().includes(q));
  }, [query]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-start outline-none focus:ring-2 ring-brand flex items-center justify-between"
      >
        <span className={value ? "" : "text-muted-foreground"}>
          {value || placeholder || "Select..."}
        </span>
        <ChevronDown className="size-4 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-surface-2 border border-border rounded-xl shadow-xl max-h-60 overflow-auto">
          <div className="sticky top-0 bg-surface-2 border-b border-border px-3 py-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("crewcastcontracts.search_countries")}
              className="w-full bg-transparent outline-none text-sm"
              autoFocus
            />
          </div>
          <div className="py-1">
            {filtered.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-start px-3 py-1.5 hover:bg-muted text-sm"
              >
                {c}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {t("crewcastcontracts.no_results_found")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type HydratedSchedule = {
  id: string;
  label: string;
  percent: number;
  dueDate: string;
  amount: number | null;
  /** Workflow/execution fields (status, proof, paid date…) carried through a re-save. */
  extra?: ScheduleExtra;
};

const SCHEDULE_EXTRA_KEYS = [
  "status",
  "proofPath",
  "paidDate",
  "paidRef",
  "paymentMethod",
  "sourceAccount",
  "receiptUrl",
  "paidNotes",
] as const;

type ScheduleExtra = Partial<Pick<PaymentScheduleItem, (typeof SCHEDULE_EXTRA_KEYS)[number]>>;

function scheduleExtra(r: any): ScheduleExtra {
  const out: Record<string, unknown> = {};
  for (const k of SCHEDULE_EXTRA_KEYS) if (r?.[k] != null) out[k] = r[k];
  return out as ScheduleExtra;
}

/**
 * Hydration gate for the edit form.
 *
 * The Zustand store can still be loading (or be stale) when the modal opens,
 * which previously let the form initialize with the 50/50 default and an empty
 * attachment URL — and then save that over the real data. This wrapper fetches
 * the authoritative row straight from the database, explicitly selecting
 * `payment_schedule` and `attachment_url`, and only mounts the form once the
 * payload has arrived and been parsed as an array.
 */
function ContractFormGate(props: {
  onSubmit: (p: Person, budgetCode: string | null, extras: ContractExtras) => void | Promise<void>;
  kind: "crew" | "cast";
  initial?: Person | null;
  isDuplicate?: boolean;
}) {
  const { t } = useTranslation();

  const { initial, isDuplicate } = props;
  const needsFetch = !!initial && !isDuplicate;
  const [loading, setLoading] = useState(needsFetch);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [hydrated, setHydrated] = useState<Person | null | undefined>(() =>
    needsFetch ? null : initial,
  );
  const [schedule, setSchedule] = useState<HydratedSchedule[] | null>(null);

  useEffect(() => {
    if (!needsFetch || !initial) {
      setHydrated(initial);
      setSchedule(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setHydrated(null);
    setSchedule(null);
    (async () => {
      try {
        const [personRes, payrollRes] = await Promise.all([
          supabase.from("people").select("attachment_url").eq("id", initial.id).maybeSingle(),
          supabase
            .from("payroll")
            .select("payment_schedule")
            .eq("ref_id", initial.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        if (personRes.error) throw personRes.error;
        if (payrollRes.error) throw payrollRes.error;

        const url = (personRes.data as any)?.attachment_url ?? initial.attachmentUrl ?? null;
        setHydrated({ ...initial, attachmentUrl: url });

        const raw = (payrollRes.data as any)?.payment_schedule;
        setSchedule(parseHydratedSchedule(raw) ?? []);
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e?.message ?? "Could not load the saved contract details.");
          toast.error(e?.message ?? "Could not load the saved contract details.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id, needsFetch, retryKey]);

  if (loading) {
    return (
      <div className="p-8 text-sm text-muted-foreground text-center grid place-items-center gap-3">
        <Loader2 className="size-5 animate-spin text-primary" />
        <span>Loading saved contract details…</span>
      </div>
    );
  }

  if (needsFetch && (loadError || !hydrated || schedule === null)) {
    return (
      <div className="p-6 text-sm text-center space-y-3">
        <div className="text-destructive font-semibold">
          {t("crewcastcontracts.saved_contract_details_could_not_be_loaded")}
        </div>
        <div className="text-muted-foreground">
          The edit form is blocked to prevent overwriting the saved payment schedule or attachment
          URL.
        </div>
        {loadError && <div className="text-xs text-muted-foreground break-words">{loadError}</div>}
        <button
          type="button"
          onClick={() => setRetryKey((v) => v + 1)}
          className="px-4 py-2 rounded-xl bg-surface-2 border border-border hover:bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <ContractForm {...props} initial={hydrated} scheduleOverride={needsFetch ? schedule : null} />
  );
}

function safeJsonArray(raw: string): any[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseHydratedSchedule(raw: unknown): HydratedSchedule[] | null {
  const parsed = typeof raw === "string" ? safeJsonArray(raw) : raw;
  if (!Array.isArray(parsed)) return null;
  return parsed.map((r: any) => ({
    id: r?.id ?? generateId(),
    label: r?.label ?? "",
    percent: Number(r?.percent) || 0,
    dueDate: r?.dueDate ?? r?.due_date ?? "",
    amount:
      r?.amount === null || r?.amount === undefined || r?.amount === "" ? null : Number(r.amount),
    extra: scheduleExtra(r),
  }));
}

function attachmentRecordsForProject(people: Person[], invoices: Invoice[]): AttachmentUrlRecord[] {
  return [
    ...people.map((p) => ({
      id: `person:${p.id}`,
      projectId: p.projectId,
      url: p.attachmentUrl,
      label: `contract: ${p.fullName || "Unnamed"}`,
    })),
    ...invoices.map((i) => ({
      id: `invoice:${i.id}`,
      projectId: i.projectId,
      url: i.attachmentUrl,
      label: `invoice: ${i.invoiceNo || i.vendorName || i.description || "Unnamed"}`,
    })),
  ];
}

function ContractForm({
  onSubmit,
  kind,
  initial,
  isDuplicate = false,
  scheduleOverride = null,
}: {
  onSubmit: (p: Person, budgetCode: string | null, extras: ContractExtras) => void | Promise<void>;
  kind: "crew" | "cast";
  initial?: Person | null;
  /** Prefilled copy of another contract — saves as a brand-new record. */
  isDuplicate?: boolean;
  /** Authoritative payment schedule fetched from the DB before mount. */
  scheduleOverride?: HydratedSchedule[] | null;
}) {
  const { t } = useTranslation();
  const payrollRow = useStore((s) =>
    initial ? s.payroll.find((r) => r.refId === initial.id) : undefined,
  );
  const peopleForAttachmentChecks = useStore((s) => s.people);
  const invoicesForAttachmentChecks = useStore((s) => s.invoices);

  const isEdit = !!initial && !isDuplicate;
  const baseCurrency = useBaseCurrency();
  // E01: the person is picked from the organization's profiles.
  const personsOrgId = useStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.organizationId ?? null,
  );
  const { persons, available: personsAvailable } = usePersons(personsOrgId);
  const personContractCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of peopleForAttachmentChecks)
      if (p.personId) m.set(p.personId, (m.get(p.personId) ?? 0) + 1);
    return m;
  }, [peopleForAttachmentChecks]);
  const [f, setF] = useState<Person>(() =>
    initial
      ? {
          ...initial,
          idType: initial.idType ?? guessIdType(initial.idNumber, initial.nationality),
          whtTreatment: initial.whtTreatment ?? "inclusive",
        }
      : {
          id: generateId(),
          kind,
          fullName: "",
          position: "",
          nationality: "",
          idNumber: "",
          iban: "",
          bank: "",
          bankCountry: "",
          swiftCode: "",
          startDate: "",
          endDate: "",
          shootingDays: 0,
          dailyRate: 0,
          perDiem: 0,
          onSetPerDiem: 0,
          offSetPerDiem: 0,
          housingAllowance: 0,
          // B25: a new contract starts in the project base currency.
          ccy: baseCurrency,
          paymentTerm: 100,
          character: "",
          requiresTransport: false,
          isDriver: false,
          accommodationId: null,
          isPurchaser: false,
          isPettyCashCustodian: false,
          linkedBudgetLineId: null,
          dealType: "weekly",
          overtimeRate: null,
          overtimeUnit: null,
          phoneNumber: "",
          email: "",
          whtTreatment: "inclusive",
          taxResidency: null,
          whtServiceType: null,
          whtRate: null,
          idType: null,
          motherSaudi: null,
          relatedParty: null,
        },
  );
  // Deal type drives which financial inputs are shown. Legacy rows fall back to "weekly".
  const dealType = normalizeDealType(f.dealType);
  const [dailyDays, setDailyDays] = useState<number>(
    initial && normalizeDealType(initial.dealType) === "daily"
      ? Number(initial.shootingDays || 0)
      : 0,
  );
  const [packageAmount, setPackageAmount] = useState<number>(
    initial && normalizeDealType(initial.dealType) === "package"
      ? Number(initial.dailyRate || 0) * Math.max(Number(initial.shootingDays || 1), 1)
      : 0,
  );
  const [dailyRateInput, setDailyRateInput] = useState<number>(
    initial && normalizeDealType(initial.dealType) === "daily" ? Number(initial.dailyRate || 0) : 0,
  );
  // Active accommodation roster entries for the current project (for the dropdown below)
  const activeProjectId = useStore((s) => s.activeProjectId);
  // Project-level USD -> SAR rate drives the budget-tracker conversion below.
  const fxRate = useStore((s) => {
    const r = Number(s.projects.find((p) => p.id === s.activeProjectId)?.fxRate);
    return Number.isFinite(r) && r > 0 ? r : 3.75;
  });
  const [accommodations, setAccommodations] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeProjectId) {
        setAccommodations([]);
        return;
      }
      const { data } = await supabase
        .from("accommodations")
        .select("id, hotel_name, room_number")
        .eq("project_id", activeProjectId)
        .order("hotel_name", { ascending: true });
      if (cancelled) return;
      setAccommodations(
        (data ?? []).map((r: any) => ({
          id: r.id,
          label: `${r.hotel_name ?? "—"}${r.room_number ? ` · Room ${r.room_number}` : ""}`,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  // Load characters for cast contracts so the "Character" field is a relational picker
  // instead of a free-text input.
  const [characterOpts, setCharacterOpts] = useState<
    Array<{ id: string; name: string; role_type: string; budget_line_id: string | null }>
  >([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "cast" || !activeProjectId) {
      setCharacterOpts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("characters" as any)
        .select("id, name, role_type, budget_line_id")
        .eq("project_id", activeProjectId)
        .order("name");
      if (cancelled) return;
      setCharacterOpts((data ?? []) as any);
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, activeProjectId]);
  const [headerCode, setHeaderCode] = useState<string>("");
  const [mainCode, setMainCode] = useState<string>("");
  const [selectedBudgetLineId, setSelectedBudgetLineId] = useState<string | null>(
    initial?.linkedBudgetLineId ?? null,
  );
  const [projectBudgetLines, setProjectBudgetLines] = useState<ProjectBudgetLine[]>([]);
  useEffect(() => {
    if (!activeProjectId) {
      setProjectBudgetLines([]);
      return;
    }
    let cancelled = false;
    fetchProjectBudgetLines(activeProjectId)
      .then((rows) => {
        if (!cancelled) setProjectBudgetLines(rows);
      })
      .catch(() => {
        if (!cancelled) setProjectBudgetLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (headerCode || mainCode) return;
    const exact = selectedBudgetLineId
      ? projectBudgetLines.find((line) => line.id === selectedBudgetLineId)
      : null;
    const fromExistingCode =
      !exact && payrollRow?.budgetCode
        ? projectBudgetLines.find((line) => line.mainCode === payrollRow.budgetCode)
        : null;
    const selected = exact ?? fromExistingCode ?? null;
    if (!selected) return;
    setSelectedBudgetLineId(selected.id);
    setHeaderCode(parentHeaderCodeForLine(selected));
    setMainCode(selected.mainCode);
  }, [headerCode, mainCode, payrollRow?.budgetCode, projectBudgetLines, selectedBudgetLineId]);
  // Tax residency: suggested from nationality + bank country until the user
  // picks a value (or the record already carries a confirmed one).
  const [residencyTouched, setResidencyTouched] = useState<boolean>(!!initial?.taxResidency);
  const suggestedResidency = suggestTaxResidency({
    nationality: f.nationality,
    bankCountry: f.bankCountry,
  });
  const taxResidency: TaxResidency =
    residencyTouched && f.taxResidency ? f.taxResidency : suggestedResidency;
  // Crew position: fixed list, "Other" keeps free text.
  const [positionChoice, setPositionChoice] = useState<string>(() =>
    positionSelectValue(initial?.position),
  );

  // Crew-specific
  const [weeklyRate, setWeeklyRate] = useState<number>(
    initial && kind === "crew" ? initial.dailyRate : 0,
  );
  const [ledger, setLedger] = useState<PaymentLedgerRow[]>(
    (payrollRow?.ledger ?? []).length > 0
      ? payrollRow!.ledger!.map((e) => ({
          id: e.id,
          date: e.date,
          amount: e.amount,
          bankRef: e.bankRef,
          proofPath: e.proofPath,
          proofFile: null,
        }))
      : [],
  );
  type PaymentTermRow = {
    id: string;
    label: string;
    percent: number;
    dueDate: string;
    amount?: number | null;
  };
  // Hydration: an existing contract MUST open with its persisted milestones.
  // Falling back to the 50/50 default would silently overwrite the real
  // schedule on save.
  const scheduleFromRecord = (row: typeof payrollRow): PaymentTermRow[] | null => {
    const rows = row?.paymentSchedule;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows.map((r) => ({
      id: r.id ?? generateId(),
      label: r.label ?? "",
      percent: Number(r.percent) || 0,
      dueDate: r.dueDate ?? "",
      // Persisted flat amounts stay authoritative so re-saving can't re-derive
      // (and round) them away.
      amount: r.amount != null && Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
    }));
  };
  // The DB-fetched schedule (when editing) always wins over the store copy.
  const overrideSchedule: PaymentTermRow[] | null =
    scheduleOverride !== null
      ? scheduleOverride.map((r) => ({
          id: r.id,
          label: r.label,
          percent: r.percent,
          dueDate: r.dueDate,
          amount: r.amount != null && Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
        }))
      : null;
  const [schedule, setSchedule] = useState<PaymentTermRow[]>(() =>
    isEdit
      ? (overrideSchedule ?? scheduleFromRecord(payrollRow) ?? [])
      : (overrideSchedule ??
        scheduleFromRecord(payrollRow) ?? [
          { id: generateId(), label: "On Signing", percent: 50, dueDate: "", amount: null },
          { id: generateId(), label: "On Wrap", percent: 50, dueDate: "", amount: null },
        ]),
  );
  // The payroll row can arrive after first render (store still loading). Hydrate
  // once when it does, unless the user already touched the schedule.
  const scheduleHydrated = useRef(isEdit || !!overrideSchedule || !!scheduleFromRecord(payrollRow));

  const scheduleTouched = useRef(false);
  useEffect(() => {
    if (scheduleHydrated.current || scheduleTouched.current || !initial) return;
    const fromRecord = scheduleFromRecord(payrollRow);
    if (!fromRecord) return;
    scheduleHydrated.current = true;
    setSchedule(fromRecord);
  }, [initial, payrollRow]);

  // Same guarantee for the cloud attachment URL: if the record carries one and
  // the form is still blank (late store hydration), restore it rather than
  // saving an empty string over it.
  useEffect(() => {
    if (!initial || isDuplicate) return;
    const url = initial.attachmentUrl;
    if (!url) return;
    setF((prev) => (prev.attachmentUrl ? prev : { ...prev, attachmentUrl: url }));
  }, [initial, isDuplicate]);
  // Workflow fields of saved milestones, re-applied on submit (edit only).
  const scheduleExtras = useMemo(() => {
    const m = new Map<string, ScheduleExtra>();
    if (!isEdit) return m;
    for (const r of payrollRow?.paymentSchedule ?? []) m.set(r.id, scheduleExtra(r));
    for (const r of scheduleOverride ?? []) if (r.extra) m.set(r.id, r.extra);
    return m;
  }, [isEdit, payrollRow, scheduleOverride]);
  const [lastAddedRowId, setLastAddedRowId] = useState<string | null>(null);
  const scheduleTotalPct = schedule.reduce((a, r) => a + (Number(r.percent) || 0), 0);

  // Field-level mirror of the server precision trigger: which milestone, which
  // field (amount / percent) and why it would be rejected.
  const scheduleFieldErrors = useMemo(() => {
    const list = validatePaymentSchedule(
      schedule.map((r) => ({
        id: r.id,
        label: r.label,
        percent: r.percent,
        amount: r.amount ?? null,
      })),
    );
    const map: Record<string, Partial<Record<"amount" | "percent", string>>> = {};
    for (const e of list) {
      if (!e.id) continue;
      map[e.id] = { ...(map[e.id] ?? {}), [e.field]: e.message };
    }
    return { list, map };
  }, [schedule]);

  // New rows pre-fill with whatever is still needed to reach exactly 100%.
  const addScheduleRow = () => {
    scheduleTouched.current = true;
    setSchedule((s) => {
      const used = s.reduce((a, r) => a + (Number(r.percent) || 0), 0);
      const remaining = Math.max(0, Math.round((100 - used) * 100) / 100);
      const id = generateId();
      setLastAddedRowId(id);
      return [...s, { id, label: "", percent: remaining, dueDate: "", amount: null }];
    });
  };
  const updateScheduleRow = (id: string, patch: Partial<PaymentTermRow>) => {
    scheduleTouched.current = true;
    setSchedule((s) => s.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeScheduleRow = (id: string) => {
    scheduleTouched.current = true;
    setSchedule((s) => s.filter((r) => r.id !== id));
  };
  const [attachment, setAttachment] = useState<File | null>(null);
  // Tracks whether the user has manually overridden the off-set per-diem. Once true,
  // auto-computation (2× on-set) is disabled to preserve the manual value.
  const [offSetOverridden, setOffSetOverridden] = useState<boolean>(
    !!(
      initial &&
      initial.offSetPerDiem &&
      initial.onSetPerDiem &&
      initial.offSetPerDiem !== initial.onSetPerDiem * 2
    ),
  );
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clearErr = (k: string) => setErrors((prev) => (prev[k] ? { ...prev, [k]: "" } : prev));
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [ibanCertificate, setIbanCertificate] = useState<File | null>(null);
  const proofInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [preview, setPreview] = useState<{
    url: string;
    kind: "image" | "pdf" | "other";
    name: string;
    revoke?: boolean;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (preview?.revoke) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const detectKind = (name: string, mime?: string): "image" | "pdf" | "other" => {
    const m = (mime ?? "").toLowerCase();
    if (m.startsWith("image/")) return "image";
    if (m === "application/pdf") return "pdf";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "svg"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    return "other";
  };

  const openProofPreview = async (row: PaymentLedgerRow) => {
    try {
      if (row.proofFile) {
        const url = URL.createObjectURL(row.proofFile);
        setPreview({
          url,
          kind: detectKind(row.proofFile.name, row.proofFile.type),
          name: row.proofFile.name,
          revoke: true,
        });
        return;
      }
      if (row.proofPath) {
        const { data, error } = await storageAudited
          .from("contracts")
          .createSignedUrl(row.proofPath, 300);
        if (error) throw error;
        const name = row.proofPath.split("/").pop() ?? "proof";
        setPreview({ url: data.signedUrl, kind: detectKind(name), name });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open proof.");
    }
  };

  // Compute weeks between dates (rounded up)
  const weeks = useMemo(() => {
    if (kind !== "crew" || !f.startDate || !f.endDate) return 0;
    const ms = new Date(f.endDate).getTime() - new Date(f.startDate).getTime();
    if (ms <= 0) return 0;
    return Math.ceil(ms / (1000 * 60 * 60 * 24 * 7));
  }, [kind, f.startDate, f.endDate]);

  const subAccounts = useMemo(
    () => subAccountsForHeader(projectBudgetLines, headerCode),
    [projectBudgetLines, headerCode],
  );

  const selectedLine = selectedBudgetLineId
    ? projectBudgetLines.find((b) => b.id === selectedBudgetLineId)
    : subAccounts.find((b) => b.mainCode === mainCode);
  // Budget lines carry their own currency; compare in the base currency.
  const planned = selectedLine
    ? projectBudgetLineTotal(selectedLine) *
      (rateToBase(selectedLine.currency, baseCurrency, fxRate) ?? 1)
    : 0;
  const organizationId = useStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.organizationId ?? null,
  );
  const whtRules = useWhtRateRules(organizationId);
  const whtServiceTypes = useMemo(
    () => Array.from(new Set(["default", ...whtRules.map((r) => r.serviceType)])),
    [whtRules],
  );

  // Many-to-one: everything already committed against this exact budget row by
  // OTHER contracts / POs (multiple drivers on the same code is normal).
  const [otherCommitted, setOtherCommitted] = useState(0);
  const [otherCommittedCount, setOtherCommittedCount] = useState(0);
  useEffect(() => {
    const lineId = selectedLine?.id;
    if (!activeProjectId || !lineId) {
      setOtherCommitted(0);
      setOtherCommittedCount(0);
      return;
    }
    let cancelled = false;
    fetchLineCommitments(activeProjectId, lineId, initial?.id ?? null, (amount, ccy) => {
      const r = rateToBase(ccy || baseCurrency, baseCurrency, fxRate);
      return r == null ? null : amount * r;
    })
      .then((rows) => {
        if (cancelled) return;
        setOtherCommitted(sumLineCommitments(rows));
        setOtherCommittedCount(rows.length);
      })
      .catch(() => {
        if (!cancelled) {
          setOtherCommitted(0);
          setOtherCommittedCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, selectedLine?.id, initial?.id, baseCurrency, fxRate]);

  // ---- Budget Code mapping validation (warn before saving) ----
  const effectiveCode = selectedLine?.mainCode || mainCode || "";
  const [masterCode, setMasterCode] = useState<MasterCodeInfo | null | undefined>(undefined);
  useEffect(() => {
    if (!effectiveCode) {
      setMasterCode(undefined);
      return;
    }
    let cancelled = false;
    fetchMasterCodes([effectiveCode])
      .then((m) => {
        if (!cancelled) setMasterCode(m.get(effectiveCode) ?? null);
      })
      .catch(() => {
        if (!cancelled) setMasterCode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveCode]);
  const mappingIssues = useMemo(
    () =>
      evaluateMapping({
        code: effectiveCode,
        headerCode,
        master: effectiveCode ? (masterCode ?? null) : null,
        matchingProjectLines: effectiveCode
          ? countLinesWithCode(projectBudgetLines, effectiveCode)
          : 0,
        // The budget_lines row UUID is the authoritative mapping key — a
        // repeated code with an exact row picked is a valid many-to-one map.
        lineId: selectedLine?.id ?? selectedBudgetLineId ?? null,
        explicitLineSelected: !!(selectedLine?.id ?? selectedBudgetLineId),
        // A code that already exists as a project budget line is a valid
        // posting target even if the shared Master COA row is missing.
        projectLineExists:
          !!effectiveCode && projectBudgetLines.some((b) => b.mainCode === effectiveCode),
      }),
    [effectiveCode, headerCode, masterCode, projectBudgetLines, selectedBudgetLineId, selectedLine],
  );

  const mappingBlocked = hasBlockingIssue(mappingIssues);

  // Total Deal = Base Rate ONLY (wages). Per Diem and Housing Allowance are
  // itemized separately in Payroll and mapped to their own GL codes — never
  // rolled into contract value or payment-schedule percentages.
  // Crew deal-type aware quantity/rate. Weekly keeps the legacy behaviour exactly.
  const crewQty = dealType === "weekly" ? weeks : dealType === "daily" ? Math.max(dailyDays, 0) : 1;
  const crewRate =
    dealType === "weekly" ? weeklyRate : dealType === "daily" ? dailyRateInput : packageAmount;
  // Agreed amount in the CONTRACT currency (before withholding).
  const contractAmount = kind === "crew" ? crewQty * crewRate : f.shootingDays * f.dailyRate;
  const contractCcy = (f.ccy || baseCurrency).toUpperCase();
  // Contract currency → project base currency (B01/B02): USD × project rate,
  // the base currency itself is never converted. null = no configured rate.
  const fxToBase = rateToBase(contractCcy, baseCurrency, fxRate);

  // Withholding tax (B04/E03): only for a confirmed non-resident; the rate
  // comes from the rate table for the service type (default 5%).
  const whtApplies = taxResidency === "non_resident";
  const whtTreatment: WhtTreatment = f.whtTreatment === "exclusive" ? "exclusive" : "inclusive";
  const ruleRate = resolveWhtRate(whtRules, f.whtServiceType);
  // A saved contract keeps its rate snapshot until its service type changes.
  const keepSavedRate =
    isEdit &&
    initial?.whtRate != null &&
    (initial.whtServiceType ?? null) === (f.whtServiceType ?? null);
  const whtPercent = whtApplies ? (keepSavedRate ? Number(initial!.whtRate) : ruleRate) : 0;
  const wht = computeWht(contractAmount, whtPercent, whtTreatment);
  const whtBase = whtInBase(wht, fxToBase ?? 1);
  // Stored figures (payroll) are in the base currency: gross = contract value
  // and budget commitment, net = what the payee receives (instalments).
  const contractAmountBase = whtBase.gross;
  const whtAmount = whtBase.wht;
  const netPayable = whtBase.net;
  const remaining = planned - otherCommitted - contractAmountBase;
  const fxBreakdown =
    fxToBase === 1
      ? `${formatAmount(wht.gross, 2)} ${contractCcy}`
      : fxToBase == null
        ? t("contracts.fx.no_rate", { ccy: contractCcy, base: baseCurrency })
        : `${formatAmount(wht.gross, 2)} ${contractCcy} × ${Number(fxToBase.toFixed(4))} = ${formatAmount(contractAmountBase, 2)} ${baseCurrency}`;
  // A contract saved before the base-currency fix carries its payroll figures
  // in the contract currency (e.g. 2,000 "SAR" for a 2,000 USD deal). Its
  // flat milestone amounts are in that currency too, so let unpaid milestones
  // re-derive from their percent on the converted net instead.
  const legacyUnconverted = useRef<boolean | null>(null);
  useEffect(() => {
    if (legacyUnconverted.current !== null || !isEdit || !payrollRow) return;
    legacyUnconverted.current =
      fxToBase != null && fxToBase !== 1 && Math.abs(payrollRow.totalAmount - wht.gross) < 0.01;
    if (!legacyUnconverted.current) return;
    setSchedule((rows) =>
      rows.map((r) => (scheduleExtras.get(r.id)?.status === "Paid" ? r : { ...r, amount: null })),
    );
  }, [isEdit, payrollRow, fxToBase, wht.gross, scheduleExtras]);

  // Honours explicit flat-amount overrides on individual milestones.
  const scheduleAllocated = schedule.reduce(
    (a, r) => a + resolveSplitAmount(r.percent, netPayable, r.amount),
    0,
  );
  const attachmentDuplicate = useMemo(
    () =>
      findDuplicateAttachmentUrl(
        f.attachmentUrl,
        attachmentRecordsForProject(peopleForAttachmentChecks, invoicesForAttachmentChecks),
        { currentId: `person:${f.id}`, projectId: activeProjectId },
      ),
    [
      activeProjectId,
      f.attachmentUrl,
      f.id,
      invoicesForAttachmentChecks,
      peopleForAttachmentChecks,
    ],
  );

  // Warn on tab close while the contract form holds unsaved edits.
  const { dirty, reset: resetDirty } = useDirtyTracker([f, schedule, ledger]);

  // ---- Draft persistence ------------------------------------------------
  // Everything serializable in the form is mirrored to localStorage so an
  // accidental refresh / tab close / connection drop never costs typed work.
  // Files (contract PDF, ID, IBAN, ledger proofs) can't be serialized and are
  // deliberately excluded.
  const dKey = draftKey("contract", kind, activeProjectId ?? "no-project", initial?.id ?? "new");
  // Version of the record this form was opened with — if someone else saved
  // changes since the draft was written, the draft is dropped, not replayed.
  const draftVersion = useMemo(() => recordVersion(initial ?? null), [initial]);
  const draftSnapshot = useMemo(
    () => ({
      f,
      schedule,
      headerCode,
      mainCode,
      selectedBudgetLineId,
      residencyTouched,
      positionChoice,
      dailyDays,
      packageAmount,
      dailyRateInput,
      weeklyRate,
    }),
    [
      f,
      schedule,
      headerCode,
      mainCode,
      selectedBudgetLineId,
      residencyTouched,
      positionChoice,
      dailyDays,
      packageAmount,
      dailyRateInput,
      weeklyRate,
    ],
  );
  const { clear: clearContractDraft } = useFormDraft(
    dKey,
    draftSnapshot,
    (saved: any) => {
      if (!saved) return;
      if (saved.f) setF(saved.f);
      if (Array.isArray(saved.schedule) && saved.schedule.length) setSchedule(saved.schedule);
      if (saved.headerCode) setHeaderCode(saved.headerCode);
      if (saved.mainCode) setMainCode(saved.mainCode);
      if (saved.selectedBudgetLineId) setSelectedBudgetLineId(saved.selectedBudgetLineId);
      if (typeof saved.residencyTouched === "boolean") setResidencyTouched(saved.residencyTouched);
      if (typeof saved.positionChoice === "string") setPositionChoice(saved.positionChoice);
      if (typeof saved.dailyDays === "number") setDailyDays(saved.dailyDays);
      if (typeof saved.packageAmount === "number") setPackageAmount(saved.packageAmount);
      if (typeof saved.dailyRateInput === "number") setDailyRateInput(saved.dailyRateInput);
      if (typeof saved.weeklyRate === "number") setWeeklyRate(saved.weeklyRate);
      toast.info(t("crewcastcontracts.unsaved_draft_restored"));
    },
    {
      enabled: !isEdit,
      version: draftVersion,
      onConflict: () =>
        toast.warning(t("crewcastcontracts.this_record_was_updated_elsewhere_your_older_unsaved")),
    },
  );

  useUnsavedChangesWarning(dirty);

  const set = (k: keyof Person) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === "number" ? +e.target.value : e.target.value } as Person);

  // Field list differs per kind
  const fields: [keyof Person, string, string][] =
    kind === "cast"
      ? [
          ["fullName", t("crewcast.fullName"), "text"],
          ["character", t("crewcast.character"), "text"],
          ["idNumber", t("crewcast.id"), "text"],
          ["iban", t("crewcast.iban"), "text"],
          ["bank", t("crewcast.bank"), "text"],
          ["startDate", t("crewcast.startDate"), "date"],
          ["endDate", t("crewcast.endDate"), "date"],
          ["shootingDays", t("crewcast.shootingDays"), "number"],
          ["dailyRate", t("crewcast.dailyRate"), "number"],
        ]
      : [
          ["fullName", t("crewcast.fullName"), "text"],
          ["position", t("crewcast.position"), "text"],
          ["idNumber", t("crewcast.id"), "text"],
          ["iban", t("crewcast.iban"), "text"],
          ["bank", t("crewcast.bank"), "text"],
          ["startDate", t("crewcast.startDate"), "date"],
          ["endDate", t("crewcast.endDate"), "date"],
        ];

  const ledgerPaid = ledger.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const ledgerValid = ledger.every(
    (r) =>
      r.date && Number(r.amount) > 0 && r.bankRef.trim().length > 0 && (r.proofFile || r.proofPath),
  );

  const addLedgerRow = () =>
    setLedger([
      ...ledger,
      { id: generateId(), date: "", amount: 0, bankRef: "", proofPath: null, proofFile: null },
    ]);
  const updateLedgerRow = (id: string, patch: Partial<PaymentLedgerRow>) =>
    setLedger(ledger.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeLedgerRow = (id: string) => setLedger(ledger.filter((r) => r.id !== id));

  const uploadFile = async (file: File | null, subfolder: string): Promise<string | null> => {
    if (!file) return null;
    if (!activeProjectId)
      throw new Error("An active project is required before uploading contract files.");
    // Storage keys must be ASCII — filenames with Arabic/CJK/spaces are rejected
    // by Supabase Storage. Use a UUID-based key and preserve the original name
    // via the `name` metadata below when the caller stores it.
    const dot = file.name.lastIndexOf(".");
    const rawExt = dot > -1 ? file.name.slice(dot + 1) : "";
    const ext = rawExt
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 10)
      .toLowerCase();
    const suffix = ext ? `.${ext}` : "";
    assertUploadAllowed(file);
    const path = `${activeProjectId}/${kind}/${f.id}/${subfolder}/${crypto.randomUUID()}${suffix}`;
    const { error } = await storageAudited.from("contracts").upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProjectId) {
      toast.error(t("crewcastcontracts.an_active_project_is_required_before_saving_this"));
      return;
    }
    // Aggregate every required-field error so all invalid fields highlight at once.
    const nextErrors: Record<string, string> = {};
    if (!f.fullName?.trim()) nextErrors.fullName = t("people.errors.name_required");
    if (kind === "crew" && !f.position?.trim())
      nextErrors.position =
        positionChoice === POSITION_OTHER
          ? t("contracts.errors.position_other_required")
          : "Position is required.";
    if (kind === "cast" && !f.character?.trim()) nextErrors.character = "Character is required.";
    // E02/B26: nationality and a valid ID are required for everyone, Saudi included.
    if (!f.nationality?.trim()) nextErrors.nationality = t("contracts.errors.nationality_required");
    const idErr = validateIdNumber(f.idType ?? null, f.idNumber);
    if (idErr) nextErrors.idNumber = t(`contracts.errors.${idErr}`);
    const ibanErr = validateIban(f.bankCountry, f.iban);
    if (ibanErr)
      nextErrors.iban = t(`contracts.errors.${ibanErr}`, {
        code: ibanCountryCode(f.bankCountry) ?? "",
        length: ibanLength(f.bankCountry) ?? "",
      });
    const swiftErr = validateSwift(f.bankCountry, f.swiftCode);
    if (swiftErr) nextErrors.swiftCode = t(`contracts.errors.${swiftErr}`);
    if (!f.startDate) nextErrors.startDate = "Contract Start Date is required.";
    if (!f.endDate) nextErrors.endDate = "Contract End Date is required.";
    const bankErrs = validateBankPicker({
      bankCountry: f.bankCountry ?? "",
      bankName: f.bank ?? "",
      swiftCode: f.swiftCode ?? "",
    });
    if (bankErrs.bankCountry) nextErrors.bankCountry = bankErrs.bankCountry;
    if (bankErrs.bankName) nextErrors.bank = bankErrs.bankName;

    if (f.startDate && f.endDate && new Date(f.endDate) < new Date(f.startDate)) {
      nextErrors.endDate = "End Date must be on or after Start Date.";
    }
    Object.assign(nextErrors, validateContact(f.phoneNumber, f.email));
    // R19: the Film Commission needs an explicit related-party answer (yes / no).
    if (f.relatedParty == null) nextErrors.relatedParty = t("rebate.related_party_required");
    // B25: every instalment needs a due date.
    if (schedule.some((r) => !r.dueDate))
      nextErrors.schedule = t("contracts.errors.due_date_required");
    if (fxToBase == null)
      nextErrors.ccy = t("contracts.fx.no_rate", { ccy: contractCcy, base: baseCurrency });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Please fix the highlighted fields before saving.");
      return;
    }
    // Budget Code mapping gate: hard-stop on missing/header mapping, confirm on ambiguity.
    if (mappingBlocked) {
      toast.error(
        mappingIssues.find((i) => i.severity === "error")?.message ??
          "Map this contract to a Header Account and Sub-Account before saving.",
      );
      return;
    }
    if (mappingIssues.length > 0) {
      const proceed = window.confirm(
        `Budget Code mapping warning:\n\n${mappingIssues
          .map((i) => `• ${i.message}`)
          .join("\n")}\n\nSave anyway?`,
      );
      if (!proceed) return;
    }
    if (scheduleFieldErrors.list.length > 0) {
      const [first, ...rest] = scheduleFieldErrors.list;
      toast.error(
        rest.length
          ? `${first.message} (+${rest.length} more milestone ${rest.length === 1 ? "error" : "errors"})`
          : first.message,
      );
      return;
    }
    // A05 (db/pending/180): every instalment named, the schedule equals the
    // contract (net payable) value; dates out of order only ask.
    {
      const check = checkInstalmentSchedule(schedule, netPayable);
      const first = check.errors[0];
      if (first) {
        toast.error(
          first.kind === "missing_label"
            ? t("glossary.schedule.missingLabel", { n: first.index + 1 })
            : first.kind === "missing_due_date"
              ? t("glossary.schedule.missingDueDate", { n: first.index + 1 })
              : first.kind === "sum_mismatch"
                ? t("glossary.schedule.sumMismatch", {
                    total: formatAmount(first.total, 2),
                    expected: formatAmount(first.expected, 2),
                    currency: baseCurrency,
                  })
                : t("glossary.schedule.invalid"),
        );
        return;
      }
      if (check.warnings.length > 0 && !window.confirm(t("glossary.schedule.dateOrder"))) return;
    }
    if (!isScheduleTotalValid(scheduleTotalPct)) {
      toast.error(
        `Validation Error: Payment Schedule must equal 100% (currently ${scheduleTotalPct.toFixed(2)}%).`,
      );
      return;
    }

    if (ledger.length > 0 && !ledgerValid) {
      toast.error(t("ledger.validationRequired"));
      return;
    }
    if (!isValidAttachmentUrl(f.attachmentUrl ?? "")) {
      toast.error(t("crewcastcontracts.validation_error_attachment_url_must_start_with_http"));
      return;
    }
    if (attachmentDuplicate) {
      toast.error(`Attachment URL is already used on ${attachmentDuplicate.label}.`);
      return;
    }
    if (attachment && attachment.type !== "application/pdf") {
      toast.error(t("crewcastcontracts.validation_error_contract_attachment_must_be_a_pdf"));
      return;
    }
    // E01: a new profile whose name looks like an existing one → ask first.
    if (personsAvailable && !f.personId) {
      const lookAlikes = findSimilarPersons(
        { fullName: f.fullName, idNumber: f.idNumber },
        persons,
      ).filter((m) => m.reason === "similar_name");
      if (
        lookAlikes.length > 0 &&
        !window.confirm(
          t("people.confirm_new_profile", {
            names: lookAlikes.map((m) => m.person.fullName).join(", "),
          }),
        )
      )
        return;
    }
    setUploading(true);
    let attachmentPath: string | null = null;
    let idAttachmentPath: string | null = null;
    let ibanAttachmentPath: string | null = null;
    const ledgerWithProofs: PaymentLedgerRow[] = [];
    try {
      attachmentPath = await uploadFile(attachment, "contract");
      idAttachmentPath = await uploadFile(idDocument, "id-document");
      ibanAttachmentPath = await uploadFile(ibanCertificate, "iban-certificate");
      for (const row of ledger) {
        let path = row.proofPath;
        if (row.proofFile) {
          path = await uploadFile(row.proofFile, `ledger-proof/${row.id}`);
        }
        ledgerWithProofs.push({ ...row, proofPath: path });
      }
    } catch (err: any) {
      setUploading(false);
      toast.error(err?.message ?? "File upload failed. Please try again.");
      return;
    }
    setUploading(false);

    const payload: Person = {
      ...f,
      linkedBudgetLineId: selectedLine?.id ?? null,
      nationality: f.nationality?.trim() ?? "",
      iban: ibanCountryCode(f.bankCountry) ? normalizeIban(f.iban) : (f.iban ?? "").trim(),
      swiftCode: (f.swiftCode ?? "").replace(/\s/g, "").toUpperCase(),
      idNumber: (f.idNumber ?? "").trim(),
      ccy: contractCcy,
      position: kind === "cast" ? f.position || "" : (f.position ?? "").trim(),
      // Only a non-Saudi can have a Saudi mother; the flag is meaningless otherwise.
      motherSaudi: f.nationality === SAUDI_ARABIA ? null : (f.motherSaudi ?? false),
      relatedParty: f.relatedParty ?? null,
      taxResidency,
      whtTreatment,
      whtServiceType: whtApplies ? (f.whtServiceType ?? "default") : null,
      whtRate: whtApplies ? whtPercent : null,
      attachmentUrl: normalizeAttachmentUrl(f.attachmentUrl),
      idAttachmentPath: idAttachmentPath ?? initial?.idAttachmentPath ?? null,
      ibanAttachmentPath: ibanAttachmentPath ?? initial?.ibanAttachmentPath ?? null,
      dealType: kind === "crew" ? dealType : normalizeDealType(f.dealType),
      ...(kind === "crew" ? { shootingDays: crewQty, dailyRate: crewRate } : {}),
    };

    // Flat amounts typed by the user are sent verbatim; percent-driven rows
    // derive their amount from the net payable.
    const scheduleForSubmit: PaymentScheduleRow[] = schedule.map((r) => ({
      id: r.id,
      label: r.label,
      percent: Math.min(100, Math.max(0, toCents(Number(r.percent) || 0))),
      dueDate: r.dueDate,
      // Cent-exact: the server rejects >2-decimal schedule amounts.
      amount: Math.max(0, toCents(resolveSplitAmount(r.percent, netPayable, r.amount))),
      // Keep the milestone's workflow state (Approved/Paid, proof…) through a re-save,
      // otherwise editing the contract would reopen paid instalments.
      ...(scheduleExtras.get(r.id) ?? {}),
    }));

    // Last line of defence: the derived payload must satisfy the same trigger.
    const payloadErrors = validatePaymentSchedule(scheduleForSubmit);
    if (payloadErrors.length > 0) {
      toast.error(payloadErrors[0].message);
      return;
    }

    resetDirty();
    clearContractDraft();
    onSubmit(payload, selectedLine?.mainCode || mainCode || null, {
      paymentLedger: ledgerWithProofs,
      attachmentPath,
      weeklyRate: kind === "crew" ? crewRate : undefined,
      weeks: kind === "crew" ? crewQty : undefined,
      paymentSchedule: scheduleForSubmit,
      contractAmount: contractAmountBase,
      whtPercent,
      whtAmount,
      netPayable,
      whtTreatment,
    });
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
        {fields.map(([k, label, type]) => {
          if (k === "fullName") {
            return (
              <PersonPicker
                key="person-picker"
                persons={persons}
                available={personsAvailable}
                personId={f.personId}
                fullName={f.fullName ?? ""}
                idNumber={f.idNumber ?? ""}
                contractCounts={personContractCounts}
                error={errors.fullName}
                required
                onTypeName={(name) => {
                  setF((prev) => ({ ...prev, fullName: name }));
                  clearErr("fullName");
                }}
                onPick={(profile) => {
                  setF((prev) => ({ ...prev, ...profileToContractPatch(profile, prev) }));
                  clearErr("fullName");
                  clearErr("idNumber");
                  clearErr("nationality");
                }}
                onUnlink={() => setF((prev) => ({ ...prev, personId: null }))}
              />
            );
          }
          const requiredFields: (keyof Person)[] = [
            "fullName",
            "position",
            "character",
            "iban",
            "startDate",
            "endDate",
          ];
          const isRequired = requiredFields.includes(k);
          if (k === "character" && kind === "cast") {
            const charErr = errors.character;
            return (
              <label key="character-picker" className="text-sm">
                <div className="text-muted-foreground mb-1">
                  {label}
                  {isRequired && (
                    <span className="text-destructive ms-1" aria-hidden>
                      *
                    </span>
                  )}
                </div>
                {characterOpts.length > 0 ? (
                  <select
                    value={
                      selectedCharacterId ??
                      characterOpts.find((c) => c.name === f.character)?.id ??
                      ""
                    }
                    onChange={(e) => {
                      const id = e.target.value || null;
                      setSelectedCharacterId(id);
                      const c = characterOpts.find((x) => x.id === id);
                      setF({ ...f, character: c?.name ?? "" } as Person);
                      if (c?.budget_line_id) {
                        const line = projectBudgetLines.find((b) => b.id === c.budget_line_id);
                        if (line) {
                          setSelectedBudgetLineId(line.id);
                          setHeaderCode(parentHeaderCodeForLine(line));
                          setMainCode(line.mainCode);
                        }
                      }
                      clearErr("character");
                    }}
                    className={`w-full bg-surface-2 border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand ${charErr ? "border-destructive/70" : "border-border"}`}
                    required={isRequired}
                    aria-invalid={!!charErr}
                  >
                    <option value="">Select a character…</option>
                    {characterOpts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.role_type}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex flex-col gap-1">
                    <input
                      type="text"
                      value={f.character ?? ""}
                      onChange={(e) => {
                        set("character")(e);
                        clearErr("character");
                      }}
                      required={isRequired}
                      aria-invalid={!!charErr}
                      placeholder={t("crewcastcontracts.character_name_no_characters_created_yet")}
                      className={`w-full bg-surface-2 border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand ${charErr ? "border-destructive/70" : "border-border"}`}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {t("crewcastcontracts.create_reusable_roles_in_the")}
                      <span className="font-medium">Characters</span> module for auto-linking to
                      Budget lines.
                    </span>
                  </div>
                )}
                {charErr && <div className="text-[11px] text-destructive mt-1">{charErr}</div>}
              </label>
            );
          }
          if (k === "idNumber") {
            const idErr = errors.idNumber;
            return (
              <Fragment key="id-contact-group">
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">
                    {t("contracts.id_type")}
                    <span className="text-destructive ms-1" aria-hidden>
                      *
                    </span>
                  </div>
                  <select
                    value={f.idType ?? ""}
                    onChange={(e) => {
                      setF({ ...f, idType: (e.target.value || null) as IdType | null });
                      clearErr("idNumber");
                    }}
                    className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
                  >
                    <option value="">{t("contracts.select")}</option>
                    {ID_TYPES.map((it) => (
                      <option key={it} value={it}>
                        {t(`contracts.id_types.${it}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">
                    {label}
                    <span className="text-destructive ms-1" aria-hidden>
                      *
                    </span>
                  </div>
                  <input
                    type="text"
                    dir="ltr"
                    inputMode={f.idType === "passport" ? "text" : "numeric"}
                    maxLength={30}
                    placeholder={f.idType ? t(`contracts.id_placeholders.${f.idType}`) : undefined}
                    value={(f.idNumber as string) ?? ""}
                    onChange={(e) => {
                      set("idNumber")(e);
                      clearErr("idNumber");
                    }}
                    aria-invalid={!!idErr}
                    className={`w-full bg-surface-2 border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand ${idErr ? "border-destructive/70" : "border-border"}`}
                  />
                  {idErr && <div className="text-[11px] text-destructive mt-1">{idErr}</div>}
                </label>
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">
                    Phone Number{" "}
                    <span className="text-[10px] text-muted-foreground/70">(optional)</span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <input
                      type="tel"
                      value={f.phoneNumber ?? ""}
                      onChange={(e) => {
                        setF({ ...f, phoneNumber: e.target.value });
                        clearErr("phoneNumber");
                      }}
                      aria-invalid={!!errors.phoneNumber}
                      inputMode="tel"
                      maxLength={24}
                      className={`w-full min-w-0 bg-surface-2 border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand ${errors.phoneNumber ? "border-destructive/70" : "border-border"}`}
                      placeholder="+966 …"
                    />
                    {(f.phoneNumber ?? "").trim() && (
                      <CopyValueButton
                        value={(f.phoneNumber ?? "").trim()}
                        label={t("platform.ui.phoneNumber")}
                      />
                    )}
                  </div>
                  {errors.phoneNumber && (
                    <div className="text-[11px] text-destructive mt-1">{errors.phoneNumber}</div>
                  )}
                </label>
                <label className="text-sm col-span-2">
                  <div className="text-muted-foreground mb-1">
                    {t("platform.ui.email")}{" "}
                    <span className="text-[10px] text-muted-foreground/70">(optional)</span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <input
                      type="email"
                      value={f.email ?? ""}
                      onChange={(e) => {
                        setF({ ...f, email: e.target.value });
                        clearErr("email");
                      }}
                      aria-invalid={!!errors.email}
                      maxLength={255}
                      className={`w-full min-w-0 bg-surface-2 border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand ${errors.email ? "border-destructive/70" : "border-border"}`}
                      placeholder={t("crewcastcontracts.nameexamplecom")}
                    />
                    {(f.email ?? "").trim() && (
                      <CopyValueButton
                        value={(f.email ?? "").trim()}
                        label={t("platform.ui.email")}
                      />
                    )}
                  </div>
                  {errors.email && (
                    <div className="text-[11px] text-destructive mt-1">{errors.email}</div>
                  )}
                </label>
              </Fragment>
            );
          }
          if (k === "bank") {
            return (
              <Fragment key="bank-group">
                <BankPicker
                  bankCountry={f.bankCountry ?? ""}
                  bankName={f.bank ?? ""}
                  swiftCode={f.swiftCode ?? ""}
                  onChange={(patch) => {
                    setF((prev) => ({
                      ...prev,
                      ...(patch.bankCountry !== undefined
                        ? { bankCountry: patch.bankCountry }
                        : {}),
                      ...(patch.bankName !== undefined ? { bank: patch.bankName } : {}),
                      ...(patch.swiftCode !== undefined ? { swiftCode: patch.swiftCode } : {}),
                    }));
                    if (patch.bankCountry !== undefined) {
                      clearErr("bankCountry");
                      clearErr("iban");
                      clearErr("swiftCode");
                    }
                    if (patch.bankName !== undefined) clearErr("bank");
                    if (patch.swiftCode !== undefined) clearErr("swiftCode");
                  }}
                  countryLabel="Bank Country"
                  bankLabel="Bank Name"
                  swiftLabel={
                    f.bankCountry && f.bankCountry !== SAUDI_ARABIA
                      ? `${t("contracts.swift")} *`
                      : t("contracts.swift")
                  }
                  errors={{
                    bankCountry: errors.bankCountry,
                    bankName: errors.bank,
                    swiftCode: errors.swiftCode,
                  }}
                />
              </Fragment>
            );
          }

          if (k === "position" && kind === "crew") {
            const posErr = errors.position;
            return (
              <label key="position-picker" className="text-sm">
                <div className="text-muted-foreground mb-1">
                  {label}
                  <span className="text-destructive ms-1" aria-hidden>
                    *
                  </span>
                </div>
                <select
                  value={positionChoice}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPositionChoice(v);
                    setF({ ...f, position: v === POSITION_OTHER ? "" : v });
                    clearErr("position");
                  }}
                  aria-invalid={!!posErr}
                  className={`w-full bg-surface-2 border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand ${posErr ? "border-destructive/70" : "border-border"}`}
                >
                  <option value="">{t("contracts.select")}</option>
                  {CREW_POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>
                      {t(`contracts.positions.${positionKey(pos)}`, { defaultValue: pos })}
                    </option>
                  ))}
                  <option value={POSITION_OTHER}>{t("contracts.position_other")}</option>
                </select>
                {positionChoice === POSITION_OTHER && (
                  <input
                    type="text"
                    value={f.position ?? ""}
                    maxLength={100}
                    onChange={(e) => {
                      setF({ ...f, position: e.target.value });
                      clearErr("position");
                    }}
                    placeholder={t("contracts.position_other_placeholder")}
                    className="mt-2 w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
                  />
                )}
                {posErr && <div className="text-[11px] text-destructive mt-1">{posErr}</div>}
              </label>
            );
          }

          const fieldErr = errors[k as string];
          return (
            <label key={k} className="text-sm">
              <div className="text-muted-foreground mb-1">
                {label}
                {isRequired && (
                  <span className="text-destructive ms-1" aria-hidden>
                    *
                  </span>
                )}
              </div>
              {type === "date" ? (
                <div className={fieldErr ? "[&_button]:!border-destructive/70" : ""}>
                  <DatePickerPill
                    value={(f as any)[k] ?? ""}
                    onChange={(iso) => {
                      setF({ ...f, [k]: iso } as Person);
                      clearErr(k as string);
                    }}
                    className="bg-surface-2 border border-border px-4 py-2 text-sm"
                    textAlign="start"
                    align="start"
                  />
                </div>
              ) : (
                <input
                  type={type}
                  step={type === "number" ? "any" : undefined}
                  value={(f as any)[k] ?? ""}
                  onChange={(e) => {
                    set(k)(e);
                    clearErr(k as string);
                  }}
                  required={isRequired}
                  aria-required={isRequired}
                  aria-invalid={!!fieldErr}
                  className={`w-full bg-surface-2 border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand ${fieldErr ? "border-destructive/70" : "border-border invalid:border-destructive/60"}`}
                />
              )}
              {fieldErr && <div className="text-[11px] text-destructive mt-1">{fieldErr}</div>}
            </label>
          );
        })}

        {/* Dual Per Diem — On-Set / Off-Set (Off-Set defaults to 2× On-Set, overridable) */}
        <label className="text-sm">
          <div className="text-muted-foreground mb-1">{t("crewcastcontracts.onset_per_diem")}</div>
          <input
            type="number"
            step="any"
            min={0}
            value={f.onSetPerDiem || ""}
            onChange={(e) => {
              const parsed = acceptRateInput(e.target.value);
              if (parsed === undefined) return;
              const on = parsed ?? 0;
              setF((prev) => ({
                ...prev,
                onSetPerDiem: on,
                perDiem: on, // keep legacy field in sync
                offSetPerDiem: offSetOverridden ? prev.offSetPerDiem : +(on * 2).toFixed(2),
              }));
            }}
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
          />
        </label>
        <label className="text-sm">
          <div className="text-muted-foreground mb-1 flex items-center justify-between gap-2">
            <span>{t("crewcastcontracts.offset_per_diem")}</span>
            <span className="shrink-0 text-[10px] font-medium text-muted-foreground/70 bg-surface border border-border rounded px-1.5 py-0.5 leading-none">
              {offSetOverridden ? "manual" : "auto ×2"}
            </span>
          </div>
          <input
            type="number"
            step="any"
            min={0}
            value={f.offSetPerDiem || ""}
            onChange={(e) => {
              const parsed = acceptRateInput(e.target.value);
              if (parsed === undefined) return;
              setOffSetOverridden(true);
              setF({ ...f, offSetPerDiem: parsed ?? 0 });
            }}
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
          />
        </label>
        <label className="text-sm">
          <div className="text-muted-foreground mb-1 flex items-center justify-between gap-2">
            <span>{t("crewcastcontracts.monthly_housing_allowance")}</span>
            <span className="shrink-0 text-[10px] font-medium text-muted-foreground/70 bg-surface border border-border rounded px-1.5 py-0.5 leading-none">
              prorated /30
            </span>
          </div>
          <input
            type="number"
            step="any"
            min={0}
            value={f.housingAllowance || ""}
            onChange={(e) => {
              const parsed = acceptRateInput(e.target.value);
              if (parsed === undefined) return;
              setF({ ...f, housingAllowance: parsed ?? 0 });
            }}
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
            placeholder={t("crewcastcontracts.optional_monthly_rate")}
          />
        </label>

        {kind === "crew" && (
          <>
            <label className="text-sm">
              <div className="text-muted-foreground mb-1">{t("crewcastcontracts.deal_type")}</div>
              <select
                value={dealType}
                onChange={(e) => setF({ ...f, dealType: e.target.value as DealType })}
                className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
              >
                {DEAL_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {DEAL_TYPE_LABEL[d]}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm">
              <div className="text-muted-foreground mb-1">
                {t("crewcastcontracts.contract_term")}
              </div>
              <div className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-muted-foreground text-[12px] truncate">
                {f.startDate && f.endDate
                  ? `${f.startDate} → ${f.endDate}`
                  : "Set start / end dates"}
              </div>
            </div>

            {dealType === "weekly" && (
              <>
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">
                    {t("crewcastcontracts.weekly_rate")}
                  </div>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={weeklyRate || ""}
                    onChange={(e) => {
                      const parsed = acceptRateInput(e.target.value);
                      if (parsed === undefined) return;
                      setWeeklyRate(parsed ?? 0);
                    }}
                    className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
                  />
                </label>
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">
                    {t("crewcastcontracts.weeks_auto")}
                  </div>
                  <div className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 font-semibold">
                    {weeks || "—"}
                  </div>
                </div>
              </>
            )}

            {dealType === "daily" && (
              <>
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">
                    {t("crewcastcontracts.daily_rate")}
                  </div>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={dailyRateInput || ""}
                    onChange={(e) => {
                      const parsed = acceptRateInput(e.target.value);
                      if (parsed === undefined) return;
                      setDailyRateInput(parsed ?? 0);
                    }}
                    className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
                  />
                </label>
                <label className="text-sm">
                  <div className="text-muted-foreground mb-1">
                    {t("crewcastcontracts.number_of_days")}
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={dailyDays || ""}
                    onChange={(e) => setDailyDays(+e.target.value || 0)}
                    className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
                    placeholder={t("crewcastcontracts.manual_dates_define_the_term_only")}
                  />
                </label>
              </>
            )}

            {dealType === "package" && (
              <label className="text-sm col-span-2">
                <div className="text-muted-foreground mb-1">
                  {t("crewcastcontracts.total_package_amount")}
                </div>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={packageAmount || ""}
                  onChange={(e) => {
                    const parsed = acceptRateInput(e.target.value);
                    if (parsed === undefined) return;
                    setPackageAmount(parsed ?? 0);
                  }}
                  className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
                />
                {(() => {
                  // B03: a package spans its contract dates; daily = total ÷ days.
                  const d = displayDaysAndRate({
                    dealType: "package",
                    shootingDays: 1,
                    dailyRate: packageAmount,
                    startDate: f.startDate,
                    endDate: f.endDate,
                  });
                  return d.days > 0 && packageAmount > 0 ? (
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {t("contracts.package_days", {
                        days: d.days,
                        daily: formatCcy(d.daily, contractCcy),
                      })}
                    </div>
                  ) : null;
                })()}
              </label>
            )}

            {/* Overtime setup — foundational data only, excluded from the contract total. */}
            <label className="text-sm">
              <div className="text-muted-foreground mb-1">
                Overtime Rate{" "}
                <span className="text-[10px] text-muted-foreground/70">(optional)</span>
              </div>
              <input
                type="number"
                step="any"
                min={0}
                value={f.overtimeRate ?? ""}
                onChange={(e) => {
                  const parsed = acceptRateInput(e.target.value);
                  if (parsed === undefined) return;
                  setF({ ...f, overtimeRate: parsed });
                }}
                className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
              />
            </label>
            <label className="text-sm">
              <div className="text-muted-foreground mb-1">{t("platform.ui.per")}</div>
              <select
                value={f.overtimeUnit ?? ""}
                onChange={(e) =>
                  setF({ ...f, overtimeUnit: (e.target.value || null) as OvertimeUnit | null })
                }
                className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
              >
                <option value="">— Select unit —</option>
                {OVERTIME_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {OVERTIME_UNIT_LABEL[u]}
                  </option>
                ))}
              </select>
            </label>
            <div className="col-span-2 text-[11px] text-muted-foreground -mt-1">
              Overtime is stored on the contract for the Overtime Tracking log — it is not included
              in the Contract Total.
            </div>

            <div className="col-span-2 rounded-xl bg-surface-2 border border-border px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">
                {dealType === "weekly"
                  ? "Total Deal (Weeks × Weekly Rate)"
                  : dealType === "daily"
                    ? "Total Deal (Days × Daily Rate)"
                    : "Total Deal (Package)"}
              </span>
              <span className="font-semibold text-base tabular-nums" dir="ltr">
                {formatCcy(contractAmount, f.ccy)}
              </span>
            </div>
          </>
        )}

        {/* Nationality — required for everyone, Saudi included (B26/E02) */}
        <label className="text-sm">
          <div className="text-muted-foreground mb-1">
            {t("contracts.nationality")}
            <span className="text-destructive ms-1" aria-hidden>
              *
            </span>
          </div>
          <div className={errors.nationality ? "[&_button]:!border-destructive/70" : ""}>
            <SearchableCountrySelect
              value={f.nationality ?? ""}
              onChange={(v) => {
                setF({ ...f, nationality: v });
                clearErr("nationality");
              }}
              placeholder={t("crewcastcontracts.select_a_country")}
            />
          </div>
          {errors.nationality && (
            <div className="text-[11px] text-destructive mt-1">{errors.nationality}</div>
          )}
        </label>

        {/* Contract currency (B25: defaults to the project base currency) */}
        <label className="text-sm">
          <div className="text-muted-foreground mb-1">{t("contracts.contract_currency")}</div>
          <select
            value={contractCcy}
            onChange={(e) => {
              setF({ ...f, ccy: e.target.value });
              clearErr("ccy");
            }}
            aria-invalid={!!errors.ccy}
            className={`w-full bg-surface-2 border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand ${errors.ccy ? "border-destructive/70" : "border-border"}`}
          >
            {Array.from(new Set<string>([baseCurrency, ...CONTRACT_CURRENCIES, contractCcy])).map(
              (c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ),
            )}
          </select>
          {errors.ccy && <div className="text-[11px] text-destructive mt-1">{errors.ccy}</div>}
        </label>

        <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {f.nationality && f.nationality !== SAUDI_ARABIA && (
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!f.motherSaudi}
                onChange={(e) => setF({ ...f, motherSaudi: e.target.checked })}
                className="size-4 accent-[var(--brand)]"
              />
              <span>{t("contracts.mother_saudi")}</span>
            </label>
          )}
          <label className="inline-flex items-center gap-2">
            <span>{t("contracts.related_party")}</span>
            <select
              value={f.relatedParty == null ? "" : f.relatedParty ? "yes" : "no"}
              onChange={(e) => {
                clearErr("relatedParty");
                setF({
                  ...f,
                  relatedParty: e.target.value === "" ? null : e.target.value === "yes",
                });
              }}
              className="bg-surface-2 border border-border rounded-lg px-2 py-1 outline-none focus:ring-2 ring-brand"
            >
              <option value="">{t("rebate.choose")}</option>
              <option value="yes">{t("rebate.yes")}</option>
              <option value="no">{t("rebate.no")}</option>
            </select>
            {errors.relatedParty && (
              <span className="text-[11px] text-destructive">{errors.relatedParty}</span>
            )}
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!f.isTrainee}
              onChange={(e) => setF({ ...f, isTrainee: e.target.checked })}
              className="size-4 accent-[var(--brand)]"
            />
            <span>{t("rebate.trainee")}</span>
          </label>
        </div>

        {/* Tax residency — suggested by the rule, confirmed by the user (E03) */}
        <label className="text-sm col-span-2">
          <div className="text-muted-foreground mb-1">{t("contracts.tax_residency")}</div>
          <select
            value={taxResidency}
            onChange={(e) => {
              setResidencyTouched(true);
              setF({ ...f, taxResidency: e.target.value as TaxResidency });
            }}
            className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
          >
            <option value="resident">{t("contracts.residency.resident")}</option>
            <option value="non_resident">{t("contracts.residency.non_resident")}</option>
          </select>
          <div className="text-[11px] text-muted-foreground mt-1">
            {residencyTouched && f.taxResidency
              ? f.taxResidency !== suggestedResidency
                ? t("contracts.residency.differs_from_rule", {
                    value: t(`contracts.residency.${suggestedResidency}`),
                  })
                : t("contracts.residency.confirmed")
              : t("contracts.residency.suggested_hint")}
          </div>
        </label>

        {whtApplies && (
          <WhtTreatmentSelector
            packageAmount={contractAmount || 0}
            currency={contractCcy}
            ratePct={whtPercent}
            value={whtTreatment}
            onChange={(v) => setF({ ...f, whtTreatment: v })}
            base={
              contractCcy !== baseCurrency && fxToBase != null
                ? { currency: baseCurrency, breakdown: whtBase }
                : null
            }
          >
            <label className="block text-sm">
              <div className="text-muted-foreground mb-1">{t("contracts.wht.service_type")}</div>
              <select
                value={f.whtServiceType ?? "default"}
                onChange={(e) =>
                  setF({
                    ...f,
                    whtServiceType: e.target.value === "default" ? null : e.target.value,
                  })
                }
                className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
              >
                {whtServiceTypes.map((st) => (
                  <option key={st} value={st}>
                    {st === "default" ? t("contracts.wht.service_default") : st} —{" "}
                    {resolveWhtRate(whtRules, st)}%
                  </option>
                ))}
              </select>
            </label>
          </WhtTreatmentSelector>
        )}

        {/* Universal cascading Header Account → Sub-Account mapping */}
        <BudgetMappingSelect
          lines={projectBudgetLines}
          headerCode={headerCode}
          lineId={selectedBudgetLineId}
          onChange={(v) => {
            setHeaderCode(v.headerCode);
            setMainCode(v.code);
            setSelectedBudgetLineId(v.lineId);
          }}
        />

        <BudgetMappingWarning issues={mappingIssues} className="col-span-2" />

        {selectedLine && (
          <div className="col-span-2 grid grid-cols-4 gap-3 p-3 rounded-xl bg-surface-2 border border-border text-sm">
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wider">
                {t("crewcastcontracts.budget_planned")}
              </div>
              <div className="font-semibold">{formatUSD(planned)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wider">
                {t("crewcastcontracts.already_committed")}
              </div>
              <div className="font-semibold">{formatUSD(otherCommitted)}</div>
              <div className="text-[10px] text-muted-foreground">
                {otherCommittedCount} other{" "}
                {otherCommittedCount === 1 ? "contract/PO" : "contracts/POs"} on this line
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wider">
                {t("crewcastcontracts.contract_commitment")}
              </div>
              <div className="font-semibold" title={fxBreakdown}>
                {formatUSD(contractAmountBase)}
              </div>
              {contractCcy !== baseCurrency && (
                <div className="text-[10px] text-muted-foreground" dir="ltr">
                  {fxBreakdown}
                </div>
              )}
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wider">
                {t("crewcastcontracts.remaining_after_commit")}
              </div>
              <div
                className={`font-semibold ${remaining < 0 ? "text-destructive" : "text-success"}`}
              >
                {formatUSD(remaining)}
              </div>
            </div>
          </div>
        )}

        {/* Payment Schedule / Terms */}
        <div className="col-span-2">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] text-muted-foreground">
              {t("contracts.schedule_basis", {
                amount: formatAmount(netPayable, 2),
                ccy: baseCurrency,
              })}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Payment Schedule
            </span>
          </div>
          {errors.schedule && (
            <div className="mb-1.5 text-[11px] text-destructive">{errors.schedule}</div>
          )}
          <div
            dir="ltr"
            className="rounded-2xl bg-info/60 dark:bg-card/[0.03] border border-info/80 dark:border-border p-4"
          >
            {/* Column headers — must match row column template exactly */}
            <div className="grid grid-cols-[1fr_120px_1fr_32px] gap-3 items-center px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span>{t("platform.ui.date")}</span>
              <span className="text-center">{t("platform.ui.percent")}</span>
              <span className="text-end">{t("platform.ui.amount")}</span>
              <span />
            </div>

            <div className="space-y-2">
              {schedule.map((row) => {
                const rowErr = scheduleFieldErrors.map[row.id] ?? {};
                const errRing =
                  "border-destructive/40 dark:border-destructive/40 ring-1 ring-destructive/40";
                return (
                  <div key={row.id} className="space-y-1">
                    <div className="grid grid-cols-[1fr_120px_1fr_32px] gap-3 items-center">
                      {/* DATE */}
                      <DatePickerPill
                        value={row.dueDate}
                        onChange={(iso) => {
                          updateScheduleRow(row.id, { dueDate: iso });
                          clearErr("schedule");
                        }}
                        className={`bg-card dark:bg-surface-2 border px-4 py-2 text-sm ${errors.schedule && !row.dueDate ? "border-destructive/70" : "border-info/80 dark:border-border"}`}
                        textAlign="start"
                        align="start"
                      />

                      {/* PERCENT + AMOUNT (bidirectional) */}
                      <PaymentSplitFields
                        percent={row.percent}
                        amount={row.amount ?? null}
                        total={netPayable}
                        onPercentChange={(percent) => updateScheduleRow(row.id, { percent })}
                        onAmountChange={(amount) => updateScheduleRow(row.id, { amount })}
                        onQuickAdd={addScheduleRow}
                        autoFocusPercent={row.id === lastAddedRowId}
                        currencyLabel={baseCurrency}
                        percentInvalid={Boolean(rowErr.percent)}
                        amountInvalid={Boolean(rowErr.amount)}
                        percentErrorId={rowErr.percent ? `sched-${row.id}-percent-err` : undefined}
                        amountErrorId={rowErr.amount ? `sched-${row.id}-amount-err` : undefined}
                        percentClassName={`w-full bg-card dark:bg-surface-2 border border-info/80 dark:border-border rounded-full pl-4 pr-8 py-2 text-sm text-center tabular-nums outline-none focus:ring-2 ring-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${rowErr.percent ? errRing : ""}`}
                        amountClassName={`w-full bg-card dark:bg-surface-2 border border-info/80 dark:border-border rounded-full pl-4 pr-12 py-2 text-sm text-end tabular-nums outline-none focus:ring-2 ring-brand ${rowErr.amount ? errRing : ""}`}
                      />

                      {/* TRASH */}
                      <button
                        type="button"
                        onClick={() => removeScheduleRow(row.id)}
                        className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors justify-self-end"
                        aria-label={t("platform.ui.removeMilestone")}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    {(rowErr.percent || rowErr.amount) && (
                      <div className="ps-1 space-y-0.5">
                        {rowErr.percent && (
                          <p
                            id={`sched-${row.id}-percent-err`}
                            role="alert"
                            className="text-[11px] text-destructive"
                          >
                            {rowErr.percent}
                          </p>
                        )}
                        {rowErr.amount && (
                          <p
                            id={`sched-${row.id}-amount-err`}
                            role="alert"
                            className="text-[11px] text-destructive"
                          >
                            {rowErr.amount}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 mt-2">
              <ScheduleRemainderHint
                totalPct={scheduleTotalPct}
                total={netPayable}
                allocatedAmount={scheduleAllocated}
                currency={baseCurrency}
              />
              <button
                type="button"
                onClick={addScheduleRow}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline shrink-0"
                title={t("platform.ui.addMilestoneEnterInsideAPercentAmountField")}
              >
                Add row <Plus className="size-3.5" />
              </button>
            </div>

            <div className="mt-3 pt-3 border-t border-info/70 dark:border-border flex items-center justify-between text-xs">
              <span
                className={`font-bold tabular-nums ${
                  isScheduleTotalValid(scheduleTotalPct)
                    ? "text-success dark:text-success"
                    : scheduleTotalPct > 100
                      ? "text-destructive"
                      : "text-warning"
                }`}
              >
                {scheduleTotalPct.toFixed(2)}%
              </span>
              <span className="text-foreground/80 font-medium">
                Total must equal 100% (±{SCHEDULE_PCT_TOLERANCE}%)
              </span>
            </div>
          </div>
        </div>

        {/* LOGISTICS INFO — controls visibility in Daily Transport & Car Rentals modules */}
        <div className="col-span-2 rounded-2xl border border-border bg-surface-2/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Logistics Info · معلومات اللوجستيات
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-start gap-2 text-sm bg-surface-2 border border-border rounded-xl px-3 py-2.5 cursor-pointer hover:bg-muted">
              <input
                type="checkbox"
                checked={!!f.requiresTransport}
                onChange={(e) => setF({ ...f, requiresTransport: e.target.checked })}
                className="mt-0.5 size-4 accent-brand"
              />
              <span>
                <div className="font-medium">{t("crewcastcontracts.requires_daily_transport")}</div>
                <div className="text-[11px] text-muted-foreground">
                  {t("crewcastcontracts.appears_in_the_daily_transport_passenger_list")}
                </div>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm bg-surface-2 border border-border rounded-xl px-3 py-2.5 cursor-pointer hover:bg-muted">
              <input
                type="checkbox"
                checked={!!f.isDriver}
                onChange={(e) => setF({ ...f, isDriver: e.target.checked })}
                className="mt-0.5 size-4 accent-brand"
              />
              <span>
                <div className="font-medium">{t("crewcastcontracts.is_a_production_driver")}</div>
                <div className="text-[11px] text-muted-foreground">
                  Selectable as driver in Car Rentals &amp; Transport.
                </div>
              </span>
            </label>
          </div>
          <label className="text-sm block">
            <div className="text-muted-foreground mb-1">
              {t("crewcastcontracts.assigned_accommodation_hotel")}
            </div>
            <select
              value={f.accommodationId ?? ""}
              onChange={(e) => setF({ ...f, accommodationId: e.target.value || null })}
              className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
            >
              <option value="">— Not assigned —</option>
              {accommodations.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            {accommodations.length === 0 && (
              <div className="text-[11px] text-muted-foreground mt-1">
                No accommodation entries yet — add rooms in the Accommodation Roster.
              </div>
            )}
          </label>
        </div>

        {/* FINANCE ROLES — controls Purchaser dropdown in Invoices & Petty Cash custodian lists. */}
        <div className="col-span-2 rounded-2xl border border-border bg-surface-2/60 p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Finance Roles · الأدوار المالية
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-start gap-2 text-sm bg-surface-2 border border-border rounded-xl px-3 py-2.5 cursor-pointer hover:bg-muted">
              <input
                type="checkbox"
                checked={!!f.isPurchaser}
                onChange={(e) => setF({ ...f, isPurchaser: e.target.checked })}
                className="mt-0.5 size-4 accent-brand"
              />
              <span>
                <div className="font-medium">{t("crewcastcontracts.authorized_purchaser")}</div>
                <div className="text-[11px] text-muted-foreground">
                  Selectable as "Paid By" on invoices &amp; petty cash.
                </div>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm bg-surface-2 border border-border rounded-xl px-3 py-2.5 cursor-pointer hover:bg-muted">
              <input
                type="checkbox"
                checked={!!f.isPettyCashCustodian}
                onChange={(e) => setF({ ...f, isPettyCashCustodian: e.target.checked })}
                className="mt-0.5 size-4 accent-brand"
              />
              <span>
                <div className="font-medium">{t("crewcastcontracts.petty_cash_custodian")}</div>
                <div className="text-[11px] text-muted-foreground">
                  Holds a petty cash float — tracked on the Petty Cash tab.
                </div>
              </span>
            </label>
          </div>
        </div>

        {/* ID Document */}
        <label className="text-sm col-span-2">
          <div className="text-muted-foreground mb-1">
            {t("crewcastcontracts.id_document_image_or_pdf")}
          </div>
          <StoredFileBadge
            path={initial?.idAttachmentPath}
            label={t("platform.ui.currentlyUploadedIdDocument")}
          />
          <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2">
            {idDocument ? (
              <FileText className="size-4 text-success" />
            ) : (
              <Paperclip className="size-4 text-muted-foreground" />
            )}
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setIdDocument(e.target.files?.[0] ?? null)}
              className="flex-1 text-sm file:me-3 file:rounded-md file:border-0 file:bg-brand/20 file:text-brand file:px-3 file:py-1.5"
            />
            {idDocument && (
              <button
                type="button"
                onClick={() => setIdDocument(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          {idDocument && (
            <div className="mt-1 text-xs text-muted-foreground">
              {idDocument.name} ({(idDocument.size / 1024).toFixed(0)} KB)
            </div>
          )}
        </label>

        {/* IBAN Certificate */}
        <label className="text-sm col-span-2">
          <div className="text-muted-foreground mb-1">
            {t("crewcastcontracts.iban_certificate_image_or_pdf")}
          </div>
          <StoredFileBadge
            path={initial?.ibanAttachmentPath}
            label={t("platform.ui.currentlyUploadedIbanCertificate")}
          />
          <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2">
            {ibanCertificate ? (
              <FileText className="size-4 text-success" />
            ) : (
              <Paperclip className="size-4 text-muted-foreground" />
            )}
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setIbanCertificate(e.target.files?.[0] ?? null)}
              className="flex-1 text-sm file:me-3 file:rounded-md file:border-0 file:bg-brand/20 file:text-brand file:px-3 file:py-1.5"
            />
            {ibanCertificate && (
              <button
                type="button"
                onClick={() => setIbanCertificate(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          {ibanCertificate && (
            <div className="mt-1 text-xs text-muted-foreground">
              {ibanCertificate.name} ({(ibanCertificate.size / 1024).toFixed(0)} KB)
            </div>
          )}
        </label>

        {/* Contract Attachment (PDF) */}
        <label className="text-sm col-span-2">
          <div className="text-muted-foreground mb-1">
            {t("crewcastcontracts.contract_attachment_pdf")}
          </div>
          <StoredFileBadge
            path={initial?.contractPath}
            label={t("platform.ui.currentlyUploadedContract")}
          />
          <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2">
            {attachment ? (
              <FileText className="size-4 text-success" />
            ) : (
              <Paperclip className="size-4 text-muted-foreground" />
            )}
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
              className="flex-1 text-sm file:me-3 file:rounded-md file:border-0 file:bg-brand/20 file:text-brand file:px-3 file:py-1.5"
            />
            {attachment && (
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          {attachment && (
            <div className="mt-1 text-xs text-muted-foreground">
              {attachment.name} ({(attachment.size / 1024).toFixed(0)} KB)
            </div>
          )}
        </label>

        <AttachmentUrlField
          className="col-span-2"
          value={f.attachmentUrl ?? ""}
          onChange={(v) => setF({ ...f, attachmentUrl: v } as Person)}
          externalError={
            attachmentDuplicate
              ? `This link is already used on ${attachmentDuplicate.label}.`
              : null
          }
        />

        <StoredAttachmentCard
          className="col-span-2"
          stored={initial && !isDuplicate ? (initial.attachmentUrl ?? "") : ""}
          current={f.attachmentUrl ?? ""}
          onRestore={() => setF({ ...f, attachmentUrl: initial?.attachmentUrl ?? "" } as Person)}
        />

        <button
          type="submit"
          disabled={
            uploading ||
            !!attachmentDuplicate ||
            !isValidAttachmentUrl(f.attachmentUrl ?? "") ||
            (ledger.length > 0 && !ledgerValid) ||
            scheduleFieldErrors.list.length > 0 ||
            schedule.length === 0 ||
            !isScheduleTotalValid(scheduleTotalPct)
          }
          className="col-span-2 mt-2 px-5 py-2.5 rounded-xl bg-brand text-brand-foreground font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? "Uploading…" : isEdit ? "Save Changes" : "Create Contract"}
        </button>
      </form>
      {preview && (
        <Modal onClose={() => setPreview(null)} title={t("ledger.previewTitle")}>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground truncate">{preview.name}</div>
            <div className="rounded-xl border border-border bg-black/40 overflow-hidden flex items-center justify-center min-h-[300px]">
              {preview.kind === "image" ? (
                <img
                  src={preview.url}
                  alt={preview.name}
                  className="max-h-[70vh] w-auto object-contain"
                />
              ) : preview.kind === "pdf" ? (
                <iframe
                  src={preview.url}
                  title={preview.name}
                  className="w-full h-[70vh] bg-card"
                />
              ) : (
                <div className="p-6 text-sm text-muted-foreground">{t("ledger.cannotPreview")}</div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <a
                href={preview.url}
                target="_blank"
                rel="noreferrer"
                download={preview.name}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-surface border border-border hover:bg-muted"
              >
                {t("ledger.download")}
              </a>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
