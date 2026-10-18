// Resolves a semantic Tailwind background utility (e.g. "bg-info", "bg-highlight/80")
// to a plain 'RRGGBB' hex string by asking the browser for the computed colour.
//
// The timeline task dictionary stores colours as design-token classes, so the
// only faithful source of the real on-screen colour is the live stylesheet.
// Modern colour spaces (oklch/lab) are flattened through a canvas paint.

const cache = new Map<string, string>();

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

function flattenToHex(cssColor: string): string | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000000";
    ctx.fillStyle = cssColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  } catch {
    return null;
  }
}

/** "bg-info", "bg-highlight/80", "#EF4444" or "EF4444" → "RRGGBB" (or null). */
export function resolveTokenColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  const direct = raw.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(direct)) return direct.toUpperCase();

  if (cache.has(raw)) return cache.get(raw)!;
  if (typeof document === "undefined") return null;

  // Strip any opacity suffix so the base token colour is measured.
  const cls = raw.split(/\s+/)[0].replace(/\/\d+$/, "");

  const probe = document.createElement("div");
  probe.className = cls;
  probe.style.position = "fixed";
  probe.style.left = "-9999px";
  probe.style.top = "0";
  probe.style.width = probe.style.height = "1px";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  let hex: string | null = null;
  try {
    const bg = getComputedStyle(probe).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") hex = flattenToHex(bg);
  } finally {
    probe.remove();
  }

  if (hex) cache.set(raw, hex);
  return hex;
}
