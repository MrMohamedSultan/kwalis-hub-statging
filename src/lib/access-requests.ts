import { supabase } from "@/integrations/supabase/client";
import { recordAudit } from "@/lib/audit-log";

export const INDUSTRIES = [
  { value: "film_production", label: "Film Production" },
  { value: "tv_production", label: "TV / Series Production" },
  { value: "commercial_production", label: "Commercial / Ad Production" },
  { value: "animation_vfx", label: "Animation & VFX Studio" },
  { value: "post_production", label: "Post-Production House" },
  { value: "talent_agency", label: "Talent Agency" },
  { value: "production_services", label: "Production Services" },
  { value: "broadcasting", label: "Broadcasting / Streaming" },
  { value: "government_cultural", label: "Government / Cultural Entity" },
  { value: "other", label: "Other" },
] as const;

export function industryLabel(value?: string | null): string {
  if (!value) return "—";
  return INDUSTRIES.find((i) => i.value === value)?.label ?? value;
}

export type AccessRequestStatus =
  | "new"
  | "pending"
  | "contacted"
  | "qualified"
  | "converted"
  | "approved"
  | "rejected"
  | "onboarded";

export type AccessRequest = {
  id: string;
  name: string;
  company: string | null;
  industry: string | null;
  email: string;
  mobile: string | null;
  message: string | null;
  admin_notes: string | null;
  status: AccessRequestStatus;
  organization_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

/** Public (anonymous) lead submission — goes through the validating RPC. */
export async function submitAccessRequest(input: {
  fullName: string;
  company: string;
  industry: string;
  email: string;
  mobile: string;
  message?: string;
}): Promise<string> {
  const { data, error } = await (supabase as any).rpc("submit_access_request", {
    p_full_name: input.fullName.trim(),
    p_company: input.company.trim(),
    p_industry: input.industry,
    p_email: input.email.trim().toLowerCase(),
    p_mobile: input.mobile.trim(),
    p_message: input.message?.trim() || null,
  });
  if (error) throw error;
  return data as string;
}

export async function listAccessRequests(): Promise<AccessRequest[]> {
  const { data, error } = await (supabase as any)
    .from("access_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AccessRequest[];
}

export async function countNewAccessRequests(): Promise<number> {
  const { count, error } = await (supabase as any)
    .from("access_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["new", "pending"]);
  if (error) return 0;
  return count ?? 0;
}

export async function updateAccessRequest(
  id: string,
  patch: {
    status?: AccessRequestStatus;
    admin_notes?: string | null;
    organization_id?: string | null;
  },
) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await (supabase as any)
    .from("access_requests")
    .update({
      ...patch,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userData.user?.id ?? null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteAccessRequest(id: string) {
  const { error } = await (supabase as any).from("access_requests").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Approves a lead: creates the tenant organization (or reuses an already
 * linked one), links it back to the request and marks it converted.
 * Returns the organization id.
 */
export async function approveAccessRequest(req: AccessRequest): Promise<string> {
  if (req.organization_id) {
    await updateAccessRequest(req.id, { status: "converted" });
    recordAudit({
      category: "other",
      action: "crm.access_request.approved",
      summary: `Approved registration request for ${req.company || req.name} (existing company reused)`,
      entity: `access_request:${req.id}`,
      organization_id: req.organization_id,
      details: { email: req.email, industry: req.industry, reused_organization: true },
    });
    return req.organization_id;
  }

  const { data: org, error: orgErr } = await (supabase as any)
    .from("organizations")
    .insert({
      name: (req.company || req.name).trim(),
      industry: req.industry,
      contact_email: req.email,
      contact_phone: req.mobile,
      subscription_status: "Trial",
      onboarded_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (orgErr) throw orgErr;

  await updateAccessRequest(req.id, { status: "converted", organization_id: org.id });

  recordAudit({
    category: "other",
    action: "crm.company.created",
    summary: `Created client company "${(req.company || req.name).trim()}" from registration request`,
    entity: `organization:${org.id}`,
    organization_id: org.id as string,
    details: { access_request_id: req.id, contact_email: req.email, industry: req.industry },
  });
  recordAudit({
    category: "other",
    action: "crm.access_request.approved",
    summary: `Approved registration request for ${req.company || req.name}`,
    entity: `access_request:${req.id}`,
    organization_id: org.id as string,
    details: { email: req.email, industry: req.industry },
  });

  return org.id as string;
}

/** Rejects a lead without creating any tenant records. */
export async function rejectAccessRequest(id: string, reason?: string) {
  await updateAccessRequest(id, {
    status: "rejected",
    ...(reason?.trim() ? { admin_notes: reason.trim() } : {}),
  });
  recordAudit({
    category: "other",
    action: "crm.access_request.rejected",
    severity: "warning",
    summary: `Rejected registration request${reason?.trim() ? `: ${reason.trim()}` : ""}`,
    entity: `access_request:${id}`,
    details: { reason: reason?.trim() || null },
  });
}

/** Back-compat alias used by older call sites. */
export const convertRequestToOrganization = approveAccessRequest;

/**
 * Realtime alert for platform owners: fires whenever a new B2B access
 * request lands.
 *
 * Security: `access_requests` is deliberately NOT in the Realtime publication —
 * its rows carry applicant PII (email, mobile, message). Instead we listen to
 * the listener's own `notifications` rows (RLS-scoped to `user_id = auth.uid()`,
 * fanned out by the `notify_super_admins_new_access_request` trigger) and then
 * read the request itself through the normal super-admin-only SELECT policy.
 */
export function subscribeToNewAccessRequests(onInsert: (row: AccessRequest) => void): () => void {
  // Unique channel name per subscriber: reusing one name makes the second
  // caller attach `postgres_changes` to an already-subscribed channel, which throws.
  const channel = supabase
    .channel(`access-requests-inbox-${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      (payload) => {
        const row = payload.new as { category?: string; metadata?: Record<string, unknown> } | null;
        if (!row || row.category !== "access_request") return;
        const requestId = row.metadata?.["access_request_id"];
        if (typeof requestId !== "string") return;
        void (async () => {
          // Authorization is enforced by RLS: only super admins can read this row.
          const { data, error } = await (supabase as any)
            .from("access_requests")
            .select("*")
            .eq("id", requestId)
            .maybeSingle();
          if (error || !data) return;
          onInsert(data as AccessRequest);
        })();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Back-compat helper used by the org admin inbox. */
export async function updateAccessRequestStatus(id: string, status: AccessRequestStatus) {
  await updateAccessRequest(id, { status });
}
