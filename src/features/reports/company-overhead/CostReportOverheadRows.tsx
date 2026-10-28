// R11: two rows under the Cost Report total —
//   Company Overhead (unbudgeted)   overhead lines without a budget line
//   True cost = EFC + Overhead      EFC + the unbudgeted overhead
// Amounts in the display currency, like the Cost Report table.
// Rendered by CostReportPanel after its table (one-line hook-in, so the
// panel's own columns stay untouched).
import { useTranslation } from "react-i18next";
import { formatUSD, useStore } from "@/lib/store";
import { trueCost } from "./overhead-calc";
import { useCompanyOverheadTotals } from "./overhead-data";

export function CostReportOverheadRows({ efc }: { efc: number }) {
  const { t } = useTranslation();
  const projectId = useStore((s) => s.activeProjectId);
  const oh = useCompanyOverheadTotals(projectId);
  if (!oh || oh.total === 0) return null;
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-border">
            <td className="px-3 py-2">
              {t("taxlive.oh.costRow")}
              <div className="text-xs text-muted-foreground">{t("taxlive.oh.costRowHint")}</div>
            </td>
            <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
              {formatUSD(oh.unbudgeted)}
            </td>
          </tr>
          <tr className="bg-surface-2 font-semibold">
            <td className="px-3 py-2">{t("taxlive.oh.trueCost")}</td>
            <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
              {formatUSD(trueCost(efc, oh.unbudgeted))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default CostReportOverheadRows;
