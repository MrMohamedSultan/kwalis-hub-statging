import { useEffect, useMemo, useState } from "react";
import { Coins, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  PLATFORM_FX_DEFAULTS,
  SUPPORTED_CURRENCIES,
  fetchOrgFxSettings,
  fetchProjectFxSettings,
  saveOrgFxSettings,
  saveProjectFxSettings,
  type FxSettings,
} from "@/lib/fx-settings";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

/**
 * Controlled editor for a base currency plus its full FX matrix.
 * Shared by the platform hub, company (tenant) settings and project settings
 * so all three levels expose the exact same capabilities.
 */
export function CurrencyFxMatrix({
  value,
  onChange,
  disabled = false,
}: {
  value: FxSettings;
  onChange: (next: FxSettings) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const [newCode, setNewCode] = useState("");

  const rows = useMemo(
    () => Object.entries(value.rates).sort(([a], [b]) => a.localeCompare(b)),
    [value.rates],
  );

  const available = SUPPORTED_CURRENCIES.filter(
    (c) => c !== value.baseCurrency && !(c in value.rates),
  );

  function setBase(base: string) {
    const next = { ...value.rates };
    delete next[base];
    onChange({ baseCurrency: base, rates: next });
  }

  function setRate(code: string, raw: string) {
    onChange({ ...value, rates: { ...value.rates, [code]: Number(raw) } });
  }

  function removeRow(code: string) {
    const next = { ...value.rates };
    delete next[code];
    onChange({ ...value, rates: next });
  }

  function addRow() {
    const code = newCode.trim().toUpperCase();
    if (!code) return;
    if (code === value.baseCurrency) {
      toast.error(t("currencyfxsettings.the_base_currency_is_always_1_it_cannot"));
      return;
    }
    if (code in value.rates) {
      toast.error(`${code} is already in the matrix.`);
      return;
    }
    onChange({ ...value, rates: { ...value.rates, [code]: 1 } });
    setNewCode("");
  }

  return (
    <div className="space-y-4">
      <label className="block max-w-xs">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Base currency
        </span>
        <select
          value={value.baseCurrency}
          disabled={disabled}
          onChange={(e) => setBase(e.target.value)}
          className={`${inputCls} disabled:opacity-60`}
        >
          {Array.from(new Set([value.baseCurrency, ...SUPPORTED_CURRENCIES])).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-semibold">Currency</th>
              <th className="px-3 py-2 text-start font-semibold">
                Rate → 1 unit in {value.baseCurrency}
              </th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border bg-surface-2/40">
              <td className="px-3 py-2 font-semibold">{value.baseCurrency}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">1.0000 (base)</td>
              <td />
            </tr>
            {rows.map(([code, rate]) => (
              <tr key={code} className="border-t border-border">
                <td className="px-3 py-2 font-semibold">{code}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    step={0.0001}
                    dir="ltr"
                    disabled={disabled}
                    value={Number.isFinite(rate) ? rate : ""}
                    onChange={(e) => setRate(code, e.target.value)}
                    className={`${inputCls} max-w-[180px] tabular-nums disabled:opacity-60`}
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeRow(code)}
                    aria-label={`Remove ${code}`}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr className="border-t border-border">
                <td colSpan={3} className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("currencyfxsettings.no_secondary_currencies_configured_yet")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          list="fx-currency-options"
          value={newCode}
          disabled={disabled}
          onChange={(e) => setNewCode(e.target.value.toUpperCase())}
          placeholder={t("currencyfxsettings.add_currency_eg_gbp")}
          maxLength={6}
          className={`${inputCls} max-w-[200px] uppercase disabled:opacity-60`}
        />
        <datalist id="fx-currency-options">
          {available.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button
          type="button"
          disabled={disabled || !newCode.trim()}
          onClick={addRow}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          {t("currencyfxsettings.add_currency")}
        </button>
      </div>
    </div>
  );
}

/** Company (tenant) level configuration. */
export function OrganizationCurrencyPanel({
  organizationId,
  canEdit = true,
}: {
  organizationId: string | null;
  canEdit?: boolean;
}) {
  const { t } = useTranslation();

  const [settings, setSettings] = useState<FxSettings>(PLATFORM_FX_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchOrgFxSettings(organizationId).then((s) => {
      if (!cancelled) {
        setSettings(s);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function save() {
    if (!organizationId) return;
    setSaving(true);
    try {
      await saveOrgFxSettings(organizationId, settings);
      toast.success(t("currencyfxsettings.company_currency_settings_saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save currency settings");
    } finally {
      setSaving(false);
    }
  }

  if (!organizationId) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("currencyfxsettings.select_a_company_to_configure_its_currency_and")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="size-4 text-brand" />
        <h2 className="text-base font-semibold">Currency &amp; FX Rates</h2>
      </div>
      <p className="-mt-2 text-sm text-muted-foreground">
        Company-wide base currency and exchange rates. Every project inherits these values unless it
        defines its own override.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <CurrencyFxMatrix value={settings} onChange={setSettings} disabled={!canEdit || saving} />
          {canEdit && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setSettings({ ...PLATFORM_FX_DEFAULTS, rates: { ...PLATFORM_FX_DEFAULTS.rates } })
                }
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" /> Reset defaults
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />} Save currency settings
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Project level configuration — inherits the company matrix by default. */
export function ProjectCurrencyPanel({
  projectId,
  canEdit = true,
  onSaved,
}: {
  projectId: string | null;
  canEdit?: boolean;
  onSaved?: (usdRate: number | null) => void;
}) {
  const { t } = useTranslation();

  const [orgSettings, setOrgSettings] = useState<FxSettings>(PLATFORM_FX_DEFAULTS);
  const [override, setOverride] = useState<FxSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchProjectFxSettings(projectId).then((s) => {
      if (cancelled) return;
      setOrgSettings(s.organization);
      setOverride(s.override);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function save() {
    if (!projectId) return;
    setSaving(true);
    try {
      const usd = await saveProjectFxSettings(projectId, override);
      onSaved?.(usd);
      toast.success(
        override
          ? "Project currency override saved"
          : "Project now inherits company currency settings",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save currency settings");
    } finally {
      setSaving(false);
    }
  }

  if (!projectId) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("currencyfxsettings.select_a_project_to_configure_its_currencies")}
      </p>
    );
  }

  const inherits = override === null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="size-4 text-brand" />
        <h2 className="text-base font-semibold">Currency &amp; FX Rates</h2>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <label className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/50 p-3">
            <input
              type="checkbox"
              checked={inherits}
              disabled={!canEdit || saving}
              onChange={(e) =>
                setOverride(
                  e.target.checked
                    ? null
                    : { baseCurrency: orgSettings.baseCurrency, rates: { ...orgSettings.rates } },
                )
              }
              className="mt-0.5 size-4 accent-[var(--color-brand)]"
            />
            <span className="text-sm">
              <span className="font-medium">
                {t("currencyfxsettings.inherit_company_settings")}
              </span>
              <span className="block text-xs text-muted-foreground">
                Base {orgSettings.baseCurrency} ·{" "}
                {Object.entries(orgSettings.rates)
                  .map(([c, r]) => `${c} ${r}`)
                  .join(" · ") || "no secondary currencies"}
              </span>
            </span>
          </label>

          {!inherits && override && (
            <CurrencyFxMatrix
              value={override}
              onChange={setOverride}
              disabled={!canEdit || saving}
            />
          )}

          {canEdit && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />} Save currency settings
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
