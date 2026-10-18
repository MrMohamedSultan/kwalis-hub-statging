// Client-side helpers for the Payment Approval Workflow.
// Statuses: draft → waiting_approval → approved → paid, with rejected as terminal.
import { storageAudited } from "@/lib/storage-audit";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthRoles } from "@/lib/auth-roles";

export type PaymentRequestStatus = "draft" | "waiting_approval" | "approved" | "paid" | "rejected";

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
};

export const STATUS_LABEL: Record<PaymentRequestStatus, string> = {
  draft: "مسودة",
  waiting_approval: "بانتظار الاعتماد",
  approved: "معتمد للصرف",
  paid: "تم السداد",
  rejected: "مرفوض",
};

export const STATUS_COLORS: Record<PaymentRequestStatus, string> = {
  draft: "bg-surface-2 text-muted-foreground border-border",
  waiting_approval: "bg-warning/20 text-warning border-warning/30",
  approved: "bg-info/20 text-info border-info/30",
  paid: "bg-success/20 text-success border-success/30",
  rejected: "bg-destructive/20 text-destructive border-destructive/30",
};

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
    const { data, error } = await q;
    if (!error && data) setRows(data as PaymentRequest[]);
    setLoading(false);
  }, [filter?.sourceType, filter?.sourceId, filter?.organizationId]);

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel(`payment_requests_${filter?.sourceType ?? "all"}_${filter?.sourceId ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_requests" }, () =>
        refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refresh, filter?.sourceType, filter?.sourceId]);

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

/** Create a draft payment request. */
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
    })
    .select("*")
    .single();

  if (error) throw error;
  if (input.submitImmediately) await notifyApprovers(data as PaymentRequest);
  return data as PaymentRequest;
}

export async function submitForApproval(id: string): Promise<void> {
  const { data, error } = await (supabase as any)
    .from("payment_requests")
    .update({ status: "waiting_approval", submitted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("*")
    .single();
  if (error) throw error;
  if (data) await notifyApprovers(data as PaymentRequest);
}

export async function approvePaymentRequest(id: string): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id ?? null;
  const { data, error } = await (supabase as any)
    .from("payment_requests")
    .update({
      status: "approved",
      approved_by: uid,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "waiting_approval")
    .select("*")
    .single();
  if (error) throw error;
  if (data) await notifyCreator(data as PaymentRequest, "approved");
}

export async function rejectPaymentRequest(id: string, reason: string): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id ?? null;
  const { data, error } = await (supabase as any)
    .from("payment_requests")
    .update({
      status: "rejected",
      rejected_by: uid,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason || null,
    })
    .eq("id", id)
    .eq("status", "waiting_approval")
    .select("*")
    .single();
  if (error) throw error;
  if (data) await notifyCreator(data as PaymentRequest, "rejected", reason);
}

export async function executePaymentRequest(input: {
  id: string;
  paymentDate: string;
  method: "Cash" | "Transfer" | "Check" | "Card" | "Bank";
  proofFile: File;
}): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id ?? null;

  // Upload proof
  const path = `payment_requests/${input.id}/${Date.now()}-${input.proofFile.name}`;
  const up = await storageAudited.from("contracts").upload(path, input.proofFile, {
    contentType: input.proofFile.type,
    upsert: false,
  });
  if (up.error) throw up.error;

  const { data, error } = await (supabase as any)
    .from("payment_requests")
    .update({
      status: "paid",
      executed_by: uid,
      executed_at: new Date().toISOString(),
      payment_date: input.paymentDate,
      payment_method: input.method,
      proof_path: path,
    })
    .eq("id", input.id)
    .eq("status", "approved")
    .select("*")
    .single();
  if (error) throw error;
  if (data) await notifyCreator(data as PaymentRequest, "paid");
}

export async function deletePaymentRequest(id: string): Promise<void> {
  const { error } = await (supabase as any).from("payment_requests").delete().eq("id", id);
  if (error) throw error;
}

// ----- Notifications -----
// Approvers = org admins/owners for that organization.
async function notifyApprovers(pr: PaymentRequest) {
  try {
    const { data: admins } = await (supabase as any)
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", pr.organization_id)
      .in("role", ["owner", "admin"]);

    const rows = (admins ?? []).map((a: any) => ({
      organization_id: pr.organization_id,
      project_id: pr.project_id,
      user_id: a.user_id,
      severity: "info",
      category: "payment_approval",
      title: `Payment request awaiting approval`,
      body: `${pr.source_label ?? pr.source_type} — ${pr.currency} ${Number(pr.requested_amount).toLocaleString()}`,
      metadata: {
        payment_request_id: pr.id,
        source_type: pr.source_type,
        source_id: pr.source_id,
        status: "waiting_approval",
      },
    }));
    if (rows.length) await (supabase as any).from("notifications").insert(rows);
  } catch {
    /* notifications are best-effort */
  }
}

async function notifyCreator(
  pr: PaymentRequest,
  kind: "approved" | "rejected" | "paid",
  reason?: string,
) {
  try {
    if (!pr.requested_by) return;
    const titles: Record<typeof kind, string> = {
      approved: "Your payment request was approved",
      rejected: "Your payment request was rejected",
      paid: "Your payment was executed",
    };
    await (supabase as any).from("notifications").insert({
      organization_id: pr.organization_id,
      project_id: pr.project_id,
      user_id: pr.requested_by,
      severity: kind === "rejected" ? "warning" : "info",
      category: "payment_approval",
      title: titles[kind],
      body: `${pr.source_label ?? pr.source_type} — ${pr.currency} ${Number(pr.requested_amount).toLocaleString()}${reason ? ` · Reason: ${reason}` : ""}`,
      metadata: {
        payment_request_id: pr.id,
        source_type: pr.source_type,
        source_id: pr.source_id,
        status: kind,
        rejection_reason: reason ?? null,
      },
    });
  } catch {
    /* best-effort */
  }
}

/** Convenience: is current session the creator of the request? */
export function useIsCreator(pr: Pick<PaymentRequest, "requested_by">) {
  const { userId } = useAuthRoles();
  return !!userId && !!pr.requested_by && userId === pr.requested_by;
}
