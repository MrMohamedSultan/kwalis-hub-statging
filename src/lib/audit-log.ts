import { logAuditEvent } from "./audit.functions";

export type AuditCategory = "import" | "validation" | "schema" | "auth" | "other";
export type AuditSeverity = "info" | "warning" | "error";

export interface AuditPayload {
  category: AuditCategory;
  action: string;
  summary: string;
  severity?: AuditSeverity;
  entity?: string | null;
  organization_id?: string | null;
  project_id?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit logger. Failures are swallowed (logged to console)
 * so audit recording never blocks user actions.
 */
export function recordAudit(payload: AuditPayload): void {
  try {
    void logAuditEvent({ data: payload as any }).catch((err) => {
      console.warn("[audit] failed to record event", err);
    });
  } catch (err) {
    console.warn("[audit] threw synchronously", err);
  }
}
