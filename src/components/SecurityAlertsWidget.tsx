import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, LockOpen, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { insertAdminUnlock } from "@/lib/admin-unlock";
import { MetricCard, type MetricSentiment } from "@/components/ui/MetricCard";

type SecurityEventRow = {
  id: string;
  event_type:
    "failed_login" | "account_locked" | "successful_login_after_failures" | "admin_unlock";
  email: string;
  attempt_count: number | null;
  lock_duration_minutes: number | null;
  admin_unlocked: boolean | null;
  unlocked_at: string | null;
  created_at: string | null;
};

/** am***@gmail.com — enough signal for admins without exposing full PII in the UI. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const head = (local ?? "").slice(0, 2);
  return domain ? `${head}***@${domain}` : `${head}***`;
}

/**
 * Super-admin "Security Alerts" panel: today's login-threat stats, the
 * latest entries from the append-only auth_security_log table, and a
 * Force Unlock action for locked accounts.
 */
export function SecurityAlertsWidget() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<SecurityEventRow[]>([]);
  const [stats, setStats] = useState({ failed: 0, locked: 0, uniqueEmails: 0 });
  const [loading, setLoading] = useState(true);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const [recent, today] = await Promise.all([
        supabase
          .from("auth_security_log")
          .select(
            "id, event_type, email, attempt_count, lock_duration_minutes, admin_unlocked, unlocked_at, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("auth_security_log")
          .select("event_type, email")
          .gte("created_at", startOfToday.toISOString()),
      ]);
      setEvents((recent.data as SecurityEventRow[] | null) ?? []);
      const todayRows =
        (today.data as Pick<SecurityEventRow, "event_type" | "email">[] | null) ?? [];
      const failedRows = todayRows.filter((r) => r.event_type === "failed_login");
      setStats({
        failed: failedRows.length,
        locked: todayRows.filter((r) => r.event_type === "account_locked").length,
        uniqueEmails: new Set(failedRows.map((r) => r.email)).size,
      });
    } catch (err) {
      console.error("Failed to load security alerts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Newest admin_unlock timestamp per email within the loaded window. */
  const latestUnlockByEmail = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of events) {
      if (row.event_type !== "admin_unlock" || !row.unlocked_at) continue;
      const ts = Date.parse(row.unlocked_at);
      if (Number.isNaN(ts)) continue;
      const prev = map.get(row.email);
      if (prev === undefined || ts > prev) map.set(row.email, ts);
    }
    return map;
  }, [events]);

  /** A lock row counts as cleared when it (or a newer admin unlock for the email) says so. */
  const isLockCleared = useCallback(
    (row: SecurityEventRow): boolean => {
      if (row.admin_unlocked) return true;
      const unlockTs = latestUnlockByEmail.get(row.email);
      if (unlockTs === undefined) return false;
      const lockTs = row.created_at ? Date.parse(row.created_at) : NaN;
      return Number.isNaN(lockTs) ? true : unlockTs > lockTs;
    },
    [latestUnlockByEmail],
  );

  const handleUnlock = async (row: SecurityEventRow) => {
    setUnlockingId(row.id);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Not authenticated");
      await insertAdminUnlock(row.email, data.user.id);
      toast.success(t("security.unlockSuccess"));
      await load();
    } catch (err) {
      console.error("Admin unlock failed:", err);
      toast.error(t("security.unlockError"));
    } finally {
      setUnlockingId(null);
    }
  };

  const relativeTime = (iso: string | null): string => {
    if (!iso) return "";
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
    if (minutes < 1) return t("time.justNow");
    if (minutes < 60) return t("time.minutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("time.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    if (days === 1) return t("time.yesterday");
    return t("time.daysAgo", { count: days });
  };

  const metaFor = (row: SecurityEventRow) => {
    switch (row.event_type) {
      case "account_locked":
        return {
          icon: <ShieldAlert className="size-4 text-destructive" />,
          text: t("security.accountLockedEvent", { minutes: row.lock_duration_minutes ?? 0 }),
        };
      case "successful_login_after_failures":
        return {
          icon: <ShieldCheck className="size-4 text-success" />,
          text: t("security.successAfterFailuresEvent", { count: row.attempt_count ?? 1 }),
        };
      case "admin_unlock":
        return {
          icon: <LockOpen className="size-4 text-success" />,
          text: t("security.adminUnlockEvent"),
        };
      default:
        return {
          icon: <AlertTriangle className="size-4 text-warning" />,
          text: t("security.failedLoginEvent"),
        };
    }
  };

  const statCards: Array<{
    label: string;
    value: number;
    sentiment: MetricSentiment;
    icon: React.ReactNode;
  }> = [
    {
      label: t("security.failedToday"),
      value: stats.failed,
      sentiment: stats.failed > 0 ? "warning" : "neutral",
      icon: <AlertTriangle className="size-4 text-warning" />,
    },
    {
      label: t("security.lockedToday"),
      value: stats.locked,
      sentiment: stats.locked > 0 ? "danger" : "neutral",
      icon: <ShieldAlert className="size-4 text-destructive" />,
    },
    {
      label: t("security.uniqueEmailsToday"),
      value: stats.uniqueEmails,
      sentiment: "info",
      icon: <Shield className="size-4 text-info" />,
    },
  ];

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-brand" />
          <h2 className="text-sm font-semibold">{t("security.alertsTitle")}</h2>
        </div>
        {stats.locked > 0 && (
          <span
            className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive tabular-nums"
            aria-label={t("security.lockedToday")}
          >
            {stats.locked}
          </span>
        )}
      </header>

      <div className="grid gap-3 p-4 sm:grid-cols-3">
        {statCards.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={loading ? "—" : card.value.toLocaleString()}
            sentiment={card.sentiment}
            icon={card.icon}
          />
        ))}
      </div>

      <div className="border-t border-border">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Shield className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("security.noAlerts")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((row) => {
              const meta = metaFor(row);
              return (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="shrink-0">{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{meta.text}</div>
                    <div dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                      {maskEmail(row.email)}
                    </div>
                  </div>
                  {row.event_type === "account_locked" &&
                    (isLockCleared(row) ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                        <LockOpen className="size-3" />
                        {t("security.unlocked")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleUnlock(row)}
                        disabled={unlockingId === row.id}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1 text-[11px] font-semibold transition hover:border-brand/40 hover:text-brand disabled:opacity-50"
                      >
                        <LockOpen className="size-3" />
                        {unlockingId === row.id ? t("security.unlocking") : t("security.unlock")}
                      </button>
                    ))}
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relativeTime(row.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
