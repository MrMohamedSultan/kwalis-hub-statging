import { create } from "zustand";

const KEY = "kwalis.adminScope.orgId.v1";

function load(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

function persist(v: string | null) {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

type State = {
  orgId: string | null;
  setOrgId: (id: string | null) => void;
};

/**
 * Super Admin organization scope switcher. Persists across reloads.
 * `null` = show all companies (global view).
 */
export const useAdminScope = create<State>((set) => ({
  orgId: load(),
  setOrgId: (id) => {
    persist(id);
    set({ orgId: id });
  },
}));
