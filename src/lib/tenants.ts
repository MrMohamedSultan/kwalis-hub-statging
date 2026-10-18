import { create } from "zustand";

export type SubscriptionStatus = "Trial" | "Active" | "Past Due" | "Cancelled";

export type Tenant = {
  id: string;
  name: string;
  owner: string;
  projectLimit: number | "unlimited";
  activeProjects: number;
  plan: "Starter" | "Studio" | "Enterprise";
  status: SubscriptionStatus;
  createdAt: string;
};

const KEY = "kwalis.tenants.v1";

const DEFAULTS: Tenant[] = [
  {
    id: "t-telfaz",
    name: "Telfaz11 Studios",
    owner: "Khalid Al-Harbi",
    projectLimit: 5,
    activeProjects: 3,
    plan: "Studio",
    status: "Active",
    createdAt: "2025-01-12",
  },
  {
    id: "t-mbc",
    name: "MBC Originals",
    owner: "Rana Saleh",
    projectLimit: "unlimited",
    activeProjects: 11,
    plan: "Enterprise",
    status: "Active",
    createdAt: "2024-09-03",
  },
  {
    id: "t-image",
    name: "Image Nation",
    owner: "Hamad Al-Mansouri",
    projectLimit: 10,
    activeProjects: 7,
    plan: "Studio",
    status: "Past Due",
    createdAt: "2025-03-21",
  },
  {
    id: "t-spark",
    name: "Spark Pictures",
    owner: "Lina Najjar",
    projectLimit: 2,
    activeProjects: 2,
    plan: "Starter",
    status: "Trial",
    createdAt: "2026-05-04",
  },
  {
    id: "t-rotana",
    name: "Rotana Studios",
    owner: "Omar Faraj",
    projectLimit: 8,
    activeProjects: 4,
    plan: "Studio",
    status: "Active",
    createdAt: "2024-12-15",
  },
];

function load(): Tenant[] {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Tenant[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function persist(t: Tenant[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {}
}

type State = {
  tenants: Tenant[];
  setLimit: (id: string, limit: number | "unlimited") => void;
  setStatus: (id: string, status: SubscriptionStatus) => void;
  setPlan: (id: string, plan: Tenant["plan"]) => void;
  renameTenant: (id: string, name: string) => void;
  createProject: (id: string) => { ok: boolean; reason?: string };
  addTenant: (t: Omit<Tenant, "id" | "createdAt" | "activeProjects">) => void;
  deleteTenant: (id: string) => void;
};

export const useTenants = create<State>((set, get) => ({
  tenants: load(),
  setLimit: (id, limit) => {
    const tenants = get().tenants.map((t) => (t.id === id ? { ...t, projectLimit: limit } : t));
    persist(tenants);
    set({ tenants });
  },
  setStatus: (id, status) => {
    const tenants = get().tenants.map((t) => (t.id === id ? { ...t, status } : t));
    persist(tenants);
    set({ tenants });
  },
  setPlan: (id, plan) => {
    const tenants = get().tenants.map((t) => (t.id === id ? { ...t, plan } : t));
    persist(tenants);
    set({ tenants });
  },
  renameTenant: (id, name) => {
    const tenants = get().tenants.map((t) => (t.id === id ? { ...t, name } : t));
    persist(tenants);
    set({ tenants });
  },
  createProject: (id) => {
    const t = get().tenants.find((x) => x.id === id);
    if (!t) return { ok: false, reason: "Tenant not found" };
    if (t.projectLimit !== "unlimited" && t.activeProjects >= t.projectLimit) {
      return { ok: false, reason: "Upgrade your plan to add more projects." };
    }
    const tenants = get().tenants.map((x) =>
      x.id === id ? { ...x, activeProjects: x.activeProjects + 1 } : x,
    );
    persist(tenants);
    set({ tenants });
    return { ok: true };
  },
  addTenant: (t) => {
    const id = `t-${Math.random().toString(36).slice(2, 7)}`;
    const tenants = [
      ...get().tenants,
      { ...t, id, activeProjects: 0, createdAt: new Date().toISOString().slice(0, 10) },
    ];
    persist(tenants);
    set({ tenants });
  },
  deleteTenant: (id) => {
    const tenants = get().tenants.filter((t) => t.id !== id);
    persist(tenants);
    set({ tenants });
  },
}));

export function tenantUsagePct(t: Tenant): number {
  if (t.projectLimit === "unlimited") return 0;
  return Math.min(100, Math.round((t.activeProjects / Math.max(1, t.projectLimit)) * 100));
}

export function tenantAtLimit(t: Tenant): boolean {
  return t.projectLimit !== "unlimited" && t.activeProjects >= t.projectLimit;
}
