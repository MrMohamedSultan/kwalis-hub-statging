import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Bell, AlertTriangle, CheckCircle2, TrendingUp, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { formatDateTime } from "@/lib/date-format";
import { notificationTarget, notificationText } from "@/lib/notification-display";
import { useBudgetAlertsRunner } from "@/lib/budget-alerts";
import { BudgetAlertRecipientsPanel } from "@/components/notifications/BudgetAlertRecipientsPanel";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/notifications")({
  component: () => (
    <AppShell>
      <NotificationsPage />
    </AppShell>
  ),
});

type Notif = {
  id: string;
  severity: string;
  category: string;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
  project_id: string | null;
  metadata?: Record<string, unknown> | null;
};

const iconFor = (n: Notif) => {
  if (n.severity === "critical") return { Icon: AlertTriangle, tone: "text-destructive" };
  if (n.severity === "warning") return { Icon: TrendingUp, tone: "text-warning" };
  if (n.category === "budget") return { Icon: TrendingUp, tone: "text-info" };
  return { Icon: Bell, tone: "text-highlight" };
};

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function timeAgo(iso: string, t: TFn) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("platform.notify.justNow");
  if (s < 3600) return t("platform.notify.minutesAgo", { count: Math.floor(s / 60) });
  if (s < 86400) return t("platform.notify.hoursAgo", { count: Math.floor(s / 3600) });
  if (s < 7 * 86400) return t("platform.notify.daysAgo", { count: Math.floor(s / 86400) });
  return formatDateTime(iso);
}

// Map a notification's category to the in-app destination that surfaces it.
function targetRouteFor(
  n: Notif,
  t: TFn,
): { to: string; label: string; search?: Record<string, unknown> } | null {
  const target = notificationTarget(n);
  if (!target) return null;
  const label =
    target.to === "/payment-approvals"
      ? t("platform.notify.openApprovals")
      : target.to === "/budget"
        ? t("platform.notify.openBudget")
        : t("platform.common.view");
  return { ...target, label };
}

export function NotificationsPage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const [notes, setNotes] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"project" | "all">("project");
  const [limit, setLimit] = useState(25);
  const [hasMore, setHasMore] = useState(false);
  // D04: run the overspend check for the open project when the page opens.
  useBudgetAlertsRunner(activeProjectId);

  const load = async (lim: number) => {
    setLoading(true);
    let q = supabase
      .from("notifications" as any)
      .select("id, severity, category, title, body, created_at, read_at, project_id, metadata")
      .order("created_at", { ascending: false })
      .limit(lim + 1);
    if (scope === "project" && activeProjectId) q = q.eq("project_id", activeProjectId);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else {
      const rows = (data ?? []) as unknown as Notif[];
      setHasMore(rows.length > lim);
      setNotes(rows.slice(0, lim));
    }
    setLoading(false);
  };

  useEffect(() => {
    setLimit(25);
    load(25); /* eslint-disable-next-line */
  }, [scope, activeProjectId]);
  useEffect(() => {
    load(limit); /* eslint-disable-next-line */
  }, [limit]);

  const markRead = async (id: string) => {
    await supabase
      .from("notifications" as any)
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
    setNotes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
  };

  const markAllRead = async () => {
    const ids = notes.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length === 0) return;
    await supabase
      .from("notifications" as any)
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    setNotes((ns) => ns.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
  };

  const openNotification = async (n: Notif) => {
    const target = targetRouteFor(n, t);
    if (!target) return;
    if (!n.read_at) await markRead(n.id);
    if (n.project_id && n.project_id !== activeProjectId) {
      await setActiveProject(n.project_id);
    }
    navigate({ to: target.to as any, search: (target.search ?? {}) as any });
  };

  return (
    <>
      <PageTitle
        title={t("platform.notify.title")}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={markAllRead}
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-border hover:bg-surface-2"
            >
              {t("notificationbell.mark_all_as_read")}
            </button>
            <div className="inline-flex rounded-lg border border-border bg-surface p-1 text-xs">
              {(["project", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1 rounded-md font-semibold ${scope === s ? "bg-brand text-brand-foreground" : "text-muted-foreground"}`}
                >
                  {s === "project" ? t("platform.notify.thisProject") : t("platform.notify.all")}
                </button>
              ))}
            </div>
          </div>
        }
      />
      <Panel>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("platform.common.loading")}
          </div>
        ) : notes.length === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="mx-auto size-8 text-success" />
            <div className="mt-2 text-sm font-medium">{t("notifications.all_clear")}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("platform.notify.emptyHint")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {notes.map((n) => {
              const { Icon, tone } = iconFor(n);
              const target = targetRouteFor(n, t);
              const text = notificationText(n, t);
              return (
                <li
                  key={n.id}
                  className={`flex items-start gap-4 py-4 ${!n.read_at ? "" : "opacity-60"}`}
                >
                  <Icon className={`size-5 ${tone} shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{text.title}</div>
                    {text.body && (
                      <div className="text-sm text-muted-foreground mt-0.5">{text.body}</div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      {timeAgo(n.created_at, t)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {target && (
                      <button
                        onClick={() => void openNotification(n)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-brand text-brand-foreground font-semibold hover:brightness-110"
                      >
                        <ExternalLink className="size-3" /> {target.label}
                      </button>
                    )}
                    {!n.read_at && (
                      <button
                        onClick={() => markRead(n.id)}
                        className="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-2"
                      >
                        {t("notifications.mark_read")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hasMore && !loading && (
          <div className="pt-4 text-center">
            <button
              onClick={() => setLimit((l) => l + 25)}
              className="text-xs font-semibold px-4 py-2 rounded-md border border-border hover:bg-surface-2"
            >
              {t("notificationbell.load_more")}
            </button>
          </div>
        )}
      </Panel>
      {activeProjectId && <BudgetAlertRecipientsPanel projectId={activeProjectId} />}
    </>
  );
}
