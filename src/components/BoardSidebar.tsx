// ═══════════════════════════════════════════════════════════════════
// src/components/BoardSidebar.tsx
// ═══════════════════════════════════════════════════════════════════
// Dedicated sidebar for Board Members — 3 items, zero clutter.
// Rendered by AppShell when mode === 'board'.
// ═══════════════════════════════════════════════════════════════════

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { signOut } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BetaBadge } from "@/components/BetaBadge";

interface NavItem {
  labelKey: string;
  path: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    labelKey: "nav.dashboard",
    path: "/board/dashboard",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    labelKey: "board.budgetReview",
    path: "/board/budget-review",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14,2 14,8 20,8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10,9 9,9 8,9" />
      </svg>
    ),
  },
  {
    labelKey: "nav.settings",
    path: "/board/settings",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

export function BoardSidebar({
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
  const [userName, setUserName] = useState("");
  const hideText = isCollapsed ? "lg:w-0 lg:opacity-0 lg:overflow-hidden lg:hidden" : "";
  const railRow = isCollapsed ? "lg:justify-center lg:px-0" : "";

  useEffect(() => {
    void loadUserName();
  }, []);

  async function loadUserName() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    setUserName(profile?.display_name || user.email || "");
  }

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth" });
  }

  function isActive(path: string): boolean {
    return currentPath.startsWith(path);
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
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-emerald-50 text-xs font-bold">
            TR
          </div>
          <div className={`transition-all duration-200 ${hideText}`}>
            <div className="flex items-center gap-1.5 text-sm font-bold text-sidebar-foreground tracking-tight">
              {t("common.appName")}
              <BetaBadge />
            </div>
            <div className="text-[9px] text-emerald-400 font-semibold uppercase tracking-widest">
              {t("board.title")}
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
      <nav className={`flex-1 px-3 py-4 space-y-1 ${isCollapsed ? "lg:px-2" : ""}`}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              title={t(item.labelKey)}
              onClick={() => {
                navigate({ to: item.path });
                onNavigate?.();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${railRow} ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              }`}
            >
              <span className={`shrink-0 ${active ? "text-emerald-400" : "text-muted-foreground"}`}>
                {item.icon}
              </span>
              <span className={`truncate transition-all duration-200 ${hideText}`}>
                {t(item.labelKey)}
              </span>
              {active && (
                <div className={`ms-auto w-1.5 h-1.5 rounded-full bg-emerald-400 ${hideText}`} />
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div className="border-t border-sidebar-border p-3 space-y-1">
        <div className={`px-3 py-2 transition-all duration-200 ${hideText}`}>
          <div className="text-xs font-medium text-sidebar-foreground truncate">{userName}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <span className="text-[10px] text-blue-400 font-medium uppercase tracking-wider">
              {t("board.role")}
            </span>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          title={t("auth.signOut")}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-rose-400 hover:bg-rose-950/20 transition-colors cursor-pointer ${railRow}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16,17 21,12 16,7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className={`transition-all duration-200 ${hideText}`}>{t("auth.signOut")}</span>
        </button>
      </div>
    </div>
  );
}
