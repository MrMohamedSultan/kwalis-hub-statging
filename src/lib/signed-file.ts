import { toast } from "sonner";
import i18n from "@/lib/i18n";
import { storageAudited } from "@/lib/storage-audit";

/**
 * Open a file of a private bucket in a new tab through a 5-minute signed URL
 * (X06 / D08). Storage RLS decides; a refusal is logged by storageAudited.
 */
export async function openSignedFile(bucket: string, path: string, download?: string): Promise<void> {
  const { data, error } = await storageAudited
    .from(bucket)
    .createSignedUrl(path, 300, download ? { download } : undefined);
  if (error || !data?.signedUrl) {
    toast.error(i18n.t("platform.files.openFailed"));
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}
