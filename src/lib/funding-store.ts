// Per-project Funding Ledger — cash inflows (investor tranches, capital, grants, etc.).
// Plus the tax cash movements (VAT paid / VAT recovered / WHT remitted).
//
// A09: both live in the database — public.project_funding and
// public.treasury_movements (the one table for VAT paid / recovered, WHT
// remitted, bank charges and petty cash returns, db/pending/196; the 180
// name project_tax_payments is a compatibility view over it) — so reports,
// the cash position (get_funding_position = the ledger bank account) and the
// ledger see them. They used to be kept in this browser only; entries still
// found in localStorage are offered for import (`legacy` / `importLegacy`).
// The bank reconciliation snapshot stays a per-browser convenience.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";

export type FundingKind = "Investor Tranche" | "Capital" | "Grant" | "Loan" | "Other";

export type FundingEntry = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  source: string;
  kind: FundingKind;
  amount: number; // SAR (booked amount)
  /** B28 — currency the inflow was received in; absent/SAR for SAR inflows. */
  currency?: string;
  /** Amount in `currency` when it is not SAR. */
  originalAmount?: number;
  /** SAR per 1 unit of `currency` applied when booking. */
  fxRate?: number;
  reference?: string;
  note?: string;
  createdAt: string;
};

/** Kinds of public.treasury_movements (db/pending/182 + 196). */
export type TaxPaymentKind =
  "vat_payment" | "vat_recovery" | "wht_remittance" | "bank_charge" | "petty_cash_return";
/** Kinds recorded on the Funding screen (petty cash returns: Bank Reconciliation). */
export const FUNDING_TREASURY_KINDS: TaxPaymentKind[] = [
  "vat_payment",
  "vat_recovery",
  "wht_remittance",
  "bank_charge",
];
/** Sign of a movement on the bank balance: money in (+1) or out (−1). */
export const treasurySign = (k?: TaxPaymentKind) =>
  k === "vat_recovery" || k === "petty_cash_return" ? 1 : -1;

export type VatPaymentEntry = {
  id: string;
  kind?: TaxPaymentKind;
  date: string;
  amount: number;
  budgetCode?: string;
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

const FUNDING_KINDS: FundingKind[] = ["Investor Tranche", "Capital", "Grant", "Loan", "Other"];
const db = () => supabase as any;

function useProjectScope() {
  const pid = useStore((s) => s.activeProjectId);
  const orgId = useStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.organizationId ?? null,
  );
  return { pid, orgId };
}

export const fromFundingRow = (r: any): FundingEntry => ({
  id: r.id,
  date: r.funding_date,
  source: r.source ?? "",
  kind: (FUNDING_KINDS as string[]).includes(r.kind) ? r.kind : "Other",
  amount: Number(r.amount) || 0,
  // B28 (db/pending/196): the currency the money came in, kept beside the SAR amount
  currency: r.currency && r.currency !== "SAR" ? String(r.currency) : undefined,
  originalAmount:
    r.currency && r.currency !== "SAR" && r.original_amount != null
      ? Number(r.original_amount)
      : undefined,
  fxRate: r.currency && r.currency !== "SAR" && r.fx_rate != null ? Number(r.fx_rate) : undefined,
  reference: r.reference ?? undefined,
  note: r.notes ?? undefined,
  createdAt: r.created_at,
});

export const toFundingRow = (e: Partial<FundingEntry>) => {
  const out: Record<string, unknown> = {};
  if (e.date !== undefined) out.funding_date = e.date;
  if (e.source !== undefined) out.source = e.source.slice(0, 200);
  if (e.kind !== undefined) out.kind = e.kind;
  if (e.amount !== undefined) out.amount = Math.round(Number(e.amount) * 100) / 100;
  if (e.currency !== undefined || e.amount !== undefined) {
    const foreign = !!e.currency && e.currency !== "SAR";
    out.currency = foreign ? e.currency : "SAR";
    out.original_amount =
      foreign && e.originalAmount != null ? Math.round(Number(e.originalAmount) * 100) / 100 : null;
    out.fx_rate = foreign && e.fxRate != null ? Number(e.fxRate) : null;
  }
  if (e.reference !== undefined) out.reference = e.reference ? e.reference.slice(0, 200) : null;
  if (e.note !== undefined) out.notes = e.note ? e.note.slice(0, 2000) : null;
  return out;
};

const fail = (e: { message?: string } | null) => {
  if (e) toast.error(e.message ?? "Could not save");
  return !e;
};

/** Received funding of the active project (public.project_funding). */
export function useFundingEntries() {
  const { pid, orgId } = useProjectScope();
  const [items, setItems] = useState<FundingEntry[]>([]);
  const [legacy, setLegacy] = useState<FundingEntry[]>([]);

  const load = useCallback(async () => {
    setLegacy(readList<FundingEntry>(fkey(pid)));
    if (!pid) return setItems([]);
    const { data, error } = await db()
      .from("project_funding")
      .select("*")
      .eq("project_id", pid)
      .order("funding_date", { ascending: false });
    if (!error) setItems(((data ?? []) as any[]).map(fromFundingRow));
  }, [pid]);

  useEffect(() => {
    void load();
    const h = () => void load();
    window.addEventListener("funding:changed", h);
    return () => window.removeEventListener("funding:changed", h);
  }, [load]);

  const changed = () =>
    window.dispatchEvent(new CustomEvent("funding:changed", { detail: { pid } }));

  const add = useCallback(
    async (e: Omit<FundingEntry, "id" | "createdAt">) => {
      if (!pid || !orgId) return false;
      const { error } = await db()
        .from("project_funding")
        .insert({
          ...toFundingRow(e),
          project_id: pid,
          organization_id: orgId,
          status: "received",
        });
      changed();
      return fail(error);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid, orgId],
  );
  const remove = useCallback(
    async (id: string) => {
      const { error } = await db()
        .from("project_funding")
        .delete()
        .eq("id", id)
        .eq("project_id", pid);
      changed();
      return fail(error);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid],
  );
  const update = useCallback(
    async (id: string, patch: Partial<FundingEntry>) => {
      const { error } = await db()
        .from("project_funding")
        .update(toFundingRow(patch))
        .eq("id", id)
        .eq("project_id", pid);
      changed();
      return fail(error);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid],
  );
  /** Move entries saved only in this browser into the project. */
  const importLegacy = useCallback(async () => {
    if (!pid || !orgId) return false;
    const rows = readList<FundingEntry>(fkey(pid)).filter((e) => Number(e.amount) > 0 && e.date);
    if (rows.length) {
      const { error } = await db()
        .from("project_funding")
        .insert(
          rows.map((e) => ({
            ...toFundingRow(e),
            project_id: pid,
            organization_id: orgId,
            status: "received",
          })),
        );
      if (!fail(error)) return false;
    }
    window.localStorage.removeItem(fkey(pid));
    changed();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, orgId]);
  return { items, add, remove, update, legacy, importLegacy };
}

const fromTaxRow = (r: any): VatPaymentEntry => ({
  id: r.id,
  kind: r.kind,
  date: r.movement_date,
  budgetCode: r.budget_code ?? undefined,
  amount: Number(r.amount) || 0,
  reference: r.reference ?? undefined,
  note: r.notes ?? undefined,
  createdAt: r.created_at,
});

/** Bank movements without a document of the active project (public.treasury_movements). */
export function useVatPayments() {
  const { pid, orgId } = useProjectScope();
  const [items, setItems] = useState<VatPaymentEntry[]>([]);
  const [legacy, setLegacy] = useState<VatPaymentEntry[]>([]);

  const load = useCallback(async () => {
    setLegacy(readList<VatPaymentEntry>(vkey(pid)));
    if (!pid) return setItems([]);
    const { data, error } = await db()
      .from("treasury_movements")
      .select("*")
      .eq("project_id", pid)
      .order("movement_date", { ascending: false });
    if (!error) setItems(((data ?? []) as any[]).map(fromTaxRow));
  }, [pid]);

  useEffect(() => {
    void load();
    const h = () => void load();
    window.addEventListener("funding-vat:changed", h);
    return () => window.removeEventListener("funding-vat:changed", h);
  }, [load]);

  const changed = () =>
    window.dispatchEvent(new CustomEvent("funding-vat:changed", { detail: { pid } }));
  const toRow = (e: Omit<VatPaymentEntry, "id" | "createdAt">) => ({
    project_id: pid,
    organization_id: orgId,
    kind: e.kind ?? "vat_payment",
    movement_date: e.date,
    amount: Math.round(Number(e.amount) * 100) / 100,
    budget_code: e.kind === "bank_charge" && e.budgetCode ? e.budgetCode.slice(0, 64) : null,
    reference: e.reference ? e.reference.slice(0, 200) : null,
    notes: e.note ? e.note.slice(0, 2000) : null,
  });

  const add = useCallback(
    async (e: Omit<VatPaymentEntry, "id" | "createdAt">) => {
      if (!pid || !orgId) return false;
      const { error } = await db().from("treasury_movements").insert(toRow(e));
      changed();
      return fail(error);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid, orgId],
  );
  const remove = useCallback(
    async (id: string) => {
      const { error } = await db()
        .from("treasury_movements")
        .delete()
        .eq("id", id)
        .eq("project_id", pid);
      changed();
      return fail(error);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid],
  );
  const importLegacy = useCallback(async () => {
    if (!pid || !orgId) return false;
    const rows = readList<VatPaymentEntry>(vkey(pid)).filter((e) => Number(e.amount) > 0 && e.date);
    if (rows.length) {
      const { error } = await db()
        .from("treasury_movements")
        .insert(rows.map((e) => toRow({ ...e, kind: "vat_payment" })));
      if (!fail(error)) return false;
    }
    window.localStorage.removeItem(vkey(pid));
    changed();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, orgId]);
  return { items, add, remove, legacy, importLegacy };
}

export type FundingPosition = {
  funding: number;
  funding_expected: number;
  paid: number;
  vat_paid: number;
  vat_recovered: number;
  wht_remitted: number;
  /** db/pending/196: the parts of the bank balance (= Trial Balance account 9100). */
  paid_from_bank: number;
  paid_not_from_bank: number;
  petty_cash_issued: number;
  petty_cash_returned: number;
  bank_charges: number;
  cash_on_hand: number;
  petty_cash: number;
  /** Balance of the bank account in the ledger. */
  cash_balance: number;
  upcoming: number;
  upcoming_invoices: number;
  upcoming_instalments: number;
  expected_balance: number;
  actual: number;
  commitment: number;
  payable: number;
  has_funding: boolean;
  overdrawn: boolean;
  payments_exceed_funding: boolean;
};

/** A12: the cash figures of the active project (public.get_funding_position). */
export function useFundingPosition() {
  const { pid } = useProjectScope();
  const [data, setData] = useState<FundingPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!pid) return setData(null);
    const { data: j, error: e } = await db().rpc("get_funding_position", { p_project_id: pid });
    if (e) {
      setError(e.message ?? "error");
      return;
    }
    setError(null);
    const n = (k: string) => Number((j as any)?.[k]) || 0;
    setData({
      funding: n("funding"),
      funding_expected: n("funding_expected"),
      paid: n("paid"),
      vat_paid: n("vat_paid"),
      vat_recovered: n("vat_recovered"),
      wht_remitted: n("wht_remitted"),
      paid_from_bank: n("paid_from_bank"),
      paid_not_from_bank: n("paid_not_from_bank"),
      petty_cash_issued: n("petty_cash_issued"),
      petty_cash_returned: n("petty_cash_returned"),
      bank_charges: n("bank_charges"),
      cash_on_hand: n("cash_on_hand"),
      petty_cash: n("petty_cash"),
      cash_balance: n("cash_balance"),
      upcoming: n("upcoming"),
      upcoming_invoices: n("upcoming_invoices"),
      upcoming_instalments: n("upcoming_instalments"),
      expected_balance: n("expected_balance"),
      actual: n("actual"),
      commitment: n("commitment"),
      payable: n("payable"),
      has_funding: !!(j as any)?.has_funding,
      overdrawn: !!(j as any)?.overdrawn,
      payments_exceed_funding: !!(j as any)?.payments_exceed_funding,
    });
  }, [pid]);
  useEffect(() => {
    void load();
    const h = () => void load();
    window.addEventListener("funding:changed", h);
    window.addEventListener("funding-vat:changed", h);
    if (!pid) return;
    let ch = supabase.channel(`funding-position-${pid}`);
    for (const table of [
      "payments",
      "invoices",
      "payroll",
      "project_funding",
      "treasury_movements",
      "cash_advances",
      "cash_advance_receipts",
    ] as const) {
      ch = ch.on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table, filter: `project_id=eq.${pid}` },
        h,
      );
    }
    ch.subscribe();
    return () => {
      window.removeEventListener("funding:changed", h);
      window.removeEventListener("funding-vat:changed", h);
      supabase.removeChannel(ch);
    };
  }, [load, pid]);
  return { data, error, reload: load };
}
