import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { LodgingSetupPanel } from "@/components/LodgingSetupPanel";
import { useLodging } from "@/lib/lodging";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { BedDouble, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/accommodation-roster")({
  component: () => (
    <AppShell>
      <AccommodationRosterPage />
    </AppShell>
  ),
});

type Row = {
  id?: string;
  person_id: string;
  hotel_name: string;
  property_id: string | null;
  room_type_id: string | null;
  room_number: string;
  check_in_date: string;
  check_out_date: string;
  notes?: string;
  dirty?: boolean;
};

function AccommodationRosterPage() {
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const people = useStore((s) => s.people);
  const { properties, roomTypes } = useLodging();

  // Active personnel: signed contracts (Active status) on this project.
  const activePeople = useMemo(() => people.filter((p) => p.contractStatus === "Active"), [people]);

  const [rowsById, setRowsById] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("accommodations")
        .select("*")
        .eq("project_id", activeProjectId);
      if (cancelled) return;
      if (error) {
        toast.error(t("accommodation_roster.failed_to_load_accommodation_roster"));
        setLoading(false);
        return;
      }
      const map: Record<string, Row> = {};
      (data ?? []).forEach((r: any) => {
        map[r.person_id] = {
          id: r.id,
          person_id: r.person_id,
          hotel_name: r.hotel_name ?? "",
          property_id: r.property_id ?? null,
          room_type_id: r.room_type_id ?? null,
          room_number: r.room_number ?? "",
          check_in_date: r.check_in_date ?? "",
          check_out_date: r.check_out_date ?? "",
          notes: r.notes ?? "",
        };
      });
      setRowsById(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const update = (personId: string, patch: Partial<Row>) => {
    setRowsById((prev) => {
      const existing: Row = prev[personId] ?? {
        person_id: personId,
        hotel_name: "",
        property_id: null,
        room_type_id: null,
        room_number: "",
        check_in_date: "",
        check_out_date: "",
      };
      return {
        ...prev,
        [personId]: { ...existing, ...patch, dirty: true },
      };
    });
  };

  const save = async (personId: string) => {
    if (!activeProjectId) return;
    const row = rowsById[personId];
    if (!row) return;
    const person = activePeople.find((p) => p.id === personId);
    if (!person) return;
    if (row.check_in_date && row.check_out_date && row.check_out_date < row.check_in_date) {
      toast.error(t("accommodation_roster.checkout_date_cannot_be_before_checkin_date"));
      return;
    }
    setSavingId(personId);
    const payload = {
      organization_id: (person as any).organizationId ?? null,
      project_id: activeProjectId,
      person_id: personId,
      hotel_name: row.hotel_name || null,
      property_id: row.property_id,
      room_type_id: row.room_type_id,
      room_number: row.room_number || null,
      check_in_date: row.check_in_date || null,
      check_out_date: row.check_out_date || null,
      notes: row.notes || null,
    };
    let error;
    if (row.id) {
      ({ error } = await supabase.from("accommodations").update(payload).eq("id", row.id));
    } else {
      const res = await supabase.from("accommodations").insert(payload).select("id").single();
      error = res.error;
      if (!error && res.data) {
        setRowsById((prev) => ({
          ...prev,
          [personId]: { ...prev[personId], id: res.data.id, dirty: false },
        }));
      }
    }
    setSavingId(null);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
    } else {
      toast.success(t("accommodation_roster.accommodation_saved"));
      setRowsById((prev) => ({ ...prev, [personId]: { ...prev[personId], dirty: false } }));
    }
  };

  if (!activeProjectId) {
    return (
      <div className="p-6">
        <PageTitle title={t("accommodation_roster.accommodation_roster")} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageTitle title={t("accommodation_roster.accommodation_roster")} />
      <LodgingSetupPanel />
      <Panel>
        <div className="flex items-center gap-2 mb-4">
          <BedDouble className="size-5 text-brand" />
          <div className="text-sm text-muted-foreground">
            {activePeople.length} active personnel on this project
          </div>
        </div>
        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : activePeople.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            {t("accommodation_roster.no_active_contracts_yet_sign_a_crew_or")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table w-full">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  {[
                    "Name",
                    "Role",
                    "Hotel",
                    "Room Type",
                    "Room #",
                    "Check-In",
                    "Check-Out",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs uppercase tracking-wider font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activePeople.map((p) => {
                  const row = rowsById[p.id];
                  const dirty = row?.dirty;
                  const propRooms = roomTypes.filter(
                    (r) => r.property_id === (row?.property_id ?? ""),
                  );
                  return (
                    <tr key={p.id} className="border-b border-border">
                      <td className="px-3 py-2 font-medium">{p.fullName}</td>
                      <td className="px-3 py-2 text-muted-foreground text-sm">
                        {p.kind === "cast" ? p.character || "Cast" : p.position || "Crew"}
                      </td>
                      <td className="px-3 py-2">
                        {properties.length > 0 ? (
                          <select
                            value={row?.property_id ?? ""}
                            onChange={(e) => {
                              const prop = properties.find((x) => x.id === e.target.value) ?? null;
                              update(p.id, {
                                property_id: prop?.id ?? null,
                                hotel_name: prop?.name ?? "",
                                room_type_id: null,
                              });
                            }}
                            className="min-w-[150px] bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                          >
                            <option value="">— Select hotel —</option>
                            {properties.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={row?.hotel_name ?? ""}
                            onChange={(e) => update(p.id, { hotel_name: e.target.value })}
                            placeholder={t("accommodation_roster.add_hotels_in_lodging_setup")}
                            className="w-full bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row?.room_type_id ?? ""}
                          onChange={(e) => update(p.id, { room_type_id: e.target.value || null })}
                          disabled={!row?.property_id}
                          className="min-w-[130px] bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand disabled:opacity-40"
                        >
                          <option value="">—</option>
                          {propRooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} · {r.nightly_rate.toLocaleString()} {r.currency}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row?.room_number ?? ""}
                          onChange={(e) => update(p.id, { room_number: e.target.value })}
                          placeholder={t("accommodation_roster.room")}
                          className="w-24 bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={row?.check_in_date ?? ""}
                          onChange={(e) => update(p.id, { check_in_date: e.target.value })}
                          className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={row?.check_out_date ?? ""}
                          onChange={(e) => update(p.id, { check_out_date: e.target.value })}
                          className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          disabled={!dirty || savingId === p.id}
                          onClick={() => save(p.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand/90 hover:bg-brand text-white px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                        >
                          {savingId === p.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Save className="size-3" />
                          )}
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
