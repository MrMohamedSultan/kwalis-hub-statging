import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { Search, Menu, FolderOpen, Sun, Moon, ArrowLeft, X, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth";
import { PlatformSwitcher } from "@/components/PlatformSwitcher";

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "./Sidebar";
import { BoardSidebar } from "@/components/BoardSidebar";
import { PlatformHubSidebar } from "@/components/PlatformHubSidebar";
import { LanguageToggle } from "./LanguageToggle";
import { CurrencyToggle } from "@/components/ui/CurrencyToggle";
import { useMoney } from "@/lib/money-display";
import { useTheme } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { DataLoadErrorToast } from "@/components/DataLoadErrorToast";
import { useTableCardLabels } from "@/hooks/use-table-card-labels";
import { useLockBodyScroll } from "@/hooks/use-lock-body-scroll";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";

import { useGlobalSearch } from "@/lib/global-search";
import { RefSearchResults } from "@/components/RefSearchResults";
import { ProjectStatusBadge } from "@/components/ProjectBadges";
import { NotificationBell } from "@/components/NotificationBell";
import { InstallAppButton } from "@/components/InstallAppButton";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { getBudgetCatalog } from "@/lib/master-budget-catalog";
import { getMasterBudgetActuals } from "@/lib/master-budget-cache";
import { startBudgetCacheRealtime, subscribeBudgetCaches } from "@/lib/budget-cache-bus";
import { getShellMode, isPlatformShellRoute, PLATFORM_SHELL_PREFIXES } from "@/lib/shell-routes";
import { PROJECT_GATEWAY_PATH } from "@/lib/project-gateway";
import { reportLovableError } from "@/lib/lovable-error-reporting";

import { ProjectSettingsDialog } from "@/components/ProjectSettingsDialog";
import { WorkspacePanelModal } from "@/components/WorkspacePanelModal";
import { useCurrentUser } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import { ProjectInfoPopover } from "@/components/ui/ProjectInfoPopover";

const NOOP_BOOTSTRAP = async () => {};

/**
 * Read-only active-project indicator. Per the Project Gateway architecture
 * there is intentionally NO switcher dropdown in the app chrome — the only
 * way to select or switch projects is via "← Main Hub" in the sidebar.
 */
function ActiveProjectIndicator() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const projectName = activeProject?.name ?? "Project unavailable";
  const projectStatus = activeProject?.status ?? null;
  const projectCode = activeProject?.code ?? null;

  if (!activeProjectId) return null;

  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 min-w-0 max-w-full"
      aria-label={projectName}
      title={projectName}
    >
      <FolderOpen className="size-4 text-brand shrink-0" />
      {projectCode && (
        <span className="inline-flex items-center rounded-md border border-brand/40 bg-brand/15 text-brand px-1.5 py-0.5 text-[10px] font-bold tracking-wider shrink-0">
          {projectCode}
        </span>
      )}
      <span className="text-sm font-semibold truncate max-w-[200px] lg:max-w-[280px]">
        {projectName}
      </span>
      <span className="hidden sm:inline-flex shrink-0">
        <ProjectStatusBadge value={projectStatus} />
      </span>
    </div>
  );
}

export function NoActiveProjectBanner() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const ready = useStore((s) => s.ready);
  if (!ready || (activeProjectId && projects.some((p) => p.id === activeProjectId))) return null;
  return (
    <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 text-warning p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm">
        <span className="font-semibold">No active project.</span>{" "}
        {projects.length === 0
          ? "Create your first project to start capturing budget, crew, and payables."
          : "Open the Main Hub to choose a project and load its data."}
      </div>
      <div className="flex items-center gap-2">
        {projects.length > 0 && (
          <Link
            to="/main-hub"
            className="px-3 py-1.5 rounded-lg bg-warning text-warning text-xs font-semibold hover:brightness-110"
          >
            Select a project
          </Link>
        )}
        <Link
          to="/settings"
          className="px-3 py-1.5 rounded-lg border border-warning/40 text-warning text-xs font-semibold hover:bg-warning/10"
        >
          {projects.length === 0 ? "Create project" : "Manage projects"}
        </Link>
      </div>
    </div>
  );
}

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

export { isPlatformShellRoute, PLATFORM_SHELL_PREFIXES };

const AppShellMountedContext = createContext(false);

// PlatformAdminIndicator was replaced by <PlatformSwitcher /> — a live
// context selector that lets super admins jump between the Platform Hub
// and specific Org Workspaces from the top bar.

type LayoutBoundaryState = {
  hasError: boolean;
};

class LayoutErrorBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    label: string;
    resetKey: string;
  },
  LayoutBoundaryState
> {
  state: LayoutBoundaryState = { hasError: false };

  static getDerivedStateFromError(): LayoutBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    reportLovableError(error, {
      boundary: this.props.label,
      componentStack: errorInfo.componentStack,
    });
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function SidebarFallback() {
  const { t } = useTranslation();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-72 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col h-full p-4 lg:static lg:z-auto">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="text-sm font-semibold">{t("appshell.navigation_unavailable")}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t("appshell.reload_this_view_or_use_the_top_controls")}
        </div>
      </div>
    </aside>
  );
}

function ContentFallback() {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-foreground">
      {t("appshell.this_view_could_not_render_safely_navigate_away")}
    </div>
  );
}

/** Sign-out button shown in the top bar next to the language toggle. */
function HeaderLogoutButton() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut();
        } finally {
          window.location.href = "/auth";
        }
      }}
      title={t("nav.logout")}
      aria-label={t("nav.logout")}
      className="p-1.5 rounded-lg border border-border bg-surface-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 disabled:opacity-50 shrink-0"
    >
      <LogOut className="size-4 rtl:-scale-x-100" />
    </button>
  );
}

export function AppShell({
  children,
  forceMode,
}: {
  children?: React.ReactNode;
  /** Overrides route-based shell detection (used by the isolated admin/board branches). */
  forceMode?: "tenant" | "platform" | "board";
}) {
  // Subscribe to the display-currency toggle so every page inside the shell
  // re-renders its monetary values when the user switches currency.
  useMoney();
  const shellAlreadyMounted = useContext(AppShellMountedContext);
  if (shellAlreadyMounted) {
    return <>{children ?? <Outlet />}</>;
  }
  return <AppShellChrome forceMode={forceMode}>{children}</AppShellChrome>;
}

function AppShellChrome({
  children,
  forceMode,
}: {
  children?: React.ReactNode;
  forceMode?: "tenant" | "platform" | "board";
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const shellMode = forceMode ?? getShellMode(pathname);
  const tenantShell = shellMode === "tenant";
  const boardShell = shellMode === "board";
  // The Project Selection Gateway renders without the inner sidebar or any
  // project controls — it is the entry point, not a project workspace.
  const isGateway = tenantShell && pathname === PROJECT_GATEWAY_PATH;
  const bootstrap = useStore((s) => (tenantShell ? s.bootstrap : NOOP_BOOTSTRAP));
  const ready = useStore((s) => (tenantShell ? s.ready : true));
  const activeProjectId = useStore((s) => (tenantShell ? s.activeProjectId : null));
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isCollapsed, toggle: toggleCollapse } = useSidebarCollapse();

  const mainContentRef = useRef<HTMLDivElement>(null);
  const searchQuery = useGlobalSearch((s) => s.query);
  const setSearchQuery = useGlobalSearch((s) => s.setQuery);
  const clearSearch = useGlobalSearch((s) => s.clear);
  const { isSuperAdmin: isPlatformAdmin } = useAuthRoles();
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  useEffect(() => {
    if (tenantShell && !ready) bootstrap();
  }, [tenantShell, ready, bootstrap]);
  useEffect(() => {
    clearSearch();
  }, [pathname, clearSearch]);
  useEffect(() => {
    setSidebarOpen((open) => (open ? false : open));
  }, [pathname]);
  useTableCardLabels(mainContentRef);
  useEffect(() => {
    if (!tenantShell) return;
    // Prefetch shared budget-code catalog once so searchable comboboxes open instantly.
    void getBudgetCatalog().catch(() => {});
    void getMasterBudgetActuals().catch(() => {});
    // Keep the shared catalogs fresh: any budget line / Master COA change
    // invalidates the caches, so re-warm them straight away.
    startBudgetCacheRealtime();
    return subscribeBudgetCaches((event) => {
      if (event.scope === "lines") return;
      void getBudgetCatalog(true).catch(() => {});
      void getMasterBudgetActuals(true).catch(() => {});
    });
  }, [tenantShell]);

  useLockBodyScroll(sidebarOpen);

  return (
    <AppShellMountedContext.Provider value={true}>
      {tenantShell && <DataLoadErrorToast />}
      <div className="h-screen flex bg-background text-foreground overflow-hidden">
        {!isGateway && (
          <LayoutErrorBoundary
            label="sidebar-navigation"
            resetKey={shellMode}
            fallback={<SidebarFallback />}
          >
            {shellMode === "platform" ? (
              <PlatformHubSidebar
                mobileOpen={sidebarOpen}
                onNavigate={closeSidebar}
                onClose={closeSidebar}
                isCollapsed={isCollapsed}
                onToggle={toggleCollapse}
              />
            ) : boardShell ? (
              <BoardSidebar
                mobileOpen={sidebarOpen}
                onNavigate={closeSidebar}
                onClose={closeSidebar}
                isCollapsed={isCollapsed}
                onToggle={toggleCollapse}
              />
            ) : (
              <Sidebar
                mobileOpen={sidebarOpen}
                onNavigate={closeSidebar}
                onClose={closeSidebar}
                isCollapsed={isCollapsed}
                onToggle={toggleCollapse}
              />
            )}
          </LayoutErrorBoundary>
        )}

        {sidebarOpen && (
          <button
            type="button"
            aria-label={t("appshell.close_menu")}
            onClick={closeSidebar}
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          />
        )}

        <main
          className="flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out"
          aria-hidden={sidebarOpen ? true : undefined}
        >
          <ImpersonationBanner />
          <header className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 sm:px-4 lg:px-8">
            {!isGateway && (
              <button
                type="button"
                onClick={openSidebar}
                className="p-2 -ml-2 rounded-lg hover:bg-accent hover:text-accent-foreground text-foreground lg:hidden shrink-0"
                aria-label={t("appshell.open_menu")}
              >
                <Menu className="size-5" />
              </button>
            )}

            <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
              {isGateway && (
                <a
                  href="/main-hub"
                  dir="ltr"
                  className="flex items-center shrink-0"
                  aria-label="Kwalis HUB"
                >
                  {/* Mobile: icon mark below sm so the header never wraps. */}
                  <span className="sm:hidden">
                    <img
                      src="/kwalis-icon-dark.png"
                      alt="Kwalis HUB"
                      className="size-7 object-contain block dark:hidden"
                    />
                    <img
                      src="/kwalis-icon.png"
                      alt=""
                      aria-hidden="true"
                      className="size-7 object-contain hidden dark:block"
                    />
                  </span>
                  {/* Desktop: wordmark at sm and above. */}
                  <span className="hidden sm:contents">
                    <img
                      src="/kwalis-logo-dark.png"
                      alt="Kwalis HUB"
                      className="h-7 w-auto object-contain block dark:hidden"
                    />
                    <img
                      src="/kwalis-logo.png"
                      alt=""
                      aria-hidden="true"
                      className="h-7 w-auto object-contain hidden dark:block"
                    />
                  </span>
                </a>
              )}
              {isPlatformAdmin && <PlatformSwitcher />}
              {tenantShell && !isGateway && (
                <>
                  <ActiveProjectIndicator />
                  <ProjectInfoPopover />
                  <ProjectSettingsDialog />
                </>
              )}
            </div>

            <div className="hidden md:flex items-center gap-2 shrink-0">
              <div className="relative w-[200px] lg:w-[300px] max-w-full">
                <Search className="size-4 absolute start-3 top-1/2 -translate-y-1/2 text-brand opacity-70 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("header.search")}
                  aria-label={t("header.search")}
                  className="w-full ps-9 pe-8 py-1.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-brand"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    aria-label={t("appshell.clear_search")}
                    className="absolute end-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
                {tenantShell && <RefSearchResults query={searchQuery} onPick={clearSearch} />}
              </div>

              <InstallAppButton />
              <NotificationBell />
              <ThemeToggleButton />
              <CurrencyToggle />
              <LanguageToggle />
              <HeaderLogoutButton />
            </div>

            <div className="md:hidden shrink-0 flex items-center gap-2">
              <InstallAppButton />
              <NotificationBell />
              <ThemeToggleButton />
              <CurrencyToggle />
              <LanguageToggle />
              <HeaderLogoutButton />
            </div>
          </header>

          <div
            ref={mainContentRef}
            key={tenantShell ? `tenant:proj:${activeProjectId ?? "none"}` : "non-tenant"}
            className="flex-1 p-4 lg:p-8 overflow-auto"
          >
            <LayoutErrorBoundary
              label="main-layout-content"
              resetKey={`${shellMode}:${pathname}:${tenantShell ? (activeProjectId ?? "none") : "global"}`}
              fallback={<ContentFallback />}
            >
              {tenantShell && !isGateway && <NoActiveProjectBanner />}
              {children ?? <Outlet />}
            </LayoutErrorBoundary>
          </div>
        </main>
        <WorkspacePanelModal />
      </div>
    </AppShellMountedContext.Provider>
  );
}

export function BackButton({ to, label = "Back" }: { to?: string; label?: string } = {}) {
  const router = useRouter();
  const go = () => {
    if (to) router.navigate({ to });
    else router.history.back();
  };
  return (
    <button
      type="button"
      onClick={go}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 hover:bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground transition"
    >
      <ArrowLeft className="size-3.5" />
      {label}
    </button>
  );
}

export function PageTitle({
  title,
  action,
  back = true,
}: {
  title: string;
  action?: React.ReactNode;
  back?: boolean;
}) {
  return (
    <div className="mb-5 border-b border-border pb-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {back && <BackButton />}
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        {action}
      </div>
      {/* Production metadata now lives in the top-bar Info popover. */}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-card text-card-foreground p-5 shadow-lg shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl bg-surface border border-border p-6 ${className}`}>{children}</div>
  );
}
