import {
  buildBudgetHeaderOptions,
  fullLineLabel,
  lineDisplayName,
  subAccountsForHeader,
  fetchProjectBudgetLines,
  type ProjectBudgetLine,
} from "@/lib/project-budget-lines";

/**
 * Memoized option builders for the cascading budget mapping dropdown.
 *
 * The same project budget lines are re-used by Invoices, Crew Contracts and
 * Cast Contracts. Recomputing header/sub-account option lists on every mount
 * makes navigating between accounting and contracts feel sluggish on large
 * budgets (thousands of rows), so results are cached per lines array
 * (WeakMap => garbage collected with the data) and per header code.
 */

export type HeaderOption = {
  value: string;
  code: string;
  label: string;
  keywords: string;
};

export type SubAccountOption = {
  value: string;
  code: string;
  label: string;
  keywords: string;
};

type Entry = {
  headers: HeaderOption[] | null;
  subs: Map<string, SubAccountOption[]>;
  subLines: Map<string, ProjectBudgetLine[]>;
  byId: Map<string, ProjectBudgetLine> | null;
};

const cache = new WeakMap<ProjectBudgetLine[], Entry>();

function entryFor(lines: ProjectBudgetLine[]): Entry {
  let e = cache.get(lines);
  if (!e) {
    e = { headers: null, subs: new Map(), subLines: new Map(), byId: null };
    cache.set(lines, e);
  }
  return e;
}

export function headerOptions(lines: ProjectBudgetLine[]): HeaderOption[] {
  const e = entryFor(lines);
  if (!e.headers) {
    e.headers = buildBudgetHeaderOptions(lines).map((h) => ({
      value: h.headerCode,
      code: h.headerCode,
      label: h.label || "—",
      keywords: h.fullLabel,
    }));
  }
  return e.headers;
}

export function subAccountLines(
  lines: ProjectBudgetLine[],
  headerCode: string,
): ProjectBudgetLine[] {
  const e = entryFor(lines);
  const key = headerCode || "";
  let rows = e.subLines.get(key);
  if (!rows) {
    rows = subAccountsForHeader(lines, key);
    e.subLines.set(key, rows);
  }
  return rows;
}

export function subAccountOptions(
  lines: ProjectBudgetLine[],
  headerCode: string,
): SubAccountOption[] {
  const e = entryFor(lines);
  const key = headerCode || "";
  let opts = e.subs.get(key);
  if (!opts) {
    opts = subAccountLines(lines, key).map((s) => ({
      value: s.id,
      code: s.mainCode,
      label: lineDisplayName(s, lines) || "—",
      keywords: `${fullLineLabel(s)} ${s.group} ${s.id}`,
    }));
    e.subs.set(key, opts);
  }
  return opts;
}

export function lineById(lines: ProjectBudgetLine[], id: string | null): ProjectBudgetLine | null {
  if (!id) return null;
  const e = entryFor(lines);
  if (!e.byId) e.byId = new Map(lines.map((l) => [l.id, l]));
  return e.byId.get(id) ?? null;
}

// ---------------------------------------------------------------------
// Project-level fetch cache: shared across route remounts so switching
// between Accounting and Crew/Cast contracts does not refetch the budget.
// ---------------------------------------------------------------------
const TTL_MS = 60_000;
const fetchCache = new Map<string, { at: number; rows: ProjectBudgetLine[] }>();
const inflight = new Map<string, Promise<ProjectBudgetLine[]>>();

export function cachedProjectBudgetLines(projectId: string): ProjectBudgetLine[] | null {
  const hit = fetchCache.get(projectId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  return null;
}

export function loadProjectBudgetLines(projectId: string): Promise<ProjectBudgetLine[]> {
  const hit = cachedProjectBudgetLines(projectId);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(projectId);
  if (pending) return pending;
  const p = fetchProjectBudgetLines(projectId)
    .then((rows) => {
      fetchCache.set(projectId, { at: Date.now(), rows });
      return rows;
    })
    .finally(() => {
      inflight.delete(projectId);
    });
  inflight.set(projectId, p);
  return p;
}

export function invalidateProjectBudgetLines(projectId?: string) {
  if (projectId) fetchCache.delete(projectId);
  else fetchCache.clear();
}
