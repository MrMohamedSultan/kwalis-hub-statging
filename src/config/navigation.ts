// ═══════════════════════════════════════════════════════════════════
// src/config/navigation.ts — Sidebar Navigation Configuration
// ═══════════════════════════════════════════════════════════════════
//
//   1. Settings / Account / Support are deduplicated — footer only.
//   2. "Top Sheet" renamed to "Budget" in the main menu.
//   3. Categories ordered by the film production lifecycle.
//   4. Audit Log lives in DIRECTORIES & ADMIN (standard tenant layout).
//
// Paths below map 1:1 to real routes under src/routes/_authenticated.
// ═══════════════════════════════════════════════════════════════════

export interface NavItem {
  id: string;
  /** i18n key — always rendered through t() */
  label: string;
  path: string;
  /** lucide icon name resolved by the sidebar */
  icon: string;
  children?: NavItem[];
  /** required RBAC permission to show the item */
  permission?: string;
}

export interface NavSection {
  id: string;
  /** i18n key for the section header; empty string renders no header */
  label: string;
  items: NavItem[];
}

// ─── Main Navigation Sections ───────────────────────────────────
// Overview → Money → People → Spending → Cash → Logistics → Admin

export const SIDEBAR_SECTIONS: NavSection[] = [
  {
    id: "overview",
    label: "",
    items: [
      { id: "dashboard", label: "nav.dashboard", path: "/dashboard", icon: "LayoutDashboard" },
    ],
  },

  {
    id: "budget-reporting",
    label: "nav.sections.budgetReporting",
    items: [
      {
        id: "top-sheet-report",
        label: "nav.topSheetReport",
        path: "/top-sheet-report",
        icon: "BarChart3",
        permission: "reports.view",
      },
      {
        id: "budget",
        label: "nav.budget",
        path: "/budget",
        icon: "FileSpreadsheet",
        permission: "budget.view",
      },
      {
        id: "reports",
        label: "nav.reports",
        path: "/reports",
        icon: "FileBarChart",
        permission: "reports.view",
      },
      {
        id: "budget-reconciliation",
        label: "nav.budgetReconciliation",
        path: "/budget-reconciliation",
        icon: "Scale",
        permission: "reports.view",
      },
    ],
  },

  {
    id: "treasury-cash",
    label: "nav.sections.treasuryCash",
    items: [
      {
        id: "petty-cash",
        label: "nav.pettyCash",
        path: "/petty-cash",
        icon: "Coins",
        permission: "accounting.view",
      },
      {
        id: "funding",
        label: "nav.funding",
        path: "/funding",
        icon: "Landmark",
        permission: "accounting.view",
      },
      {
        id: "gl-accounts",
        label: "nav.glAccounts",
        path: "/gl-accounts",
        icon: "BookOpen",
        permission: "accounting.view",
      },
    ],
  },

  {
    id: "payroll-crew",
    label: "nav.sections.payrollCrew",
    items: [
      {
        id: "crew-contracts",
        label: "nav.crewContracts",
        path: "/crew",
        icon: "HardHat",
        permission: "crew.manage",
      },
      {
        id: "cast-contracts",
        label: "nav.castContracts",
        path: "/cast",
        icon: "Clapperboard",
        permission: "crew.manage",
      },
      {
        id: "per-diem",
        label: "nav.perDiemLedger",
        path: "/per-diem-ledger",
        icon: "CalendarClock",
        permission: "payroll.view",
      },
      {
        id: "payroll-hub",
        label: "nav.payrollHub",
        path: "/payroll-hub",
        icon: "Banknote",
        permission: "payroll.view",
      },
    ],
  },

  {
    id: "procurement-payables",
    label: "nav.sections.procurementPayables",
    items: [
      {
        id: "vendors",
        label: "nav.vendors",
        path: "/vendors",
        icon: "Building2",
        permission: "accounting.view",
      },
      {
        id: "purchase-orders",
        label: "nav.purchaseOrders",
        path: "/purchase-orders",
        icon: "ClipboardList",
        permission: "accounting.view",
      },
      {
        id: "invoices",
        label: "nav.invoices",
        path: "/invoices",
        icon: "Receipt",
        permission: "accounting.view",
      },
      {
        id: "vendor-payables",
        label: "nav.vendorPayables",
        path: "/vendor-payables",
        icon: "ArrowUpRight",
        permission: "accounting.view",
      },
      {
        id: "crew-cast-payables",
        label: "nav.crewCastPayables",
        path: "/crew-cast-payables",
        icon: "Wallet",
        permission: "payroll.view",
      },
      {
        id: "payment-approvals",
        label: "nav.paymentApprovals",
        path: "/payment-approvals",
        icon: "BadgeCheck",
        permission: "payments.approve",
      },
    ],
  },

  {
    id: "scripts",
    label: "nav.sections.scripts",
    items: [
      {
        id: "characters",
        label: "nav.characters",
        path: "/characters",
        icon: "Drama",
        permission: "crew.manage",
      },
    ],
  },

  {
    id: "production-timeline",
    label: "nav.sections.productionTimeline",
    items: [
      {
        id: "timeline",
        label: "nav.productionTimeline",
        path: "/production-timeline",
        icon: "GanttChart",
      },
      {
        id: "timeline-task-dictionary",
        label: "nav.timelineTaskDictionary",
        path: "/timeline-task-dictionary",
        icon: "BookMarked",
        permission: "system.settings",
      },
    ],
  },

  {
    id: "production-logistics",
    label: "nav.sections.productionLogistics",
    items: [
      {
        id: "locations",
        label: "nav.locations",
        path: "/locations",
        icon: "MapPin",
        permission: "crew.manage",
      },
      {
        id: "transport",
        label: "nav.dailyTransport",
        path: "/daily-transport",
        icon: "Bus",
        permission: "crew.manage",
      },
      {
        id: "accommodation",
        label: "nav.accommodationRoster",
        path: "/accommodation-roster",
        icon: "Hotel",
        permission: "crew.manage",
      },
      {
        id: "car-rentals",
        label: "nav.carRentals",
        path: "/car-rentals",
        icon: "Car",
        permission: "crew.manage",
      },
      {
        id: "picture-assets",
        label: "nav.pictureAssets",
        path: "/picture-assets",
        icon: "Truck",
        permission: "crew.manage",
      },
    ],
  },

  {
    id: "directories-admin",
    label: "nav.sections.directoriesAdmin",
    items: [
      {
        id: "file-library",
        label: "nav.fileLibrary",
        path: "/project-files",
        icon: "FolderOpen",
        permission: "files.library",
      },
      { id: "notifications", label: "nav.notifications", path: "/notifications", icon: "Bell" },
      {
        id: "audit-log",
        label: "nav.auditLog",
        path: "/audit-log",
        icon: "ScrollText",
        permission: "system.settings",
      },
      { id: "system-settings", label: "nav.systemSettings", path: "/settings", icon: "Settings" },
      {
        id: "role-management",
        label: "nav.roleManagement",
        path: "/role-management",
        icon: "ShieldCheck",
        permission: "system.settings",
      },
    ],
  },
];

/** Series management is appended to Scripts only for series productions. */
export const SERIES_NAV_ITEM: NavItem = {
  id: "series",
  label: "nav.seriesManagement",
  path: "/series",
  icon: "Tv",
};

// ─── Footer Items (pinned to the bottom, never duplicated above) ──
export const FOOTER_ITEMS: NavItem[] = [
  {
    id: "account-settings",
    label: "nav.accountSettings",
    path: "/account-settings",
    icon: "UserCog",
  },
  { id: "support", label: "nav.support", path: "/support", icon: "LifeBuoy" },
];
