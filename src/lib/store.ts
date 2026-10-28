import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { supabase } from "@/integrations/supabase/client";
import {
  BUDGET_VERSION_CHANGE_EVENT,
  resolveSelectedVersionId,
  selectedVersionIdSync,
} from "@/lib/budget-version-selection";
import { recordAudit } from "./audit-log";
import { invalidateBudgetCaches } from "./budget-cache-bus";
import { invalidateActiveProjectQueryCaches } from "./project-query-cache";
import { deleteFilesForEntity } from "./project-files";
import type { Status } from "./data";
import {
  DEFAULT_PROJECT_STATUS as CANONICAL_DEFAULT_PROJECT_STATUS,
  DEFAULT_PROJECT_TYPE as CANONICAL_DEFAULT_PROJECT_TYPE,
  PROJECT_STATUSES,
  type ProjectStatusOption,
} from "@/lib/project-constants";
import {
  convertForDisplay,
  displayCurrencyCode,
  formatDisplayAmount,
  formatDisplayMoney,
} from "./money-display";

import i18n from "@/lib/i18n";
import { normalizeKsaRegion } from "@/lib/ksa-regions";
import { normalizeVatTreatment, type VatTreatment } from "./ap-calc";
import {
  computeBudgetPosition,
  legacyContractPaid,
  type LogisticsCommitment,
} from "./budget-position";
/**
 * Historical union kept for back-compat with existing rows. Widened to `string`
 * so newly-added unit labels (MONTHS, WEEKS, ALLOW, ACTORS, EPISODES, TRIPS,
 * UNITS, etc.) coming from the UI dropdown validate at the type level without
 * invalidating any previously stored value.
 */
export type BudgetUnit = string;
/**
 * Budget lines are planned in SAR or USD only — on purpose (D03).
 * A budget line's SAR value is recomputed everywhere (budget_line_total_sar
 * in ~10 database views, lineTotalSAR here, the Top Sheet, the Film
 * Commission budget) from ONE locked project rate SAR↔USD, so the approved
 * budget never moves with daily FX. Spending in any other currency (EUR,
 * AED, …) is recorded on the documents — invoices, POs, petty cash — with a
 * dated rate and its source (project_currency_rates, db/pending/190,
 * src/lib/fx-dated.ts) and is converted to SAR on the transaction date.
 * Opening budget lines to EUR would need a dated rate per line inside every
 * budget view and would make the approved budget total drift, so it is not
 * done; a foreign-currency quote is budgeted at its SAR (or USD) value.
 */
export type BudgetCurrency = "USD" | "SAR";
/** Units whose total is qty × rate only (no period multiplier). Legacy list kept intact. */
export const UNITS_NO_PERIODS: readonly BudgetUnit[] = ["Package", "Epi"] as const;
export type BudgetLine = {
  id: string;
  headerCode: string;
  mainCode: string;
  description: string;
  /** Optional person/entity name (e.g. Cast Title -> Actor name). Non-destructive addition. */
  name?: string;
  /** Quantity (number of units / people). */
  amount: number;
  /** Rate per unit, expressed in `currency`. */
  rate: number;
  /** Currency the rate is defined in. */
  currency: BudgetCurrency;
  unit: BudgetUnit;
  /** Legacy multiplier — kept for back-compat; equals totalPeriods on save. */
  x: number;
  /** Optional period breakdown. */
  prep?: number;
  shooting?: number;
  wrap?: number;
  notes?: string;
  group: "ATL" | "BTL" | "Post" | "Music" | "VFX" | "Other";
  /** Optional link to a Top Sheet account code (budget_topsheet_accounts.code). */
  topsheetCode?: string | null;
  /** When true, line stays visible but contributes 0 to every roll-up. */
  excluded?: boolean;
  /** True when the line qualifies for film-commission rebate reporting. */
  rebateEligible?: boolean;
  /**
   * KSA region where the line is spent (db/pending/201, Film Commission budget
   * by region). null = the project's default region; undefined = not loaded
   * (database without 201) — then it is never written.
   */
  region?: string | null;
};

export const VENDOR_PAYMENT_TERMS = ["Advance", "Net 15", "Net 30", "Net 60"] as const;
export type VendorPaymentTerms = (typeof VENDOR_PAYMENT_TERMS)[number];

export type VendorScope = "Local" | "International";
export type Vendor = {
  id: string;
  name: string;
  category: string;
  crNo: string;
  vatNo: string;
  email: string;
  contactName?: string;
  position?: string;
  mobile?: string;
  iban?: string;
  sharedDriveUrl?: string;
  bankName?: string;
  bankCountry?: string;
  swiftCode?: string;
  paymentTerms?: VendorPaymentTerms | "";
  /** Local (KSA) vs International vendor — drives currency/WHT defaults. */
  vendorScope?: VendorScope | "";
  /** Country where the company is legally registered (may differ from bank). */
  companyNationality?: string;
  /** E05 (db/pending/190): KSA tax residency; undefined before 190. */
  taxResidency?: "resident" | "non_resident" | null;
  relatedParty?: boolean;
  relatedPartyNote?: string | null;
};

export type InvoiceApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type Invoice = {
  id: string;
  /**
   * db/pending/201: pending (recorded = Commitment) → approved (Actual, locked)
   * | rejected; approved → cancelled. Written by the approve / reject / cancel
   * RPCs only — never sent by toInvoiceRow.
   */
  approvalStatus?: InvoiceApprovalStatus;
  createdBy?: string | null;
  /** Last user who changed the content (database-written, db/pending/201): cannot approve / reject. */
  lastEditedBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  cancellationReason?: string | null;
  projectId?: string | null;
  organizationId?: string | null;
  description: string;
  department: string;
  budgetCode: string;
  price: number;
  vatable: boolean;
  date: string;
  invoiceNo: string;
  vendorName: string;
  purchaserName?: string;
  /** FK → public.people.id — links the crew member whose petty cash / account was used. */
  purchaserId?: string | null;
  paymentTerm?: number;
  /** Optional Chart of Accounts (GL) reference — used for reporting only. */
  glAccountId?: string | null;
  /** Non-Saudi vendor / international bank — triggers 5% WHT. */
  isNonSaudiVendor?: boolean;
  whtPercent?: number;
  whtAmount?: number;
  netPayable?: number;
  /** GL account code where WHT is posted. */
  whtGlCode?: string;
  /** Optional cloud link to the invoice document (e.g. Google Drive URL). */
  invoiceUrl?: string | null;
  /** Optional cloud link to the receipt document (e.g. Google Drive URL). */
  receiptUrl?: string | null;
  /** Optional external cloud attachment (Google Drive, Dropbox, SharePoint…). */
  attachmentUrl?: string | null;
  /** True when the invoice qualifies for film-commission rebate reporting. */
  rebateEligible?: boolean;
  /** FK → public.people.id — Crew/Cast beneficiary whose logistics/travel this invoice funds. */
  beneficiaryId?: string | null;
  /** Whether the service was rendered inside KSA (drives QFE auto-calc). Defaults true. */
  serviceInsideKsa?: boolean;
  /** True once the user has manually overridden the auto-calculated QFE value. */
  rebateManualOverride?: boolean;
  /** VAT charged on the invoice (as on the vendor's document; may differ by rounding). */
  vatAmount?: number;
  /** standard | zero_rated | exempt | reverse_charge (db/pending/174). */
  vatTreatment?: VatTreatment;
  /** Standard rate (percent) applied when the invoice was saved. */
  vatRate?: number | null;
  /** FK → purchase_orders.id — the PO this invoice is raised against (converts its commitment). */
  purchaseOrderId?: string | null;
  /** Vendor payment terms copied at entry (e.g. "Net 30"). */
  paymentTerms?: string | null;
  /** Invoice date + payment terms. */
  dueDate?: string | null;
  /** bank_transfer | petty_cash | corporate_card | cash | cheque. */
  paymentMethod?: InvoicePaymentMethod | null;
  /** Invoice currency; `price` is always the record-currency (SAR) amount. */
  currency?: string | null;
  fxRate?: number | null;
  /** Excl.-VAT amount in the invoice currency. */
  amountOriginal?: number | null;
  servicePeriodFrom?: string | null;
  servicePeriodTo?: string | null;
  /** Date the service / goods were received (Film Commission evidence). */
  serviceReceivedDate?: string | null;
  isRelatedParty?: boolean;
  relatedPartyNote?: string | null;
  /** E05 (db/pending/190): vendor profile link + its values at entry. */
  vendorId?: string | null;
  vendorCrNo?: string | null;
  vendorVatNo?: string | null;
  vendorCountry?: string | null;
  vendorTaxResidency?: "resident" | "non_resident" | null;
  vendorBankCountry?: string | null;
  vendorBankName?: string | null;
  /** D03 (db/pending/190): where the FX rate came from and its date. */
  fxRateSource?: "sama" | "bank" | "project" | "manual" | null;
  fxRateDate?: string | null;
};

export const INVOICE_PAYMENT_METHODS = [
  "bank_transfer",
  "petty_cash",
  "corporate_card",
  "cash",
  "cheque",
] as const;
export type InvoicePaymentMethod = (typeof INVOICE_PAYMENT_METHODS)[number];
/** Methods where money leaves a person's float/card — those need a Purchaser (B14). */
export const methodNeedsPurchaser = (m: InvoicePaymentMethod | null | undefined) =>
  m === "petty_cash" || m === "corporate_card" || m === "cash";

export type CashAdvanceStatus = "Active" | "Reconciled";
export type CashAdvance = {
  id: string;
  holder: string;
  totalAdvance: number;
  expenses: number;
  status: CashAdvanceStatus;
};

export type CashAdvanceReceipt = {
  id: string;
  advanceId?: string;
  receivedFrom?: string;
  recipient: string;
  department?: string;
  method: "Cash" | "Bank" | "Card";
  amount: number;
  date?: string;
  budgetCode?: string;
  /** Optional Chart of Accounts (GL) reference — used for reporting only. */
  glAccountId?: string | null;
  /** pending | approved | rejected — only approved receipts are Actual. */
  status?: string;
};

export type PurchaseOrderStatus =
  | "Draft"
  | "Open"
  | "Approved"
  | "Issued"
  | "Committed"
  | "Received"
  | "Closed"
  | "Cancelled"
  | (string & {});
export type PurchaseOrder = {
  id: string;
  poNumber: string;
  vendorName: string;
  /** FK → vendors.id (B11). */
  vendorId?: string | null;
  description: string;
  budgetCode: string;
  linkedBudgetLineId?: string | null;
  /** Record-currency (SAR) amount. */
  amount: number;
  currency?: string | null;
  fxRate?: number | null;
  amountOriginal?: number | null;
  status: PurchaseOrderStatus;
  date: string;
  notes?: string;
};

export type PaymentSource = "invoice" | "purchase_order" | "petty_cash";
export type PaymentMethod = "Cash" | "Transfer" | "Check" | "Card" | "Bank";
export type Payment = {
  id: string;
  sourceType: PaymentSource;
  sourceId: string;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  proofPath?: string | null;
  notes?: string | null;
  createdAt?: string;
};

export const CONTRACT_STATUSES = [
  "Missing Data",
  "Pending Contract",
  "Signed - Awaiting Review",
  "Active",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export type Person = {
  id: string;
  projectId?: string | null;
  organizationId?: string | null;
  kind: "crew" | "cast";
  fullName: string;
  position: string;
  // `deal` was removed — calculations now derive from dailyRate × shootingDays + perDiem.
  ccy?: string;
  paymentTerm?: number;
  character?: string;
  nationality: string;
  idNumber: string;
  iban: string;
  bank: string;
  bankCountry?: string;
  /** Auto-filled SWIFT/BIC when a known bank is selected. */
  swiftCode?: string;

  startDate: string;
  endDate: string;
  shootingDays: number;
  dailyRate: number;
  /** Legacy field — kept in sync = onSetPerDiem (per working day). */
  perDiem: number;
  /** Per-diem paid on shooting/working days. */
  onSetPerDiem: number;
  /** Per-diem paid on rest/off days. Defaults to 2× onSetPerDiem, editable. */
  offSetPerDiem: number;
  /** Optional fixed housing allowance (paid alongside wages during payroll runs). */
  housingAllowance?: number;
  contractStatus?: ContractStatus;
  contractPath?: string | null;
  idAttachmentPath?: string | null;
  ibanAttachmentPath?: string | null;
  /** Optional external cloud attachment (Google Drive, Dropbox, SharePoint…). */
  attachmentUrl?: string | null;
  approvalStatus?: "Pending Admin Approval" | "Approved" | "Rejected" | null;
  approvalReason?: "Overtime" | "Contract Addendum" | null;
  approvalDescription?: string | null;
  /** Logistics — controls visibility in Daily Transport passenger picker. */
  requiresTransport?: boolean;
  /** Logistics — controls visibility in Car Rentals / Transport driver picker. */
  isDriver?: boolean;
  /** FK → public.accommodations.id — assigned hotel/roster entry. */
  accommodationId?: string | null;
  /** Finance Roles — controls Purchaser dropdown & petty-cash custodian assignments. */
  isPurchaser?: boolean;
  isPettyCashCustodian?: boolean;
  /** Exact FK → public.budget_lines.id selected on the contract. */
  linkedBudgetLineId?: string | null;
  /** Deal structure. Legacy rows fall back to "weekly". */
  dealType?: DealType;
  /** Foundational overtime data — never rolled into the contract total. */
  overtimeRate?: number | null;
  overtimeUnit?: OvertimeUnit | null;
  /** Optional contact details. */
  phoneNumber?: string | null;
  email?: string | null;
  /** WHT handling: inclusive = deducted from the agreed amount, exclusive = gross-up. */
  whtTreatment?: "inclusive" | "exclusive";
  /** Confirmed by the user; null = not confirmed (form suggests the rule). */
  taxResidency?: "resident" | "non_resident" | null;
  /** wht_rate_rules service type; null = default. */
  whtServiceType?: string | null;
  /** WHT % applied on this contract (snapshot). */
  whtRate?: number | null;
  idType?: "national_id" | "iqama" | "passport" | null;
  motherSaudi?: boolean | null;
  relatedParty?: boolean | null;
  /**
   * FK → public.persons.id (db/pending/190): the person this contract belongs
   * to. `undefined` while 190 is not applied; `null` = not linked yet (the
   * database links / creates the profile on save).
   */
  personId?: string | null;
  /** Saudi trainee — Film Commission headcount (db/pending/197). */
  isTrainee?: boolean | null;
};

export type DealType = "weekly" | "daily" | "package";
export type OvertimeUnit = "hour" | "day" | "week" | "package";
export const DEAL_TYPES: DealType[] = ["weekly", "daily", "package"];
export const OVERTIME_UNITS: OvertimeUnit[] = ["hour", "day", "week", "package"];
export const DEAL_TYPE_LABEL: Record<DealType, string> = {
  weekly: "Weekly (Weeks × Weekly Rate)",
  daily: "Daily (Days × Daily Rate)",
  package: "Package (Flat total)",
};
export const OVERTIME_UNIT_LABEL: Record<OvertimeUnit, string> = {
  hour: "Hour",
  day: "Day",
  week: "Week",
  package: "Package",
};
/** Always resolves to a valid deal type — protects legacy rows. */
export function normalizeDealType(v: unknown): DealType {
  return v === "daily" || v === "package" ? v : "weekly";
}

export type PaymentApprovalStatus = "Pending Approval" | "Approved" | "Paid" | "Rejected";

export type PaymentLedgerEntry = {
  id: string;
  date: string;
  amount: number;
  bankRef: string;
  proofPath: string | null;
  /** Approval workflow: Pending Approval → Approved → Paid. Only "Paid" hits Top Sheet actuals. */
  status?: PaymentApprovalStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  paidBy?: string | null;
  paidAt?: string | null;
  rejectionReason?: string | null;
  /** Accountant memo — e.g. "Partial payment", "Equipment deduction". Set via manual override on Pending entries. */
  memo?: string | null;
};

/**
 * Per-milestone payable state used by the Crew & Cast Payables aging report.
 * Maker-checker: "Approved" is the maker's authorization, "Paid" is the
 * checker's execution and always carries proof of payment.
 */
export type MilestoneStatus = "Pending" | "Approved" | "Paid" | "Hold";

export type PaymentScheduleItem = {
  /** Milestone workflow state. Defaults to "Pending" for legacy rows. */
  status?: MilestoneStatus;
  id: string;
  label: string;
  percent: number;
  dueDate: string;
  /** Explicit flat amount; `null` means "derive from percent". */
  amount: number | null;
  /** Storage path of the proof-of-payment document (set on execution). */
  proofPath?: string | null;
  /** Value date of the executed payment. */
  paidDate?: string | null;
  /** Bank / transfer reference captured at execution. */
  paidRef?: string | null;
  /** GL: how the payment was made (wire_transfer, check, cash…). */
  paymentMethod?: string | null;
  /** GL: which account funded the payment (main_production, petty_cash…). */
  sourceAccount?: string | null;
  /** External link to the receipt / proof document. */
  receiptUrl?: string | null;
  /** Free-text execution note. */
  paidNotes?: string | null;
};

/** Extra evidence captured when a milestone is executed (checker step). */
export type MilestoneExecution = {
  proofPath?: string | null;
  paidDate?: string | null;
  paidRef?: string | null;
  paymentMethod?: string | null;
  sourceAccount?: string | null;
  receiptUrl?: string | null;
  paidNotes?: string | null;
};

export type PayrollRow = {
  id: string;
  refId: string;
  name: string;
  kind: "vendor" | "crew" | "cast";
  totalAmount: number;
  payments: Status[];
  receipts: (string | null)[];
  /** Per-slot percentages (sum should equal 100). Empty = legacy row. */
  percents: number[];
  /** Budget sub-account code this contract is charged to. */
  budgetCode: string | null;
  /** Optional Chart of Accounts (GL) reference — used for reporting only. */
  glAccountId?: string | null;
  /** Dynamic Payment Ledger — actual payments recorded against the contract. */
  ledger?: PaymentLedgerEntry[];
  /** Planned milestone schedule from the contract. */
  paymentSchedule?: PaymentScheduleItem[];
  /** Withholding tax on non-Saudi bank/vendor. */
  whtPercent?: number;
  whtAmount?: number;
  netPayable?: number;
  /** GL account code where WHT is posted (e.g. "2140" — Withholding Tax Liability). */
  whtGlCode?: string;
  whtTreatment?: "inclusive" | "exclusive";
  /** A04: set by cancel_payroll_contract — no Commitment left on the contract. */
  contractCancelledAt?: string | null;
  contractCancellationReason?: string | null;
};

export type ProjectStatus = ProjectStatusOption;

export type ProductionKind = "film" | "series" | "commercial";

export type ProjectSummary = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  projectType: string;
  currency: string;
  organizationId: string | null;
  organizationName?: string | null;
  productionKind: ProductionKind;
  budgetStatus: "Draft" | "Pending Approval" | "Locked/Approved" | "Revision Requested";
  /** USD → SAR exchange rate. Defaults to 3.75 when unset in DB. */
  fxRate: number;
};

type State = {
  ready: boolean;
  /** Last scoped-data fetch failure, surfaced as a retryable toast in the shell. */
  loadError: string | null;
  /**
   * True while the budget lines of the selected version are being fetched and
   * nothing trustworthy is on screen yet (first load, version switch). Screens
   * show a loader instead of rendering an empty budget as zeros.
   */
  budgetLoading: boolean;

  projectName: string;
  projectType: string;
  projectStatus: ProjectStatus;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  /** Per-project offline fallback. Prevents reload/deploy/network hiccups from blanking Active Budget. */
  budgetCache: Record<string, BudgetLine[]>;
  budget: BudgetLine[];
  vendors: Vendor[];
  invoices: Invoice[];
  cashAdvances: CashAdvance[];
  people: Person[];
  payroll: PayrollRow[];
  receipts: CashAdvanceReceipt[];
  purchaseOrders: PurchaseOrder[];
  payments: Payment[];
  bootstrap: () => Promise<void>;
  loadProjects: () => Promise<void>;
  reloadScopedData: () => Promise<void>;
  setActiveProject: (id: string | null) => Promise<void>;
  setProductionKind: (id: string, kind: ProductionKind) => Promise<void>;
  setProjectFxRate: (id: string, rate: number) => Promise<void>;
  setProjectName: (name: string) => void;
  setProjectType: (projectType: string) => void;
  setProjectCurrency: (currency: string) => void;
  setProjectStatus: (status: ProjectStatus) => void;
  addBudgetLine: (l: BudgetLine) => Promise<BudgetLine | undefined>;
  addBudgetLines: (lines: BudgetLine[]) => Promise<void>;
  /** opts.changeReason is saved to budget_lines.change_reason with the edit (Budget Change Log, N10). */
  updateBudgetLine: (
    id: string,
    patch: Partial<BudgetLine>,
    opts?: { changeReason?: string },
  ) => Promise<BudgetLine | undefined>;

  removeBudgetLine: (id: string) => Promise<void>;
  clearProjectBudget: () => Promise<number>;
  addVendor: (v: Vendor) => Promise<void>;
  updateVendor: (id: string, patch: Partial<Vendor>) => Promise<void>;
  removeVendor: (id: string) => Promise<void>;
  addInvoice: (i: Invoice) => Promise<void>;
  updateInvoice: (id: string, patch: Partial<Invoice>) => Promise<void>;
  removeInvoice: (id: string) => Promise<void>;
  addPurchaseOrder: (p: PurchaseOrder) => Promise<void>;
  updatePurchaseOrder: (id: string, patch: Partial<PurchaseOrder>) => Promise<void>;
  removePurchaseOrder: (id: string) => Promise<void>;
  addCashAdvance: (c: CashAdvance) => Promise<void>;
  reconcileCashAdvance: (id: string) => Promise<void>;
  addPerson: (p: Person) => Promise<void>;
  updatePerson: (id: string, patch: Partial<Person>) => Promise<void>;
  removePerson: (id: string) => Promise<void>;
  addPayroll: (p: PayrollRow) => Promise<void>;
  syncPayrollForContract: (
    refId: string,
    patch: {
      name?: string;
      kind?: "vendor" | "crew" | "cast";
      totalAmount?: number;
      percents?: number[];
      budgetCode?: string | null;
      paymentSchedule?: PaymentScheduleItem[];
      whtPercent?: number;
      whtAmount?: number;
      netPayable?: number | null;
      whtTreatment?: "inclusive" | "exclusive";
    },
  ) => Promise<void>;
  addReceipt: (r: CashAdvanceReceipt) => Promise<void>;
  updateReceipt: (id: string, patch: Partial<CashAdvanceReceipt>) => Promise<void>;
  removeReceipt: (id: string) => Promise<void>;
  togglePayment: (rowId: string, idx: number) => Promise<void>;
  updatePayment: (
    rowId: string,
    idx: number,
    patch: { status?: Status; receipt?: string | null },
  ) => Promise<void>;
  updatePayrollGlAccount: (rowId: string, glAccountId: string | null) => Promise<void>;
  setPayrollLedger: (refId: string, ledger: PaymentLedgerEntry[]) => Promise<void>;
  /** Re-read one payroll row after the database changed it (e.g. a payment request moved an instalment). */
  refreshPayrollRow: (payrollRowId: string) => Promise<void>;
  /** Toggle a single contract milestone's payable state without touching the contract. */
  setMilestoneStatus: (
    payrollRowId: string,
    milestoneId: string,
    status: MilestoneStatus,
    execution?: MilestoneExecution,
  ) => Promise<void>;

  ensureBudgetCode: (budgetCode: string) => Promise<void>;
  recordPayment: (p: Omit<Payment, "id"> & { id?: string }) => Promise<Payment>;
  removePayment: (id: string) => Promise<void>;

  commitTransaction: (input: {
    budgetCode: string;
    description: string;
    amount: number;
    vatAmount?: number;
    currency?: string;
    transactionType?: "payroll" | "invoice" | "cash_expense" | "cash_advance" | "receipt";
    referenceNo?: string;
    department?: string;
    isFilmCommissionEligible?: boolean;
    paymentStatus?: "Committed" | "Upcoming" | "Due" | "Paid" | "Cancelled";
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
};

const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

// Row mappers
const fromBudgetRow = (r: any): BudgetLine => ({
  id: r.id,
  headerCode: r.header_code,
  mainCode: r.main_code,
  description: r.description,
  name: r.name ?? "",
  amount: Number(r.amount),
  rate: Number(r.rate),
  unit: r.unit,
  x: Number(r.x),
  group: r.group,
  currency: (r.currency === "SAR" ? "SAR" : "USD") as BudgetCurrency,
  prep: r.prep != null ? Number(r.prep) : 0,
  shooting: r.shooting != null ? Number(r.shooting) : 0,
  wrap: r.wrap != null ? Number(r.wrap) : 0,
  notes: r.notes ?? "",
  topsheetCode: r.topsheet_code ?? null,
  excluded: !!r.excluded,
  rebateEligible: !!r.rebate_eligible,
  ...(r.region !== undefined ? { region: r.region ?? null } : {}),
});
const activePid = () => useStore.getState().activeProjectId ?? null;
const activeOrgId = () => {
  const s = useStore.getState();
  const pid = s.activeProjectId;
  if (!pid) return null;
  return s.projects.find((p) => p.id === pid)?.organizationId ?? null;
};

/**
 * db/pending/201: budget_lines.region (not in the generated types yet) is sent
 * only when the row was loaded with it, so a database without 201 never gets it.
 */
function withRegion<T extends object>(row: T, l: BudgetLine): T {
  if (l.region !== undefined) {
    (row as Record<string, unknown>).region = l.region ? normalizeKsaRegion(l.region) : null;
  }
  return row;
}

const toBudgetRow = (l: BudgetLine) => withRegion(budgetRowBase(l), l);
const budgetRowBase = (l: BudgetLine) => ({
  id: l.id,
  header_code: l.headerCode,
  main_code: l.mainCode,
  description: l.description,
  name: l.name ?? null,
  amount: l.amount,
  rate: l.rate,
  unit: l.unit,
  x: totalPeriods(l),
  group: l.group,
  currency: l.currency ?? "SAR",
  prep: Number(l.prep ?? 0),
  shooting: Number(l.shooting ?? 0),
  wrap: Number(l.wrap ?? 0),
  notes: l.notes ?? null,
  topsheet_code: l.topsheetCode ?? null,
  excluded: !!l.excluded,
  rebate_eligible: !!l.rebateEligible,
  project_id: activePid(),
  organization_id: activeOrgId(),
  // Budget versioning: writes always land in the currently selected version
  // (a draft, or the active/published one). A DB trigger stamps the active
  // version when this is null.
  version_id: selectedVersionIdSync(activePid()),
});

/**
 * Adds the "reason for change" (db/pending/184 budget_lines.change_reason,
 * max 500 chars) to an update row when the user typed one.
 */
export const withChangeReason = <T extends Record<string, unknown>>(row: T, reason?: string) => {
  const r = String(reason ?? "")
    .trim()
    .slice(0, 500);
  return (r ? { ...row, change_reason: r } : row) as T;
};

/** Never blank an existing line's version on update. */
const stripNullVersion = (row: any) => {
  if (row.version_id) return row;
  const { version_id: _omit, ...rest } = row;
  return rest;
};

const fromVendorRow = (r: any): Vendor => ({
  id: r.id,
  name: r.name,
  category: r.category ?? "",
  crNo: r.cr_no ?? "",
  vatNo: r.vat_no ?? "",
  email: r.email ?? "",
  contactName: r.contact_name ?? "",
  position: r.position ?? "",
  mobile: r.mobile ?? "",
  iban: r.iban ?? "",
  sharedDriveUrl: r.shared_drive_url ?? "",
  bankName: r.bank_name ?? "",
  bankCountry: r.bank_country ?? "",
  swiftCode: r.swift_code ?? "",
  paymentTerms: (r.payment_terms ?? "") as any,
  vendorScope: (r.vendor_scope ?? "") as any,
  companyNationality: r.company_nationality ?? "",
  taxResidency: r.tax_residency,
  relatedParty: r.related_party === undefined ? undefined : !!r.related_party,
  relatedPartyNote: r.related_party_note,
});
const toVendorRow = (v: Vendor) => ({
  id: v.id,
  name: v.name,
  category: v.category,
  cr_no: v.crNo,
  vat_no: v.vatNo,
  email: v.email,
  contact_name: v.contactName ?? null,
  position: v.position ?? null,
  mobile: v.mobile ?? null,
  iban: v.iban ?? null,
  shared_drive_url: v.sharedDriveUrl?.trim() ? v.sharedDriveUrl.trim() : null,
  bank_name: v.bankName?.trim() ? v.bankName.trim() : null,
  bank_country: v.bankCountry?.trim() ? v.bankCountry.trim() : null,
  swift_code: v.swiftCode?.trim() ? v.swiftCode.trim() : null,
  payment_terms: v.paymentTerms ? v.paymentTerms : null,
  vendor_scope: v.vendorScope ? v.vendorScope : null,
  company_nationality: v.companyNationality?.trim() ? v.companyNationality.trim() : null,
  ...definedOnly({
    tax_residency: v.taxResidency,
    related_party: v.relatedParty,
    related_party_note:
      v.relatedPartyNote === undefined
        ? undefined
        : v.relatedPartyNote?.trim()
          ? v.relatedPartyNote.trim().slice(0, 1000)
          : null,
  }),
  project_id: activePid(),
  organization_id: activeOrgId(),
});

const fromInvoiceRow = (r: any): Invoice => ({
  id: r.id,
  // before db/pending/201 every invoice counted as approved
  approvalStatus: (["pending", "approved", "rejected", "cancelled"].includes(r.approval_status)
    ? r.approval_status
    : "approved") as InvoiceApprovalStatus,
  createdBy: r.created_by ?? null,
  lastEditedBy: r.last_edited_by ?? null,
  approvedBy: r.approved_by ?? null,
  approvedAt: r.approved_at ?? null,
  rejectionReason: r.rejection_reason ?? null,
  cancellationReason: r.cancellation_reason ?? null,
  projectId: r.project_id ?? null,
  organizationId: r.organization_id ?? null,
  description: r.description,
  department: r.department ?? "",
  budgetCode: r.budget_code ?? "",
  price: Number(r.price),
  vatable: !!r.vatable,
  date: r.date ?? "",
  invoiceNo: r.invoice_no ?? "",
  vendorName: r.vendor_name ?? "",
  purchaserName: r.purchaser_name ?? "",
  purchaserId: r.purchaser_id ?? null,
  paymentTerm: Number(r.payment_term ?? 0),
  glAccountId: r.gl_account_id ?? null,
  isNonSaudiVendor: !!r.is_non_saudi_vendor,
  whtPercent: Number(r.wht_percent ?? 0),
  whtAmount: Number(r.wht_amount ?? 0),
  netPayable: r.net_payable != null ? Number(r.net_payable) : undefined,
  whtGlCode: r.wht_gl_code ?? undefined,
  invoiceUrl: r.invoice_url ?? null,
  receiptUrl: r.receipt_url ?? null,
  attachmentUrl: r.attachment_url ?? null,
  rebateEligible: !!r.rebate_eligible,
  beneficiaryId: r.beneficiary_id ?? null,
  serviceInsideKsa: r.service_inside_ksa == null ? true : !!r.service_inside_ksa,
  rebateManualOverride: !!r.rebate_manual_override,
  vatAmount: r.vat_amount != null ? Number(r.vat_amount) : 0,
  vatTreatment: normalizeVatTreatment(r.vat_treatment, !!r.vatable),
  vatRate: r.vat_rate != null ? Number(r.vat_rate) : null,
  purchaseOrderId: r.purchase_order_id ?? null,
  paymentTerms: r.payment_terms ?? null,
  dueDate: r.due_date ?? null,
  paymentMethod: r.payment_method ?? null,
  currency: r.currency ?? null,
  fxRate: r.fx_rate != null ? Number(r.fx_rate) : null,
  amountOriginal: r.amount_original != null ? Number(r.amount_original) : null,
  servicePeriodFrom: r.service_period_from ?? null,
  servicePeriodTo: r.service_period_to ?? null,
  serviceReceivedDate: r.service_received_date ?? null,
  isRelatedParty: !!r.is_related_party,
  relatedPartyNote: r.related_party_note ?? null,
  vendorId: r.vendor_id,
  vendorCrNo: r.vendor_cr_no,
  vendorVatNo: r.vendor_vat_no,
  vendorCountry: r.vendor_country,
  vendorTaxResidency: r.vendor_tax_residency,
  vendorBankCountry: r.vendor_bank_country,
  vendorBankName: r.vendor_bank_name,
  fxRateSource: r.fx_rate_source,
  fxRateDate: r.fx_rate_date,
});
const toInvoiceRow = (i: Invoice) => ({
  id: i.id,
  description: i.description,
  department: i.department,
  budget_code: i.budgetCode,
  price: i.price,
  vatable: i.vatable,
  date: i.date || null,
  invoice_no: i.invoiceNo,
  vendor_name: i.vendorName,
  purchaser_name: i.purchaserName ?? null,
  purchaser_id: i.purchaserId ?? null,
  payment_term: i.paymentTerm ?? 0,
  gl_account_id: i.glAccountId ?? null,
  is_non_saudi_vendor: !!i.isNonSaudiVendor,
  wht_percent: i.whtPercent ?? 0,
  wht_amount: i.whtAmount ?? 0,
  net_payable: i.netPayable ?? null,
  wht_gl_code: i.whtAmount && i.whtAmount > 0 ? (i.whtGlCode ?? "2140") : null,
  invoice_url: i.invoiceUrl ?? null,
  receipt_url: i.receiptUrl ?? null,
  attachment_url: i.attachmentUrl?.trim() ? i.attachmentUrl.trim() : null,
  rebate_eligible: !!i.rebateEligible,
  beneficiary_id: i.beneficiaryId ?? null,
  service_inside_ksa: i.serviceInsideKsa == null ? true : !!i.serviceInsideKsa,
  rebate_manual_override: !!i.rebateManualOverride,
  vat_amount: i.vatAmount ?? 0,
  vat_treatment: i.vatTreatment ?? (i.vatable ? "standard" : "exempt"),
  vat_rate: i.vatRate ?? null,
  purchase_order_id: i.purchaseOrderId ?? null,
  payment_terms: i.paymentTerms || null,
  due_date: i.dueDate || null,
  payment_method: i.paymentMethod ?? null,
  currency: i.currency || null,
  fx_rate: i.fxRate ?? null,
  amount_original: i.amountOriginal ?? null,
  service_period_from: i.servicePeriodFrom || null,
  service_period_to: i.servicePeriodTo || null,
  service_received_date: i.serviceReceivedDate || null,
  is_related_party: !!i.isRelatedParty,
  related_party_note: i.relatedPartyNote?.trim() ? i.relatedPartyNote.trim().slice(0, 1000) : null,
  ...definedOnly({
    vendor_id: i.vendorId,
    vendor_cr_no: i.vendorCrNo,
    vendor_vat_no: i.vendorVatNo,
    vendor_country: i.vendorCountry,
    vendor_tax_residency: i.vendorTaxResidency,
    vendor_bank_country: i.vendorBankCountry,
    vendor_bank_name: i.vendorBankName,
    fx_rate_source: i.fxRateSource,
    fx_rate_date: i.fxRateDate || (i.fxRateDate === undefined ? undefined : null),
  }),
  project_id: i.projectId ?? activePid(),
  organization_id: i.organizationId ?? activeOrgId(),
});

const fromAdvanceRow = (r: any): CashAdvance => ({
  id: r.id,
  holder: r.holder,
  totalAdvance: Number(r.total_advance),
  expenses: Number(r.expenses),
  status: (r.status === "Reconciled" ? "Reconciled" : "Active") as CashAdvanceStatus,
});

const fromPurchaseOrderRow = (r: any): PurchaseOrder => ({
  id: r.id,
  poNumber: r.po_number ?? "",
  vendorName: r.vendor_name ?? "",
  vendorId: r.vendor_id ?? null,
  description: r.description ?? "",
  budgetCode: r.budget_code ?? "",
  linkedBudgetLineId: r.linked_budget_line_id ?? null,
  amount: Number(r.amount ?? 0),
  currency: r.currency ?? null,
  fxRate: r.fx_rate != null ? Number(r.fx_rate) : null,
  amountOriginal: r.amount_original != null ? Number(r.amount_original) : null,
  status: (r.status ?? "Open") as PurchaseOrderStatus,
  date: r.date ?? "",
  notes: r.notes ?? "",
});
const toPurchaseOrderRow = (p: PurchaseOrder) => ({
  id: p.id,
  po_number: p.poNumber,
  vendor_name: p.vendorName,
  description: p.description,
  budget_code: p.budgetCode || null,
  amount: p.amount,
  status: p.status,
  date: p.date || null,
  notes: p.notes ?? null,
  project_id: activePid(),
});
const toAdvanceRow = (c: CashAdvance) => ({
  id: c.id,
  holder: c.holder,
  total_advance: c.totalAdvance,
  expenses: c.expenses,
  status: c.status ?? "Active",
  project_id: activePid(),
});

const fromPersonRow = (r: any): Person => ({
  id: r.id,
  projectId: r.project_id ?? null,
  organizationId: r.organization_id ?? null,
  kind: r.kind,
  fullName: r.full_name,
  position: r.position ?? "",
  nationality: r.nationality ?? "",
  idNumber: r.id_number ?? "",
  iban: r.iban ?? "",
  bank: r.bank ?? "",
  bankCountry: r.bank_country ?? "",
  swiftCode: r.swift_code ?? "",
  startDate: r.start_date ?? "",
  endDate: r.end_date ?? "",
  shootingDays: Number(r.shooting_days),
  dailyRate: Number(r.daily_rate),
  perDiem: Number(r.per_diem),
  onSetPerDiem: Number(r.on_set_per_diem ?? r.per_diem ?? 0),
  offSetPerDiem: Number(r.off_set_per_diem ?? (r.per_diem ? Number(r.per_diem) * 2 : 0)),
  housingAllowance: r.housing_allowance != null ? Number(r.housing_allowance) : undefined,
  ccy: r.ccy ?? "USD",
  paymentTerm: Number(r.payment_term ?? 0),
  character: r.character ?? "",
  contractStatus: (r.contract_status ?? "Pending Contract") as ContractStatus,
  contractPath: r.contract_path ?? null,
  idAttachmentPath: r.id_attachment_path ?? null,
  ibanAttachmentPath: r.iban_attachment_path ?? null,
  attachmentUrl: r.attachment_url ?? null,
  approvalStatus: (r.approval_status ?? null) as Person["approvalStatus"],
  approvalReason: (r.approval_reason ?? null) as Person["approvalReason"],
  approvalDescription: r.approval_description ?? null,
  requiresTransport: Boolean(r.requires_transport ?? false),
  isDriver: Boolean(r.is_driver ?? false),
  accommodationId: r.accommodation_id ?? null,
  isPurchaser: Boolean(r.is_purchaser ?? false),
  isPettyCashCustodian: Boolean(r.is_petty_cash_custodian ?? false),
  linkedBudgetLineId: r.linked_budget_line_id ?? null,
  dealType: normalizeDealType(r.deal_type),
  overtimeRate: r.overtime_rate != null ? Number(r.overtime_rate) : null,
  overtimeUnit: (r.overtime_unit ?? null) as Person["overtimeUnit"],
  phoneNumber: r.phone_number ?? null,
  email: r.email ?? null,
  whtTreatment: r.wht_treatment === "exclusive" ? "exclusive" : "inclusive",
  // Columns from db/pending/172 — `undefined` while that file is not applied,
  // so toPersonRow leaves them out of the write.
  taxResidency: r.tax_residency,
  whtServiceType: r.wht_service_type,
  whtRate: r.wht_rate === undefined ? undefined : r.wht_rate === null ? null : Number(r.wht_rate),
  idType: r.id_type,
  motherSaudi: r.mother_saudi,
  relatedParty: r.related_party,
  personId: r.person_id,
  isTrainee: r.is_trainee,
});
/** Only send optional columns the record actually carries (see fromPersonRow). */
const definedOnly = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const toPersonRow = (p: Person) => ({
  id: p.id,
  kind: p.kind,
  full_name: p.fullName,
  position: p.position,
  nationality: p.nationality,
  id_number: p.idNumber,
  iban: p.iban,
  bank: p.bank,
  bank_country: p.bankCountry ?? null,
  swift_code: p.swiftCode?.trim() ? p.swiftCode.trim() : null,
  start_date: p.startDate || null,
  end_date: p.endDate || null,
  shooting_days: p.shootingDays,
  daily_rate: p.dailyRate,
  per_diem: p.onSetPerDiem ?? p.perDiem ?? 0,
  on_set_per_diem: p.onSetPerDiem ?? p.perDiem ?? 0,
  off_set_per_diem: p.offSetPerDiem ?? (p.onSetPerDiem ?? p.perDiem ?? 0) * 2,
  housing_allowance: p.housingAllowance ?? null,
  ccy: p.ccy ?? "SAR",
  payment_term: p.paymentTerm ?? 0,
  character: p.character ?? null,
  contract_status: p.contractStatus ?? "Pending Contract",
  contract_path: p.contractPath ?? null,
  id_attachment_path: p.idAttachmentPath ?? null,
  iban_attachment_path: p.ibanAttachmentPath ?? null,
  attachment_url: p.attachmentUrl?.trim() ? p.attachmentUrl.trim() : null,
  approval_status: p.approvalStatus ?? null,
  approval_reason: p.approvalReason ?? null,
  approval_description: p.approvalDescription ?? null,
  requires_transport: Boolean(p.requiresTransport ?? false),
  is_driver: Boolean(p.isDriver ?? false),
  accommodation_id: p.accommodationId ?? null,
  is_purchaser: Boolean(p.isPurchaser ?? false),
  is_petty_cash_custodian: Boolean(p.isPettyCashCustodian ?? false),
  linked_budget_line_id: p.linkedBudgetLineId ?? null,
  deal_type: normalizeDealType(p.dealType),
  overtime_rate:
    p.overtimeRate != null && Number.isFinite(Number(p.overtimeRate))
      ? Number(p.overtimeRate)
      : null,
  overtime_unit: p.overtimeUnit ?? null,
  phone_number: p.phoneNumber?.trim() ? p.phoneNumber.trim() : null,
  email: p.email?.trim() ? p.email.trim() : null,
  wht_treatment: p.whtTreatment === "exclusive" ? "exclusive" : "inclusive",
  ...definedOnly({
    tax_residency: p.taxResidency,
    wht_service_type: p.whtServiceType,
    wht_rate: p.whtRate,
    id_type: p.idType,
    mother_saudi: p.motherSaudi,
    related_party: p.relatedParty,
    person_id: p.personId,
    is_trainee: p.isTrainee,
  }),
  project_id: p.projectId ?? activePid(),
  organization_id: p.organizationId ?? activeOrgId(),
});

const fromReceiptRow = (r: any): CashAdvanceReceipt => ({
  id: r.id,
  advanceId: r.advance_id ?? undefined,
  receivedFrom: r.received_from ?? "",
  recipient: r.recipient,
  department: r.department ?? "",
  method: (r.method ?? "Cash") as any,
  amount: Number(r.amount),
  date: r.date ?? "",
  glAccountId: r.gl_account_id ?? null,
  status: r.status ?? undefined,
  budgetCode: r.budget_code ?? undefined,
});
const toReceiptRow = (r: CashAdvanceReceipt) => ({
  id: r.id,
  advance_id: r.advanceId ?? null,
  received_from: r.receivedFrom ?? null,
  recipient: r.recipient,
  department: r.department ?? null,
  method: r.method,
  amount: r.amount,
  date: r.date || null,
  gl_account_id: r.glAccountId ?? null,
});

const fromPayrollRow = (r: any): PayrollRow => {
  const payments = (r.payments ?? []) as Status[];
  const rawReceipts = (r.receipts ?? []) as (string | null)[];
  const rawPercents = (r.percents ?? []) as number[];
  const receipts = payments.map((_, i) => rawReceipts[i] ?? null);
  const percents = payments.map((_, i) => Number(rawPercents[i] ?? 0));
  const rawLedger = (r.ledger ?? []) as any[];
  const ledger: PaymentLedgerEntry[] = Array.isArray(rawLedger)
    ? rawLedger.map((e) => ({
        id: e?.id ?? newId(),
        date: e?.date ?? "",
        amount: Number(e?.amount ?? 0),
        bankRef: e?.bankRef ?? e?.bank_ref ?? "",
        proofPath: e?.proofPath ?? e?.proof_path ?? null,
        status: e?.status ?? "Pending Approval",
        approvedBy: e?.approvedBy ?? e?.approved_by ?? null,
        approvedAt: e?.approvedAt ?? e?.approved_at ?? null,
        paidBy: e?.paidBy ?? e?.paid_by ?? null,
        paidAt: e?.paidAt ?? e?.paid_at ?? null,
        rejectionReason: e?.rejectionReason ?? e?.rejection_reason ?? null,
        memo: e?.memo ?? null,
      }))
    : [];
  const rawSchedule = parseJsonArray(r.payment_schedule ?? []);
  const paymentSchedule: PaymentScheduleItem[] = rawSchedule.map((e) => ({
    id: e?.id ?? newId(),
    label: e?.label ?? "",
    percent: Number(e?.percent ?? 0),
    dueDate: e?.dueDate ?? e?.due_date ?? "",
    // Keep every stored state (Approved = Actual); Hold is shown as "Requested".
    status:
      e?.status === "Paid" || e?.status === "Hold" || e?.status === "Approved"
        ? e.status
        : "Pending",
    paidDate: e?.paidDate ?? null,
    paidRef: e?.paidRef ?? null,
    paymentMethod: e?.paymentMethod ?? null,
    proofPath: e?.proofPath ?? null,
    // Preserve the "no explicit amount" case: coercing null to 0 would
    // hydrate an edit form with a hard 0 milestone instead of a
    // percent-derived one.
    amount:
      e?.amount === null || e?.amount === undefined || e?.amount === ""
        ? null
        : roundMoney(Number(e.amount)),
  }));
  return {
    id: r.id,
    refId: r.ref_id ?? "",
    name: r.name,
    kind: r.kind,
    totalAmount: Number(r.total_amount),
    payments,
    receipts,
    percents,
    budgetCode: r.budget_code ?? null,
    glAccountId: r.gl_account_id ?? null,
    ledger,
    paymentSchedule,
    whtPercent: Number(r.wht_percent ?? 0),
    whtAmount: Number(r.wht_amount ?? 0),
    netPayable: r.net_payable != null ? Number(r.net_payable) : undefined,
    whtGlCode: r.wht_gl_code ?? undefined,
    whtTreatment: r.wht_treatment === "exclusive" ? "exclusive" : "inclusive",
    contractCancelledAt: r.contract_cancelled_at ?? null,
    contractCancellationReason: r.contract_cancellation_reason ?? null,
  };
};
/** Strict 2-decimal rounding for money and money-derived percentages. */
const roundMoney = (n: unknown): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const scaled = v * 100;
  return Math.round(scaled + (scaled >= 0 ? 1e-8 : -1e-8)) / 100;
};

function parseJsonArray(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Server contract: every payment_schedule amount/percent must be exact to the
 * cent, non-negative, and percents within 0-100. A trigger rejects anything
 * else, so normalize before the write.
 */
export const normalizePaymentSchedule = (
  rows: PaymentScheduleItem[] | undefined | null,
): PaymentScheduleItem[] =>
  (rows ?? []).map((r) => ({
    id: r.id,
    label: r.label ?? "",
    percent: Math.min(100, Math.max(0, roundMoney(r.percent))),
    dueDate: r.dueDate ?? "",
    status:
      r.status === "Paid" || r.status === "Hold" || r.status === "Approved" ? r.status : "Pending",
    amount: r.amount === null || r.amount === undefined ? null : Math.max(0, roundMoney(r.amount)),
    proofPath: r.proofPath ?? null,
    paidDate: r.paidDate ?? null,
    paidRef: r.paidRef ?? null,
    paymentMethod: r.paymentMethod ?? null,
    sourceAccount: r.sourceAccount ?? null,
    receiptUrl: r.receiptUrl ?? null,
    paidNotes: r.paidNotes ?? null,
  }));

const toPayrollRow = (p: PayrollRow) => ({
  id: p.id,
  ref_id: p.refId,
  name: p.name,
  kind: p.kind,
  total_amount: p.totalAmount,
  payments: p.payments,
  receipts: p.receipts,
  percents: p.percents,
  budget_code: p.budgetCode,
  gl_account_id: p.glAccountId ?? null,
  ledger: (p.ledger ?? []) as unknown as any,
  // The DB rejects >2-decimal milestone amounts/percents, so normalize here
  // rather than surfacing a raw constraint error to the user.
  payment_schedule: normalizePaymentSchedule(p.paymentSchedule) as unknown as any,
  wht_percent: p.whtPercent ?? 0,
  wht_amount: p.whtAmount ?? 0,
  net_payable: p.netPayable ?? null,
  wht_gl_code: (p.whtAmount ?? 0) > 0 ? (p.whtGlCode ?? "2140") : null,
  wht_treatment: p.whtTreatment === "exclusive" ? "exclusive" : "inclusive",
  project_id: activePid(),
  // Tenant key — mirrors toBudgetRow. The trg_stamp_payroll_organization
  // trigger backstops this (fills from the project, rejects mismatches).
  organization_id: activeOrgId(),
});

const ACTIVE_PROJECT_KEY = "project.active.v1";
const STORE_PERSIST_KEY = "kwalis.store.persist.v2";
type PersistedStoreState = Partial<Pick<State, "activeProjectId" | "projects" | "budgetCache">>;

const DEFAULT_PROJECT_NAME = "Select a project";
const DEFAULT_STORE_PROJECT_TYPE = CANONICAL_DEFAULT_PROJECT_TYPE;
const DEFAULT_STORE_PROJECT_STATUS: ProjectStatus = CANONICAL_DEFAULT_PROJECT_STATUS;
const scopedEmptyPatch = () => ({
  budget: [],
  budgetLoading: false,
  vendors: [],
  invoices: [],
  cashAdvances: [],
  people: [],
  payroll: [],
  receipts: [],
  purchaseOrders: [],
  payments: [],
});

function normalizeProjectStatus(status: string | null | undefined): ProjectStatus {
  if (status && (PROJECT_STATUSES as readonly string[]).includes(status))
    return status as ProjectStatus;
  const mapped = status ? DB_PROJECT_STATUS_TO_UI[status] : null;
  return mapped ?? DEFAULT_STORE_PROJECT_STATUS;
}

function projectMetaPatch(
  project: ProjectSummary | null,
): Pick<State, "projectName" | "projectType" | "projectStatus"> {
  return {
    projectName: project?.name ?? DEFAULT_PROJECT_NAME,
    projectType: project?.projectType ?? DEFAULT_STORE_PROJECT_TYPE,
    projectStatus: normalizeProjectStatus(project?.status),
  };
}

function readPersistedStoreState(): PersistedStoreState {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORE_PERSIST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { state?: PersistedStoreState };
    return parsed.state ?? (parsed as PersistedStoreState);
  } catch {
    return {};
  }
}

function readActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}
function writeActiveProjectId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    else localStorage.removeItem(ACTIVE_PROJECT_KEY);
  } catch {}
}
const __persistedStore = readPersistedStoreState();
const __initialActiveProjectId = __persistedStore.activeProjectId ?? readActiveProjectId();
const __initialBudgetCache = __persistedStore.budgetCache ?? {};
const cachedBudgetFor = (pid: string | null | undefined, cache: Record<string, BudgetLine[]>) =>
  pid ? (cache[pid] ?? []) : [];

/**
 * Tracks budget_lines rows that were mutated locally in the very recent past.
 * `reloadScopedData` (which can be triggered by realtime events, tab focus,
 * polling, or project switches) MUST NOT overwrite a row whose id is in this
 * window — otherwise a fresh DB fetch racing an optimistic edit can revert
 * the user's just-saved values back to their previous/uploaded state.
 *
 * Entries are keyed by `budget_lines.id` and store the epoch ms of the last
 * successful local write. Rows are considered "locally authoritative" for
 * BUDGET_LOCAL_AUTHORITY_MS after that timestamp.
 */
const budgetLocalAuthority = new Map<string, number>();
const BUDGET_LOCAL_AUTHORITY_MS = 15_000;
export const markBudgetLineLocallyAuthoritative = (id: string) => {
  budgetLocalAuthority.set(id, Date.now());
};
const pruneBudgetLocalAuthority = () => {
  const cutoff = Date.now() - BUDGET_LOCAL_AUTHORITY_MS;
  for (const [id, ts] of budgetLocalAuthority) if (ts < cutoff) budgetLocalAuthority.delete(id);
};

/**
 * Set while a budget-version switch is in flight so the next scoped reload
 * replaces the grid outright instead of merging the previous version's rows.
 */
let __pendingVersionSwitch = false;

function budgetPatchFromCache(s: State, pid: string | null | undefined, budget: BudgetLine[]) {
  if (!pid) return { budget };
  return { budget, budgetCache: { ...s.budgetCache, [pid]: budget } };
}

const DB_PROJECT_STATUS_TO_UI: Record<string, ProjectStatus> = {
  planning: "Planning",
  active: "Production",
  on_hold: "Development",
  completed: "Finalized",
  cancelled: "Finalized",
  "Pre-production": "Pre-Production",
  "In Production": "Production",
  "Post-production": "Post-Production",
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ready: false,
      loadError: null,
      budgetLoading: cachedBudgetFor(__initialActiveProjectId, __initialBudgetCache).length === 0,

      projectName: DEFAULT_PROJECT_NAME,
      projectType: DEFAULT_STORE_PROJECT_TYPE,
      projectStatus: DEFAULT_STORE_PROJECT_STATUS,
      projects: __persistedStore.projects ?? [],
      activeProjectId: __initialActiveProjectId,
      budgetCache: __initialBudgetCache,
      budget: cachedBudgetFor(__initialActiveProjectId, __initialBudgetCache),
      vendors: [],
      invoices: [],
      cashAdvances: [],
      people: [],
      payroll: [],
      receipts: [],
      purchaseOrders: [],
      payments: [],

      bootstrap: async () => {
        try {
          await get().loadProjects();
          await get().reloadScopedData();
        } catch (err: any) {
          console.error("[store] bootstrap failed; keeping persisted budget cache", err);
          set({ loadError: err?.message ?? "Could not load project data.", budgetLoading: false });
        }
        set({ ready: true });
      },

      reloadScopedData: async () => {
        const pid = get().activeProjectId;
        // Project Gateway isolation: with no active project, never issue
        // unscoped queries — they would return cross-project rows under RLS.
        if (!pid) {
          set({
            loadError: null,
            ...scopedEmptyPatch(),
          });
          return;
        }
        // A version switch must never be served from (or merged with) the
        // previous version's rows — the cache is keyed by project only.
        const versionSwitch = __pendingVersionSwitch;
        __pendingVersionSwitch = false;
        const cached = versionSwitch ? [] : (get().budgetCache[pid] ?? []);
        if (cached.length > 0 && get().budget.length === 0) {
          set({ budget: cached });
        }
        if (get().budget.length === 0) set({ budgetLoading: true });
        const scoped = <T>(qb: any) => (pid ? qb.eq("project_id", pid) : qb);
        // Budget versioning: the grid only ever loads ONE version (the
        // selected draft, or the project's active/published version).
        const versionId = await resolveSelectedVersionId(pid).catch(() => null);
        const versionScoped = (qb: any) => (versionId ? qb.eq("version_id", versionId) : qb);
        const [b, v, i, c, p, pr, rc, po, pay] = await Promise.all([
          versionScoped(scoped(supabase.from("budget_lines").select("*").order("created_at"))),
          scoped(supabase.from("vendors").select("*").order("created_at")),
          scoped(supabase.from("invoices").select("*").order("created_at")),
          scoped(supabase.from("cash_advances").select("*").order("created_at")),
          scoped(supabase.from("people").select("*").order("created_at")),
          scoped(supabase.from("payroll").select("*").order("created_at")),
          scoped(supabase.from("cash_advance_receipts").select("*").order("created_at")),
          scoped((supabase.from as any)("purchase_orders").select("*").order("created_at")),
          scoped((supabase.from as any)("payments").select("*").order("created_at")),
        ]);

        if (get().activeProjectId !== pid) return;
        // The user picked another version while this request was in flight: its
        // rows belong to the old selection. The follow-up reload (queued by the
        // version-change listener) applies the right ones.
        const supersededVersion =
          !!versionId &&
          selectedVersionIdSync(pid) !== null &&
          selectedVersionIdSync(pid) !== versionId;

        const currentBudget = versionSwitch ? [] : get().budget;
        const cachedBudget = versionSwitch ? [] : pid ? (get().budgetCache[pid] ?? []) : [];
        let nextBudget = currentBudget;
        if (versionSwitch) budgetLocalAuthority.clear();
        if ((b as any).error) {
          console.error(
            "[store] budget_lines fetch failed; keeping cached budget",
            (b as any).error,
          );
          nextBudget = currentBudget.length > 0 ? currentBudget : cachedBudget;
        } else {
          const fetchedBudget = ((b.data ?? []) as any[]).map(fromBudgetRow);
          // A transient auth/RLS/network mismatch after publish can return an empty
          // budget even though the local project cache has real data. Do not let a
          // passive reload overwrite a non-empty cache with zero. Explicit single-row
          // deletes update the cache through removeBudgetLine; bulk wipes are disabled.
          if (fetchedBudget.length === 0 && (currentBudget.length > 0 || cachedBudget.length > 0)) {
            nextBudget = currentBudget.length > 0 ? currentBudget : cachedBudget;
          } else {
            // Preserve locally-authoritative rows: any row updated in the last
            // BUDGET_LOCAL_AUTHORITY_MS wins over the DB copy so an in-flight
            // realtime/poll refetch cannot revert the user's just-saved edits
            // back to the previous/uploaded template values.
            pruneBudgetLocalAuthority();
            if (budgetLocalAuthority.size === 0) {
              nextBudget = fetchedBudget;
            } else {
              const localById = new Map(currentBudget.map((l) => [l.id, l] as const));
              nextBudget = fetchedBudget.map((row) =>
                budgetLocalAuthority.has(row.id) && localById.has(row.id)
                  ? (localById.get(row.id) as BudgetLine)
                  : row,
              );
              // Also keep any brand-new local rows the server hasn't returned yet
              // (e.g. insert just fired, realtime came in for a different row).
              const fetchedIds = new Set(fetchedBudget.map((l) => l.id));
              for (const [id, ts] of budgetLocalAuthority) {
                if (
                  !fetchedIds.has(id) &&
                  localById.has(id) &&
                  Date.now() - ts < BUDGET_LOCAL_AUTHORITY_MS
                ) {
                  nextBudget.push(localById.get(id) as BudgetLine);
                }
              }
            }
          }
        }

        // Surface any partial failure so the shell can offer a retry instead of
        // silently rendering an empty list.
        const failed = (
          [
            ["budget", b],
            ["vendors", v],
            ["invoices", i],
            ["cash advances", c],
            ["crew & cast", p],
            ["payroll", pr],
            ["receipts", rc],
            ["purchase orders", po],
            ["payments", pay],
          ] as const
        )
          .filter(([, r]) => (r as any)?.error)
          .map(([label]) => label);

        const patch: Partial<State> = {
          loadError: failed.length ? `Could not load: ${failed.join(", ")}.` : null,
          ...(supersededVersion
            ? {}
            : { ...budgetPatchFromCache(get(), pid, nextBudget), budgetLoading: false }),
          vendors: (v.data ?? []).map(fromVendorRow),
          invoices: (i.data ?? []).map(fromInvoiceRow),
          cashAdvances: (c.data ?? []).map(fromAdvanceRow),
          people: (p.data ?? []).map(fromPersonRow),
          payroll: (pr.data ?? []).map(fromPayrollRow),
          receipts: (rc.data ?? []).map(fromReceiptRow),
          purchaseOrders: ((po as any)?.data ?? []).map(fromPurchaseOrderRow),
          payments: (((pay as any)?.data ?? []) as any[]).map((r) => ({
            id: r.id,
            sourceType: r.source_type,
            sourceId: r.source_id,
            amount: Number(r.amount),
            paymentDate: r.payment_date,
            method: r.method,
            proofPath: r.proof_path ?? null,
            notes: r.notes ?? null,
            createdAt: r.created_at,
          })) as Payment[],
        };
        set(patch);
      },

      loadProjects: async () => {
        // Server-side active-organization guard: the server (not the client)
        // decides which org's projects are returned. RLS on public.projects
        // remains the ultimate isolation boundary.
        const { listProjectsForActiveOrg } = await import("./projects.functions");
        const { useImpersonation } = await import("./impersonation");
        const impOrgId = useImpersonation.getState().orgId;
        let projects: ProjectSummary[] = [];
        try {
          // Transient 500s can happen when the request lands before the session
          // token is attached (or while the dev server re-evaluates the module),
          // so retry once before falling back to the cached state.
          let res: Awaited<ReturnType<typeof listProjectsForActiveOrg>>;
          try {
            res = await listProjectsForActiveOrg({
              data: impOrgId ? { activeOrgId: impOrgId } : {},
            });
          } catch {
            await new Promise((r) => setTimeout(r, 400));
            res = await listProjectsForActiveOrg({
              data: impOrgId ? { activeOrgId: impOrgId } : {},
            });
          }
          projects = (res.projects ?? []).map((r: any) => ({
            id: r.id,
            name: r.name,
            code: r.code ?? null,
            status: r.status,
            projectType: r.projectType ?? DEFAULT_STORE_PROJECT_TYPE,
            currency: r.currency ?? "USD",
            organizationId: r.organizationId,
            organizationName: r.organizationName ?? null,
            productionKind: (r.productionKind ?? "film") as ProductionKind,
            budgetStatus: (r.budgetStatus ?? "Draft") as ProjectSummary["budgetStatus"],
            fxRate: Number(r.fxRate ?? 3.75),
          }));
        } catch (err) {
          console.error("[store] listProjectsForActiveOrg failed", err);
          const stored = get().activeProjectId ?? readActiveProjectId();
          const cached = cachedBudgetFor(stored, get().budgetCache);
          set((s) => ({
            activeProjectId: stored,
            projects: s.projects,
            budget: s.budget.length > 0 ? s.budget : cached,
          }));
          return;
        }

        const stored = get().activeProjectId ?? readActiveProjectId();
        const foundStored = stored ? projects.find((p) => p.id === stored) : null;
        // Project Gateway: never auto-select a project the user did not
        // explicitly choose. The first-project fallback only applies when a
        // previously stored selection was revoked (membership removed, etc.).
        const active = foundStored ?? (stored ? (projects[0] ?? null) : null);
        const newActiveId = active?.id ?? null;
        if (newActiveId !== stored) writeActiveProjectId(newActiveId);

        // Safe fallback toast: if the persisted project is no longer accessible
        // (revoked membership, deletion, or tenant switch), notify the user that
        // we've auto-selected the first allowed project instead.
        if (stored && !foundStored && typeof window !== "undefined") {
          void import("sonner")
            .then(({ toast }) => {
              if (active) {
                toast.warning(i18n.t("store.previous_project_no_longer_accessible"), {
                  description: `Switched to "${active.name}".`,
                });
              } else {
                toast.error(i18n.t("store.no_accessible_projects"), {
                  description:
                    "Your saved project is no longer available and you have no other projects assigned.",
                });
              }
            })
            .catch(() => {});
        }

        const patch: Partial<State> = {
          projects,
          activeProjectId: newActiveId,
          ...projectMetaPatch(active),
        };
        if (active && Number.isFinite(active.fxRate) && active.fxRate > 0)
          currentSarPerUsd = active.fxRate;
        set(patch);
      },

      setActiveProject: async (id) => {
        const proj = get().projects.find((p) => p.id === id) ?? null;
        // Switch guard: the project list is produced server-side from the
        // caller's assignments, so an id that is not in it is unauthorized.
        // Never activate it — keep the current selection untouched.
        if (id && !proj) {
          console.warn("[store] rejected switch to unauthorized project", id);
          return;
        }
        const previousProjectId = get().activeProjectId;
        writeActiveProjectId(proj?.id ?? null);

        if (proj && Number.isFinite(proj.fxRate) && proj.fxRate > 0) currentSarPerUsd = proj.fxRate;
        const patch: Partial<State> = {
          activeProjectId: proj?.id ?? null,
          ...projectMetaPatch(proj),
        };
        set({
          ...patch,
          ...scopedEmptyPatch(),
        });
        await invalidateActiveProjectQueryCaches(proj?.id ?? null, previousProjectId);
        // Clearing the selection (gateway lock-in) must not trigger an
        // unscoped reload — scoped data is only fetched for a real project.
        if (proj) await get().reloadScopedData();
      },

      setProjectName: (name) => {
        set((s) => ({
          projectName: name,
          projects: s.projects.map((p) => (p.id === s.activeProjectId ? { ...p, name } : p)),
        }));
      },
      setProjectType: (projectType) => {
        set((s) => ({
          projectType,
          projects: s.projects.map((p) => (p.id === s.activeProjectId ? { ...p, projectType } : p)),
        }));
      },
      setProjectCurrency: (currency) => {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === s.activeProjectId ? { ...p, currency } : p)),
        }));
      },
      setProjectStatus: (status: ProjectStatus) => {
        set((s) => ({
          projectStatus: status,
          projects: s.projects.map((p) => (p.id === s.activeProjectId ? { ...p, status } : p)),
        }));
      },

      setProductionKind: async (id, kind) => {
        const { error } = await supabase
          .from("projects")
          .update({ production_kind: kind } as any)
          .eq("id", id);
        if (error) throw error;
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, productionKind: kind } : p)),
        }));
      },

      setProjectFxRate: async (id, rate) => {
        const clean = Number.isFinite(rate) && rate > 0 ? Number(rate) : 3.75;
        const { error } = await supabase
          .from("projects")
          .update({ fx_rate: clean } as any)
          .eq("id", id);
        if (error) throw error;
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, fxRate: clean } : p)),
        }));
        if (get().activeProjectId === id) currentSarPerUsd = clean;
      },

      addBudgetLine: async (l) => {
        const pid = get().activeProjectId;
        const org = activeOrgId();
        if (!pid || !org) throw new Error("Select an active project before saving budget lines.");
        set((s) => budgetPatchFromCache(s, pid, [...s.budget, l]));
        markBudgetLineLocallyAuthoritative(l.id);
        const { data, error } = await supabase
          .from("budget_lines")
          .insert(toBudgetRow(l))
          .select("*")
          .single();
        if (error) {
          budgetLocalAuthority.delete(l.id);
          set((s) =>
            budgetPatchFromCache(
              s,
              pid,
              s.budget.filter((x) => x.id !== l.id),
            ),
          );
          throw error;
        }
        invalidateBudgetCaches(pid, "lines");
        if (data) {
          const saved = fromBudgetRow(data);
          markBudgetLineLocallyAuthoritative(saved.id);
          set((s) =>
            budgetPatchFromCache(
              s,
              pid,
              s.budget.map((b) => (b.id === l.id ? saved : b)),
            ),
          );
          return saved;
        }
        return l;
      },
      addBudgetLines: async (lines) => {
        const pid = get().activeProjectId;
        const org = activeOrgId();
        if (!pid || !org)
          throw new Error("Select an active project before importing budget lines.");
        if (!lines.length) return;
        set((s) => budgetPatchFromCache(s, pid, [...s.budget, ...lines]));
        for (const l of lines) markBudgetLineLocallyAuthoritative(l.id);
        const rows = lines.map(toBudgetRow);
        const { error } = await supabase.from("budget_lines").insert(rows);
        if (error) {
          for (const l of lines) budgetLocalAuthority.delete(l.id);
          const ids = new Set(lines.map((l) => l.id));
          set((s) =>
            budgetPatchFromCache(
              s,
              pid,
              s.budget.filter((x) => !ids.has(x.id)),
            ),
          );
          throw error;
        }
        invalidateBudgetCaches(pid, "lines");
      },
      updateBudgetLine: async (id, patch, opts) => {
        const pid = get().activeProjectId;
        const prev = get().budget.find((b) => b.id === id) ?? null;
        set((s) =>
          budgetPatchFromCache(
            s,
            pid,
            s.budget.map((b) => (b.id === id ? { ...b, ...patch } : b)),
          ),
        );
        markBudgetLineLocallyAuthoritative(id);
        const updated = get().budget.find((b) => b.id === id);
        if (updated) {
          // `.select("*").single()` returns the row EXACTLY as it landed in the
          // database after RLS/triggers ran. We reconcile local state with that
          // authoritative row so the UI can never diverge from what persisted.
          const { data, error } = await supabase
            .from("budget_lines")
            .update(withChangeReason(stripNullVersion(toBudgetRow(updated)), opts?.changeReason))
            .eq("id", id)
            .select("*")
            .single();
          if (error) {
            budgetLocalAuthority.delete(id);
            if (prev)
              set((s) =>
                budgetPatchFromCache(
                  s,
                  pid,
                  s.budget.map((b) => (b.id === id ? prev : b)),
                ),
              );
            throw error;
          }
          invalidateBudgetCaches(pid, "lines");
          if (data) {
            const saved = fromBudgetRow(data);
            markBudgetLineLocallyAuthoritative(saved.id);
            set((s) =>
              budgetPatchFromCache(
                s,
                pid,
                s.budget.map((b) => (b.id === id ? saved : b)),
              ),
            );
            return saved;
          }
          return updated;
        }
        return undefined;
      },
      removeBudgetLine: async (id) => {
        const pid = get().activeProjectId;
        const prev = get().budget.find((b) => b.id === id) ?? null;
        set((s) =>
          budgetPatchFromCache(
            s,
            pid,
            s.budget.filter((b) => b.id !== id),
          ),
        );
        markBudgetLineLocallyAuthoritative(id);
        const { error } = await supabase.from("budget_lines").delete().eq("id", id);
        if (error) {
          budgetLocalAuthority.delete(id);
          if (prev) set((s) => budgetPatchFromCache(s, pid, [...s.budget, prev]));
          throw error;
        }
        invalidateBudgetCaches(pid, "lines");
      },

      clearProjectBudget: async () => {
        throw new Error(
          "Bulk budget wipes are disabled for production safety. Delete individual lines or import using Append mode.",
        );
      },
      addVendor: async (v) => {
        const pid = get().activeProjectId;
        const org = activeOrgId();
        if (!pid || !org) throw new Error("Select an active project before creating a vendor.");
        // Dedup: case-insensitive name check against existing vendors
        const dup = get().vendors.find(
          (x) => x.name.trim().toLowerCase() === v.name.trim().toLowerCase(),
        );
        if (dup) throw new Error(`A vendor named "${v.name}" already exists.`);
        set((s) => ({ vendors: [...s.vendors, v] }));
        const { error } = await supabase.from("vendors").insert(toVendorRow(v));
        if (error) {
          set((s) => ({ vendors: s.vendors.filter((x) => x.id !== v.id) }));
          if ((error as any).code === "23505")
            throw new Error(`A vendor named "${v.name}" already exists.`);
          throw error;
        }
      },
      updateVendor: async (id, patch) => {
        set((s) => ({ vendors: s.vendors.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
        const updated = get().vendors.find((v) => v.id === id);
        if (updated) await supabase.from("vendors").update(toVendorRow(updated)).eq("id", id);
      },
      removeVendor: async (id) => {
        set((s) => ({ vendors: s.vendors.filter((v) => v.id !== id) }));
        await supabase.from("vendors").delete().eq("id", id);
      },
      addInvoice: async (i) => {
        const payload = toInvoiceRow(i);
        console.log("SUBMIT PAYLOAD:", payload);
        if (!payload.project_id)
          throw new Error("An active project is required before saving an invoice.");
        set((s) => ({
          invoices: [
            ...s.invoices,
            {
              ...i,
              approvalStatus: "pending" as const,
              projectId: payload.project_id,
              organizationId: payload.organization_id,
            },
          ],
        }));
        const { error: insertErr } = await supabase.from("invoices").insert(payload as any);
        if (insertErr) {
          // Roll back optimistic update so the UI reflects DB reality.
          set((s) => ({ invoices: s.invoices.filter((x) => x.id !== i.id) }));
          throw insertErr;
        }
        recordAudit({
          category: "other",
          action: "invoice.create",
          summary: `Invoice ${i.invoiceNo || i.id.slice(0, 6)} created (${i.vendorName})`,
          entity: `invoice:${i.id}`,
          details: { old_value: null, new_value: i },
        });
        // Book full invoice amount to budget actuals on creation (accrual).
        // Payment schedule (paymentTerm) no longer drives what is "paid" —
        // that is now recorded exclusively via approved payment requests.
        if (i.budgetCode && i.price > 0) {
          const bookedAmount = +Number(i.price).toFixed(2);
          try {
            await get().commitTransaction({
              budgetCode: i.budgetCode,
              description: i.description || `Invoice ${i.invoiceNo}`,
              amount: bookedAmount,
              vatAmount: +(Number(i.vatAmount) || 0).toFixed(2),
              transactionType: "invoice",
              referenceNo: i.invoiceNo,
              department: i.department,
              metadata: { vendor: i.vendorName, invoice_id: i.id, total_price: i.price },
            });
          } catch (e) {
            console.error("commitTransaction (invoice) failed", e);
          }
        }
      },
      updateInvoice: async (id, patch) => {
        const prev = get().invoices.find((x) => x.id === id);
        if (!prev) return;
        const next: Invoice = { ...prev, ...patch };
        set((s) => ({ invoices: s.invoices.map((x) => (x.id === id ? next : x)) }));
        const row = toInvoiceRow(next);
        const { error } = await supabase
          .from("invoices")
          .update(row as any)
          .eq("id", id);
        if (error) {
          set((s) => ({ invoices: s.invoices.map((x) => (x.id === id ? prev : x)) }));
          throw error;
        }
        recordAudit({
          category: "other",
          action: "invoice.update",
          summary: `Invoice ${next.invoiceNo || id.slice(0, 6)} updated`,
          entity: `invoice:${id}`,
          details: { old_value: prev, new_value: next },
        });
      },
      removeInvoice: async (id) => {
        const prev = get().invoices.find((x) => x.id === id) ?? null;
        // X08 (db/pending/201): an approved / cancelled invoice is cancelled, never deleted
        if (prev && (prev.approvalStatus === "approved" || prev.approvalStatus === "cancelled")) {
          throw new Error(i18n.t("decisions.invoice.deleteApproved"));
        }
        // Cascade: clear managed attachments (storage + metadata) first, while
        // the link to the parent still exists. Abort if the lookup itself fails.
        const projectId = get().activeProjectId;
        if (projectId) {
          const ok = await deleteFilesForEntity(projectId, "invoice", id);
          if (!ok) throw new Error("Could not verify attachments. Deletion aborted for safety.");
        }
        const { error: delErr } = await supabase.from("invoices").delete().eq("id", id);
        if (delErr) throw delErr;
        set((s) => ({ invoices: s.invoices.filter((x) => x.id !== id) }));
        // Best-effort: reverse any linked transactions
        try {
          await supabase.from("transactions").delete().eq("reference_no", id);
        } catch {}
        recordAudit({
          category: "other",
          action: "invoice.delete",
          summary: `Invoice ${prev?.invoiceNo ?? id} deleted`,
          entity: `invoice:${id}`,
          details: { old_value: prev, new_value: null },
        });
      },
      addPurchaseOrder: async (p) => {
        set((s) => ({ purchaseOrders: [...s.purchaseOrders, p] }));
        const { error } = await (supabase.from as any)("purchase_orders").insert(
          toPurchaseOrderRow(p),
        );
        if (error) {
          set((s) => ({ purchaseOrders: s.purchaseOrders.filter((x) => x.id !== p.id) }));
          throw error;
        }
        recordAudit({
          category: "other",
          action: "purchase_order.create",
          summary: `PO ${p.poNumber || p.id.slice(0, 6)} created (${p.vendorName})`,
          entity: `purchase_order:${p.id}`,
          details: { old_value: null, new_value: p },
        });
      },
      updatePurchaseOrder: async (id, patch) => {
        const prev = get().purchaseOrders.find((p) => p.id === id) ?? null;
        set((s) => ({
          purchaseOrders: s.purchaseOrders.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }));
        const updated = get().purchaseOrders.find((p) => p.id === id);
        if (updated)
          await (supabase.from as any)("purchase_orders")
            .update(toPurchaseOrderRow(updated))
            .eq("id", id);
        recordAudit({
          category: "other",
          action: "purchase_order.update",
          summary: `PO ${prev?.poNumber ?? id} updated`,
          entity: `purchase_order:${id}`,
          details: { old_value: prev, new_value: updated ?? null, patch },
        });
      },
      removePurchaseOrder: async (id) => {
        const prev = get().purchaseOrders.find((p) => p.id === id) ?? null;
        set((s) => ({ purchaseOrders: s.purchaseOrders.filter((p) => p.id !== id) }));
        await (supabase.from as any)("purchase_orders").delete().eq("id", id);
        recordAudit({
          category: "other",
          action: "purchase_order.delete",
          summary: `PO ${prev?.poNumber ?? id} deleted`,
          entity: `purchase_order:${id}`,
          details: { old_value: prev, new_value: null },
        });
      },
      addCashAdvance: async (c) => {
        set((s) => ({ cashAdvances: [...s.cashAdvances, c] }));
        await supabase.from("cash_advances").insert(toAdvanceRow(c));
        recordAudit({
          category: "other",
          action: "petty_cash.advance.create",
          summary: `Petty cash advance ${c.totalAdvance} created for ${c.holder}`,
          entity: `cash_advance:${c.id}`,
          details: { old_value: null, new_value: c },
        });
      },
      addPerson: async (p) => {
        const payload = toPersonRow(p);
        console.log("SUBMIT PAYLOAD:", payload);
        if (!payload.project_id)
          throw new Error("An active project is required before saving this contract.");
        set((s) => ({
          people: [
            ...s.people,
            { ...p, projectId: payload.project_id, organizationId: payload.organization_id },
          ],
        }));
        const { error } = await supabase.from("people").insert(payload as any);
        if (error) {
          set((s) => ({ people: s.people.filter((x) => x.id !== p.id) }));
          throw error;
        }
        await refreshPersonContracts(p.id);
      },
      updatePerson: async (id, patch) => {
        const before = get().people.find((p) => p.id === id);
        set((s) => ({ people: s.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
        const updated = get().people.find((p) => p.id === id);
        if (updated) {
          const { error } = await supabase
            .from("people")
            .update(toPersonRow(updated) as any)
            .eq("id", id);
          if (error) {
            // The database refused (e.g. a contract approved by its own creator): undo.
            if (before) set((s) => ({ people: s.people.map((p) => (p.id === id ? before : p)) }));
            throw error;
          }
          await refreshPersonContracts(id);
        }
      },
      removePerson: async (id) => {
        // Cascade: clear managed attachments (storage + metadata) for the contract.
        const projectId = get().activeProjectId;
        const kind = get().people.find((p) => p.id === id)?.kind === "cast" ? "cast" : "crew";
        if (projectId) {
          const ok = await deleteFilesForEntity(projectId, kind, id);
          if (!ok) throw new Error("Could not verify attachments. Deletion aborted for safety.");
        }
        set((s) => ({ people: s.people.filter((p) => p.id !== id) }));
        // also remove associated payroll rows
        set((s) => ({ payroll: s.payroll.filter((r) => r.refId !== id) }));
        await supabase.from("people").delete().eq("id", id);
        await supabase.from("payroll").delete().eq("ref_id", id);
      },
      addPayroll: async (p) => {
        set((s) => ({ payroll: [...s.payroll, p] }));
        await supabase.from("payroll").insert(toPayrollRow(p));
      },
      syncPayrollForContract: async (refId, patch) => {
        const row = get().payroll.find((r) => r.refId === refId);
        if (!row) {
          const created: PayrollRow = {
            id: newId(),
            refId,
            name: patch.name ?? "Contract",
            kind: patch.kind ?? "crew",
            totalAmount: patch.totalAmount ?? 0,
            payments: [],
            receipts: [],
            percents: patch.percents ?? [],
            budgetCode: patch.budgetCode ?? null,
            ledger: [],
            paymentSchedule: patch.paymentSchedule ?? [],
            whtPercent: patch.whtPercent ?? 0,
            whtAmount: patch.whtAmount ?? 0,
            netPayable: patch.netPayable ?? undefined,
            whtTreatment: patch.whtTreatment ?? "inclusive",
          };
          set((s) => ({ payroll: [...s.payroll, created] }));
          const { error } = await supabase.from("payroll").insert(toPayrollRow(created));
          if (error) {
            set((s) => ({ payroll: s.payroll.filter((r) => r.id !== created.id) }));
            throw error;
          }
          return;
        }
        const next: PayrollRow = {
          ...row,
          name: patch.name ?? row.name,
          kind: patch.kind ?? row.kind,
          totalAmount: patch.totalAmount ?? row.totalAmount,
          budgetCode: patch.budgetCode !== undefined ? patch.budgetCode : row.budgetCode,
          percents: patch.percents ?? row.percents,
          paymentSchedule: patch.paymentSchedule ?? row.paymentSchedule,
          whtPercent: patch.whtPercent !== undefined ? patch.whtPercent : row.whtPercent,
          whtAmount: patch.whtAmount !== undefined ? patch.whtAmount : row.whtAmount,
          netPayable:
            patch.netPayable !== undefined ? (patch.netPayable ?? undefined) : row.netPayable,
          whtTreatment: patch.whtTreatment ?? row.whtTreatment,
        };
        // If slot count changed, resize payments/receipts preserving status of overlapping slots
        if (patch.percents && patch.percents.length !== row.payments.length) {
          const n = patch.percents.length;
          next.payments = Array.from({ length: n }, (_, i) => row.payments[i] ?? "Upcoming");
          next.receipts = Array.from({ length: n }, (_, i) => row.receipts[i] ?? null);
        }
        set((s) => ({ payroll: s.payroll.map((r) => (r.id === row.id ? next : r)) }));
        await supabase.from("payroll").update(toPayrollRow(next)).eq("id", row.id);
      },
      addReceipt: async (r) => {
        // Enforce link to an Active advance and prevent overspend.
        if (!r.advanceId)
          throw new Error("A cash advance must be selected before adding a receipt.");
        const adv = get().cashAdvances.find((a) => a.id === r.advanceId);
        if (!adv) throw new Error("The selected cash advance no longer exists.");
        if (adv.status === "Reconciled")
          throw new Error("This advance is already reconciled — pick an active advance.");
        const currentExpenses = get()
          .receipts.filter((x) => x.advanceId === r.advanceId)
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        const remaining = adv.totalAdvance - currentExpenses;
        if (r.amount > remaining + 0.005) {
          throw new Error(
            `Receipt exceeds remaining balance of ${remaining.toFixed(2)} on this advance.`,
          );
        }

        set((s) => ({ receipts: [...s.receipts, r] }));
        await supabase.from("cash_advance_receipts").insert(toReceiptRow(r));

        const newExpenses = currentExpenses + r.amount;
        const nextStatus: CashAdvanceStatus =
          newExpenses >= adv.totalAdvance - 0.005 ? "Reconciled" : "Active";
        set((s) => ({
          cashAdvances: s.cashAdvances.map((a) =>
            a.id === r.advanceId ? { ...a, expenses: newExpenses, status: nextStatus } : a,
          ),
        }));
        await supabase
          .from("cash_advances")
          .update({ expenses: newExpenses, status: nextStatus })
          .eq("id", r.advanceId);
        recordAudit({
          category: "other",
          action: "petty_cash.receipt.create",
          summary: `Petty cash receipt ${r.amount} logged for ${r.recipient}${r.budgetCode ? ` (${r.budgetCode})` : ""}`,
          entity: `cash_advance_receipt:${r.id}`,
          details: { old_value: null, new_value: r, advance_status: nextStatus },
        });
      },
      reconcileCashAdvance: async (id) => {
        const prev = get().cashAdvances.find((a) => a.id === id);
        if (!prev) throw new Error("Cash advance not found.");
        if (prev.status === "Reconciled") return;
        set((s) => ({
          cashAdvances: s.cashAdvances.map((a) =>
            a.id === id ? { ...a, status: "Reconciled" } : a,
          ),
        }));
        await supabase.from("cash_advances").update({ status: "Reconciled" }).eq("id", id);
        recordAudit({
          category: "other",
          action: "petty_cash.advance.reconcile",
          summary: `Petty cash advance manually reconciled for ${prev.holder}`,
          entity: `cash_advance:${id}`,
          details: { old_value: prev, new_value: { ...prev, status: "Reconciled" } },
        });
      },
      updateReceipt: async (id, patch) => {
        const prev = get().receipts.find((r) => r.id === id);
        if (!prev) throw new Error("Receipt not found.");
        const next: CashAdvanceReceipt = { ...prev, ...patch };
        if (!next.advanceId) throw new Error("A cash advance must remain linked.");
        const adv = get().cashAdvances.find((a) => a.id === next.advanceId);
        if (!adv) throw new Error("Linked cash advance no longer exists.");
        // Compute new expense total excluding this receipt's old amount, then + new amount
        const otherExpenses = get()
          .receipts.filter((x) => x.advanceId === next.advanceId && x.id !== id)
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        const newExpenses = otherExpenses + Number(next.amount || 0);
        if (newExpenses > adv.totalAdvance + 0.005) {
          throw new Error(
            `Total receipts would exceed advance total (${adv.totalAdvance.toFixed(2)}).`,
          );
        }
        set((s) => ({ receipts: s.receipts.map((r) => (r.id === id ? next : r)) }));
        await supabase.from("cash_advance_receipts").update(toReceiptRow(next)).eq("id", id);
        const nextStatus: CashAdvanceStatus =
          newExpenses >= adv.totalAdvance - 0.005 ? "Reconciled" : "Active";
        set((s) => ({
          cashAdvances: s.cashAdvances.map((a) =>
            a.id === next.advanceId ? { ...a, expenses: newExpenses, status: nextStatus } : a,
          ),
        }));
        await supabase
          .from("cash_advances")
          .update({ expenses: newExpenses, status: nextStatus })
          .eq("id", next.advanceId);
        recordAudit({
          category: "other",
          action: "petty_cash.receipt.update",
          summary: `Petty cash receipt updated (${next.recipient})`,
          entity: `cash_advance_receipt:${id}`,
          details: { old_value: prev, new_value: next },
        });
      },
      removeReceipt: async (id) => {
        const prev = get().receipts.find((r) => r.id === id);
        if (!prev) return;
        // db/pending/201: an approved receipt is cancelled, never deleted
        if (prev.status === "approved" || (prev.status as string) === "cancelled") {
          throw new Error(i18n.t("decisions.receipt.deleteApproved"));
        }
        const { error: delErr } = await supabase
          .from("cash_advance_receipts")
          .delete()
          .eq("id", id);
        if (delErr) throw delErr;
        set((s) => ({ receipts: s.receipts.filter((r) => r.id !== id) }));
        if (prev.advanceId) {
          const adv = get().cashAdvances.find((a) => a.id === prev.advanceId);
          if (adv) {
            const newExpenses = get()
              .receipts.filter((x) => x.advanceId === prev.advanceId)
              .reduce((s, x) => s + Number(x.amount || 0), 0);
            // On delete, revert to Active if now below total
            const nextStatus: CashAdvanceStatus =
              newExpenses >= adv.totalAdvance - 0.005 ? "Reconciled" : "Active";
            set((s) => ({
              cashAdvances: s.cashAdvances.map((a) =>
                a.id === prev.advanceId ? { ...a, expenses: newExpenses, status: nextStatus } : a,
              ),
            }));
            await supabase
              .from("cash_advances")
              .update({ expenses: newExpenses, status: nextStatus })
              .eq("id", prev.advanceId);
          }
        }
        recordAudit({
          category: "other",
          action: "petty_cash.receipt.delete",
          summary: `Petty cash receipt deleted (${prev.recipient})`,
          entity: `cash_advance_receipt:${id}`,
          details: { old_value: prev, new_value: null },
        });
      },
      togglePayment: async (rowId, idx) => {
        const cycle: Status[] = ["Upcoming", "Due", "Paid"];
        const row = get().payroll.find((r) => r.id === rowId);
        if (!row) return;
        const nextStatus = cycle[(cycle.indexOf(row.payments[idx]) + 1) % 3];
        await get().updatePayment(rowId, idx, { status: nextStatus });
      },
      updatePayment: async (rowId, idx, patch) => {
        const row = get().payroll.find((r) => r.id === rowId);
        if (!row) return;
        const prevStatus = row.payments[idx];
        const nextPayments: Status[] = [...row.payments];
        const nextReceipts: (string | null)[] = [...row.receipts];
        while (nextReceipts.length < nextPayments.length) nextReceipts.push(null);
        if (patch.status !== undefined) nextPayments[idx] = patch.status;
        if (patch.receipt !== undefined) nextReceipts[idx] = patch.receipt;
        const nextStatus = nextPayments[idx];

        set((s) => ({
          payroll: s.payroll.map((r) =>
            r.id === rowId ? { ...r, payments: nextPayments, receipts: nextReceipts } : r,
          ),
        }));
        await supabase
          .from("payroll")
          .update({ payments: nextPayments, receipts: nextReceipts })
          .eq("id", rowId);

        // Budget sync: when a slot becomes Paid, write a Paid transaction so master_budget.actual_amount tracks it.
        // When a slot leaves Paid, remove the matching transaction so actuals reverse.
        if (row.budgetCode && prevStatus !== nextStatus) {
          const refNo = `payroll:${rowId}:${idx}`;
          const pct = Number(
            row.percents?.[idx] ?? (row.payments.length ? 100 / row.payments.length : 0),
          );
          const slotAmount = +(row.totalAmount * (pct / 100)).toFixed(2);
          try {
            if (nextStatus === "Paid" && prevStatus !== "Paid") {
              await get().ensureBudgetCode(row.budgetCode);
              await supabase.from("transactions" as any).insert({
                transaction_type: "payroll",
                budget_code: row.budgetCode,
                description: `${row.name} — Payment ${idx + 1}`,
                amount: slotAmount,
                vat_amount: 0,
                // payroll amounts are stored in the base currency (SAR)
                currency: "SAR",
                payment_status: "Paid",
                reference_no: refNo,
                metadata: { payroll_id: rowId, slot_index: idx, kind: row.kind },
              });
            } else if (prevStatus === "Paid" && nextStatus !== "Paid") {
              await supabase
                .from("transactions" as any)
                .delete()
                .eq("reference_no", refNo);
            }
          } catch (e) {
            console.error("Payroll → budget sync failed", e);
          }
        }
      },
      updatePayrollGlAccount: async (rowId, glAccountId) => {
        set((s) => ({
          payroll: s.payroll.map((r) => (r.id === rowId ? { ...r, glAccountId } : r)),
        }));
        const { error } = await supabase
          .from("payroll" as any)
          .update({ gl_account_id: glAccountId })
          .eq("id", rowId);
        if (error) throw error;
      },

      refreshPayrollRow: async (payrollRowId) => {
        const { data, error } = await supabase
          .from("payroll")
          .select("*")
          .eq("id", payrollRowId)
          .maybeSingle();
        if (error || !data) return;
        const fresh = fromPayrollRow(data);
        set((s) => ({ payroll: s.payroll.map((r) => (r.id === payrollRowId ? fresh : r)) }));
      },

      setMilestoneStatus: async (payrollRowId, milestoneId, status, execution) => {
        const row = get().payroll.find((r) => r.id === payrollRowId);
        if (!row) return;
        const nextSchedule = (row.paymentSchedule ?? []).map((m) =>
          m.id === milestoneId
            ? {
                ...m,
                status,
                // Execution evidence is written only when the checker pays, and
                // cleared when the milestone is reopened / put back on hold.
                proofPath: status === "Paid" ? (execution?.proofPath ?? m.proofPath ?? null) : null,
                paidDate: status === "Paid" ? (execution?.paidDate ?? m.paidDate ?? null) : null,
                paidRef: status === "Paid" ? (execution?.paidRef ?? m.paidRef ?? null) : null,
                paymentMethod:
                  status === "Paid" ? (execution?.paymentMethod ?? m.paymentMethod ?? null) : null,
                sourceAccount:
                  status === "Paid" ? (execution?.sourceAccount ?? m.sourceAccount ?? null) : null,
                receiptUrl:
                  status === "Paid" ? (execution?.receiptUrl ?? m.receiptUrl ?? null) : null,
                paidNotes: status === "Paid" ? (execution?.paidNotes ?? m.paidNotes ?? null) : null,
              }
            : m,
        );
        const next: PayrollRow = { ...row, paymentSchedule: nextSchedule };
        set((s) => ({ payroll: s.payroll.map((r) => (r.id === row.id ? next : r)) }));
        const { error } = await supabase
          .from("payroll")
          .update({ payment_schedule: normalizePaymentSchedule(nextSchedule) as unknown as any })
          .eq("id", row.id);
        if (error) {
          // Roll back the optimistic update so the UI never lies about payables.
          set((s) => ({ payroll: s.payroll.map((r) => (r.id === row.id ? row : r)) }));
          throw error;
        }
      },
      setPayrollLedger: async (refId, ledger) => {
        const row = get().payroll.find((r) => r.refId === refId);
        if (!row) return;
        const total = Number(row.totalAmount || 0);
        const entries = ledger.map((e) => ({
          ...e,
          amount: Number(e.amount || 0),
          status: (e.status ?? "Pending Approval") as PaymentApprovalStatus,
        }));
        // "payments" array historically drove UI status per slot — mirror the workflow.
        const statusToLegacy = (s: PaymentApprovalStatus): Status =>
          s === "Paid" ? "Paid" : s === "Rejected" ? "Upcoming" : "Due";
        const payments: Status[] = entries.map((e) => statusToLegacy(e.status!));
        const receipts: (string | null)[] = entries.map((e) => e.proofPath ?? null);
        const percents: number[] = entries.map((e) =>
          total > 0 ? +((e.amount / total) * 100).toFixed(4) : 0,
        );
        const next: PayrollRow = { ...row, ledger: entries, payments, receipts, percents };

        set((s) => ({ payroll: s.payroll.map((r) => (r.id === row.id ? next : r)) }));
        const { error } = await supabase
          .from("payroll" as any)
          .update({
            payments,
            receipts,
            percents,
            ledger: entries as unknown as any,
          })
          .eq("id", row.id);
        if (error) throw error;

        // Rebuild "Paid" transactions so Actual Paid / GL Report stay in sync (no double entry).
        // Only entries with status === "Paid" post to the Top Sheet actuals column.
        if (row.budgetCode) {
          try {
            await get().ensureBudgetCode(row.budgetCode);
            await supabase
              .from("transactions" as any)
              .delete()
              .like("reference_no", `payroll:${row.id}:%`);
            const paidEntries = entries
              .map((e, idx) => ({ e, idx }))
              .filter(({ e }) => e.status === "Paid");
            if (paidEntries.length > 0) {
              const rows = paidEntries.map(({ e, idx }) => ({
                transaction_type: "payroll",
                budget_code: row.budgetCode,
                description: `${row.name} — Payment ${idx + 1}${e.bankRef ? ` (Ref ${e.bankRef})` : ""}`,
                amount: Number(e.amount || 0),
                vat_amount: 0,
                // payroll amounts are stored in the base currency (SAR)
                currency: "SAR",
                payment_status: "Paid",
                reference_no: `payroll:${row.id}:${idx}`,
                metadata: {
                  payroll_id: row.id,
                  slot_index: idx,
                  kind: row.kind,
                  payment_date: e.date || null,
                  bank_ref: e.bankRef || null,
                  proof_path: e.proofPath || null,
                  approval_status: e.status,
                  approved_by: e.approvedBy || null,
                  paid_by: e.paidBy || null,
                },
              }));
              await supabase.from("transactions" as any).insert(rows);
            }
          } catch (e) {
            console.error("Payroll ledger → budget sync failed", e);
          }
        }
      },

      ensureBudgetCode: async (budgetCode) => {
        const line = get().budget.find((b) => b.mainCode === budgetCode);
        if (!line) return;
        const planned = lineTotal(line);
        await supabase.from("master_budget" as any).upsert(
          {
            budget_code: line.mainCode,
            description: line.description,
            category: line.headerCode,
            group: line.group,
            macro_category: line.group,
            planned_amount: planned,
            currency: line.currency ?? "USD",
          },
          { onConflict: "budget_code" } as any,
        );
        invalidateBudgetCaches(get().activeProjectId, "master");
      },

      commitTransaction: async (input) => {
        const line = get().budget.find((b) => b.mainCode === input.budgetCode);
        if (line) {
          const planned = lineTotal(line);
          await supabase.from("master_budget" as any).upsert(
            {
              budget_code: line.mainCode,
              description: line.description,
              category: line.headerCode,
              group: line.group,
              macro_category: line.group,
              planned_amount: planned,
              currency: input.currency ?? "USD",
            },
            { onConflict: "budget_code" } as any,
          );
          invalidateBudgetCaches(get().activeProjectId, "master");
        }
        await supabase.from("transactions" as any).insert({
          transaction_type: input.transactionType ?? "payroll",
          budget_code: input.budgetCode,
          description: input.description,
          amount: input.amount,
          vat_amount: input.vatAmount ?? 0,
          currency: input.currency ?? "USD",
          is_film_commission_eligible: input.isFilmCommissionEligible ?? false,
          payment_status: input.paymentStatus ?? "Committed",
          reference_no: input.referenceNo ?? null,
          department: input.department ?? null,
          metadata: { status_label: input.paymentStatus ?? "Committed", ...(input.metadata ?? {}) },
        });
      },

      recordPayment: async (input) => {
        const id = input.id ?? newId();
        const pid = get().activeProjectId;
        const project = get().projects.find((p) => p.id === pid);
        const orgId = project?.organizationId ?? null;
        const { data: userRes } = await supabase.auth.getUser();
        const row = {
          id,
          organization_id: orgId,
          project_id: pid,
          source_type: input.sourceType,
          source_id: input.sourceId,
          amount: input.amount,
          payment_date: input.paymentDate || new Date().toISOString().slice(0, 10),
          method: input.method,
          proof_path: input.proofPath ?? null,
          notes: input.notes ?? null,
          recorded_by: userRes.user?.id ?? null,
        };
        const { error } = await (supabase.from as any)("payments").insert(row);
        if (error) throw error;
        const saved: Payment = {
          id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          amount: Number(input.amount),
          paymentDate: row.payment_date,
          method: input.method,
          proofPath: row.proof_path,
          notes: row.notes,
        };
        set((s) => ({ payments: [...s.payments, saved] }));
        recordAudit({
          category: "other",
          action: "payment.record",
          summary: `Payment ${saved.amount} recorded against ${saved.sourceType} ${saved.sourceId}`,
          entity: `${saved.sourceType}:${saved.sourceId}`,
          organization_id: orgId ?? null,
          project_id: pid ?? null,
          details: { old_value: null, new_value: saved },
        });
        return saved;
      },

      removePayment: async (id) => {
        const prev = get().payments.find((p) => p.id === id) ?? null;
        set((s) => ({ payments: s.payments.filter((p) => p.id !== id) }));
        const { error } = await (supabase.from as any)("payments").delete().eq("id", id);
        if (error) throw error;
        recordAudit({
          category: "other",
          action: "payment.delete",
          summary: `Payment ${id} removed`,
          entity: prev ? `${prev.sourceType}:${prev.sourceId}` : `payment:${id}`,
          details: { old_value: prev, new_value: null },
        });
      },
    }),
    {
      name: STORE_PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        activeProjectId: s.activeProjectId,
        projects: s.projects,
        budgetCache: s.budgetCache,
      }),
    },
  ),
);

// ---------------------------------------------------------------------
// Global budget-version context switch.
//
// Selecting a version anywhere in the app (the Budget grid, the Top Sheet
// Cost Report, …) re-scopes EVERY consumer of `store.budget`, because the
// scoped reload filters `budget_lines` by that single `version_id` at the
// database level. Registered once, at module scope, so no component owns a
// re-subscribing effect.
// ---------------------------------------------------------------------
if (typeof window !== "undefined") {
  let switching = false;
  // A switch that arrives while another is loading is NOT dropped (it used to
  // be, which left the grid showing the previous version — often an empty
  // draft — until some later reload). The latest request is replayed.
  let rerun = false;
  const runSwitch = (pid: string) => {
    switching = true;
    __pendingVersionSwitch = true;
    useStore.setState((s) => ({
      budget: [],
      budgetLoading: true,
      budgetCache: { ...s.budgetCache, [pid]: [] },
    }));
    invalidateBudgetCaches(pid, "lines");
    void useStore
      .getState()
      .reloadScopedData()
      .finally(() => {
        switching = false;
        if (rerun) {
          rerun = false;
          const current = useStore.getState().activeProjectId;
          if (current) runSwitch(current);
        }
      });
  };
  window.addEventListener(BUDGET_VERSION_CHANGE_EVENT, (e: Event) => {
    const pid = (e as CustomEvent<{ projectId?: string }>).detail?.projectId;
    if (!pid || pid !== useStore.getState().activeProjectId) return;
    if (switching) {
      rerun = true;
      return;
    }
    runSwitch(pid);
  });
}

// Export id generator so pages create DB-compatible UUIDs
export const generateId = newId;

// Derived helpers
/**
 * Live USD → SAR rate. Defaults to 3.75; mutated by `syncSarPerUsdFromActive`
 * whenever the active project changes or its fx_rate is edited via
 * `setProjectFxRate`. Exported as a getter (`SAR_PER_USD`) so components read
 * the current value at render time.
 */
export let currentSarPerUsd = 3.75;
export const getSarPerUsd = () => currentSarPerUsd;
/**
 * Backwards-compatible export. Callers should prefer `getSarPerUsd()` or the
 * `useActiveFxRate()` hook; kept as a live-binding constant re-exported below.
 */
export { currentSarPerUsd as SAR_PER_USD };

/**
 * Reactive hook — returns the active project's USD→SAR rate and re-renders
 * consumers whenever it changes. Also keeps the module-level
 * `currentSarPerUsd` in sync so pure helpers (`lineTotalSAR/USD`) reflect
 * the latest rate.
 */
export function useActiveFxRate(): number {
  const rate = useStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId);
    const r = p?.fxRate;
    return Number.isFinite(r) && (r as number) > 0 ? (r as number) : 3.75;
  });
  if (rate !== currentSarPerUsd) currentSarPerUsd = rate;
  return rate;
}

export const totalPeriods = (l: Pick<BudgetLine, "prep" | "shooting" | "wrap" | "x">) => {
  const sum = Number(l.prep ?? 0) + Number(l.shooting ?? 0) + Number(l.wrap ?? 0);
  if (sum > 0) return sum;
  const x = Number(l.x ?? 0);
  return x > 0 ? x : 1;
};
/**
 * Native total in the line's own currency. Excluded lines contribute 0.
 * - Package / Epi units: qty × rate (no period multiplier).
 * - All other units (Flat, Day, Week, Month, Split): qty × rate × periods (unchanged).
 */
export const lineTotalNative = (l: BudgetLine) => {
  if (l.excluded) return 0;
  const base = Number(l.amount || 0) * Number(l.rate || 0);
  return UNITS_NO_PERIODS.includes(l.unit) ? base : base * totalPeriods(l);
};
export const lineTotalSAR = (l: BudgetLine) => {
  const t = lineTotalNative(l);
  return (l.currency ?? "USD") === "SAR" ? t : t * currentSarPerUsd;
};
export const lineTotalUSD = (l: BudgetLine) => {
  const t = lineTotalNative(l);
  return (l.currency ?? "USD") === "USD" ? t : t / currentSarPerUsd;
};
/**
 * Backwards-compatible total — returns the project's BASE currency (SAR),
 * which is what every display formatter converts from.
 */
export const lineTotal = (l: BudgetLine) => lineTotalSAR(l);
/** Compact display total in the active display currency. */
/**
 * Money for tiles and panels. G16: financial figures are never abbreviated
 * ("1.8K" for 1,750) — this renders the full grouped value with the active
 * currency code, e.g. "1,750 SAR" / "-12,417,300 SAR" (X17: one format).
 * Chart axes keep their own compact tick formatter.
 */
export const formatMoney = (n: number) => formatDisplayMoney(n);
/** Full display amount with the active currency code (e.g. "17,100,000 SAR"). */
export const formatUSD = (n: number) => formatDisplayMoney(n);
/** Plain-number formatter in the active display currency — no code appended. */
export const formatSAR = (n: number) => formatDisplayAmount(n);

export const paidPayrollAmount = (r: PayrollRow) => {
  // Prefer explicit ledger entries when present (Crew/Cast payment ledger).
  if (r.ledger && r.ledger.length > 0) {
    return r.ledger.reduce((a, e) => a + Number(e.amount || 0), 0);
  }
  const fallbackPct = r.payments.length ? 100 / r.payments.length : 0;
  return r.payments.reduce((acc, status, i) => {
    if (status !== "Paid") return acc;
    const pct = Number(r.percents?.[i] ?? fallbackPct);
    return acc + r.totalAmount * (pct / 100);
  }, 0);
};

export const hasMissingProof = (r: PayrollRow) =>
  !!r.ledger && r.ledger.length > 0 && r.ledger.some((e) => !e.proofPath);

export const sumPaymentsFor = (payments: Payment[], sourceType: PaymentSource, sourceId: string) =>
  payments.reduce(
    (a, p) =>
      p.sourceType === sourceType && p.sourceId === sourceId ? a + Number(p.amount || 0) : a,
    0,
  );

/**
 * Project totals for the AP screens — the glossary definitions via
 * computeBudgetPosition (src/lib/budget-position.ts). `committed` is the
 * Commitment (not actual + commitment); `remaining` = Budget − Actual − Commitment.
 * Car rentals / accommodation are not in the store: pass them through
 * `logistics` (see useLogisticsCommitments in src/lib/logistics-commitments.ts).
 */
export const useTotals = (logistics?: LogisticsCommitment[]) => {
  const { budget, payroll, invoices, purchaseOrders, payments, cashAdvances, receipts } =
    useStore();
  const totalBudget = budget.reduce((a, l) => a + lineTotal(l), 0);
  const pos = computeBudgetPosition({
    totalBudget,
    payroll,
    invoices,
    purchaseOrders,
    payments,
    receipts,
    logistics,
    // same rule as public.payroll_legacy_paid (db/pending/180)
    legacyPaidFor: (r) => legacyContractPaid(r, payments),
  });
  const invoicesOpen = invoices.reduce((a, i) => {
    const due = (Number(i.price) || 0) + (Number(i.vatAmount) || 0) - (Number(i.whtAmount) || 0);
    return a + Math.max(0, due - sumPaymentsFor(payments, "invoice", i.id));
  }, 0);
  return {
    totalBudget,
    actualSpend: pos.actual,
    paid: pos.paid,
    payable: pos.payable,
    variance: totalBudget - pos.actual,
    committed: pos.commitment,
    remaining: pos.remaining,
    poOpen: pos.parts.poCommitment,
    contractsCommitment: pos.parts.contractsCommitment,
    logisticsCommitment: pos.parts.logisticsCommitment,
    invoicesOpen,
    position: pos,
    cashAdvances,
  };
};

/**
 * E01: after a contract is saved the database links it to a person profile
 * and syncs the identity onto that person's other contracts — re-read them so
 * the screen shows what was stored. Silent no-op before db/pending/190.
 */
async function refreshPersonContracts(contractId: string): Promise<void> {
  try {
    const pid = useStore.getState().activeProjectId;
    if (!pid) return;
    const { data: own } = await supabase
      .from("people")
      .select("*")
      .eq("id", contractId)
      .maybeSingle();
    const personId = (own as any)?.person_id as string | null | undefined;
    let rows: any[] = own ? [own] : [];
    if (personId) {
      const { data } = await supabase
        .from("people")
        .select("*")
        .eq("project_id", pid)
        .eq("person_id" as any, personId);
      rows = (data as any[]) ?? rows;
    }
    if (!rows.length) return;
    const byId = new Map(rows.map((r) => [String(r.id), fromPersonRow(r)]));
    useStore.setState((s) => ({
      people: s.people.map((p) => {
        const fresh = byId.get(p.id);
        return fresh ? { ...p, ...fresh } : p;
      }),
    }));
  } catch {
    /* the optimistic copy stays */
  }
}
