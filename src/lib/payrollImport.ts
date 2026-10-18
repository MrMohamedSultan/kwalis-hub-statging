// Payroll template parser — mirrors the uploaded Kwalis Vendor Payroll CSV.
// Smart category detection: reads row markers ("VENDOR" / "CREW" / "CAST"),
// column presence (Company Name vs Position), and filename hints to route each
// row into kind = 'vendor' | 'crew' | 'cast'.

import { loadXlsx } from "@/lib/lazy-export-libs";

export type PayrollKind = "vendor" | "crew" | "cast";

export type ParsedPayrollRow = {
  kind: PayrollKind;
  in_process: boolean;
  company_name: string | null;
  invoice_link: string | null;
  beneficiary_name: string;
  iban: string | null;
  bank_name: string | null;
  bank_nationality: string | null;
  department: string | null;
  position_role: string | null;
  deal_notes: string | null;
  excludes_vat: number;
  currency: string;
  scheduled_payments: number[]; // length 7
  paid_payments: number[]; // length 7
  reserved_budget_sar: number;
};

export type PayrollPreview = {
  rows: ParsedPayrollRow[];
  counts: Record<PayrollKind, number>;
  mismatches: { row: number; reason: string }[];
  detectedKindFromFile: PayrollKind | null;
};

const norm = (s: any) => String(s ?? "").trim();
const toNum = (v: any): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const HEADER_TOKENS = ["beneficiary name", "iban", "bank name", "company name"];

function looksLikeHeader(row: any[]): boolean {
  const joined = row.map((c) => norm(c).toLowerCase()).join("|");
  return HEADER_TOKENS.filter((t) => joined.includes(t)).length >= 2;
}

function fixedSlots(arr: any[], start: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(toNum(arr[start + i]));
  return out;
}

function detectKindFromFilename(name: string): PayrollKind | null {
  const n = name.toLowerCase();
  if (n.includes("vendor")) return "vendor";
  if (n.includes("crew")) return "crew";
  if (n.includes("cast")) return "cast";
  return null;
}

export async function parsePayrollTemplate(file: File): Promise<PayrollPreview> {
  const buf = await file.arrayBuffer();
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Workbook has no sheets.");
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });

  // Locate the header row
  const headerIdx = rows.findIndex(looksLikeHeader);
  if (headerIdx < 0) {
    throw new Error(
      "Could not find the canonical Payroll header row " +
        "(expected columns: Company Name, Beneficiary name, IBAN, Bank Name, …).",
    );
  }
  const header = rows[headerIdx].map((c) => norm(c).toLowerCase());

  const colOf = (...needles: string[]) => {
    for (let i = 0; i < header.length; i++) {
      const v = header[i];
      if (needles.some((n) => v === n || v.includes(n))) return i;
    }
    return -1;
  };

  const cIn = colOf("in process");
  const cCompany = colOf("company name");
  const cInvoice = colOf("inv link", "invoice");
  const cBenef = colOf("beneficiary name", "beneficiary");
  const cIban = colOf("iban");
  const cBank = colOf("bank name");
  const cBankNat = colOf("bank nat", "bank nationality");
  const cDept = colOf("department");
  const cVat = colOf("excludes vat");
  const cDeal = colOf("deal");
  const cCcy = colOf("ccy", "currency");
  const cPosition = colOf("position", "role");

  // Payment slot columns: 7 scheduled + 7 paid (label "PAYMENT")
  const paymentCols: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (header[i] === "payment") paymentCols.push(i);
  }
  // CSV may also have numeric sub-headers row right after. The first 7 PAYMENT
  // cols are scheduled, next 7 are paid.
  const schedStart = paymentCols[0] ?? -1;
  const paidStart = paymentCols[7] ?? -1;

  const cReserved = colOf("reserved budget");

  const fileKind = detectKindFromFilename(file.name);
  const mismatches: PayrollPreview["mismatches"] = [];
  const out: ParsedPayrollRow[] = [];

  // The CSV uses a 2-row pattern: row N = data, row N+1 = totals/sub.
  // We walk all rows after the header and pick those with a beneficiary name
  // OR a kind marker in column 0.
  let currentMarker: PayrollKind | null = fileKind;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => c === "" || c == null)) continue;

    // Sub-header row "1,2,3,4,5,6,7" right under header — skip
    if (
      i === headerIdx + 1 &&
      r.slice(schedStart, schedStart + 7).every((v: any) => /^\d+$/.test(norm(v)))
    ) {
      continue;
    }

    // Detect a kind marker in column 0 ("VENDOR", "CREW", "CAST")
    const marker = norm(r[0]).toUpperCase();
    if (marker === "VENDOR") {
      currentMarker = "vendor";
      continue;
    }
    if (marker === "CREW") {
      currentMarker = "crew";
      continue;
    }
    if (marker === "CAST") {
      currentMarker = "cast";
      continue;
    }

    const beneficiary = cBenef >= 0 ? norm(r[cBenef]) : "";
    const company = cCompany >= 0 ? norm(r[cCompany]) : "";
    const iban = cIban >= 0 ? norm(r[cIban]) : "";

    // Skip totals/empty rows: nothing identifying the beneficiary
    if (!beneficiary && !company && !iban) continue;

    // Decide kind: marker > column hints > filename > default vendor
    let kind: PayrollKind = currentMarker ?? fileKind ?? "vendor";
    if (!currentMarker && !fileKind) {
      if (company) kind = "vendor";
      else if (cPosition >= 0 && norm(r[cPosition])) kind = "crew";
      else kind = "vendor";
      mismatches.push({
        row: i + 1,
        reason: `Kind not declared — auto-classified as ${kind}`,
      });
    }

    const scheduled = schedStart >= 0 ? fixedSlots(r, schedStart, 7) : [0, 0, 0, 0, 0, 0, 0];
    const paid = paidStart >= 0 ? fixedSlots(r, paidStart, 7) : [0, 0, 0, 0, 0, 0, 0];

    out.push({
      kind,
      in_process: cIn >= 0 ? !!norm(r[cIn]) : false,
      company_name: company || null,
      invoice_link: cInvoice >= 0 ? norm(r[cInvoice]) || null : null,
      beneficiary_name: beneficiary || company || "(unnamed)",
      iban: iban || null,
      bank_name: cBank >= 0 ? norm(r[cBank]) || null : null,
      bank_nationality: cBankNat >= 0 ? norm(r[cBankNat]) || null : null,
      department: cDept >= 0 ? norm(r[cDept]) || null : null,
      position_role: cPosition >= 0 ? norm(r[cPosition]) || null : null,
      deal_notes: cDeal >= 0 ? norm(r[cDeal]) || null : null,
      excludes_vat: cVat >= 0 ? toNum(r[cVat]) : 0,
      currency: (cCcy >= 0 ? norm(r[cCcy]) : "SAR") || "SAR",
      scheduled_payments: scheduled,
      paid_payments: paid,
      reserved_budget_sar: cReserved >= 0 ? toNum(r[cReserved]) : 0,
    });
  }

  const counts: Record<PayrollKind, number> = { vendor: 0, crew: 0, cast: 0 };
  out.forEach((r) => {
    counts[r.kind] += 1;
  });

  return { rows: out, counts, mismatches, detectedKindFromFile: fileKind };
}

export async function downloadPayrollTemplate(
  filename = "kwalis-payroll-template.xlsx",
): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const header = [
    "IN PROCESS",
    "Company Name",
    "INV Link",
    "Beneficiary name",
    "IBAN",
    "Bank Name",
    "Bank Nat",
    "Department",
    "Position/Role",
    "Excludes VAT",
    "DEAL",
    "CCY",
    ...Array.from({ length: 7 }, () => "PAYMENT"), // scheduled
    ...Array.from({ length: 7 }, () => "PAYMENT"), // paid
    "SAR- Reserved Budget",
  ];
  const sub = [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "",
  ];
  const ws = XLSX.utils.aoa_to_sheet([
    ["Kwalis Payroll Template — mark sections with VENDOR / CREW / CAST in column A"],
    [],
    header,
    sub,
    ["VENDOR"],
    [
      "",
      "Lights & Co",
      "INV-001",
      "Lights & Co",
      "SA0000000000000001",
      "Saudi Bank",
      "Saudi",
      "Lighting",
      "",
      5000,
      "Monthly",
      "SAR",
      1000,
      1000,
      1000,
      1000,
      1000,
      0,
      0,
      1000,
      0,
      0,
      0,
      0,
      0,
      0,
      5000,
    ],
    ["CREW"],
    [
      "",
      "",
      "",
      "Jane Doe",
      "SA0000000000000002",
      "Saudi Bank",
      "Saudi",
      "Camera",
      "Gaffer",
      0,
      "Daily",
      "SAR",
      500,
      500,
      500,
      500,
      500,
      500,
      0,
      500,
      500,
      0,
      0,
      0,
      0,
      0,
      3000,
    ],
    ["CAST"],
    [
      "",
      "",
      "",
      "John Roe",
      "SA0000000000000003",
      "Saudi Bank",
      "Saudi",
      "Cast",
      "Lead",
      0,
      "Per shoot",
      "SAR",
      2500,
      2500,
      0,
      0,
      0,
      0,
      0,
      2500,
      0,
      0,
      0,
      0,
      0,
      0,
      5000,
    ],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Payroll");
  XLSX.writeFile(wb, filename);
}
