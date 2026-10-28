// E12 — override the eligibility of ONE transaction, with a mandatory
// reason (set_qpe_override / clear_qpe_override). Audited in the database.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { humanizeDbError } from "@/lib/db-errors";
import { clearQpeOverride, setQpeOverride, useInvalidateRebate } from "./rebate-data";
import {
  INELIGIBLE_REASONS,
  QPE_CATEGORIES,
  type EligibilityLogRow,
  type IneligibleReason,
  type QpeCategory,
} from "./rebate-types";

export function QpeOverrideDialog({
  projectId,
  row,
  onClose,
}: {
  projectId: string;
  row: EligibilityLogRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateRebate();
  const hasOverride = row.rule === "override";
  const [eligible, setEligible] = useState(row.status !== "eligible");
  const [category, setCategory] = useState<QpeCategory | "">(row.qpe_category ?? "");
  const [reasonKey, setReasonKey] = useState<IneligibleReason>("other");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = reason.trim().length >= 5 && reason.length <= 1000;

  const submit = async (clear: boolean) => {
    if (!valid) return;
    setBusy(true);
    try {
      if (clear) {
        await clearQpeOverride({
          projectId,
          sourceType: row.source,
          sourceId: row.source_id,
          reason: reason.trim(),
        });
      } else {
        await setQpeOverride({
          projectId,
          sourceType: row.source,
          sourceId: row.source_id,
          eligible,
          category: eligible ? category || null : null,
          ineligibleReason: eligible ? null : reasonKey,
          reason: reason.trim(),
        });
      }
      toast.success(t("rebate.ov.saved"));
      await invalidate();
      onClose();
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(false);
    }
  };

  const select =
    "w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand/40";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("rebate.ov.title", { ref: row.ref_no ?? row.doc_no ?? row.party ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {t("rebate.ov.current", {
              status: t(`rebate.status.${row.status}`),
              reason: t(`rebate.reason.${row.reason}`, { defaultValue: row.reason }),
            })}
          </p>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" checked={eligible} onChange={() => setEligible(true)} />
              {t("rebate.status.eligible")}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!eligible} onChange={() => setEligible(false)} />
              {t("rebate.status.not_eligible")}
            </label>
          </div>
          {eligible ? (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">{t("rebate.col.category")}</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as QpeCategory | "")}
                className={select}
              >
                <option value="">{t("rebate.ov.keep_category")}</option>
                {QPE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`rebate.cat.${c}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">{t("rebate.col.reason")}</span>
              <select
                value={reasonKey}
                onChange={(e) => setReasonKey(e.target.value as IneligibleReason)}
                className={select}
              >
                {INELIGIBLE_REASONS.map((c) => (
                  <option key={c} value={c}>
                    {t(`rebate.reason.${c}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t("rebate.ov.reason_label")}</span>
            <Textarea
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("rebate.ov.reason_placeholder")}
            />
            {!valid && reason.length > 0 && (
              <span className="text-xs text-destructive">{t("rebate.ov.reason_required")}</span>
            )}
          </label>
        </div>
        <DialogFooter className="gap-2">
          {hasOverride && (
            <button
              type="button"
              disabled={!valid || busy}
              onClick={() => submit(true)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
            >
              {t("rebate.ov.clear")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            {t("rebate.cancel")}
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => submit(false)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground disabled:opacity-40"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t("rebate.ov.save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
