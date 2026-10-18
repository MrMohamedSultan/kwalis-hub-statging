// Lodging setup: hotels (properties) and their room types. The Accommodation
// Roster assigns crew/cast to a saved property + room type instead of typing a
// free-text hotel name, so nightly rates stay consistent across the production.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";

export type LodgingProperty = {
  id: string;
  project_id: string | null;
  organization_id: string | null;
  name: string;
  address: string | null;
  city: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  currency: string;
  notes: string | null;
};

export type LodgingRoomType = {
  id: string;
  property_id: string;
  project_id: string | null;
  organization_id: string | null;
  name: string;
  nightly_rate: number;
  currency: string;
  occupancy: number;
  notes: string | null;
};

export async function listLodging(
  projectId: string,
): Promise<{ properties: LodgingProperty[]; roomTypes: LodgingRoomType[] }> {
  const [p, r] = await Promise.all([
    supabase
      .from("lodging_properties" as any)
      .select("*")
      .eq("project_id", projectId)
      .order("name"),
    supabase
      .from("lodging_room_types" as any)
      .select("*")
      .eq("project_id", projectId)
      .order("name"),
  ]);
  return {
    properties: (p.data ?? []) as unknown as LodgingProperty[],
    roomTypes: ((r.data ?? []) as unknown as any[]).map((x) => ({
      ...x,
      nightly_rate: Number(x.nightly_rate ?? 0),
      occupancy: Number(x.occupancy ?? 1),
    })) as LodgingRoomType[],
  };
}

export async function createProperty(input: {
  projectId: string;
  organizationId: string | null;
  name: string;
  city?: string | null;
  address?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  currency?: string;
  notes?: string | null;
}): Promise<LodgingProperty> {
  const { data, error } = await supabase
    .from("lodging_properties" as any)
    .insert({
      project_id: input.projectId,
      organization_id: input.organizationId,
      name: input.name.trim(),
      city: input.city ?? null,
      address: input.address ?? null,
      contact_name: input.contactName ?? null,
      contact_phone: input.contactPhone ?? null,
      currency: input.currency ?? "SAR",
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as LodgingProperty;
}

export async function updateProperty(id: string, patch: Partial<LodgingProperty>): Promise<void> {
  const { error } = await supabase
    .from("lodging_properties" as any)
    .update(patch as any)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteProperty(id: string): Promise<void> {
  const { error } = await supabase
    .from("lodging_properties" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function createRoomType(input: {
  projectId: string;
  organizationId: string | null;
  propertyId: string;
  name: string;
  nightlyRate: number;
  currency?: string;
  occupancy?: number;
  notes?: string | null;
}): Promise<LodgingRoomType> {
  const { data, error } = await supabase
    .from("lodging_room_types" as any)
    .insert({
      project_id: input.projectId,
      organization_id: input.organizationId,
      property_id: input.propertyId,
      name: input.name.trim(),
      nightly_rate: Number(input.nightlyRate) || 0,
      currency: input.currency ?? "SAR",
      occupancy: Math.max(1, Number(input.occupancy ?? 1)),
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as LodgingRoomType;
}

export async function updateRoomType(id: string, patch: Partial<LodgingRoomType>): Promise<void> {
  const { error } = await supabase
    .from("lodging_room_types" as any)
    .update(patch as any)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteRoomType(id: string): Promise<void> {
  const { error } = await supabase
    .from("lodging_room_types" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export function useLodging() {
  const projectId = useStore((s) => s.activeProjectId);
  const [properties, setProperties] = useState<LodgingProperty[]>([]);
  const [roomTypes, setRoomTypes] = useState<LodgingRoomType[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setProperties([]);
      setRoomTypes([]);
      return;
    }
    setLoading(true);
    try {
      const res = await listLodging(projectId);
      setProperties(res.properties);
      setRoomTypes(res.roomTypes);
    } catch {
      setProperties([]);
      setRoomTypes([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { properties, roomTypes, loading, refresh };
}
