// Per-project Funding Ledger — cash inflows (investor tranches, capital, grants, etc.).
// Plus "Direct VAT Payments" ledger for VAT outflows paid straight to tax authority.
// Both are localStorage-backed keyed by activeProjectId.

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";

export type FundingKind = "Investor Tranche" | "Capital" | "Grant" | "Loan" | "Other";

export type FundingEntry = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  source: string;
  kind: FundingKind;
  amount: number; // SAR
  reference?: string;
  note?: string;
  createdAt: string;
};

export type VatPaymentEntry = {
  id: string;
  date: string;
  amount: number;
  reference?: string;
  note?: string;
  createdAt: string;
};

const FUND_PREFIX = "funding.entries.v1.";
const VAT_PREFIX = "funding.vat.v1.";
const RECON_PREFIX = "funding.recon.v1.";

const fkey = (pid: string | null) => `${FUND_PREFIX}${pid ?? "_none"}`;
const vkey = (pid: string | null) => `${VAT_PREFIX}${pid ?? "_none"}`;
const rkey = (pid: string | null) => `${RECON_PREFIX}${pid ?? "_none"}`;

export type ReconciliationSnapshot = {
  bankBalance: number;
  asOfDate: string;
  note?: string;
  updatedAt: string;
};

function readObj<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function useReconciliation() {
  const pid = useStore((s) => s.activeProjectId);
  const [snap, setSnap] = useState<ReconciliationSnapshot | null>(() =>
    readObj<ReconciliationSnapshot>(rkey(pid)),
  );
  useEffect(() => {
    setSnap(readObj<ReconciliationSnapshot>(rkey(pid)));
    const h = () => setSnap(readObj<ReconciliationSnapshot>(rkey(pid)));
    window.addEventListener("funding-recon:changed", h);
    return () => window.removeEventListener("funding-recon:changed", h);
  }, [pid]);
  const save = useCallback(
    (s: Omit<ReconciliationSnapshot, "updatedAt">) => {
      const full: ReconciliationSnapshot = { ...s, updatedAt: new Date().toISOString() };
      window.localStorage.setItem(rkey(pid), JSON.stringify(full));
      window.dispatchEvent(new CustomEvent("funding-recon:changed", { detail: { pid } }));
      setSnap(full);
    },
    [pid],
  );
  const clear = useCallback(() => {
    window.localStorage.removeItem(rkey(pid));
    window.dispatchEvent(new CustomEvent("funding-recon:changed", { detail: { pid } }));
    setSnap(null);
  }, [pid]);
  return { snap, save, clear };
}

function readList<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
function writeList<T>(key: string, items: T[], evt: string, pid: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(evt, { detail: { pid } }));
  } catch {
    /* ignore */
  }
}

export function useFundingEntries() {
  const pid = useStore((s) => s.activeProjectId);
  const [items, setItems] = useState<FundingEntry[]>(() => readList<FundingEntry>(fkey(pid)));
  useEffect(() => {
    setItems(readList<FundingEntry>(fkey(pid)));
    const h = () => setItems(readList<FundingEntry>(fkey(pid)));
    window.addEventListener("funding:changed", h);
    return () => window.removeEventListener("funding:changed", h);
  }, [pid]);
  const add = useCallback(
    (e: Omit<FundingEntry, "id" | "createdAt">) => {
      const full: FundingEntry = {
        ...e,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const next = [full, ...readList<FundingEntry>(fkey(pid))];
      writeList(fkey(pid), next, "funding:changed", pid);
      setItems(next);
    },
    [pid],
  );
  const remove = useCallback(
    (id: string) => {
      const next = readList<FundingEntry>(fkey(pid)).filter((x) => x.id !== id);
      writeList(fkey(pid), next, "funding:changed", pid);
      setItems(next);
    },
    [pid],
  );
  const update = useCallback(
    (id: string, patch: Partial<FundingEntry>) => {
      const next = readList<FundingEntry>(fkey(pid)).map((x) =>
        x.id === id ? { ...x, ...patch } : x,
      );
      writeList(fkey(pid), next, "funding:changed", pid);
      setItems(next);
    },
    [pid],
  );
  return { items, add, remove, update };
}

export function useVatPayments() {
  const pid = useStore((s) => s.activeProjectId);
  const [items, setItems] = useState<VatPaymentEntry[]>(() => readList<VatPaymentEntry>(vkey(pid)));
  useEffect(() => {
    setItems(readList<VatPaymentEntry>(vkey(pid)));
    const h = () => setItems(readList<VatPaymentEntry>(vkey(pid)));
    window.addEventListener("funding-vat:changed", h);
    return () => window.removeEventListener("funding-vat:changed", h);
  }, [pid]);
  const add = useCallback(
    (e: Omit<VatPaymentEntry, "id" | "createdAt">) => {
      const full: VatPaymentEntry = {
        ...e,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const next = [full, ...readList<VatPaymentEntry>(vkey(pid))];
      writeList(vkey(pid), next, "funding-vat:changed", pid);
      setItems(next);
    },
    [pid],
  );
  const remove = useCallback(
    (id: string) => {
      const next = readList<VatPaymentEntry>(vkey(pid)).filter((x) => x.id !== id);
      writeList(vkey(pid), next, "funding-vat:changed", pid);
      setItems(next);
    },
    [pid],
  );
  return { items, add, remove };
}
