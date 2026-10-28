// ═══════════════════════════════════════════════════════════════════
// Person profiles (E01) — public.persons (db/pending/190).
//
// One profile per person per organization; every Crew/Cast contract
// (public.people row) points to it with person_id. The database keeps the
// identity fields of a person's contracts in sync and links a new contract
// to the profile with the same ID number; the app lets the user pick the
// person from a list and warns on look-alike names / the same ID number.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PersonProfile = {
  id: string;
  organizationId: string;
  fullName: string;
  idType: "national_id" | "iqama" | "passport" | null;
  idNumber: string | null;
  nationality: string | null;
  motherSaudi: boolean | null;
  relatedParty: boolean | null;
  taxResidency: "resident" | "non_resident" | null;
  phoneNumber: string | null;
  email: string | null;
  bank: string | null;
  bankCountry: string | null;
  iban: string | null;
  swiftCode: string | null;
};

// persons is newer than the generated Supabase types.
const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

const fromRow = (r: any): PersonProfile => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  fullName: String(r.full_name ?? ""),
  idType: r.id_type ?? null,
  idNumber: r.id_number ?? null,
  nationality: r.nationality ?? null,
  motherSaudi: r.mother_saudi ?? null,
  relatedParty: r.related_party ?? null,
  taxResidency: r.tax_residency ?? null,
  phoneNumber: r.phone_number ?? null,
  email: r.email ?? null,
  bank: r.bank ?? null,
  bankCountry: r.bank_country ?? null,
  iban: r.iban ?? null,
  swiftCode: r.swift_code ?? null,
});

/** Profiles of one organization, by name. `available` is false until 190 is applied. */
export async function fetchPersons(
  organizationId: string,
): Promise<{ available: boolean; persons: PersonProfile[] }> {
  try {
    const { data, error } = await db
      .from("persons")
      .select("*")
      .eq("organization_id", organizationId)
      .order("full_name")
      .limit(5000);
    if (error) return { available: false, persons: [] };
    return { available: true, persons: ((data ?? []) as any[]).map(fromRow) };
  } catch {
    return { available: false, persons: [] };
  }
}

export function usePersons(organizationId: string | null | undefined) {
  const [state, setState] = useState<{
    loading: boolean;
    available: boolean;
    persons: PersonProfile[];
  }>({ loading: true, available: false, persons: [] });
  const reload = useCallback(async () => {
    if (!organizationId) {
      setState({ loading: false, available: false, persons: [] });
      return;
    }
    const res = await fetchPersons(organizationId);
    setState({ loading: false, ...res });
  }, [organizationId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { ...state, reload };
}

/** Owner: merge two profiles of the same person (contracts move to `keep`). */
export async function mergePersons(keepId: string, dropId: string): Promise<number> {
  const { data, error } = await db.rpc("persons_merge", { p_keep: keepId, p_drop: dropId });
  if (error) throw error;
  return Number(data) || 0;
}

export type BackfillRow = {
  contract_id: string;
  project_id: string | null;
  full_name: string;
  id_number: string | null;
  person_id: string | null;
  action: "linked_by_id" | "created" | "created_no_id";
};

/** Owner: link existing contracts by exact ID number (dry run unless apply). */
export async function backfillPersons(organizationId: string, apply: boolean) {
  const { data, error } = await db.rpc("persons_backfill", {
    p_org: organizationId,
    p_apply: apply,
  });
  if (error) throw error;
  return (data ?? []) as BackfillRow[];
}

/** Fields a picked profile copies into the contract form. */
export function profileToContractPatch(
  p: PersonProfile,
  current: {
    bank?: string;
    bankCountry?: string;
    iban?: string;
    swiftCode?: string;
    taxResidency?: "resident" | "non_resident" | null;
  },
) {
  return {
    personId: p.id,
    fullName: p.fullName,
    idType: p.idType,
    idNumber: p.idNumber ?? "",
    nationality: p.nationality ?? "",
    motherSaudi: p.motherSaudi,
    relatedParty: p.relatedParty,
    phoneNumber: p.phoneNumber ?? "",
    email: p.email ?? "",
    // defaults only — what the form already has stays
    bank: current.bank?.trim() ? current.bank : (p.bank ?? ""),
    bankCountry: current.bankCountry?.trim() ? current.bankCountry : (p.bankCountry ?? ""),
    iban: current.iban?.trim() ? current.iban : (p.iban ?? ""),
    swiftCode: current.swiftCode?.trim() ? current.swiftCode : (p.swiftCode ?? ""),
    taxResidency: current.taxResidency ?? p.taxResidency,
  };
}

const columnCache = new Map<string, Promise<boolean>>();
/** True when `table.column` exists on the server (a pending file was applied). */
export function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  let p = columnCache.get(key);
  if (!p) {
    p = Promise.resolve(
      db
        .from(table)
        .select(column)
        .limit(1)
        .then(({ error }: { error: unknown }) => !error),
    ).catch(() => false);
    columnCache.set(key, p);
  }
  return p;
}

export function useHasColumn(table: string, column: string): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    void hasColumn(table, column).then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, [table, column]);
  return ok;
}
