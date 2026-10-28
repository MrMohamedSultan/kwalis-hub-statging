import { useCallback, useEffect, useState } from "react";
import {
  fetchProjectDatedRates,
  pickRateFor,
  type DatedRate,
  type FxRateSource,
} from "@/lib/fx-dated";
import { ProjectRatesModal } from "@/components/ap/ProjectRatesModal";
import { useTranslation } from "react-i18next";
import {
  fetchProjectFxSettings,
  rateFor,
  type FxSettings,
  PLATFORM_FX_DEFAULTS,
} from "@/lib/fx-settings";

/** Project currency configuration (base + configured foreign currencies). */
export function useProjectFx(projectId: string | null): FxSettings {
  const [fx, setFx] = useState<FxSettings>(PLATFORM_FX_DEFAULTS);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchProjectFxSettings(projectId)
      .then((s) => {
        if (!cancelled) setFx(s.effective);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return fx;
}

/**
 * Currency selector + FX rate for a document entered in a foreign currency
 * (B09 / E08 / D03). With `projectId` + `date` the rate is taken from the
 * project's dated rates (db/pending/190 — e.g. the SAMA rate of the
 * transaction date) and its source and date are shown; without a dated rate
 * the project rate is used ("project", no date). Typing a rate by hand makes
 * it "manual" dated on the document date.
 */
export function CurrencyFxFields({
  fx,
  currency,
  fxRate,
  onChange,
  inputCls,
  projectId,
  date,
  rateSource,
  rateDate,
}: {
  fx: FxSettings;
  currency: string;
  fxRate: number;
  onChange: (v: {
    currency: string;
    fxRate: number;
    fxRateSource?: FxRateSource | null;
    fxRateDate?: string | null;
  }) => void;
  inputCls: string;
  projectId?: string | null;
  /** Document date (YYYY-MM-DD) — picks the rate in force on that day. */
  date?: string | null;
  rateSource?: FxRateSource | null;
  rateDate?: string | null;
}) {
  const { t } = useTranslation();
  const [dated, setDated] = useState<DatedRate[]>([]);
  const [manual, setManual] = useState(rateSource === "manual");
  const [showRates, setShowRates] = useState(false);
  const loadRates = useCallback(() => {
    if (!projectId) return;
    void fetchProjectDatedRates(projectId).then(setDated);
  }, [projectId]);
  useEffect(loadRates, [loadRates]);

  const codes = [fx.baseCurrency, ...Object.keys(fx.rates).filter((c) => c !== fx.baseCurrency)];
  for (const r of dated) if (!codes.includes(r.currency)) codes.push(r.currency);
  if (currency && !codes.includes(currency)) codes.push(currency);
  const isBase = currency === fx.baseCurrency;

  // follow the dated rate for the currency + date unless typed by hand
  const datedMode = !!projectId;
  useEffect(() => {
    if (!datedMode || manual) return;
    const picked = pickRateFor(dated, currency, date, fx);
    if (!picked) return;
    if (
      picked.rate !== fxRate ||
      (picked.source ?? null) !== (rateSource ?? null) ||
      (picked.rateDate ?? null) !== (rateDate ?? null)
    ) {
      onChange({
        currency,
        fxRate: picked.rate,
        fxRateSource: picked.source,
        fxRateDate: picked.rateDate,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datedMode, manual, dated, currency, date, fx]);

  const picked = datedMode && !isBase ? pickRateFor(dated, currency, date, fx) : null;
  const sourceLabel = (src: FxRateSource | null | undefined) =>
    src ? t(`people.fx.source_${src}`) : "";

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("ap.currency")}
          </span>
          <select
            value={currency}
            onChange={(e) => {
              const c = e.target.value;
              setManual(false);
              const p = datedMode ? pickRateFor(dated, c, date, fx) : null;
              onChange({
                currency: c,
                fxRate: p?.rate ?? rateFor(fx, c) ?? 1,
                fxRateSource: p ? p.source : undefined,
                fxRateDate: p ? p.rateDate : undefined,
              });
            }}
            className={`mt-1 ${inputCls}`}
          >
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("ap.fx_rate_to", { base: fx.baseCurrency })}
          </span>
          <input
            type="number"
            min={0}
            step="0.0001"
            dir="ltr"
            value={isBase ? 1 : fxRate}
            disabled={isBase}
            onChange={(e) => {
              setManual(true);
              onChange({
                currency,
                fxRate: Number(e.target.value) || 0,
                fxRateSource: datedMode ? "manual" : undefined,
                fxRateDate: datedMode ? (date ?? null) : undefined,
              });
            }}
            className={`mt-1 ${inputCls} disabled:opacity-60`}
          />
        </label>
      </div>
      {datedMode && !isBase && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {manual
              ? t("people.fx.manual_rate", { date: date || "—" })
              : picked
                ? picked.rateDate
                  ? t("people.fx.rate_from", {
                      source: sourceLabel(picked.source),
                      date: picked.rateDate,
                    })
                  : t("people.fx.project_rate_no_date")
                : t("people.fx.no_rate", { ccy: currency })}
          </span>
          {manual && (
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => setManual(false)}
            >
              {t("people.fx.use_dated_rate")}
            </button>
          )}
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => setShowRates(true)}
          >
            {t("people.fx.manage_rates")}
          </button>
        </div>
      )}
      {showRates && projectId && (
        <ProjectRatesModal
          projectId={projectId}
          baseCurrency={fx.baseCurrency}
          defaultCurrency={isBase ? "USD" : currency}
          defaultDate={date ?? null}
          rates={dated}
          onChanged={loadRates}
          onClose={() => setShowRates(false)}
        />
      )}
    </div>
  );
}
