// Branded PDF of an on-screen panel (G02) — the Executive Dashboard and any
// other visual page that has no table to print. The element is cloned
// off-screen (the live page is never touched), rasterised with
// html2canvas-pro, and laid out on A4 pages under the shared Kwalis Hub
// header and footer (client logo, company, project, user, Saudi time,
// page X of Y), with the standard file name. Pages break between the
// element's direct children (cards / rows) whenever one fits, so a card is
// not cut in half.

/** Pure: where each page starts / ends on the captured image (unit-tested). */
export function planPageSlices(
  totalHeight: number,
  pageHeight: number,
  breaks: number[],
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (totalHeight <= 0 || pageHeight <= 0) return out;
  const cuts = [...new Set(breaks.map((b) => Math.round(b)))]
    .filter((b) => b > 0 && b < totalHeight)
    .sort((a, b) => a - b);
  let start = 0;
  while (start < totalHeight) {
    const limit = start + pageHeight;
    if (limit >= totalHeight) {
      out.push({ start, end: totalHeight });
      break;
    }
    // the last child boundary that still fits (at least a third of a page)
    let end = -1;
    for (const c of cuts) {
      if (c > start + pageHeight / 3 && c <= limit) end = c;
      if (c > limit) break;
    }
    if (end < 0) end = limit;
    out.push({ start, end });
    start = end;
  }
  return out;
}

export async function exportElementPdf(opts: {
  target: HTMLElement;
  /** English report name for the file name, e.g. "Executive Dashboard". */
  report: string;
  /** Title printed in the header (localised). */
  title: string;
  subtitle?: string;
  orientation?: "landscape" | "portrait";
  /** Elements removed from the capture (buttons, selectors…). */
  hideSelector?: string;
}): Promise<string> {
  const [{ default: html2canvas }, { createBrandedPdf }, { brandedFileName }] = await Promise.all([
    import("html2canvas-pro"),
    import("./pdf-core"),
    import("./branding"),
  ]);
  const source = opts.target;
  const hideSel = opts.hideSelector ?? "[data-export-hide], .no-print";
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "top:0",
    "left:-100000px",
    "z-index:-1",
    "pointer-events:none",
    `width:${source.offsetWidth}px`,
    `background:${bg}`,
  ].join(";");
  const clone = source.cloneNode(true) as HTMLElement;
  // Entrance animations would capture cards half-faded.
  clone.querySelectorAll<HTMLElement>(".dash-enter").forEach((el) => {
    el.style.animation = "none";
    el.style.opacity = "1";
    el.style.transform = "none";
  });
  host.appendChild(clone);
  document.body.appendChild(host);

  let canvas: HTMLCanvasElement;
  let breaksCss: number[] = [];
  let cloneW = 0;
  try {
    clone.querySelectorAll<HTMLElement>(hideSel).forEach((el) => el.remove());
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    cloneW = clone.offsetWidth || source.offsetWidth;
    const top = clone.getBoundingClientRect().top;
    breaksCss = Array.from(clone.children).map(
      (c) => (c as HTMLElement).getBoundingClientRect().bottom - top,
    );
    canvas = await html2canvas(clone, {
      scale: Math.min(2, window.devicePixelRatio || 1),
      backgroundColor: bg,
      useCORS: true,
      logging: false,
    });
  } finally {
    host.remove();
  }

  const pdf = await createBrandedPdf({
    title: opts.title,
    subtitle: opts.subtitle,
    orientation: opts.orientation ?? "landscape",
  });
  const areaW = pdf.pageWidth - pdf.margin * 2;
  const areaH = pdf.pageHeight - pdf.contentTop - pdf.contentBottom;
  const px = cloneW > 0 ? canvas.width / cloneW : 1;
  const scale = areaW / canvas.width; // fit the width
  const pageHeightPx = Math.floor(areaH / scale);
  const slices = planPageSlices(
    canvas.height,
    pageHeightPx,
    breaksCss.map((b) => b * px),
  );

  slices.forEach((s, i) => {
    if (i > 0) pdf.doc.addPage();
    const h = s.end - s.start;
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = h;
    const ctx = slice.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, slice.width, h);
    ctx.drawImage(canvas, 0, s.start, canvas.width, h, 0, 0, canvas.width, h);
    pdf.drawHeader();
    pdf.doc.addImage(
      slice.toDataURL("image/png"),
      "PNG",
      pdf.margin,
      pdf.contentTop,
      canvas.width * scale,
      h * scale,
      undefined,
      "FAST",
    );
  });

  const filename = brandedFileName(opts.report, "pdf");
  pdf.save(filename);
  return filename;
}
