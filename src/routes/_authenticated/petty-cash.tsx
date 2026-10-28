import { formatDate } from "@/lib/date-format";
import { formatAmount } from "@/lib/format-number";
import { assertUploadAllowed, uploadContentType } from "@/lib/upload-policy";
import { createFileRoute } from "@tanstack/react-router";
import { DateInput } from "@/components/ui/date-input";
import { storageAudited } from "@/lib/storage-audit";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Receipt as ReceiptIcon,
  Wallet,
  Plus,
  Check,
  X as XIcon,
  RotateCcw,
  Paperclip,
  Eye,
  Layers,
  CreditCard,
  Banknote,
  ArrowLeftRight,
  History as HistoryIcon,
} from "lucide-react";
import { PettyCashHistoryModal } from "@/components/PettyCashHistoryModal";
import { AppShell, PageTitle } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import { PermissionDeniedBanner } from "@/lib/permission-guard";
import { BudgetCodeSelector } from "@/components/BudgetCodeSelector";
import { GlAccountSelector } from "@/components/GlAccountSelector";
import { useGlAccounts } from "@/lib/gl-accounts";
import { recordAudit } from "@/lib/audit-log";
import { parseOpenParam } from "@/lib/document-refs";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/petty-cash")({
  validateSearch: (s: Record<string, unknown>): { open?: string } => {
    const open = parseOpenParam(s.open);
    return open ? { open } : {};
  },
  component: () => (
    <AppShell>
      <PettyCashPage />
    </AppShell>
  ),
});

type Crew = { id: string; full_name: string; role: string | null };
type FloatType = "cash" | "card" | "bank_transfer";
type AcceptanceStatus = "pending_acceptance" | "active" | "closed";
type Advance = {
  id: string;
  project_id: string | null;
  organization_id: string | null;
  crew_member_id: string | null;
  holder: string;
  total_advance: number;
  expenses: number;
  status: string;
  notes: string | null;
  created_at: string;
  issued_at: string | null;
  currency: string;
  fx_rate: number;
  funding_bank_gl_id: string | null;
  float_gl_id: string | null;
  parent_advance_id: string | null;
  float_type: FloatType;
  acceptance_status: AcceptanceStatus;
  accepted_at: string | null;
  accepted_by: string | null;
};
type ReceiptRow = {
  id: string;
  advance_id: string;
  project_id: string | null;
  amount: number;
  currency: string;
  fx_rate: number;
  budget_code: string | null;
  linked_budget_line_id: string | null;
  status: "pending" | "approved" | "rejected";
  received_from: string | null;
  vendor: string | null;
  description: string | null;
  recipient: string | null;
  method: string | null;
  notes: string | null;
  date: string | null;
  created_at: string;
  attachment_path: string | null;
  attachment_name: string | null;
};
type PerDiemPaid = {
  id: string;
  advance_id: string;
  date: string;
  person_name: string;
  budget_code: string | null;
  amount: number;
  currency: string;
};

const FLOAT_TYPE_LABELS: Record<FloatType, string> = {
  cash: "Physical Cash",
  card: "Corporate / Prepaid Card",
  bank_transfer: "Bank Transfer",
};
const FLOAT_TYPE_ICONS: Record<FloatType, React.ComponentType<{ className?: string }>> = {
  cash: Banknote,
  card: CreditCard,
  bank_transfer: ArrowLeftRight,
};

function fmtAmount(n: number, ccy: string) {
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${ccy}`;
}

/**
 * Resolve the project-locked FX rate for a given currency to SAR.
 * The project only stores USD→SAR (default 3.75); other currencies fall
 * back to 1 (they must be entered in their own ledger currency).
 */
function projectFxFor(currency: string, projectSarPerUsd: number): number {
  if (currency === "SAR") return 1;
  if (currency === "USD") return Number(projectSarPerUsd) || 3.75;
  return 1;
}

function PettyCashPage() {
  const { t } = useTranslation();

  const can = useCan();
  const roles = useAuthRoles();
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const projectId = activeProject?.id ?? null;
  const orgId = activeProject?.organizationId ?? null;
  const projectFxRate = Number(activeProject?.fxRate ?? 3.75) || 3.75;

  // Legacy crew_members rows: only used to show the holder of old floats.
  const [crew, setCrew] = useState<Crew[]>([]);
  // B08: float holders come from people flagged "Petty Cash Custodian" on their contract.
  const people = useStore((s) => s.people);
  const custodians = useMemo<Crew[]>(
    () =>
      people
        .filter((p) => p.isPettyCashCustodian)
        .map((p) => ({ id: p.id, full_name: p.fullName, role: p.position || null }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [people],
  );
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [perDiem, setPerDiem] = useState<PerDiemPaid[]>([]);
  const [loading, setLoading] = useState(false);

  async function reloadAll() {
    if (!projectId) return;
    setLoading(true);
    const [c, a, r, pd] = await Promise.all([
      supabase
        .from("crew_members")
        .select("id, full_name, role")
        .eq("project_id", projectId)
        .order("full_name"),
      supabase
        .from("cash_advances")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase
        .from("cash_advance_receipts")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase
        .from("per_diem_ledger")
        .select(
          "id, cash_advance_id, period_end, total_amount, currency, budget_code, person_id, people(full_name)",
        )
        .eq("project_id", projectId)
        .eq("status", "paid")
        .not("cash_advance_id", "is", null),
    ]);
    setCrew((c.data ?? []) as Crew[]);
    setAdvances((a.data ?? []) as unknown as Advance[]);
    setReceipts((r.data ?? []) as unknown as ReceiptRow[]);
    setPerDiem(
      ((pd.data ?? []) as any[]).map((row) => ({
        id: row.id,
        advance_id: row.cash_advance_id,
        date: row.period_end,
        person_name: row.people?.full_name ?? "—",
        budget_code: row.budget_code,
        amount: Number(row.total_amount) || 0,
        currency: row.currency ?? "SAR",
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    if (!projectId || !roles.loaded) return;
    void reloadAll();
  }, [projectId, roles.loaded]);

  // Balance rollup per advance (in advance's own currency).
  // A parent float additionally has sub-float allocations deducted.
  const balances = useMemo(() => {
    const map = new Map<
      string,
      { approved: number; pending: number; perdiem: number; subAllocated: number }
    >();
    for (const a of advances)
      map.set(a.id, { approved: 0, pending: 0, perdiem: 0, subAllocated: 0 });
    for (const r of receipts) {
      const cur = map.get(r.advance_id);
      if (!cur) continue;
      const amt = Number(r.amount) || 0;
      if (r.status === "approved") cur.approved += amt;
      else if (r.status === "pending") cur.pending += amt;
    }
    for (const p of perDiem) {
      const cur = map.get(p.advance_id);
      if (!cur) continue;
      cur.perdiem += p.amount;
    }
    for (const a of advances) {
      if (!a.parent_advance_id) continue;
      if (a.status === "rejected") continue;
      const parent = map.get(a.parent_advance_id);
      if (!parent) continue;
      parent.subAllocated += Number(a.total_advance) || 0;
    }
    return map;
  }, [advances, receipts, perDiem]);

  function remainingOf(a: Advance): number {
    const bal = balances.get(a.id) ?? { approved: 0, pending: 0, perdiem: 0, subAllocated: 0 };
    return (Number(a.total_advance) || 0) - bal.approved - bal.perdiem - bal.subAllocated;
  }

  // Hierarchical ordering: parents followed by their children (depth = 1),
  // with orphan sub-floats (parent not in scope) rendered at depth 0.
  const orderedAdvances = useMemo(() => {
    const byParent = new Map<string, Advance[]>();
    const roots: Advance[] = [];
    const ids = new Set(advances.map((a) => a.id));
    for (const a of advances) {
      if (a.parent_advance_id && ids.has(a.parent_advance_id)) {
        const arr = byParent.get(a.parent_advance_id) ?? [];
        arr.push(a);
        byParent.set(a.parent_advance_id, arr);
      } else {
        roots.push(a);
      }
    }
    const out: { a: Advance; depth: number }[] = [];
    const walk = (node: Advance, depth: number) => {
      out.push({ a: node, depth });
      const kids = byParent.get(node.id) ?? [];
      for (const k of kids) walk(k, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    return out;
  }, [advances]);

  // Fire-and-forget audit helper for petty-cash workflow events.
  function auditPettyCash(action: string, a: Advance, extra: Record<string, unknown> = {}) {
    void recordAudit({
      category: "other",
      action: `petty_cash.${action}`,
      entity: `cash_advance:${a.id}`,
      summary: `Petty cash ${action.replace(/_/g, " ")}: ${a.holder} · ${fmtAmount(Number(a.total_advance) || 0, a.currency)}`,
      organization_id: a.organization_id,
      project_id: a.project_id,
      details: {
        advance_id: a.id,
        parent_advance_id: a.parent_advance_id,
        float_type: a.float_type,
        currency: a.currency,
        ...extra,
      },
    });
  }
  function auditReceipt(
    action: string,
    r: ReceiptRow,
    a: Advance | undefined,
    extra: Record<string, unknown> = {},
  ) {
    void recordAudit({
      category: "other",
      action: `petty_cash.receipt.${action}`,
      entity: `cash_advance_receipt:${r.id}`,
      summary: `Receipt ${action}: ${fmtAmount(Number(r.amount) || 0, r.currency ?? a?.currency ?? "SAR")}${r.vendor ? ` · ${r.vendor}` : ""}`,
      organization_id: a?.organization_id ?? null,
      project_id: r.project_id ?? a?.project_id ?? null,
      details: {
        receipt_id: r.id,
        advance_id: r.advance_id,
        budget_code: r.budget_code,
        amount: Number(r.amount) || 0,
        currency: r.currency,
        ...extra,
      },
    });
  }

  const [showAdv, setShowAdv] = useState(false);
  const [showRecFor, setShowRecFor] = useState<Advance | null>(null);
  const [showRecPicker, setShowRecPicker] = useState(false);
  const [historyFor, setHistoryFor] = useState<Advance | null>(null);
  // G11: ?open=<float id | receipt id> opens the float's history (receipts included).
  const { open: openId } = Route.useSearch();
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || openedRef.current === openId) return;
    const advanceId = receipts.find((r) => r.id === openId)?.advance_id ?? openId;
    const adv = advances.find((a) => a.id === advanceId);
    if (!adv) return;
    openedRef.current = openId;
    setHistoryFor(adv);
  }, [openId, advances, receipts]);

  if (!roles.loaded || !projectId) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (!can("accounting.view"))
    return <PermissionDeniedBanner perm="accounting.view" action="View Petty Cash" />;

  const canIssue = can("pettycash.reconcile");
  const canLog = can("pettycash.log") || can("field.receipts");
  const canApprove = can("pettycash.reconcile");

  const kpi = advances.reduce(
    (acc, a) => {
      const bal = balances.get(a.id) ?? { approved: 0, pending: 0, perdiem: 0, subAllocated: 0 };
      const spent = bal.approved + bal.perdiem;
      const fx = Number(a.fx_rate) || 1;
      acc.advanced += (Number(a.total_advance) || 0) * fx;
      acc.spent += spent * fx;
      acc.pending += bal.pending * fx;
      return acc;
    },
    { advanced: 0, spent: 0, pending: 0 },
  );

  // Active master floats available as funding sources for sub-floats
  const masterFloatOptions = advances.filter(
    (a) =>
      a.acceptance_status === "active" &&
      (a.status === "open" || a.status === "approved") &&
      remainingOf(a) > 0,
  );

  return (
    <>
      <PageTitle
        title={t("petty_cash.petty_cash_floats")}
        action={
          canIssue ? (
            <button
              onClick={() => setShowAdv(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:opacity-90"
            >
              <Plus className="size-4" />
              {t("petty_cash.issue_float")}
            </button>
          ) : null
        }
      />

      <div className="grid gap-3 md:grid-cols-3 mb-6">
        {[
          {
            label: "Total Advanced (SAR eq.)",
            value: kpi.advanced,
            tone: "from-info/20 to-info/5 border-info/30",
          },
          {
            label: "Reconciled + Per Diem",
            value: kpi.spent,
            tone: "from-success/20 to-success/5 border-success/30",
          },
          {
            label: "Remaining Balance",
            value: kpi.advanced - kpi.spent,
            tone: "from-warning/20 to-warning/5 border-warning/30",
          },
        ].map((c) => (
          <div key={c.label} className={`rounded-2xl border bg-gradient-to-br p-4 ${c.tone}`}>
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Wallet className="size-4" />
              {c.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">
              {fmtAmount(c.value, "SAR")}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-surface/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-semibold flex items-center justify-between">
          <span>{t("petty_cash.cash_advances_floats")}</span>
          <button
            onClick={reloadAll}
            className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-surface text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-start p-3">{t("platform.ui.date")}</th>
                <th className="text-start p-3">{t("platform.ui.holder")}</th>
                <th className="text-start p-3">{t("platform.ui.type")}</th>
                <th className="text-start p-3">{t("platform.ui.ccy")}</th>
                <th className="text-end p-3">{t("platform.ui.advance")}</th>
                <th className="text-end p-3">Sub-floats</th>
                <th className="text-end p-3">{t("platform.ui.spent")}</th>
                <th className="text-end p-3">{t("platform.ui.pending")}</th>
                <th className="text-end p-3">{t("platform.ui.remaining")}</th>
                <th className="text-start p-3">{t("platform.ui.approval")}</th>
                <th className="text-start p-3">{t("platform.ui.acceptance")}</th>
                <th className="text-end p-3">{t("platform.ui.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={12} className="p-4 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading &&
                orderedAdvances.map(({ a, depth }) => {
                  const bal = balances.get(a.id) ?? {
                    approved: 0,
                    pending: 0,
                    perdiem: 0,
                    subAllocated: 0,
                  };
                  const spent = bal.approved + bal.perdiem;
                  const remaining = (Number(a.total_advance) || 0) - spent - bal.subAllocated;
                  const holder = a.crew_member_id
                    ? crew.find((c) => c.id === a.crew_member_id)?.full_name
                    : a.holder;
                  const isApprovalPending = a.status === "pending_approval";
                  const isApproved =
                    a.status === "open" || a.status === "approved" || a.status === "closed";
                  const isAccepted = a.acceptance_status === "active";
                  const isPendingAccept = a.acceptance_status === "pending_acceptance";
                  const TypeIcon = FLOAT_TYPE_ICONS[a.float_type] ?? Banknote;
                  const parent = a.parent_advance_id
                    ? advances.find((x) => x.id === a.parent_advance_id)
                    : null;
                  const isChild = depth > 0;
                  const canClose = remaining <= 0.005 && bal.pending <= 0.005;
                  return (
                    <tr
                      key={a.id}
                      className={`border-t border-border ${isChild ? "bg-info/[0.04]" : ""}`}
                    >
                      <td className="p-3 text-muted-foreground">{formatDate(a.created_at)}</td>
                      <td className="p-3">
                        <div
                          className="flex items-center gap-2"
                          style={{ paddingInlineStart: depth > 0 ? depth * 16 : 0 }}
                        >
                          {isChild && (
                            <span
                              className="inline-flex items-center text-info text-xs select-none"
                              aria-hidden
                            >
                              └─
                            </span>
                          )}
                          {parent && (
                            <Layers
                              className="size-3.5 text-info"
                              aria-label={t("petty_cash.subfloat")}
                            />
                          )}
                          <span className={isChild ? "text-foreground/90" : "font-medium"}>
                            {holder ?? "—"}
                          </span>
                        </div>
                        {parent && (
                          <div
                            className="text-[11px] text-muted-foreground mt-0.5"
                            style={{ paddingInlineStart: depth * 16 + 18 }}
                          >
                            ↳ from {parent.holder}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <TypeIcon className="size-3.5" />
                          {FLOAT_TYPE_LABELS[a.float_type]}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">{a.currency}</td>
                      <td className="p-3 text-end tabular-nums">
                        {fmtAmount(Number(a.total_advance) || 0, a.currency)}
                      </td>
                      <td className="p-3 text-end tabular-nums text-info">
                        {bal.subAllocated > 0 ? fmtAmount(bal.subAllocated, a.currency) : "—"}
                      </td>
                      <td className="p-3 text-end tabular-nums text-success">
                        {fmtAmount(spent, a.currency)}
                      </td>
                      <td className="p-3 text-end tabular-nums text-warning">
                        {fmtAmount(bal.pending, a.currency)}
                      </td>
                      <td className="p-3 text-end tabular-nums font-semibold">
                        {fmtAmount(remaining, a.currency)}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                            isApprovalPending
                              ? "bg-warning/20 text-warning"
                              : a.status === "rejected"
                                ? "bg-destructive/20 text-destructive"
                                : "bg-success/20 text-success"
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                            isPendingAccept
                              ? "bg-warning/20 text-warning"
                              : a.acceptance_status === "closed"
                                ? "bg-surface-2 text-muted-foreground"
                                : "bg-success/20 text-success"
                          }`}
                        >
                          {a.acceptance_status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="p-3 text-end space-x-1 whitespace-nowrap">
                        {canApprove && isApprovalPending && (
                          <>
                            <button
                              onClick={async () => {
                                const { error } = await supabase
                                  .from("cash_advances")
                                  .update({ status: "open", approved_at: new Date().toISOString() })
                                  .eq("id", a.id);
                                if (error) toast.error(error.message);
                                else {
                                  await postJournalEntry(a, "issued");
                                  auditPettyCash("float_approved", a, { new_status: "open" });
                                  toast.success(t("petty_cash.float_approved_journal_posted"));
                                  void reloadAll();
                                }
                              }}
                              className="text-xs px-2 py-1 rounded-lg bg-success/15 hover:bg-success/25 text-success inline-flex items-center gap-1"
                            >
                              <Check className="size-3" />
                              Approve
                            </button>
                            <button
                              onClick={async () => {
                                const { error } = await supabase
                                  .from("cash_advances")
                                  .update({ status: "rejected" })
                                  .eq("id", a.id);
                                if (error) toast.error(error.message);
                                else {
                                  auditPettyCash("float_rejected", a, { new_status: "rejected" });
                                  toast.success(t("petty_cash.float_rejected"));
                                  void reloadAll();
                                }
                              }}
                              className="text-xs px-2 py-1 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive inline-flex items-center gap-1"
                            >
                              <XIcon className="size-3" />
                              Reject
                            </button>
                          </>
                        )}
                        {isApproved && isPendingAccept && (
                          <button
                            onClick={async () => {
                              const { data: session } = await supabase.auth.getUser();
                              const { error } = await supabase
                                .from("cash_advances")
                                .update({
                                  acceptance_status: "active",
                                  accepted_at: new Date().toISOString(),
                                  accepted_by: session.user?.id ?? null,
                                })
                                .eq("id", a.id);
                              if (error) toast.error(error.message);
                              else {
                                auditPettyCash("float_accepted", a, {
                                  accepted_by: session.user?.id ?? null,
                                });
                                toast.success(`${a.holder} accepted the float`);
                                void reloadAll();
                              }
                            }}
                            className="text-xs px-2 py-1 rounded-lg bg-warning/15 hover:bg-warning/25 text-warning inline-flex items-center gap-1"
                          >
                            <Check className="size-3" />
                            {t("petty_cash.mark_accepted")}
                          </button>
                        )}
                        {canLog && isApproved && (
                          <button
                            onClick={() => {
                              if (!isAccepted) {
                                toast.error(
                                  a.acceptance_status === "pending_acceptance"
                                    ? `${a.holder} must mark the float as accepted before receipts can be logged.`
                                    : "This float is closed — receipts can no longer be logged against it.",
                                );
                                return;
                              }
                              setShowRecFor(a);
                            }}
                            disabled={!isAccepted && a.acceptance_status === "closed"}
                            title={
                              isAccepted
                                ? "Log a receipt against this float"
                                : a.acceptance_status === "pending_acceptance"
                                  ? "Waiting for holder to accept the float"
                                  : "Float is closed"
                            }
                            className="text-xs px-2 py-1 rounded-lg bg-surface-2 hover:bg-muted inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <ReceiptIcon className="size-3" />
                            {t("petty_cash.log_receipt")}
                          </button>
                        )}
                        {canApprove &&
                          isApproved &&
                          isAccepted &&
                          a.acceptance_status !== "closed" && (
                            <button
                              onClick={async () => {
                                // Guard: cannot close a float with outstanding un-reconciled balance or pending receipts.
                                if (!canClose) {
                                  toast.error(
                                    bal.pending > 0.005
                                      ? `Cannot close: ${fmtAmount(bal.pending, a.currency)} in pending receipts must be approved or rejected first.`
                                      : `Cannot close: ${fmtAmount(remaining, a.currency)} un-reconciled remains. Log receipts or return funds first.`,
                                  );
                                  return;
                                }
                                const { error } = await supabase
                                  .from("cash_advances")
                                  .update({ acceptance_status: "closed", status: "closed" })
                                  .eq("id", a.id);
                                if (error) toast.error(error.message);
                                else {
                                  auditPettyCash("float_closed", a, {
                                    remaining_at_close: remaining,
                                  });
                                  toast.success(t("petty_cash.float_closed"));
                                  void reloadAll();
                                }
                              }}
                              title={
                                canClose
                                  ? "Close this float"
                                  : "Reconcile the remaining balance and clear pending receipts before closing"
                              }
                              className="text-xs px-2 py-1 rounded-lg bg-surface hover:bg-muted text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Close
                            </button>
                          )}
                        <button
                          onClick={() => setHistoryFor(a)}
                          title={t("petty_cash.view_activity_log_for_this_float")}
                          className="text-xs px-2 py-1 rounded-lg bg-surface hover:bg-muted text-foreground/80 inline-flex items-center gap-1"
                        >
                          <HistoryIcon className="size-3" /> History
                        </button>
                      </td>
                    </tr>
                  );
                })}
              {!loading && advances.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-6 text-center text-muted-foreground">
                    {t("petty_cash.no_floats_yet_click")}
                    <b>{t("petty_cash.issue_float")}</b> to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface/60 overflow-hidden mt-6">
        <div className="px-4 py-3 border-b border-border font-semibold flex items-center justify-between">
          <span>{t("petty_cash.receipts_reconciliation")}</span>
          {canLog &&
            advances.some(
              (a) =>
                (a.status === "open" || a.status === "approved") &&
                a.acceptance_status === "active",
            ) && (
              <button
                onClick={() => setShowRecPicker(true)}
                className="text-xs inline-flex items-center gap-1 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary-foreground/90 px-2 py-1"
              >
                <Plus className="size-3" />
                {t("petty_cash.log_receipt")}
              </button>
            )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-surface text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-start p-3">{t("platform.ui.date")}</th>
                <th className="text-start p-3">{t("platform.ui.holder")}</th>
                <th className="text-start p-3">{t("petty_cash.vendor_payee")}</th>
                <th className="text-start p-3">{t("platform.ui.description")}</th>
                <th className="text-start p-3">{t("platform.ui.budgetCode")}</th>
                <th className="text-end p-3">{t("platform.ui.amount")}</th>
                <th className="text-start p-3">{t("platform.ui.source")}</th>
                <th className="text-start p-3">{t("platform.ui.status")}</th>
                <th className="text-center p-3">{t("platform.ui.file")}</th>
                <th className="text-end p-3">{t("platform.ui.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => {
                const a = advances.find((x) => x.id === r.advance_id);
                const holder = a?.crew_member_id
                  ? crew.find((c) => c.id === a.crew_member_id)?.full_name
                  : a?.holder;
                const statusLabel = r.status === "pending" ? "submitted" : r.status;
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-3 text-muted-foreground">
                      {r.date ?? formatDate(r.created_at)}
                    </td>
                    <td className="p-3">{holder ?? "—"}</td>
                    <td className="p-3">{r.vendor ?? r.received_from ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{r.description ?? r.notes ?? "—"}</td>
                    <td className="p-3">{r.budget_code ?? "—"}</td>
                    <td className="p-3 text-end tabular-nums">
                      {fmtAmount(Number(r.amount) || 0, r.currency ?? a?.currency ?? "SAR")}
                    </td>
                    <td className="p-3 text-muted-foreground">{t("platform.ui.receipt")}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                          r.status === "approved"
                            ? "bg-success/20 text-success"
                            : r.status === "rejected"
                              ? "bg-destructive/20 text-destructive"
                              : "bg-warning/20 text-warning"
                        }`}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      {r.attachment_path ? (
                        <AttachmentViewer path={r.attachment_path} name={r.attachment_name} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-end whitespace-nowrap">
                      {canApprove && r.status === "pending" && (
                        <span className="inline-flex gap-1">
                          <button
                            onClick={async () => {
                              const { error } = await supabase
                                .from("cash_advance_receipts")
                                .update({
                                  status: "approved",
                                  approved_at: new Date().toISOString(),
                                })
                                .eq("id", r.id);
                              if (error) {
                                toast.error(error.message);
                                return;
                              }
                              await postReceiptActual(r, a);
                              auditReceipt("approved", r, a, { posted_actual: !!r.budget_code });
                              toast.success(t("petty_cash.receipt_approved_actuals_updated"));
                              void reloadAll();
                            }}
                            className="text-xs px-2 py-1 rounded-lg bg-success/15 hover:bg-success/25 text-success inline-flex items-center gap-1"
                          >
                            <Check className="size-3" />
                            Approve
                          </button>
                          <button
                            onClick={async () => {
                              const { error } = await supabase
                                .from("cash_advance_receipts")
                                .update({ status: "rejected" })
                                .eq("id", r.id);
                              if (error) toast.error(error.message);
                              else {
                                auditReceipt("rejected", r, a);
                                toast.success(t("petty_cash.receipt_rejected"));
                                void reloadAll();
                              }
                            }}
                            className="text-xs px-2 py-1 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive inline-flex items-center gap-1"
                          >
                            <XIcon className="size-3" />
                            Reject
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {perDiem.map((p) => {
                const a = advances.find((x) => x.id === p.advance_id);
                const holder = a?.crew_member_id
                  ? crew.find((c) => c.id === a.crew_member_id)?.full_name
                  : a?.holder;
                return (
                  <tr key={`pd-${p.id}`} className="border-t border-border bg-info/[0.03]">
                    <td className="p-3 text-muted-foreground">
                      {p.date ? formatDate(p.date) : "—"}
                    </td>
                    <td className="p-3">{holder ?? "—"}</td>
                    <td className="p-3">{p.person_name}</td>
                    <td className="p-3 text-muted-foreground">
                      {t("petty_cash.per_diem_allowance")}
                    </td>
                    <td className="p-3">{p.budget_code ?? "—"}</td>
                    <td className="p-3 text-end tabular-nums">{fmtAmount(p.amount, p.currency)}</td>
                    <td className="p-3 text-info">{t("petty_cash.per_diem")}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-success/20 text-success">
                        approved
                      </span>
                    </td>
                    <td className="p-3 text-center text-xs text-muted-foreground">—</td>
                    <td className="p-3 text-end text-xs text-muted-foreground">auto</td>
                  </tr>
                );
              })}
              {receipts.length === 0 && perDiem.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-muted-foreground">
                    {t("petty_cash.no_receipts_logged")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdv && (
        <AdvanceForm
          crew={custodians}
          masterFloats={masterFloatOptions}
          projectFxRate={projectFxRate}
          remainingOf={remainingOf}
          onClose={() => setShowAdv(false)}
          onSave={async (v) => {
            const holder = v.person_id
              ? custodians.find((c) => c.id === v.person_id)?.full_name
              : v.holder_name;
            const parent = v.parent_advance_id
              ? (advances.find((a) => a.id === v.parent_advance_id) ?? null)
              : null;
            // Sub-float inherits parent currency + fx
            const currency = parent ? parent.currency : v.currency;
            const fxRate = parent ? parent.fx_rate : projectFxFor(v.currency, projectFxRate);
            const payload = {
              project_id: projectId,
              organization_id: orgId,
              crew_member_id: null,
              person_id: v.person_id || null,
              holder: holder ?? "Unknown",
              total_advance: v.amount,
              expenses: 0,
              status: canIssue ? "open" : "pending_approval",
              notes: v.notes,
              issued_at: new Date().toISOString(),
              approved_at: canIssue ? new Date().toISOString() : null,
              currency,
              fx_rate: fxRate,
              funding_bank_gl_id: parent ? null : v.funding_bank_gl_id,
              float_gl_id: v.float_gl_id,
              parent_advance_id: parent?.id ?? null,
              float_type: v.float_type,
              acceptance_status: "pending_acceptance",
            };
            const { data, error } = await supabase
              .from("cash_advances")
              .insert(payload as any)
              .select("*")
              .single();
            if (error) {
              toast.error(error.message);
              return;
            }
            if (data) {
              auditPettyCash(
                canIssue ? "float_issued" : "float_submitted_for_approval",
                data as unknown as Advance,
                {
                  parent_advance_id: parent?.id ?? null,
                  funding_source: parent ? "master_float" : "bank_gl",
                  amount: v.amount,
                },
              );
              if (canIssue) {
                await postJournalEntry(data as unknown as Advance, "issued");
              }
            }
            toast.success(
              parent
                ? `Sub-float issued from ${parent.holder} · awaiting acceptance`
                : canIssue
                  ? "Float issued & journal posted · awaiting acceptance"
                  : "Float submitted for admin approval",
            );
            setShowAdv(false);
            void reloadAll();
          }}
        />
      )}

      {showRecPicker && (
        <PickAdvanceModal
          advances={advances.filter(
            (a) =>
              (a.status === "open" || a.status === "approved") && a.acceptance_status === "active",
          )}
          crew={crew}
          onPick={(a) => {
            setShowRecPicker(false);
            setShowRecFor(a);
          }}
          onClose={() => setShowRecPicker(false)}
        />
      )}

      {historyFor && (
        <PettyCashHistoryModal
          floatId={historyFor.id}
          floatLabel={`${historyFor.holder} · ${formatAmount(Number(historyFor.total_advance), 2)} ${historyFor.currency}`}
          receiptIds={receipts.filter((r) => r.advance_id === historyFor.id).map((r) => r.id)}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {showRecFor && (
        <ReceiptForm
          advance={showRecFor}
          onClose={() => setShowRecFor(null)}
          onSave={async (v) => {
            // Guard: receipts can only be logged against an accepted, non-closed float.
            if (showRecFor.acceptance_status !== "active") {
              toast.error(
                showRecFor.acceptance_status === "pending_acceptance"
                  ? "Holder must mark the float as accepted before receipts can be logged."
                  : "This float is closed — receipts can no longer be logged against it.",
              );
              return;
            }
            const { data: session } = await supabase.auth.getUser();
            const { data: inserted, error } = await supabase
              .from("cash_advance_receipts")
              .insert({
                advance_id: showRecFor.id,
                project_id: projectId,
                organization_id: orgId,
                amount: v.amount,
                currency: showRecFor.currency,
                fx_rate: showRecFor.fx_rate,
                vendor: v.vendor,
                received_from: v.vendor,
                recipient: "",
                description: v.description,
                method: "cash",
                date: v.date,
                budget_code: v.budget_code || null,
                linked_budget_line_id: v.linked_budget_line_id || null,
                status: "pending",
                notes: v.description,
                submitted_by: session.user?.id ?? null,
              } as any)
              .select("id")
              .single();
            if (error || !inserted) {
              toast.error(error?.message ?? "Failed to log receipt");
              return;
            }

            // Upload attachment (if any) then patch the row with the storage path
            if (v.attachment && projectId) {
              try {
                assertUploadAllowed(v.attachment);
                const safeName = v.attachment.name.replace(/[^\w.\-]+/g, "_");
                const path = `${projectId}/petty-cash/${inserted.id}/${Date.now()}_${safeName}`;
                const up = await storageAudited
                  .from("project-documents")
                  .upload(path, v.attachment, {
                    upsert: false,
                    contentType: uploadContentType(v.attachment),
                  });
                if (up.error) throw up.error;
                await supabase
                  .from("cash_advance_receipts")
                  .update({ attachment_path: path, attachment_name: v.attachment.name })
                  .eq("id", inserted.id);
              } catch (e: any) {
                toast.warning(`Receipt saved but attachment upload failed: ${e?.message ?? e}`);
              }
            }

            auditPettyCash("receipt_logged", showRecFor, {
              receipt_id: inserted.id,
              amount: v.amount,
              vendor: v.vendor,
              budget_code: v.budget_code || null,
              submitted_by: session.user?.id ?? null,
              has_attachment: !!v.attachment,
            });
            toast.success(t("petty_cash.receipt_submitted_for_finance_review"));
            setShowRecFor(null);
            void reloadAll();
          }}
        />
      )}
    </>
  );
}

async function postJournalEntry(advance: Advance, kind: "issued") {
  try {
    const source = advance.parent_advance_id
      ? { type: "master_float", id: advance.parent_advance_id }
      : { type: "gl_bank", id: advance.funding_bank_gl_id };
    await recordAudit({
      category: "other",
      action: `petty_cash.${kind}`,
      entity: `cash_advance:${advance.id}`,
      summary: `Petty cash float issued: ${fmtAmount(Number(advance.total_advance) || 0, advance.currency)} to ${advance.holder}`,
      details: {
        journal: [
          {
            side: "debit",
            account: advance.float_gl_id,
            amount: Number(advance.total_advance) || 0,
            currency: advance.currency,
          },
          {
            side: "credit",
            source,
            amount: Number(advance.total_advance) || 0,
            currency: advance.currency,
          },
        ],
        advance_id: advance.id,
        parent_advance_id: advance.parent_advance_id,
        float_type: advance.float_type,
        fx_rate: advance.fx_rate,
      },
    });
  } catch (e) {
    console.warn("Journal audit failed", e);
  }
}

async function postReceiptActual(receipt: ReceiptRow, advance: Advance | undefined) {
  if (!receipt.budget_code) return;
  try {
    await supabase.from("transactions" as any).insert({
      transaction_type: "cash_expense",
      budget_code: receipt.budget_code,
      description:
        `Petty cash: ${receipt.vendor ?? receipt.received_from ?? "receipt"} — ${receipt.description ?? ""}`.trim(),
      amount: Number(receipt.amount) || 0,
      vat_amount: 0,
      currency: receipt.currency ?? advance?.currency ?? "SAR",
      payment_status: "Paid",
      reference_no: `pettycash-receipt:${receipt.id}`,
      transaction_date: receipt.date ?? new Date().toISOString().slice(0, 10),
      project_id: receipt.project_id,
      organization_id: advance?.organization_id ?? null,
      metadata: {
        cash_advance_id: receipt.advance_id,
        linked_budget_line_id: receipt.linked_budget_line_id,
        fx_rate: receipt.fx_rate,
      },
    });
  } catch (e: any) {
    console.error("Failed to post receipt actual", e);
    toast.warning(`Receipt approved but actual posting failed: ${e?.message ?? e}`);
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Modals                                    */
/* -------------------------------------------------------------------------- */

type FundingKind = "bank" | "master_float";

function AdvanceForm({
  crew,
  masterFloats,
  projectFxRate,
  remainingOf,
  onClose,
  onSave,
}: {
  crew: Crew[];
  masterFloats: Advance[];
  projectFxRate: number;
  remainingOf: (a: Advance) => number;
  onClose: () => void;
  onSave: (v: {
    person_id: string;
    holder_name: string;
    amount: number;
    notes: string;
    currency: string;
    funding_bank_gl_id: string | null;
    float_gl_id: string | null;
    parent_advance_id: string | null;
    float_type: FloatType;
  }) => void;
}) {
  const { t } = useTranslation();

  const [crewId, setCrewId] = useState("");
  const [holder, setHolder] = useState("");
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState<string>("SAR");
  const [fundingKind, setFundingKind] = useState<FundingKind>("bank");
  const [parentId, setParentId] = useState<string>("");
  const [bankGl, setBankGl] = useState<string | null>(null);
  const [floatGl, setFloatGl] = useState<string | null>(null);
  // B07: preselect the project bank and petty-cash float accounts (9100 / 9120).
  const { rows: glRows } = useGlAccounts();
  useEffect(() => {
    if (!bankGl) {
      const bank = glRows.find((g) => g.isActive && g.accountType === "bank");
      if (bank) setBankGl(bank.id);
    }
    if (!floatGl) {
      const fl = glRows.find((g) => g.isActive && g.accountType === "petty_cash");
      if (fl) setFloatGl(fl.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glRows]);
  const [floatType, setFloatType] = useState<FloatType>("cash");

  const parent = parentId ? (masterFloats.find((a) => a.id === parentId) ?? null) : null;
  const effectiveCurrency = fundingKind === "master_float" && parent ? parent.currency : currency;
  const fxRate =
    fundingKind === "master_float" && parent
      ? parent.fx_rate
      : projectFxFor(currency, projectFxRate);
  const parentRemaining = parent ? remainingOf(parent) : 0;
  const overParent = !!parent && amount > parentRemaining;

  return (
    <Modal title={t("petty_cash.issue_cash_float")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!crewId && !holder)
            return toast.error(t("petty_cash.select_a_crew_member_or_enter_a_holder"));
          if (amount <= 0) return toast.error(t("petty_cash.amount_must_be_0"));
          if (fundingKind === "bank" && !bankGl)
            return toast.error(t("petty_cash.select_the_funding_source_bankcash_gl_account"));
          if (fundingKind === "master_float" && !parent)
            return toast.error(t("petty_cash.select_the_master_float_to_fund_from"));
          if (overParent)
            return toast.error(
              `Amount exceeds master float remaining balance (${fmtAmount(parentRemaining, effectiveCurrency)})`,
            );
          if (!floatGl) return toast.error(t("petty_cash.select_the_petty_cash_float_gl_account"));
          onSave({
            person_id: crewId,
            holder_name: holder,
            amount,
            notes,
            currency: effectiveCurrency,
            funding_bank_gl_id: fundingKind === "bank" ? bankGl : null,
            float_gl_id: floatGl,
            parent_advance_id: fundingKind === "master_float" ? (parent?.id ?? null) : null,
            float_type: floatType,
          });
        }}
        className="space-y-3"
      >
        <Field label={t("ap.float_holder")}>
          <select
            value={crewId}
            onChange={(e) => setCrewId(e.target.value)}
            className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
          >
            <option value="">{t("ap.select_custodian")}</option>
            {crew.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
                {c.role ? ` · ${c.role}` : ""}
              </option>
            ))}
          </select>
        </Field>
        {crew.length === 0 && (
          <div className="-mt-2 text-[11px] text-warning">{t("ap.no_custodians_hint")}</div>
        )}
        <Field label={t("platform.ui.orHolderNameIfNotInCrew")}>
          <input
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
          />
        </Field>

        <Field label={t("platform.ui.floatType")}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(Object.keys(FLOAT_TYPE_LABELS) as FloatType[]).map((t) => {
              const Icon = FLOAT_TYPE_ICONS[t];
              const active = floatType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFloatType(t)}
                  className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs ${
                    active
                      ? "border-primary bg-primary/10 text-primary-foreground"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <Icon className="size-4" />
                  {FLOAT_TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t("platform.ui.fundingSource")}>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              type="button"
              onClick={() => setFundingKind("bank")}
              className={`rounded-lg border px-2 py-2 text-xs ${
                fundingKind === "bank"
                  ? "border-primary bg-primary/10 text-primary-foreground"
                  : "border-border hover:bg-muted"
              }`}
            >
              {t("petty_cash.main_gl_bank_account")}
            </button>
            <button
              type="button"
              onClick={() => setFundingKind("master_float")}
              disabled={masterFloats.length === 0}
              className={`rounded-lg border px-2 py-2 text-xs disabled:opacity-40 ${
                fundingKind === "master_float"
                  ? "border-primary bg-primary/10 text-primary-foreground"
                  : "border-border hover:bg-muted"
              }`}
            >
              Existing Master Float{masterFloats.length === 0 ? " (none active)" : ""}
            </button>
          </div>
          {fundingKind === "bank" ? (
            <GlAccountSelector
              value={bankGl}
              onChange={setBankGl}
              accountTypes={["bank", "cash"]}
              allowEmpty={false}
              placeholder={t("petty_cash.search_bank_or_cash_gl")}
            />
          ) : (
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
            >
              <option value="">— Select master float —</option>
              {masterFloats.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.holder} · remaining {fmtAmount(remainingOf(a), a.currency)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t("platform.ui.currency")}>
            <select
              value={effectiveCurrency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={fundingKind === "master_float"}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="SAR">SAR</option>
              <option value="USD">USD</option>
            </select>
          </Field>
          <Field label={t("platform.ui.amount")}>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              min={0}
              step="0.01"
            />
          </Field>
          <Field label="FX to SAR (project-locked)">
            <input
              type="number"
              value={fxRate}
              readOnly
              disabled
              className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
            />
          </Field>
        </div>
        {overParent && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            Amount exceeds master float remaining balance (
            {fmtAmount(parentRemaining, effectiveCurrency)}).
          </div>
        )}

        <Field label={t("platform.ui.pettyCashFloatGlDestination")}>
          <GlAccountSelector
            value={floatGl}
            onChange={setFloatGl}
            accountTypes={["petty_cash"]}
            allowEmpty={false}
            placeholder={t("petty_cash.search_petty_cash_float_gl")}
          />
        </Field>
        <Field label={t("platform.ui.notes")}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
          />
        </Field>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          {t("petty_cash.journal_on_approval")}
          <b className="text-foreground">{t("petty_cash.dr_petty_cash_float")}</b>{" "}
          {fmtAmount(amount || 0, effectiveCurrency)} ·{" "}
          <b className="text-foreground">
            Cr {fundingKind === "master_float" ? "Master Float" : "Bank/Cash"}
          </b>{" "}
          {fmtAmount(amount || 0, effectiveCurrency)}. Holder must accept the float before receipts
          can be logged.
        </div>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function PickAdvanceModal({
  advances,
  crew,
  onPick,
  onClose,
}: {
  advances: Advance[];
  crew: Crew[];
  onPick: (a: Advance) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal title={t("petty_cash.choose_a_float_to_log_against")} onClose={onClose}>
      <div className="space-y-1 max-h-[60vh] overflow-auto">
        {advances.length === 0 && (
          <div className="text-sm text-muted-foreground p-4 text-center">
            {t("petty_cash.no_accepted_floats_available")}
          </div>
        )}
        {advances.map((a) => {
          const holder = a.crew_member_id
            ? crew.find((c) => c.id === a.crew_member_id)?.full_name
            : a.holder;
          return (
            <button
              key={a.id}
              onClick={() => onPick(a)}
              className="w-full text-start rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 p-3 text-sm"
            >
              <div className="font-medium">{holder}</div>
              <div className="text-xs text-muted-foreground">
                {fmtAmount(Number(a.total_advance) || 0, a.currency)} ·{" "}
                {FLOAT_TYPE_LABELS[a.float_type]} · issued {formatDate(a.created_at)}
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function ReceiptForm({
  advance,
  onClose,
  onSave,
}: {
  advance: Advance;
  onClose: () => void;
  onSave: (v: {
    amount: number;
    vendor: string;
    description: string;
    date: string;
    budget_code: string;
    linked_budget_line_id: string;
    attachment: File | null;
  }) => void;
}) {
  const { t } = useTranslation();

  const [amount, setAmount] = useState(0);
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [budgetCode, setBudgetCode] = useState("");
  const [lineId, setLineId] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <Modal title={`Log Receipt · ${advance.holder} (${advance.currency})`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (amount <= 0) return toast.error(t("petty_cash.amount_must_be_0"));
          if (!vendor.trim()) return toast.error(t("petty_cash.vendor_payee_is_required"));
          if (!budgetCode) return toast.error(t("petty_cash.assign_a_budget_line"));
          onSave({
            amount,
            vendor,
            description,
            date,
            budget_code: budgetCode,
            linked_budget_line_id: lineId ?? "",
            attachment,
          });
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("platform.ui.receiptDate")}>
            <DateInput
              value={date}
              onChange={(v) => setDate(v)}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
            />
          </Field>
          <Field label={`Amount (${advance.currency})`}>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              min={0}
              step="0.01"
            />
          </Field>
        </div>
        <Field label={t("platform.ui.vendorPayee")}>
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
          />
        </Field>
        <Field label={t("platform.ui.description")}>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
            placeholder={t("petty_cash.what_was_purchased")}
          />
        </Field>
        <Field label={t("platform.ui.budgetLineProjectChart")}>
          <BudgetCodeSelector
            value={budgetCode}
            onChange={setBudgetCode}
            selectedLineId={lineId}
            onSelectLine={(l) => setLineId(l?.id ?? null)}
            allowEmpty={false}
            placeholder={t("petty_cash.search_uploaded_project_budget")}
          />
        </Field>
        <Field label={t("platform.ui.receiptAttachmentPhotoPdfOptional")}>
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface hover:bg-muted px-3 py-2 text-sm"
            >
              <Paperclip className="size-3.5" />
              {attachment ? "Change file" : "Add receipt attachment"}
            </button>
            {attachment && (
              <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                {attachment.name}
              </span>
            )}
            {attachment && (
              <button
                type="button"
                onClick={() => {
                  setAttachment(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Remove
              </button>
            )}
          </div>
        </Field>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          {t("petty_cash.receipt_will_be_submitted_as")}
          <b className="text-foreground">{t("petty_cash.pending_finance_review")}</b>. On approval
          it posts as a paid cash expense against the selected budget line and deducts from{" "}
          {advance.holder}'s remaining balance.
        </div>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Attachment viewer                                */
/* -------------------------------------------------------------------------- */

function AttachmentViewer({ path, name }: { path: string; name: string | null }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      type="button"
      title={name ?? "View attachment"}
      onClick={async () => {
        setLoading(true);
        const { data, error } = await storageAudited
          .from("project-documents")
          .createSignedUrl(path, 60 * 10);
        setLoading(false);
        if (error || !data?.signedUrl) {
          toast.error(error?.message ?? "Could not open attachment");
          return;
        }
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      }}
      className="inline-flex items-center justify-center rounded-lg bg-surface hover:bg-muted p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
      disabled={loading}
    >
      <Eye className="size-4" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Layout primitives                              */
/* -------------------------------------------------------------------------- */

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-background pb-2">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ReceiptIcon className="size-4" />
            {title}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <XIcon className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function FormActions({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 text-sm rounded-lg bg-surface hover:bg-muted"
      >
        {t("platform.ui.cancel")}
      </button>
      <button
        type="submit"
        className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-semibold"
      >
        {t("platform.ui.save")}
      </button>
    </div>
  );
}
