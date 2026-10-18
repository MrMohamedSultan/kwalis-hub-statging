// Per-project Budget Header (metadata) — localStorage-backed.
// Persists a "Version", "Version Date", customizable dynamic fields with
// MULTI-VALUE support (e.g. multiple Production Companies), and a version
// history log auto-appended each time the header is saved.

import { useEffect, useState, useCallback, useMemo } from "react";
import { useStore } from "@/lib/store";
import { useProjectMetadata, metadataFieldValues } from "@/lib/project-metadata";

export type BudgetHeaderField = {
  id: string;
  label: string;
  /** Multi-value tag list. Legacy single-value data is auto-migrated on read. */
  values: string[];
};

export type BudgetHeaderVersionEntry = {
  version: string;
  versionDate: string;
  savedAt: string; // ISO datetime
  savedBy?: string | null;
  note?: string;
};

export type BudgetHeaderMeta = {
  version: string;
  versionDate: string; // ISO yyyy-mm-dd
  fields: BudgetHeaderField[];
  history: BudgetHeaderVersionEntry[];
};

const STORAGE_PREFIX = "budget.header.v1.";

const DEFAULT_FIELDS: BudgetHeaderField[] = [
  { id: "prod-co", label: "Production Company", values: [] },
  { id: "producer", label: "Producer", values: [] },
  { id: "line-producer", label: "Line Producer", values: [] },
  { id: "prepared-by", label: "Prepared By", values: [] },
  { id: "budget-setting", label: "Budget Setting", values: [] },
  { id: "prep-days", label: "Prep Days", values: [] },
  { id: "shoot-days", label: "Shoot Days", values: [] },
  { id: "filming-locations", label: "Filming Locations", values: [] },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function defaultHeader(): BudgetHeaderMeta {
  return {
    version: "v1.0",
    versionDate: todayIso(),
    fields: DEFAULT_FIELDS.map((f) => ({ ...f, values: [...f.values] })),
    history: [],
  };
}

function keyFor(pid: string | null) {
  return `${STORAGE_PREFIX}${pid ?? "_none"}`;
}

/** Normalise legacy `value: string` or new `values: string[]` into a clean array. */
function coerceValues(f: any): string[] {
  if (Array.isArray(f?.values)) {
    return f.values.map((v: any) => String(v ?? "").trim()).filter(Boolean);
  }
  const legacy = String(f?.value ?? "").trim();
  if (!legacy) return [];
  // Split legacy strings on comma / newline so single-value entries containing
  // "A, B" become multi-value chips automatically.
  return legacy
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readBudgetHeader(pid: string | null): BudgetHeaderMeta {
  if (typeof window === "undefined") return defaultHeader();
  try {
    const raw = window.localStorage.getItem(keyFor(pid));
    if (!raw) return defaultHeader();
    const parsed = JSON.parse(raw);
    return {
      version: String(parsed.version ?? "v1.0"),
      versionDate: String(parsed.versionDate ?? todayIso()),
      fields: Array.isArray(parsed.fields)
        ? parsed.fields.map((f: any) => ({
            id: String(f.id ?? crypto.randomUUID()),
            label: String(f.label ?? ""),
            values: coerceValues(f),
          }))
        : defaultHeader().fields,
      history: Array.isArray(parsed.history)
        ? parsed.history.map((h: any) => ({
            version: String(h.version ?? ""),
            versionDate: String(h.versionDate ?? ""),
            savedAt: String(h.savedAt ?? ""),
            savedBy: h.savedBy ?? null,
            note: h.note ? String(h.note) : undefined,
          }))
        : [],
    };
  } catch {
    return defaultHeader();
  }
}

export function writeBudgetHeader(pid: string | null, meta: BudgetHeaderMeta) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(pid), JSON.stringify(meta));
    window.dispatchEvent(new CustomEvent("budget-header:changed", { detail: { pid } }));
  } catch {
    /* ignore */
  }
}

/** Wipe the persisted header for a project so it falls back to defaults on next read.
 *  Preserves the version history when `keepHistory` is true. */
export function resetBudgetHeader(pid: string | null, opts: { keepHistory?: boolean } = {}) {
  if (typeof window === "undefined") return;
  try {
    if (opts.keepHistory) {
      const prev = readBudgetHeader(pid);
      const next: BudgetHeaderMeta = { ...defaultHeader(), history: prev.history };
      window.localStorage.setItem(keyFor(pid), JSON.stringify(next));
    } else {
      window.localStorage.removeItem(keyFor(pid));
    }
    window.dispatchEvent(new CustomEvent("budget-header:changed", { detail: { pid } }));
  } catch {
    /* ignore */
  }
}

/** Auto-increment a semver-ish version like "v4.1" → "v4.2". Falls back to appending .1. */
export function bumpVersion(v: string): string {
  const m = /^(v?)(\d+)(?:\.(\d+))?(.*)$/i.exec(v.trim());
  if (!m) return `${v}.1`;
  const prefix = m[1] || "v";
  const major = m[2];
  const minor = m[3] != null ? Number(m[3]) + 1 : 1;
  const tail = m[4] || "";
  return `${prefix}${major}.${minor}${tail}`;
}

/** Serialise a field's values for text-only surfaces (exports, tooltips). */
export function fieldValuesToString(f: Pick<BudgetHeaderField, "values">): string {
  return (f.values ?? []).filter(Boolean).join(", ");
}

export function useBudgetHeader(): [
  BudgetHeaderMeta,
  (patch: Partial<BudgetHeaderMeta>) => void,
  (fields: BudgetHeaderField[]) => void,
  (entry: Omit<BudgetHeaderVersionEntry, "savedAt"> & { savedAt?: string }) => void,
  (opts?: { keepHistory?: boolean }) => void,
] {
  const pid = useStore((s) => s.activeProjectId);
  const { metadata: projectMeta } = useProjectMetadata();
  const [meta, setMeta] = useState<BudgetHeaderMeta>(() => readBudgetHeader(pid));

  useEffect(() => {
    setMeta(readBudgetHeader(pid));
    const handler = () => setMeta(readBudgetHeader(pid));
    window.addEventListener("budget-header:changed", handler);
    return () => window.removeEventListener("budget-header:changed", handler);
  }, [pid]);

  const update = useCallback(
    (patch: Partial<BudgetHeaderMeta>) => {
      const next = { ...readBudgetHeader(pid), ...patch };
      writeBudgetHeader(pid, next);
      setMeta(next);
    },
    [pid],
  );

  const setFields = useCallback(
    (fields: BudgetHeaderField[]) => {
      const next = { ...readBudgetHeader(pid), fields };
      writeBudgetHeader(pid, next);
      setMeta(next);
    },
    [pid],
  );

  const appendHistory = useCallback(
    (entry: Omit<BudgetHeaderVersionEntry, "savedAt"> & { savedAt?: string }) => {
      const current = readBudgetHeader(pid);
      const full: BudgetHeaderVersionEntry = {
        version: entry.version,
        versionDate: entry.versionDate,
        savedAt: entry.savedAt ?? new Date().toISOString(),
        savedBy: entry.savedBy ?? null,
        note: entry.note,
      };
      const next: BudgetHeaderMeta = {
        ...current,
        history: [full, ...current.history].slice(0, 50),
      };
      writeBudgetHeader(pid, next);
      setMeta(next);
    },
    [pid],
  );

  const reset = useCallback(
    (opts?: { keepHistory?: boolean }) => {
      resetBudgetHeader(pid, opts ?? { keepHistory: true });
      setMeta(readBudgetHeader(pid));
    },
    [pid],
  );

  // DB-backed Project Settings win over the (legacy) empty localStorage
  // defaults: a header field with no local value falls back to the project's
  // saved metadata so headers stop rendering "—".
  const fallback = metadataFieldValues(projectMeta);
  const merged = useMemo<BudgetHeaderMeta>(() => {
    const fields = meta.fields.map((f) => {
      if (f.values.length > 0) return f;
      const fb = fallback[f.id];
      return fb && fb.length > 0 ? { ...f, values: fb } : f;
    });
    return { ...meta, fields };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, projectMeta]);

  return [merged, update, setFields, appendHistory, reset];
}
