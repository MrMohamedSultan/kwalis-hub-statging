import { supabase } from "@/integrations/supabase/client";

export type Company = {
  id: string;
  name: string;
  industry: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  logo_url: string | null;
  commercial_registration: string | null;
  national_address: string | null;
  subscription_status: string | null;
  max_projects: number;
  onboarded_at: string | null;
  notes: string | null;
  created_at: string;
};

export type CompanyRow = Company & { userCount: number; projectCount: number };

export type CompanyDocument = {
  id: string;
  organization_id: string;
  document_type: string;
  file_name: string;
  file_url: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  notes: string | null;
  uploaded_at: string;
};

export const DOCUMENT_TYPES = [
  { value: "commercial_registration", label: "Commercial Registration (السجل التجاري)" },
  { value: "national_address", label: "National Address (العنوان الوطني)" },
  { value: "tax_certificate", label: "Tax / VAT Certificate" },
  { value: "bank_letter", label: "Bank Letter" },
  { value: "contract", label: "Contract / Agreement" },
  { value: "other", label: "Other" },
] as const;

export function documentTypeLabel(v: string) {
  return DOCUMENT_TYPES.find((d) => d.value === v)?.label ?? v;
}

const COMPANY_COLS =
  "id,name,industry,contact_email,contact_phone,website,logo_url,commercial_registration,national_address,subscription_status,max_projects,onboarded_at,notes,created_at";

export async function listCompanies(): Promise<CompanyRow[]> {
  const { data, error } = await (supabase as any)
    .from("organizations")
    .select(COMPANY_COLS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const orgs = (data ?? []) as Company[];

  const [{ data: members }, { data: projects }] = await Promise.all([
    (supabase as any).from("organization_members").select("organization_id"),
    (supabase as any).from("projects").select("organization_id"),
  ]);

  const tally = (rows: { organization_id: string | null }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      if (!r.organization_id) continue;
      m.set(r.organization_id, (m.get(r.organization_id) ?? 0) + 1);
    }
    return m;
  };
  const userMap = tally(members);
  const projMap = tally(projects);

  return orgs.map((o) => ({
    ...o,
    userCount: userMap.get(o.id) ?? 0,
    projectCount: projMap.get(o.id) ?? 0,
  }));
}

export async function getCompany(id: string): Promise<Company | null> {
  const { data, error } = await (supabase as any)
    .from("organizations")
    .select(COMPANY_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Company) ?? null;
}

export async function updateCompany(id: string, patch: Partial<Company>) {
  const { error } = await (supabase as any).from("organizations").update(patch).eq("id", id);
  if (error) throw error;
}

export async function listCompanyDocuments(orgId: string): Promise<CompanyDocument[]> {
  const { data, error } = await (supabase as any)
    .from("organization_documents")
    .select("*")
    .eq("organization_id", orgId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CompanyDocument[];
}

/** Uploads to the private `org-documents` bucket and records the metadata row. */
export async function uploadCompanyDocument(
  orgId: string,
  file: File,
  documentType: string,
  notes?: string,
) {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const path = `${orgId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await supabase.storage.from("org-documents").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data: userData } = await supabase.auth.getUser();
  const { error: dbErr } = await (supabase as any).from("organization_documents").insert({
    organization_id: orgId,
    document_type: documentType,
    file_name: file.name,
    file_url: path, // private bucket → store the path, sign on demand
    file_size_bytes: file.size,
    mime_type: file.type || null,
    uploaded_by: userData.user?.id ?? null,
    notes: notes?.trim() || null,
  });
  if (dbErr) throw dbErr;
}

export async function openCompanyDocument(doc: CompanyDocument) {
  const path = doc.file_url;
  if (/^https?:\/\//i.test(path)) {
    window.open(path, "_blank", "noopener,noreferrer");
    return;
  }
  const { data, error } = await supabase.storage
    .from("org-documents")
    .createSignedUrl(path, 60 * 5);
  if (error || !data?.signedUrl) throw error ?? new Error("Could not open the document.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export async function deleteCompanyDocument(doc: CompanyDocument) {
  if (!/^https?:\/\//i.test(doc.file_url)) {
    await supabase.storage.from("org-documents").remove([doc.file_url]);
  }
  const { error } = await (supabase as any)
    .from("organization_documents")
    .delete()
    .eq("id", doc.id);
  if (error) throw error;
}

export type CompanyMember = {
  id: string;
  role: string;
  user_id: string;
  display_name: string | null;
  job_title: string | null;
};

export async function listCompanyMembers(orgId: string): Promise<CompanyMember[]> {
  const { data, error } = await (supabase as any)
    .from("organization_members")
    .select("id, role, user_id")
    .eq("organization_id", orgId);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; role: string; user_id: string }[];
  if (rows.length === 0) return [];

  const { data: profiles } = await (supabase as any)
    .from("profiles")
    .select("id, display_name, job_title")
    .in(
      "id",
      rows.map((r) => r.user_id),
    );
  const byId = new Map(
    (
      (profiles ?? []) as { id: string; display_name: string | null; job_title: string | null }[]
    ).map((p) => [p.id, p] as const),
  );

  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    user_id: r.user_id,
    display_name: byId.get(r.user_id)?.display_name ?? null,
    job_title: byId.get(r.user_id)?.job_title ?? null,
  }));
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type CompanyProject = {
  id: string;
  name: string;
  code: string | null;
  status: string | null;
  project_type: string | null;
  created_at: string | null;
};

export async function listCompanyProjects(orgId: string): Promise<CompanyProject[]> {
  const { data, error } = await (supabase as any)
    .from("projects")
    .select("id,name,code,status,project_type,created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CompanyProject[];
}
