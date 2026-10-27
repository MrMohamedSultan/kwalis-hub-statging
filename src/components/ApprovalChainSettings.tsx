import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Plus, Save, Trash2, ListOrdered } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteApprovalLevel,
  saveApprovalLevel,
  useApprovalLevels,
  type ApprovalLevel,
  type ApproverKind,
} from "@/lib/payment-requests";

const KINDS: ApproverKind[] = ["org_admin", "org_owner", "project_executive", "role"];
const MAX_LEVELS = 5;

type Draft = Omit<ApprovalLevel, "id"> & { id?: string };

/**
 * Organization approval chain: ordered levels, each required from a minimum
 * amount (SAR). Enforced by the database (db/pending/176); this panel only
 * edits public.payment_approval_levels (org admins).
 */
export function ApprovalChainSettings({
  organizationId,
  onChanged,
}: {
  organizationId: string;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const { levels, loading, refresh } = useApprovalLevels(organizationId);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => setDrafts(levels.map((l) => ({ ...l }))), [levels]);

  useEffect(() => {
    void (async () => {
      const { data } = await (supabase as any)
        .from("roles")
        .select("id, name, organization_id")
        .or(`organization_id.eq.${organizationId},organization_id.is.null`)
        .order("name");
      setRoles((data ?? []) as { id: string; name: string }[]);
    })();
  }, [organizationId]);

  const patch = (i: number, p: Partial<Draft>) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const addLevel = () => {
    const used = new Set(drafts.map((d) => d.level_no));
    const next = [1, 2, 3, 4, 5].find((n) => !used.has(n));
    if (!next) return;
    setDrafts((d) => [
      ...d,
      {
        organization_id: organizationId,
        level_no: next,
        label: "",
        min_amount_sar: next === 1 ? 0 : 50000,
        approver_kind: "org_admin",
        role_id: null,
      },
    ]);
  };

  const save = async (i: number) => {
    const d = drafts[i];
    if (!d.label.trim() || d.label.trim().length > 80) {
      toast.error(t("approvals.chain.labelRequired"));
      return;
    }
    if (!(d.min_amount_sar >= 0)) {
      toast.error(t("approvals.chain.amountInvalid"));
      return;
    }
    if (d.approver_kind === "role" && !d.role_id) {
      toast.error(t("approvals.chain.roleRequired"));
      return;
    }
    setBusy(i);
    try {
      await saveApprovalLevel(d);
      toast.success(t("approvals.chain.saved"));
      await refresh();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? t("approvals.toast.actionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (i: number) => {
    const d = drafts[i];
    if (!d.id) {
      setDrafts((x) => x.filter((_, j) => j !== i));
      return;
    }
    if (!confirm(t("approvals.chain.confirmDelete", { level: d.level_no }))) return;
    setBusy(i);
    try {
      await deleteApprovalLevel(d.id);
      toast.success(t("approvals.chain.deleted"));
      await refresh();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? t("approvals.toast.actionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const cls =
    "w-full bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 ring-brand";

  return (
    <section className="rounded-2xl border border-border bg-surface-2/40 p-4 mb-4">
      <header className="flex flex-wrap items-center gap-2 mb-2">
        <ListOrdered className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t("approvals.chain.title")}</h3>
        <button
          type="button"
          onClick={addLevel}
          disabled={drafts.length >= MAX_LEVELS}
          className="ms-auto inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          <Plus className="size-3.5" /> {t("approvals.chain.add")}
        </button>
      </header>
      <p className="text-xs text-muted-foreground mb-3">{t("approvals.chain.explain")}</p>
      {loading ? (
        <div className="text-xs text-muted-foreground">{t("approvals.loading")}</div>
      ) : drafts.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("approvals.chain.none")}</div>
      ) : (
        <div className="space-y-2">
          {drafts
            .map((d, i) => ({ d, i }))
            .sort((a, b) => a.d.level_no - b.d.level_no)
            .map(({ d, i }) => (
              <div
                key={d.id ?? `new-${d.level_no}`}
                className="grid grid-cols-2 md:grid-cols-[4rem_1fr_9rem_10rem_10rem_auto] gap-2 items-end rounded-xl border border-border bg-surface p-2"
              >
                <label className="text-[11px] text-muted-foreground">
                  {t("approvals.chain.level")}
                  <input
                    type="number"
                    min={1}
                    max={MAX_LEVELS}
                    value={d.level_no}
                    onChange={(e) =>
                      patch(i, {
                        level_no: Math.min(MAX_LEVELS, Math.max(1, +e.target.value || 1)),
                      })
                    }
                    className={cls}
                  />
                </label>
                <label className="text-[11px] text-muted-foreground">
                  {t("approvals.chain.label")}
                  <input
                    value={d.label}
                    maxLength={80}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    placeholder={t("approvals.chain.labelPlaceholder")}
                    className={cls}
                  />
                </label>
                <label className="text-[11px] text-muted-foreground">
                  {t("approvals.chain.minAmount")}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    value={d.min_amount_sar}
                    onChange={(e) =>
                      patch(i, { min_amount_sar: Math.max(0, +e.target.value || 0) })
                    }
                    className={`${cls} text-end tabular-nums`}
                  />
                </label>
                <label className="text-[11px] text-muted-foreground">
                  {t("approvals.chain.approver")}
                  <select
                    value={d.approver_kind}
                    onChange={(e) =>
                      patch(i, {
                        approver_kind: e.target.value as ApproverKind,
                        role_id: e.target.value === "role" ? d.role_id : null,
                      })
                    }
                    className={cls}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`approvals.chain.kind.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-muted-foreground">
                  {t("approvals.chain.role")}
                  <select
                    value={d.role_id ?? ""}
                    disabled={d.approver_kind !== "role"}
                    onChange={(e) => patch(i, { role_id: e.target.value || null })}
                    className={`${cls} disabled:opacity-50`}
                  >
                    <option value="">—</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-1.5 col-span-2 md:col-span-1 justify-end">
                  <button
                    type="button"
                    onClick={() => save(i)}
                    disabled={busy === i}
                    className="inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/15 text-success px-2.5 py-1.5 text-xs font-semibold hover:bg-success/25 disabled:opacity-60"
                  >
                    <Save className="size-3.5" /> {t("approvals.chain.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={busy === i}
                    aria-label={t("approvals.chain.delete")}
                    title={t("approvals.chain.delete")}
                    className="inline-flex items-center rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-60"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
