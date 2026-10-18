// Runtime guard: warn (and optionally throw) when a DB mutation is attempted
// without a project_id in scope. This is a defense-in-depth layer on top of
// RLS (`can_access_project`) — the DB will still reject cross-project reads
// and writes, but this catches accidental un-scoped queries in the client
// before they even hit the wire.
import { useStore } from "@/lib/store";

const STRICT = false; // flip to true to throw instead of warn

export function assertProjectScope(op: string, projectId?: string | null) {
  const active = projectId ?? useStore.getState().activeProjectId;
  if (!active) {
    const msg = `[project-scope] ${op} attempted without an active projectId`;
    if (STRICT) throw new Error(msg);
    console.warn(msg);
    return null;
  }
  return active;
}

export function requireProjectId(op: string): string {
  const active = useStore.getState().activeProjectId;
  if (!active) {
    throw new Error(
      `${op} requires an active project. Select a project from the Hub before performing this action.`,
    );
  }
  return active;
}
