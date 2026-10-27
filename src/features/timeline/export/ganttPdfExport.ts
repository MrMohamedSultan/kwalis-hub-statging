// High-fidelity Gantt → PDF (off-screen clone capture).
//
// The live timeline screen is never touched: the export root is deep-cloned
// into an off-screen host, chrome is stripped from the clone, every horizontal
// scroller in the clone is expanded to its full scrollWidth, and the clone is
// rasterised with html2canvas-pro (native oklch()/lab() support).
//
// The resulting bitmap is sliced horizontally across as many landscape pages as
// the timeline needs. The frozen track-label column (`data-export-freeze-x`) is
// re-drawn on every page, and the frozen date header (`data-export-freeze-y`)
// is re-drawn at the top of every page, so each page reads on its own.
//
// Read-only: reads the DOM, writes nothing back, and removes the off-screen
// host in a `finally` block.

export type GanttPdfOptions = {
  /** Element wrapping the Gantt (defaults to `[data-timeline-export-root]`). */
  target?: HTMLElement | null;
  fileName: string;
  title: string;
  subtitle?: string;
  /** Selector for the frozen left label column, repeated on every page. */
  freezeXSelector?: string;
  /** Selector(s) for the frozen date header, repeated on every page. */
  freezeYSelector?: string;
  /** Selector for elements removed from the capture. */
  hideSelector?: string;
};

const DEFAULTS = {
  rootSelector: "[data-timeline-export-root]",
  freezeXSelector: "[data-export-freeze-x]",
  freezeYSelector: "[data-export-freeze-y]",
  hideSelector: "[data-export-hide], .no-print",
};

/** Expands every horizontal scroller inside the clone so nothing is clipped. */
function expandScrollers(clone: HTMLElement): void {
  const all = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];
  for (const el of all) {
    const style = window.getComputedStyle(el);
    const scrolls =
      el.scrollWidth > el.clientWidth + 1 ||
      style.overflowX === "auto" ||
      style.overflowX === "scroll" ||
      style.overflow === "auto" ||
      style.overflow === "scroll";
    if (!scrolls) continue;
    el.style.overflow = "visible";
    el.style.overflowX = "visible";
    el.style.overflowY = "visible";
    el.style.maxWidth = "none";
    el.style.width = "max-content";
  }
}

export async function exportGanttPdf(options: GanttPdfOptions): Promise<void> {
  if (typeof document === "undefined") return;

  const rootSel = DEFAULTS.rootSelector;
  const source =
    options.target ??
    document.querySelector<HTMLElement>(rootSel) ??
    document.querySelector<HTMLElement>(".timeline-print-area");
  if (!source) throw new Error("Timeline area not found on the page");

  const hideSel = options.hideSelector ?? DEFAULTS.hideSelector;
  const freezeXSel = options.freezeXSelector ?? DEFAULTS.freezeXSelector;
  const freezeYSel = options.freezeYSelector ?? DEFAULTS.freezeYSelector;

  const [{ default: html2canvas }, { createBrandedPdf }, { normalizeForActiveProject }] =
    await Promise.all([
      import("html2canvas-pro"),
      import("@/lib/export/pdf-core"),
      import("@/lib/export/branding"),
    ]);

  // ---- off-screen host --------------------------------------------------
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "top:0",
    "left:-100000px",
    "z-index:-1",
    "pointer-events:none",
    "background:#ffffff",
    "padding:0",
    "margin:0",
  ].join(";");

  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.background = "#ffffff";
  clone.style.width = `${source.scrollWidth}px`;
  clone.style.minWidth = `${source.scrollWidth}px`;
  clone.style.height = `${source.scrollHeight}px`;
  host.appendChild(clone);
  document.body.appendChild(host);

  let canvas: HTMLCanvasElement;
  let freezeXCssW = 0;
  let freezeYCssH = 0;
  let cloneCssW = 0;
  try {
    clone.querySelectorAll<HTMLElement>(hideSel).forEach((el) => el.remove());
    expandScrollers(clone);

    // Let layout settle after the expansion before snapshotting.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    cloneCssW = Math.max(clone.scrollWidth, clone.offsetWidth);
    host.style.width = `${cloneCssW}px`;

    const fx = clone.querySelector<HTMLElement>(freezeXSel);
    freezeXCssW = fx ? fx.getBoundingClientRect().width : 0;

    const fys = Array.from(clone.querySelectorAll<HTMLElement>(freezeYSel));
    if (fys.length) {
      const cloneTop = clone.getBoundingClientRect().top;
      freezeYCssH = Math.max(
        ...fys.map((el) => el.getBoundingClientRect().bottom - cloneTop),
        0,
      );
    }

    canvas = await html2canvas(clone, {
      scale: Math.min(2, window.devicePixelRatio || 1),
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      width: source.scrollWidth,
      height: source.scrollHeight,
      windowWidth: source.scrollWidth,
    });
  } finally {
    host.remove();
  }

  const px = cloneCssW > 0 ? canvas.width / cloneCssW : 1;
  const freezeW = Math.round(freezeXCssW * px);
  const headerH = Math.round(freezeYCssH * px);

  // Shared Kwalis Hub header/footer (client logo, company, project, user,
  // Saudi time, page X of Y) around the rendered chart (G02).
  const branded = await createBrandedPdf({ title: options.title, subtitle: options.subtitle });
  const pdf = branded.doc;
  const pageW = branded.pageWidth;
  const pageH = branded.pageHeight;
  const margin = branded.margin;
  const areaTop = branded.contentTop;
  const areaW = pageW - margin * 2;
  const areaH = pageH - areaTop - branded.contentBottom;

  const bodyStart = freezeW;
  const bodyTotal = Math.max(1, canvas.width - bodyStart);

  // Keep the vertical scale readable: how much body width fits per page.
  const aspect = areaW / areaH;
  const perPageTotal = Math.max(320, Math.floor(canvas.height * aspect));
  const bodyPerPage = Math.max(160, perPageTotal - freezeW);
  const pages = Math.max(1, Math.ceil(bodyTotal / bodyPerPage));

  for (let i = 0; i < pages; i += 1) {
    if (i > 0) pdf.addPage();
    const sx = bodyStart + i * bodyPerPage;
    const sw = Math.min(bodyPerPage, canvas.width - sx);
    const pageCanvasW = freezeW + sw;

    const slice = document.createElement("canvas");
    slice.width = pageCanvasW;
    slice.height = canvas.height;
    const ctx = slice.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageCanvasW, canvas.height);

    // Body slice.
    ctx.drawImage(canvas, sx, 0, sw, canvas.height, freezeW, 0, sw, canvas.height);

    // Frozen track-label column, repeated on every page.
    if (freezeW > 0) {
      ctx.drawImage(canvas, 0, 0, freezeW, canvas.height, 0, 0, freezeW, canvas.height);
    }

    // Frozen date header band, repeated on every page (already inside the
    // slice for page 1, redrawn here so later pages keep their calendar band).
    if (headerH > 0 && i > 0) {
      ctx.drawImage(canvas, sx, 0, sw, headerH, freezeW, 0, sw, headerH);
    }

    branded.drawHeader();

    const scale = Math.min(areaW / pageCanvasW, areaH / canvas.height);
    pdf.addImage(
      slice.toDataURL("image/png"),
      "PNG",
      margin,
      areaTop,
      pageCanvasW * scale,
      canvas.height * scale,
      undefined,
      "FAST",
    );
  }

  branded.save(normalizeForActiveProject(options.fileName, "pdf"));
}
