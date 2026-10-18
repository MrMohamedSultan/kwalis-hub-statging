import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import {
  Route as RouteIcon,
  Plus,
  Save,
  Trash2,
  Loader2,
  FileSpreadsheet,
  FileText,
  ChevronDown,
  X,
  Copy,
  AlertTriangle,
} from "lucide-react";
import { useExportAction } from "@/hooks/use-export-action";
import { toast } from "sonner";
import { loadPdf, loadXlsx } from "@/lib/lazy-export-libs";
import { formatDateDMY } from "@/lib/date-format";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/daily-transport")({
  component: () => (
    <AppShell>
      <DailyTransportPage />
    </AppShell>
  ),
});

type CarRentalOpt = {
  id: string;
  make_model: string;
  license_plate: string;
  driver_person_id: string | null;
  driver_name: string | null;
};

type AccommodationRow = {
  person_id: string;
  hotel_name: string | null;
};

type Row = {
  id?: string;
  pickup_time: string;
  passenger_ids: string[];
  pickup_location: string;
  dropoff_location: string;
  car_rental_id: string | null;
  vehicle_label: string | null;
  driver_person_id: string | null;
  driver_name: string | null;
  notes: string;
  dirty?: boolean;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyRow = (): Row => ({
  pickup_time: "",
  passenger_ids: [],
  pickup_location: "",
  dropoff_location: "",
  car_rental_id: null,
  vehicle_label: null,
  driver_person_id: null,
  driver_name: null,
  notes: "",
  dirty: true,
});

function DailyTransportPage() {
  const { t } = useTranslation();
  const { run, isPending } = useExportAction();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const projectName = useStore((s) => s.projectName);
  const people = useStore((s) => s.people);

  const [transportDate, setTransportDate] = useState<string>(todayISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [cars, setCars] = useState<CarRentalOpt[]>([]);
  const [accommodations, setAccommodations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);

  // Passengers must be Active, flagged "Requires Daily Transport", and their contract window must cover the sheet date.
  const activePeople = useMemo(
    () =>
      people.filter((p) => {
        if (p.contractStatus !== "Active") return false;
        if (!p.requiresTransport) return false;
        if (p.startDate && transportDate < p.startDate) return false;
        if (p.endDate && transportDate > p.endDate) return false;
        return true;
      }),
    [people, transportDate],
  );

  // Vehicle/driver overlap detection within the current sheet.
  // Rows conflict when they share a car or driver and pickup_time is within 90 min.
  const conflictIdxs = useMemo(() => {
    const CONFLICT_MIN = 90;
    const toMin = (t: string): number | null => {
      if (!t) return null;
      const [h, m] = t.split(":").map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };
    const conflicts = new Set<number>();
    for (let i = 0; i < rows.length; i++) {
      const at = toMin(rows[i].pickup_time);
      if (at === null) continue;
      for (let j = i + 1; j < rows.length; j++) {
        const bt = toMin(rows[j].pickup_time);
        if (bt === null) continue;
        const sameCar = rows[i].car_rental_id && rows[i].car_rental_id === rows[j].car_rental_id;
        const sameDriver =
          rows[i].driver_person_id && rows[i].driver_person_id === rows[j].driver_person_id;
        if ((sameCar || sameDriver) && Math.abs(at - bt) < CONFLICT_MIN) {
          conflicts.add(i);
          conflicts.add(j);
        }
      }
    }
    return conflicts;
  }, [rows]);

  // Load cars & accommodations once per project
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    (async () => {
      const [carsRes, accRes] = await Promise.all([
        supabase
          .from("car_rentals")
          .select("id, make_model, license_plate, driver_person_id, driver_name")
          .eq("project_id", activeProjectId),
        supabase
          .from("accommodations")
          .select("person_id, hotel_name")
          .eq("project_id", activeProjectId),
      ]);
      if (cancelled) return;
      setCars((carsRes.data ?? []) as CarRentalOpt[]);
      const map: Record<string, string> = {};
      ((accRes.data ?? []) as AccommodationRow[]).forEach((r) => {
        if (r.hotel_name) map[r.person_id] = r.hotel_name;
      });
      setAccommodations(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  // Load transports per selected date
  useEffect(() => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("daily_transports")
        .select("*")
        .eq("project_id", activeProjectId)
        .eq("transport_date", transportDate)
        .order("pickup_time", { ascending: true, nullsFirst: false });
      if (cancelled) return;
      if (error) {
        toast.error(t("daily_transport.failed_to_load_transports"));
        setLoading(false);
        return;
      }
      setRows(
        (data ?? []).map((r: any) => ({
          id: r.id,
          pickup_time: (r.pickup_time ?? "").slice(0, 5),
          passenger_ids: r.passenger_ids ?? [],
          pickup_location: r.pickup_location ?? "",
          dropoff_location: r.dropoff_location ?? "",
          car_rental_id: r.car_rental_id ?? null,
          vehicle_label: r.vehicle_label ?? null,
          driver_person_id: r.driver_person_id ?? null,
          driver_name: r.driver_name ?? null,
          notes: r.notes ?? "",
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, transportDate]);

  const update = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch, dirty: true } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const togglePassenger = (idx: number, personId: string) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const has = r.passenger_ids.includes(personId);
        const nextIds = has
          ? r.passenger_ids.filter((x) => x !== personId)
          : [...r.passenger_ids, personId];

        // Auto-fill pickup_location from accommodation when adding first passenger
        // and pickup is empty. Do not overwrite user edits.
        let nextPickup = r.pickup_location;
        if (!has && !r.pickup_location.trim()) {
          const hotel = accommodations[personId];
          if (hotel) nextPickup = hotel;
        }
        return { ...r, passenger_ids: nextIds, pickup_location: nextPickup, dirty: true };
      }),
    );
  };

  const selectCar = (idx: number, carId: string) => {
    const car = cars.find((c) => c.id === carId) || null;
    update(idx, {
      car_rental_id: car?.id ?? null,
      vehicle_label: car ? `${car.make_model} — ${car.license_plate}` : null,
      driver_person_id: car?.driver_person_id ?? null,
      driver_name: car?.driver_name ?? null,
    });
  };

  const save = async (idx: number) => {
    if (!activeProjectId) return;
    const row = rows[idx];
    if (!row) return;
    if (row.passenger_ids.length === 0) {
      toast.error(t("daily_transport.add_at_least_one_passenger"));
      return;
    }
    setSavingIdx(idx);
    const payload = {
      project_id: activeProjectId,
      transport_date: transportDate,
      pickup_time: row.pickup_time || null,
      passenger_ids: row.passenger_ids,
      pickup_location: row.pickup_location || null,
      dropoff_location: row.dropoff_location || null,
      car_rental_id: row.car_rental_id,
      vehicle_label: row.vehicle_label,
      driver_person_id: row.driver_person_id,
      driver_name: row.driver_name,
      notes: row.notes || null,
    };
    let error;
    if (row.id) {
      ({ error } = await supabase.from("daily_transports").update(payload).eq("id", row.id));
    } else {
      const res = await supabase.from("daily_transports").insert(payload).select("id").single();
      error = res.error;
      if (!error && res.data) {
        setRows((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, id: res.data.id, dirty: false } : r)),
        );
      }
    }
    setSavingIdx(null);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
    } else {
      toast.success(t("daily_transport.transport_saved"));
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, dirty: false } : r)));
    }
  };

  const remove = async (idx: number) => {
    const row = rows[idx];
    if (!row) return;
    if (!row.id) {
      setRows((prev) => prev.filter((_, i) => i !== idx));
      return;
    }
    if (!confirm(t("daily_transport.delete_this_transport_entry"))) return;
    const { error } = await supabase.from("daily_transports").delete().eq("id", row.id);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
    toast.success("Deleted");
  };

  const passengerNames = (ids: string[]) =>
    ids.map((id) => activePeople.find((p) => p.id === id)?.fullName ?? "Unknown").join(", ");

  // ---------- Copy from previous day ----------
  const copyFromPrevious = async () => {
    if (!activeProjectId) return;
    if (rows.some((r) => r.dirty)) {
      if (!confirm(t("daily_transport.you_have_unsaved_changes_on_this_sheet_copying"))) return;
    } else if (rows.length > 0) {
      if (
        !confirm(
          `This will add movements from the previous day to ${formatDateDMY(transportDate)}. Continue?`,
        )
      )
        return;
    }
    setCopying(true);
    // Find the most recent transport_date strictly before the selected date.
    const { data: prev, error: prevErr } = await supabase
      .from("daily_transports")
      .select("transport_date")
      .eq("project_id", activeProjectId)
      .lt("transport_date", transportDate)
      .order("transport_date", { ascending: false })
      .limit(1);
    if (prevErr || !prev || prev.length === 0) {
      setCopying(false);
      toast.error(t("daily_transport.no_previous_day_found_to_copy_from"));
      return;
    }
    const prevDate = prev[0].transport_date as string;
    const { data, error } = await supabase
      .from("daily_transports")
      .select("*")
      .eq("project_id", activeProjectId)
      .eq("transport_date", prevDate)
      .order("pickup_time", { ascending: true, nullsFirst: false });
    if (error || !data || data.length === 0) {
      setCopying(false);
      toast.error(t("daily_transport.previous_day_has_no_movements"));
      return;
    }
    const cloned: Row[] = data.map((r: any) => ({
      pickup_time: (r.pickup_time ?? "").slice(0, 5),
      passenger_ids: r.passenger_ids ?? [],
      pickup_location: r.pickup_location ?? "",
      dropoff_location: r.dropoff_location ?? "",
      car_rental_id: r.car_rental_id ?? null,
      vehicle_label: r.vehicle_label ?? null,
      driver_person_id: r.driver_person_id ?? null,
      driver_name: r.driver_name ?? null,
      notes: r.notes ?? "",
      dirty: true,
    }));
    setRows((prevRows) => [...prevRows.filter((r) => r.id), ...cloned]);
    setCopying(false);
    toast.success(
      `Copied ${cloned.length} movement(s) from ${formatDateDMY(prevDate)} — review and Save each row`,
    );
  };

  // ---------- Exports ----------
  const exportRows = () =>
    rows.map((r) => ({
      "Pick-up Time": r.pickup_time || "",
      Passengers: passengerNames(r.passenger_ids),
      "Pick-up Location": r.pickup_location || "",
      "Drop-off Location": r.dropoff_location || "",
      Vehicle: r.vehicle_label || "",
      Driver: r.driver_name || "",
      Notes: r.notes || "",
    }));

  const exportExcel = async () => {
    if (rows.length === 0) {
      toast.error(t("daily_transport.nothing_to_export"));
      return;
    }
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(exportRows());
    ws["!cols"] = [
      { wch: 10 },
      { wch: 32 },
      { wch: 28 },
      { wch: 28 },
      { wch: 28 },
      { wch: 20 },
      { wch: 24 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transport Sheet");
    XLSX.writeFile(wb, `transport-${transportDate}.xlsx`);
  };

  const exportPDF = async () => {
    if (rows.length === 0) {
      toast.error(t("daily_transport.nothing_to_export"));
      return;
    }
    const { jsPDF, autoTable } = await loadPdf();
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(`Daily Transport Sheet — ${projectName}`, 14, 14);
    doc.setFontSize(10);
    doc.text(`Date: ${formatDateDMY(transportDate)}`, 14, 21);
    autoTable(doc, {
      startY: 26,
      head: [["Time", "Passengers", "Pick-up", "Drop-off", "Vehicle", "Driver", "Notes"]],
      body: exportRows().map((r) => Object.values(r)),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    doc.save(`transport-${transportDate}.pdf`);
  };

  if (!activeProjectId) {
    return (
      <div className="p-6">
        <PageTitle title={t("daily_transport.daily_transport_sheet")} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageTitle title={t("daily_transport.daily_transport_sheet")} />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <RouteIcon className="size-5 text-brand" />
            <label className="text-sm text-muted-foreground">
              {t("daily_transport.shoot_day")}
            </label>
            <input
              type="date"
              value={transportDate}
              onChange={(e) => setTransportDate(e.target.value)}
              className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
            />
            <span className="text-xs text-muted-foreground">
              {rows.length} movement{rows.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyFromPrevious}
              disabled={copying}
              title={t("daily_transport.duplicate_all_movements_from_the_previous_day")}
              className="inline-flex items-center gap-1 rounded-lg bg-info/20 hover:bg-info/30 text-info px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {copying ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Copy className="size-3.5" />
              )}
              Copy from previous day
            </button>
            <button
              onClick={() => run("xlsx", exportExcel)}
              disabled={isPending("xlsx")}
              className="inline-flex items-center gap-1 rounded-lg bg-success/20 hover:bg-success/30 text-success px-3 py-1.5 text-xs font-medium"
            >
              {isPending("xlsx") ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-3.5" />
              )}{" "}
              Excel
            </button>
            <button
              onClick={() => run("pdf", exportPDF)}
              disabled={isPending("pdf")}
              className="inline-flex items-center gap-1 rounded-lg bg-destructive/20 hover:bg-destructive/30 text-destructive px-3 py-1.5 text-xs font-medium"
            >
              {isPending("pdf") ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileText className="size-3.5" />
              )}{" "}
              PDF
            </button>
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1 rounded-lg bg-brand/90 hover:bg-brand text-white px-3 py-1.5 text-xs font-medium"
            >
              <Plus className="size-3" />
              {t("daily_transport.add_movement")}
            </button>
          </div>
        </div>

        {conflictIdxs.size > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>
              Time conflict detected: the same vehicle or driver is assigned to overlapping trips
              within 90 minutes. Review the highlighted rows below.
            </span>
          </div>
        )}

        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No transports for {formatDateDMY(transportDate)}. Click "Add Movement" to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table w-full">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  {["Time", "Passengers", "Pick-up", "Drop-off", "Vehicle & Driver", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-xs uppercase tracking-wider font-medium"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={row.id ?? `new-${idx}`}
                    className={`border-b border-border align-top ${conflictIdxs.has(idx) ? "bg-warning/10 ring-1 ring-warning/40" : ""}`}
                    title={
                      conflictIdxs.has(idx)
                        ? "Vehicle/driver time conflict with another row"
                        : undefined
                    }
                  >
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        value={row.pickup_time}
                        onChange={(e) => update(idx, { pickup_time: e.target.value })}
                        className="w-28 bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                      />
                    </td>
                    <td className="px-3 py-2 min-w-[220px]">
                      <PassengerPicker
                        options={activePeople.map((p) => ({
                          id: p.id,
                          name: p.fullName,
                          subtitle:
                            p.kind === "cast" ? p.character || "Cast" : p.position || "Crew",
                        }))}
                        selected={row.passenger_ids}
                        onToggle={(id) => togglePassenger(idx, id)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.pickup_location}
                        onChange={(e) => update(idx, { pickup_location: e.target.value })}
                        placeholder={t("daily_transport.hotel_airport_set")}
                        className="w-48 bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.dropoff_location}
                        onChange={(e) => update(idx, { dropoff_location: e.target.value })}
                        placeholder={t("daily_transport.location_set")}
                        className="w-48 bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.car_rental_id ?? ""}
                        onChange={(e) => selectCar(idx, e.target.value)}
                        className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand min-w-[200px]"
                      >
                        <option value="">— Select vehicle —</option>
                        {cars.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.make_model} — {c.license_plate}
                          </option>
                        ))}
                      </select>
                      {row.driver_name && (
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Driver:{" "}
                          <span className="font-medium text-foreground">{row.driver_name}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        disabled={!row.dirty || savingIdx === idx}
                        onClick={() => save(idx)}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand/90 hover:bg-brand text-white px-3 py-1.5 text-xs font-medium disabled:opacity-40 mr-1"
                      >
                        {savingIdx === idx ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Save className="size-3" />
                        )}
                        Save
                      </button>
                      <button
                        onClick={() => remove(idx)}
                        className="inline-flex items-center gap-1 rounded-lg bg-destructive/20 hover:bg-destructive/30 text-destructive px-2 py-1.5 text-xs font-medium"
                        aria-label="Delete"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function PassengerPicker({
  options,
  selected,
  onToggle,
}: {
  options: { id: string; name: string; subtitle?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  const selectedOpts = options.filter((o) => selected.includes(o.id));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[32px] flex items-center flex-wrap gap-1 bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm text-left outline-none focus:ring-2 ring-brand"
      >
        {selectedOpts.length === 0 ? (
          <span className="text-muted-foreground">Select passengers…</span>
        ) : (
          selectedOpts.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 rounded-md bg-brand/20 border border-brand/40 text-brand px-1.5 py-0.5 text-[11px]"
            >
              {o.name}
              <X
                className="size-3 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(o.id);
                }}
              />
            </span>
          ))
        )}
        <ChevronDown className="size-3 text-muted-foreground ml-auto" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("daily_transport.search")}
              className="w-full bg-card border border-border rounded px-2 py-1 text-xs outline-none focus:border-brand text-foreground"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-xs text-muted-foreground px-3 py-3">
                {t("daily_transport.no_matches")}
              </div>
            ) : (
              filtered.map((o) => {
                const checked = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onToggle(o.id)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left text-foreground hover:bg-muted ${checked ? "bg-card/[0.06]" : ""}`}
                  >
                    <span>
                      <span className="font-medium">{o.name}</span>
                      {o.subtitle && (
                        <span className="text-muted-foreground ml-1">· {o.subtitle}</span>
                      )}
                    </span>
                    {checked && <span className="text-brand">✓</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
