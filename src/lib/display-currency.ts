// =====================================================================
// Display currency — a per-project presentation layer on top of the
// stored figures.
//
// Every financial figure in the app is persisted in the project's base
// currency (`fx-settings` → project override → organization → platform
// default, normally SAR). This module lets a report *display* those same
// figures in any configured currency without touching the stored data:
//
//   storedAmount (base)  --FX-->  displayed amount + explicit code
//
// The selection is per project and persisted in localStorage so switching
// projects never leaks another project's preference.
// =====================================================================
import { useSyncExternalStore } from "react";
import {
  PLATFORM_FX_DEFAULTS,
  convert,
  fetchProjectFxSettings,
  rateFor,
  type FxSettings,
} from "@/lib/fx-settings";
import { formatAmount } from "@/lib/format-number";

const storageKey = (pid: string) => `kwalis.displayCurrency.${pid}`;

type State = {
  projectId: string | null;
  settings: FxSettings;
  /** Currency the user wants to read the report in. */
  code: string;
  loading: boolean;
};

let state: State = {
  projectId: null,
  settings: PLATFORM_FX_DEFAULTS,
  code: PLATFORM_FX_DEFAULTS.baseCurrency,
  loading: false,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;

function readStored(pid: string): string | null {
  try {
    return localStorage.getItem(storageKey(pid));
  } catch {
    return null;
  }
}

let loadToken = 0;

/** Loads (once per project) the effective FX matrix for `projectId`. */
async function ensureLoaded(projectId: string | null) {
  if (projectId === state.projectId) return;
  const token = ++loadToken;
  state = { ...state, projectId, loading: !!projectId };
  emit();
  if (!projectId) {
    state = {
      projectId: null,
      settings: PLATFORM_FX_DEFAULTS,
      code: PLATFORM_FX_DEFAULTS.baseCurrency,
      loading: false,
    };
    emit();
    return;
  }
  let settings = PLATFORM_FX_DEFAULTS;
  try {
    settings = (await fetchProjectFxSettings(projectId)).effective;
  } catch {
    /* fall back to platform defaults */
  }
  if (token !== loadToken) return; // a newer project won the race
  const stored = readStored(projectId);
  const code = stored && rateFor(settings, stored) != null ? stored : settings.baseCurrency;
  state = { projectId, settings, code, loading: false };
  emit();
}

export function setDisplayCurrency(code: string) {
  const next = code.trim().toUpperCase();
  if (rateFor(state.settings, next) == null) return;
  state = { ...state, code: next };
  if (state.projectId) {
    try {
      localStorage.setItem(storageKey(state.projectId), next);
    } catch {
      /* private mode — selection stays in memory */
    }
  }
  emit();
}

export type DisplayCurrency = {
  /** Currency the figures are stored in. */
  base: string;
  /** Currency the figures are rendered in. */
  code: string;
  /** Codes the project has a usable rate for (base first). */
  options: string[];
  loading: boolean;
  /** True when no conversion is applied. */
  isBase: boolean;
  setCode: (code: string) => void;
  /** Converts a stored (base-currency) amount into the display currency. */
  convert: (amount: number) => number;
  /** Grouped number only — no code. Use when the column header carries it. */
  amount: (value: number, decimals?: number) => string;
  /** Grouped number with the explicit currency code appended. */
  format: (value: number, decimals?: number) => string;
};

export function useDisplayCurrency(projectId?: string | null): DisplayCurrency {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (projectId !== undefined && projectId !== snap.projectId) {
    // Fire-and-forget; the store emits when the matrix arrives.
    void ensureLoaded(projectId);
  }

  const { settings, code } = snap;
  const base = settings.baseCurrency;
  const options = [base, ...Object.keys(settings.rates).filter((c) => c !== base)];

  const toDisplay = (amount: number) => {
    const n = Number(amount);
    if (!Number.isFinite(n)) return 0;
    if (code === base) return n;
    const out = convert(settings, n, base, code);
    return out == null ? n : out;
  };

  const amount = (value: number, decimals = 2) => formatAmount(toDisplay(value), decimals);

  return {
    base,
    code,
    options,
    loading: snap.loading,
    isBase: code === base,
    setCode: setDisplayCurrency,
    convert: toDisplay,
    amount,
    format: (value: number, decimals = 0) => `${amount(value, decimals)} ${code}`,
  };
}
