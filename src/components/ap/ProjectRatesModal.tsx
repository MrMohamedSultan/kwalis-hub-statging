import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { DateInput } from "@/components/ui/date-input";
import { humanizeDbError } from "@/lib/db-errors";
import { formatDate } from "@/lib/date-format";
import { SUPPORTED_CURRENCIES } from "@/lib/fx-settings";
import {
  FX_RATE_SOURCES,
  deleteProjectDatedRate,
  saveProjectDatedRate,
  type DatedRate,
  type FxRateSource,
} from "@/lib/fx-dated";
import { useStore } from "@/lib/store";

const inputCls =
  "w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand";

/**
 * D03 — the project's dated exchange rates (base units per 1 unit) with
 * their source. Who may add one is decided by the database (company admins
 * or Funding editors).
 */
export function ProjectRatesModal({
  projectId,
  baseCurrency,
  defaultCurrency,
  defaultDate,
  rates,
  onChanged,
  onClose,
}: {
  projectId: string;
  baseCurrency: string;
  defaultCurrency: string;
  defaultDate: string | null;
  rates: DatedRate[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const orgId = useStore((s) => s.projects.find((p) => p.id === projectId)?.organizationId ?? null);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [rateDate, setRateDate] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState<number>(0);
  const [source, setSource] = useState<FxRateSource>("sama");
  const [sourceRef, setSourceRef] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!orgId) return;
    if (!(rate > 0)) {
      toast.error(t("people.fx.rate_positive"));
      return;
    }
    setBusy(true);
    try {
      await saveProjectDatedRate(projectId, orgId, { currency, rateDate, rate, source, sourceRef });
      toast.success(t("people.fx.rate_saved", { ccy: currency, date: formatDate(rateDate) }));
      setRate(0);
      setSourceRef("");
      onChanged();
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (r: DatedRate) => {
    setBusy(true);
    try {
      await deleteProjectDatedRate(projectId, r.currency, r.rateDate);
      onChanged();
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("people.fx.rates_title")} onClose={onClose} dismissible={!busy}>
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          {t("people.fx.rates_intro", { base: baseCurrency })}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("ap.currency")}</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`mt-1 ${inputCls}`}
            >
              {SUPPORTED_CURRENCIES.filter((c) => c !== baseCurrency).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("people.fx.rate_date")}</span>
            <DateInput value={rateDate} onChange={setRateDate} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">
              {t("ap.fx_rate_to", { base: baseCurrency })}
            </span>
            <input
              type="number"
              min={0}
              step="0.000001"
              dir="ltr"
              value={rate || ""}
              onChange={(e) => setRate(Number(e.target.value) || 0)}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("people.fx.source")}</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as FxRateSource)}
              className={`mt-1 ${inputCls}`}
            >
              {FX_RATE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`people.fx.source_${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block col-span-2">
            <span className="text-xs text-muted-foreground">{t("people.fx.source_ref")}</span>
            <input
              value={sourceRef}
              maxLength={300}
              onChange={(e) => setSourceRef(e.target.value)}
              placeholder={t("people.fx.source_ref_placeholder")}
              className={`mt-1 ${inputCls}`}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="px-4 py-2 rounded-xl bg-brand text-brand-foreground font-semibold disabled:opacity-50"
        >
          {t("people.fx.add_rate")}
        </button>
        <div className="overflow-x-auto">
          <table className="app-table w-full">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-start px-2 py-1.5 text-xs">{t("ap.currency")}</th>
                <th className="text-start px-2 py-1.5 text-xs">{t("people.fx.rate_date")}</th>
                <th className="text-end px-2 py-1.5 text-xs">{t("people.fx.rate")}</th>
                <th className="text-start px-2 py-1.5 text-xs">{t("people.fx.source")}</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rates.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">
                    {t("people.fx.no_rates")}
                  </td>
                </tr>
              )}
              {rates.map((r) => (
                <tr key={`${r.currency}-${r.rateDate}`} className="border-b border-border/50">
                  <td className="px-2 py-1.5">{r.currency}</td>
                  <td className="px-2 py-1.5">{formatDate(r.rateDate)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums" dir="ltr">
                    {r.rate}
                  </td>
                  <td className="px-2 py-1.5">
                    {t(`people.fx.source_${r.source}`)}
                    {r.sourceRef && (
                      <span className="block text-[11px] text-muted-foreground truncate max-w-48">
                        {r.sourceRef}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(r)}
                      aria-label={t("people.fx.delete_rate")}
                      className="p-1 rounded-md hover:bg-muted text-muted-foreground"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
