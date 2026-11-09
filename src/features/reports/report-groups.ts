// Reports page navigation (N01–N13): 19 reports in 5 groups.
// Group buttons on top, the reports of the selected group below.
// Order inside a group = tab order; the first report is the group's default.
// The grouping changes navigation only — no report logic changes here.
import type { ProjectRole } from "@/lib/project-role";

export const REPORT_GROUPS = [
  { id: "cost", module: "reports-budget-cost", reports: ["cost", "livebal", "gosi", "budgetlog"] },
  {
    id: "payables",
    module: "reports-payables",
    reports: ["due", "aging", "openpo", "dealsummary", "perdiem", "paid"],
  },
  { id: "cash", module: "reports-cash", reports: ["cashpos", "bankrec", "pettyrec", "vat"] },
  { id: "accounting", module: "reports-accounting", reports: ["ledger", "tb"] },
  { id: "commission", module: "reports-commission", reports: ["rebate", "crewlist", "gsr"] },
] as const;

export type ReportGroupId = (typeof REPORT_GROUPS)[number]["id"];
export type ReportId = (typeof REPORT_GROUPS)[number]["reports"][number];

export const REPORT_GROUP_MODULES: string[] = REPORT_GROUPS.map((g) => g.module);

export function groupOf(report: string): ReportGroupId | null {
  for (const g of REPORT_GROUPS) if ((g.reports as readonly string[]).includes(report)) return g.id;
  return null;
}

export function isReportGroupId(v: unknown): v is ReportGroupId {
  return typeof v === "string" && REPORT_GROUPS.some((g) => g.id === v);
}

/**
 * Groups a user without a role-matrix assignment sees, by project role
 * (the "users" column of the client's grouping sheet). null role = no
 * project restriction (owner / org admin / no membership row).
 */
const LEGACY_GROUPS: Record<ProjectRole, ReportGroupId[]> = {
  owner: ["cost", "payables", "cash", "accounting", "commission"],
  admin: ["cost", "payables", "cash", "accounting", "commission"],
  accountant: ["cost", "payables", "cash", "accounting", "commission"],
  producer: ["cost", "payables", "commission"],
  coordinator: [],
  member: ["cost"],
};

export type GroupAccessInput = {
  /** Role-matrix assignment active (or platform super admin). */
  matrixActive: boolean;
  /** can(module, "view") from the matrix. */
  canView: (moduleKey: string) => boolean;
  /** Module keys the user holds a view row on (to detect a server without the group modules). */
  heldModules: string[];
  isAdmin: boolean;
  projectRole: ProjectRole | null;
};

/** Which report groups the user may open. Pure: unit-tested. */
export function allowedReportGroups(input: GroupAccessInput): ReportGroupId[] {
  const all = REPORT_GROUPS.map((g) => g.id);
  if (input.isAdmin) return all;
  if (input.matrixActive) {
    if (!input.canView("reports")) return [];
    // Server without the per-group modules yet: the single Reports permission covers every group.
    const hasGroupRows = input.heldModules.some((k) => REPORT_GROUP_MODULES.includes(k));
    if (!hasGroupRows) return all;
    return REPORT_GROUPS.filter((g) => input.canView(g.module)).map((g) => g.id);
  }
  if (!input.projectRole) return all;
  return LEGACY_GROUPS[input.projectRole] ?? [];
}

/** Resolve the group + report to open from the URL / remembered choice. */
export function resolveSelection(
  allowed: ReportGroupId[],
  want: { group?: string | null; report?: string | null },
  remembered?: { group?: string; report?: string } | null,
): { group: ReportGroupId | null; report: ReportId | null; denied: boolean } {
  if (allowed.length === 0) return { group: null, report: null, denied: true };
  const pick = (g: ReportGroupId, r?: string | null) => {
    const def = REPORT_GROUPS.find((x) => x.id === g)!;
    const rep = r && (def.reports as readonly string[]).includes(r) ? r : def.reports[0];
    return { group: g, report: rep as ReportId, denied: false };
  };
  // A direct link names a report (and maybe its group).
  if (want.report) {
    const g = groupOf(want.report);
    if (!g) return pick(allowed[0]);
    if (!allowed.includes(g)) return { group: null, report: null, denied: true };
    return pick(g, want.report);
  }
  if (want.group) {
    if (!isReportGroupId(want.group)) return pick(allowed[0]);
    if (!allowed.includes(want.group)) return { group: null, report: null, denied: true };
    return pick(want.group);
  }
  if (remembered?.group && isReportGroupId(remembered.group) && allowed.includes(remembered.group))
    return pick(remembered.group, remembered.report);
  return pick(allowed[0]);
}

/** Case-insensitive search over the report names in both languages (N05). */
export function searchReports(
  q: string,
  names: Record<string, string[]>,
  allowed: ReportGroupId[],
): ReportId[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const out: ReportId[] = [];
  for (const g of REPORT_GROUPS) {
    if (!allowed.includes(g.id)) continue;
    for (const r of g.reports) {
      if ((names[r] ?? []).some((n) => n.toLowerCase().includes(s))) out.push(r);
    }
  }
  return out;
}
