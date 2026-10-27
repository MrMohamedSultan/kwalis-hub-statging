import { loadXlsx } from "@/lib/lazy-export-libs";
import { generateId } from "./store";
import type { BudgetLine, Vendor, Person } from "./store";

export type ImportResult = {
  budget: BudgetLine[];
  vendors: Vendor[];
  people: Person[];
  anonymized: number;
  sheetsScanned: string[];
};

const norm = (s: any) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s\-/]+/g, "");

// Build a column-index lookup from a header row
const indexOf = (headers: any[], ...names: string[]) => {
  const wanted = names.map(norm);
  for (let i = 0; i < headers.length; i++) {
    if (wanted.includes(norm(headers[i]))) return i;
  }
  return -1;
};

const toNum = (v: any): number => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const inferGroup = (header: string): "ATL" | "BTL" | "Post" | "Music" | "VFX" | "Other" => {
  const code = String(header).trim();
  const n = parseInt(code, 10);
  if (!Number.isFinite(n)) return "BTL";
  if (n < 2000) return "ATL";
  if (n === 5500) return "Other";
  if (n >= 4500 && n < 5000) return "Other";
  if (n >= 6000 && n < 6100) return "Music";
  if (n >= 6100 && n < 6200) return "VFX";
  if (n >= 5000 && n < 6000) return "Post";
  if (n >= 7000) return "Other";
  return "BTL";
};

// A pseudo "real-name" detector — mixed-case words, 2+ tokens, not all-uppercase role titles.
const looksLikePersonalName = (s: string) => {
  const v = s.trim();
  if (!v) return false;
  if (v === v.toUpperCase()) return false; // role titles like "LEAD ACTOR" stay
  const tokens = v.split(/\s+/);
  if (tokens.length < 2) return false;
  return tokens.every((t) => /^[A-Z][a-zA-Z'’\-]+$/.test(t));
};

// Vendor-name heuristic: if it contains the same casing pattern of a company brand,
// we still anonymize on import to honor the strict rule.
const ANON = {
  crew: (n: number) => `Crew Member ${n}`,
  cast: (n: number) => `Cast Member ${n}`,
  vendor: (n: number) =>
    `Vendor ${String.fromCharCode(64 + ((n - 1) % 26) + 1)}${n > 26 ? Math.ceil(n / 26) : ""}`.trim(),
};

export async function parseKwalisWorkbook(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buf, { type: "array" });

  const result: ImportResult = {
    budget: [],
    vendors: [],
    people: [],
    anonymized: 0,
    sheetsScanned: [],
  };
  let crewCounter = 0,
    castCounter = 0,
    vendorCounter = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });
    if (rows.length < 2) continue;
    result.sheetsScanned.push(sheetName);

    // Find header row (first row with at least 2 non-empty cells)
    const headerRowIdx = rows.findIndex((r) => r.filter((c) => c !== "" && c != null).length >= 2);
    if (headerRowIdx < 0) continue;
    const headers = rows[headerRowIdx];
    const dataRows = rows.slice(headerRowIdx + 1);
    const sheetKey = norm(sheetName);

    // --- BUDGET LINES ---
    const headerIdx = indexOf(headers, "header", "header code", "headercode", "headeraccount");
    const mainIdx = indexOf(headers, "main", "main code", "maincode", "mainaccount", "code");
    const descIdx = indexOf(headers, "description", "account description", "item", "name");
    const amtIdx = indexOf(headers, "amount", "qty", "quantity");
    const rateIdx = indexOf(headers, "rate", "price", "unitrate");
    const unitIdx = indexOf(headers, "unit", "uom");
    const xIdx = indexOf(headers, "x", "multiplier", "weeks", "days");
    const groupIdx = indexOf(headers, "group", "category", "section");

    const isBudgetSheet =
      /budget|account|cost|atl|btl|post|vfx/i.test(sheetName) ||
      (mainIdx >= 0 && rateIdx >= 0 && descIdx >= 0);

    if (isBudgetSheet && mainIdx >= 0 && descIdx >= 0) {
      for (const r of dataRows) {
        const desc = String(r[descIdx] ?? "").trim();
        if (!desc) continue;
        const headerCode =
          String(r[headerIdx >= 0 ? headerIdx : -1] ?? "").trim() ||
          String(r[mainIdx] ?? "").slice(0, 2) + "00";
        const mainCode = String(r[mainIdx] ?? "").trim();
        if (!mainCode) continue;
        const rawGrp = groupIdx >= 0 && r[groupIdx] ? String(r[groupIdx]).toUpperCase() : "";
        const normGrp =
          rawGrp === "ATL"
            ? "ATL"
            : rawGrp === "BTL"
              ? "BTL"
              : rawGrp === "POST" || rawGrp === "POST PRODUCTION"
                ? "Post"
                : rawGrp === "MUSIC"
                  ? "Music"
                  : rawGrp === "VFX" || rawGrp === "VISUAL EFFECTS"
                    ? "VFX"
                    : rawGrp === "OTHER"
                      ? "Other"
                      : null;
        const safeGrp: BudgetLine["group"] = normGrp ?? inferGroup(headerCode);

        // Anonymize if description leaked a personal name
        let safeDesc = desc;
        if (looksLikePersonalName(desc)) {
          crewCounter += 1;
          safeDesc = `Crew Member ${crewCounter} Role`;
          result.anonymized += 1;
        }

        result.budget.push({
          id: generateId(),
          headerCode,
          mainCode,
          description: safeDesc,
          amount: toNum(r[amtIdx]) || 1,
          rate: toNum(r[rateIdx]),
          unit: (String(r[unitIdx] ?? "Flat").trim() || "Flat") as BudgetLine["unit"],
          x: toNum(r[xIdx]) || 1,
          group: safeGrp,
          currency: "USD",
        });
      }
      continue;
    }

    // --- VENDORS ---
    const vNameIdx = indexOf(headers, "vendor", "vendorname", "company", "companyname", "supplier");
    const vCatIdx = indexOf(headers, "category", "type");
    const vCrIdx = indexOf(headers, "crno", "cr", "commercialregistration");
    const vVatIdx = indexOf(headers, "vatno", "vat", "tax");
    const vEmailIdx = indexOf(headers, "email", "contact");
    const isVendorSheet =
      /vendor|supplier|compan/i.test(sheetName) ||
      (vNameIdx >= 0 && (vCrIdx >= 0 || vVatIdx >= 0 || vEmailIdx >= 0));

    if (isVendorSheet && vNameIdx >= 0) {
      for (const r of dataRows) {
        const original = String(r[vNameIdx] ?? "").trim();
        if (!original) continue;
        vendorCounter += 1;
        result.anonymized += 1;
        result.vendors.push({
          id: generateId(),
          name: ANON.vendor(vendorCounter),
          category: String(r[vCatIdx] ?? "General").trim() || "General",
          crNo: String(r[vCrIdx] ?? "").trim(),
          vatNo: String(r[vVatIdx] ?? "").trim(),
          email: `contact@vendor-${vendorCounter}.example`,
        });
      }
      continue;
    }

    // --- CREW / CAST ---
    const pNameIdx = indexOf(headers, "fullname", "name", "crewname", "castname");
    const pPosIdx = indexOf(headers, "position", "role", "title");
    const pNatIdx = indexOf(headers, "nationality");
    const pIdIdx = indexOf(headers, "id", "idnumber", "passport");
    const pIbanIdx = indexOf(headers, "iban");
    const pBankIdx = indexOf(headers, "bank");
    const pStartIdx = indexOf(headers, "startdate", "start");
    const pEndIdx = indexOf(headers, "enddate", "end");
    const pDaysIdx = indexOf(headers, "days", "shootingdays");
    const pDailyIdx = indexOf(headers, "daily", "dailyrate", "rate");
    const pPdIdx = indexOf(headers, "perdiem", "pd");
    const isCastSheet = /cast|actor|actress/i.test(sheetKey);
    const isPeopleSheet = isCastSheet || /crew|talent|personnel/i.test(sheetKey) || pNameIdx >= 0;

    if (isPeopleSheet && pNameIdx >= 0) {
      for (const r of dataRows) {
        const original = String(r[pNameIdx] ?? "").trim();
        if (!original) continue;
        const kind: Person["kind"] = isCastSheet ? "cast" : "crew";
        if (kind === "cast") castCounter += 1;
        else crewCounter += 1;
        const n = kind === "cast" ? castCounter : crewCounter;
        result.anonymized += 1;
        result.people.push({
          id: generateId(),
          kind,
          fullName: kind === "cast" ? ANON.cast(n) : ANON.crew(n),
          position: String(r[pPosIdx] ?? "").trim() || (kind === "cast" ? "Role" : "Crew"),
          nationality: "—",
          idNumber: `0000000${n}`.slice(-8),
          iban: `XX00 0000 0000 ${String(n).padStart(4, "0")}`,
          bank: `Bank ${String.fromCharCode(64 + ((n - 1) % 26) + 1)}`,
          startDate: String(r[pStartIdx] ?? "").trim() || "",
          endDate: String(r[pEndIdx] ?? "").trim() || "",
          shootingDays: toNum(r[pDaysIdx]),
          dailyRate: toNum(r[pDailyIdx]),
          perDiem: toNum(r[pPdIdx]),
          onSetPerDiem: toNum(r[pPdIdx]),
          offSetPerDiem: toNum(r[pPdIdx]) * 2,
          housingAllowance: 0,
        });
      }
    }
  }

  return result;
}
