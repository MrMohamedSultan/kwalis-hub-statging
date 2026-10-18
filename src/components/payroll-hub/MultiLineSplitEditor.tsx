import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { formatMoney, useContractSplits, useScope, type ContractSplit } from "@/lib/payroll-hub";

import { useTranslation } from "react-i18next";
type Draft = {
  id?: string;
  budget_line_id: string | null;
  budget_code: string | null;
  split_kind: "percent" | "amount";
  percent: number;
  amount: number;
  notes: string | null;
};

/**
 * Reusable editor to allocate a single contract across multiple budget lines.
 * Persists rows to `contract_budget_splits` under RLS.
 */
export function MultiLineSplitEditor({
  personId,
  crewMemberId,
  totalAmount,
  currency = "USD",
}: {
  personId?: string | null;
  crewMemberId?: string | null;
  totalAmount: number;
  currency?: string;
}) {
  const { t } = useTranslation();

  const { projectId, organizationId } = useScope();
  const budgetLines = useStore((s) => s.budget);
  const { rows, refresh } = useContractSplits({ personId, crewMemberId });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDrafts(rows.map(toDraft));
  }, [rows]);

  const projectLines = useMemo(
    () =>
      budgetLines
        .filter(
          (l: { projectId?: string | null; excluded?: boolean }) =>
            l.projectId === projectId && !l.excluded,
        )
        .map((l: { id: string; mainCode: string; headerCode: string; description: string }) => ({
          id: l.id,
          code: l.mainCode || l.headerCode,
          label: `${l.mainCode || l.headerCode} — ${l.description}`,
        })),
    [budgetLines, projectId],
  );

  const totals = useMemo(() => {
    const pct = drafts
      .filter((d) => d.split_kind === "percent")
      .reduce((a, d) => a + Number(d.percent || 0), 0);
    const amt = drafts
      .filter((d) => d.split_kind === "amount")
      .reduce((a, d) => a + Number(d.amount || 0), 0);
    const derivedFromPct = (pct / 100) * totalAmount;
    return { pct, amt, allocated: amt + derivedFromPct };
  }, [drafts, totalAmount]);

  const validation = useMemo(() => {
    const rowErrors: (string | null)[] = drafts.map((d) => {
      if (!d.budget_line_id) return "Pick a budget line";
      if (d.split_kind === "percent") {
        if (d.percent <= 0) return "Percent must be > 0";
        if (d.percent > 100) return "Percent cannot exceed 100";
      } else {
        if (d.amount <= 0) return "Amount must be > 0";
      }
      return null;
    });
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    drafts.forEach((d) => {
      if (!d.budget_line_id) return;
      if (seen.has(d.budget_line_id)) duplicates.add(d.budget_line_id);
      seen.add(d.budget_line_id);
    });
    const errors: string[] = [];
    if (totalAmount <= 0) errors.push("Contract total is zero — nothing to allocate.");
    if (totals.pct > 100.01) errors.push(`Percent total is ${totals.pct.toFixed(2)}% (max 100%).`);
    if (totals.allocated - totalAmount > 0.01)
      errors.push(
        `Allocation ${formatMoney(totals.allocated, currency)} exceeds contract ${formatMoney(totalAmount, currency)}.`,
      );
    if (duplicates.size > 0)
      errors.push("Duplicate budget lines — merge them or pick different codes.");
    const rowErrCount = rowErrors.filter(Boolean).length;
    if (rowErrCount > 0) errors.push(`${rowErrCount} row(s) need attention.`);
    const underAllocated =
      drafts.length > 0 && totalAmount - totals.allocated > 0.01
        ? totalAmount - totals.allocated
        : 0;
    return {
      rowErrors,
      errors,
      underAllocated,
      valid: errors.length === 0,
    };
  }, [drafts, totals, totalAmount, currency]);

  const addRow = () =>
    setDrafts((d) => [
      ...d,
      {
        budget_line_id: null,
        budget_code: null,
        split_kind: "percent",
        percent: 0,
        amount: 0,
        notes: null,
      },
    ]);

  const removeRow = (idx: number) => setDrafts((d) => d.filter((_, i) => i !== idx));

  const patchRow = (idx: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!projectId) {
      toast.error("Select a project first");
      return;
    }
    if (!personId && !crewMemberId) {
      toast.error(t("multilinespliteditor.attach_to_a_person_or_crew_member_first"));
      return;
    }
    if (drafts.length > 0 && !validation.valid) {
      toast.error(validation.errors[0] ?? "Fix validation errors before saving");
      return;
    }

    setBusy(true);
    // Delete existing rows for this contract-scope, then insert the current drafts.
    let del = supabase.from("contract_budget_splits").delete().eq("project_id", projectId);
    if (personId) del = del.eq("person_id", personId);
    if (crewMemberId) del = del.eq("crew_member_id", crewMemberId);
    const { error: e1 } = await del;
    if (e1) {
      setBusy(false);
      toast.error(e1.message);
      return;
    }

    if (drafts.length > 0) {
      const inserts = drafts.map((d) => ({
        organization_id: organizationId,
        project_id: projectId,
        person_id: personId ?? null,
        crew_member_id: crewMemberId ?? null,
        budget_line_id: d.budget_line_id,
        budget_code: d.budget_code,
        split_kind: d.split_kind,
        percent: d.split_kind === "percent" ? d.percent : null,
        amount: d.split_kind === "amount" ? d.amount : null,
        notes: d.notes,
        currency,
      }));
      const { error: e2 } = await supabase.from("contract_budget_splits").insert(inserts);
      if (e2) {
        setBusy(false);
        toast.error(e2.message);
        return;
      }
    }

    setBusy(false);
    toast.success(t("multilinespliteditor.budget_splits_saved"));
    refresh();
  };

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">
            {t("multilinespliteditor.multiline_budget_split")}
          </h4>
          <p className="text-[11px] text-muted-foreground">
            Allocate this contract's{" "}
            <span className="text-foreground font-medium">
              {formatMoney(totalAmount, currency)}
            </span>{" "}
            across one or more budget lines.
          </p>
        </div>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-[11px] hover:bg-muted"
        >
          <Plus className="size-3" />
          {t("multilinespliteditor.add_split")}
        </button>
      </div>

      {drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No splits yet — the contract will post to its default budget code.
        </p>
      ) : (
        <div className="overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-surface">
              <tr>
                <th className="text-left py-1.5 px-2">{t("multilinespliteditor.budget_line")}</th>
                <th className="text-left py-1.5 px-2">Type</th>
                <th className="text-right py-1.5 px-2">%</th>
                <th className="text-right py-1.5 px-2">Amount</th>
                <th className="text-right py-1.5 px-2">Effective</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {drafts.map((row, idx) => {
                const eff =
                  row.split_kind === "percent" ? (row.percent / 100) * totalAmount : row.amount;
                return (
                  <tr
                    key={idx}
                    className={`border-t border-border ${validation.rowErrors[idx] ? "bg-destructive/5" : ""}`}
                  >
                    <td className="py-1 px-2">
                      <select
                        value={row.budget_line_id ?? ""}
                        onChange={(e) => {
                          const bl = projectLines.find((b) => b.id === e.target.value);
                          patchRow(idx, {
                            budget_line_id: bl?.id ?? null,
                            budget_code: bl?.code ?? null,
                          });
                        }}
                        className={`w-full rounded border bg-surface-2 px-1.5 py-0.5 ${
                          validation.rowErrors[idx] && !row.budget_line_id
                            ? "border-destructive/60"
                            : "border-border"
                        }`}
                      >
                        <option value="">— select —</option>
                        {projectLines.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                      {validation.rowErrors[idx] ? (
                        <div className="text-[10px] text-destructive mt-0.5">
                          {validation.rowErrors[idx]}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-1 px-2">
                      <select
                        value={row.split_kind}
                        onChange={(e) =>
                          patchRow(idx, {
                            split_kind: e.target.value as "percent" | "amount",
                          })
                        }
                        className="rounded border border-border bg-surface-2 px-1.5 py-0.5"
                      >
                        <option value="percent">%</option>
                        <option value="amount">Amount</option>
                      </select>
                    </td>
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        step="0.01"
                        disabled={row.split_kind !== "percent"}
                        value={row.percent}
                        onChange={(e) =>
                          patchRow(idx, {
                            percent: Number(e.target.value) || 0,
                          })
                        }
                        className="w-20 text-right rounded border border-border bg-surface-2 px-1.5 py-0.5 disabled:opacity-40"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        step="0.01"
                        disabled={row.split_kind !== "amount"}
                        value={row.amount}
                        onChange={(e) =>
                          patchRow(idx, {
                            amount: Number(e.target.value) || 0,
                          })
                        }
                        className="w-24 text-right rounded border border-border bg-surface-2 px-1.5 py-0.5 disabled:opacity-40"
                      />
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums font-medium">
                      {formatMoney(eff, currency)}
                    </td>
                    <td className="py-1 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="p-1 rounded-md hover:bg-destructive/20 text-destructive"
                        aria-label={t("multilinespliteditor.remove_split")}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-border">
              <tr>
                <td colSpan={4} className="py-1.5 px-2 text-right text-muted-foreground">
                  Allocated
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums font-semibold">
                  {formatMoney(totals.allocated, currency)}{" "}
                  <span className="text-muted-foreground font-normal">
                    /{formatMoney(totalAmount, currency)}
                  </span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {drafts.length > 0 && (
        <div
          className={`rounded-lg border px-2.5 py-1.5 text-[11px] flex items-start gap-2 ${
            validation.valid
              ? "border-success/30 bg-success/5 text-success"
              : "border-destructive/40 bg-destructive/5 text-destructive"
          }`}
        >
          {validation.valid ? (
            <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            {validation.valid ? (
              validation.underAllocated > 0 ? (
                <span>
                  Under-allocated by{" "}
                  <span className="font-semibold">
                    {formatMoney(validation.underAllocated, currency)}
                  </span>{" "}
                  — the remainder will post to the contract's default code.
                </span>
              ) : (
                <span>Allocation balanced — ready to save.</span>
              )
            ) : (
              <ul className="list-disc pl-4 space-y-0.5">
                {validation.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          type="button"
          disabled={busy || (drafts.length > 0 && !validation.valid)}
          onClick={save}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 disabled:opacity-50"
        >
          <Save className="size-3.5" />
          {t("multilinespliteditor.save_splits")}
        </button>
      </div>
    </div>
  );
}

function toDraft(r: ContractSplit): Draft {
  return {
    id: r.id,
    budget_line_id: r.budget_line_id,
    budget_code: r.budget_code,
    split_kind: (r.split_kind as "percent" | "amount") ?? "percent",
    percent: Number(r.percent ?? 0),
    amount: Number(r.amount ?? 0),
    notes: r.notes,
  };
}
