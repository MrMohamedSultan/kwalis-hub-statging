import { useEffect, useState } from "react";
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
 * (B09 / E08). The rate defaults to the project rate and stays editable — the
 * Film Commission needs the SAMA rate of the transaction date.
 */
export function CurrencyFxFields({
  fx,
  currency,
  fxRate,
  onChange,
  inputCls,
}: {
  fx: FxSettings;
  currency: string;
  fxRate: number;
  onChange: (v: { currency: string; fxRate: number }) => void;
  inputCls: string;
}) {
  const { t } = useTranslation();
  const codes = [fx.baseCurrency, ...Object.keys(fx.rates).filter((c) => c !== fx.baseCurrency)];
  if (currency && !codes.includes(currency)) codes.push(currency);
  const isBase = currency === fx.baseCurrency;
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("ap.currency")}
        </span>
        <select
          value={currency}
          onChange={(e) => {
            const c = e.target.value;
            onChange({ currency: c, fxRate: rateFor(fx, c) ?? 1 });
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
          onChange={(e) => onChange({ currency, fxRate: Number(e.target.value) || 0 })}
          className={`mt-1 ${inputCls} disabled:opacity-60`}
        />
      </label>
    </div>
  );
}
