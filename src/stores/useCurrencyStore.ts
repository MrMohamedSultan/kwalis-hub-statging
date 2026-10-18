import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { supabase } from "@/integrations/supabase/client";
import { resolveProjectFxRate, type FxRateSource } from "@/lib/fx-resolution";
import type { ActiveCurrency, FxRate } from "@/utils/currency-conversion";

export interface FxRateAuditEntry {
  id: string;
  projectId: string;
  previousRate: number | null;
  newRate: number;
  baseCurrency: string;
  targetCurrency: string;
  changedBy: string;
  changedAt: string;
  reason: string | null;
  rowsRecalculated: number;
  recalculationStatus: "pending" | "completed" | "failed";
}

export const DEFAULT_FX_RATE: FxRate = {
  rate: 3.75,
  baseCurrency: "SAR",
  targetCurrency: "USD",
};

interface UpdateResult {
  success: boolean;
  error?: string;
  rowsRecalculated?: number;
}

interface CurrencyState {
  activeCurrency: ActiveCurrency;
  projectFxRate: FxRate;
  isLoadingRate: boolean;
  rateError: string | null;
  /** False when NO configured rate exists at any level — converters and
   *  the toggle must refuse to convert rather than use a guessed rate. */
  rateFound: boolean;
  /** Which level of the resolution chain produced the rate. */
  rateSource: FxRateSource | null;
  /** Effective date — only recorded by project_fx_rates (level 1). */
  rateEffectiveFrom: string | null;
  isUpdatingRate: boolean;
  lastRecalculationResult: UpdateResult | null;
  auditLog: FxRateAuditEntry[];
  isLoadingAudit: boolean;
  isCompanyAdmin: boolean;

  toggleCurrency: () => void;
  setActiveCurrency: (currency: ActiveCurrency) => void;
  loadProjectFxRate: (projectId: string) => Promise<void>;
  updateProjectFxRate: (
    projectId: string,
    newRate: number,
    reason?: string,
  ) => Promise<UpdateResult>;
  loadAuditLog: (projectId: string) => Promise<void>;
  checkAdminStatus: (projectId: string) => Promise<void>;
}

// The generated Supabase types lag behind the new FX tables/RPCs.
const db = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => any;
};

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set, get) => ({
      activeCurrency: "base",
      projectFxRate: DEFAULT_FX_RATE,
      isLoadingRate: false,
      rateError: null,
      rateFound: true,
      rateSource: null,
      rateEffectiveFrom: null,
      isUpdatingRate: false,
      lastRecalculationResult: null,
      auditLog: [],
      isLoadingAudit: false,
      isCompanyAdmin: false,

      toggleCurrency: () =>
        set((s) => ({ activeCurrency: s.activeCurrency === "base" ? "target" : "base" })),

      setActiveCurrency: (currency) => set({ activeCurrency: currency }),

      loadProjectFxRate: async (projectId) => {
        if (!projectId) return;
        set({ isLoadingRate: true, rateError: null });
        try {
          // Honest 3-level chain: project_fx_rates → projects.fx_rate →
          // organizations.fx_rates. When nothing is configured we keep the
          // default SHAPE for backwards compatibility but flag rateFound=false
          // so no screen converts with a guessed rate.
          const resolved = await resolveProjectFxRate(projectId);
          if (resolved) {
            set({
              projectFxRate: {
                rate: resolved.rate,
                baseCurrency: resolved.baseCurrency,
                targetCurrency: resolved.targetCurrency,
              },
              rateFound: true,
              rateSource: resolved.source,
              rateEffectiveFrom: resolved.effectiveFrom,
              isLoadingRate: false,
            });
          } else {
            set({
              projectFxRate: DEFAULT_FX_RATE,
              rateFound: false,
              rateSource: null,
              rateEffectiveFrom: null,
              isLoadingRate: false,
            });
          }
        } catch (e) {
          set({
            projectFxRate: DEFAULT_FX_RATE,
            rateFound: false,
            rateSource: null,
            rateEffectiveFrom: null,
            rateError: e instanceof Error ? e.message : "Failed to load FX rate",
            isLoadingRate: false,
          });
        }
      },

      updateProjectFxRate: async (projectId, newRate, reason) => {
        if (!get().isCompanyAdmin) {
          const result: UpdateResult = { success: false, error: "FORBIDDEN" };
          set({ lastRecalculationResult: result });
          return result;
        }
        set({ isUpdatingRate: true, lastRecalculationResult: null });
        try {
          const { data, error } = await db.rpc("update_project_fx_rate", {
            p_project_id: projectId,
            p_new_rate: newRate,
            p_base_currency: "SAR",
            p_target_currency: "USD",
            p_reason: reason ?? null,
          });
          if (error) throw error;
          const payload = (data ?? {}) as { rows_recalculated?: number };
          await get().loadProjectFxRate(projectId);
          await get().loadAuditLog(projectId);
          const result: UpdateResult = {
            success: true,
            rowsRecalculated: Number(payload.rows_recalculated ?? 0),
          };
          set({ isUpdatingRate: false, lastRecalculationResult: result });
          return result;
        } catch (e) {
          const result: UpdateResult = {
            success: false,
            error: e instanceof Error ? e.message : "Failed to update FX rate",
          };
          set({ isUpdatingRate: false, lastRecalculationResult: result });
          return result;
        }
      },

      loadAuditLog: async (projectId) => {
        if (!projectId) return;
        set({ isLoadingAudit: true });
        try {
          const { data, error } = await db
            .from("fx_rate_audit_log")
            .select("*")
            .eq("project_id", projectId)
            .order("changed_at", { ascending: false })
            .limit(50);
          if (error) throw error;
          const rows = (data ?? []) as Array<Record<string, any>>;
          set({
            auditLog: rows.map((r) => ({
              id: r.id,
              projectId: r.project_id,
              previousRate: r.previous_rate == null ? null : Number(r.previous_rate),
              newRate: Number(r.new_rate),
              baseCurrency: r.base_currency,
              targetCurrency: r.target_currency,
              changedBy: r.changed_by,
              changedAt: r.changed_at,
              reason: r.reason ?? null,
              rowsRecalculated: Number(r.rows_recalculated ?? 0),
              recalculationStatus: (r.recalculation_status ?? "pending") as
                "pending" | "completed" | "failed",
            })),
            isLoadingAudit: false,
          });
        } catch {
          set({ auditLog: [], isLoadingAudit: false });
        }
      },

      checkAdminStatus: async (projectId) => {
        if (!projectId) {
          set({ isCompanyAdmin: false });
          return;
        }
        try {
          const { data } = await db.rpc("is_company_admin_for_project", {
            p_project_id: projectId,
          });
          set({ isCompanyAdmin: data === true });
        } catch {
          set({ isCompanyAdmin: false });
        }
      },
    }),
    {
      name: "kwalis-currency-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ activeCurrency: state.activeCurrency }),
    },
  ),
);

export const useActiveCurrency = () => useCurrencyStore((s) => s.activeCurrency);
export const useProjectFxRate = () => useCurrencyStore((s) => s.projectFxRate);
export const useIsCompanyAdmin = () => useCurrencyStore((s) => s.isCompanyAdmin);
