import { useState } from "react";
import { Download, ExternalLink, FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getContractSignedUrl, downloadContractBlob } from "@/lib/native-files";

/**
 * Browsers cannot hydrate <input type="file"> with a previously saved file, so
 * the control always reads "No file chosen". This badge makes the stored
 * document explicit and actionable above the input.
 */
export function StoredFileBadge({
  path,
  label = "Currently uploaded file",
  className = "",
}: {
  path?: string | null;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState<"view" | "download" | null>(null);
  if (!path) return null;

  const fileName = path.split("/").pop() || "document";

  const view = async () => {
    setBusy("view");
    try {
      const url = await getContractSignedUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open the stored file.");
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    try {
      const blob = await downloadContractBlob(path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`mb-1.5 flex flex-wrap items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2 ${className}`}
    >
      <FileCheck2 className="size-4 text-success shrink-0" />
      <div className="min-w-0 flex-1 text-xs">
        <div className="font-semibold text-success">{label}</div>
        <div className="truncate text-muted-foreground" title={fileName}>
          {fileName}
        </div>
      </div>
      <button
        type="button"
        onClick={view}
        disabled={busy !== null}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
      >
        {busy === "view" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ExternalLink className="size-3.5" />
        )}
        View
      </button>
      <button
        type="button"
        onClick={download}
        disabled={busy !== null}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
      >
        {busy === "download" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Download className="size-3.5" />
        )}
        Download
      </button>
      <div className="w-full text-[11px] text-muted-foreground">
        Choosing a new file replaces it. The picker below always shows “No file chosen” — your saved
        file is safe.
      </div>
    </div>
  );
}
