import { formatDate, formatDateTime } from "@/lib/date-format";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Clock,
  History,
  Send,
  Eye,
  Undo2,
} from "lucide-react";
import {
  useBudgetStatus,
  useBudgetApprovalRequests,
  submitBudgetForApproval,
  decideBudgetApproval,
  cancelBudgetApproval,
  fetchVersionSummary,
  setBudgetStatus,
  EXECUTIVE_TITLES,
  type ExecutiveTitle,
  type BudgetStatus,
  type ApprovalRequest,
  type VersionSummaryRow,
} from "@/lib/budget-governance";
import {
  canDecide,
  canSubmitBudget,
  decisionProgress,
  rejectReasonError,
  submittableVersions,
} from "@/lib/budget-approval";
import {
  useBudgetVersions,
  setSelectedVersion,
  invalidateVersionResolution,
} from "@/lib/budget-versions";
import { invalidateBudgetCaches } from "@/lib/budget-cache-bus";
import { lineTotalSar } from "@/lib/dashboard/real-financials";
import { formatAmount } from "@/lib/format-number";
import { useAuthRoles } from "@/lib/auth-roles";
import { useProjectRole } from "@/lib/project-role";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";

const STATUS_STYLE: Record<
  BudgetStatus,
  { box: string; text: string; key: string; icon: React.ReactNode }
> = {
  Draft: {
    box: "bg-surface-2 border-border",
    text: "text-foreground",
    key: "budgetApproval.status_draft",
    icon: <Unlock className="size-4" />,
  },
  "Pending Approval": {
    box: "bg-warning/10 border-warning/40",
    text: "text-warning",
    key: "budgetApproval.status_pending",
    icon: <Loader2 className="size-4" />,
  },
  "Locked/Approved": {
    box: "bg-success/10 border-success/40",
    text: "text-success",
    key: "budgetApproval.status_locked",
    icon: <Lock className="size-4" />,
  },
  "Revision Requested": {
    box: "bg-destructive/10 border-destructive/40",
    text: "text-destructive",
    key: "budgetApproval.status_revision",
    icon: <AlertTriangle className="size-4" />,
  },
};

const REQUEST_TONE: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

type Exec = { userId: string; name: string | null; title: string };

function errMessage(e: unknown, fallback: string): string {
  return (e as { message?: string })?.message ?? fallback;
}

export function BudgetGovernancePanel({
  projectId,
  organizationId,
  isExecutive,
  canManage,
}: {
  projectId: string;
  organizationId: string | null;
  isExecutive: boolean;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const roles = useAuthRoles();
  const projectRole = useProjectRole();
  const { status, refresh: refreshStatus } = useBudgetStatus(projectId);
  const { requests, refresh: refreshRequests } = useBudgetApprovalRequests(projectId);
  const { versions, reload: reloadVersions } = useBudgetVersions();
  const reloadScopedData = useStore((s) => s.reloadScopedData);
  const [execs, setExecs] = useState<Exec[]>([]);
  const [members, setMembers] = useState<{ userId: string; name: string | null }[]>([]);
  const [busy, setBusy] = useState(false);

  const pending = requests.find((r) => r.status === "pending") ?? null;
  const history = requests.filter((r) => r.status !== "pending").slice(0, 5);
  const isOrgAdmin = !!organizationId && roles.adminOrgIds.includes(organizationId);
  const mayAssignTitles = roles.isSuperAdmin || isOrgAdmin;
  const canSubmit =
    !isExecutive &&
    canSubmitBudget({
      isSuperAdmin: roles.isSuperAdmin,
      isOrgAdmin,
      projectRole: projectRole.role,
      isExecutive,
    });

  const loadPeople = useCallback(async () => {
    const { data: pms } = await supabase
      .from("project_members")
      .select("user_id,executive_title" as "user_id")
      .eq("project_id", projectId);
    const rows = (pms ?? []) as unknown as { user_id: string; executive_title: string | null }[];
    const ids = rows.map((r) => r.user_id);
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("id,display_name").in("id", ids)
      : { data: [] as { id: string; display_name: string | null }[] };
    const names = new Map(
      (profs ?? []).map((p: any) => [p.id as string, p.display_name as string | null]),
    );
    setMembers(rows.map((r) => ({ userId: r.user_id, name: names.get(r.user_id) ?? null })));
    setExecs(
      rows
        .filter((r) => !!r.executive_title)
        .map((r) => ({
          userId: r.user_id,
          name: names.get(r.user_id) ?? null,
          title: r.executive_title!,
        })),
    );
  }, [projectId]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  const refreshAll = useCallback(async () => {
    invalidateVersionResolution(projectId);
    invalidateBudgetCaches(projectId, "lines");
    await Promise.all([refreshRequests(), refreshStatus(), reloadVersions()]);
    await useStore.getState().loadProjects();
    await reloadScopedData();
  }, [projectId, refreshRequests, refreshStatus, reloadVersions, reloadScopedData]);

  const style = STATUS_STYLE[status];

  // Platform-owner escape hatch only: an approved budget is changed through a
  // new draft, never by unlocking it (206).
  async function handleUnlock() {
    if (!confirm(t("budgetApproval.unlock_confirm"))) return;
    setBusy(true);
    try {
      await setBudgetStatus(projectId, "Draft", roles.userId ?? null);
      toast.success(t("budgetgovernancepanel.budget_unlocked_for_revision"));
      await refreshAll();
    } catch (e) {
      toast.error(errMessage(e, t("budgetApproval.action_failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-2xl border ${style.box} px-4 py-3 mb-4 space-y-3`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className={`inline-flex items-center gap-2 font-bold ${style.text}`}>
          {style.icon}
          <span>
            {t("budgetApproval.status_label")}: {t(style.key)}
          </span>
        </div>
        <div className="flex-1" />
        {roles.isSuperAdmin && status !== "Draft" && !pending && (
          <button
            disabled={busy}
            onClick={() => void handleUnlock()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-warning/40 text-warning text-xs font-semibold px-3 py-1.5 hover:bg-warning/10 disabled:opacity-50"
          >
            <Unlock className="size-4" />
            {t("budgetApproval.unlock_super_admin")}
          </button>
        )}
      </div>
      {status === "Locked/Approved" && (
        <p className="text-xs text-muted-foreground">{t("budgetApproval.locked_hint")}</p>
      )}

      {pending && (
        <PendingRequestCard
          projectId={projectId}
          request={pending}
          userId={roles.userId}
          mayWithdraw={canSubmit || pending.submittedBy === roles.userId}
          onChanged={refreshAll}
        />
      )}

      {canSubmit && !pending && (
        <SendForApprovalForm
          projectId={projectId}
          status={status}
          versions={versions}
          execs={execs.filter((e) => e.userId !== roles.userId)}
          onSent={refreshAll}
        />
      )}

      {history.length > 0 && (
        <div className="pt-3 border-t border-border">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            {t("budgetApproval.history")}
          </div>
          <div className="flex flex-col gap-1">
            {history.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 text-xs rounded-md bg-surface-2 px-2 py-1.5"
              >
                <span className="font-semibold text-foreground">{r.versionName ?? "—"}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${REQUEST_TONE[r.status]}`}
                >
                  {t(`budgetApproval.request_${r.status}`)}
                </span>
                <span className="text-muted-foreground">
                  {formatDate(r.decidedAt ?? r.submittedAt)}
                </span>
                {r.decisionReason && (
                  <span className="italic text-muted-foreground min-w-0 break-words">
                    — {r.decisionReason}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {canManage && !isExecutive && mayAssignTitles && (
        <AssignTitle projectId={projectId} members={members} onAssigned={loadPeople} />
      )}

      <ApprovalActivityLog
        projectId={projectId}
        refreshKey={`${status}:${requests.map((r) => r.status).join(",")}`}
      />
    </div>
  );
}

// ------------------------------------------------------------------ pending request

function PendingRequestCard({
  projectId,
  request,
  userId,
  mayWithdraw,
  onChanged,
}: {
  projectId: string;
  request: ApprovalRequest;
  userId: string | null;
  mayWithdraw: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const progress = decisionProgress(request.decisions);
  const iDecide = canDecide(request, request.decisions, userId);

  async function decide(decision: "approved" | "rejected") {
    if (decision === "rejected") {
      const err = rejectReasonError(reason);
      if (err) {
        toast.error(
          t(
            err === "required"
              ? "budgetApproval.reason_required"
              : "budgetApproval.reason_too_long",
          ),
        );
        return;
      }
    }
    setBusy(true);
    try {
      const result = await decideBudgetApproval(
        projectId,
        request.id,
        decision,
        decision === "rejected" ? reason : null,
      );
      toast.success(
        t(
          result === "approved"
            ? "budgetApproval.toast_approved_final"
            : result === "rejected"
              ? "budgetApproval.toast_rejected"
              : "budgetApproval.toast_approved_waiting",
        ),
      );
      setRejecting(false);
      setReason("");
      await onChanged();
    } catch (e) {
      toast.error(errMessage(e, t("budgetApproval.action_failed")));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!confirm(t("budgetApproval.withdraw_confirm"))) return;
    setBusy(true);
    try {
      await cancelBudgetApproval(projectId, request.id, null);
      toast.success(t("budgetApproval.toast_withdrawn"));
      await onChanged();
    } catch (e) {
      toast.error(errMessage(e, t("budgetApproval.action_failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-warning/40 bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Clock className="size-4 text-warning" />
        <span className="font-semibold text-foreground">
          {t("budgetApproval.pending_title", { version: request.versionName ?? "—" })}
        </span>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-muted text-muted-foreground">
          {t(request.kind === "draft" ? "budgetApproval.kind_draft" : "budgetApproval.kind_active")}
        </span>
        <span className="ms-auto text-xs text-muted-foreground">
          {t("budgetApproval.progress", { approved: progress.approved, total: progress.total })}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {t("budgetApproval.sent_by", {
          name:
            request.submittedByName ?? (request.legacy ? t("budgetApproval.legacy_sender") : "—"),
          date: formatDateTime(request.submittedAt),
        })}
        {request.totalSar !== null && (
          <> · {t("budgetApproval.total_sar", { amount: formatAmount(request.totalSar, 2) })}</>
        )}
      </div>
      {request.note && <p className="text-xs italic text-foreground">“{request.note}”</p>}
      {request.kind === "draft" && (
        <p className="text-xs text-muted-foreground">{t("budgetApproval.draft_replaces_hint")}</p>
      )}

      <div className="flex flex-col gap-1">
        {request.decisions.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap items-center gap-2 text-xs rounded-md bg-surface-2 px-2 py-1"
          >
            {d.decision === "approved" ? (
              <CheckCircle2 className="size-4 text-success shrink-0" />
            ) : d.decision === "rejected" ? (
              <XCircle className="size-4 text-destructive shrink-0" />
            ) : (
              <Clock className="size-4 text-warning shrink-0" />
            )}
            <span className="flex-1 font-medium text-foreground">
              {d.displayName ?? d.approverId.slice(0, 8)}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${REQUEST_TONE[d.decision]}`}
            >
              {t(`budgetApproval.decision_${d.decision}`)}
            </span>
            {d.decidedAt && (
              <span className="text-[10px] text-muted-foreground">{formatDate(d.decidedAt)}</span>
            )}
          </div>
        ))}
      </div>

      {request.versionId && <VersionReview projectId={projectId} versionId={request.versionId} />}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {iDecide && !rejecting && (
          <>
            <button
              disabled={busy}
              onClick={() => void decide("approved")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success text-success-foreground text-xs font-semibold px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
            >
              <CheckCircle2 className="size-4" /> {t("budgetApproval.approve")}
            </button>
            <button
              disabled={busy}
              onClick={() => setRejecting(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
            >
              <XCircle className="size-4" /> {t("budgetApproval.reject")}
            </button>
          </>
        )}
        {mayWithdraw && !iDecide && (
          <button
            disabled={busy}
            onClick={() => void withdraw()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border text-xs font-semibold px-3 py-1.5 hover:bg-muted disabled:opacity-50"
          >
            <Undo2 className="size-4" /> {t("budgetApproval.withdraw")}
          </button>
        )}
      </div>
      {iDecide && rejecting && (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={t("budgetApproval.reason_placeholder")}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => void decide("rejected")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
            >
              <XCircle className="size-4" /> {t("budgetApproval.confirm_reject")}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
              className="rounded-lg border border-border text-xs font-semibold px-3 py-1.5 hover:bg-muted"
            >
              {t("common.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type ReviewLine = {
  id: string;
  main_code: string;
  description: string;
  amount: number;
  rate: number;
  x: number;
  prep: number;
  shooting: number;
  wrap: number;
  unit: string;
  currency: string;
  excluded: boolean;
};

/** Top sheet totals by section + the lines of the version under review (read-only). */
function VersionReview({ projectId, versionId }: { projectId: string; versionId: string }) {
  const { t } = useTranslation();
  const fxRate = useStore((s) => s.projects.find((p) => p.id === projectId)?.fxRate ?? 3.75);
  const [summary, setSummary] = useState<VersionSummaryRow[] | null>(null);
  const [lines, setLines] = useState<ReviewLine[] | null>(null);
  const [showLines, setShowLines] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetchVersionSummary(versionId)
      .then((rows) => !cancel && setSummary(rows))
      .catch(() => !cancel && setSummary([]));
    return () => {
      cancel = true;
    };
  }, [versionId]);

  useEffect(() => {
    if (!showLines || lines) return;
    let cancel = false;
    void supabase
      .from("budget_lines")
      .select("id,main_code,description,amount,rate,x,prep,shooting,wrap,unit,currency,excluded")
      .eq("project_id", projectId)
      .eq("version_id" as "id", versionId)
      .order("main_code")
      .limit(2000)
      .then(({ data }) => {
        if (!cancel) setLines(((data ?? []) as unknown as ReviewLine[]) ?? []);
      });
    return () => {
      cancel = true;
    };
  }, [showLines, lines, projectId, versionId]);

  const bySection = useMemo(() => {
    const m = new Map<string, VersionSummaryRow[]>();
    for (const r of summary ?? []) m.set(r.section, [...(m.get(r.section) ?? []), r]);
    return Array.from(m.entries());
  }, [summary]);
  const grand = (summary ?? []).reduce((s, r) => s + r.totalSar, 0);

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {t("budgetApproval.summary_title")}
        </span>
        <button
          type="button"
          onClick={() => setSelectedVersion(projectId, versionId)}
          className="ms-auto inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
        >
          <Eye className="size-3.5" /> {t("budgetApproval.open_in_grid")}
        </button>
      </div>
      {summary === null ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {bySection.map(([section, rows]) => (
              <React.Fragment key={section}>
                <tr>
                  <td colSpan={3} className="pt-1 font-semibold text-foreground">
                    {section} ·{" "}
                    {formatAmount(
                      rows.reduce((s, r) => s + r.totalSar, 0),
                      2,
                    )}
                  </td>
                </tr>
                {rows.map((r) => (
                  <tr key={section + r.topsheetCode} className="text-muted-foreground">
                    <td className="ps-3 tabular-nums">{r.topsheetCode}</td>
                    <td>{r.topsheetName ?? ""}</td>
                    <td className="text-end tabular-nums">{formatAmount(r.totalSar, 2)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
            <tr className="border-t border-border font-bold text-foreground">
              <td colSpan={2} className="pt-1">
                {t("budgetApproval.grand_total")}
              </td>
              <td className="pt-1 text-end tabular-nums">{formatAmount(grand, 2)}</td>
            </tr>
          </tbody>
        </table>
      )}
      <button
        type="button"
        onClick={() => setShowLines((v) => !v)}
        className="text-[11px] text-brand hover:underline"
      >
        {showLines ? t("budgetApproval.hide_lines") : t("budgetApproval.show_lines")}
      </button>
      {showLines && (
        <div className="max-h-72 overflow-y-auto">
          {lines === null ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <table className="w-full text-[11px]">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-border/50">
                    <td className="pe-2 tabular-nums text-muted-foreground">{l.main_code}</td>
                    <td className="pe-2 text-foreground">{l.description}</td>
                    <td className="text-end tabular-nums">
                      {formatAmount(lineTotalSar(l as any, fxRate), 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ send

function SendForApprovalForm({
  projectId,
  status,
  versions,
  execs,
  onSent,
}: {
  projectId: string;
  status: BudgetStatus;
  versions: { id: string; status: "draft" | "active" | "archived"; versionName: string }[];
  execs: Exec[];
  onSent: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const options = submittableVersions(versions, status, false);
  const [versionId, setVersionId] = useState("");
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Default: every Board Member of the project.
  const selected =
    chosen ?? new Set(execs.filter((e) => e.title === "Board Member").map((e) => e.userId));
  const effectiveVersion = options.some((o) => o.id === versionId)
    ? versionId
    : (options[0]?.id ?? "");

  async function send() {
    if (!effectiveVersion || selected.size === 0) return;
    setBusy(true);
    try {
      await submitBudgetForApproval(projectId, effectiveVersion, Array.from(selected), note);
      toast.success(t("budgetApproval.toast_sent"));
      setNote("");
      setChosen(null);
      await onSent();
    } catch (e) {
      toast.error(errMessage(e, t("budgetApproval.action_failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Send className="size-3" /> {t("budgetApproval.send_title")}
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("budgetApproval.nothing_to_send")}</p>
      ) : (
        <>
          <select
            value={effectiveVersion}
            onChange={(e) => setVersionId(e.target.value)}
            className="w-full bg-card text-foreground border border-border rounded-md px-2 py-1.5 text-xs"
          >
            {options.map((v) => (
              <option key={v.id} value={v.id}>
                {v.versionName} —{" "}
                {t(
                  v.status === "active"
                    ? "budgetApproval.kind_active"
                    : "budgetApproval.kind_draft",
                )}
              </option>
            ))}
          </select>
          {execs.length === 0 ? (
            <p className="text-xs text-warning">{t("budgetApproval.no_board_members")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("budgetApproval.approvers")}</span>
              {execs.map((e) => (
                <label
                  key={e.userId}
                  className="inline-flex items-center gap-2 text-xs text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(e.userId)}
                    onChange={(ev) => {
                      const next = new Set(selected);
                      if (ev.target.checked) next.add(e.userId);
                      else next.delete(e.userId);
                      setChosen(next);
                    }}
                  />
                  {e.name ?? e.userId.slice(0, 8)}{" "}
                  <span className="text-muted-foreground">({e.title})</span>
                </label>
              ))}
            </div>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder={t("budgetApproval.note_placeholder")}
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          />
          <button
            disabled={busy || !effectiveVersion || selected.size === 0}
            onClick={() => void send()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand text-brand-foreground text-xs font-semibold px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
          >
            <Send className="size-3.5" /> {t("budgetApproval.send")}
          </button>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ titles

function AssignTitle({
  projectId,
  members,
  onAssigned,
}: {
  projectId: string;
  members: { userId: string; name: string | null }[];
  onAssigned: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState("");
  const [title, setTitle] = useState<ExecutiveTitle>("Board Member");
  const [busy, setBusy] = useState(false);

  async function assign() {
    if (!user) return;
    setBusy(true);
    try {
      // Only existing project members get a title — never a side-door into the project.
      const { error } = await supabase
        .from("project_members")
        .update({ executive_title: title } as any)
        .eq("project_id", projectId)
        .eq("user_id", user);
      if (error) throw error;
      toast.success(t("budgetApproval.title_assigned", { title }));
      setUser("");
      setOpen(false);
      await onAssigned();
    } catch (e) {
      toast.error(errMessage(e, t("budgetApproval.action_failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-3 border-t border-border">
      <button onClick={() => setOpen((v) => !v)} className="text-[11px] text-brand hover:underline">
        {open ? t("budgetApproval.hide_assign_title") : t("budgetApproval.assign_title")}
      </button>
      {open && (
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
          <select
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="flex-1 bg-card text-foreground border border-border rounded-md px-2 py-1.5 text-xs"
          >
            <option value="">{t("budgetApproval.select_member")}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.userId.slice(0, 8)}
              </option>
            ))}
          </select>
          <select
            value={title}
            onChange={(e) => setTitle(e.target.value as ExecutiveTitle)}
            className="bg-card text-foreground border border-border rounded-md px-2 py-1.5 text-xs"
          >
            {EXECUTIVE_TITLES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <button
            onClick={() => void assign()}
            disabled={busy || !user}
            className="inline-flex items-center gap-1 rounded-md bg-brand text-brand-foreground text-xs font-semibold px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
          >
            <ShieldCheck className="size-3.5" />
            {t("budgetApproval.assign")}
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ activity log

function ApprovalActivityLog({ projectId, refreshKey }: { projectId: string; refreshKey: string }) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<
    Array<{
      id: string;
      action: string;
      from_status: string | null;
      to_status: string | null;
      actor_name: string | null;
      note: string | null;
      created_at: string;
      version_name: string | null;
    }>
  >([]);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("budget_status_events" as any)
        .select("id,action,from_status,to_status,actor_id,note,created_at,metadata")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50);
      const rows = (data ?? []) as any[];
      const ids = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean)));
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id,display_name").in("id", ids)
        : { data: [] };
      const nm = new Map((profs ?? []).map((p: any) => [p.id, p.display_name]));
      if (cancel) return;
      setEvents(
        rows.map((r) => ({
          ...r,
          actor_name: r.actor_id ? (nm.get(r.actor_id) ?? null) : null,
          version_name: r.metadata?.version_name ?? null,
        })),
      );
    })();
    return () => {
      cancel = true;
    };
  }, [projectId, refreshKey]);

  if (!events.length) return null;
  const shown = expanded ? events : events.slice(0, 5);
  const known = new Set([
    "status_change",
    "approver_added",
    "approver_removed",
    "approver_approved",
    "approver_rejected",
    "approval_submitted",
    "approval_cancelled",
  ]);

  return (
    <div className="pt-3 border-t border-border">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        <History className="size-3" />
        {t("budgetgovernancepanel.approval_activity_log")}
      </div>
      <div className="flex flex-col gap-1.5">
        {shown.map((e) => (
          <div
            key={e.id}
            className="grid grid-cols-1 sm:grid-cols-[110px_auto_1fr_auto] items-start gap-x-2 gap-y-0.5 text-[11px] bg-surface-2 rounded-md px-2 py-1.5"
          >
            <span className="text-muted-foreground tabular-nums whitespace-nowrap">
              {formatDateTime(e.created_at)}
            </span>
            <span className="font-semibold text-foreground">
              {known.has(e.action) ? t(`budgetApproval.event_${e.action}`) : e.action}
            </span>
            <span className="text-foreground min-w-0 break-words">
              {e.action === "status_change" && e.from_status && e.to_status && (
                <>
                  {e.from_status} → <b>{e.to_status}</b>
                </>
              )}
              {e.version_name && <span> {e.version_name}</span>}
              {e.action !== "status_change" && e.note && (
                <span className="italic"> — {e.note}</span>
              )}
            </span>
            <span className="text-muted-foreground sm:text-end">
              {t("budgetApproval.by", { name: e.actor_name ?? t("budgetApproval.system") })}
            </span>
          </div>
        ))}
      </div>
      {events.length > 5 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-brand hover:underline"
        >
          {expanded
            ? t("budgetApproval.show_less")
            : t("budgetApproval.show_all", { count: events.length })}
        </button>
      )}
    </div>
  );
}
