// Pure export identity helpers (no app state): file names, header/footer
// text. The runtime context (company, logo, user) lives in ./branding.ts.
import i18n from "@/lib/i18n";
import { formatDateTime, riyadhToday } from "@/lib/date-format";

export const PRODUCT_NAME = "Kwalis Hub";
const FILE_PREFIX = "KwalisHub";

/** "Payments Register" → "PaymentsRegister"; keeps Latin letters and digits. */
export function reportToken(report: string): string {
  const words = String(report ?? "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  const token = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return token || "Report";
}

function codeToken(code: string | null | undefined): string {
  const c = String(code ?? "")
    .trim()
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return c || "Project";
}

/** KwalisHub_{ProjectCode}_{Report}_{YYYY-MM-DD}.{ext} */
export function exportFileName(opts: {
  projectCode: string | null | undefined;
  report: string;
  ext: string;
  date?: string;
}): string {
  const ext = opts.ext.replace(/^\./, "");
  const date = opts.date ?? riyadhToday();
  return `${FILE_PREFIX}_${codeToken(opts.projectCode)}_${reportToken(opts.report)}_${date}.${ext}`;
}

/**
 * Turn any legacy export name ("trackroll-gl-report-mon26.pdf",
 * "funding-inflows-2026-10-27") into the standard name. Already-standard
 * names are kept (extension enforced).
 */
export function normalizeExportFileName(
  raw: string,
  ext: string,
  ctx: { projectCode?: string | null; projectName?: string | null; date?: string } = {},
): string {
  const cleanExt = ext.replace(/^\./, "");
  const base = String(raw ?? "").replace(/\.[A-Za-z0-9]{2,5}$/, "");
  if (base.startsWith(`${FILE_PREFIX}_`)) return `${base}.${cleanExt}`;
  let stem = base
    .replace(/track[\s_-]?roll/gi, " ")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\b\d{8}\b/g, " ");
  const strip = (v: string | null | undefined) => {
    const s = String(v ?? "").trim();
    if (!s) return;
    const slug = s.replace(/[^A-Za-z0-9]+/g, "[^A-Za-z0-9]+");
    stem = stem.replace(new RegExp(`(^|[^A-Za-z0-9])${slug}(?=$|[^A-Za-z0-9])`, "gi"), "$1 ");
  };
  strip(ctx.projectCode);
  strip(ctx.projectName);
  stem = stem.replace(/[_-]+/g, " ");
  return exportFileName({
    projectCode: ctx.projectCode,
    report: stem,
    ext: cleanExt,
    date: ctx.date,
  });
}

/** "MON26 — Desert Film" (or whichever part exists). */
export function projectLabel(b: {
  projectCode: string | null;
  projectName: string | null;
}): string {
  return [b.projectCode, b.projectName].filter((v) => v && String(v).trim()).join(" — ");
}

export type ExportBranding = {
  companyName: string;
  /** PNG/JPEG data URL of the client company logo, when one is set. */
  logoDataUrl: string | null;
  /** PNG data URL of the Kwalis Hub mark for the footer. */
  productLogoDataUrl: string | null;
  projectCode: string | null;
  projectName: string | null;
  userName: string;
  exportedAt: Date;
};

/** Footer line without the page counter. */
export function footerLine(b: ExportBranding): string {
  return i18n.t("exports.footer_line", {
    product: PRODUCT_NAME,
    user: b.userName || "—",
    // LRM marks keep "date time" in reading order inside Arabic sentences.
    datetime: `\u200E${formatDateTime(b.exportedAt)}\u200E`,
  });
}

export function pageLabel(page: number, total: number): string {
  return i18n.t("exports.page_x_of_y", { page, total });
}
