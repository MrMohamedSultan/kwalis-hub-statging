import { projectHeaderPairs } from "@/lib/project-metadata";
import { downloadBlob } from "@/lib/download";
import { currentProjectContext, normalizeForActiveProject } from "@/lib/export/branding";
import { footerLine, projectLabel } from "@/lib/export/file-name";
import { peekAuthRoles } from "@/lib/auth-roles";

/** Minimal CSV exporter — no deps. */
export function toCSV<T extends Record<string, any>>(rows: T[], headers?: string[]): string {
  if (rows.length === 0) return (headers ?? []).join(",") + "\n";
  const cols = headers ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function downloadCSV(filename: string, rows: Record<string, any>[], headers?: string[]) {
  // UTF-8 BOM so Excel opens Arabic (and other non-ASCII) content correctly
  // regardless of the interface language (EN/LTR or AR/RTL) at export time.
  const BOM = "\ufeff";
  // Prepend the latest saved Project Settings production header so every
  // export carries current metadata without needing a refresh.
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const project = projectLabel(currentProjectContext());
  const pairs: [string, string][] = [
    ...(project ? ([["Project", project]] as [string, string][]) : []),
    ...projectHeaderPairs(),
  ];
  const headerBlock = pairs.map(([k, v]) => `${esc(k)},${esc(v)}`).join("\n");
  const prelude = headerBlock ? `${headerBlock}\n\n` : "";
  // Shared export footer (G02): Exported from Kwalis Hub · user · Saudi time.
  const roles = peekAuthRoles();
  const footer = footerLine({
    companyName: "",
    logoDataUrl: null,
    productLogoDataUrl: null,
    projectCode: null,
    projectName: null,
    userName: roles?.displayName || roles?.email || "",
    exportedAt: new Date(),
  });
  const blob = new Blob([BOM + prelude + toCSV(rows, headers) + `\n\n${esc(footer)}\n`], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(normalizeForActiveProject(filename, "csv"), blob);
}
