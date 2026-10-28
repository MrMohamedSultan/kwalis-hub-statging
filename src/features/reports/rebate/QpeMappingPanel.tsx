// E12 — budget code → Film Commission QPE category or non-eligibility
// reason. The system suggests (suggest_qpe_mapping / on budget upload),
// the accountant approves here (set_qpe_mapping). An approved code that
// changes needs a reason; every change is in the change log.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatAmount } from "@/lib/format-number";
import { humanizeDbError } from "@/lib/db-errors";
import { setQpeMapping, suggestQpeMapping, useInvalidateRebate } from "./rebate-data";
import {
  INELIGIBLE_REASONS,
  QPE_CATEGORIES,
  type IneligibleReason,
  type MappingRow,
  type QpeCategory,
} from "./rebate-types";
import { EmptyRow, TableShell, tdCls, tdNumCls, thCls, thNumCls } from "./rebate-ui";

/** Select value: "cat:<code>" or "no:<reason>". */
const encode = (r: Pick<MappingRow, "qpe_category" | "ineligible_reason">) =>
  r.qpe_category ? `cat:${r.qpe_category}` : r.ineligible_reason ? `no:${r.ineligible_reason}` : "";
const decode = (v: string): { category: QpeCategory | null; reason: IneligibleReason | null } =>
  v.startsWith("cat:")
    ? { category: v.slice(4) as QpeCategory, reason: null }
    : { category: null, reason: v.slice(3) as IneligibleReason };

export function QpeMappingPanel({
  projectId,
  rows,
  canApprove,
}: {
  projectId: string;
  rows: MappingRow[];
  canApprove: boolean;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateRebate();
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const pending = rows.filter((r) => r.status !== "approved");
  const shown = useMemo(() => (onlyPending ? pending : rows), [onlyPending, pending, rows]);

  const approve = async (r: MappingRow, value: string, changeReason?: string) => {
    if (!value) return;
    const { category, reason } = decode(value);
    await setQpeMapping({
      projectId,
      code: r.code,
      category,
      reason,
      changeReason: changeReason || undefined,
    });
  };

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await invalidate();
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(null);
    }
  };

  const saveOne = (r: MappingRow) => {
    const value = draft[r.code] ?? encode(r);
    const changed = value !== encode(r);
    let changeReason: string | undefined;
    if (r.status === "approved" && changed) {
      changeReason = window.prompt(t("rebate.map.change_reason_prompt"))?.trim();
      if (!changeReason || changeReason.length < 5) {
        toast.error(t("rebate.map.change_reason_required"));
        return;
      }
    }
    void run(
      r.code,
      () => approve(r, value, changeReason),
      t("rebate.map.saved", { code: r.code }),
    );
  };

  const approveAll = () =>
    run(
      "all",
      async () => {
        for (const r of pending) await approve(r, draft[r.code] ?? encode(r));
      },
      t("rebate.map.all_saved", { count: pending.length }),
    );

  const select =
    "w-full min-w-[12rem] rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand/40";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">{t("rebate.map.title")}</h4>
          <p className="text-xs text-muted-foreground">
            {t("rebate.map.hint", { approved: rows.length - pending.length, total: rows.length })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(e) => setOnlyPending(e.target.checked)}
            />
            {t("rebate.map.only_pending")}
          </label>
          {canApprove && (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run("suggest", () => suggestQpeMapping(projectId), t("rebate.map.suggested"))
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-40"
              >
                {busy === "suggest" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {t("rebate.map.suggest")}
              </button>
              <button
                type="button"
                disabled={busy !== null || pending.length === 0}
                onClick={approveAll}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-40"
              >
                {busy === "all" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="size-3.5" />
                )}
                {t("rebate.map.approve_all", { count: pending.length })}
              </button>
            </>
          )}
        </div>
      </div>
      <TableShell>
        <thead className="bg-surface-2/60">
          <tr>
            <th className={thCls}>{t("rebate.col.budget_code")}</th>
            <th className={thCls}>{t("rebate.col.group")}</th>
            <th className={thNumCls}>{t("rebate.col.budget_total")}</th>
            <th className={thCls}>{t("rebate.map.mapping")}</th>
            <th className={thCls}>{t("rebate.col.status")}</th>
            {canApprove && <th className={thCls} />}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && <EmptyRow cols={canApprove ? 6 : 5} text={t("rebate.map.none")} />}
          {shown.map((r) => {
            const value = draft[r.code] ?? encode(r);
            return (
              <tr key={r.code} className="border-t border-border">
                <td className={tdCls}>
                  <div className="font-medium">{r.code}</div>
                  <div className="text-xs text-muted-foreground">{r.description}</div>
                </td>
                <td className={tdCls}>{t(`rebate.group.${r.group}`)}</td>
                <td className={tdNumCls}>{formatAmount(r.budget, 2)}</td>
                <td className={tdCls}>
                  {canApprove ? (
                    <select
                      value={value}
                      onChange={(e) => setDraft((p) => ({ ...p, [r.code]: e.target.value }))}
                      className={select}
                    >
                      <optgroup label={t("rebate.map.eligible_group")}>
                        {QPE_CATEGORIES.map((c) => (
                          <option key={c} value={`cat:${c}`}>
                            {t(`rebate.cat.${c}`)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={t("rebate.map.not_eligible_group")}>
                        {INELIGIBLE_REASONS.map((c) => (
                          <option key={c} value={`no:${c}`}>
                            {t(`rebate.reason.${c}`)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  ) : r.qpe_category ? (
                    t(`rebate.cat.${r.qpe_category}`)
                  ) : (
                    t(`rebate.reason.${r.ineligible_reason}`)
                  )}
                  {r.basis && r.status !== "approved" && (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {t("rebate.map.basis")}: {r.basis}
                    </div>
                  )}
                </td>
                <td className={tdCls}>
                  <span
                    className={`text-xs font-semibold ${r.status === "approved" ? "text-success" : "text-warning"}`}
                  >
                    {t(`rebate.mapping_status.${r.status}`)}
                  </span>
                  {r.approved_by_name && (
                    <div className="text-[10px] text-muted-foreground">{r.approved_by_name}</div>
                  )}
                </td>
                {canApprove && (
                  <td className={tdCls}>
                    <button
                      type="button"
                      disabled={busy !== null || !value}
                      onClick={() => saveOne(r)}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-40"
                    >
                      {busy === r.code ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        t("rebate.map.approve")
                      )}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </TableShell>
    </div>
  );
}
