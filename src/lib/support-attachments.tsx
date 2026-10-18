import { supabase } from "@/integrations/supabase/client";
import { storageAudited } from "@/lib/storage-audit";
import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";

export const SUPPORT_BUCKET = "support-attachments";
export const MAX_ATTACHMENT_MB = 10;
export const ACCEPTED_ATTACHMENT_TYPES =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf";

/**
 * Upload a support-ticket attachment to the private bucket.
 * Path convention: {user_id}/{ticket_id}/{filename}
 */
export async function uploadSupportAttachment(params: {
  userId: string;
  ticketId: string;
  file: File;
}): Promise<{ path: string; name: string }> {
  const safeName = params.file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${params.userId}/${params.ticketId}/${Date.now()}_${safeName}`;
  const { error } = await storageAudited
    .from(SUPPORT_BUCKET)
    .upload(path, params.file, { upsert: false, contentType: params.file.type });
  if (error) throw new Error(error.message);
  return { path, name: params.file.name };
}

export function AttachmentLink({
  path,
  name,
}: {
  path: string | null | undefined;
  name?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!path) return;
    storageAudited
      .from(SUPPORT_BUCKET)
      .createSignedUrl(path, 60 * 30)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;
  const label = name || path.split("/").pop() || "attachment";
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        if (!url) e.preventDefault();
      }}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm hover:bg-muted max-w-full"
    >
      <Paperclip className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}
