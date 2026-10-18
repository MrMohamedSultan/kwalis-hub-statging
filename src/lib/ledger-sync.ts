// Lightweight bus that mirrors payroll_payments ledger totals into memory.
// Any add / edit / delete on the ledger updates these totals so the Top Sheet
// "Actual Paid" columns and the Cash Flow "Net Cash Available" KPI recompute
// in real time — no manual refresh required.
import { create } from "zustand";

export type LedgerKind = "cast" | "crew" | "vendor";

type Totals = { cast: number; crew: number; vendor: number };

type State = {
  paid: Totals;
  scheduled: Totals;
  setKind: (kind: LedgerKind, paid: number, scheduled: number) => void;
  reset: () => void;
};

const zero: Totals = { cast: 0, crew: 0, vendor: 0 };

export const useLedgerSync = create<State>((set) => ({
  paid: { ...zero },
  scheduled: { ...zero },
  setKind: (kind, paid, scheduled) =>
    set((s) => ({
      paid: { ...s.paid, [kind]: paid },
      scheduled: { ...s.scheduled, [kind]: scheduled },
    })),
  reset: () => set({ paid: { ...zero }, scheduled: { ...zero } }),
}));

export const ledgerPaidTotal = (s: State) => s.paid.cast + s.paid.crew + s.paid.vendor;
