import { create } from "zustand";

export type TrashEntityType =
  | "project"
  | "budget_line"
  | "invoice"
  | "vendor"
  | "person"
  | "payroll"
  | "receipt"
  | "purchase_order"
  | "other";

export type TrashItem = {
  id: string; // unique local id
  entityType: TrashEntityType;
  entityId: string; // original id in the source table
  title: string; // human-facing label
  subtitle?: string; // e.g. "Project · Telfaz11 Studios"
  deletedAt: string; // ISO timestamp
  deletedBy?: string; // display name / email
  payload?: unknown; // snapshot for potential restore
};

const KEY = "kwalis.trash.v1";

function load(): TrashItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrashItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items: TrashItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {}
}

type State = {
  items: TrashItem[];
  add: (item: Omit<TrashItem, "id" | "deletedAt"> & { deletedAt?: string }) => void;
  restore: (id: string) => TrashItem | null;
  purge: (id: string) => void;
  purgeAll: () => void;
};

export const useTrash = create<State>((set, get) => ({
  items: load(),
  add: (item) => {
    const full: TrashItem = {
      id: `trash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      deletedAt: item.deletedAt ?? new Date().toISOString(),
      ...item,
    };
    const items = [full, ...get().items];
    persist(items);
    set({ items });
  },
  restore: (id) => {
    const found = get().items.find((x) => x.id === id) ?? null;
    const items = get().items.filter((x) => x.id !== id);
    persist(items);
    set({ items });
    return found;
  },
  purge: (id) => {
    const items = get().items.filter((x) => x.id !== id);
    persist(items);
    set({ items });
  },
  purgeAll: () => {
    persist([]);
    set({ items: [] });
  },
}));
