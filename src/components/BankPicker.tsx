import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";
import { OTHER_BANK, banksForCountry, swiftForBank } from "@/lib/banks";

import { useTranslation } from "react-i18next";
const inputCls =
  "w-full bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 ring-brand";

/**
 * Searchable country dropdown. Extracted so vendors/crew/cast share the
 * same picker without duplicating the popover code.
 */
export function CountryCombo({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return COUNTRIES;
    const q = query.toLowerCase();
    return COUNTRIES.filter((c) => c.toLowerCase().includes(q));
  }, [query]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${inputCls} text-left flex items-center justify-between`}
      >
        <span className={value ? "" : "text-muted-foreground"}>
          {value || placeholder || "Select country…"}
        </span>
        <ChevronDown className="size-4 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-surface-2 border border-border rounded-xl shadow-xl max-h-60 overflow-auto">
          <div className="sticky top-0 bg-surface-2 border-b border-border px-3 py-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("bankpicker.search_countries")}
              className="w-full bg-transparent outline-none text-sm"
            />
          </div>
          <div className="py-1">
            {filtered.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-muted text-sm"
              >
                {c}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {t("bankpicker.no_results")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Dynamic Bank Country + Bank Name + SWIFT block.
 *
 * - Changing Bank Country rebuilds the Bank Name dropdown.
 * - Picking a known bank auto-fills the SWIFT/BIC field.
 * - Picking "Other" reveals a free-text bank name and clears SWIFT (user
 *   can type SWIFT manually).
 */
export function BankPicker({
  bankCountry,
  bankName,
  swiftCode,
  onChange,
  countryLabel = "Bank Country",
  bankLabel = "Bank Name",
  swiftLabel = "SWIFT / BIC Code",
  compact = false,
  errors,
}: {
  bankCountry: string;
  bankName: string;
  swiftCode: string;
  onChange: (patch: { bankCountry?: string; bankName?: string; swiftCode?: string }) => void;
  countryLabel?: string;
  bankLabel?: string;
  swiftLabel?: string;
  compact?: boolean;
  errors?: { bankCountry?: string; bankName?: string; swiftCode?: string };
}) {
  const { t } = useTranslation();

  const banks = useMemo(() => banksForCountry(bankCountry), [bankCountry]);
  const knownMatch = banks.find(
    (b) => b.name.toLowerCase() === (bankName ?? "").trim().toLowerCase(),
  );
  const [manualMode, setManualMode] = useState<boolean>(
    !!bankName && !knownMatch && banks.length > 0,
  );

  useEffect(() => {
    if (knownMatch) {
      setManualMode(false);
    } else if (bankName && !knownMatch && banks.length > 0) {
      setManualMode(true);
    }
  }, [bankName, knownMatch, banks.length]);

  const isOther = manualMode || (!!bankName && !knownMatch && banks.length > 0);
  const selectValue = knownMatch ? knownMatch.name : isOther ? OTHER_BANK : "";

  const onSelectBank = (val: string) => {
    if (val === OTHER_BANK) {
      setManualMode(true);
      onChange({ bankName: "", swiftCode: "" });
    } else if (val === "") {
      setManualMode(false);
      onChange({ bankName: "", swiftCode: "" });
    } else {
      setManualMode(false);
      onChange({ bankName: val, swiftCode: swiftForBank(bankCountry, val) });
    }
  };

  const errCls = "border-destructive/70 focus:ring-destructive";
  const errMsg = (m?: string) =>
    m ? <div className="text-[11px] text-destructive mt-1">{m}</div> : null;

  return (
    <>
      <label className="text-sm">
        <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
          {countryLabel}
          <span className="text-destructive ms-1" aria-hidden>
            *
          </span>
        </div>
        <div className={errors?.bankCountry ? "[&_button]:!border-destructive/70" : ""}>
          <CountryCombo
            value={bankCountry}
            onChange={(c) => {
              setManualMode(false);
              onChange({ bankCountry: c, bankName: "", swiftCode: "" });
            }}
            placeholder="Select country…"
          />
        </div>
        {errMsg(errors?.bankCountry)}
      </label>

      <label className="text-sm">
        <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
          {bankLabel}
          <span className="text-destructive ms-1" aria-hidden>
            *
          </span>
        </div>
        {banks.length === 0 ? (
          <input
            value={bankName}
            onChange={(e) => onChange({ bankName: e.target.value })}
            placeholder={bankCountry ? "Type bank name" : "Select bank country first"}
            className={`${inputCls} ${errors?.bankName ? errCls : ""}`}
            disabled={!bankCountry}
            aria-invalid={!!errors?.bankName}
          />
        ) : (
          <select
            value={selectValue}
            onChange={(e) => onSelectBank(e.target.value)}
            className={`${inputCls} ${errors?.bankName ? errCls : ""}`}
            aria-invalid={!!errors?.bankName}
          >
            <option value="">— Select bank —</option>
            {banks.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
            <option value={OTHER_BANK}>Other (Write manually)…</option>
          </select>
        )}
        {isOther && (
          <input
            value={bankName}
            onChange={(e) => onChange({ bankName: e.target.value })}
            placeholder={t("bankpicker.enter_bank_name")}
            className={`${inputCls} mt-2 ${errors?.bankName ? errCls : ""}`}
            aria-invalid={!!errors?.bankName}
          />
        )}
        {errMsg(errors?.bankName)}
      </label>

      {!compact && (
        <label className="text-sm">
          <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
            {swiftLabel}
          </div>
          <input
            value={swiftCode}
            onChange={(e) => onChange({ swiftCode: e.target.value.toUpperCase() })}
            placeholder={knownMatch ? "Auto-filled" : "Enter SWIFT / BIC"}
            className={`${inputCls} font-mono ${errors?.swiftCode ? errCls : ""}`}
            aria-invalid={!!errors?.swiftCode}
          />
          {knownMatch && knownMatch.swift && (
            <div className="text-[10px] text-muted-foreground mt-1">
              {t("bankpicker.autofilled_from_directory_you_can_override_if_needed")}
            </div>
          )}
          {errMsg(errors?.swiftCode)}
        </label>
      )}
    </>
  );
}

/**
 * Shared validator used by any form embedding <BankPicker />. Returns an
 * errors object suitable for feeding straight back into the `errors` prop.
 * The "Other" bank flow is validated here: if the country has a preset
 * directory and the user did not pick a preset, `bankName` MUST be a
 * non-empty manual value.
 */
export function validateBankPicker(
  values: { bankCountry: string; bankName: string; swiftCode?: string },
  opts: { requireCountry?: boolean; requireBank?: boolean } = {},
): { bankCountry?: string; bankName?: string } {
  const errs: { bankCountry?: string; bankName?: string } = {};
  const requireCountry = opts.requireCountry ?? true;
  const requireBank = opts.requireBank ?? true;
  if (requireCountry && !values.bankCountry?.trim()) {
    errs.bankCountry = "Bank Country is required.";
  }
  if (requireBank) {
    const name = (values.bankName ?? "").trim();
    if (!name) {
      errs.bankName = "Bank Name is required.";
    }
  }
  return errs;
}
