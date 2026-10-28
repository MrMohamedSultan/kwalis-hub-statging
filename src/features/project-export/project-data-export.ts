// =====================================================================
// D23 — "Export all project data": every table of the active project in ONE
// branded workbook (one sheet per table, a contents sheet first), packed in
// a zip together with the list of attachment links (storage paths of
// contracts, IDs, invoices, receipts and the file library).
//
// - Reads go through the signed-in user's session, so RLS decides what is
//   exported; every query is filtered by project_id as well.
// - Bank and ID details (IBAN, bank, SWIFT, ID number, their attachments)
//   are left out unless the admin explicitly includes them.
// - Shown to super admins and the project's organisation admins only.
// =====================================================================
import { supabase } from "@/integrations/supabase/client";
import type { ReportDoc, ReportSection } from "@/lib/export/xlsx-report";

/** Tables exported, in workbook order (all carry project_id). */
export const PROJECT_TABLES = [
  "budget_lines",
  "people",
  "payroll",
  "payroll_instalments",
  "overtime_entries",
  "invoices",
  "purchase_orders",
  "payments",
  "cash_advances",
  "cash_advance_receipts",
  "per_diem_ledger",
  "project_funding",
  "treasury_movements",
  "car_rentals",
  "accommodations",
  "project_files",
] as const;

/** Bank / identity columns, exported only when explicitly included. */
const SENSITIVE =
  /^(iban|payee_iban|bank|bank_name|bank_country|bank_nationality|swift_code|swift|account_number|id_number|iban_attachment_path|id_attachment_path)$/i;
/** Columns that point at a stored file. */
const ATTACHMENT = /(_path|_url|attachment|storage_key)$/i;

export type ExportRow = Record<string, unknown>;

/** Pure: drop the bank / ID columns unless included (unit-tested). */
export function sanitizeRows(rows: ExportRow[], includeSensitive: boolean): ExportRow[] {
  if (includeSensitive) return rows;
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SENSITIVE.test(k))));
}

export type AttachmentLink = { table: string; rowId: string; column: string; path: string };

/** Pure: every non-empty file reference in the exported rows (unit-tested). */
export function attachmentLinks(table: string, rows: ExportRow[]): AttachmentLink[] {
  const out: AttachmentLink[] = [];
  for (const r of rows)
    for (const [k, v] of Object.entries(r)) {
      if (!ATTACHMENT.test(k) || v == null) continue;
      const path = String(v).trim();
      if (path) out.push({ table, rowId: String(r.id ?? ""), column: k, path });
    }
  return out;
}

const cell = (v: unknown): string | number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/** Pure: one sheet per table, columns = the union of the row keys (unit-tested). */
export function tableSection(table: string, rows: ExportRow[]): ReportSection {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
  if (!keys.length) keys.push("id");
  return {
    title: table,
    columns: keys.map((header) => ({ header })),
    rows: rows.map((r) => keys.map((k) => cell(r[k]))),
  };
}

export function projectDataDoc(
  tables: { table: string; rows: ExportRow[]; error?: string | null }[],
  labels: { title: string; contents: string; table: string; rows: string; note: string },
): ReportDoc {
  return {
    report: "Project Data",
    title: labels.title,
    layout: "sheets",
    sections: [
      {
        title: labels.contents,
        notes: [labels.note],
        columns: [
          { header: labels.table },
          { header: labels.rows, type: "integer" },
          { header: "" },
        ],
        rows: tables.map((t) => [t.table, t.rows.length, t.error ?? ""]),
      },
      ...tables.map((t) => tableSection(t.table, t.rows)),
    ],
  };
}

const PAGE = 1000;
/** Stable paging order (a unique key) per table; "id" when not listed. */
const ORDER: Record<string, string[]> = { payroll_instalments: ["payroll_id", "milestone_id"] };

/** All rows of one project table, page by page (the API caps a read at 1,000 rows). */
export async function fetchProjectTable(
  table: string,
  projectId: string,
): Promise<{ rows: ExportRow[]; error: string | null }> {
  const out: ExportRow[] = [];
  for (let from = 0; from < 500_000; from += PAGE) {
    let q = (supabase.from as unknown as (t: string) => any)(table)
      .select("*")
      .eq("project_id", projectId);
    for (const col of ORDER[table] ?? ["id"]) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { rows: out, error: String(error.message ?? error) };
    out.push(...((data ?? []) as ExportRow[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows: out, error: null };
}

/** General ledger lines (both phases) through the ledger RPC. */
export async function fetchLedgerLines(
  projectId: string,
): Promise<{ rows: ExportRow[]; error: string | null }> {
  const { data, error } = await (
    supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<any>
  )("get_general_ledger", { p_project_id: projectId });
  return error
    ? { rows: [], error: String(error.message ?? error) }
    : { rows: (data ?? []) as ExportRow[], error: null };
}

export function attachmentsCsv(links: AttachmentLink[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    "table,row_id,column,path",
    ...links.map((l) => [l.table, l.rowId, l.column, l.path].map(esc).join(",")),
  ].join("\n");
}

/** Builds the workbook + attachment list and downloads them as one zip. */
export async function exportAllProjectData(opts: {
  projectId: string;
  includeSensitive: boolean;
  labels: Parameters<typeof projectDataDoc>[1];
  onProgress?: (done: number, total: number) => void;
}): Promise<{ filename: string; tables: number; rows: number; attachments: number }> {
  const total = PROJECT_TABLES.length + 1;
  const tables: { table: string; rows: ExportRow[]; error?: string | null }[] = [];
  const links: AttachmentLink[] = [];
  let done = 0;
  for (const table of PROJECT_TABLES) {
    const r = await fetchProjectTable(table, opts.projectId);
    const rows = sanitizeRows(r.rows, opts.includeSensitive);
    links.push(...attachmentLinks(table, rows));
    tables.push({ table, rows, error: r.error });
    opts.onProgress?.(++done, total);
  }
  const gl = await fetchLedgerLines(opts.projectId);
  tables.push({ table: "general_ledger", rows: gl.rows, error: gl.error });
  opts.onProgress?.(++done, total);

  const [{ loadExcelJs }, { getExportBranding }, { buildReportWorkbook }, { isRtlUi }, JSZip] =
    await Promise.all([
      import("@/lib/lazy-export-libs"),
      import("@/lib/export/branding"),
      import("@/lib/export/xlsx-report"),
      import("@/lib/export/pdf-core"),
      import("jszip").then((m) => m.default),
    ]);
  const { exportFileName } = await import("@/lib/export/file-name");
  const { downloadBlob } = await import("@/lib/download");
  const b = await getExportBranding();
  const wb = buildReportWorkbook(await loadExcelJs(), projectDataDoc(tables, opts.labels), b, {
    rtl: isRtlUi(),
  });
  const xlsx = await wb.xlsx.writeBuffer();
  const zip = new JSZip();
  zip.file(
    exportFileName({ projectCode: b.projectCode, report: "Project Data", ext: "xlsx" }),
    xlsx,
  );
  zip.file("attachment-links.csv", "﻿" + attachmentsCsv(links));
  const filename = exportFileName({
    projectCode: b.projectCode,
    report: "Project Data",
    ext: "zip",
  });
  downloadBlob(filename, await zip.generateAsync({ type: "blob" }));
  return {
    filename,
    tables: tables.length,
    rows: tables.reduce((a, t) => a + t.rows.length, 0),
    attachments: links.length,
  };
}
