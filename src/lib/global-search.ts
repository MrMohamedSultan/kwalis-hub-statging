import { create } from "zustand";

/**
 * Lightweight cross-page search state. The header input writes here; any list
 * on the current page can subscribe with `useGlobalSearch(s => s.query)` and
 * filter its rows in-memory. Cleared automatically on route change by
 * AppShell.
 */
type State = {
  query: string;
  setQuery: (q: string) => void;
  clear: () => void;
};

export const useGlobalSearch = create<State>((set) => ({
  query: "",
  setQuery: (q) => set({ query: q }),
  clear: () => set((state) => (state.query ? { query: "" } : state)),
}));

/** Case-insensitive contains — safe for undefined/null fields. */
export function matchesQuery(q: string, ...fields: (string | null | undefined)[]) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => (f ?? "").toString().toLowerCase().includes(needle));
}
