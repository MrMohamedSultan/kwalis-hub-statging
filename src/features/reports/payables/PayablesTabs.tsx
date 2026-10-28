// Registration of the payables report tabs on the Reports page (N05–N08).
import { ApAgingReport } from "./ApAgingReport";
import { OpenPurchaseOrdersReport } from "./OpenPurchaseOrdersReport";
import { PaymentsDueReport } from "./PaymentsDueReport";
import { PettyCashReconReport } from "./PettyCashReconReport";

export const PAYABLES_TABS = ["due", "aging", "openpo", "pettyrec"] as const;
export type PayablesTabKey = (typeof PAYABLES_TABS)[number];

export const isPayablesTab = (k: string): k is PayablesTabKey =>
  (PAYABLES_TABS as readonly string[]).includes(k);

export function PayablesTab({ tab }: { tab: PayablesTabKey }) {
  switch (tab) {
    case "due":
      return <PaymentsDueReport />;
    case "aging":
      return <ApAgingReport />;
    case "openpo":
      return <OpenPurchaseOrdersReport />;
    case "pettyrec":
      return <PettyCashReconReport />;
  }
}
