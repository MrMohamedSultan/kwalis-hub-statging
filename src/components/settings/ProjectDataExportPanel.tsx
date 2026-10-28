// D23 — "Export all project data" for super admins and the project's
// organisation admins: one workbook with every table + the attachment links.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { useAuthRoles } from "@/lib/auth-roles";
import { exportAllProjectData } from "@/features/project-export/project-data-export";

export function ProjectDataExportPanel() {
  const { t } = useTranslation();
  const roles = useAuthRoles();
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const orgId = (project?.organizationId as string | undefined) ?? null;
  const allowed = roles.isSuperAdmin || (!!orgId && roles.adminOrgIds.includes(orgId));
  if (!project || !allowed) return null;

  const run = async () => {
    if (progress) return;
    setProgress([0, 1]);
    try {
      const r = await exportAllProjectData({
        projectId: project.id,
        includeSensitive,
        labels: {
          title: t("leftovers.data_export.workbook_title"),
          contents: t("leftovers.data_export.contents"),
          table: t("leftovers.data_export.table"),
          rows: t("leftovers.data_export.rows"),
          note: includeSensitive
            ? t("leftovers.data_export.note_with_bank")
            : t("leftovers.data_export.note_no_bank"),
        },
        onProgress: (done, total) => setProgress([done, total]),
      });
      toast.success(
        t("leftovers.data_export.done", {
          rows: r.rows,
          tables: r.tables,
          attachments: r.attachments,
        }),
      );
    } catch (e) {
      console.error(e);
      toast.error(t("leftovers.data_export.failed"));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <DatabaseBackup className="size-4" />
            {t("leftovers.data_export.title")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("leftovers.data_export.hint")}</p>
          <label className="mt-3 inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSensitive}
              onChange={(e) => setIncludeSensitive(e.target.checked)}
            />
            {t("leftovers.data_export.include_bank")}
          </label>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!!progress}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground disabled:opacity-50"
        >
          {progress ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <DatabaseBackup className="size-4" />
          )}
          {progress
            ? t("leftovers.data_export.progress", { done: progress[0], total: progress[1] })
            : t("leftovers.data_export.button")}
        </button>
      </div>
    </Panel>
  );
}
