import { guardRoutePermission } from "@/lib/route-permission-guard";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AppShell, PageTitle } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import { formatCurrency } from "@/lib/format";
import {
  usePaymentRequests,
  usePaymentChainStatus,
  approvePaymentRequest,
  filterApprovalRows,
  requestTypeKey,
  statusLabelKey,
  type ApprovalTab,
  type RequestModule,
} from "@/lib/payment-requests";
import { PaymentStatusBadge, PaymentWorkflowActions } from "@/components/PaymentWorkflowActions";
import { PaymentTimeline } from "@/components/PaymentTimeline";
import { ApprovalChainSettings } from "@/components/ApprovalChainSettings";
import { Wallet, ChevronRight, ChevronDown, Check, Settings2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/payment-approvals")({
  // Server-verified gate: typing the URL directly cannot bypass this.
  beforeLoad: () => guardRoutePermission("payments.approve"),
  component: PaymentApprovalsPage,
});

const STATUS_TABS: ApprovalTab[] = [
  "my_turn",
  "waiting_approval",
  "approved",
  "paid",
  "draft",
  "rejected",
  "cancelled",
  "all",
];

const MODULES: (RequestModule | "all")[] = ["all", "contracts", "payroll", "vendor", "petty_cash"];

function PaymentApprovalsPage() {
  const { t } = useTranslation();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const orgId = activeProject?.organizationId ?? null;
  const can = useCan();
  const { userId, isSuperAdmin, adminOrgIds } = useAuthRoles();

  const canApprove = can("payments.approve");
  const canExecute = can("payments.execute");
  const canRequest = can("payments.request");
  const seesAll = canApprove || canExecute;
  const isOrgAdmin = isSuperAdmin || (!!orgId && adminOrgIds.includes(orgId));

  // Scoped to the active project: this screen lives inside a project.
  const { rows, loading, refresh } = usePaymentRequests(
    orgId && activeProjectId ? { organizationId: orgId, projectId: activeProjectId } : undefined,
  );
  const reloadKey = useMemo(() => rows.map((r) => `${r.id}:${r.status}`).join(","), [rows]);
  const { byId: chain, refresh: refreshChain } = usePaymentChainStatus(
    orgId,
    activeProjectId ?? null,
    reloadKey,
  );
  const myTurn = useMemo(
    () =>
      new Set(
        Object.values(chain)
          .filter((c) => c.can_act)
          .map((c) => c.request_id),
      ),
    [chain],
  );

  const [tab, setTab] = useState<ApprovalTab>(seesAll ? "my_turn" : "all");
  const [moduleFilter, setModuleFilter] = useState<RequestModule | "all">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showChain, setShowChain] = useState(false);

  const scope = { projectId: activeProjectId ?? null, myTurn, seesAll, userId };
  const filtered = useMemo(
    () => filterApprovalRows(rows, { ...scope, tab, module: moduleFilter }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, tab, moduleFilter, activeProjectId, myTurn, seesAll, userId],
  );
  const visibleRows = useMemo(
    () => filterApprovalRows(rows, { ...scope, tab: "all", module: "all" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, activeProjectId, myTurn, seesAll, userId],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: visibleRows.length, my_turn: 0 };
    for (const r of visibleRows) {
      map[r.status] = (map[r.status] ?? 0) + 1;
      if (myTurn.has(r.id)) map.my_turn += 1;
    }
    return map;
  }, [visibleRows, myTurn]);

  // Bulk approval: only requests where it is the current user's turn.
  const selectableIds = useMemo(
    () => filtered.filter((r) => myTurn.has(r.id)).map((r) => r.id),
    [filtered, myTurn],
  );
  const selectedIds = useMemo(
    () => selectableIds.filter((id) => selected[id]),
    [selectableIds, selected],
  );
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      for (const id of selectableIds) next[id] = true;
      setSelected(next);
    }
  };

  const reload = async () => {
    await refresh();
    await refreshChain();
  };

  const bulkApprove = async () => {
    if (!selectedIds.length) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of selectedIds) {
      try {
        await approvePaymentRequest(id);
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    setSelected({});
    await reload();
    if (fail === 0) toast.success(t("approvals.bulk.done", { count: ok }));
    else toast.error(t("approvals.bulk.partial", { ok, fail }));
  };

  const hasAnyPaymentPerm = canRequest || canApprove || canExecute;
  const selectCls =
    "bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 ring-brand";
  const showSelect = selectableIds.length > 0;
  const cols = showSelect ? 8 : 7;

  return (
    <AppShell>
      <div>
        <PageTitle title={t("approvals.title")} />
        <p className="text-sm text-muted-foreground mb-4 inline-flex items-center gap-2">
          <Wallet className="size-4 text-primary" />
          {t("approvals.subtitle")}
        </p>

        {!hasAnyPaymentPerm ? (
          <div className="rounded-2xl border border-border bg-surface-2 p-6 text-sm text-muted-foreground">
            {t("approvals.noPermission")}
            <code className="mx-1 text-brand">payments.request</code>
            <code className="mx-1 text-brand">payments.approve</code>
            <code className="mx-1 text-brand">payments.execute</code>
          </div>
        ) : !orgId || !activeProjectId ? (
          <div className="text-sm text-muted-foreground">{t("approvals.pickProject")}</div>
        ) : (
          <>
            {isOrgAdmin && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setShowChain((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                  aria-expanded={showChain}
                >
                  <Settings2 className="size-3.5" /> {t("approvals.chain.toggle")}
                </button>
              </div>
            )}
            {isOrgAdmin && showChain && (
              <ApprovalChainSettings organizationId={orgId} onChanged={() => void refreshChain()} />
            )}

            <div className="flex flex-wrap items-center gap-3 mb-3">
              <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                {t("approvals.module.label")}
                <select
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value as RequestModule | "all")}
                  className={selectCls}
                >
                  {MODULES.map((m) => (
                    <option key={m} value={m}>
                      {t(`approvals.module.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-xs text-muted-foreground ms-auto">
                {t("approvals.countOf", { shown: filtered.length, total: visibleRows.length })}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-4" role="tablist">
              {STATUS_TABS.map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={tab === s}
                  onClick={() => setTab(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    tab === s
                      ? "bg-brand/20 text-brand border-brand/40"
                      : "bg-surface-2 text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  {s === "all"
                    ? t("approvals.tab.all")
                    : s === "my_turn"
                      ? t("approvals.tab.myTurn")
                      : t(statusLabelKey(s))}
                  <span className="ms-1.5 text-[10px] text-muted-foreground">{counts[s] ?? 0}</span>
                </button>
              ))}
            </div>

            {showSelect && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2/60 px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  {selectedIds.length > 0
                    ? t("approvals.bulk.selected", {
                        count: selectedIds.length,
                        total: selectableIds.length,
                      })
                    : t("approvals.bulk.available", { count: selectableIds.length })}
                </span>
                <button
                  onClick={bulkApprove}
                  disabled={bulkBusy || selectedIds.length === 0}
                  className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/15 text-success hover:bg-success/25 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                >
                  <Check className="size-3.5" />
                  {bulkBusy ? t("approvals.working") : t("approvals.bulk.approve")}
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-surface-2 text-muted-foreground text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 w-8"></th>
                    {showSelect && (
                      <th className="px-2 py-2 w-8">
                        <input
                          type="checkbox"
                          aria-label={t("approvals.selectAll")}
                          checked={allSelected}
                          onChange={toggleAll}
                        />
                      </th>
                    )}
                    <th className="px-3 py-2 text-start">{t("approvals.col.source")}</th>
                    <th className="px-3 py-2 text-start">{t("approvals.col.type")}</th>
                    <th className="px-3 py-2 text-end">{t("approvals.col.amount")}</th>
                    <th className="px-3 py-2 text-end">{t("approvals.col.totalRequested")}</th>
                    <th className="px-3 py-2 text-start">{t("approvals.col.status")}</th>
                    <th className="px-3 py-2 text-start">{t("approvals.col.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={cols} className="px-3 py-4 text-center text-muted-foreground">
                        {t("approvals.loading")}
                      </td>
                    </tr>
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={cols} className="px-3 py-4 text-center text-muted-foreground">
                        {tab === "my_turn" ? t("approvals.emptyMyTurn") : t("approvals.empty")}
                      </td>
                    </tr>
                  )}
                  {filtered.map((r) => {
                    const open = !!expanded[r.id];
                    const c = chain[r.id] ?? null;
                    const money = (n: number) =>
                      formatCurrency(n, { currency: r.currency || "SAR", decimals: 2 });
                    return (
                      <Fragment key={r.id}>
                        <tr className="border-t border-border">
                          <td className="px-2 py-2">
                            <button
                              onClick={() => setExpanded((x) => ({ ...x, [r.id]: !open }))}
                              className="p-1 rounded hover:bg-muted text-muted-foreground"
                              aria-label={
                                open ? t("approvals.hideTrail") : t("approvals.showTrail")
                              }
                              aria-expanded={open}
                            >
                              {open ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4 rtl:-scale-x-100" />
                              )}
                            </button>
                          </td>
                          {showSelect && (
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                aria-label={t("approvals.selectOne")}
                                disabled={!myTurn.has(r.id)}
                                checked={!!selected[r.id]}
                                onChange={(e) =>
                                  setSelected((s) => ({ ...s, [r.id]: e.target.checked }))
                                }
                              />
                            </td>
                          )}
                          <td
                            className="px-3 py-2 max-w-[240px] truncate"
                            title={r.source_label ?? ""}
                          >
                            {r.source_label ?? r.source_id}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {t(requestTypeKey(r), { defaultValue: r.source_type })}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums font-semibold" dir="ltr">
                            {money(Number(r.requested_amount))}
                          </td>
                          <td
                            className="px-3 py-2 text-end tabular-nums text-xs text-muted-foreground"
                            dir="ltr"
                          >
                            {money(Number(r.total_amount))} / {money(Number(r.previously_paid))}
                          </td>
                          <td className="px-3 py-2">
                            <PaymentStatusBadge status={r.status} />
                            {c && c.required_levels > 0 && r.status === "waiting_approval" && (
                              <div className="text-[11px] text-muted-foreground mt-1">
                                {t("approvals.levelProgress", {
                                  done: c.approved_levels,
                                  total: c.required_levels,
                                })}
                              </div>
                            )}
                            {(r.status === "rejected" || r.status === "cancelled") &&
                              (r.rejection_reason || r.cancellation_reason) && (
                                <div
                                  className="text-[11px] text-destructive mt-1 max-w-[200px] truncate"
                                  title={r.rejection_reason ?? r.cancellation_reason ?? ""}
                                >
                                  {r.rejection_reason ?? r.cancellation_reason}
                                </div>
                              )}
                          </td>
                          <td className="px-3 py-2">
                            <PaymentWorkflowActions
                              request={r}
                              chain={c}
                              compact
                              onChanged={() => void reload()}
                            />
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-t border-border bg-surface-2/50">
                            <td colSpan={cols} className="px-4 py-3">
                              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                                {t("approvals.trail")}
                              </div>
                              <PaymentTimeline request={r} chain={c} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
