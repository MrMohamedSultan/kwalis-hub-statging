// ═══════════════════════════════════════════════════════════════════
// src/routes/_board/board.dashboard.tsx
// ═══════════════════════════════════════════════════════════════════
// Board Member Dashboard — clean, high-level project overview.
// ═══════════════════════════════════════════════════════════════════

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toBoardStatus, type BoardBudgetStatus } from "@/lib/board-budget-status";
import { formatAmount } from "@/lib/format-number";

import { useTranslation } from "react-i18next";
interface ProjectSummary {
  id: string;
  name: string;
  code: string | null;
  status: string | null;
  budget_status: BoardBudgetStatus;
  total_budget_sar: number;
  actual_spent_sar: number;
  updated_at: string;
}

interface DashboardStats {
  totalProjects: number;
  pendingApprovals: number;
  totalBudgetSAR: number;
  approvedBudgets: number;
}

export const Route = createFileRoute("/_board/board/dashboard")({
  head: () => ({
    meta: [
      { title: "Board Overview — Kwalis HUB" },
      { name: "description", content: "High-level project and budget summary for board members." },
      { property: "og:title", content: "Board Overview — Kwalis HUB" },
      {
        property: "og:description",
        content: "High-level project and budget summary for board members.",
      },
    ],
  }),
  component: BoardDashboard,
});

const DEFAULT_FX_RATE = 3.75;

// Copied verbatim from public.budget_line_total_sar:
//   WHEN p_unit IN ('Package', 'Epi') THEN 1
// Package / Epi are flat totals — never multiplied by periods.
const UNITS_NO_PERIODS = new Set(["Package", "Epi"]);

function BoardDashboard() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalProjects: 0,
    pendingApprovals: 0,
    totalBudgetSAR: 0,
    approvedBudgets: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadDashboardData();
  }, []);

  async function loadDashboardData() {
    try {
      setIsLoading(true);

      // Projects the board member can see (RLS scopes to their org).
      const { data: projectsData, error } = await supabase
        .from("projects")
        .select("id, name, code, status, budget_status, budget, fx_rate, updated_at")
        .order("updated_at", { ascending: false });

      if (error) throw error;

      const rows = projectsData ?? [];
      const fxOf = (id: string) => {
        const r = Number((rows.find((p) => p.id === id) as { fx_rate?: number | null } | undefined)?.fx_rate);
        return Number.isFinite(r) && r > 0 ? r : DEFAULT_FX_RATE;
      };

      // Budget totals are computed from `budget_lines` (there is no
      // denormalised total column on `projects`).
      const totals = new Map<string, number>();
      // Incurred actuals come from the shared definition layer — the same
      // row the operational dashboard reads. Never recomputed here.
      const actuals = new Map<string, number>();
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const [{ data: lines }, { data: positions }] = await Promise.all([
          supabase
            .from("v_active_budget_lines" as any)
            .select("project_id, amount, rate, prep, shooting, wrap, x, unit, currency, excluded")
            .in("project_id", ids),
          (supabase.from as any)("v_project_position")
            .select("project_id, actual_sar")
            .in("project_id", ids),
        ]);
        for (const l of (lines ?? []) as any[]) {
          if (l.excluded) continue;
          const periods =
            (Number(l.prep) || 0) + (Number(l.shooting) || 0) + (Number(l.wrap) || 0) ||
            Number(l.x) ||
            1;
          const base = (Number(l.amount) || 0) * (Number(l.rate) || 0);
          const native = UNITS_NO_PERIODS.has(l.unit ?? "") ? base : base * periods;
          const sar =
            (l.currency || "SAR").toUpperCase() === "SAR"
              ? native
              : native * fxOf(l.project_id as string);
          totals.set(l.project_id!, (totals.get(l.project_id!) ?? 0) + sar);
        }
        for (const p of (positions ?? []) as any[]) {
          actuals.set(p.project_id as string, Number(p.actual_sar) || 0);
        }
      }

      const summaries: ProjectSummary[] = rows.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        budget_status: toBoardStatus(p.budget_status as string | null),
        total_budget_sar: totals.get(p.id) ?? Number(p.budget) ?? 0,
        actual_spent_sar: actuals.get(p.id) ?? 0,
        updated_at: p.updated_at,
      }));

      setProjects(summaries);
      setStats({
        totalProjects: summaries.length,
        pendingApprovals: summaries.filter((p) => p.budget_status === "submitted").length,
        totalBudgetSAR: summaries.reduce((s, p) => s + p.total_budget_sar, 0),
        approvedBudgets: summaries.filter((p) => p.budget_status === "approved").length,
      });
    } catch (err) {
      console.error("Dashboard load failed:", err);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          {t("board_dashboard.board_overview")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("board_dashboard.highlevel_project_and_budget_summary_across_all_productions")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Projects" value={stats.totalProjects} icon="📁" />
        <StatCard
          label="Pending Approvals"
          value={stats.pendingApprovals}
          icon="⏳"
          highlight={stats.pendingApprovals > 0}
        />
        <StatCard
          label="Total Budget"
          value={formatSAR(stats.totalBudgetSAR)}
          subtext="SAR"
          icon="💰"
        />
        <StatCard label="Approved Budgets" value={stats.approvedBudgets} icon="✅" />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
          {t("board_dashboard.all_productions")}
        </h2>

        {projects.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            {t("board_dashboard.no_projects_found_in_this_organization")}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onReviewBudget={() =>
                  navigate({ to: "/board/budget-review", search: { projectId: project.id } })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
  icon,
  highlight = false,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 transition-colors ${
        highlight ? "border-warning/40 bg-warning/20" : "border-border bg-surface-2"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <span className="text-lg">{icon}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground tabular-nums">{value}</span>
        {subtext && <span className="text-xs text-muted-foreground font-medium">{subtext}</span>}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  onReviewBudget,
}: {
  project: ProjectSummary;
  onReviewBudget: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-5 flex flex-col gap-4 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{project.name}</h3>
          <span className="text-xs text-muted-foreground font-mono">{project.code}</span>
        </div>
        <BudgetStatusBadge status={project.budget_status} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Budget</div>
          <div className="text-sm font-mono font-semibold text-foreground tabular-nums">
            {formatSAR(project.total_budget_sar)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Spent</div>
          <div className="text-sm font-mono font-semibold text-foreground tabular-nums">
            {formatSAR(project.actual_spent_sar)}
          </div>
        </div>
      </div>

      <SpendingBar spent={project.actual_spent_sar} total={project.total_budget_sar || 1} />

      <button
        onClick={onReviewBudget}
        className="w-full text-center text-xs font-medium px-4 py-2.5 rounded-lg bg-accent text-accent-foreground hover:bg-accent/80 transition-colors cursor-pointer"
      >
        Review Budget →
      </button>
    </div>
  );
}

export function BudgetStatusBadge({ status }: { status: BoardBudgetStatus }) {
  const config: Record<BoardBudgetStatus, { label: string; classes: string }> = {
    draft: { label: "Draft", classes: "bg-muted text-muted-foreground" },
    submitted: { label: "Pending Review", classes: "bg-warning/40 text-warning" },
    approved: { label: "Approved", classes: "bg-success/40 text-success" },
    rejected: { label: "Revision Requested", classes: "bg-destructive/40 text-destructive" },
  };
  const { label, classes } = config[status];
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full shrink-0 ${classes}`}
    >
      {label}
    </span>
  );
}

function SpendingBar({ spent, total }: { spent: number; total: number }) {
  const pct = Math.min((spent / total) * 100, 100);
  const isOver = pct > 90;
  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${isOver ? "bg-destructive" : "bg-success"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatSAR(n: number): string {
  return formatAmount(n, 0);
}
