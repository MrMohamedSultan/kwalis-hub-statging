// ═══════════════════════════════════════════════════════════════════
// E11 — shooting schedule of the active project: the actual shoot days.
// Move a day when it is postponed (its first date is kept and the change
// is logged with a reason); the rebate report and Live Balance read it.
// ═══════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/AppShell";
import { DateInput } from "@/components/ui/date-input";
import { useStore } from "@/lib/store";
import { formatDate } from "@/lib/date-format";
import { humanizeDbError } from "@/lib/db-errors";
import {
  SHOOT_DAY_STATUSES,
  addShootDay,
  countShootDays,
  deleteShootDay,
  updateShootDay,
  useInvalidateShootDays,
  useShootDays,
  wasPostponed,
  type ShootDay,
  type ShootDayStatus,
} from "@/lib/shoot-schedule";

export function ShootSchedulePanel() {
  const { t } = useTranslation();
  const projectId = useStore((s) => s.activeProjectId);
  const q = useShootDays(projectId);
  const invalidate = useInvalidateShootDays();
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const days = q.data ?? [];

  if (!projectId) return null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await invalidate();
    } catch (e) {
      toast.error(humanizeDbError(e));
    } finally {
      setBusy(null);
    }
  };

  const add = () => {
    if (!date) return;
    void run("add", async () => {
      await addShootDay(projectId, {
        shoot_date: date,
        status: "planned",
        location: location.trim() || null,
        region: region.trim() || null,
        unit: null,
        notes: null,
      });
      setDate("");
      toast.success(t("rebate.sd.added"));
    });
  };

  const patch = (d: ShootDay, changes: Partial<ShootDay>, needReason: boolean) => {
    let reason: string | null = null;
    if (needReason) {
      reason = window.prompt(t("rebate.sd.reason_prompt"))?.trim() ?? "";
      if (reason.length < 3) {
        toast.error(t("rebate.sd.reason_required"));
        return;
      }
    }
    void run(d.id, () =>
      updateShootDay(d.id, {
        shoot_date: changes.shoot_date ?? d.shoot_date,
        status: (changes.status ?? d.status) as ShootDayStatus,
        location: d.location,
        region: d.region,
        unit: d.unit,
        notes: d.notes,
        change_reason: reason,
      }),
    );
  };

  const input =
    "rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand/40";

  return (
    <Panel className="max-w-3xl space-y-4 p-5">
      <div>
        <h3 className="text-base font-semibold">{t("rebate.sd.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("rebate.sd.subtitle", { count: countShootDays(days) })}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t("rebate.sd.date")}</span>
          <DateInput value={date} onChange={setDate} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t("rebate.sd.location")}</span>
          <input
            value={location}
            maxLength={200}
            onChange={(e) => setLocation(e.target.value)}
            className={input}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t("rebate.sd.region")}</span>
          <input
            value={region}
            maxLength={100}
            onChange={(e) => setRegion(e.target.value)}
            className={input}
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={!date || busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground disabled:opacity-40"
        >
          {busy === "add" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          {t("rebate.sd.add")}
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2/60">
            <tr>
              <th className="px-3 py-2 text-start text-muted-foreground">{t("rebate.sd.date")}</th>
              <th className="px-3 py-2 text-start text-muted-foreground">
                {t("rebate.sd.status")}
              </th>
              <th className="px-3 py-2 text-start text-muted-foreground">
                {t("rebate.sd.location")}
              </th>
              <th className="px-3 py-2 text-start text-muted-foreground">
                {t("rebate.sd.region")}
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {days.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  {q.isLoading ? (
                    <Loader2 className="mx-auto size-4 animate-spin" />
                  ) : (
                    t("rebate.sd.none")
                  )}
                </td>
              </tr>
            )}
            {days.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <DateInput
                    value={d.shoot_date}
                    onChange={(v) => v && v !== d.shoot_date && patch(d, { shoot_date: v }, true)}
                  />
                  {wasPostponed(d) && (
                    <div className="mt-1 text-[11px] text-warning">
                      {t("rebate.sd.moved_from", { date: formatDate(d.original_date) })}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={d.status}
                    onChange={(e) =>
                      patch(
                        d,
                        { status: e.target.value as ShootDayStatus },
                        e.target.value !== "shot",
                      )
                    }
                    className={input}
                  >
                    {SHOOT_DAY_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`rebate.sd.st_${s}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">{d.location ?? "—"}</td>
                <td className="px-3 py-2">{d.region ?? "—"}</td>
                <td className="px-3 py-2 text-end">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm(t("rebate.sd.delete_confirm")))
                        void run(d.id, () => deleteShootDay(d.id));
                    }}
                    className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    aria-label={t("rebate.sd.delete")}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
