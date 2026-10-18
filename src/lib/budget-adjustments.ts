// Per-project overrides for Top Sheet "Adjustments" rows (Contingency,
// Production Fees, etc.). Each account can be:
//   - percent:  pct% of the Direct-Costs subtotal (default, mirrors the
//               canonical `default_pct` seed value)
//   - fixed:    a hardcoded SAR amount (USD is derived from the current
//               SAR→USD ratio of the subtotal so both totals stay coherent)
//   - disabled: excluded from the Grand Total
//
// State is localStorage-backed, keyed by projectId.

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";

export type AdjustmentMode = "percent" | "fixed";

export type AdjustmentOverride = {
  mode: AdjustmentMode;
  /** Percent of Direct-Costs subtotal, e.g. 10 → 10%. */
  pct: number;
  /** Fixed amount in SAR. USD is derived from subtotal ratio at compute time. */
  fixedSAR: number;
  enabled: boolean;
};

export type AdjustmentOverrideMap = Record<string, AdjustmentOverride>;

const STORAGE_PREFIX = "budget.adjustments.v1.";

function keyFor(pid: string | null) {
  return `${STORAGE_PREFIX}${pid ?? "_none"}`;
}

export function defaultOverride(defaultPct: number | null | undefined): AdjustmentOverride {
  return {
    mode: "percent",
    pct: Number(defaultPct ?? 0),
    fixedSAR: 0,
    enabled: true,
  };
}

/** Clamp adjustment values so persisted state is always valid:
 *  - pct: 0–100, 2-decimal precision
 *  - fixedSAR: >= 0, integer-cent precision
 *  - non-finite / NaN inputs collapse to 0 */
export function clampOverride(o: AdjustmentOverride): AdjustmentOverride {
  const pctRaw = Number(o.pct);
  const fixedRaw = Number(o.fixedSAR);
  return {
    mode: o.mode === "fixed" ? "fixed" : "percent",
    pct: Number.isFinite(pctRaw) ? Math.min(100, Math.max(0, Math.round(pctRaw * 100) / 100)) : 0,
    fixedSAR: Number.isFinite(fixedRaw) ? Math.max(0, Math.round(fixedRaw * 100) / 100) : 0,
    enabled: !!o.enabled,
  };
}

export function readAdjustments(pid: string | null): AdjustmentOverrideMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(keyFor(pid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: AdjustmentOverrideMap = {};
    for (const [code, v] of Object.entries(parsed as Record<string, any>)) {
      out[code] = clampOverride({
        mode: v?.mode === "fixed" ? "fixed" : "percent",
        pct: Number(v?.pct ?? 0),
        fixedSAR: Number(v?.fixedSAR ?? 0),
        enabled: v?.enabled !== false,
      });
    }
    return out;
  } catch {
    return {};
  }
}

export function writeAdjustments(pid: string | null, map: AdjustmentOverrideMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(pid), JSON.stringify(map));
    window.dispatchEvent(new CustomEvent("budget-adjustments:changed", { detail: { pid } }));
  } catch {
    /* ignore */
  }
}

/** Clear all overrides for a project — Top Sheet rows fall back to canonical defaults. */
export function resetAdjustments(pid: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(pid));
    window.dispatchEvent(new CustomEvent("budget-adjustments:changed", { detail: { pid } }));
  } catch {
    /* ignore */
  }
}

/** Compute the SAR/USD contribution of an adjustment override against the
 *  current Direct-Costs subtotal. */
export function computeAdjustment(
  override: AdjustmentOverride,
  subtotalSAR: number,
  subtotalUSD: number,
): { sar: number; usd: number } {
  if (!override.enabled) return { sar: 0, usd: 0 };
  if (override.mode === "percent") {
    const pct = Number(override.pct) / 100;
    return { sar: pct * subtotalSAR, usd: pct * subtotalUSD };
  }
  // fixed SAR — derive USD from the subtotal ratio so exports stay consistent
  const sar = Number(override.fixedSAR) || 0;
  const ratio = subtotalSAR > 0 ? subtotalUSD / subtotalSAR : 0;
  return { sar, usd: sar * ratio };
}

export function useAdjustmentOverrides(): [
  AdjustmentOverrideMap,
  (code: string, patch: Partial<AdjustmentOverride>) => void,
  (code?: string) => void,
] {
  const pid = useStore((s) => s.activeProjectId);
  const [map, setMap] = useState<AdjustmentOverrideMap>(() => readAdjustments(pid));

  useEffect(() => {
    setMap(readAdjustments(pid));
    const handler = () => setMap(readAdjustments(pid));
    window.addEventListener("budget-adjustments:changed", handler);
    return () => window.removeEventListener("budget-adjustments:changed", handler);
  }, [pid]);

  const patch = useCallback(
    (code: string, p: Partial<AdjustmentOverride>) => {
      const current = readAdjustments(pid);
      const existing = current[code] ?? defaultOverride(0);
      const next: AdjustmentOverrideMap = {
        ...current,
        [code]: clampOverride({ ...existing, ...p }),
      };
      writeAdjustments(pid, next);
      setMap(next);
    },
    [pid],
  );

  /** Reset a single adjustment row (removes its override so canonical defaults apply)
   *  or, if no code is passed, clears every override for the active project. */
  const reset = useCallback(
    (code?: string) => {
      if (!code) {
        resetAdjustments(pid);
        setMap({});
        return;
      }
      const current = readAdjustments(pid);
      const { [code]: _drop, ...rest } = current;
      writeAdjustments(pid, rest);
      setMap(rest);
    },
    [pid],
  );

  return [map, patch, reset];
}
