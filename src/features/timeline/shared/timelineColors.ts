/**
 * Kwalis HUB — Timeline colour resolution (SINGLE SOURCE OF TRUTH)
 * -----------------------------------------------------------------
 * Both the on-screen timeline and the Excel export import from this file.
 * That is the entire point: if the screen and the workbook ever disagree
 * about a colour again, it means something stopped calling this module.
 *
 * Where colour actually comes from:
 *   1. The Timeline Task Dictionary card the bar was created from (`card.bg`).
 *      This is what the user picked from the six colour circles, so it wins.
 *   2. The bar's `kind`, for bars with no matching card (custom events).
 *   3. A neutral, so nothing ever renders colourless.
 *
 * The six tokens below are exactly the six circles in the "New task card"
 * dialog. Their hex values were read out of the running app, not guessed.
 *
 * Drop this at: src/features/timeline/shared/timelineColors.ts
 */

/* ================================================================== *
 * Tokens
 * ================================================================== */

export type TimelineColorToken =
  | 'info'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'highlight'
  | 'muted';

export const TIMELINE_COLOR_TOKENS: TimelineColorToken[] = [
  'info',
  'success',
  'warning',
  'destructive',
  'highlight',
  'muted',
];

/**
 * Fallback hex per token, read from the live app's resolved CSS variables.
 * At runtime `resolveTokenHex` prefers the real computed value so a theme
 * change follows through to Excel automatically; these are the offline
 * fallback (SSR, tests, workers).
 */
export const TOKEN_FALLBACK_HEX: Record<TimelineColorToken, string> = {
  info: '195DAA',
  success: '059669',
  warning: 'D97706',
  destructive: 'DC2626',
  highlight: '6E3EAD',
  muted: 'ECEFF2',
};

/**
 * Static class strings. Tailwind cannot see dynamically built class names,
 * so these must stay written out in full — never `bg-${token}/80`.
 */
export const BAR_CLASS: Record<TimelineColorToken, string> = {
  info: 'bg-info/80 border-info/40',
  success: 'bg-success/80 border-success/40',
  warning: 'bg-warning/80 border-warning/40',
  destructive: 'bg-destructive/80 border-destructive/40',
  highlight: 'bg-highlight/80 border-highlight/40',
  muted: 'bg-muted border-border',
};

export const SUMMARY_CLASS: Record<TimelineColorToken, string> = {
  info: 'bg-info/70 border-info/60',
  success: 'bg-success/70 border-success/60',
  warning: 'bg-warning/70 border-warning/60',
  destructive: 'bg-destructive/70 border-destructive/60',
  highlight: 'bg-highlight/70 border-highlight/60',
  muted: 'bg-muted border-border',
};

/** label colour that stays readable on each token */
export const BAR_TEXT_HEX: Record<TimelineColorToken, string> = {
  info: 'FFFFFF',
  success: 'FFFFFF',
  warning: 'FFFFFF',
  destructive: 'FFFFFF',
  highlight: 'FFFFFF',
  muted: '0B0D11',
};

/* ================================================================== *
 * Track rows
 * ================================================================== */

export interface TimelineRow {
  id: string;
  label: string;
  /** Arabic label — present on every row in the app's row registry */
  ar?: string;
}

/** The six macro tracks, in screen order. `shoot` is Production — not `production`. */
export const ROW_ORDER = ['development', 'soft-prep', 'prep', 'shoot', 'post', 'wrap'] as const;

/**
 * Macro-phase pill colour per track, matching the Schedule Summary band.
 * NOTE: `post` and `wrap` were unscheduled when this was read, so their
 * tokens could not be observed. Confirm them before trusting the summary
 * colours for those two rows.
 */
export const ROW_TOKEN: Record<string, TimelineColorToken> = {
  development: 'highlight',
  'soft-prep': 'warning',
  prep: 'info',
  shoot: 'info', // --brand resolves to the same hex as --info in this theme
  post: 'success', // UNCONFIRMED
  wrap: 'muted', // UNCONFIRMED
};

/* ================================================================== *
 * Kind fallback — only for bars with no dictionary card
 * ================================================================== */

export const KIND_TOKEN: Record<string, TimelineColorToken> = {
  prep: 'info',
  sound: 'highlight',
  editors: 'destructive',
  directors: 'destructive',
};

export const NEUTRAL_TOKEN: TimelineColorToken = 'muted';

/* ================================================================== *
 * Card index
 * ================================================================== */

export interface TimelineCard {
  name: string;
  bg?: string; // 'bg-info', 'bg-highlight', …
  code?: string;
  required?: number;
  done?: number;
  category?: string;
  id?: string;
}

export interface TimelineBar {
  id: string;
  row: string;
  kind?: string;
  label: string;
  start: string;
  end: string;
  cashAlert?: unknown;
  /** reserved for phase two — an explicit link to the dictionary card */
  cardId?: string;
}

/**
 * Names are matched after normalisation because the data really does contain
 * typographic apostrophes ("Writers’ Room End") that will never equal a
 * straight-quoted string. This is a stopgap: phase two replaces it with a
 * `card_id` column, at which point name matching becomes a fallback only.
 */
export function normaliseCardName(value: string): string {
  return (value || '')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface CardIndex {
  byId: Map<string, TimelineCard>;
  byName: Map<string, TimelineCard>;
  size: number;
}

export function buildCardIndex(cards: TimelineCard[] | null | undefined): CardIndex {
  const byId = new Map<string, TimelineCard>();
  const byName = new Map<string, TimelineCard>();
  (cards ?? []).forEach((card) => {
    if (!card) return;
    if (card.id) byId.set(card.id, card);
    const n = normaliseCardName(card.name);
    // first card wins, so a later duplicate name cannot silently repaint bars
    if (n && !byName.has(n)) byName.set(n, card);
  });
  return { byId, byName, size: byId.size + byName.size };
}

/* ================================================================== *
 * Resolution
 * ================================================================== */

export type ColorSource = 'card-id' | 'card-name' | 'kind' | 'neutral';

export interface ResolvedBarColor {
  token: TimelineColorToken;
  source: ColorSource;
  /** the dictionary card this bar resolved to, when there was one */
  card: TimelineCard | null;
}

function tokenFromBg(bg: string | undefined): TimelineColorToken | null {
  if (!bg) return null;
  const raw = bg.replace(/^bg-/, '').split('/')[0].trim() as TimelineColorToken;
  return TIMELINE_COLOR_TOKENS.includes(raw) ? raw : null;
}

/**
 * THE function. The bar component and the Excel generator both call this and
 * nothing else. Order: explicit card link, then name, then kind, then neutral.
 */
export function resolveBarColor(bar: TimelineBar, index: CardIndex): ResolvedBarColor {
  if (bar.cardId) {
    const card = index.byId.get(bar.cardId);
    const token = tokenFromBg(card?.bg);
    if (card && token) return { token, source: 'card-id', card };
  }

  const card = index.byName.get(normaliseCardName(bar.label));
  const token = tokenFromBg(card?.bg);
  if (card && token) return { token, source: 'card-name', card };

  const kindToken = bar.kind ? KIND_TOKEN[bar.kind] : undefined;
  if (kindToken) return { token: kindToken, source: 'kind', card: null };

  return { token: NEUTRAL_TOKEN, source: 'neutral', card: null };
}

export function resolveRowToken(rowId: string): TimelineColorToken {
  return ROW_TOKEN[rowId] ?? NEUTRAL_TOKEN;
}

/* ================================================================== *
 * Hex resolution — prefers the live theme, falls back to constants
 * ================================================================== */

const hexCache = new Map<TimelineColorToken, string>();

/**
 * Reads the resolved CSS variable out of the document so the workbook always
 * matches whatever the theme is currently rendering. Falls back to the
 * constants above outside a browser.
 */
export function resolveTokenHex(token: TimelineColorToken): string {
  const cached = hexCache.get(token);
  if (cached) return cached;

  const fallback = TOKEN_FALLBACK_HEX[token];
  if (typeof document === 'undefined' || typeof window === 'undefined') return fallback;

  try {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.opacity = '0';
    probe.style.pointerEvents = 'none';
    probe.style.color = `var(--${token})`;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    document.body.removeChild(probe);

    // the theme uses lab()/oklab(), which no regex can parse — let the canvas
    // do the colour-space conversion for us
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = computed;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const hex = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

    if (!/^[0-9A-F]{6}$/.test(hex)) return fallback;
    hexCache.set(token, hex);
    return hex;
  } catch {
    return fallback;
  }
}

export function resolveBarHex(bar: TimelineBar, index: CardIndex): string {
  return resolveTokenHex(resolveBarColor(bar, index).token);
}

/** call after a theme switch so the next export re-reads the variables */
export function clearColorCache(): void {
  hexCache.clear();
}
