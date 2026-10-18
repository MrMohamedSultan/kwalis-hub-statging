// =====================================================================
// Project archive / restore (D02).
//
// A project is never deleted from the screens any more: it is ARCHIVED —
// hidden from tenant views, every record kept — and can be restored. The
// database functions (db/pending/130_d02_d03_archive_and_trash.sql) check
// the caller is the platform owner or an admin of the company, require the
// project code to be typed, remember the previous status and write the audit
// log. Permanent deletion opens only 30 days after archiving.
// =====================================================================
import { supabase } from "@/integrations/supabase/client";

export const ARCHIVED_STATUS = "Archived";

export function isArchivedProject(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "archived";
}

/** True when what the admin typed matches the project code (case/space-insensitive). */
export function archiveCodeMatches(typed: string, projectCode: string | null | undefined): boolean {
  const code = (projectCode ?? "").trim().toUpperCase();
  return code.length > 0 && typed.trim().toUpperCase() === code;
}

export async function archiveProject(projectId: string, typedCode: string): Promise<void> {
  const { error } = await (supabase as any).rpc("archive_project", {
    p_project_id: projectId,
    p_confirm_code: typedCode,
  });
  if (error) throw new Error(error.message);
}

/** Returns the status the project went back to. */
export async function restoreProject(projectId: string): Promise<string> {
  const { data, error } = await (supabase as any).rpc("restore_project", {
    p_project_id: projectId,
  });
  if (error) throw new Error(error.message);
  return String(data ?? "");
}
