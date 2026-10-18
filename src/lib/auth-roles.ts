import { useEffect, useSyncExternalStore } from "react";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * DB-trusted role state. Mirrors the predicates used by RLS:
 *   - is_super_admin(uid)  →  user_roles.role = 'super_admin'
 *   - is_org_admin(uid,o)  →  organization_members.role in ('owner','admin')
 *
 * Use `requireRoles()` in route `beforeLoad` for server-trust gates,
 * and `useAuthRoles()` in components for conditional UI.
 */
export type AuthRolesSnapshot = {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  jobTitle: string | null;
  executiveTitle: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  adminOrgIds: string[];
  memberOrgIds: string[];
};

export type AuthRoles = AuthRolesSnapshot & { loaded: boolean };

const EMPTY: AuthRolesSnapshot = {
  userId: null,
  email: null,
  displayName: null,
  jobTitle: null,
  executiveTitle: null,
  isSuperAdmin: false,
  isAdmin: false,
  adminOrgIds: [],
  memberOrgIds: [],
};

async function fetchAuthRoles(userId: string, email: string | null): Promise<AuthRolesSnapshot> {
  const [{ data: roles }, { data: memberships }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("organization_members").select("organization_id, role").eq("user_id", userId),
    supabase
      .from("profiles")
      .select("display_name, job_title, executive_title" as any)
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const r = (roles ?? []).map((x: { role: string }) => x.role);
  const m = (memberships ?? []) as { organization_id: string; role: string }[];
  const p = (profile ?? null) as {
    display_name: string | null;
    job_title: string | null;
    executive_title: string | null;
  } | null;
  return {
    userId,
    email,
    displayName: p?.display_name || (email ? email.split("@")[0] : null),
    jobTitle: p?.job_title ?? null,
    executiveTitle: p?.executive_title ?? null,
    isSuperAdmin: r.includes("super_admin"),
    isAdmin: r.includes("admin"),
    adminOrgIds: m
      .filter((x) => x.role === "owner" || x.role === "admin")
      .map((x) => x.organization_id),
    memberOrgIds: m.map((x) => x.organization_id),
  };
}

let cache: Promise<AuthRolesSnapshot> | null = null;
let cachedFor: string | null = null;
/** Synchronously readable copy of the resolved snapshot (perf fast path). */
let resolvedSnapshot: AuthRolesSnapshot | null = null;
let state: AuthRoles = { ...EMPTY, loaded: false };
let inFlight: Promise<void> | null = null;
let authListenerReady = false;
const listeners = new Set<() => void>();

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameState(a: AuthRoles, b: AuthRoles): boolean {
  return (
    a.loaded === b.loaded &&
    a.userId === b.userId &&
    a.email === b.email &&
    a.displayName === b.displayName &&
    a.jobTitle === b.jobTitle &&
    a.executiveTitle === b.executiveTitle &&
    a.isSuperAdmin === b.isSuperAdmin &&
    a.isAdmin === b.isAdmin &&
    sameArray(a.adminOrgIds, b.adminOrgIds) &&
    sameArray(a.memberOrgIds, b.memberOrgIds)
  );
}

function emit(next: AuthRoles) {
  if (sameState(state, next)) return;
  state = next;
  for (const listener of listeners) listener();
}

function clearAuthRolesCache() {
  cache = null;
  cachedFor = null;
  resolvedSnapshot = null;
}

function getCached(userId: string, email: string | null): Promise<AuthRolesSnapshot> {
  if (cachedFor !== userId || !cache) {
    cachedFor = userId;
    cache = fetchAuthRoles(userId, email).then((snap) => {
      resolvedSnapshot = snap;
      return snap;
    });
  }
  return cache;
}

/**
 * Synchronous read of the already-resolved role snapshot, or `null` when it
 * has not been fetched yet. Route gates use this to stay fully synchronous on
 * warm navigations (no await → no full-page pending screen).
 */
export function peekAuthRoles(): AuthRolesSnapshot | null {
  return resolvedSnapshot;
}

/**
 * Awaitable role snapshot for `beforeLoad` gates. Returns the EMPTY snapshot
 * when signed out. Uses the same per-user cache as `useAuthRoles()`.
 */
export async function getAuthRolesSnapshot(): Promise<AuthRolesSnapshot> {
  // getSession() reads the locally persisted session — no network round-trip.
  // These gates are UX-level; the DB still enforces everything via RLS, so a
  // server-validated getUser() on every navigation is pure latency.
  const { data, error } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (error || !user) return { ...EMPTY };
  return getCached(user.id, user.email ?? null);
}

export function invalidateAuthRoles() {
  clearAuthRolesCache();
  if (typeof window !== "undefined") {
    void refreshAuthRoles(true);
  }
}

async function refreshAuthRoles(force = false) {
  if (inFlight && !force) return inFlight;
  inFlight = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        emit({ ...EMPTY, loaded: true });
        return;
      }
      const snap = await getCached(user.id, user.email ?? null);
      emit({ ...snap, loaded: true });
    } catch {
      emit({ ...state, loaded: true });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function ensureAuthRolesListener() {
  if (authListenerReady || typeof window === "undefined") return;
  authListenerReady = true;
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
      clearAuthRolesCache();
      void refreshAuthRoles(true);
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AuthRoles {
  return state;
}

function getServerSnapshot(): AuthRoles {
  return { ...EMPTY, loaded: false };
}

/**
 * Route guard. Throws a redirect when the predicate fails.
 * Use inside `beforeLoad` of sensitive routes.
 */
export async function requireRoles(
  predicate: (r: AuthRolesSnapshot) => boolean,
  redirectTo: string = "/",
): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (error || !user) {
    throw redirect({ to: "/auth" });
  }
  const snap = await getCached(user.id, user.email ?? null);
  if (!predicate(snap)) {
    throw redirect({ to: redirectTo });
  }
}

/** Component-side hook. Mirrors RLS predicates for UI gating. */
export function useAuthRoles(): AuthRoles {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    ensureAuthRolesListener();
    if (!snapshot.loaded && !inFlight) void refreshAuthRoles();
  }, [snapshot.loaded]);
  return snapshot;
}
