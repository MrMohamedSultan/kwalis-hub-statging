import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { humanizeDbError } from "@/lib/db-errors";
import { backfillPersons, mergePersons, usePersons, type BackfillRow } from "@/lib/persons";
import { findDuplicatePairs, normalizeName } from "@/lib/person-match";
import type { Person } from "@/lib/store";
import { useStore } from "@/lib/store";

/**
 * E01 — person profiles of the organization: how many contracts each has in
 * this project, possible duplicates (look-alike names, never two different
 * ID numbers) for the owner to merge, and the one-off link of existing
 * contracts by exact ID number.
 */
export function PeopleProfilesPanel({
  organizationId,
  contracts,
  onClose,
}: {
  organizationId: string | null;
  contracts: Person[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { persons, available, loading, reload } = usePersons(organizationId);
  const reloadScoped = useStore((s) => s.reloadScopedData);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<BackfillRow[] | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contracts) if (c.personId) m.set(c.personId, (m.get(c.personId) ?? 0) + 1);
    return m;
  }, [contracts]);
  const unlinked = contracts.filter((c) => c.personId == null).length;
  const pairs = useMemo(() => findDuplicatePairs(persons).slice(0, 50), [persons]);
  const shown = useMemo(() => {
    const n = normalizeName(q);
    return (
      n
        ? persons.filter((p) => normalizeName(`${p.fullName} ${p.idNumber ?? ""}`).includes(n))
        : persons
    ).slice(0, 200);
  }, [persons, q]);

  const refresh = async () => {
    await reload();
    try {
      await reloadScoped();
    } catch {
      /* list refreshes on next load */
    }
  };

  const runPlan = async () => {
    if (!organizationId) return;
    setBusy(true);
    try {
      setPlan(await backfillPersons(organizationId, false));
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(false);
    }
  };
  const applyPlan = async () => {
    if (!organizationId) return;
    setBusy(true);
    try {
      const rows = await backfillPersons(organizationId, true);
      toast.success(t("people.backfill_done", { count: rows.length }));
      setPlan(null);
      await refresh();
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(false);
    }
  };
  const merge = async (keepId: string, dropId: string, keepName: string) => {
    if (!window.confirm(t("people.merge_confirm", { name: keepName }))) return;
    setBusy(true);
    try {
      const n = await mergePersons(keepId, dropId);
      toast.success(t("people.merge_done", { count: n, name: keepName }));
      await refresh();
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(false);
    }
  };

  const planCount = (a: BackfillRow["action"]) => (plan ?? []).filter((r) => r.action === a).length;

  return (
    <Modal title={t("people.profiles_title")} onClose={onClose} dismissible={!busy}>
      {!available && !loading ? (
        <p className="text-sm text-muted-foreground">{t("people.not_available")}</p>
      ) : (
        <div className="space-y-5 text-sm">
          <p className="text-muted-foreground">{t("people.profiles_intro")}</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t("people.stat_profiles")} value={persons.length} />
            <Stat label={t("people.stat_contracts")} value={contracts.length} />
            <Stat label={t("people.stat_unlinked")} value={unlinked} />
          </div>

          <section className="rounded-xl border border-border p-3 space-y-2">
            <h3 className="font-semibold">{t("people.backfill_title")}</h3>
            <p className="text-[12px] text-muted-foreground">{t("people.backfill_intro")}</p>
            {plan ? (
              <div className="space-y-2">
                <ul className="text-[12px] space-y-0.5">
                  <li>{t("people.plan_linked", { count: planCount("linked_by_id") })}</li>
                  <li>{t("people.plan_created", { count: planCount("created") })}</li>
                  <li>{t("people.plan_no_id", { count: planCount("created_no_id") })}</li>
                </ul>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || plan.length === 0}
                    onClick={applyPlan}
                    className="px-3 py-1.5 rounded-lg bg-brand text-brand-foreground font-semibold disabled:opacity-50"
                  >
                    {t("people.backfill_apply", { count: plan.length })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlan(null)}
                    className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
                  >
                    {t("people.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={runPlan}
                className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-muted font-medium disabled:opacity-50"
              >
                {t("people.backfill_preview")}
              </button>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">
              {t("people.duplicates_title")}{" "}
              <span className="text-muted-foreground font-normal">({pairs.length})</span>
            </h3>
            {pairs.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">{t("people.duplicates_none")}</p>
            ) : (
              <ul className="space-y-1.5">
                {pairs.map(({ a, b, score }) => (
                  <li
                    key={`${a.id}-${b.id}`}
                    className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 flex flex-wrap items-center gap-2"
                  >
                    <span className="flex-1 min-w-0">
                      <bdi className="font-medium">{a.fullName}</bdi>
                      <span className="text-muted-foreground">
                        {" "}
                        ({a.idNumber || t("people.no_id")})
                      </span>
                      {" ↔ "}
                      <bdi className="font-medium">{b.fullName}</bdi>
                      <span className="text-muted-foreground">
                        {" "}
                        ({b.idNumber || t("people.no_id")})
                      </span>
                      <span className="ms-2 text-[11px] text-muted-foreground tabular-nums">
                        {Math.round(score * 100)}%
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => merge(a.id, b.id, a.fullName)}
                      className="px-2 py-1 rounded-md border border-border bg-surface hover:bg-muted text-[12px]"
                    >
                      {t("people.keep_name", { name: a.fullName })}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => merge(b.id, a.id, b.fullName)}
                      className="px-2 py-1 rounded-md border border-border bg-surface hover:bg-muted text-[12px]"
                    >
                      {t("people.keep_name", { name: b.fullName })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold">{t("people.list_title")}</h3>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("people.search_placeholder")}
              className="w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand"
            />
            <div className="overflow-x-auto">
              <table className="app-table w-full">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-start px-2 py-1.5 text-xs">{t("people.col_name")}</th>
                    <th className="text-start px-2 py-1.5 text-xs">{t("people.col_id")}</th>
                    <th className="text-start px-2 py-1.5 text-xs">
                      {t("people.col_nationality")}
                    </th>
                    <th className="text-end px-2 py-1.5 text-xs">{t("people.col_contracts")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} className="border-b border-border/50">
                      <td className="px-2 py-1.5">
                        <bdi>{p.fullName}</bdi>
                      </td>
                      <td className="px-2 py-1.5" dir="ltr">
                        {p.idNumber || "—"}
                      </td>
                      <td className="px-2 py-1.5">{p.nationality || "—"}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums">{counts.get(p.id) ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
