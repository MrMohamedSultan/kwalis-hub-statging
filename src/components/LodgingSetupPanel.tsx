// Lodging Setup — define hotels and their room types before assigning crew.
// The Accommodation Roster reads this catalog so hotel names and nightly rates
// stay consistent instead of being retyped per person.
import { useState } from "react";
import { Building2, Plus, Trash2, Loader2, BedDouble } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/AppShell";
import {
  useLodging,
  createProperty,
  deleteProperty,
  createRoomType,
  deleteRoomType,
} from "@/lib/lodging";
import { useStore } from "@/lib/store";

import { useTranslation } from "react-i18next";
export function LodgingSetupPanel() {
  const { t } = useTranslation();

  const projectId = useStore((s) => s.activeProjectId);
  const orgId = useStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.organizationId ?? null,
  );
  const { properties, roomTypes, loading, refresh } = useLodging();

  const [hotel, setHotel] = useState({ name: "", city: "", contactName: "", contactPhone: "" });
  const [room, setRoom] = useState({
    propertyId: "",
    name: "",
    nightlyRate: "",
    occupancy: "1",
    currency: "SAR",
  });
  const [busy, setBusy] = useState(false);

  const addHotel = async () => {
    if (!projectId) return;
    if (!hotel.name.trim()) {
      toast.error(t("lodgingsetuppanel.hotel_name_is_required"));
      return;
    }
    setBusy(true);
    try {
      await createProperty({
        projectId,
        organizationId: orgId,
        name: hotel.name,
        city: hotel.city || null,
        contactName: hotel.contactName || null,
        contactPhone: hotel.contactPhone || null,
      });
      setHotel({ name: "", city: "", contactName: "", contactPhone: "" });
      await refresh();
      toast.success(t("lodgingsetuppanel.hotel_added"));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add hotel");
    } finally {
      setBusy(false);
    }
  };

  const addRoom = async () => {
    if (!projectId) return;
    if (!room.propertyId) {
      toast.error(t("lodgingsetuppanel.pick_a_hotel_first"));
      return;
    }
    if (!room.name.trim()) {
      toast.error(t("lodgingsetuppanel.room_type_name_is_required"));
      return;
    }
    setBusy(true);
    try {
      await createRoomType({
        projectId,
        organizationId: orgId,
        propertyId: room.propertyId,
        name: room.name,
        nightlyRate: Number(room.nightlyRate) || 0,
        occupancy: Number(room.occupancy) || 1,
        currency: room.currency || "SAR",
      });
      setRoom({ ...room, name: "", nightlyRate: "", occupancy: "1" });
      await refresh();
      toast.success(t("lodgingsetuppanel.room_type_added"));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add room type");
    } finally {
      setBusy(false);
    }
  };

  const removeHotel = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and all of its room types?`)) return;
    try {
      await deleteProperty(id);
      await refresh();
      toast.success(t("lodgingsetuppanel.hotel_removed"));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove hotel");
    }
  };

  const removeRoom = async (id: string) => {
    try {
      await deleteRoomType(id);
      await refresh();
      toast.success(t("lodgingsetuppanel.room_type_removed"));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove room type");
    }
  };

  const field =
    "bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 ring-brand";

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="size-5 text-brand" />
        <h2 className="text-sm font-semibold">{t("lodgingsetuppanel.lodging_setup")}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Define hotels and room types once — the roster below assigns personnel to them.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hotels */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Hotels
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <input
              className={field}
              placeholder={t("lodgingsetuppanel.hotel_name")}
              value={hotel.name}
              onChange={(e) => setHotel({ ...hotel, name: e.target.value })}
            />
            <input
              className={field}
              placeholder="City"
              value={hotel.city}
              onChange={(e) => setHotel({ ...hotel, city: e.target.value })}
            />
            <input
              className={field}
              placeholder={t("lodgingsetuppanel.contact_name")}
              value={hotel.contactName}
              onChange={(e) => setHotel({ ...hotel, contactName: e.target.value })}
            />
            <input
              className={field}
              placeholder="Contact phone"
              value={hotel.contactPhone}
              onChange={(e) => setHotel({ ...hotel, contactPhone: e.target.value })}
            />
            <button
              onClick={addHotel}
              disabled={busy}
              className="col-span-2 inline-flex items-center justify-center gap-1 rounded-lg bg-brand/90 hover:bg-brand text-white px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Add
              Hotel
            </button>
          </div>
          <ul className="space-y-1">
            {loading && <li className="text-xs text-muted-foreground">Loading…</li>}
            {!loading && properties.length === 0 && (
              <li className="text-xs text-muted-foreground">
                {t("lodgingsetuppanel.no_hotels_defined_yet")}
              </li>
            )}
            {properties.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{p.name}</span>
                  {p.city ? <span className="text-muted-foreground"> · {p.city}</span> : null}
                  <span className="text-muted-foreground">
                    {" "}
                    · {roomTypes.filter((r) => r.property_id === p.id).length} room type(s)
                  </span>
                </span>
                <button
                  onClick={() => removeHotel(p.id, p.name)}
                  aria-label={`Delete ${p.name}`}
                  className="p-1 rounded hover:bg-destructive/20 text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Room types */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {t("lodgingsetuppanel.room_types")}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <select
              className={`${field} col-span-2`}
              value={room.propertyId}
              onChange={(e) => setRoom({ ...room, propertyId: e.target.value })}
            >
              <option value="">— Select hotel —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              className={field}
              placeholder={t("lodgingsetuppanel.eg_single_twin_suite")}
              value={room.name}
              onChange={(e) => setRoom({ ...room, name: e.target.value })}
            />
            <input
              className={field}
              type="number"
              min={0}
              step={0.01}
              dir="ltr"
              placeholder={t("lodgingsetuppanel.nightly_rate")}
              value={room.nightlyRate}
              onChange={(e) => setRoom({ ...room, nightlyRate: e.target.value })}
            />
            <input
              className={field}
              type="number"
              min={1}
              step={1}
              dir="ltr"
              placeholder={t("lodgingsetuppanel.occupancy")}
              value={room.occupancy}
              onChange={(e) => setRoom({ ...room, occupancy: e.target.value })}
            />
            <select
              className={field}
              value={room.currency}
              onChange={(e) => setRoom({ ...room, currency: e.target.value })}
            >
              <option value="SAR">SAR</option>
              <option value="USD">USD</option>
            </select>
            <button
              onClick={addRoom}
              disabled={busy}
              className="col-span-2 inline-flex items-center justify-center gap-1 rounded-lg bg-brand/90 hover:bg-brand text-white px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <BedDouble className="size-3" />
              )}{" "}
              Add Room Type
            </button>
          </div>
          <ul className="space-y-1">
            {!loading && roomTypes.length === 0 && (
              <li className="text-xs text-muted-foreground">
                {t("lodgingsetuppanel.no_room_types_defined_yet")}
              </li>
            )}
            {roomTypes.map((r) => {
              const p = properties.find((x) => x.id === r.property_id);
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {p?.name ?? "—"} · {r.nightly_rate.toLocaleString()} {r.currency}/night ·
                      sleeps {r.occupancy}
                    </span>
                  </span>
                  <button
                    onClick={() => removeRoom(r.id)}
                    aria-label={`Delete ${r.name}`}
                    className="p-1 rounded hover:bg-destructive/20 text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
