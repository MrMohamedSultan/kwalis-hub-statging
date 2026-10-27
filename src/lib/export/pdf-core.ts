// ═══════════════════════════════════════════════════════════════════
// Branded PDF core (G02 / D12 / X16).
//
// Every PDF the platform produces goes through `createBrandedPdf`:
//   - embeds IBM Plex Sans Arabic (regular + bold) so Arabic renders with
//     joined letters and correct direction — jsPDF's built-in Arabic
//     shaping + bidi engine run on every text() call once a Unicode font
//     is active — and Latin text / digits stay in the same family;
//   - draws the shared header (client logo · company · project · report
//     title) on every page;
//   - stamps the shared footer ("Exported from Kwalis Hub" + Kwalis logo ·
//     user · Saudi time · page X of Y) once the page count is known.
// ═══════════════════════════════════════════════════════════════════
import type { jsPDF as JsPdfDoc } from "jspdf";
import i18n from "@/lib/i18n";
import { loadPdf } from "@/lib/lazy-export-libs";
import { footerLine, pageLabel, projectLabel, type ExportBranding } from "./file-name";

export const PDF_FONT = "KwalisSans";

export type PdfFontFiles = { regular: string; bold: string };

const FONT_URLS = {
  regular: "/fonts/IBMPlexSansArabic-Regular.ttf",
  bold: "/fonts/IBMPlexSansArabic-Bold.ttf",
};

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchFonts(): Promise<PdfFontFiles | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const [r, b] = await Promise.all(
      [FONT_URLS.regular, FONT_URLS.bold].map(async (u) => {
        const res = await fetch(u);
        if (!res.ok) throw new Error(`font ${u}: ${res.status}`);
        return arrayBufferToBase64(await res.arrayBuffer());
      }),
    );
    return { regular: r, bold: b };
  } catch (err) {
    console.warn("[pdf] Arabic font unavailable — falling back to Helvetica", err);
    return null;
  }
}

let fontSource: () => Promise<PdfFontFiles | null> = fetchFonts;
let fontPromise: Promise<PdfFontFiles | null> | null = null;

/** Override where the TTF bytes come from (tests read them from disk). */
export function setPdfFontSource(src: () => Promise<PdfFontFiles | null>) {
  fontSource = src;
  fontPromise = null;
}

/** Register the Arabic-capable font on a document. Returns the family to use. */
export async function registerPdfFonts(doc: JsPdfDoc): Promise<string> {
  fontPromise ??= fontSource();
  const files = await fontPromise;
  if (!files) return "helvetica";
  doc.addFileToVFS("KwalisSans-Regular.ttf", files.regular);
  doc.addFont("KwalisSans-Regular.ttf", PDF_FONT, "normal");
  doc.addFileToVFS("KwalisSans-Bold.ttf", files.bold);
  doc.addFont("KwalisSans-Bold.ttf", PDF_FONT, "bold");
  return PDF_FONT;
}

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Paragraph direction by the first strong character (Unicode bidi rule P2). */
export function firstStrongIsRtl(text: string): boolean {
  for (const ch of text) {
    if (ARABIC.test(ch)) return true;
    if (/[A-Za-z\u00C0-\u024F]/.test(ch)) return false;
  }
  return false;
}

/**
 * jsPDF shapes Arabic itself, but its default bidi pass treats every string
 * as already-visual and mis-orders mixed text ("(%) 5" → ")%( 5"). Every
 * string that contains Arabic is passed as LOGICAL input with its paragraph
 * direction taken from the first strong character, and brackets mirrored.
 */
const ISOLATES = /[\u2066-\u2069]/g;

export function enableArabicBidi(doc: JsPdfDoc, arabicFont = true): void {
  const original = doc.text.bind(doc) as (...args: unknown[]) => JsPdfDoc;
  (doc as unknown as { text: (...args: unknown[]) => JsPdfDoc }).text = (...args: unknown[]) => {
    const [rawText, x, y, opts, ...rest] = args;
    // Bidi isolate marks (from i18n interpolation) have no glyph — drop them.
    const strip = (v: unknown): unknown =>
      typeof v === "string" ? v.replace(ISOLATES, "") : Array.isArray(v) ? v.map(strip) : v;
    const text = strip(rawText);
    let options = opts as Record<string, unknown> | undefined;
    const flat = Array.isArray(text) ? text.flat().join(" ") : String(text ?? "");
    if (arabicFont && ARABIC.test(flat)) {
      options = {
        isInputVisual: false,
        isOutputVisual: true,
        isInputRtl: firstStrongIsRtl(flat),
        isOutputRtl: false,
        isSymmetricSwapping: true,
        ...(options ?? {}),
      };
    }
    return original(text, x, y, options, ...rest);
  };
}

export function isRtlUi(): boolean {
  if (typeof document !== "undefined") {
    const el = document.documentElement;
    if (el.dir === "rtl") return true;
    if (el.lang?.toLowerCase().startsWith("ar")) return true;
  }
  return (i18n?.language ?? "").toLowerCase().startsWith("ar");
}

type AutoTable = Awaited<ReturnType<typeof loadPdf>>["autoTable"];

export type BrandedPdf = {
  doc: JsPdfDoc;
  autoTable: AutoTable;
  font: string;
  rtl: boolean;
  branding: ExportBranding;
  pageWidth: number;
  pageHeight: number;
  /** Horizontal page margin. */
  margin: number;
  /** First y available for content below the header. */
  contentTop: number;
  /** Bottom margin reserved for the footer. */
  contentBottom: number;
  /** x for start-aligned text (left in LTR, right in RTL) + its alignment. */
  startX: number;
  endX: number;
  startAlign: "left" | "right";
  endAlign: "left" | "right";
  /** Draw the shared header on the current page (call from didDrawPage). */
  drawHeader: () => void;
  /** Stamp footers (page X of Y) on every page and return the bytes. */
  finish: () => ArrayBuffer;
  /** finish() + browser download. */
  save: (filename: string) => void;
};

const BRAND_RULE: [number, number, number] = [30, 58, 95];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];

function imageFormat(dataUrl: string): "PNG" | "JPEG" | null {
  if (/^data:image\/png/i.test(dataUrl)) return "PNG";
  if (/^data:image\/jpe?g/i.test(dataUrl)) return "JPEG";
  return null;
}

function drawImageFit(
  doc: JsPdfDoc,
  dataUrl: string | null,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  alignEnd: boolean,
): number {
  if (!dataUrl) return 0;
  const fmt = imageFormat(dataUrl);
  if (!fmt) return 0;
  try {
    const props = doc.getImageProperties(dataUrl);
    const ratio = props.width / Math.max(1, props.height);
    let h = maxH;
    let w = h * ratio;
    if (w > maxW) {
      w = maxW;
      h = w / ratio;
    }
    doc.addImage(dataUrl, fmt, alignEnd ? x - w : x, y + (maxH - h) / 2, w, h);
    return w;
  } catch {
    return 0;
  }
}

/** Trim text with an ellipsis so it fits `maxWidth` at the current font size. */
function fit(doc: JsPdfDoc, text: string, maxWidth: number): string {
  if (!text) return "";
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

export async function createBrandedPdf(opts: {
  title: string;
  subtitle?: string;
  /** Extra small line under the project (e.g. production metadata). */
  detail?: string;
  branding?: ExportBranding;
  rtl?: boolean;
  orientation?: "landscape" | "portrait";
}): Promise<BrandedPdf> {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ orientation: opts.orientation ?? "landscape", unit: "pt", format: "a4" });
  const font = await registerPdfFonts(doc);
  enableArabicBidi(doc, font === PDF_FONT);
  const branding = opts.branding ?? (await (await import("./branding")).getExportBranding());
  const rtl = opts.rtl ?? isRtlUi();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 32;
  const startX = rtl ? pageWidth - margin : margin;
  const endX = rtl ? margin : pageWidth - margin;
  const startAlign = rtl ? "right" : "left";
  const endAlign = rtl ? "left" : "right";
  const headerTop = 20;
  const logoH = 40;
  const hasDetail = !!opts.detail;
  const ruleY = headerTop + logoH + (hasDetail ? 18 : 10);
  const contentTop = ruleY + 14;
  const contentBottom = 44;

  doc.setProperties({
    title: [opts.title, projectLabel(branding)].filter(Boolean).join(" — "),
    author: branding.userName || "Kwalis Hub",
    creator: "Kwalis Hub",
    subject: branding.companyName || "",
  });
  doc.setFont(font, "normal");

  const drawHeader = () => {
    // Client logo on the start side; company + project beside it.
    const logoW = drawImageFit(doc, branding.logoDataUrl, startX, headerTop, 110, logoH, rtl);
    const textX = rtl ? startX - (logoW ? logoW + 10 : 0) : startX + (logoW ? logoW + 10 : 0);
    const half = (pageWidth - margin * 2) / 2 - (logoW ? logoW + 10 : 0);

    doc.setTextColor(...INK);
    doc.setFont(font, "bold");
    doc.setFontSize(13);
    const company = branding.companyName || projectLabel(branding);
    doc.text(fit(doc, company, half), textX, headerTop + 16, { align: startAlign });
    doc.setFont(font, "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const proj = projectLabel(branding);
    if (proj && branding.companyName) {
      doc.text(fit(doc, proj, half), textX, headerTop + 31, { align: startAlign });
    }
    if (opts.detail) {
      doc.setFontSize(7.5);
      doc.text(fit(doc, opts.detail, pageWidth - margin * 2), startX, headerTop + logoH + 10, {
        align: startAlign,
      });
    }

    // Report title on the end side.
    const endHalf = (pageWidth - margin * 2) / 2 - 10;
    doc.setTextColor(...INK);
    doc.setFont(font, "bold");
    doc.setFontSize(12);
    doc.text(fit(doc, opts.title, endHalf), endX, headerTop + 16, { align: endAlign });
    if (opts.subtitle) {
      doc.setFont(font, "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(fit(doc, opts.subtitle, endHalf), endX, headerTop + 31, { align: endAlign });
    }

    doc.setDrawColor(...BRAND_RULE);
    doc.setLineWidth(1.2);
    doc.line(margin, ruleY, pageWidth - margin, ruleY);
    doc.setTextColor(...INK);
    doc.setFont(font, "normal");
  };

  const stampFooters = () => {
    const total = doc.getNumberOfPages();
    const line = footerLine(branding);
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      const y = pageHeight - 22;
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.6);
      doc.line(margin, y - 12, pageWidth - margin, y - 12);
      const lw = drawImageFit(doc, branding.productLogoDataUrl, startX, y - 8, 48, 12, rtl);
      doc.setFont(font, "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      const tx = rtl ? startX - (lw ? lw + 6 : 0) : startX + (lw ? lw + 6 : 0);
      doc.text(fit(doc, line, pageWidth - margin * 2 - 140), tx, y, { align: startAlign });
      doc.text(pageLabel(i, total), endX, y, { align: endAlign });
    }
    doc.setTextColor(...INK);
  };

  let finished = false;
  const finish = () => {
    if (!finished) {
      stampFooters();
      finished = true;
    }
    return doc.output("arraybuffer");
  };

  return {
    doc,
    autoTable,
    font,
    rtl,
    branding,
    pageWidth,
    pageHeight,
    margin,
    contentTop,
    contentBottom,
    startX,
    endX,
    startAlign,
    endAlign,
    drawHeader,
    finish,
    save: (filename: string) => {
      if (!finished) {
        stampFooters();
        finished = true;
      }
      doc.save(filename);
    },
  };
}
