// Cloud document aggregation for the File Library.
//
// Beyond natively uploaded files (Supabase Storage + `project_files`), the app
// stores externally hosted documents as plain URLs on the record itself:
//   - crew contracts  → public.people (kind = 'crew').attachment_url
//   - cast contracts  → public.people (kind = 'cast').attachment_url
//   - AP invoices     → public.invoices.attachment_url
//
// This module aggregates all of them into one normalized list so the File
// Library can present a single, automatically organized hub of cloud links.
import { supabase } from "@/integrations/supabase/client";

export type CloudLinkSource = "Crew Contract" | "Cast Contract" | "Invoice";

export type CloudLink = {
  id: string;
  source: CloudLinkSource;
  /** Person / vendor the document belongs to. */
  beneficiary: string;
  /** Secondary line: position, invoice no, etc. */
  detail: string;
  url: string;
  createdAt: string | null;
};

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export type AttachmentUrlRecord = {
  id: string;
  url?: string | null;
  label: string;
  projectId?: string | null;
};

export function attachmentUrlKey(v: string | null | undefined): string {
  let s = clean(v);
  if (!s) return "";
  s = s.replace(/^[<"'\s]+/, "").replace(/[>"'\s]+$/, "");
  if (!/^([a-zA-Z][a-zA-Z0-9+.-]*):\/*/.test(s)) {
    s = `https://${s.replace(/^\/+/, "")}`;
  }
  try {
    const u = new URL(s);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

export function findDuplicateAttachmentUrl(
  url: string | null | undefined,
  records: AttachmentUrlRecord[],
  opts: { currentId?: string; projectId?: string | null } = {},
): AttachmentUrlRecord | null {
  const key = attachmentUrlKey(url);
  if (!key) return null;
  return (
    records.find((r) => {
      if (opts.currentId && r.id === opts.currentId) return false;
      if (opts.projectId && r.projectId && r.projectId !== opts.projectId) return false;
      return attachmentUrlKey(r.url) === key;
    }) ?? null
  );
}

/** All cloud-hosted documents referenced by this project's records. */
export async function listCloudLinks(projectId: string): Promise<CloudLink[]> {
  const [peopleRes, invoiceRes] = await Promise.all([
    supabase
      .from("people")
      .select("id, kind, full_name, position, character, attachment_url, created_at")
      .eq("project_id", projectId)
      .not("attachment_url", "is", null),
    supabase
      .from("invoices")
      .select("id, description, vendor_name, invoice_no, attachment_url, created_at")
      .eq("project_id", projectId)
      .not("attachment_url", "is", null),
  ]);

  if (peopleRes.error) throw peopleRes.error;
  if (invoiceRes.error) throw invoiceRes.error;

  const out: CloudLink[] = [];

  for (const r of peopleRes.data ?? []) {
    const url = clean((r as any).attachment_url);
    if (!url) continue;
    out.push({
      id: `person:${(r as any).id}`,
      source: (r as any).kind === "cast" ? "Cast Contract" : "Crew Contract",
      beneficiary: clean((r as any).full_name) || "Unnamed",
      detail: [clean((r as any).position), clean((r as any).character)].filter(Boolean).join(" · "),
      url,
      createdAt: (r as any).created_at ?? null,
    });
  }

  for (const r of invoiceRes.data ?? []) {
    const url = clean((r as any).attachment_url);
    if (!url) continue;
    out.push({
      id: `invoice:${(r as any).id}`,
      source: "Invoice",
      beneficiary: clean((r as any).vendor_name) || "Unknown vendor",
      detail: [
        clean((r as any).invoice_no) && `#${clean((r as any).invoice_no)}`,
        clean((r as any).description),
      ]
        .filter(Boolean)
        .join(" · "),
      url,
      createdAt: (r as any).created_at ?? null,
    });
  }

  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
