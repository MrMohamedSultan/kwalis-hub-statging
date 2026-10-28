// ═══════════════════════════════════════════════════════════════════
// Film Commission Rebate — payload of public.get_film_commission_rebate
// (db/pending/197). Every number comes from public.rebate_transactions(),
// the single eligibility source. Amounts in SAR, excl. VAT unless named
// *_total / vat_amount / paid.
// ═══════════════════════════════════════════════════════════════════

export type EligibilityStatus = "eligible" | "not_eligible" | "needs_review";
export type RebateSource = "invoice" | "petty_cash" | "payroll" | "overtime" | "per_diem";
export type CostGroup = "ATL" | "BTL" | "POST" | "MUSIC" | "VFX" | "OTHER";

export const QPE_CATEGORIES = [
  "atl_wages",
  "cast_fees",
  "btl_wages",
  "equipment_rental",
  "set_construction",
  "wardrobe_makeup",
  "locations",
  "accommodation",
  "transport",
  "catering",
  "flights_national",
  "production_office",
  "production_services",
  "post_production",
  "music_sound",
  "vfx",
  "insurance_saudi",
  "professional_services",
  "other_qualifying",
] as const;
export type QpeCategory = (typeof QPE_CATEGORIES)[number];

/** Non-eligibility reasons (Film Commission rules sheet) — same list as the DB CHECK. */
export const INELIGIBLE_REASONS = [
  "development",
  "damage",
  "travel_outside_ksa",
  "government_fees",
  "taxes",
  "finance_interest",
  "deferred_payments",
  "capital_assets",
  "marketing_distribution",
  "software",
  "fx_differences",
  "overheads",
  "flight_change_penalties",
  "foreign_wages",
  "other",
] as const;
export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];

export interface RebateSettings {
  configured: boolean;
  rebate_rate_pct?: number | null;
  rebate_cap_sar?: number | null;
  fc_agreement_no?: string | null;
  fc_agreement_date?: string | null;
  fc_agreement_months?: number | null;
  production_period_from?: string | null;
  production_period_to?: string | null;
  cash_limit_pct_of_qpe?: number | null;
  cash_limit_per_txn_sar?: number | null;
  vat_rate_pct: number;
  work_days_per_week: number;
  weekly_off_days: number[];
  approved_at?: string | null;
  approved_by_name?: string | null;
  fx_rate?: number | null;
  can_admin: boolean;
  can_approve_mapping: boolean;
}

export interface RebateSummary {
  rebate_rate_pct?: number | null;
  rebate_cap_sar?: number | null;
  budget_total: number;
  qpe_budget: number;
  qpe_contracted: number;
  qpe_actual: number;
  qpe_paid: number;
  qpe_claimable: number;
  paid_undocumented: number;
  needs_review_total: number;
  not_eligible_total: number;
  expected_rebate?: number | null;
  expected_rebate_contracts?: number | null;
  claimable_rebate?: number | null;
  cap_reached: boolean;
  cash_total: number;
  cash_pct_of_qpe?: number | null;
  cash_limit_pct_of_qpe?: number | null;
  cash_limit_breached: boolean;
  cash_over_txn_limit: number;
  transactions: number;
  eligible_count: number;
  needs_review_count: number;
  not_eligible_count: number;
  codes_total: number;
  codes_approved: number;
  shoot_days: number;
  settings_missing: string[];
  settings_approved: boolean;
}

export interface GeneralExpenseRow {
  source: "invoice" | "petty_cash";
  source_id: string;
  ref_no?: string | null;
  qpe_category?: QpeCategory | null;
  description?: string | null;
  budget_code?: string | null;
  supplier?: string | null;
  supplier_nationality?: string | null;
  vendor_cr?: string | null;
  po_ref?: string | null;
  po_total?: number | null;
  related_party?: boolean | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  currency?: string | null;
  amount_excl_vat: number;
  vat_amount: number;
  amount_total: number;
  delivery_date?: string | null;
  paid: number;
  payment_methods?: string | null;
  payments_count: number;
  bank_refs?: string | null;
  payment_date?: string | null;
  documented: boolean;
  status: EligibilityStatus;
  reason: string;
  claimable_excl: number;
  flags: string[];
}

export interface PayrollRow57 {
  source_id: string;
  person_id?: string | null;
  crew_no?: string | null;
  name: string;
  kind?: string | null;
  position?: string | null;
  nationality?: string | null;
  mother_saudi?: boolean | null;
  id_number?: string | null;
  related_party?: boolean | null;
  budget_code?: string | null;
  cost_group?: CostGroup | null;
  qpe_category?: QpeCategory | null;
  from?: string | null;
  to?: string | null;
  working_days?: number | null;
  calendar_days?: number | null;
  basic: number;
  housing: number;
  transport: number;
  telephone: number;
  other_allowances: number;
  overtime: number;
  per_diem: number;
  total_salary: number;
  actual: number;
  paid: number;
  payment_methods?: string | null;
  iban?: string | null;
  payments_count: number;
  bank_refs?: string | null;
  payment_date?: string | null;
  documented: boolean;
  status: EligibilityStatus;
  reason: string;
  claimable_excl: number;
  flags: string[];
}

export interface BudgetGroupRow {
  group: CostGroup;
  budget_total: number;
  budget_qpe: number;
  actual_total: number;
  actual_qpe: number;
  variance_qpe: number;
}
export interface BudgetRegionRow {
  region: string;
  actual_qpe?: number | null;
  actual_total?: number | null;
}
export interface BudgetCodeRow {
  code: string;
  description?: string | null;
  group: CostGroup;
  budget: number;
  eligible: boolean;
  actual_qpe: number;
  actual_total: number;
}

export interface Headcount {
  total: number;
  crew: number;
  cast: number;
  saudi: number;
  saudi_crew: number;
  saudi_cast: number;
  saudi_trainees: number;
  nationality_missing: number;
}

export interface EligibilityLogRow {
  source: RebateSource;
  source_id: string;
  ref_no?: string | null;
  doc_no?: string | null;
  date?: string | null;
  party?: string | null;
  nationality?: string | null;
  mother_saudi?: boolean | null;
  budget_code?: string | null;
  cost_group?: CostGroup | null;
  qpe_category?: QpeCategory | null;
  mapping_status: "approved" | "suggested";
  status: EligibilityStatus;
  rule: string;
  reason: string;
  override_reason?: string | null;
  override_by_name?: string | null;
  override_at?: string | null;
  amount_excl_vat: number;
  actual_excl: number;
  paid: number;
  claimable_excl: number;
  in_period: "inside" | "partial" | "outside" | "unknown";
  flags: string[];
}

export interface RelatedPartyRow {
  name: string;
  party_type: "individual" | "company";
  nationality?: string | null;
  relation?: string | null;
  transaction_types?: string | null;
  total_value: number;
  transactions: number;
}

export interface DocumentRow {
  source: RebateSource;
  source_id: string;
  ref_no?: string | null;
  doc_no?: string | null;
  party?: string | null;
  status: EligibilityStatus;
  source_document: boolean;
  payment_proof: boolean;
  id_document?: boolean | null;
  vendor_cr?: string | null;
  bank_refs?: string | null;
  documented: boolean;
  flags: string[];
}

export interface MappingRow {
  code: string;
  description?: string | null;
  group: CostGroup;
  budget: number;
  transactions: number;
  status: "approved" | "suggested";
  stored: boolean;
  qpe_category?: QpeCategory | null;
  ineligible_reason?: IneligibleReason | null;
  basis?: string | null;
  note?: string | null;
  approved_at?: string | null;
  approved_by_name?: string | null;
}

export interface ChangeLogRow {
  changed_at: string;
  area:
    | "settings"
    | "schedule"
    | "eligibility_mapping"
    | "eligibility_override"
    | "crew_cast"
    | "budget"
    | "fx_rate";
  operation: string;
  subject?: string | null;
  changes?: Record<string, { from?: unknown; to?: unknown }> | null;
  user_name?: string | null;
  reason?: string | null;
}

export interface ShootDayRow {
  shoot_date: string;
  day_no: number;
  status: string;
  location?: string | null;
  region?: string | null;
  unit?: string | null;
}

export interface FilmCommissionRebate {
  project_id: string;
  currency: "SAR";
  settings?: RebateSettings;
  summary?: RebateSummary;
  general_expenses?: GeneralExpenseRow[];
  payroll?: PayrollRow57[];
  budget?: { by_group: BudgetGroupRow[]; by_region: BudgetRegionRow[]; by_code: BudgetCodeRow[] };
  headcount?: Headcount;
  eligibility_log?: EligibilityLogRow[];
  related_parties?: RelatedPartyRow[];
  documents?: DocumentRow[];
  mapping?: MappingRow[];
  change_log?: ChangeLogRow[];
  shoot_days?: ShootDayRow[];
}

export const REBATE_SECTIONS = [
  "summary",
  "general_expenses",
  "payroll",
  "budget",
  "headcount",
  "eligibility_log",
  "related_parties",
  "documents",
  "change_log",
] as const;
export type RebateSection = (typeof REBATE_SECTIONS)[number];
