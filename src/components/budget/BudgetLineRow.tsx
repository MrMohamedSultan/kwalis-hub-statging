import { memo } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { SarAmount, CurrencySymbol } from "@/components/ui/currency";
import { formatStaticUSD } from "@/lib/format-number";
import { lineTotalSAR, lineTotalUSD, totalPeriods } from "@/lib/store";
import type { BudgetLine, BudgetCurrency, BudgetUnit } from "@/lib/store";

export type TopsheetAccountLike = { code: string; name: string; section: string };

export type LineActuals = {
  actual: number;
  committed: number;
  paid: number;
  sharedLines: number;
};

export type LinkedNames = { cast: string[]; crew: string[]; pos: string[] };

export type BreakdownFocus = "actual" | "committed" | "paid";

function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1 text-xs align-middle ${className}`}>{children}</td>;
}

function TopsheetCodeSelect({
  value,
  onChange,
  accounts,
}: {
  value: string | null | undefined;
  onChange: (code: string | null) => void;
  accounts: TopsheetAccountLike[];
}) {
  const groupable = accounts.filter((a) => a.section !== "Adjustments");
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className="bg-input border border-border rounded px-2 py-1 text-foreground text-xs outline-none max-w-[10rem]"
    >
      <option value="">— Unassigned —</option>
      {(["ATL", "Production", "Post", "Other"] as const).map((sec) => (
        <optgroup key={sec} label={sec}>
          {groupable
            .filter((a) => a.section === sec)
            .map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export type BudgetLineRowProps = {
  line: BudgetLine;
  isEdit: boolean;
  /** Only meaningful while `isEdit` is true. */
  draft: Partial<BudgetLine>;
  selected: boolean;
  actuals?: LineActuals;
  linked?: LinkedNames;
  topsheetAccounts: TopsheetAccountLike[];
  unitOptions: readonly string[];
  currencyOptions: readonly string[];
  t: (key: string, opts?: Record<string, unknown>) => string;
  onToggleSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<BudgetLine>) => void;
  onRemove: (id: string) => void;
  onStartEdit: (line: BudgetLine) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (patch: Partial<BudgetLine>) => void;
  onBreakdown: (line: BudgetLine, focus: BreakdownFocus) => void;
};

/**
 * One editable budget grid row.
 *
 * Memoised with a data-only comparator: callback identities change on every
 * parent render (the parent holds the edit draft), but their behaviour is
 * stable, so ignoring them keeps typing in one row from re-rendering the
 * other 300.
 */
function BudgetLineRowInner({
  line: l,
  isEdit,
  draft,
  selected,
  actuals: a,
  linked,
  topsheetAccounts,
  unitOptions,
  currencyOptions,
  t,
  onToggleSelect,
  onUpdate,
  onRemove,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDraftChange,
  onBreakdown,
}: BudgetLineRowProps) {
  const v = isEdit ? ({ ...l, ...draft } as BudgetLine) : l;
  const periods = totalPeriods(v);
  const setDraft = onDraftChange;

  return (
    <tr
      className={`border-b border-border ${l.excluded ? "opacity-40" : ""} ${selected ? "bg-success/5" : ""}`}
    >
      <Td className="w-10 min-w-10 max-w-10 bg-card group-hover:bg-card">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(l.id)}
          className="accent-emerald-500 size-4 cursor-pointer"
          title={t("budget.select_for_bulk_actions")}
          aria-label={t("budget.select_line_for_bulk_actions")}
        />
      </Td>
      <Td className="w-[72px] min-w-[72px] max-w-[72px] bg-card group-hover:bg-card">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!l.excluded}
            onChange={(e) => onUpdate(l.id, { excluded: !e.target.checked })}
            className="accent-brand size-4 cursor-pointer"
            title={l.excluded ? "Include in totals" : "Exclude from totals (keeps row visible)"}
          />
          <label
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-success"
            title={t("budget.rebate_eligible_qfe")}
          >
            <input
              type="checkbox"
              checked={!!l.rebateEligible}
              onChange={(e) => onUpdate(l.id, { rebateEligible: e.target.checked })}
              className="accent-emerald-500 size-3.5 cursor-pointer"
            />
            R
          </label>
        </div>
      </Td>
      <Td className="w-28 min-w-28 max-w-28 bg-card group-hover:bg-card">
        {isEdit ? (
          <input
            value={v.mainCode}
            onChange={(e) => setDraft({ mainCode: e.target.value })}
            className="bg-input border border-border rounded px-2 py-1 text-foreground w-24 outline-none"
          />
        ) : (
          <span className="font-mono">{l.mainCode}</span>
        )}
      </Td>
      <Td className="w-60 min-w-60 max-w-60 whitespace-nowrap bg-card group-hover:bg-card">
        {isEdit ? (
          <input
            value={v.description}
            onChange={(e) => setDraft({ description: e.target.value })}
            size={Math.max(20, (v.description?.length ?? 0) + 2)}
            className="bg-input border border-border rounded px-2 py-1 text-foreground w-full min-w-[220px] outline-none"
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            <span>{l.description}</span>
            {/* Linked people and actual / committed / paid are no longer shown on
                budget lines (client request): the budget stays a clean plan.
                They live in the "Budget vs Spend" tab, aggregated per code. */}
          </div>
        )}
      </Td>
      <Td className="min-w-[160px]">
        {isEdit ? (
          <input
            value={v.name ?? ""}
            onChange={(e) => setDraft({ name: e.target.value })}
            placeholder={t("budget.name")}
            className="bg-input border border-border rounded px-2 py-1 text-foreground w-full min-w-[140px] outline-none"
          />
        ) : (
          <span className="text-sm">
            {l.name || <span className="text-muted-foreground">—</span>}
          </span>
        )}
      </Td>
      <Td className="min-w-[100px]">
        {isEdit ? (
          <input
            type="number"
            min={0}
            value={v.prep ?? ""}
            placeholder="0"
            onChange={(e) => setDraft({ prep: e.target.value === "" ? 0 : +e.target.value })}
            className="bg-input border border-border rounded px-2 py-1 text-foreground w-14 outline-none"
          />
        ) : (
          l.prep || 0
        )}
      </Td>
      <Td className="min-w-[100px]">
        {isEdit ? (
          <input
            type="number"
            min={0}
            value={v.shooting ?? ""}
            placeholder="0"
            onChange={(e) => setDraft({ shooting: e.target.value === "" ? 0 : +e.target.value })}
            className="bg-input border border-border rounded px-2 py-1 text-foreground w-14 outline-none"
          />
        ) : (
          l.shooting || 0
        )}
      </Td>
      <Td className="min-w-[100px]">
        {isEdit ? (
          <input
            type="number"
            min={0}
            value={v.wrap ?? ""}
            placeholder="0"
            onChange={(e) => setDraft({ wrap: e.target.value === "" ? 0 : +e.target.value })}
            className="bg-input border border-border rounded px-2 py-1 text-foreground w-14 outline-none"
          />
        ) : (
          l.wrap || 0
        )}
      </Td>
      <Td className="min-w-[100px]">
        <span className="text-foreground">{periods}</span>
      </Td>
      <Td className="min-w-[100px]">
        {isEdit ? (
          <select
            value={v.unit}
            onChange={(e) => setDraft({ unit: e.target.value as BudgetUnit })}
            className="bg-input border border-border rounded px-2 py-1 text-foreground outline-none"
          >
            {unitOptions.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        ) : (
          l.unit
        )}
      </Td>
      <Td className="min-w-[110px]">
        {isEdit ? (
          <input
            type="number"
            value={v.amount}
            onChange={(e) => setDraft({ amount: +e.target.value || 0 })}
            className="bg-input border border-border rounded px-2 py-1 text-foreground w-16 outline-none"
          />
        ) : (
          l.amount
        )}
      </Td>
      <Td className="min-w-[100px]">
        {isEdit ? (
          <select
            value={v.currency ?? "USD"}
            onChange={(e) => setDraft({ currency: e.target.value as BudgetCurrency })}
            className="bg-input border border-border rounded px-2 py-1 text-foreground outline-none"
          >
            {currencyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-xs">{l.currency ?? "USD"}</span>
        )}
      </Td>
      <Td className="min-w-[120px]">
        {isEdit ? (
          <div className="flex items-center gap-1">
            <span className="text-foreground text-xs w-3">
              <CurrencySymbol code={(v.currency ?? "USD") as BudgetCurrency} />
            </span>
            <input
              type="number"
              value={v.rate}
              onChange={(e) => setDraft({ rate: +e.target.value || 0 })}
              className="bg-input border border-border rounded px-2 py-1 text-foreground w-20 outline-none"
            />
          </div>
        ) : (
          <span>
            <CurrencySymbol code={(l.currency ?? "USD") as BudgetCurrency} />{" "}
            {Math.round(Number(l.rate)).toLocaleString()}
          </span>
        )}
      </Td>
      <Td className="min-w-[140px] font-semibold">
        <SarAmount amount={lineTotalSAR({ ...v, excluded: false })} />
      </Td>
      <Td className="min-w-[140px] font-semibold">
        {formatStaticUSD(lineTotalUSD({ ...v, excluded: false }))}
      </Td>
      <Td className="min-w-[180px]">
        <TopsheetCodeSelect
          accounts={topsheetAccounts}
          value={v.topsheetCode}
          onChange={(code) => {
            if (isEdit) setDraft({ topsheetCode: code });
            else onUpdate(l.id, { topsheetCode: code });
          }}
        />
      </Td>
      <Td className="min-w-[180px]">
        {isEdit ? (
          <input
            value={v.notes ?? ""}
            onChange={(e) => setDraft({ notes: e.target.value })}
            className="bg-input border border-border rounded px-2 py-1 text-foreground w-40 outline-none"
          />
        ) : (
          <span
            className="text-xs text-muted-foreground truncate inline-block max-w-[10rem]"
            title={l.notes ?? ""}
          >
            {l.notes || "—"}
          </span>
        )}
      </Td>
      <Td className="min-w-[100px]">
        <div className="flex items-center gap-1">
          {isEdit ? (
            <>
              <button
                onClick={onSaveEdit}
                className="p-1.5 rounded-lg hover:bg-success/20 text-success"
                title={t("budget.save")}
              >
                <Check className="size-4" />
              </button>
              <button
                onClick={onCancelEdit}
                className="p-1.5 rounded-lg hover:bg-muted"
                title={t("budget.cancel")}
              >
                <X className="size-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onStartEdit(l)}
                className="p-1.5 rounded-lg hover:bg-muted"
                title={t("budget.edit")}
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => {
                  if (confirm(t("budget.delete_this_line"))) onRemove(l.id);
                }}
                className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive"
                title={t("budget.delete")}
              >
                <Trash2 className="size-4" />
              </button>
            </>
          )}
        </div>
      </Td>
    </tr>
  );
}

function sameActuals(a?: LineActuals, b?: LineActuals) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.actual === b.actual &&
    a.committed === b.committed &&
    a.paid === b.paid &&
    a.sharedLines === b.sharedLines
  );
}

export const BudgetLineRow = memo(BudgetLineRowInner, (prev, next) => {
  if (prev.line !== next.line) return false;
  if (prev.isEdit !== next.isEdit) return false;
  if (next.isEdit && prev.draft !== next.draft) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.linked !== next.linked) return false;
  if (prev.topsheetAccounts !== next.topsheetAccounts) return false;
  if (!sameActuals(prev.actuals, next.actuals)) return false;
  // Callbacks intentionally excluded: their identity changes every parent
  // render but their behaviour does not.
  return true;
});

export default BudgetLineRow;
