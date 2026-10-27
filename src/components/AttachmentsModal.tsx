import { formatDateTime } from "@/lib/date-format";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Paperclip,
  Upload,
  X,
  FileText,
  Trash2,
  ExternalLink,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  type EntityType,
  type FileRow,
  uploadProjectFile,
  listFilesForEntity,
  getSignedUrl,
  deleteProjectFile,
  getDisplayName,
} from "@/lib/project-files";
import { useStore } from "@/lib/store";

import { useTranslation } from "react-i18next";
/**
 * Contextual attachments modal for a specific entity row.
 * Uploaded files are auto-routed into the canonical folder pathway
 * (see ENTITY_ROOT in project-files.ts) and also visible in the master
 * `/project-files` library.
 */
export function AttachmentsModal({
  open,
  onClose,
  entityType,
  entityId,
  entityLabel,
}: {
  open: boolean;
  onClose: () => void;
  entityType: EntityType;
  entityId: string;
  entityLabel: string;
}) {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const projectId = useStore((s) => s.activeProjectId);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
    setBusy(true);
    listFilesForEntity(projectId, entityType, entityId)
      .then(setFiles)
      .catch((e) => toast.error(e.message ?? "Failed to load attachments"))
      .finally(() => setBusy(false));
  }, [open, projectId, entityType, entityId]);

  if (!open) return null;

  const onPick: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !projectId) return;
    setUploading(true);
    try {
      const row = await uploadProjectFile({
        projectId,
        file,
        entityType,
        entityId,
        entityLabel,
      });
      setFiles((prev) => [row, ...prev]);
      toast.success(`Uploaded "${file.name}" — routed to ${entityLabel}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const open_ = async (row: FileRow) => {
    try {
      const url = await getSignedUrl(row.storage_path);
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to open file");
    }
  };

  const locate = (row: FileRow) => {
    navigate({
      to: "/project-files",
      search: { folder: row.folder_id ?? "", highlight: row.id } as never,
    });
  };

  const remove = async (row: FileRow) => {
    const label = getDisplayName(row);
    if (!confirm(`Delete "${label}"? This permanently removes it from storage.`)) return;
    try {
      await deleteProjectFile(row);
      setFiles((prev) => prev.filter((f) => f.id !== row.id));
      toast.success(`"${label}" deleted`);
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 grid place-items-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-surface-1 border border-border rounded-2xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Paperclip className="size-4 text-brand" />
            <div>
              <div className="font-semibold text-sm">{t("attachmentsmodal.attachments")}</div>
              <div className="text-xs text-muted-foreground">
                {entityLabel} · auto-routed to {`${entityType} → ${entityLabel}`}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted"
            aria-label={t("attachmentsmodal.close")}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <label className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface-2 px-4 py-6 cursor-pointer hover:bg-muted">
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            <span className="text-sm">
              {uploading
                ? "Uploading…"
                : "Click to upload · files auto-route to the master library"}
            </span>
            <input
              type="file"
              className="hidden"
              onChange={onPick}
              disabled={uploading || !projectId}
            />
          </label>

          <div className="text-xs uppercase tracking-wider text-muted-foreground mt-4">
            Files ({files.length})
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {busy && (
              <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            )}
            {!busy && files.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">
                {t("attachmentsmodal.no_attachments_yet")}
              </div>
            )}
            {files.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-3 py-2">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate" title={f.storage_path}>
                    {getDisplayName(f)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatDateTime(f.created_at)}
                    {f.size_bytes ? ` · ${(f.size_bytes / 1024).toFixed(1)} KB` : ""}
                  </div>
                </div>
                <button
                  onClick={() => open_(f)}
                  className="p-1.5 rounded-lg hover:bg-muted"
                  title="Open"
                >
                  <ExternalLink className="size-4" />
                </button>
                <button
                  onClick={() => locate(f)}
                  className="p-1.5 rounded-lg hover:bg-muted"
                  title="Locate in File Library"
                  aria-label={`Locate ${getDisplayName(f)} in File Library`}
                >
                  <FolderOpen className="size-4" />
                </button>
                <button
                  onClick={() => remove(f)}
                  className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive"
                  title="Delete"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact table cell button that opens the attachments modal. */
export function AttachmentsButton(props: {
  entityType: EntityType;
  entityId: string;
  entityLabel: string;
}) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-1.5 rounded-lg hover:bg-muted"
        title={t("attachmentsmodal.attachments")}
      >
        <Paperclip className="size-4" />
      </button>
      {open && <AttachmentsModal open={open} onClose={() => setOpen(false)} {...props} />}
    </>
  );
}
