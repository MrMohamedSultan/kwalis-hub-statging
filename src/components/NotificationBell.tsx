import { formatDateTime } from "@/lib/date-format";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { openWorkspacePanel } from "@/lib/workspace-panels";
import { useAuthRoles } from "@/lib/auth-roles";
import { useStore } from "@/lib/store";
import { notificationTarget, notificationText } from "@/lib/notification-display";
import { useBudgetAlertsRunner } from "@/lib/budget-alerts";

import { useTranslation } from "react-i18next";
type NotifRow = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  category: string;
  created_at: string;
  read_at: string | null;
  project_id: string | null;
  metadata?: Record<string, unknown> | null;
};

const PAGE = 10;

const targetFor = notificationTarget;

export function NotificationBell() {
  const { t } = useTranslation();

  const roles = useAuthRoles();
  const navigate = useNavigate();
  const setActiveProject = useStore((s) => s.setActiveProject);
  const activeProjectId = useStore((s) => s.activeProjectId);
  // D04: overspend check for the open project (in-app alert without the cron).
  useBudgetAlertsRunner(activeProjectId);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifRow[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (lim: number) => {
      if (!roles.userId) return;
      const { data } = await supabase
        .from("notifications" as any)
        .select("id,title,body,severity,category,created_at,read_at,project_id,metadata")
        .eq("user_id", roles.userId)
        .order("created_at", { ascending: false })
        .limit(lim + 1);
      const rows = (data ?? []) as unknown as NotifRow[];
      setHasMore(rows.length > lim);
      setItems(rows.slice(0, lim));
    },
    [roles.userId],
  );

  useEffect(() => {
    void load(limit);
  }, [load, limit]);

  useEffect(() => {
    if (!roles.userId) return;
    const nonce = Math.random().toString(36).slice(2, 10);
    const channel = supabase.channel(`notif-bell-${roles.userId}-${nonce}`);
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${roles.userId}`,
      },
      () => void load(limit),
    );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roles.userId, load, limit]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markAllRead() {
    if (!roles.userId) return;
    await supabase
      .from("notifications" as any)
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", roles.userId)
      .is("read_at", null);
    await load(limit);
  }

  async function markRead(id: string) {
    await supabase
      .from("notifications" as any)
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
    setItems((xs) =>
      xs.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
  }

  async function openItem(n: NotifRow) {
    const target = targetFor(n);
    if (!n.read_at) await markRead(n.id);
    if (!target) return;
    setOpen(false);
    if (n.project_id && n.project_id !== activeProjectId) {
      await setActiveProject(n.project_id);
    }
    navigate({ to: target.to as any, search: (target.search ?? {}) as any });
  }

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg hover:bg-accent hover:text-accent-foreground text-foreground transition"
        aria-label={t("notificationbell.notifications")}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 mt-2 w-[340px] max-w-[90vw] rounded-xl border border-border bg-popover text-popover-foreground shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-semibold text-foreground">
              {t("notificationbell.notifications")}
            </span>
            <button
              onClick={markAllRead}
              className="text-[11px] text-brand hover:underline font-semibold"
            >
              {t("notificationbell.mark_all_as_read")}
            </button>
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground text-center">
                {t("notificationbell.no_notifications")}
              </div>
            ) : (
              items.map((n) => {
                const clickable = !!targetFor(n);
                const text = notificationText(n, t);
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => void openItem(n)}
                    className={`w-full text-start px-3 py-2 border-b border-border text-xs transition-colors ${!n.read_at ? "bg-brand/5" : ""} ${clickable ? "hover:bg-accent hover:text-accent-foreground cursor-pointer" : "cursor-default"}`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-1 size-1.5 rounded-full shrink-0 ${
                          n.severity === "critical"
                            ? "bg-destructive"
                            : n.severity === "warning"
                              ? "bg-warning"
                              : "bg-success"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-foreground truncate">{text.title}</div>
                        {text.body && (
                          <div className="text-muted-foreground line-clamp-2">{text.body}</div>
                        )}
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {formatDateTime(n.created_at)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
            {hasMore && (
              <button
                onClick={() => setLimit((l) => l + PAGE)}
                className="w-full py-2 text-[11px] font-semibold text-brand hover:bg-accent hover:text-accent-foreground"
              >
                {t("notificationbell.load_more")}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openWorkspacePanel("notifications");
            }}
            className="block w-full text-center text-xs font-semibold text-brand py-2 border-t border-border hover:bg-accent hover:text-accent-foreground"
          >
            {t("notificationbell.view_all")}
          </button>
        </div>
      )}
    </div>
  );
}
