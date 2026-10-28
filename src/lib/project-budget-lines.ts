import { supabase } from "@/integrations/supabase/client";
import { computeWht } from "@/lib/contract-terms";
import { lineShareOfContract } from "@/lib/company-wht";

export type ProjectBudgetLine = {
  id: string;
  headerCode: string;
  mainCode: string;
  description: string;
  name: string;
  group: string;
  amount: number;
  rate: number;
  currency: "USD" | "SAR";
  unit: string;
  x: number;
  prep: number;
  shooting: number;
  wrap: number;
  excluded: boolean;
};

// ---------------------------------------------------------------------
// Master COA header descriptions.
//
// Uploaded project budgets frequently omit the description on the header
// row itself, which used to make the header dropdown fall back to the broad
// category tag ("1300 ATL"). The Master Chart of Accounts always carries the
// real header description ("1300 DIRECTION"), so we load it once and use it
// as the authoritative header name source.
// ---------------------------------------------------------------------
const MASTER_HEADER_CACHE_KEY = "kwalis.masterCoaHeaders.v1";
const MASTER_HEADER_TTL_MS = 15 * 60_000;

const masterHeaderNames = new Map<string, string>();
let masterHeaderPromise: Promise<void> | null = null;

function readMasterHeaderCache(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(MASTER_HEADER_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { at: number; rows: Record<string, string> };
    if (!parsed?.at || Date.now() - parsed.at > MASTER_HEADER_TTL_MS) return false;
    for (const [code, desc] of Object.entries(parsed.rows ?? {})) masterHeaderNames.set(code, desc);
    return masterHeaderNames.size > 0;
  } catch {
    return false;
  }
}

function writeMasterHeaderCache() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      MASTER_HEADER_CACHE_KEY,
      JSON.stringify({ at: Date.now(), rows: Object.fromEntries(masterHeaderNames) }),
    );
  } catch {
    /* quota / private mode — cache is best-effort only */
  }
}

export function masterHeaderName(code: string): string {
  return masterHeaderNames.get(baseBudgetCode(code)) ?? "";
}

/**
 * Loads the Master COA header descriptions once per session. Results are held
 * in memory and mirrored to sessionStorage (15 min TTL) so reopening the
 * dropdown — or navigating between Accounting and Contracts — is instant.
 */
export function loadMasterHeaderNames(force = false): Promise<void> {
  if (force) {
    masterHeaderPromise = null;
    masterHeaderNames.clear();
    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.removeItem(MASTER_HEADER_CACHE_KEY);
      } catch {
        /* ignore */
      }
    }
  }
  if (masterHeaderPromise) return masterHeaderPromise;
  if (!force && readMasterHeaderCache()) {
    masterHeaderPromise = Promise.resolve();
    return masterHeaderPromise;
  }
  masterHeaderPromise = (async () => {
    const { data, error } = await supabase
      .from("master_budget")
      .select("budget_code, description")
      .eq("is_header", true);
    if (error) {
      masterHeaderPromise = null;
      return;
    }
    for (const r of (data ?? []) as any[]) {
      const code = baseBudgetCode(String(r.budget_code ?? ""));
      const desc = String(r.description ?? "").trim();
      if (code && desc) masterHeaderNames.set(code, desc);
    }
    writeMasterHeaderCache();
  })();
  return masterHeaderPromise;
}

export async function fetchProjectBudgetLines(projectId: string): Promise<ProjectBudgetLine[]> {
  const [{ data, error }] = await Promise.all([
    supabase
      .from("v_active_budget_lines" as any)
      .select(
        "id, header_code, main_code, description, name, group, amount, rate, currency, unit, x, prep, shooting, wrap, excluded, created_at",
      )
      .eq("project_id", projectId)
      .not("main_code", "is", null)
      .order("header_code", { ascending: true })
      .order("main_code", { ascending: true })
      .order("created_at", { ascending: true }),
    loadMasterHeaderNames(),
  ]);

  if (error) throw error;

  return (data ?? [])
    .map((r: any): ProjectBudgetLine => ({
      id: r.id,
      headerCode: String(r.header_code ?? "").trim(),
      mainCode: String(r.main_code ?? "").trim(),
      description: String(r.description ?? r.name ?? "").trim(),
      name: String(r.name ?? "").trim(),
      group: String(r.group ?? "").trim(),
      amount: Number(r.amount ?? 0),
      rate: Number(r.rate ?? 0),
      currency: r.currency === "SAR" ? "SAR" : "USD",
      unit: String(r.unit ?? ""),
      x: Number(r.x ?? 0),
      prep: Number(r.prep ?? 0),
      shooting: Number(r.shooting ?? 0),
      wrap: Number(r.wrap ?? 0),
      excluded: Boolean(r.excluded ?? false),
    }))
    .filter((line) => line.id && line.mainCode);
}

export function projectBudgetLineTotal(line: ProjectBudgetLine): number {
  const periods = Number(line.x || line.prep + line.shooting + line.wrap) || 1;
  return Number(line.amount || 0) * Number(line.rate || 0) * periods;
}

export function headerNameForBudgetLine(headerCode: string, lines: ProjectBudgetLine[]): string {
  const code = baseBudgetCode(headerCode);

  // 1. The header row itself ("1200" / "1200.0") — its own description wins.
  const headerRow = lines.find(
    (line) => baseBudgetCode(line.mainCode) === code && isHeaderBudgetCode(line.mainCode),
  );
  const own = (headerRow?.description || headerRow?.name || "").trim();
  if (own) return own;

  // 2. Master Chart of Accounts description for this header code.
  const master = masterHeaderNames.get(code);
  if (master) return master;

  // 3. Any row that declares this header and carries a header description.
  const declared = lines.find(
    (line) => baseBudgetCode(line.headerCode) === code && (line.description || line.name),
  );
  const declaredName = (declared?.description || declared?.name || "").trim();
  if (headerRow && declaredName) return declaredName;

  // 4. Last resort only: the broad category/group tag (ATL, BTL…).
  const children = lines.filter((line) => parentHeaderCodeForLine(line) === code);
  const group = children.find((line) => line.group)?.group;
  return group || "Budget";
}

export function headerLabelForBudgetLine(headerCode: string, lines: ProjectBudgetLine[]): string {
  return `${headerCode} ${headerNameForBudgetLine(headerCode, lines)}`.trim();
}

export function lineNameForBudgetLine(line: ProjectBudgetLine): string {
  return line.description || line.name || line.mainCode;
}

export function hierarchyLabelForBudgetLine(
  line: ProjectBudgetLine,
  lines: ProjectBudgetLine[],
): string {
  const lineLabel = `${line.mainCode} ${lineNameForBudgetLine(line)}`.trim();
  const header = parentHeaderCodeForLine(line);
  if (!header || header === baseBudgetCode(line.mainCode)) return lineLabel;
  return `${headerLabelForBudgetLine(header, lines)} → ${lineLabel}`;
}

// ---------------------------------------------------------------------
// Header vs. sub-account resolution.
//
// A "Header Account" is a parent category — its code ends in 00 (1400 MAIN
// CAST, 1200 PRODUCERS UNIT). Everything else (1401, 1401.1, 1402) is an
// executable line item that money can post to. Uploaded budgets sometimes
// carry a header_code that is itself a line item, so we always re-derive the
// real parent from the numeric code instead of trusting the upload.
// ---------------------------------------------------------------------

/** Strip decimal sub-coding: "1401.2" -> "1401". */
export function baseBudgetCode(code: string): string {
  const c = (code ?? "").trim();
  const dot = c.indexOf(".");
  return dot > 0 ? c.slice(0, dot) : c;
}

/** True when the code is a parent category (numeric and ending in 00). */
export function isHeaderBudgetCode(code: string): boolean {
  const c = baseBudgetCode(code);
  return /^\d{3,}$/.test(c) && c.endsWith("00");
}

/** The real parent header code for a line ("1401.2" -> "1400"). */
export function parentHeaderCodeForLine(line: ProjectBudgetLine): string {
  const own = baseBudgetCode(line.mainCode);
  if (isHeaderBudgetCode(own)) return own;
  const declared = baseBudgetCode(line.headerCode);
  if (declared && isHeaderBudgetCode(declared)) return declared;
  if (/^\d{3,}$/.test(own)) {
    const parent = Math.floor(Number(own) / 100) * 100;
    return String(parent).padStart(own.length, "0");
  }
  return declared || own;
}

/** Header dropdown source: real parent categories only, never line items. */
export function buildBudgetHeaderOptions(lines: ProjectBudgetLine[]) {
  const codes = Array.from(
    new Set(lines.map((line) => parentHeaderCodeForLine(line)).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return codes.map((code) => ({
    headerCode: code,
    label: headerNameForBudgetLine(code, lines),
    fullLabel: headerLabelForBudgetLine(code, lines),
  }));
}

/** Sub-account dropdown source: executable line items under one header. */
export function subAccountsForHeader(
  lines: ProjectBudgetLine[],
  headerCode: string,
): ProjectBudgetLine[] {
  const header = baseBudgetCode(headerCode);
  if (!header) return [];
  return lines
    .filter(
      (line) => parentHeaderCodeForLine(line) === header && !isHeaderBudgetCode(line.mainCode),
    )
    .sort((a, b) => {
      const byCode = a.mainCode.localeCompare(b.mainCode, undefined, { numeric: true });
      if (byCode !== 0) return byCode;
      return lineNameForBudgetLine(a).localeCompare(lineNameForBudgetLine(b));
    });
}

/**
 * Full human label: "1401 — Main Roles — Da'ad". Description and name are
 * both shown when they differ so duplicate codes stay distinguishable.
 */
export function fullLineLabel(line: ProjectBudgetLine): string {
  const parts = [line.mainCode];
  const desc = (line.description || "").trim();
  const name = (line.name || "").trim();
  if (desc) parts.push(desc);
  if (name && name !== desc) parts.push(name);
  if (parts.length === 1) parts.push(line.mainCode);
  return parts.join(" — ");
}

// ---------------------------------------------------------------------
// Many-to-one mapping support.
//
// Several contracts / POs can legitimately point at the SAME budget line
// (three drivers on 1201). This sums everything already committed against
// one budget_lines row so a new contract can be measured against what is
// actually left, not against the full planned amount.
// ---------------------------------------------------------------------
export type LineCommitment = {
  source: "crew" | "cast" | "po";
  id: string;
  name: string;
  amount: number;
};

export async function fetchLineCommitments(
  projectId: string,
  lineId: string,
  excludeId?: string | null,
  /**
   * Converts a contract amount in its own currency into the project base
   * currency. Without it, people amounts are taken as already in base.
   */
  toBaseAmount?: (amount: number, ccy: string) => number | null,
): Promise<LineCommitment[]> {
  if (!projectId || !lineId) return [];
  const [crew, people, pos, payrollWht] = await Promise.all([
    supabase
      .from("crew_members")
      .select("id, full_name, total_deal")
      .eq("project_id", projectId)
      .eq("linked_budget_line_id", lineId),
    supabase
      .from("people")
      .select("id, full_name, kind, daily_rate, shooting_days, ccy, wht_treatment")
      .eq("project_id", projectId)
      .eq("linked_budget_line_id", lineId),
    supabase
      .from("purchase_orders")
      .select("id, vendor_name, amount")
      .eq("project_id", projectId)
      .eq("linked_budget_line_id", lineId),
    supabase
      .from("payroll")
      .select("ref_id, wht_percent")
      .eq("project_id", projectId)
      .gt("wht_percent", 0),
  ]);
  const whtPctByRef = new Map<string, number>(
    ((payrollWht.data ?? []) as any[]).map((r) => [String(r.ref_id), Number(r.wht_percent) || 0]),
  );

  const out: LineCommitment[] = [];
  for (const r of (crew.data ?? []) as any[]) {
    if (excludeId && r.id === excludeId) continue;
    out.push({
      source: "crew",
      id: r.id,
      name: r.full_name ?? "Crew",
      amount: Number(r.total_deal ?? 0),
    });
  }
  for (const r of (people.data ?? []) as any[]) {
    if (excludeId && r.id === excludeId) continue;
    // What the contract commits on THIS line (decision 12, db/pending/201): an
    // exclusive (gross-up) deal carries its net here — its WHT goes to 7099;
    // an inclusive deal carries its gross (the WHT is deducted inside it).
    const agreed = Number(r.daily_rate ?? 0) * Number(r.shooting_days ?? 0);
    const treatment = r.wht_treatment === "exclusive" ? "exclusive" : "inclusive";
    const gross = lineShareOfContract(
      computeWht(agreed, whtPctByRef.get(String(r.id)) ?? 0, treatment),
      treatment,
    );
    const amount = toBaseAmount ? toBaseAmount(gross, String(r.ccy ?? "")) : gross;
    out.push({
      source: r.kind === "cast" ? "cast" : "crew",
      id: r.id,
      name: r.full_name ?? "Cast",
      // no configured rate for that currency: keep the native figure rather than drop it
      amount: amount ?? gross,
    });
  }
  for (const r of (pos.data ?? []) as any[]) {
    if (excludeId && r.id === excludeId) continue;
    out.push({
      source: "po",
      id: r.id,
      name: r.vendor_name ?? "Purchase order",
      amount: Number(r.amount ?? 0),
    });
  }
  return out.filter((c) => Number.isFinite(c.amount));
}

export const sumLineCommitments = (rows: LineCommitment[]) =>
  rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);

/** How many project lines carry this exact code (duplicates are legal). */
export function countLinesWithCode(lines: ProjectBudgetLine[], code: string): number {
  const c = (code ?? "").trim();
  if (!c) return 0;
  return lines.filter((l) => l.mainCode === c).length;
}

/**
 * Disambiguating label for a line whose code is shared with other rows:
 * "1201 — DRIVER (Mohammed)". Falls back to the plain label when unique.
 */
export function disambiguatedLineLabel(
  line: ProjectBudgetLine,
  lines: ProjectBudgetLine[],
): string {
  return `${line.mainCode} ${lineDisplayName(line, lines)}`.trim();
}

/**
 * Human name for one line, without the code. Duplicate codes get a
 * parenthesised qualifier: "EXECUTIVE PRODUCER (Mohammed)".
 */
export function lineDisplayName(line: ProjectBudgetLine, lines: ProjectBudgetLine[]): string {
  const base = lineNameForBudgetLine(line);
  const dupes = lines.filter((l) => l.mainCode === line.mainCode);
  if (dupes.length <= 1) return base;
  const name = (line.name || "").trim();
  const desc = (line.description || "").trim();
  const qualifier =
    name && name !== desc ? name : `#${dupes.findIndex((l) => l.id === line.id) + 1}`;
  return `${base} (${qualifier})`;
}
