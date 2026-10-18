// Frontend-only Supporting Document URL registry.
// Keeps a light localStorage map of { kind, id → url } so that invoice /
// petty-cash / payroll entries can carry a "reference link" without any
// database changes. Used by the Saudi Film Commission Rebate export.

import { useEffect, useState } from "react";

export type SupportingDocKind = "invoice" | "receipt" | "payroll";

const KEY = "kwalishub.supportingDocs.v1";

type Store = Record<SupportingDocKind, Record<string, string>>;

function read(): Store {
  if (typeof window === "undefined") return { invoice: {}, receipt: {}, payroll: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { invoice: {}, receipt: {}, payroll: {} };
    const parsed = JSON.parse(raw);
    return {
      invoice: parsed.invoice ?? {},
      receipt: parsed.receipt ?? {},
      payroll: parsed.payroll ?? {},
    };
  } catch {
    return { invoice: {}, receipt: {}, payroll: {} };
  }
}

function write(store: Store) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent("supporting-docs:change"));
}

export function getSupportingDocUrl(kind: SupportingDocKind, id: string): string {
  if (!id) return "";
  return read()[kind][id] ?? "";
}

export function setSupportingDocUrl(kind: SupportingDocKind, id: string, url: string) {
  if (!id) return;
  const s = read();
  if (url.trim()) s[kind][id] = url.trim();
  else delete s[kind][id];
  write(s);
}

/** React binding — re-reads whenever another tab/component updates the map. */
export function useSupportingDocUrl(kind: SupportingDocKind, id: string) {
  const [value, setValue] = useState(() => getSupportingDocUrl(kind, id));
  useEffect(() => {
    const refresh = () => setValue(getSupportingDocUrl(kind, id));
    refresh();
    window.addEventListener("supporting-docs:change", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("supporting-docs:change", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [kind, id]);
  const update = (next: string) => {
    setValue(next);
    setSupportingDocUrl(kind, id, next);
  };
  return [value, update] as const;
}
