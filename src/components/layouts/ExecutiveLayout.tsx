// ═══════════════════════════════════════════════════════════════════
// src/components/layouts/ExecutiveLayout.tsx
// Phase 5 — Layer 1: the executive workspace chrome.
//
//   • Slim top bar ONLY — zero sidebar, zero project controls.
//   • Visually distinct from the operational shell: brand accent rule,
//     card-backed sticky header, centered max-width content column.
//   • Read-only posture is explicit (badge + footer note); there are no
//     mutation affordances anywhere in this chrome.
// ═══════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Eye, LogOut, Moon, Sun } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTheme } from "@/lib/theme";
import { signOut } from "@/lib/auth";
import { useAuthRoles } from "@/lib/auth-roles";
import { usePermissions } from "@/lib/permissions/usePermissions";
import {
  canEnterExecutiveWorkMode,
  clearExecutiveWorkMode,
  enableExecutiveWorkMode,
} from "@/lib/executive-work-mode";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";

function ThemeToggleButton() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      className="inline-flex items-center justify-center rounded-full border border-border bg-surface-2 hover:bg-surface p-2 text-foreground transition"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function ExecutiveLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const roles = useAuthRoles();
  const permissions = usePermissions();
  const [signingOut, setSigningOut] = useState(false);
  const canReturnToWork =
    roles.loaded &&
    Boolean(roles.userId) &&
    canEnterExecutiveWorkMode(roles, permissions);

  function handleReturnToWork() {
    if (!roles.userId || !canReturnToWork) return;
    enableExecutiveWorkMode(roles.userId);
    void navigate({ to: "/main-hub", replace: true });
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      clearExecutiveWorkMode();
      await signOut();
      await navigate({ to: "/auth", replace: true });
    } catch {
      toast.error(t("executive.signOutError"));
      setSigningOut(false);
    }
  }

  return (
    <div className="dashboard-scope min-h-screen bg-background text-foreground flex flex-col">
      {/* Brand accent rule — instantly distinguishes the executive layout. */}
      <div className="h-1 w-full bg-brand" aria-hidden="true" />

      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex min-h-12 w-full max-w-[1600px] flex-wrap items-center gap-2 px-6 py-1.5 lg:px-10">
          <div dir="ltr" className="flex items-center gap-2">
            <img
              src="/kwalis-logo-dark.png"
              alt="Kwalis HUB"
              className="w-28 h-auto object-contain object-left-top block dark:hidden"
            />
            <img
              src="/kwalis-logo.png"
              alt="Kwalis HUB"
              className="w-28 h-auto object-contain object-left-top hidden dark:block"
            />
          </div>

          <span className="inline-flex items-center rounded-full border border-brand/40 bg-brand/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brand">
            {t("executive.badge")}
          </span>
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            <Eye className="size-3.5" />
            {t("executive.readOnly")}
          </span>

          <div className="ms-auto flex items-center gap-2">
            {canReturnToWork && (
              <Button type="button" variant="outline" size="sm" onClick={handleReturnToWork}>
                <ArrowLeftRight className="rtl:-scale-x-100" />
                <span className="hidden sm:inline">{t("executive.returnToWork")}</span>
              </Button>
            )}
            <ThemeToggleButton />
            <LanguageToggle />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
            >
              <LogOut className="rtl:-scale-x-100" />
              {signingOut ? t("executive.signingOut") : t("nav.logout")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-8 lg:px-10 lg:py-10">
        {children}
      </main>

      <footer className="border-t border-border">
        <p className="mx-auto w-full max-w-[1600px] px-6 py-4 text-xs text-muted-foreground lg:px-10">
          {t("executive.footerNote")}
        </p>
      </footer>
    </div>
  );
}
