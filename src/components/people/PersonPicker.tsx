import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Link2, UserRound, X } from "lucide-react";
import type { PersonProfile } from "@/lib/persons";
import { findSimilarPersons, idNumberKey, normalizeName } from "@/lib/person-match";

/**
 * E01 — the contract's person: picked from the organization's profiles
 * (search by name or ID number) instead of typing a free name. Typing a name
 * that is not in the list creates a new profile on save; look-alike names and
 * an ID number that is already on a profile are flagged with a one-click
 * "use this person".
 */
export function PersonPicker({
  persons,
  available,
  personId,
  fullName,
  idNumber,
  contractCounts,
  error,
  required,
  onTypeName,
  onPick,
  onUnlink,
}: {
  persons: PersonProfile[];
  /** false before db/pending/190: plain name input, no list. */
  available: boolean;
  personId: string | null | undefined;
  fullName: string;
  idNumber: string;
  /** contracts per profile in this project */
  contractCounts: Map<string, number>;
  error?: string;
  required?: boolean;
  onTypeName: (name: string) => void;
  onPick: (p: PersonProfile) => void;
  onUnlink: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | null>(null);
  const linked = personId ? persons.find((p) => p.id === personId) : undefined;

  const suggestions = useMemo(() => {
    if (!available) return [];
    const q = normalizeName(fullName);
    const qId = idNumberKey(fullName);
    const list = q
      ? persons.filter(
          (p) =>
            normalizeName(p.fullName).includes(q) ||
            (qId != null && (idNumberKey(p.idNumber) ?? "").includes(qId)),
        )
      : persons;
    return list.slice(0, 8);
  }, [available, persons, fullName]);

  const matches = useMemo(
    () => (available ? findSimilarPersons({ fullName, idNumber }, persons, personId ?? null) : []),
    [available, persons, fullName, idNumber, personId],
  );

  return (
    <div className="text-sm col-span-2">
      <label className="block">
        <div className="text-muted-foreground mb-1 flex items-center justify-between gap-2">
          <span>
            {t("crewcast.fullName")}
            {required && (
              <span className="text-destructive ms-1" aria-hidden>
                *
              </span>
            )}
          </span>
          {available && (
            <span className="text-[11px]">
              {linked ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <Link2 className="size-3" />
                  {t("people.linked_profile", { count: contractCounts.get(linked.id) ?? 0 })}
                </span>
              ) : (
                <span className="text-muted-foreground">{t("people.new_profile_hint")}</span>
              )}
            </span>
          )}
        </div>
        <div className="relative">
          <input
            type="text"
            value={fullName}
            maxLength={200}
            role={available ? "combobox" : undefined}
            aria-expanded={available ? open : undefined}
            aria-autocomplete="list"
            aria-invalid={!!error}
            placeholder={available ? t("people.search_placeholder") : undefined}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              blurTimer.current = window.setTimeout(() => setOpen(false), 150);
            }}
            onChange={(e) => {
              onTypeName(e.target.value);
              setOpen(true);
            }}
            className={`w-full bg-surface-2 border rounded-xl px-3 py-2 pe-9 outline-none focus:ring-2 ring-brand ${error ? "border-destructive/70" : "border-border"}`}
          />
          {linked && (
            <button
              type="button"
              onClick={onUnlink}
              title={t("people.change_person")}
              aria-label={t("people.change_person")}
              className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-muted text-muted-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
          {available && open && !linked && suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-border bg-surface shadow-lg"
            >
              {suggestions.map((p) => (
                <li key={p.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (blurTimer.current) window.clearTimeout(blurTimer.current);
                      onPick(p);
                      setOpen(false);
                    }}
                    className="w-full text-start px-3 py-2 hover:bg-muted flex items-center gap-2"
                  >
                    <UserRound className="size-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{p.fullName}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[p.idNumber, p.nationality].filter(Boolean).join(" · ") ||
                          t("people.no_id")}
                      </span>
                    </span>
                    {(contractCounts.get(p.id) ?? 0) > 0 && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {t("people.contracts_count", { count: contractCounts.get(p.id) ?? 0 })}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      {error && <div className="text-[11px] text-destructive mt-1">{error}</div>}
      {matches.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {matches.map((m) => (
            <div
              key={m.person.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${m.reason === "same_id" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10"}`}
            >
              <AlertTriangle
                className={`size-3.5 shrink-0 ${m.reason === "same_id" ? "text-destructive" : "text-warning"}`}
              />
              <span className="flex-1 min-w-0">
                {m.reason === "same_id"
                  ? t("people.warn_same_id", { name: m.person.fullName })
                  : t("people.warn_similar_name", {
                      name: m.person.fullName,
                      id: m.person.idNumber || t("people.no_id"),
                    })}
              </span>
              <button
                type="button"
                onClick={() => onPick(m.person)}
                className="shrink-0 px-2 py-1 rounded-md border border-border bg-surface hover:bg-muted font-medium"
              >
                {t("people.use_this_person")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
