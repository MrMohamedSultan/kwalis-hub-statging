// ============================================================
// Session-scoped UI state for the Workspace panel modal
// (Account Settings / Notifications).
//
// The modal remembers, for the whole browser session:
//   - which tab was last open
//   - the scroll offset of each tab's content
//
// so closing and reopening the modal restores exactly what the
// accountant was looking at without losing the active project route.
// ============================================================
import { useSyncExternalStore } from "react";

export type WorkspacePanelKey = "account" | "notifications";

const STORAGE_KEY = "workspace-panel.state";

type Persisted = {
  tab: WorkspacePanelKey;
  scroll: Record<WorkspacePanelKey, number>;
};

type State = Persisted & { open: boolean };

const DEFAULT: State = {
  open: false,
  tab: "account",
  scroll: { account: 0, notifications: 0 },
};

function readPersisted(): Persisted {
  if (typeof window === "undefined") return { tab: DEFAULT.tab, scroll: { ...DEFAULT.scroll } };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { tab: DEFAULT.tab, scroll: { ...DEFAULT.scroll } };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const tab: WorkspacePanelKey = parsed.tab === "notifications" ? "notifications" : "account";
    return {
      tab,
      scroll: {
        account: Number(parsed.scroll?.account ?? 0) || 0,
        notifications: Number(parsed.scroll?.notifications ?? 0) || 0,
      },
    };
  } catch {
    return { tab: DEFAULT.tab, scroll: { ...DEFAULT.scroll } };
  }
}

let state: State = { ...DEFAULT };
let hydrated = false;
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tab: state.tab, scroll: state.scroll } satisfies Persisted),
    );
  } catch {
    /* sessionStorage unavailable (private mode) — state stays in memory */
  }
}

function emit(next: State) {
  state = next;
  for (const l of listeners) l();
}

function ensureHydrated() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const p = readPersisted();
  emit({ ...state, ...p });
}

export function openWorkspacePanel(tab?: WorkspacePanelKey) {
  ensureHydrated();
  emit({ ...state, open: true, tab: tab ?? state.tab });
  persist();
}

export function closeWorkspacePanel() {
  emit({ ...state, open: false });
  persist();
}

export function setWorkspacePanelTab(tab: WorkspacePanelKey) {
  emit({ ...state, tab });
  persist();
}

/** Remember the scroll offset of a tab so reopening restores it. */
export function setWorkspacePanelScroll(tab: WorkspacePanelKey, offset: number) {
  if (state.scroll[tab] === offset) return;
  emit({ ...state, scroll: { ...state.scroll, [tab]: offset } });
  persist();
}

function subscribe(cb: () => void) {
  ensureHydrated();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): State {
  return state;
}

function getServerSnapshot(): State {
  return DEFAULT;
}

export function useWorkspacePanel(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
