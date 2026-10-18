import { guardRoutePermission } from "@/lib/route-permission-guard";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageTitle } from "@/components/AppShell";
import { useStore, formatUSD } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import {
  usePaymentRequests,
  approvePaymentRequest,
  STATUS_LABEL,
  type PaymentRequestStatus,
  type PaymentSourceKind,
} from "@/lib/payment-requests";
import { PaymentStatusBadge, PaymentWorkflowActions } from "@/components/PaymentWorkflowActions";
import { PaymentTimeline } from "@/components/PaymentTimeline";
import { Wallet, ChevronLeft, ChevronDown, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/payment-approvals")({
  // Server-verified gate: typing the URL directly cannot bypass this.
  beforeLoad: () => guardRoutePermission("payments.approve"),
  component: PaymentApprovalsPage,
});

const STATUS_TABS: (PaymentRequestStatus | "all")[] = [
  "all",
  "draft",
  "waiting_approval",
  "approved",
  "paid",
  "rejected",
];

const TAB_LABEL: Record<PaymentRequestStatus | "all", string> = {
  all: "الكل",
  draft: STATUS_LABEL.draft,
  waiting_approval: STATUS_LABEL.waiting_approval,
  approved: STATUS_LABEL.approved,
  paid: STATUS_LABEL.paid,
  rejected: STATUS_LABEL.rejected,
};

// Group source_types into user-facing "Module" buckets.
const MODULES: { key: string; label: string; types: PaymentSourceKind[] }[] = [
  { key: "all", label: "كل الأقسام", types: [] },
  { key: "payroll", label: "الرواتب", types: ["payroll_row"] },
  { key: "crew", label: "طاقم العمل", types: ["crew_contract"] },
  { key: "cast", label: "الممثلون", types: ["cast_contract"] },
  { key: "vendor", label: "الموردون", types: ["vendor_contract", "purchase_order", "invoice"] },
  { key: "petty_cash", label: "المصروف النثري", types: ["petty_cash"] },
];

const SOURCE_TYPE_AR: Record<PaymentSourceKind, string> = {
  invoice: "فاتورة",
  purchase_order: "أمر شراء",
  petty_cash: "مصروف نثري",
  payroll_row: "راتب",
  crew_contract: "عقد طاقم",
  cast_contract: "عقد ممثل",
  vendor_contract: "عقد مورد",
};

function PaymentApprovalsPage() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const orgId = activeProject?.organizationId ?? null;
  const can = useCan();
  const { userId } = useAuthRoles();

  const canApprove = can("payments.approve");
  const canExecute = can("payments.execute");
  const canRequest = can("payments.request");
  const isApproverOrExecutor = canApprove || canExecute;

  const orgProjects = useMemo(
    () => projects.filter((p) => p.organizationId === orgId),
    [projects, orgId],
  );
  const accessibleProjectIds = useMemo(() => new Set(orgProjects.map((p) => p.id)), [orgProjects]);

  const { rows, loading, refresh } = usePaymentRequests(
    orgId ? { organizationId: orgId } : undefined,
  );
  const [tab, setTab] = useState<PaymentRequestStatus | "all">("waiting_approval");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(() => {
    const modTypes = MODULES.find((m) => m.key === moduleFilter)?.types ?? [];
    return rows.filter((r) => {
      if (r.project_id && !accessibleProjectIds.has(r.project_id)) return false;
      if (!isApproverOrExecutor) {
        if (!canRequest) return false;
        if (r.requested_by !== userId) return false;
      }
      if (tab !== "all" && r.status !== tab) return false;
      if (projectFilter !== "all" && r.project_id !== projectFilter) return false;
      if (moduleFilter !== "all" && !modTypes.includes(r.source_type)) return false;
      return true;
    });
  }, [
    rows,
    tab,
    projectFilter,
    moduleFilter,
    accessibleProjectIds,
    isApproverOrExecutor,
    canRequest,
    userId,
  ]);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (r.project_id && !accessibleProjectIds.has(r.project_id)) return false;
      if (!isApproverOrExecutor) {
        if (!canRequest) return false;
        if (r.requested_by !== userId) return false;
      }
      return true;
    });
  }, [rows, accessibleProjectIds, isApproverOrExecutor, canRequest, userId]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of visibleRows) map[r.status] = (map[r.status] ?? 0) + 1;
    map.all = visibleRows.length;
    return map;
  }, [visibleRows]);

  // IDs eligible for bulk approve within the current filter.
  const selectableIds = useMemo(
    () => filtered.filter((r) => r.status === "waiting_approval").map((r) => r.id),
    [filtered],
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
    await refresh();
    if (fail === 0) toast.success(`تم اعتماد ${ok} طلب.`);
    else toast.error(`تم اعتماد ${ok} · فشل ${fail}.`);
  };

  const hasAnyPaymentPerm = canRequest || canApprove || canExecute;
  const selectCls =
    "bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 ring-brand";

  return (
    <AppShell>
      <div dir="rtl">
        <PageTitle title="إدارة واعتمادات السداد" />
        <p className="text-sm text-muted-foreground mb-4 inline-flex items-center gap-2">
          <Wallet className="size-4 text-primary" />
          طلب ← اعتماد ← تنفيذ. المعتمدون والمنفّذون يتخذون الإجراءات هنا.
        </p>

        {!hasAnyPaymentPerm ? (
          <div className="rounded-2xl border border-border bg-surface-2 p-6 text-sm text-muted-foreground">
            لا تملك صلاحية عرض اعتمادات السداد. تواصل مع مسؤول المؤسسة لمنحك إحدى الصلاحيات:
            <code className="mx-1 text-brand">payments.request</code>،
            <code className="mx-1 text-brand">payments.approve</code>، أو
            <code className="mx-1 text-brand">payments.execute</code>.
          </div>
        ) : !orgId ? (
          <div className="text-sm text-muted-foreground">اختر مشروعاً لعرض طلبات السداد.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                المشروع
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className={selectCls}
                >
                  <option value="all">كل المشاريع</option>
                  {orgProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code ? `${p.code} · ${p.name}` : p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                القسم
                <select
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value)}
                  className={selectCls}
                >
                  {MODULES.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-xs text-muted-foreground ms-auto">
                {filtered.length} من {rows.length} طلب
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-4">
              {STATUS_TABS.map((s) => (
                <button
                  key={s}
                  onClick={() => setTab(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    tab === s
                      ? "bg-brand/20 text-brand border-brand/40"
                      : "bg-surface-2 text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  {TAB_LABEL[s]}
                  <span className="ms-1.5 text-[10px] text-muted-foreground">{counts[s] ?? 0}</span>
                </button>
              ))}
            </div>

            {canApprove && selectableIds.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2/60 px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  {selectedIds.length > 0
                    ? `تم تحديد ${selectedIds.length} من ${selectableIds.length} طلب بانتظار الاعتماد`
                    : `${selectableIds.length} طلب بانتظار الاعتماد ضمن التصفية الحالية`}
                </span>
                <button
                  onClick={bulkApprove}
                  disabled={bulkBusy || selectedIds.length === 0}
                  className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/15 text-success hover:bg-success/25 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                >
                  <Check className="size-3.5" />
                  {bulkBusy ? "جاري الاعتماد…" : "اعتماد الطلبات المحددة"}
                </button>
              </div>
            )}

            <div className="rounded-2xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-muted-foreground text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 w-8"></th>
                    {canApprove && (
                      <th className="px-2 py-2 w-8">
                        <input
                          type="checkbox"
                          aria-label="تحديد الكل"
                          checked={allSelected}
                          onChange={toggleAll}
                          disabled={selectableIds.length === 0}
                        />
                      </th>
                    )}
                    <th className="px-3 py-2 text-start">المصدر</th>
                    <th className="px-3 py-2 text-start">النوع</th>
                    <th className="px-3 py-2 text-end">المبلغ</th>
                    <th className="px-3 py-2 text-end">الإجمالي / المرتبط</th>
                    <th className="px-3 py-2 text-start">الحالة</th>
                    <th className="px-3 py-2 text-start">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td
                        colSpan={canApprove ? 8 : 7}
                        className="px-3 py-4 text-center text-muted-foreground"
                      >
                        جارٍ التحميل…
                      </td>
                    </tr>
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={canApprove ? 8 : 7}
                        className="px-3 py-4 text-center text-muted-foreground"
                      >
                        لا توجد طلبات مطابقة لهذه التصفية.
                      </td>
                    </tr>
                  )}
                  {filtered.map((r) => {
                    const open = !!expanded[r.id];
                    const canSelect = canApprove && r.status === "waiting_approval";
                    return (
                      <Fragment key={r.id}>
                        <tr className="border-t border-border">
                          <td className="px-2 py-2">
                            <button
                              onClick={() => setExpanded((x) => ({ ...x, [r.id]: !open }))}
                              className="p-1 rounded hover:bg-muted text-muted-foreground"
                              aria-label={open ? "إخفاء السجل" : "عرض السجل"}
                            >
                              {open ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronLeft className="size-4" />
                              )}
                            </button>
                          </td>
                          {canApprove && (
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                aria-label="تحديد الطلب"
                                disabled={!canSelect}
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
                            {SOURCE_TYPE_AR[r.source_type] ?? r.source_type}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums font-semibold" dir="ltr">
                            {formatUSD(Number(r.requested_amount))}
                          </td>
                          <td
                            className="px-3 py-2 text-end tabular-nums text-xs text-muted-foreground"
                            dir="ltr"
                          >
                            {formatUSD(Number(r.total_amount))} /{" "}
                            {formatUSD(Number(r.previously_paid))}
                          </td>
                          <td className="px-3 py-2">
                            <PaymentStatusBadge status={r.status} />
                            {r.status === "rejected" && r.rejection_reason && (
                              <div
                                className="text-[11px] text-destructive mt-1 max-w-[200px] truncate"
                                title={r.rejection_reason}
                              >
                                {r.rejection_reason}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <PaymentWorkflowActions request={r} compact />
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-t border-border bg-surface-2/50">
                            <td colSpan={canApprove ? 8 : 7} className="px-4 py-3">
                              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                                سجل التدقيق
                              </div>
                              <PaymentTimeline request={r} />
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
