// ═══════════════════════════════════════════════════════════════════
// src/components/PlatformHubSidebar.tsx
// ═══════════════════════════════════════════════════════════════════
// Dedicated sidebar for Super Admins (Platform Hub) — 6 items.
// Rendered by AppShell when shell mode === 'platform'.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  Users,
  Shield,
  ScrollText,
  Settings,
  LogOut,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAuthRoles } from "@/lib/auth-roles";
import { signOut } from "@/lib/auth";
import { countNewAccessRequests, subscribeToNewAccessRequests } from "@/lib/access-requests";
import { BetaBadge } from "@/components/BetaBadge";

const NAV_ITEMS = [
  { labelKey: "platformHub.nav.dashboard", path: "/platform-hub/dashboard", icon: LayoutDashboard },
  { labelKey: "platformHub.nav.companies", path: "/platform-hub/companies", icon: Building2 },
  {
    labelKey: "platformHub.nav.registrationRequests",
    path: "/platform-hub/registration-requests",
    icon: Inbox,
    badge: true,
  },
  { labelKey: "platformHub.nav.users", path: "/platform-hub/users", icon: Users },
  { labelKey: "platformHub.nav.roles", path: "/platform-hub/roles", icon: Shield },
  { labelKey: "platformHub.nav.auditLog", path: "/platform-hub/audit-log", icon: ScrollText },
  { labelKey: "platformHub.nav.settings", path: "/platform-hub/settings", icon: Settings },
] as const;

export function PlatformHubSidebar({
  mobileOpen = false,
  onNavigate,
  onClose,
  isCollapsed = false,
  onToggle,
}: {
  mobileOpen?: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
  isCollapsed?: boolean;
  onToggle?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const { displayName, email } = useAuthRoles();
  const [pendingRequests, setPendingRequests] = useState(0);
  const hideText = isCollapsed ? "lg:w-0 lg:opacity-0 lg:overflow-hidden lg:hidden" : "";
  const railRow = isCollapsed ? "lg:justify-center lg:px-0" : "";

  // Live badge for un-triaged B2B leads; refreshed on a slow poll.
  useEffect(() => {
    let alive = true;
    const load = () =>
      countNewAccessRequests().then((n) => {
        if (alive) setPendingRequests(n);
      });
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [currentPath]);

  // Instant alert when a new access request is submitted.
  useEffect(() => {
    const unsubscribe = subscribeToNewAccessRequests((row) => {
      setPendingRequests((n) => n + 1);
      toast.info(t("platformHub.requests.newAlert"), {
        description: `${row.company || row.name} — ${row.email}`,
        action: {
          label: t("common.review"),
          onClick: () => navigate({ to: "/platform-hub/registration-requests" }),
        },
      });
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div
      className={`fixed inset-y-0 start-0 z-50 flex flex-col h-full w-[240px] bg-sidebar border-e border-sidebar-border transition-all duration-300 ease-in-out lg:static lg:translate-x-0 ${
        isCollapsed ? "lg:w-16" : "lg:w-[240px]"
      } ${
        mobileOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full lg:rtl:translate-x-0"
      }`}
    >
      {/* ── Branding ── */}
      <div
        className={`px-5 py-5 border-b border-sidebar-border flex items-center justify-between ${
          isCollapsed ? "lg:px-2 lg:flex-col lg:gap-2" : ""
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-xs font-bold text-brand-foreground">
            KH
          </div>
          <div className={`transition-all duration-200 ${hideText}`}>
            <div className="flex items-center gap-1.5 text-sm font-bold text-sidebar-foreground tracking-tight">
              {t("platformHub.title")}
              <BetaBadge />
            </div>
            <div className="text-[9px] text-warning font-semibold uppercase tracking-widest">
              {t("platformHub.subtitle")}
            </div>
          </div>
        </div>

        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden lg:inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.closeMenu")}
            className="lg:hidden text-muted-foreground text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className={`flex-1 px-3 py-4 space-y-1 overflow-y-auto ${isCollapsed ? "lg:px-2" : ""}`}>
        {NAV_ITEMS.map((item) => {
          const active = currentPath.startsWith(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              type="button"
              title={t(item.labelKey)}
              onClick={() => {
                navigate({ to: item.path });
                onNavigate?.();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-start transition-colors cursor-pointer ${railRow} ${
                active
                  ? "bg-brand text-brand-foreground font-semibold shadow-sm"
                  : "font-medium text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <Icon
                className={`size-[18px] shrink-0 ${active ? "text-brand-foreground" : "text-muted-foreground"}`}
              />
              <span className={`flex-1 truncate transition-all duration-200 ${hideText}`}>
                {t(item.labelKey)}
              </span>
              {"badge" in item && item.badge && pendingRequests > 0 && (
                <span
                  className={`rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-bold text-warning-foreground ${hideText}`}
                >
                  {pendingRequests}
                </span>
              )}
              {active && (
                <div
                  className={`w-1.5 h-1.5 rounded-full bg-brand-foreground shrink-0 ${hideText}`}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div className="border-t border-sidebar-border p-3 space-y-1">
        <div className={`px-3 py-2 transition-all duration-200 ${hideText}`}>
          <div className="text-xs font-medium text-sidebar-foreground truncate">
            {displayName || email || ""}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-warning" />
            <span className="text-[10px] text-warning font-medium uppercase tracking-wider">
              {t("platformHub.role")}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          title={t("auth.signOut")}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer ${railRow}`}
        >
          <LogOut className="size-4 shrink-0" />
          <span className={`transition-all duration-200 ${hideText}`}>{t("auth.signOut")}</span>
        </button>
      </div>
    </div>
  );
}
