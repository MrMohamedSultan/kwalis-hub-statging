import { useEffect, useState } from "react";
import { storageAudited } from "@/lib/storage-audit";
import { supabase } from "@/integrations/supabase/client";
import { X, Download, ExternalLink, Loader2 } from "lucide-react";

import { useTranslation } from "react-i18next";
/**
 * Global file preview modal. Accepts either:
 *  - a Storage path (`bucket` + `path`) → signs a URL
 *  - a direct `url` (public link, http/https)
 *
 * Renders PDFs and images inline; falls back to a download link for other types.
 */
export function DocumentPreviewModal({
  open,
  onClose,
  bucket,
  path,
  url,
  fileName,
}: {
  open: boolean;
  onClose: () => void;
  bucket?: string;
  path?: string;
  url?: string;
  fileName?: string;
}) {
  const { t } = useTranslation();

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (url) {
      setSignedUrl(url);
      return;
    }
    if (!bucket || !path) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    storageAudited
      .from(bucket)
      .createSignedUrl(path, 600)
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error || !data?.signedUrl) {
          setError(error?.message || "Could not sign URL");
          return;
        }
        setSignedUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [open, bucket, path, url]);

  if (!open) return null;

  const display = fileName || path?.split("/").pop() || url?.split("/").pop() || "document";
  const lower = display.toLowerCase();
  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|$)/.test(lower);
  const isPdf = /\.pdf(\?|$)/.test(lower);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card text-card-foreground border border-border rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <div className="text-sm font-medium truncate">{display}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {signedUrl && (
              <>
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs inline-flex items-center gap-1 rounded-md border border-border hover:bg-muted px-2 py-1"
                >
                  <ExternalLink className="size-3" /> Open
                </a>
                <a
                  href={signedUrl}
                  download={display}
                  className="text-xs inline-flex items-center gap-1 rounded-md border border-border hover:bg-muted px-2 py-1"
                >
                  <Download className="size-3" /> Download
                </a>
              </>
            )}
            <button onClick={onClose} className="p-1 rounded-md hover:bg-muted" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 bg-muted/30">
          {loading && (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2 inline" />
              Loading preview…
            </div>
          )}
          {error && (
            <div className="h-full grid place-items-center text-sm text-destructive">{error}</div>
          )}
          {!loading &&
            !error &&
            signedUrl &&
            (isImage ? (
              <div className="h-full overflow-auto grid place-items-center p-4">
                <img
                  src={signedUrl}
                  alt={display}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : isPdf ? (
              <iframe src={signedUrl} title={display} className="w-full h-full border-0" />
            ) : (
              <div className="h-full grid place-items-center text-sm text-muted-foreground p-6 text-center">
                {t("documentpreviewmodal.preview_not_available_for_this_file_type")}
                <br />
                {t("documentpreviewmodal.use_open_or_download_above")}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
