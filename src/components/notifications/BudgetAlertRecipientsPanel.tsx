import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing, Trash2 } from "lucide-react";
import { Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import {
  addAlertRecipient,
  listAlertRecipients,
  removeAlertRecipient,
  type AlertRecipient,
} from "@/lib/budget-alerts";

type Member = { id: string; name: string };

/**
 * D04 — who receives the 80 % / 100 % overspend alerts of this project.
 * With nobody listed, the project owner and the organization admins get
 * them. Only organization admins can change the list (RLS).
 */
export function BudgetAlertRecipientsPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const organizationId = useStore(
    (s) => s.projects.find((p) => p.id === projectId)?.organizationId ?? null,
  );
  const budget = useStore((s) => s.budget);
  const codes = useMemo(
    () => [...new Set(budget.map((b) => b.mainCode).filter(Boolean))].sort(),
    [budget],
  );
  const [rows, setRows] = useState<AlertRecipient[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [code, setCode] = useState("");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRows(await listAlertRecipients(projectId));
    } catch {
      setRows([]);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    (async () => {
      const { data } = await supabase
        .from("project_members")
        .select("user_id")
        .eq("project_id", projectId);
      const ids = [...new Set((data ?? []).map((r) => r.user_id as string))];
      if (!ids.length) return setMembers([]);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      setMembers(
        (profiles ?? []).map((p) => ({ id: p.id, name: p.display_name || p.id.slice(0, 8) })),
      );
    })();
  }, [projectId, refresh]);

  const add = async () => {
    if (!organizationId || !userId) return;
    setBusy(true);
    try {
      await addAlertRecipient({ organizationId, projectId, budgetCode: code || null, userId });
      setCode("");
      setUserId("");
      await refresh();
    } catch {
      toast.error(t("platform.alerts.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await removeAlertRecipient(id);
      await refresh();
    } catch {
      toast.error(t("platform.alerts.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const selectCls =
    "bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 ring-brand min-w-0";

  return (
    <Panel className="mt-6">
      <div className="flex items-center gap-2 mb-2">
        <BellRing className="size-4 text-brand" />
        <h2 className="text-base font-semibold">{t("platform.alerts.title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t("platform.alerts.intro")}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-4">{t("platform.alerts.defaults")}</p>
      ) : (
        <ul className="divide-y divide-border mb-4">
          {rows.map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium">{r.display_name ?? r.user_id.slice(0, 8)}</span>
                <span className="text-muted-foreground">
                  {" — "}
                  {r.budget_code
                    ? t("platform.alerts.forCode", { code: r.budget_code })
                    : t("platform.alerts.allCodes")}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(r.id)}
                aria-label={t("platform.alerts.remove")}
                className="text-destructive hover:opacity-80 disabled:opacity-50"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("platform.alerts.code")}
          <select value={code} onChange={(e) => setCode(e.target.value)} className={selectCls}>
            <option value="">{t("platform.alerts.allCodes")}</option>
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("platform.alerts.person")}
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={selectCls}>
            <option value="">{t("platform.alerts.pickPerson")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !userId || !organizationId}
          onClick={() => void add()}
          className="px-4 py-2 rounded-lg bg-brand text-brand-foreground text-sm font-semibold disabled:opacity-60"
        >
          {t("platform.alerts.add")}
        </button>
      </div>
    </Panel>
  );
}
