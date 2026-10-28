import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * D04 — overspend alerts. public.run_budget_alerts (db/pending/195) compares
 * Actual + Commitment with each code's budget and notifies once at 80 % and
 * once at 100 %. The cron dispatcher runs it for every project; the app also
 * runs it for the open project so alerts show up without the cron.
 */
// The functions / table are new (195) and not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function runBudgetAlerts(projectId: string): Promise<number> {
  const { data, error } = await db.rpc("run_budget_alerts", { _project: projectId });
  if (error) throw error;
  return Number(data ?? 0);
}

const EVERY_MS = 5 * 60_000;

/** Run the check for the open project now and every 5 minutes (errors are ignored). */
export function useBudgetAlertsRunner(projectId: string | null | undefined): void {
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void runBudgetAlerts(projectId).catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [projectId]);
}

export type AlertRecipient = {
  id: string;
  budget_code: string | null;
  user_id: string;
  display_name: string | null;
};

export async function listAlertRecipients(projectId: string): Promise<AlertRecipient[]> {
  const { data, error } = await db
    .from("budget_alert_responsibles")
    .select("id, budget_code, user_id")
    .eq("project_id", projectId)
    .order("budget_code", { ascending: true, nullsFirst: true });
  if (error) throw error;
  const rows = (data ?? []) as Omit<AlertRecipient, "display_name">[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    for (const p of profiles ?? []) names.set(p.id, p.display_name ?? null);
  }
  return rows.map((r) => ({ ...r, display_name: names.get(r.user_id) ?? null }));
}

export async function addAlertRecipient(input: {
  organizationId: string;
  projectId: string;
  budgetCode: string | null;
  userId: string;
}): Promise<void> {
  const code = input.budgetCode?.trim() || null;
  const { error } = await db.from("budget_alert_responsibles").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    budget_code: code,
    user_id: input.userId,
  });
  if (error) throw error;
}

export async function removeAlertRecipient(id: string): Promise<void> {
  const { error } = await db.from("budget_alert_responsibles").delete().eq("id", id);
  if (error) throw error;
}
