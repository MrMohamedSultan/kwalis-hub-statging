// Coalesced, debounced persistence for budget grid edits.
//
// The grid used to persist every individual field change immediately, so a
// burst of edits on one row (typing, toggling, re-mapping) produced one
// `UPDATE budget_lines` round-trip per keystroke. Here patches are merged per
// line id and flushed once the user pauses, while the local store is updated
// optimistically so the UI stays instant.
import { useCallback, useEffect, useRef } from "react";
import { useStore, type BudgetLine } from "@/lib/store";

type Updater = (id: string, patch: Partial<BudgetLine>) => Promise<unknown>;

export function useDebouncedLineUpdate(update: Updater, delayMs = 400) {
  const pending = useRef(new Map<string, Partial<BudgetLine>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const updateRef = useRef(update);
  updateRef.current = update;

  const flush = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const patch = pending.current.get(id);
    pending.current.delete(id);
    if (patch && Object.keys(patch).length) void updateRef.current(id, patch);
  }, []);

  const flushAll = useCallback(() => {
    Array.from(pending.current.keys()).forEach(flush);
  }, [flush]);

  useEffect(() => {
    window.addEventListener("beforeunload", flushAll);
    return () => {
      window.removeEventListener("beforeunload", flushAll);
      flushAll();
    };
  }, [flushAll]);

  return useCallback(
    (id: string, patch: Partial<BudgetLine>) => {
      // Optimistic: the row reflects the edit immediately, the write waits.
      useStore.setState((s) => ({
        budget: s.budget.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }));
      pending.current.set(id, { ...pending.current.get(id), ...patch });
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        id,
        setTimeout(() => flush(id), delayMs),
      );
    },
    [delayMs, flush],
  );
}
