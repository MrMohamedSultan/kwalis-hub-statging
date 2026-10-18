// ============================================================
// Workspace panel modal — hosts Account Settings and Notifications
// as an overlay so the accountant never loses the active project
// route or sidebar. Tab choice and per-tab scroll offset survive
// close/reopen for the whole browser session.
// ============================================================
import { Suspense, lazy, useEffect, useRef, type Ref } from "react";
import { Bell, UserCog, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useLockBodyScroll } from "@/hooks/use-lock-body-scroll";
import { useTranslation } from "react-i18next";
import {
  closeWorkspacePanel,
  setWorkspacePanelScroll,
  setWorkspacePanelTab,
  useWorkspacePanel,
  type WorkspacePanelKey,
} from "@/lib/workspace-panels";

// Lazy imports keep this module out of an import cycle with AppShell.
const AccountSettingsPanel = lazy(() =>
  import("@/routes/_authenticated/account-settings").then((m) => ({
    default: m.AccountSettingsPage,
  })),
);
const NotificationsPanel = lazy(() =>
  import("@/routes/_authenticated/notifications").then((m) => ({
    default: m.NotificationsPage,
  })),
);

const TABS: { key: WorkspacePanelKey; label: string; icon: typeof Bell }[] = [
  { key: "account", label: "Account Settings", icon: UserCog },
  { key: "notifications", label: "Notifications", icon: Bell },
];

export function WorkspacePanelModal() {
  const { t } = useTranslation();

  const { open, tab, scroll } = useWorkspacePanel();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useFocusTrap(open, closeWorkspacePanel) as unknown as Ref<HTMLDivElement>;
  useLockBodyScroll(open);

  // Restore the remembered scroll offset whenever the modal opens or the
  // active tab changes.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = scroll[tab] ?? 0;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = target;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWorkspacePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeWorkspacePanel}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("workspacepanelmodal.workspace_panels")}
        className="relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="inline-flex gap-1 rounded-xl bg-surface-2/60 p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => {
                    // Persist the current tab's scroll before switching away.
                    if (scrollRef.current)
                      setWorkspacePanelScroll(tab, scrollRef.current.scrollTop);
                    setWorkspacePanelTab(t.key);
                  }}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "bg-brand text-brand-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="size-3.5" /> {t.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => {
              if (scrollRef.current) setWorkspacePanelScroll(tab, scrollRef.current.scrollTop);
              closeWorkspacePanel();
            }}
            aria-label="Close"
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => setWorkspacePanelScroll(tab, e.currentTarget.scrollTop)}
          className="flex-1 overflow-y-auto p-4 sm:p-6"
        >
          <Suspense
            fallback={
              <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
            }
          >
            {tab === "account" ? <AccountSettingsPanel /> : <NotificationsPanel />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
