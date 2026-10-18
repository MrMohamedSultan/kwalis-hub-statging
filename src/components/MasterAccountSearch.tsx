import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  HEADER_ACCOUNTS,
  MAIN_ACCOUNTS,
  MACRO_CATEGORY_BY_HEADER,
  MACRO_CATEGORIES,
  type MacroCategory,
} from "@/lib/data";

type Row = {
  code: string;
  name: string;
  headerCode: string;
  headerName: string;
  macro: MacroCategory;
  isHeader: boolean;
};

/**
 * Fast, dependency-free search across the full 1,230-code master budget
 * catalog. Matches by exact/partial code (e.g. "1402") or account name
 * (e.g. "SECONDARY ROLES"). Highlights matching substring.
 */
export function MasterAccountSearch({
  onPick,
  compact = false,
}: {
  onPick?: (row: { code: string; name: string; headerCode: string }) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  const [q, setQ] = useState("");
  const [macro, setMacro] = useState<MacroCategory | "All">("All");

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const h of HEADER_ACCOUNTS) {
      out.push({
        code: h.code,
        name: h.name,
        headerCode: h.code,
        headerName: h.name,
        macro: h.group,
        isHeader: true,
      });
      const subs = MAIN_ACCOUNTS[h.code] ?? [];
      for (const s of subs) {
        out.push({
          code: s.code,
          name: s.name,
          headerCode: h.code,
          headerName: h.name,
          macro: MACRO_CATEGORY_BY_HEADER[h.code] ?? h.group,
          isHeader: false,
        });
      }
    }
    return out;
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (macro !== "All") list = list.filter((r) => r.macro === macro);
    if (!needle) return list.slice(0, 50);
    const matched = list.filter(
      (r) => r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle),
    );
    // Rank exact-code prefix matches first.
    matched.sort((a, b) => {
      const aExact =
        a.code.toLowerCase() === needle ? 0 : a.code.toLowerCase().startsWith(needle) ? 1 : 2;
      const bExact =
        b.code.toLowerCase() === needle ? 0 : b.code.toLowerCase().startsWith(needle) ? 1 : 2;
      if (aExact !== bExact) return aExact - bExact;
      return a.code.localeCompare(b.code);
    });
    return matched.slice(0, 200);
  }, [q, macro, rows]);

  return (
    <div className={"rounded-xl border border-border bg-card/70 " + (compact ? "p-3" : "p-4 mb-4")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("masteraccountsearch.search_all_1230_accounts_try_1402_or_secondary")}
            className="w-full ps-9 pe-9 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label={t("masteraccountsearch.search_master_budget_accounts")}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select
          value={macro}
          onChange={(e) => setMacro(e.target.value as MacroCategory | "All")}
          className="py-2 px-3 rounded-lg bg-background border border-border text-sm text-foreground"
          aria-label={t("masteraccountsearch.filter_by_category")}
        >
          <option value="All">All categories</option>
          {MACRO_CATEGORIES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground tabular-nums">
          {filtered.length.toLocaleString()} match{filtered.length === 1 ? "" : "es"}
        </span>
      </div>

      {(q || macro !== "All") && (
        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground sticky top-0">
              <tr>
                <th className="text-start px-3 py-2 w-24">Code</th>
                <th className="text-start px-3 py-2">Name</th>
                <th className="text-start px-3 py-2 w-32">Header</th>
                <th className="text-start px-3 py-2 w-20">Group</th>
                {onPick && <th className="w-16" />}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={onPick ? 5 : 4}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    {t("masteraccountsearch.no_matching_account")}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.code + ":" + r.headerCode}
                    className={
                      "border-t border-border/50 " +
                      (r.isHeader ? "bg-primary/5 font-medium" : "hover:bg-muted/40")
                    }
                  >
                    <td className="px-3 py-1.5 tabular-nums font-mono text-xs">
                      <Highlight text={r.code} match={q} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Highlight text={r.name} match={q} />
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {r.isHeader ? "—" : `${r.headerCode} ${r.headerName}`}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-muted text-foreground/80">
                        {r.macro}
                      </span>
                    </td>
                    {onPick && (
                      <td className="px-2 py-1.5 text-end">
                        <button
                          type="button"
                          onClick={() =>
                            onPick({ code: r.code, name: r.name, headerCode: r.headerCode })
                          }
                          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
                        >
                          Use
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Highlight({ text, match }: { text: string; match: string }) {
  const needle = match.trim();
  if (!needle) return <>{text}</>;
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-warning/70 dark:bg-warning/30 text-inherit rounded px-0.5">
        {text.slice(i, i + needle.length)}
      </mark>
      {text.slice(i + needle.length)}
    </>
  );
}
