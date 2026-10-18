import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, FolderOpen } from "lucide-react";
import { Panel } from "@/components/AppShell";
import { ProjectMembersPanel } from "@/components/ProjectMembersPanel";
import { useStore } from "@/lib/store";
import { useAuthRoles } from "@/lib/auth-roles";
import { supabase } from "@/integrations/supabase/client";

/**
 * "Project Team" — project-centric membership management for the ACTIVE project.
 *
 * Strictly admin-only: platform super admins, or an owner/admin of the
 * organization that owns the active project. Non-admins see a short notice;
 * the DB still enforces everything (project_members RLS + org-admin policy).
 */
export function ProjectTeamPanel() {
  const { t } = useTranslation();
  const roles = useAuthRoles();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const [orgId, setOrgId] = useState<string | null>(activeProject?.organizationId ?? null);

  useEffect(() => {
    const known = activeProject?.organizationId ?? null;
    if (known || !activeProjectId) {
      setOrgId(known);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("projects")
        .select("organization_id")
        .eq("id", activeProjectId)
        .maybeSingle();
      if (!cancelled) {
        setOrgId((data as { organization_id: string | null } | null)?.organization_id ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, activeProject?.organizationId]);

  if (!roles.loaded) {
    return (
      <Panel className="p-5">
        <div className="text-xs text-muted-foreground">Loading project team…</div>
      </Panel>
    );
  }

  const isOrgAdmin = roles.isSuperAdmin || (!!orgId && roles.adminOrgIds.includes(orgId));

  if (!isOrgAdmin) {
    return (
      <Panel className="p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="size-5 text-destructive mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-destructive">
              {t("settings.permission_required")}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Project Team management is restricted to organization admins.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (!activeProjectId || !orgId) {
    return (
      <Panel className="p-5">
        <div className="flex items-start gap-3">
          <FolderOpen className="size-5 text-muted-foreground mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-foreground">Project Team</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Select a project from the Main Hub to manage its team.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="p-5">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-foreground">Project Team</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {activeProject?.name ?? "Active project"}
          {activeProject?.code ? ` · ${activeProject.code}` : ""}
        </p>
      </div>
      <ProjectMembersPanel projectId={activeProjectId} organizationId={orgId} />
    </Panel>
  );
}
