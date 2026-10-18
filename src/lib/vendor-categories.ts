// Dynamic per-organization vendor categories.
// Falls back to the hardcoded VENDOR_CATEGORIES defaults when the active org
// has no custom entries yet.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { VENDOR_CATEGORIES } from "@/lib/data";

export type VendorCategoryRow = {
  id: string;
  organization_id: string;
  name: string;
};

export function useVendorCategories() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const orgId = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId)?.organizationId ?? null)
    : null;

  const [rows, setRows] = useState<VendorCategoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setRows([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("vendor_categories")
      .select("id, organization_id, name")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });
    setLoading(false);
    if (!error) setRows((data ?? []) as VendorCategoryRow[]);
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const custom = rows.map((r) => r.name);
  // Merge defaults + custom (case-insensitive dedupe, defaults first).
  const seen = new Set<string>();
  const names: string[] = [];
  for (const n of [...VENDOR_CATEGORIES, ...custom]) {
    const key = n.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(n);
  }

  const add = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name is required");
    if (!orgId) throw new Error("Select an active project first.");
    const { error } = await supabase
      .from("vendor_categories")
      .insert({ organization_id: orgId, name: trimmed });
    if (error) throw error;
    await refresh();
  };

  const rename = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name is required");
    const { error } = await supabase
      .from("vendor_categories")
      .update({ name: trimmed })
      .eq("id", id);
    if (error) throw error;
    await refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("vendor_categories").delete().eq("id", id);
    if (error) throw error;
    await refresh();
  };

  return { names, rows, loading, add, rename, remove, refresh, orgId };
}
