// Registration of the double-entry ledger tabs on the Reports page.
import { BankReconciliationReport } from "./BankReconciliationReport";
import { DailyCashPositionReport } from "./DailyCashPositionReport";
import { GeneralLedgerReport } from "./GeneralLedgerReport";
import { TrialBalanceReport } from "./TrialBalanceReport";

export const LEDGER_TABS = ["ledger", "tb", "cashpos", "bankrec"] as const;
export type LedgerTabKey = (typeof LEDGER_TABS)[number];

export const isLedgerTab = (k: string): k is LedgerTabKey =>
  (LEDGER_TABS as readonly string[]).includes(k);

export function LedgerTab({ tab }: { tab: LedgerTabKey }) {
  switch (tab) {
    case "ledger":
      return <GeneralLedgerReport />;
    case "tb":
      return <TrialBalanceReport />;
    case "cashpos":
      return <DailyCashPositionReport />;
    case "bankrec":
      return <BankReconciliationReport />;
  }
}
