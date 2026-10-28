import type { BudgetLine as StoreBudgetLine } from "@/lib/store";
import { generateId } from "@/lib/store";
import type { BudgetLine as AdapterBudgetLine } from "@/lib/excelAdapter";
import { categoryOfCode } from "@/lib/cost-report";

/** Adapter group (ATL/BTL/POST/OTHER) → store group. */
export function toStoreGroup(g: AdapterBudgetLine["group"]): StoreBudgetLine["group"] {
  if (g === "ATL") return "ATL";
  if (g === "BTL") return "BTL";
  if (g === "POST") return "Post";
  return "Other";
}

/** Store group → adapter sheet group. */
export function toAdapterGroup(g: StoreBudgetLine["group"]): AdapterBudgetLine["group"] {
  if (g === "ATL") return "ATL";
  if (g === "BTL") return "BTL";
  if (g === "Post" || g === "Music" || g === "VFX") return "POST";
  return "OTHER";
}

/**
 * Store group of an imported line: from its budget code when the code is in
 * the client chart of accounts (6000 → Music, 6100 → VFX, R09), else from the
 * sheet group the adapter read (POST → Post).
 */
export function storeGroupOfLine(
  l: Pick<AdapterBudgetLine, "group" | "main_code" | "header_code">,
): StoreBudgetLine["group"] {
  const code = String(l.main_code ?? "").trim() || String(l.header_code ?? "").trim();
  return categoryOfCode(code, l.group);
}

/** Multi-sheet Excel line → store BudgetLine ready for the DB. */
export function adapterLineToStoreLine(l: AdapterBudgetLine): StoreBudgetLine {
  const prep = Number(l.prep) || 0;
  const shooting = Number(l.shooting) || 0;
  const wrap = Number(l.wrap) || 0;
  const periods = prep + shooting + wrap || Number(l.total) || 1;
  return {
    id: generateId(),
    headerCode: String(l.header_code ?? "").trim(),
    mainCode: String(l.main_code ?? "").trim(),
    description: String(l.account_name || l.name || "").trim(),
    name: String(l.name ?? "").trim() || undefined,
    amount: Number(l.amount) || 0,
    rate: Number(l.rate) || 0,
    currency: (String(l.currency ?? "SAR").toUpperCase() === "USD"
      ? "USD"
      : "SAR") as StoreBudgetLine["currency"],
    unit: String(l.unit ?? "").trim() || "Flat",
    x: periods,
    prep,
    shooting,
    wrap,
    notes: String(l.notes ?? "").trim() || undefined,
    group: storeGroupOfLine(l),
    excluded: false,
  };
}

/** Store BudgetLine → adapter line for the multi-sheet export. */
export function storeLineToAdapterLine(
  l: StoreBudgetLine,
  headerName: (code: string) => string = () => "",
): AdapterBudgetLine {
  const prep = Number(l.prep) || 0;
  const shooting = Number(l.shooting) || 0;
  const wrap = Number(l.wrap) || 0;
  return {
    id: l.id,
    group: toAdapterGroup(l.group),
    header_code: l.headerCode || "UNASSIGNED",
    header_name: headerName(l.headerCode) || l.headerCode || "UNASSIGNED",
    main_code: l.mainCode,
    account_name: l.description || "",
    name: l.name || "",
    prep,
    shooting,
    wrap,
    total: Number(l.x) || prep + shooting + wrap || 1,
    unit: l.unit || "Flat",
    amount: Number(l.amount) || 0,
    rate: Number(l.rate) || 0,
    currency: l.currency || "SAR",
    notes: l.notes || "",
    excluded: Boolean(l.excluded),
  };
}
