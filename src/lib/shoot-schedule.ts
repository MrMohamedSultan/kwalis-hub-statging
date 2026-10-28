// ═══════════════════════════════════════════════════════════════════
// E11 — shooting schedule (db/pending/197, public.project_shoot_days).
// One row per actual shoot day; a postponed day is moved (its first date
// stays in original_date) and every change is in the audit trail.
//
// Shared helper for other reports (Live Balance — "shooting days" accrual
// method): fetchShootDays(projectId) + countShootDays(days, from, to).
// In SQL the same count is public.project_shoot_day_count(project, from, to).
// ═══════════════════════════════════════════════════════════════════
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const SHOOT_DAY_STATUSES = ["planned", "shot", "postponed", "cancelled"] as const;
export type ShootDayStatus = (typeof SHOOT_DAY_STATUSES)[number];

export interface ShootDay {
  id: string;
  project_id: string;
  shoot_date: string;
  status: ShootDayStatus;
  original_date: string | null;
  location: string | null;
  region: string | null;
  unit: string | null;
  notes: string | null;
}

/** Statuses that count as a shoot day (planned or already shot). */
export const isActiveShootDay = (d: Pick<ShootDay, "status">) =>
  d.status === "planned" || d.status === "shot";

/** Distinct active shoot dates in [from, to] (inclusive, ISO dates; open ends allowed). */
export function countShootDays(
  days: readonly Pick<ShootDay, "shoot_date" | "status">[],
  from?: string | null,
  to?: string | null,
): number {
  const set = new Set<string>();
  for (const d of days) {
    if (!isActiveShootDay(d)) continue;
    const date = d.shoot_date.slice(0, 10);
    if (from && date < from) continue;
    if (to && date > to) continue;
    set.add(date);
  }
  return set.size;
}

/** True when the date was moved away from its first planned date. */
export const wasPostponed = (d: Pick<ShootDay, "shoot_date" | "original_date">) =>
  !!d.original_date && d.original_date.slice(0, 10) !== d.shoot_date.slice(0, 10);

const table = () => supabase.from("project_shoot_days" as never) as any;

export async function fetchShootDays(projectId: string): Promise<ShootDay[]> {
  const { data, error } = await table()
    .select("id, project_id, shoot_date, status, original_date, location, region, unit, notes")
    .eq("project_id", projectId)
    .order("shoot_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ShootDay[];
}

const shootDaySchema = z.object({
  shoot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(SHOOT_DAY_STATUSES),
  location: z.string().trim().max(200).nullable(),
  region: z.string().trim().max(100).nullable(),
  unit: z.string().trim().max(60).nullable(),
  notes: z.string().trim().max(1000).nullable(),
  change_reason: z.string().trim().max(500).nullable().optional(),
});
export type ShootDayInput = z.infer<typeof shootDaySchema>;

export async function addShootDay(projectId: string, input: ShootDayInput) {
  const v = shootDaySchema.parse(input);
  const { error } = await table().insert({ ...v, project_id: z.string().uuid().parse(projectId) });
  if (error) throw error;
}

export async function updateShootDay(id: string, input: ShootDayInput) {
  const v = shootDaySchema.parse(input);
  const { error } = await table().update(v).eq("id", z.string().uuid().parse(id));
  if (error) throw error;
}

export async function deleteShootDay(id: string) {
  const { error } = await table().delete().eq("id", z.string().uuid().parse(id));
  if (error) throw error;
}

export const shootDaysKey = (projectId: string | null) =>
  ["project-shoot-days", projectId] as const;

export function useShootDays(projectId: string | null) {
  return useQuery({
    queryKey: shootDaysKey(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: () => fetchShootDays(projectId as string),
  });
}

export function useInvalidateShootDays() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["project-shoot-days"] }),
      qc.invalidateQueries({ queryKey: ["film-commission-rebate"] }),
    ]);
}
