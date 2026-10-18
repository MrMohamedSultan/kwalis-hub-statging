// ═══════════════════════════════════════════════════════════════════
// src/routes/_authenticated/no-access.tsx
// Phase 5 — dedicated landing for assigned roles with ZERO viewable
// modules. Fail-closed made humane: a clear explanation and a sign-out
// affordance, never a broken/empty shell.
// ═══════════════════════════════════════════════════════════════════

import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogOut, ShieldAlert } from "lucide-react";
import { signOut } from "@/lib/auth";
import { APP_NAME } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/no-access")({
  head: () => ({
    meta: [
      { title: `No Access — ${APP_NAME}` },
      { name: "description", content: "Your account has no workspace module access yet." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NoAccessPage,
});

function NoAccessPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-warning/30 bg-warning/10">
        <ShieldAlert className="size-8 text-warning" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{t("noAccess.title")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("noAccess.subtitle")}</p>
      <div className="mt-2 flex flex-col items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("noAccess.signOutHint")}</span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 hover:bg-surface px-3 py-2 text-xs font-semibold text-foreground transition"
        >
          <LogOut className="size-3.5 rtl:-scale-x-100" />
          {t("nav.logout")}
        </button>
      </div>
    </div>
  );
}
