// ═══════════════════════════════════════════════════════════════════
// src/routes/_board/board.budget-review.tsx
// ═══════════════════════════════════════════════════════════════════
// Board Member Budget Review — view-only budget with Approve/Reject.
// ═══════════════════════════════════════════════════════════════════

import i18n from "i18next";
import { useTranslation } from "react-i18next";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { DB_BUDGET_STATUS, toBoardStatus, type BoardBudgetStatus } from "@/lib/board-budget-status";
import {
  exportBoardBudgetExcel,
  exportBoardBudgetPdf,
  type BoardExportPayload,
} from "@/lib/board-budget-export";
import { formatAmount } from "@/lib/format-number";
import RiyalIcon from "@/components/ui/RiyalIcon";

interface BudgetLine {
  id: string;
  group: string | null;
  header_code: string | null;
  main_code: string | null;
  name?: string | null;
  description?: string | null;
  prep: number | null;
  shooting: number | null;
  wrap: number | null;
  x: number | null;
  unit: string | null;
  amount: number | null;
  rate: number | null;
  currency: string | null;
  notes?: string | null;
  excluded?: boolean | null;
}

interface ProjectBudget {
  projectId: string;
  organizationId: string | null;
  projectName: string;
  projectCode: string;
  budgetStatus: BoardBudgetStatus;
  /** Project FX rate (USD→SAR) — never hardcoded. */
  fxRate: number;
  lines: BudgetLine[];
}

export const Route = createFileRoute("/_board/board/budget-review")({
  head: () => ({
    meta: [
      { title: "Budget Review — Kwalis HUB" },
      { name: "description", content: "View-only production budget with board approval controls." },
      { property: "og:title", content: "Budget Review — Kwalis HUB" },
      {
        property: "og:description",
        content: "View-only production budget with board approval controls.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    projectId: (search.projectId as string) || "",
  }),
  component: BudgetReview,
});

// ─── Calculation Engine (mirrors AdvancedBudgetTable) ───────────

const DEFAULT_FX_RATE = 3.75;

// Copied verbatim from public.budget_line_total_sar:
//   WHEN p_unit IN ('Package', 'Epi') THEN 1
// Package / Epi are flat totals — never multiplied by periods.
const UNITS_NO_PERIODS = new Set(["Package", "Epi"]);

function calcTotalPeriods(line: BudgetLine): number {
  const sum = (Number(line.prep) || 0) + (Number(line.shooting) || 0) + (Number(line.wrap) || 0);
  if (sum > 0) return sum;
  return (Number(line.x) || 0) > 0 ? Number(line.x) : 1;
}

function calcLineTotalNative(line: BudgetLine): number {
  if (line.excluded) return 0;
  const base = (Number(line.amount) || 0) * (Number(line.rate) || 0);
  return UNITS_NO_PERIODS.has(line.unit ?? "") ? base : base * calcTotalPeriods(line);
}

function calcLineTotalSAR(line: BudgetLine, fxRate: number = DEFAULT_FX_RATE): number {
  const native = calcLineTotalNative(line);
  if ((line.currency || "SAR").toUpperCase() === "SAR") return native;
  return native * (Number.isFinite(fxRate) && fxRate > 0 ? fxRate : DEFAULT_FX_RATE);
}

function fmt(n: number): string {
  return formatAmount(n, 2);
}

function accountName(line: BudgetLine): string {
  return line.name || line.description || line.main_code || "—";
}

// ─── Hierarchy builder ──────────────────────────────────────────

interface HeaderGroup {
  code: string;
  name: string;
  lines: BudgetLine[];
  subtotalSAR: number;
}

interface BudgetGroup {
  groupKey: string;
  groupLabel: string;
  headers: HeaderGroup[];
  totalSAR: number;
}

/** Group label translation keys — resolved at render time so language switches apply live. */
const GROUP_LABEL_KEYS: Record<string, string> = {
  ATL: "budget.groups.atl",
  BTL: "budget.groups.btl",
  POST: "budget.groups.post",
  OTHER: "budget.groups.other",
};

const GROUP_ORDER = ["ATL", "BTL", "POST", "OTHER"];

function buildHierarchy(lines: BudgetLine[], fxRate: number): BudgetGroup[] {
  const groupMap: Record<string, Record<string, HeaderGroup>> = {};

  for (const line of lines) {
    const g = (line.group || "OTHER").toUpperCase();
    const hc = line.header_code || "UNASSIGNED";
    if (!groupMap[g]) groupMap[g] = {};
    if (!groupMap[g][hc]) {
      groupMap[g][hc] = { code: hc, name: `Section ${hc}`, lines: [], subtotalSAR: 0 };
    }
    // A line whose main code equals the header code carries the section name.
    if (line.main_code && line.header_code && line.main_code === line.header_code) {
      groupMap[g][hc].name = accountName(line);
    }
    groupMap[g][hc].lines.push(line);
  }

  return GROUP_ORDER.filter((g) => groupMap[g])
    .concat(Object.keys(groupMap).filter((g) => !GROUP_ORDER.includes(g)))
    .filter((g, i, arr) => arr.indexOf(g) === i && groupMap[g])
    .map((gKey) => {
      const headers = Object.values(groupMap[gKey])
        .sort((a, b) => parseFloat(a.code) - parseFloat(b.code) || 0)
        .map((h) => ({
          ...h,
          subtotalSAR: h.lines.reduce((s, l) => s + calcLineTotalSAR(l, fxRate), 0),
        }));
      return {
        groupKey: gKey,
        groupLabel: GROUP_LABEL_KEYS[gKey] ? i18n.t(GROUP_LABEL_KEYS[gKey]) : gKey,
        headers,
        totalSAR: headers.reduce((s, h) => s + h.subtotalSAR, 0),
      };
    });
}

// ─── Main Component ─────────────────────────────────────────────

const notesSchema = z.string().trim().max(2000);

function BudgetReview() {
  const { t } = useTranslation();
  const { projectId } = Route.useSearch();
  const navigate = useNavigate();

  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [approvalNotes, setApprovalNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState<"approve" | "reject" | null>(null);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedHeaders, setExpandedHeaders] = useState<Set<string>>(new Set());

  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (projectId) void loadBudget(projectId);
  }, [projectId]);

  // Live totals: any insert/update/delete on this project's budget_lines
  // (or a status change on the project) refreshes the grid immediately.
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`board-budget-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "budget_lines",
          filter: `project_id=eq.${projectId}`,
        },
        () => void loadBudget(projectId, { silent: true }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${projectId}` },
        () => void loadBudget(projectId, { silent: true }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  async function loadBudget(pid: string, opts?: { silent?: boolean }) {
    try {
      if (!opts?.silent) setIsLoading(true);
      setError(null);

      const { data: project, error: projErr } = await supabase
        .from("projects")
        .select("id, name, code, organization_id, budget_status, fx_rate")
        .eq("id", pid)
        .single();

      if (projErr) throw projErr;

      const { data: lines, error: linesErr } = await supabase
        .from("v_active_budget_lines" as any)
        .select(
          "id, group, header_code, main_code, name, description, prep, shooting, wrap, x, unit, amount, rate, currency, notes, excluded",
        )
        .eq("project_id", pid)
        .order("header_code", { ascending: true })
        .order("main_code", { ascending: true });

      if (linesErr) throw linesErr;

      setBudget({
        projectId: project.id,
        organizationId: project.organization_id,
        projectName: project.name,
        projectCode: project.code ?? "",
        budgetStatus: toBoardStatus(project.budget_status as string | null),
        fxRate: Number((project as { fx_rate?: number | null }).fx_rate) || DEFAULT_FX_RATE,
        lines: (lines || []) as unknown as BudgetLine[],
      });
    } catch (err) {
      setError((err as Error).message || "Failed to load budget");
    } finally {
      setIsLoading(false);
    }
  }

  const handleApprovalAction = useCallback(
    async (action: "approved" | "rejected") => {
      if (!budget) return;
      try {
        setIsSubmitting(true);

        const parsedNotes = notesSchema.safeParse(approvalNotes);
        if (!parsedNotes.success) {
          setError("Notes are too long (2000 characters max).");
          return;
        }

        const fromStatus = budget.budgetStatus;
        const nextDbStatus =
          action === "approved" ? DB_BUDGET_STATUS.approved : DB_BUDGET_STATUS.rejected;

        // Step 1: Update budget status on the project
        const { error: updateErr } = await supabase
          .from("projects")
          .update({ budget_status: nextDbStatus as never })
          .eq("id", budget.projectId);
        if (updateErr) throw updateErr;

        // Step 2: Current user for the log entry
        const {
          data: { user },
        } = await supabase.auth.getUser();

        // Step 3: Approval log entry (`budget_status_events` is this app's
        // approval/activity log). Non-blocking on failure.
        const { error: logErr } = await supabase.from("budget_status_events").insert({
          project_id: budget.projectId,
          organization_id: budget.organizationId,
          actor_id: user?.id ?? null,
          action: action === "approved" ? "board_approved" : "board_rejected",
          from_status: DB_BUDGET_STATUS[fromStatus],
          to_status: nextDbStatus,
          note: parsedNotes.data || null,
        });
        if (logErr) console.error("Failed to insert approval log:", logErr);

        setBudget((prev) =>
          prev ? { ...prev, budgetStatus: action === "approved" ? "approved" : "rejected" } : prev,
        );
        setApprovalNotes("");
        setShowConfirmDialog(null);
      } catch (err) {
        console.error("Approval action failed:", err);
        setError((err as Error).message || "Failed to process approval");
      } finally {
        setIsSubmitting(false);
      }
    },
    [budget, approvalNotes],
  );

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleHeader = (key: string) => {
    setExpandedHeaders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    setCollapsedGroups(new Set());
    if (!budget) return;
    const all = new Set<string>();
    buildHierarchy(budget.lines, budget.fxRate).forEach((g) =>
      g.headers.forEach((h) => all.add(`${g.groupKey}-${h.code}`)),
    );
    setExpandedHeaders(all);
  };

  const collapseAll = () => {
    if (!budget) return;
    setCollapsedGroups(new Set(buildHierarchy(budget.lines, budget.fxRate).map((g) => g.groupKey)));
    setExpandedHeaders(new Set());
  };

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="text-4xl">📋</div>
        <p className="text-muted-foreground">
          {t("board_budget_review.no_project_selected_go_back_to_the_dashboard")}
        </p>
        <button
          onClick={() => navigate({ to: "/board/dashboard" })}
          className="text-sm text-primary hover:underline cursor-pointer"
        >
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !budget) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="text-4xl">⚠️</div>
        <p className="text-destructive text-sm">{error || "Budget not found"}</p>
        <button
          onClick={() => navigate({ to: "/board/dashboard" })}
          className="text-sm text-primary hover:underline cursor-pointer"
        >
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  const hierarchy = buildHierarchy(budget.lines, budget.fxRate);
  const grandTotalSAR = hierarchy.reduce((s, g) => s + g.totalSAR, 0);
  const canApprove = budget.budgetStatus === "submitted";

  const exportPayload = (): BoardExportPayload => ({
    projectName: budget.projectName,
    projectCode: budget.projectCode,
    status: budget.budgetStatus,
    grandTotalSAR,
    groups: hierarchy.map((g) => ({
      groupLabel: g.groupLabel,
      totalSAR: g.totalSAR,
      headers: g.headers.map((h) => ({
        code: h.code,
        name: h.name,
        subtotalSAR: h.subtotalSAR,
        lines: h.lines.map((l) => ({
          code: l.main_code || "",
          account: accountName(l),
          qty: Number(l.amount) || 0,
          currency: (l.currency || "SAR").toUpperCase(),
          rate: Number(l.rate) || 0,
          periods: calcTotalPeriods(l),
          totalSAR: calcLineTotalSAR(l, budget.fxRate),
        })),
      })),
    })),
  });

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      await exportBoardBudgetExcel(exportPayload());
    } catch (err) {
      setError((err as Error).message || "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = () => {
    try {
      exportBoardBudgetPdf(exportPayload());
    } catch (err) {
      setError((err as Error).message || "Export failed");
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <button
            onClick={() => navigate({ to: "/board/dashboard" })}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 cursor-pointer"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-xl font-bold text-foreground">
            {budget.projectName}
            <span className="ms-3 text-xs font-mono text-muted-foreground">
              {budget.projectCode}
            </span>
          </h1>
        </div>
        <BudgetStatusBadgeLarge status={budget.budgetStatus} />
      </div>

      {canApprove && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-lg">📝</span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("budget.approval.awaitingReview")}
              </h3>
              <p className="text-xs text-muted-foreground">{t("budget.approval.reviewSubtitle")}</p>
            </div>
          </div>

          <textarea
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
            placeholder={t("budget.approval.notesPlaceholder")}
            rows={3}
            maxLength={2000}
            className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
          />

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowConfirmDialog("approve")}
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-lg bg-success text-success text-sm font-semibold hover:bg-success disabled:opacity-50 transition-colors cursor-pointer"
            >
              ✓ Approve Budget
            </button>
            <button
              onClick={() => setShowConfirmDialog("reject")}
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-lg bg-destructive/80 text-destructive text-sm font-semibold hover:bg-destructive disabled:opacity-50 transition-colors cursor-pointer"
            >
              ✕ Reject Budget
            </button>
          </div>
        </div>
      )}

      {(budget.budgetStatus === "approved" || budget.budgetStatus === "rejected") && (
        <div
          className={`rounded-xl border p-4 flex items-center gap-3 ${
            budget.budgetStatus === "approved"
              ? "border-success/30 bg-success/10"
              : "border-destructive/30 bg-destructive/10"
          }`}
        >
          <span className="text-lg">{budget.budgetStatus === "approved" ? "✅" : "❌"}</span>
          <span className="text-sm text-foreground">
            This budget has been{" "}
            <strong>
              {budget.budgetStatus === "approved" ? "approved" : "sent back for revision"}
            </strong>
            .
          </span>
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden bg-surface-2">
        <div className="flex items-center justify-between px-4 py-3 bg-surface-1 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-5 bg-success rounded-full" />
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wide">
              {t("board_budget_review.budget_detail")}
            </h2>
            <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
              {budget.lines.length} lines
            </span>
            <span className="text-[9px] bg-info/40 text-info px-1.5 py-0.5 rounded-full font-medium">
              {t("board_budget_review.view_only")}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => void handleExportExcel()}
              disabled={isExporting}
              className="text-[10px] font-semibold text-success border border-success/30 px-2.5 py-1 rounded hover:bg-success/10 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isExporting ? "Exporting…" : "⬇ Excel"}
            </button>
            <button
              onClick={handleExportPdf}
              className="text-[10px] font-semibold text-info border border-info/30 px-2.5 py-1 rounded hover:bg-info/10 transition-colors cursor-pointer"
            >
              ⬇ PDF
            </button>
            <span className="text-border">|</span>

            <button
              onClick={expandAll}
              className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors cursor-pointer"
            >
              {t("board_budget_review.expand_all")}
            </button>
            <span className="text-border">|</span>
            <button
              onClick={collapseAll}
              className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors cursor-pointer"
            >
              {t("board_budget_review.collapse_all")}
            </button>
          </div>
        </div>

        <div className="overflow-auto max-h-[60vh]">
          <div className="flex items-center gap-0 px-3 py-2 bg-surface-1 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider border-b border-border sticky top-0 z-10">
            <div className="w-[24px] shrink-0" />
            <div className="w-[72px] text-start px-1.5 shrink-0">{t("budget.columns.code")}</div>
            <div className="min-w-[180px] flex-1 text-start px-1.5 shrink-0">
              {t("budget.columns.account")}
            </div>
            <div className="w-[72px] text-end px-1.5 shrink-0">{t("budget.columns.amount")}</div>
            <div className="w-[50px] text-center px-1.5 shrink-0">
              {t("budget.columns.currency")}
            </div>
            <div className="w-[90px] text-end px-1.5 shrink-0">{t("budget.columns.rate")}</div>
            <div className="w-[50px] text-end px-1.5 shrink-0">{t("budget.columns.periods")}</div>
            <div className="w-[110px] text-end px-1.5 shrink-0">{t("budget.columns.totalSAR")}</div>
          </div>

          {hierarchy.map((group) => (
            <div key={group.groupKey}>
              <button
                onClick={() => toggleGroup(group.groupKey)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-1 border-y border-border cursor-pointer hover:bg-accent/40 transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <ChevronIcon open={!collapsedGroups.has(group.groupKey)} />
                  <span className="text-xs font-bold text-foreground uppercase tracking-widest">
                    {group.groupLabel}
                  </span>
                </div>
                <span className="text-sm font-mono font-bold text-success tabular-nums">
                  {fmt(group.totalSAR)} <RiyalIcon className="text-muted-foreground" />
                </span>
              </button>

              {!collapsedGroups.has(group.groupKey) &&
                group.headers.map((header) => {
                  const hKey = `${group.groupKey}-${header.code}`;
                  const isOpen = expandedHeaders.has(hKey);
                  return (
                    <div key={hKey} className="mb-px">
                      <button
                        onClick={() => toggleHeader(hKey)}
                        className="w-full flex items-center gap-0 px-3 py-2 bg-surface-1/80 hover:bg-accent/40 border-b border-border transition-colors cursor-pointer group"
                      >
                        <div className="w-[24px] shrink-0 flex items-center justify-center text-muted-foreground">
                          <ChevronIcon open={isOpen} />
                        </div>
                        <div className="w-[72px] text-start px-1.5 shrink-0 text-warning text-[11px] font-mono font-bold">
                          {header.code}
                        </div>
                        <div className="min-w-[180px] flex-1 text-start px-1.5 shrink-0 text-foreground text-xs font-semibold uppercase tracking-wide">
                          {header.name}
                          <span className="ms-2 text-[9px] text-muted-foreground font-normal lowercase">
                            {header.lines.length} items
                          </span>
                        </div>
                        <div className="w-[72px] px-1.5 shrink-0" />
                        <div className="w-[50px] px-1.5 shrink-0" />
                        <div className="w-[90px] px-1.5 shrink-0" />
                        <div className="w-[50px] px-1.5 shrink-0" />
                        <div className="w-[110px] text-end px-1.5 shrink-0 text-success text-xs font-mono font-bold">
                          {fmt(header.subtotalSAR)}
                        </div>
                      </button>

                      {isOpen && (
                        <div className="bg-surface-2/50">
                          {header.lines.map((line, idx) => (
                            <div
                              key={line.id || `${line.main_code}-${idx}`}
                              className={`flex items-center gap-0 px-3 py-[6px] ${
                                line.excluded ? "opacity-35" : "hover:bg-accent/30"
                              } ${idx < header.lines.length - 1 ? "border-b border-border/50" : ""}`}
                            >
                              <div className="w-[24px] shrink-0" />
                              <div className="w-[72px] text-start px-1.5 shrink-0 text-muted-foreground text-[11px] font-mono">
                                {line.main_code}
                              </div>
                              <div className="min-w-[180px] flex-1 text-start px-1.5 shrink-0 text-foreground text-xs truncate">
                                {accountName(line)}
                              </div>
                              <div className="w-[72px] text-end px-1.5 shrink-0 text-foreground text-xs font-mono">
                                {line.amount ?? ""}
                              </div>
                              <div className="w-[50px] text-center px-1.5 shrink-0 text-muted-foreground text-[9px]">
                                {(line.currency || "SAR").toUpperCase()}
                              </div>
                              <div className="w-[90px] text-end px-1.5 shrink-0 text-foreground text-xs font-mono">
                                {fmt(Number(line.rate) || 0)}
                              </div>
                              <div className="w-[50px] text-end px-1.5 shrink-0 text-muted-foreground text-[11px] font-mono">
                                {calcTotalPeriods(line)}
                              </div>
                              <div className="w-[110px] text-end px-1.5 shrink-0 text-success text-xs font-mono font-semibold">
                                {fmt(calcLineTotalSAR(line, budget.fxRate))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>

        <div className="sticky bottom-0 z-10 bg-surface-1 border-t-2 border-success/40 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-semibold text-foreground uppercase tracking-widest">
              {t("board_budget_review.grand_total")}
            </span>
          </div>
          <span className="text-lg font-mono font-bold text-success tabular-nums">
            {fmt(grandTotalSAR)} <RiyalIcon className="text-muted-foreground" />
          </span>
        </div>
      </div>

      {showConfirmDialog && (
        <ConfirmDialog
          action={showConfirmDialog}
          projectName={budget.projectName}
          totalSAR={grandTotalSAR}
          notes={approvalNotes}
          isSubmitting={isSubmitting}
          onConfirm={() =>
            handleApprovalAction(showConfirmDialog === "approve" ? "approved" : "rejected")
          }
          onCancel={() => setShowConfirmDialog(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-150 ${open ? "rotate-0" : "-rotate-90"}`}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function BudgetStatusBadgeLarge({ status }: { status: BoardBudgetStatus }) {
  const config: Record<BoardBudgetStatus, { label: string; classes: string }> = {
    draft: { label: "Draft", classes: "bg-muted text-muted-foreground border-border" },
    submitted: { label: "Pending Review", classes: "bg-warning/30 text-warning border-warning/30" },
    approved: { label: "Approved", classes: "bg-success/30 text-success border-success/30" },
    rejected: {
      label: "Revision Requested",
      classes: "bg-destructive/30 text-destructive border-destructive/30",
    },
  };
  const { label, classes } = config[status];
  return (
    <span
      className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border ${classes}`}
    >
      {label}
    </span>
  );
}

function ConfirmDialog({
  action,
  projectName,
  totalSAR,
  notes,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  action: "approve" | "reject";
  projectName: string;
  totalSAR: number;
  notes: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  const isApprove = action === "approve";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-2 border border-border rounded-2xl p-6 max-w-md w-full mx-4 space-y-5">
        <div className="text-center">
          <div className="text-3xl mb-3">{isApprove ? "✅" : "❌"}</div>
          <h3 className="text-lg font-bold text-foreground">
            {isApprove ? "Approve" : "Reject"} Budget?
          </h3>
          <p className="text-sm text-muted-foreground mt-2">
            You are about to{" "}
            <strong className={isApprove ? "text-success" : "text-destructive"}>{action}</strong>{" "}
            the budget for <strong className="text-foreground">{projectName}</strong> totaling{" "}
            <strong className="text-success font-mono">
              {fmt(totalSAR)} <RiyalIcon />
            </strong>
            .
          </p>
        </div>

        {notes && (
          <div className="bg-muted/40 rounded-lg p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              {t("board_budget_review.your_notes")}
            </div>
            <p className="text-sm text-foreground">{notes}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2.5 rounded-lg border border-border text-foreground text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors cursor-pointer ${
              isApprove
                ? "bg-success text-success hover:bg-success"
                : "bg-destructive text-destructive hover:bg-destructive"
            }`}
          >
            {isSubmitting ? "Processing..." : `Yes, ${isApprove ? "Approve" : "Reject"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
