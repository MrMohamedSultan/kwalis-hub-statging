// Client-side helpers for the Payment Approval Workflow.
// Statuses: draft → waiting_approval → approved → paid; rejected / cancelled close a request.
// Approval itself (single admin approval, or the organization's approval chain),
// rejection and cancellation run in database functions (db/pending/176), which
// also send the notifications.
import { storageAudited } from "@/lib/storage-audit";
import { assertUploadAllowed, safeStorageName, uploadContentType } from "@/lib/upload-policy";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import i18n from "@/lib/i18n";
import { useAuthRoles } from "@/lib/auth-roles";

export type PaymentRequestStatus =
  "draft" | "waiting_approval" | "approved" | "paid" | "rejected" | "cancelled";

export const PAYMENT_REQUEST_STATUSES: PaymentRequestStatus[] = [
  "draft",
  "waiting_approval",
  "approved",
  "paid",
  "rejected",
  "cancelled",
];

/** The one status a request has while it waits for an approver. */
export const AWAITING_APPROVAL_STATUS: PaymentRequestStatus = "waiting_approval";

export type PaymentSourceKind =
  | "invoice"
  | "purchase_order"
  | "petty_cash"
  | "payroll_row"
  | "crew_contract"
  | "cast_contract"
  | "vendor_contract";

export type PaymentRequest = {
  id: string;
  organization_id: string;
  project_id: string | null;
  source_type: PaymentSourceKind;
  source_id: string;
  source_label: string | null;
  total_amount: number;
  previously_paid: number;
  requested_amount: number;
  currency: string;
  status: PaymentRequestStatus;
  requested_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  executed_by: string | null;
  executed_at: string | null;
  payment_date: string | null;
  payment_method: string | null;
  proof_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Contract / payroll-run instalment this request pays (db/pending/176). */
  payroll_milestone_id?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  /** Paid request reversed by an org admin with a refund entry (db/pending/204). */
  reversed_by?: string | null;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  reversal_payment_id?: string | null;
};

/** i18n key of a request status (namespace "approvals"). */
export const statusLabelKey = (s: PaymentRequestStatus) => `approvals.status.${s}`;

export const STATUS_COLORS: Record<PaymentRequestStatus, string> = {
  draft: "bg-surface-2 text-muted-foreground border-border",
  waiting_approval: "bg-warning/20 text-warning border-warning/30",
  approved: "bg-info/20 text-info border-info/30",
  paid: "bg-success/20 text-success border-success/30",
  rejected: "bg-destructive/20 text-destructive border-destructive/30",
  cancelled: "bg-surface-2 text-muted-foreground border-border line-through",
};

/** Payroll-run lines are instalments with this id (post_payroll_run). */
export const PAYROLL_RUN_MILESTONE_ID = "run";

export type RequestModule = "contracts" | "payroll" | "vendor" | "petty_cash";

/** User-facing bucket of a request ("Module" filter on Payment Approvals). */
export function requestModule(
  r: Pick<PaymentRequest, "source_type" | "payroll_milestone_id">,
): RequestModule {
  switch (r.source_type) {
    case "crew_contract":
    case "cast_contract":
      return "contracts";
    case "payroll_row":
      return r.payroll_milestone_id && r.payroll_milestone_id !== PAYROLL_RUN_MILESTONE_ID
        ? "contracts"
        : "payroll";
    case "petty_cash":
      return "petty_cash";
    default:
      return "vendor";
  }
}

/** i18n key for the request's "Type" column. */
export function requestTypeKey(
  r: Pick<PaymentRequest, "source_type" | "payroll_milestone_id">,
): string {
  if (r.source_type === "payroll_row") {
    if (r.payroll_milestone_id === PAYROLL_RUN_MILESTONE_ID) return "approvals.type.payroll_run";
    if (r.payroll_milestone_id) return "approvals.type.instalment";
  }
  return `approvals.type.${r.source_type}`;
}

/** Statuses that block a second request for the same instalment. */
export const OPEN_REQUEST_STATUSES: PaymentRequestStatus[] = [
  "draft",
  "waiting_approval",
  "approved",
  "paid",
];

/**
 * The request currently attached to an instalment: the open (or paid) one when
 * there is one, else the most recent closed one (for its rejection reason).
 */
export function requestForMilestone(
  rows: PaymentRequest[],
  payrollRowId: string,
  milestoneId: string,
): PaymentRequest | null {
  const mine = rows
    .filter((r) => r.source_id === payrollRowId && r.payroll_milestone_id === milestoneId)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return mine.find((r) => OPEN_REQUEST_STATUSES.includes(r.status)) ?? mine[0] ?? null;
}

export type ApprovalTab = PaymentRequestStatus | "all" | "my_turn";

/** The Payment Approvals list filter, kept pure so it can be unit-tested. */
export function filterApprovalRows(
  rows: PaymentRequest[],
  opts: {
    projectId: string | null;
    tab: ApprovalTab;
    module: RequestModule | "all";
    myTurn: Set<string>;
    seesAll: boolean;
    userId: string | null;
  },
): PaymentRequest[] {
  return rows.filter((r) => {
    if (!opts.projectId || r.project_id !== opts.projectId) return false;
    if (!opts.seesAll && r.requested_by !== opts.userId) return false;
    if (opts.tab === "my_turn") {
      if (!opts.myTurn.has(r.id)) return false;
    } else if (opts.tab !== "all" && r.status !== opts.tab) return false;
    if (opts.module !== "all" && requestModule(r) !== opts.module) return false;
    return true;
  });
}

/** Payables-grid payment method → payment_requests.payment_method. */
export function toRequestMethod(
  m?: string | null,
): "Cash" | "Transfer" | "Check" | "Card" | "Bank" {
  switch (m) {
    case "cash":
      return "Cash";
    case "check":
      return "Check";
    case "credit_card":
      return "Card";
    default:
      return "Transfer";
  }
}

/** Signed URL for a stored proof-of-payment file (bucket: contracts). */
export async function getProofSignedUrl(path: string, expiresIn = 300): Promise<string | null> {
  const { data, error } = await storageAudited.from("contracts").createSignedUrl(path, expiresIn);
  if (error || !data) return null;
  return data.signedUrl;
}

export function usePaymentRequests(filter?: {
  sourceType?: PaymentSourceKind;
  sourceId?: string;
  organizationId?: string;
  projectId?: string;
}) {
  const [rows, setRows] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any)
      .from("payment_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (filter?.sourceType) q = q.eq("source_type", filter.sourceType);
    if (filter?.sourceId) q = q.eq("source_id", filter.sourceId);
    if (filter?.organizationId) q = q.eq("organization_id", filter.organizationId);
    if (filter?.projectId) q = q.eq("project_id", filter.projectId);
    const { data, error } = await q;
    if (!error && data) setRows(data as PaymentRequest[]);
    setLoading(false);
  }, [filter?.sourceType, filter?.sourceId, filter?.organizationId, filter?.projectId]);

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel(
        `payment_requests_${filter?.sourceType ?? "all"}_${filter?.sourceId ?? "all"}_${filter?.projectId ?? "all"}`,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_requests" }, () =>
        refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refresh, filter?.sourceType, filter?.sourceId, filter?.projectId]);

  return { rows, loading, refresh };
}

/** Sum of amounts already `paid` (final) for a source. Excludes draft/waiting/approved. */
export function sumPaidForSource(
  rows: PaymentRequest[],
  sourceType: PaymentSourceKind,
  sourceId: string,
): number {
  return rows
    .filter((r) => r.source_type === sourceType && r.source_id === sourceId && r.status === "paid")
    .reduce((sum, r) => sum + Number(r.requested_amount || 0), 0);
}

/** Sum of amounts "committed" (paid + approved + waiting) — reduces available balance. */
export function sumCommittedForSource(
  rows: PaymentRequest[],
  sourceType: PaymentSourceKind,
  sourceId: string,
): number {
  return rows
    .filter(
      (r) =>
        r.source_type === sourceType &&
        r.source_id === sourceId &&
        (r.status === "paid" || r.status === "approved" || r.status === "waiting_approval"),
    )
    .reduce((sum, r) => sum + Number(r.requested_amount || 0), 0);
}

/** Create a payment request (draft, or straight to approval). */
export async function createPaymentRequest(input: {
  organizationId: string;
  projectId?: string | null;
  sourceType: PaymentSourceKind;
  sourceId: string;
  sourceLabel?: string | null;
  totalAmount: number;
  previouslyPaid: number;
  requestedAmount: number;
  currency?: string;
  notes?: string | null;
  submitImmediately?: boolean;
  /** Instalment id when the request pays one contract instalment. */
  payrollMilestoneId?: string | null;
}): Promise<PaymentRequest> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new Error("Not authenticated");

  const status: PaymentRequestStatus = input.submitImmediately ? "waiting_approval" : "draft";
  const submitted_at = input.submitImmediately ? new Date().toISOString() : null;

  const { data, error } = await (supabase as any)
    .from("payment_requests")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId ?? null,
      source_type: input.sourceType,
      source_id: input.sourceId,
      source_label: input.sourceLabel ?? null,
      total_amount: input.totalAmount,
      previously_paid: input.previouslyPaid,
      requested_amount: input.requestedAmount,
      currency: input.currency ?? "SAR",
      notes: input.notes ?? null,
      status,
      requested_by: uid,
      submitted_at,
      ...(input.payrollMilestoneId ? { payroll_milestone_id: input.payrollMilestoneId } : {}),
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as PaymentRequest;
}

export async function submitForApproval(id: string): Promise<void> {
  const { error } = await (supabase as any)
    .from("payment_requests")
    .update({ status: "waiting_approval", submitted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("id")
    .single();
  if (error) throw error;
}

/**
 * Approve the current level (or the whole request when the organization has
 * no approval chain). Returns the request status after the step.
 */
export async function approvePaymentRequest(
  id: string,
  note?: string | null,
): Promise<PaymentRequestStatus> {
  const { data, error } = await (supabase.rpc as any)("approve_payment_request_step", {
    _request: id,
    _note: note ?? null,
  });
  if (error) throw error;
  return ((data as { status?: PaymentRequestStatus } | null)?.status ??
    "waiting_approval") as PaymentRequestStatus;
}

export async function rejectPaymentRequest(id: string, reason: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("reject_payment_request_step", {
    _request: id,
    _reason: reason,
  });
  if (error) throw error;
}

/** Withdraw (requester, before approval) or cancel (admin) — recorded, never deleted. */
export async function cancelPaymentRequest(id: string, reason: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("cancel_payment_request", {
    _request: id,
    _reason: reason,
  });
  if (error) throw error;
}

/** Requests whose payment can be reversed (refund) — not instalments (pure). */
export function canReversePaidRequest(
  r: Pick<PaymentRequest, "status" | "reversed_at" | "payroll_milestone_id" | "source_type">,
  isOrgAdmin: boolean,
): boolean {
  return (
    isOrgAdmin &&
    r.status === "paid" &&
    !r.reversed_at &&
    !r.payroll_milestone_id &&
    ["invoice", "purchase_order", "petty_cash"].includes(r.source_type)
  );
}

/**
 * X08: reverse a PAID request (org admin, reason required). The payment stays
 * in the books and a refund entry offsets it (db/pending/204
 * reverse_paid_payment_request); the document is payable again.
 */
export async function reversePaidPaymentRequest(
  id: string,
  reason: string,
  refundDate?: string | null,
): Promise<void> {
  const { error } = await (supabase.rpc as any)("reverse_paid_payment_request", {
    _request: id,
    _reason: reason,
    _refund_date: refundDate || null,
  });
  if (error) throw error;
}

export async function executePaymentRequest(input: {
  id: string;
  paymentDate: string;
  method: "Cash" | "Transfer" | "Check" | "Card" | "Bank";
  proofFile?: File | null;
  notes?: string | null;
}): Promise<void> {
  let path: string | null = null;
  if (input.proofFile) {
    assertUploadAllowed(input.proofFile);
    // X06: under the project folder so project-scoped storage policies apply.
    const { data: owner } = await supabase
      .from("payment_requests")
      .select("project_id")
      .eq("id", input.id)
      .maybeSingle();
    // always under the project folder; a request without a project gets no file
    if (!owner?.project_id) throw new Error(i18n.t("decisions.files.needsProject"));
    path = `${owner.project_id}/payment_requests/${input.id}/${Date.now()}-${safeStorageName(input.proofFile.name)}`;
    const up = await storageAudited.from("contracts").upload(path, input.proofFile, {
      contentType: uploadContentType(input.proofFile),
      upsert: false,
    });
    if (up.error) throw up.error;
  }

  const { error } = await (supabase as any)
    .from("payment_requests")
    .update({
      status: "paid",
      payment_date: input.paymentDate,
      payment_method: input.method,
      ...(path ? { proof_path: path } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    })
    .eq("id", input.id)
    .eq("status", "approved")
    .select("id")
    .single();
  if (error) throw error;
}

/** Only drafts / waiting / rejected requests can be deleted; decided ones are cancelled. */
export async function deletePaymentRequest(id: string): Promise<void> {
  const { error } = await (supabase as any).from("payment_requests").delete().eq("id", id);
  if (error) throw error;
}

// ----- Approval chain -----

export type ApprovalStep = {
  level: number;
  label: string;
  approved_by: string | null;
  approved_at: string | null;
  note: string | null;
};

export type ChainStatus = {
  request_id: string;
  required_levels: number;
  approved_levels: number;
  next_level: number | null;
  next_label: string | null;
  can_act: boolean;
  steps: ApprovalStep[];
};

/** Whose turn it is, per request of the organization (optionally one project). */
export function usePaymentChainStatus(
  organizationId: string | null,
  projectId: string | null,
  reloadKey: unknown,
) {
  const [byId, setById] = useState<Record<string, ChainStatus>>({});
  const refresh = useCallback(async () => {
    if (!organizationId) {
      setById({});
      return;
    }
    const { data, error } = await (supabase.rpc as any)("payment_request_chain_status", {
      _org: organizationId,
      _project: projectId,
    });
    if (error || !Array.isArray(data)) {
      setById({});
      return;
    }
    const map: Record<string, ChainStatus> = {};
    for (const row of data as ChainStatus[]) map[row.request_id] = row;
    setById(map);
  }, [organizationId, projectId]);
  useEffect(() => {
    void refresh();
  }, [refresh, reloadKey]);
  return { byId, refresh };
}

export type ApproverKind = "org_admin" | "org_owner" | "project_executive" | "role";

export type ApprovalLevel = {
  id: string;
  organization_id: string;
  level_no: number;
  label: string;
  min_amount_sar: number;
  approver_kind: ApproverKind;
  role_id: string | null;
};

/** Levels a request of `amountSar` needs, in order (mirrors payment_request_required_levels). */
export function requiredLevels(levels: ApprovalLevel[], amountSar: number): ApprovalLevel[] {
  return levels
    .filter((l) => Number(l.min_amount_sar) <= amountSar + 0.005)
    .sort((a, b) => a.level_no - b.level_no);
}

/** Request amount in SAR (mirrors payment_request_amount_sar). */
export function amountInSar(
  amount: number,
  currency: string | null | undefined,
  project: { currency?: string | null; fxRate?: number | null } | null | undefined,
): number {
  const cur = (currency || "SAR").toUpperCase();
  if (cur === "SAR") return Math.round(amount * 100) / 100;
  const rate =
    project && (project.currency ?? "").toUpperCase() === cur && Number(project.fxRate) > 0
      ? Number(project.fxRate)
      : 1;
  return Math.round(amount * rate * 100) / 100;
}

export function useApprovalLevels(organizationId: string | null) {
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!organizationId) {
      setLevels([]);
      return;
    }
    setLoading(true);
    const { data } = await (supabase.from as any)("payment_approval_levels")
      .select("id, organization_id, level_no, label, min_amount_sar, approver_kind, role_id")
      .eq("organization_id", organizationId)
      .order("level_no", { ascending: true });
    setLevels(
      ((data ?? []) as ApprovalLevel[]).map((l) => ({ ...l, min_amount_sar: +l.min_amount_sar })),
    );
    setLoading(false);
  }, [organizationId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { levels, loading, refresh };
}

export async function saveApprovalLevel(
  level: Omit<ApprovalLevel, "id"> & { id?: string },
): Promise<void> {
  const row = {
    organization_id: level.organization_id,
    level_no: level.level_no,
    label: level.label.trim(),
    min_amount_sar: level.min_amount_sar,
    approver_kind: level.approver_kind,
    role_id: level.approver_kind === "role" ? level.role_id : null,
  };
  const q = (supabase.from as any)("payment_approval_levels");
  const { error } = level.id ? await q.update(row).eq("id", level.id) : await q.insert(row);
  if (error) throw error;
}

export async function deleteApprovalLevel(id: string): Promise<void> {
  const { error } = await (supabase.from as any)("payment_approval_levels").delete().eq("id", id);
  if (error) throw error;
}

/** Convenience: is current session the creator of the request? */
export function useIsCreator(pr: Pick<PaymentRequest, "requested_by">) {
  const { userId } = useAuthRoles();
  return !!userId && !!pr.requested_by && userId === pr.requested_by;
}
