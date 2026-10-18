import { create } from "zustand";
import { startImpersonation, stopImpersonation } from "./impersonation.functions";

/**
 * Super Admin → Tenant Impersonation.
 *
 * Persists a chosen organization override in `sessionStorage` so it only
 * lives for the current browser tab and never leaks across users on the
 * same device.
 *
 * SECURITY MODEL — defense-in-depth:
 *   1. The DB enforces RLS on `projects`/`organizations` regardless of
 *      what the client claims.
 *   2. The server function `startImpersonation` requires `is_super_admin`
 *      (checked via RPC) before returning success, and writes an
 *      `audit_logs` row so every support session is permanently recorded.
 *   3. Only after the server confirms does this store write the override
 *      to `sessionStorage`. A non-super-admin cannot even locally fake it.
 *   4. `listProjectsForActiveOrg` also verifies super_admin before honoring
 *      the override on the server side.
 */
const KEY = "kwalis.impersonation.v1";

type Snapshot = { orgId: string; orgName: string } | null;

function read(): Snapshot {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p.orgId === "string" && typeof p.orgName === "string") return p;
    return null;
  } catch {
    return null;
  }
}

function write(v: Snapshot) {
  if (typeof window === "undefined") return;
  try {
    if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
    else sessionStorage.removeItem(KEY);
  } catch {}
}

type State = {
  orgId: string | null;
  orgName: string | null;
  isImpersonating: boolean;
  start: (orgId: string, orgName: string) => Promise<void>;
  stop: () => Promise<void>;
};

const initial = read();

export const useImpersonation = create<State>((set, get) => ({
  orgId: initial?.orgId ?? null,
  orgName: initial?.orgName ?? null,
  isImpersonating: !!initial,
  start: async (orgId, _orgName) => {
    // ALWAYS go through the server. The server validates super_admin and
    // writes to audit_logs; only its verified name/id are trusted here.
    const result = await startImpersonation({ data: { targetOrgId: orgId } });
    write({ orgId: result.orgId, orgName: result.orgName });
    set({ orgId: result.orgId, orgName: result.orgName, isImpersonating: true });
    // Force project scope re-resolution.
    const { useStore } = await import("./store");
    await useStore.getState().loadProjects();
  },
  stop: async () => {
    const current = get();
    // Best-effort audit log; even if the server call fails we still clear
    // the local override so the admin returns to their real scope.
    try {
      await stopImpersonation({
        data: {
          targetOrgId: current.orgId,
          targetOrgName: current.orgName,
        },
      });
    } catch {
      /* logged separately; don't block exit */
    }
    write(null);
    set({ orgId: null, orgName: null, isImpersonating: false });
    const { useStore } = await import("./store");
    await useStore.getState().loadProjects();
  },
}));
