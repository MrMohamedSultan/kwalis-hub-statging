import { toast } from "sonner";

import i18n from "@/lib/i18n";
/**
 * Shared browser download helper.
 *
 * Centralises the object-URL + anchor-click boilerplate that was previously
 * duplicated across every CSV / XLSX / JSON / ZIP export in the app.
 * Behaviour is intentionally identical to the previous inline versions:
 * the anchor is attached to the document (required by Firefox), clicked,
 * removed, and the object URL is revoked shortly after so slower browsers
 * finish reading the blob first.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(i18n.t("download.export_ready"), { description: filename });
  } catch (err) {
    toast.error(i18n.t("download.export_failed"), {
      description: err instanceof Error ? err.message : filename,
    });
    throw err;
  }
}
