import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  PieChart,
  FileText,
  FileSpreadsheet,
  BarChart3,
  Scale,
  Wallet,
  Users,
  Bell,
  Settings,
  Trash2,
  LogOut,
  Sun,
  Moon,
  ShieldCheck,
  Crown,
  Mail,
  ScrollText,
  LayoutGrid,
  BookOpen,
  LifeBuoy,
  Headphones,
  Banknote,
  Tv,
  Hotel,
  Car,
  Bus,
  Coins,
  Truck,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  HardHat,
  CalendarClock,
  Landmark,
  FolderOpen,
  BadgeCheck,
  GanttChart,
  ArrowUpRight,
  Cog,
  Receipt,
  ClipboardList,
  MapPin,
  ShoppingCart,
  UserCog,
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
  BookMarked,
  CalendarRange,
  Drama,
  FileBarChart,
} from "lucide-react";

import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { signOut } from "@/lib/auth";
import { useCurrentUser, type Permission } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import { useExecutiveTitle } from "@/lib/budget-governance";
import { APP_NAME } from "@/lib/i18n";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { getShellMode } from "@/lib/shell-routes";
import { useProjectRole, canViewModuleForSnapshot } from "@/lib/project-role";
import { usePermissions } from "@/lib/permissions/usePermissions";
import {
  canEnterExecutiveWorkMode,
  useExecutiveWorkMode,
} from "@/lib/executive-work-mode";
import { BetaBadge } from "@/components/BetaBadge";
import { SIDEBAR_SECTIONS, FOOTER_ITEMS, SERIES_NAV_ITEM, type NavItem } from "@/config/navigation";

const ICONS: Record<string, any> = {
  LayoutDashboard,
  FileSpreadsheet,
  BarChart3,
  Scale,
  PieChart,
  HardHat,
  Clapperboard,
  Banknote,
  CalendarClock,
  Building2,
  ClipboardList,
  Receipt,
  ArrowUpRight,
  Wallet,
  BadgeCheck,
  Coins,
  Landmark,
  BookOpen,
  MapPin,
  GanttChart,
  Bus,
  Hotel,
  Car,
  Truck,
  Users,
  Tv,
  FolderOpen,
  Bell,
  ScrollText,
  Settings,
  UserCog,
  LifeBuoy,
  ShieldCheck,
  BookMarked,
  Drama,
  FileBarChart,
};

type Item = {
  to: string;
  label: string;
  icon: any;
  exact?: boolean;
  perm?: Permission;
  search?: Record<string, any>;
  superAdminOnly?: boolean;
  children?: Item[];
};
type Group = { key: string; label: string; icon: any; defaultOpen?: boolean; items: Item[] };

const NO_SIDEBAR_PROJECTS: ReturnType<typeof useStore.getState>["projects"] = [];

const VALID_GROUP_KEYS = new Set(["admin", ...SIDEBAR_SECTIONS.map((s) => s.id)]);

const SECTION_ICONS: Record<string, any> = {
  "budget-reporting": PieChart,
  "payroll-crew": Users,
  "procurement-payables": ShoppingCart,
  "treasury-cash": Banknote,
  scripts: ScrollText,
  "production-timeline": CalendarRange,
  "production-logistics": Clapperboard,
  "directories-admin": Cog,
};

function SidebarComponent({
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
} = {}) {
  const containerRef = useFocusTrap(mobileOpen, onClose);

  const location = useLocation();
  const { theme, toggle } = useTheme();
  const user = useCurrentUser();
  const roles = useAuthRoles();
  const { t } = useTranslation();
  // Sidebar mode is derived strictly from the URL — never from user role or
  // active-project state.
  const pathname = location.pathname;
  const shellMode = getShellMode(pathname);
  const isTenantShell = shellMode === "tenant";
  const isPlatformShell = shellMode === "platform";

  const activeProjectId = useStore((s) => (isTenantShell ? s.activeProjectId : null));
  const setActiveProject = useStore((s) => s.setActiveProject);
  const projects = useStore((s) => (isTenantShell ? s.projects : NO_SIDEBAR_PROJECTS));
  const activeProject = isTenantShell
    ? (projects.find((p) => p.id === activeProjectId) ?? null)
    : null;
  const isSeriesProject = activeProject?.productionKind === "series";

  const { title: executiveTitle } = useExecutiveTitle(isTenantShell);

  // Project-scoped RBAC: the user's role in the ACTIVE project narrows the
  // tenant nav (e.g. Coordinator → Dashboard + Payroll & Crew only). Until
  // the role snapshot resolves, render unfiltered — the beforeLoad route
  // guard is the hard boundary and awaits the same snapshot.
  const projectRole = useProjectRole();
  // ── Phase 6 · Layer 2: Dynamic Permission Matrix ─────────────────────
  // Once an RBAC role is assigned (or the user is a platform super admin),
  // sidebar visibility renders ENTIRELY from the server-verified matrix
  // (usePermissions().modules via can()). Users with no assignment keep
  // the legacy project-role snapshot until the Phase 8 backfill — the
  // agreed non-breaking rollout.
  const perms = usePermissions();
  const workMode = useExecutiveWorkMode(roles.userId);
  const operationalOverride =
    workMode && roles.loaded && canEnterExecutiveWorkMode(roles, perms);
  const isExecutive = isTenantShell && !!executiveTitle && !operationalOverride;
  const matrixActive =
    isTenantShell &&
    !operationalOverride &&
    perms.status === "ready" &&
    (!!perms.role || perms.isSuperAdmin);
  const moduleVisible = useCallback(
    (moduleKey: string) => {
      if (!isTenantShell) return true;
      if (matrixActive) return perms.can(moduleKey, "view");
      if (!projectRole.ready) return true;
      return canViewModuleForSnapshot(projectRole, moduleKey);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isTenantShell, matrixActive, perms, projectRole.ready, projectRole.role],
  );

  const executiveItems: Item[] = useMemo(
    () => [
      { to: "/dashboard", label: t("nav.dashboard"), icon: LayoutDashboard },
      { to: "/budget", label: t("nav.budget"), icon: PieChart },
      { to: "/reports", label: t("nav.reports"), icon: FileText },
      { to: "/notifications", label: t("nav.notifications"), icon: Bell },
    ],
    [t],
  );

  const platformAdminItems: Item[] = useMemo(
    () => [
      {
        to: "/platform-hub",
        label: "Platform Hub",
        icon: Crown,
        perm: "workspace.org",
        exact: true,
      },
      {
        to: "/platform-hub/companies",
        label: t("nav.clientCompanies"),
        icon: Building2,
        perm: "workspace.org",
      },
      { to: "/platform-hub/users", label: t("nav.usersAccess"), icon: Mail, perm: "workspace.org" },
      {
        to: "/platform-hub/roles",
        label: t("nav.systemRoles"),
        icon: ShieldCheck,
        perm: "workspace.org",
      },
      {
        to: "/support-desk",
        label: t("nav.supportDesk"),
        icon: Headphones,
        perm: "workspace.org",
      },
      { to: "/trash", label: t("nav.trash"), icon: Trash2, perm: "system.settings" },
    ],
    [t],
  );

  // Config-driven tenant navigation (film production lifecycle order).
  const toItem = useCallback(
    (n: NavItem): Item => ({
      to: n.path,
      label: t(n.label),
      icon: ICONS[n.icon] ?? FileText,
      perm: n.permission as Permission | undefined,
      children: n.children?.filter((c) => moduleVisible(c.id)).map(toItem),
    }),
    [t, moduleVisible],
  );

  const tenantGroups: Group[] = useMemo(
    () =>
      SIDEBAR_SECTIONS.filter((s) => s.id !== "overview")
        .map((section) => {
          const visibleItems = section.items.filter((n) => moduleVisible(n.id));
          if (
            section.id === "scripts" &&
            isSeriesProject &&
            moduleVisible(SERIES_NAV_ITEM.id)
          ) {
            visibleItems.push(SERIES_NAV_ITEM);
          }
          return { section, visibleItems };
        })
        .filter(({ visibleItems }) => visibleItems.length > 0)
        .map(({ section, visibleItems }) => ({
          key: section.id,
          label: t(section.label),
          icon: SECTION_ICONS[section.id] ?? Cog,
          defaultOpen: section.id === "budget-reporting",
          items: visibleItems.map(toItem),
        })),
    [isSeriesProject, t, toItem, moduleVisible],
  );

  const allowed = useCallback(
    (it: Item) =>
      // When the matrix governs, moduleVisible() already filtered every
      // item — the legacy fine-grained perm list would only double-filter
      // with stale data. Platform-shell items keep the legacy check.
      operationalOverride
        ? true
        : matrixActive
        ? true
        : (!it.perm || user.permissions.includes(it.perm)) &&
          (!it.superAdminOnly || roles.isSuperAdmin),
    [matrixActive, operationalOverride, roles.isSuperAdmin, user.permissions],
  );

  const isActive = useCallback(
    (to: string, exact?: boolean) =>
      exact ? location.pathname === to : location.pathname.startsWith(to),
    [location.pathname],
  );

  const groups: Group[] = useMemo(
    () =>
      isPlatformShell
        ? [
            {
              key: "admin",
              label: t("nav.administration"),
              icon: Cog,
              defaultOpen: true,
              items: platformAdminItems,
            },
          ]
        : isExecutive
          ? []
          : tenantGroups,
    [isExecutive, isPlatformShell, platformAdminItems, tenantGroups, t],
  );

  // Auto-open a group whose current route matches, so the active branch is visible on refresh.
  const groupHasActive = useCallback(
    (g: Group) => g.items.some((it) => allowed(it) && isActive(it.to, it.exact)),
    [allowed, isActive],
  );

  // Group open/closed state, persisted per user under a versioned key so two
  // accounts on one machine never share it. Defaults are unchanged when the
  // store is empty or unavailable. If no user id is known yet, do not write
  // an unkeyed/shared entry.
  const groupsStorageKey = user.id ? `kwalis:sidebar:groups:v1:${user.id}` : null;

  const [openState, setOpenState] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of SIDEBAR_SECTIONS) init[g.id] = g.id === "budget-reporting";
    return init;
  });

  // Restore on mount (and when the signed-in user changes).
  useEffect(() => {
    if (!groupsStorageKey) return;
    try {
      const raw = window.localStorage.getItem(groupsStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const cleaned: Record<string, boolean> = {};
        for (const key of Object.keys(parsed)) {
          if (VALID_GROUP_KEYS.has(key)) cleaned[key] = parsed[key];
        }
        setOpenState((s) => ({ ...s, ...cleaned }));
      }
    } catch {
      /* storage unavailable — keep defaults */
    }
  }, [groupsStorageKey]);

  const isOpen = (g: Group) => openState[g.key] ?? (groupHasActive(g) || !!g.defaultOpen);
  const toggleGroup = (k: string) => {
    setOpenState((s) => {
      const next = { ...s, [k]: !s[k] };
      if (groupsStorageKey) {
        try {
          window.localStorage.setItem(groupsStorageKey, JSON.stringify(next));
        } catch {
          /* noop */
        }
      }
      return next;
    });
  };


  // Desktop-only rail: labels/chevrons collapse at >=lg, mobile drawer keeps them.
  const hideText = isCollapsed ? "lg:w-0 lg:opacity-0 lg:overflow-hidden lg:hidden" : "";
  const railRow = isCollapsed ? "lg:justify-center lg:px-0" : "";

  const renderItem = useCallback(
    (it: Item, depth = 0): React.ReactNode => {
      const searchKind = it.search?.kind as string | undefined;
      const currentKind = (location.search as any)?.kind as string | undefined;
      const active = isActive(it.to, it.exact) && (!searchKind || searchKind === currentKind);
      const Icon = it.icon;
      const key = `${it.to}${searchKind ? `?kind=${searchKind}` : ""}`;
      const visibleChildren = (it.children ?? []).filter(allowed);
      const childActive = visibleChildren.some((c) => isActive(c.to, c.exact));

      const link = (
        <Link
          key={key}
          to={it.to as any}
          search={it.search as any}
          onClick={onNavigate}
          title={it.label}
          className={`flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-[13.5px] transition-all ${railRow} ${
            active
              ? "bg-sidebar-active text-white shadow-lg shadow-black/30 ring-1 ring-white/10"
              : "hover:bg-white/10"
          }`}
        >
          <Icon className="size-4 shrink-0" />
          <span
            className={`font-medium truncate whitespace-nowrap transition-all duration-200 ${hideText}`}
          >
            {it.label}
          </span>
          {visibleChildren.length > 0 && (
            <ChevronRight
              className={`size-3.5 ms-auto shrink-0 transition-transform ${hideText} ${
                active || childActive ? "rotate-90" : ""
              }`}
            />
          )}
        </Link>
      );

      if (visibleChildren.length === 0) return link;

      return (
        <div key={key} className="flex flex-col gap-0.5">
          {link}
          {(active || childActive) && (
            <div
              className={`flex flex-col gap-0.5 ps-2 ms-4 border-s border-white/10 ${
                isCollapsed ? "lg:ps-0 lg:ms-0 lg:border-s-0" : ""
              }`}
            >
              {visibleChildren.map((c) => renderItem(c, depth + 1))}
            </div>
          )}
        </div>
      );
    },
    [allowed, isActive, location.search, onNavigate, hideText, railRow, isCollapsed],
  );

  return (
    <aside
      ref={containerRef as any}
      className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col h-full overflow-y-auto pt-4 px-3 pb-3 transform transition-all duration-300 ease-in-out lg:static lg:translate-x-0 lg:z-auto ${
        isCollapsed ? "lg:w-16 lg:px-2" : "lg:w-64"
      } ${
        mobileOpen
          ? "translate-x-0 shadow-2xl shadow-black/50"
          : "-translate-x-full lg:translate-x-0"
      }`}
      role={mobileOpen ? "dialog" : undefined}
      aria-modal={mobileOpen ? "true" : undefined}
      aria-label={t("sidebar.navigation_menu")}
    >
      <div className="flex flex-col pt-3 pb-2 px-3 gap-2">
        <div className="flex flex-col gap-2 min-w-0">
          <div
            dir="ltr"
            className={`flex items-center gap-2 mb-2 text-sidebar-foreground ${
              isCollapsed ? "lg:flex-col lg:gap-1" : ""
            }`}
          >
            {isCollapsed ? (
              <img
                src="/kwalis-icon.png"
                alt={APP_NAME}
                className="size-8 object-contain mx-auto shrink-0"
              />
            ) : (
              <img
                src="/kwalis-logo.png"
                alt={APP_NAME}
                className="w-36 h-auto object-contain object-left-top shrink-0"
              />
            )}
            <BetaBadge className={isCollapsed ? "lg:hidden" : ""} />

            {onToggle && (
              <button
                type="button"
                onClick={onToggle}
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className={`hidden lg:inline-flex items-center justify-center rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition ${
                  isCollapsed ? "lg:mx-auto" : "ms-auto"
                }`}
              >
                {isCollapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
            )}
          </div>
          <div
            className={`text-[9px] uppercase tracking-widest text-white/70 truncate transition-all duration-200 ${hideText}`}
          >
            {user.name} · {executiveTitle ?? user.role}
            {user.jobTitle ? ` · ${user.jobTitle}` : ""}
          </div>
        </div>
      </div>



      {isTenantShell && (
        <Link
          to="/main-hub"
          onClick={() => {
            // Gateway lock-in: leaving the workspace clears the active project.
            // The Main Hub is the ONLY way to select or switch projects.
            void setActiveProject(null);
            onNavigate?.();
          }}
          className={`flex items-center gap-3 px-2.5 py-2 rounded-xl text-[14px] mt-1 bg-gradient-to-r from-brand/30 to-brand/10 ring-1 ring-brand/40 hover:from-brand/40 hover:to-brand/20 transition shrink-0 ${railRow}`}
          title={t("nav.mainHub")}
        >
          <LayoutGrid className="size-5 shrink-0" />
          <span
            className={`font-semibold truncate whitespace-nowrap transition-all duration-200 ${hideText}`}
          >
            ← {t("nav.mainHub")}
          </span>
        </Link>
      )}

      {/* Dashboard is always top-level (matrix-gated for assigned roles) */}
      {isTenantShell && !isExecutive && moduleVisible("dashboard") && (
        <Link
          to="/dashboard"
          onClick={onNavigate}
          title={t("nav.dashboard")}
          className={`flex items-center gap-3 px-2.5 py-1.5 rounded-lg text-[13.5px] mt-1 shrink-0 transition-all ${railRow} ${
            isActive("/dashboard")
              ? "bg-sidebar-active text-white ring-1 ring-white/10"
              : "hover:bg-white/10"
          }`}
        >
          <LayoutDashboard className="size-4 shrink-0" />
          <span
            className={`font-medium truncate whitespace-nowrap transition-all duration-200 ${hideText}`}
          >
            {t("nav.dashboard")}
          </span>
        </Link>
      )}

      {/* ── MAIN NAV (grows naturally; the <aside> is the single scroll region) ── */}
      <nav className="flex flex-col gap-0.5 mt-2">
        {isTenantShell && isExecutive && executiveItems.map((it) => renderItem(it))}

        {groups.map((g) => {
          const open = isOpen(g);
          const GIcon = g.icon;
          const visibleItems = g.items.filter(allowed);
          if (visibleItems.length === 0) return null;
          const sectionActive = visibleItems.some(
            (it) =>
              isActive(it.to, it.exact) || (it.children ?? []).some((c) => isActive(c.to, c.exact)),
          );
          return (
            <div key={g.key} className="mb-0.5 relative group/sec">
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                aria-expanded={open}
                title={g.label}
                className={`w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-[11px] uppercase tracking-[0.08em] font-medium text-white/45 hover:bg-white/5 hover:text-white/70 transition-colors ${railRow} ${
                  isCollapsed && sectionActive ? "lg:bg-sidebar-active lg:text-white" : ""
                }`}
              >
                {/* Category icon exists only in the collapsed rail, where it is
                    the sole affordance. Expanded headers are label + chevron. */}
                {isCollapsed && <GIcon className="hidden lg:block size-4 shrink-0" />}
                <span
                  className={`flex-1 text-start truncate whitespace-nowrap transition-all duration-200 ${hideText}`}
                >
                  {g.label}
                </span>
                <ChevronDown
                  className={`size-3.5 shrink-0 transition-transform ${hideText} ${open ? "rotate-180" : ""}`}
                />
              </button>


              {/* Desktop flyout when collapsed */}
              {isCollapsed && (
                <div className="hidden lg:group-hover/sec:block lg:group-focus-within/sec:block absolute start-full top-0 ms-2 z-[60] w-60 rounded-xl border border-white/10 bg-sidebar text-sidebar-foreground p-2 shadow-2xl shadow-black/40">
                  <div className="px-2 pb-1.5 mb-1 border-b border-white/10 text-[11px] uppercase tracking-wider font-bold text-white/60">
                    {g.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {visibleItems.flatMap((it) =>
                      [it, ...(it.children ?? []).filter(allowed)].map((sub, idx) => (
                        <Link
                          key={`${g.key}-${sub.to}-${idx}`}
                          to={sub.to as any}
                          search={sub.search as any}
                          onClick={onNavigate}
                          className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-[13.5px] transition-colors ${
                            idx > 0 ? "ms-4" : ""
                          } ${
                            isActive(sub.to, sub.exact)
                              ? "bg-sidebar-active text-white"
                              : "hover:bg-white/10"
                          }`}
                        >
                          <sub.icon className="size-4 shrink-0" />
                          <span className="font-medium truncate">{sub.label}</span>
                        </Link>
                      )),
                    )}
                  </div>
                </div>
              )}

              <div
                className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
                  isCollapsed ? "lg:hidden" : ""
                } ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
              >
                <div className="min-h-0">
                  <div
                    className={`flex flex-col gap-0.5 ps-2 py-0.5 border-s border-white/10 ms-3 ${
                      isCollapsed ? "lg:ps-0 lg:ms-0 lg:border-s-0" : ""
                    }`}
                  >
                    {visibleItems.map((it) => renderItem(it))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── FOOTER (end of flow; scrolls with the column) ── */}
      <div className="flex flex-col gap-0.5 mt-auto pt-2 pb-1 border-t border-white/15">

        <button
          onClick={toggle}
          className={`flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-white/10 text-start ${railRow}`}
          aria-label={t("sidebar.toggle_theme")}
          title={theme === "dark" ? "Switch to Professional Light" : "Switch to Cinematic Dark"}
        >
          {theme === "dark" ? (
            <Sun className="size-4 shrink-0" />
          ) : (
            <Moon className="size-4 shrink-0" />
          )}
          <span
            className={`font-medium truncate whitespace-nowrap text-[13.5px] transition-all duration-200 ${hideText}`}
          >
            {theme === "dark" ? t("nav.lightTheme") : t("nav.darkTheme")}
          </span>
        </button>

        {FOOTER_ITEMS.map((item) => {
          const Icon = ICONS[item.icon] ?? Settings;
          return (
            <Link
              key={item.id}
              to={item.path as any}
              onClick={onNavigate}
              title={t(item.label)}
              className={`flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-white/10 text-start ${railRow}`}
            >
              <Icon className="size-4 shrink-0" />
              <span
                className={`font-medium truncate whitespace-nowrap text-[13.5px] transition-all duration-200 ${hideText}`}
              >
                {t(item.label)}
              </span>
            </Link>
          );
        })}

        <Link
          to="/auth"
          onClick={() => signOut()}
          title={t("nav.logout")}
          className={`flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-white/10 text-start ${railRow}`}
        >
          <LogOut className="size-4 shrink-0" />
          <span
            className={`font-medium truncate whitespace-nowrap text-[13.5px] transition-all duration-200 ${hideText}`}
          >
            {t("nav.logout")}
          </span>
        </Link>
      </div>
    </aside>
  );
}

export const Sidebar = memo(SidebarComponent);
