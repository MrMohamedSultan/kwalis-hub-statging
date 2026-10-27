import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { recordAudit } from "@/lib/audit-log";

export type GlAccountCategory =
  "ATL" | "BTL" | "Post-Production" | "Admin & Other" | "Balance Sheet";

/**
 * expense = cost accounts a budget code maps to; the others are balance-sheet
 * accounts (db/pending/174) used by petty cash / treasury and never offered on
 * a cost document.
 */
export type GlAccountType =
  "expense" | "bank" | "cash" | "petty_cash" | "payable" | "wht_payable" | "vat" | "funding";

export type GlAccount = {
  id: string;
  code: string;
  name: string;
  category: GlAccountCategory;
  description: string | null;
  isActive: boolean;
  accountType: GlAccountType;
};

export const GL_CATEGORIES: { key: GlAccountCategory; label: string; hint: string }[] = [
  { key: "ATL", label: "ATL — Above-the-Line", hint: "Pre-production, key talent" },
  { key: "BTL", label: "BTL — Below-the-Line", hint: "Crew, gear, production costs" },
  { key: "Post-Production", label: "Post-Production", hint: "Editing, VFX, sound" },
  { key: "Admin & Other", label: "Admin & Other", hint: "Insurance, permits, catering" },
  { key: "Balance Sheet", label: "Balance Sheet", hint: "Bank, cash, petty cash, payables, tax" },
];

let cache: GlAccount[] | null = null;
const listeners = new Set<(rows: GlAccount[]) => void>();

function emit(rows: GlAccount[]) {
  cache = rows;
  listeners.forEach((l) => l(rows));
}

function mapRow(r: any): GlAccount {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category,
    description: r.description ?? null,
    isActive: !!r.is_active,
    // `select("*")` so this keeps working before db/pending/174 adds the column.
    accountType:
      (r.account_type as GlAccountType | undefined) ??
      (r.code === "2140" ? "wht_payable" : "expense"),
  };
}

async function fetchGlAccounts(): Promise<GlAccount[]> {
  const { data, error } = await supabase
    .from("gl_accounts")
    .select("*")
    .order("code", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function refreshGlAccounts(): Promise<GlAccount[]> {
  const rows = await fetchGlAccounts();
  emit(rows);
  return rows;
}

export async function createGlAccount(input: {
  code: string;
  name: string;
  category: GlAccountCategory;
  description?: string | null;
}): Promise<GlAccount> {
  const { data, error } = await supabase
    .from("gl_accounts")
    .insert({
      code: input.code,
      name: input.name,
      category: input.category,
      description: input.description ?? null,
    })
    .select("id, code, name, category, description, is_active")
    .single();
  if (error) throw error;
  const row = mapRow(data);
  emit([...(cache ?? []), row].sort((a, b) => a.code.localeCompare(b.code)));
  recordAudit({
    category: "other",
    action: "gl_account.create",
    entity: `gl_account:${row.id}`,
    summary: `Created GL account ${row.code} · ${row.name}`,
    details: { new: row },
  });
  return row;
}

export async function updateGlAccount(
  id: string,
  patch: Partial<{
    code: string;
    name: string;
    category: GlAccountCategory;
    description: string | null;
    isActive: boolean;
  }>,
): Promise<GlAccount> {
  const before = (cache ?? []).find((r) => r.id === id) ?? null;
  const dbPatch: any = {};
  if (patch.code !== undefined) dbPatch.code = patch.code;
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.category !== undefined) dbPatch.category = patch.category;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;
  const { data, error } = await supabase
    .from("gl_accounts")
    .update(dbPatch)
    .eq("id", id)
    .select("id, code, name, category, description, is_active")
    .single();
  if (error) throw error;
  const row = mapRow(data);
  emit((cache ?? []).map((r) => (r.id === id ? row : r)));
  recordAudit({
    category: "other",
    action: "gl_account.update",
    entity: `gl_account:${row.id}`,
    summary: `Updated GL account ${row.code} · ${row.name}`,
    details: { old: before, new: row },
  });
  return row;
}

export async function deleteGlAccount(id: string): Promise<void> {
  const before = (cache ?? []).find((r) => r.id === id) ?? null;
  const { error } = await supabase.from("gl_accounts").delete().eq("id", id);
  if (error) throw error;
  emit((cache ?? []).filter((r) => r.id !== id));
  recordAudit({
    category: "other",
    action: "gl_account.delete",
    entity: `gl_account:${id}`,
    severity: "warning",
    summary: before
      ? `Deleted GL account ${before.code} · ${before.name}`
      : `Deleted GL account ${id}`,
    details: { old: before },
  });
}

export function useGlAccounts() {
  const [rows, setRows] = useState<GlAccount[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cb = (r: GlAccount[]) => {
      if (!cancelled) setRows(r);
    };
    listeners.add(cb);
    if (cache === null) {
      fetchGlAccounts()
        .then((r) => {
          emit(r);
          setLoading(false);
        })
        .catch((e) => {
          setError(e?.message ?? "Failed to load GL accounts");
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
    return () => {
      cancelled = true;
      listeners.delete(cb);
    };
  }, []);

  return { rows, loading, error };
}
