// Crew / cast "list" CSV export (selected contracts).
//
// Contact details, ID / bank data and contract money are personal data: they
// are only exported for users who may see them, with the same rule the
// database applies to the crew / cast list (db/pending/197
// get_crew_cast_list: rebate settings admin, or edit rights on crew / cast
// contracts). Everyone else gets names, roles, dates and status only.

export type CrewCastCsvRow = {
  fullName: string;
  role: string;
  nationality?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  iban?: string | null;
  bank?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  currency?: string | null;
  days?: number | null;
  daily?: number | null;
  perDiem?: number | null;
  gross?: number | null;
  whtTreatment?: string | null;
  taxResidency?: string | null;
  status?: string | null;
};

type Col = { key: keyof CrewCastCsvRow; label: string; sensitive?: boolean };

const COLUMNS = (kind: "crew" | "cast"): Col[] => [
  { key: "fullName", label: "full_name" },
  { key: "role", label: kind === "cast" ? "character" : "position" },
  { key: "nationality", label: "nationality" },
  { key: "idType", label: "id_type", sensitive: true },
  { key: "idNumber", label: "id_number", sensitive: true },
  { key: "phoneNumber", label: "phone", sensitive: true },
  { key: "email", label: "email", sensitive: true },
  { key: "iban", label: "iban", sensitive: true },
  { key: "bank", label: "bank", sensitive: true },
  { key: "startDate", label: "start" },
  { key: "endDate", label: "end" },
  { key: "currency", label: "currency", sensitive: true },
  { key: "days", label: "days" },
  { key: "daily", label: "daily", sensitive: true },
  { key: "perDiem", label: "per_diem", sensitive: true },
  { key: "gross", label: "contract_value", sensitive: true },
  { key: "whtTreatment", label: "wht_treatment", sensitive: true },
  { key: "taxResidency", label: "tax_residency" },
  { key: "status", label: "status" },
];

export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV text for the selected contracts. `label` turns a column id into the
 * header text (i18n, `polish.crewcast_csv.<id>`).
 */
export function buildCrewCastCsv(
  rows: CrewCastCsvRow[],
  opts: { kind: "crew" | "cast"; includeSensitive: boolean; label: (id: string) => string },
): string {
  const cols = COLUMNS(opts.kind).filter((c) => opts.includeSensitive || !c.sensitive);
  const lines = [cols.map((c) => csvEscape(opts.label(c.label))).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c.key])).join(","));
  return lines.join("\n");
}

/**
 * Who may export contact / ID / bank / money data of a contract (pure; same
 * rule as get_crew_cast_list, db/pending/197): a Film Commission settings
 * admin, or a user with edit rights on that kind of contract. Vendor-kind
 * payroll rows follow the crew rule.
 */
export function canExportPersonalData(
  access: { rebateAdmin: boolean; canEditCrew: boolean; canEditCast: boolean },
  kind: string | null | undefined,
): boolean {
  if (access.rebateAdmin) return true;
  return String(kind ?? "").toLowerCase() === "cast" ? access.canEditCast : access.canEditCrew;
}
