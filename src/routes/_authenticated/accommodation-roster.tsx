import { createFileRoute } from "@tanstack/react-router";
import { formatAmount } from "@/lib/format-number";
import { DateInput } from "@/components/ui/date-input";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { LodgingSetupPanel } from "@/components/LodgingSetupPanel";
import { useLodging } from "@/lib/lodging";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { BedDouble, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/SearchableSelect";
import { stayNights, stayTotal } from "@/lib/ap-calc";

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
  /** B20: hotel vendor from the vendor list, nightly rate, budget line, invoice. */
  vendor_id: string | null;
  vendor_name: string | null;
  nightly_rate: number;
  currency: string;
  linked_budget_line_id: string | null;
  budget_code: string | null;
  invoice_id: string | null;
  dirty?: boolean;
};

const emptyStay = (personId: string): Row => ({
  person_id: personId,
  hotel_name: "",
  property_id: null,
  room_type_id: null,
  room_number: "",
  check_in_date: "",
  check_out_date: "",
  vendor_id: null,
  vendor_name: null,
  nightly_rate: 0,
  currency: "SAR",
  linked_budget_line_id: null,
  budget_code: null,
  invoice_id: null,
});

function AccommodationRosterPage() {
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const people = useStore((s) => s.people);
  const vendors = useStore((s) => s.vendors);
  const invoices = useStore((s) => s.invoices);
  const budget = useStore((s) => s.budget);
  const budgetOptions = useMemo(
    () =>
      budget
        .filter((l) => !l.excluded)
        .map((l) => ({ value: l.id, code: l.mainCode, label: l.description })),
    [budget],
  );
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
          vendor_id: r.vendor_id ?? null,
          vendor_name: r.vendor_name ?? null,
          nightly_rate: Number(r.nightly_rate ?? 0),
          currency: r.currency ?? "SAR",
          linked_budget_line_id: r.linked_budget_line_id ?? null,
          budget_code: r.budget_code ?? null,
          invoice_id: r.invoice_id ?? null,
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
      const existing: Row = prev[personId] ?? emptyStay(personId);
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
    const nights = stayNights(row.check_in_date, row.check_out_date);
    if (nights > 0 && row.nightly_rate > 0 && !row.linked_budget_line_id && !row.budget_code) {
      toast.error(t("ap.budget_line_required"));
      return;
    }
    setSavingId(personId);
    const line = budget.find((l) => l.id === row.linked_budget_line_id);
    const payload = {
      vendor_id: row.vendor_id,
      vendor_name: row.vendor_name,
      nightly_rate: row.nightly_rate || 0,
      currency: row.currency || "SAR",
      linked_budget_line_id: row.linked_budget_line_id,
      budget_code: line?.mainCode ?? row.budget_code,
      invoice_id: row.invoice_id,
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
      ({ error } = await supabase
        .from("accommodations")
        .update(payload as any)
        .eq("id", row.id));
    } else {
      const res = await supabase
        .from("accommodations")
        .insert(payload as any)
        .select("id")
        .single();
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
                    t("ap.hotel_vendor"),
                    t("ap.rate_per_night"),
                    t("ap.nights_total"),
                    t("ap.budget_line"),
                    t("ap.invoice"),
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-start text-xs uppercase tracking-wider font-medium"
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
                              const v = prop
                                ? vendors.find(
                                    (x) =>
                                      x.name.trim().toLowerCase() ===
                                      prop.name.trim().toLowerCase(),
                                  )
                                : undefined;
                              update(p.id, {
                                property_id: prop?.id ?? null,
                                hotel_name: prop?.name ?? "",
                                room_type_id: null,
                                ...(v && !row?.vendor_id
                                  ? { vendor_id: v.id, vendor_name: v.name }
                                  : {}),
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
                          onChange={(e) => {
                            const rt = roomTypes.find((r) => r.id === e.target.value);
                            update(p.id, {
                              room_type_id: e.target.value || null,
                              ...(rt
                                ? {
                                    nightly_rate: Number(rt.nightly_rate) || 0,
                                    currency: rt.currency,
                                  }
                                : {}),
                            });
                          }}
                          disabled={!row?.property_id}
                          className="min-w-[130px] bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand disabled:opacity-40"
                        >
                          <option value="">—</option>
                          {propRooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} · {formatAmount(r.nightly_rate, 2)} {r.currency}
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
                        <DateInput
                          value={row?.check_in_date ?? ""}
                          onChange={(v) => update(p.id, { check_in_date: v })}
                          className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <DateInput
                          value={row?.check_out_date ?? ""}
                          onChange={(v) => update(p.id, { check_out_date: v })}
                          className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row?.vendor_id ?? ""}
                          aria-label={t("ap.hotel_vendor")}
                          onChange={(e) => {
                            const v = vendors.find((x) => x.id === e.target.value);
                            update(p.id, {
                              vendor_id: v?.id ?? null,
                              vendor_name: v?.name ?? null,
                            });
                          }}
                          className="min-w-[140px] bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                        >
                          <option value="">{t("ap.select_vendor")}</option>
                          {vendors.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          dir="ltr"
                          aria-label={t("ap.rate_per_night")}
                          value={row?.nightly_rate ?? 0}
                          onChange={(e) =>
                            update(p.id, { nightly_rate: Number(e.target.value) || 0 })
                          }
                          className="w-24 bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm text-end outline-none focus:ring-2 ring-brand"
                        />
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {row?.currency ?? "SAR"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-sm whitespace-nowrap">
                        {(() => {
                          const n = stayNights(row?.check_in_date, row?.check_out_date);
                          return (
                            <>
                              <div>
                                {formatAmount(stayTotal(n, row?.nightly_rate ?? 0), 2)}{" "}
                                {row?.currency ?? "SAR"}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {t("ap.nights_count", { count: n })}
                              </div>
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 min-w-[200px]">
                        <SearchableSelect
                          value={row?.linked_budget_line_id ?? ""}
                          onChange={(v) => {
                            const l = budget.find((x) => x.id === v);
                            update(p.id, {
                              linked_budget_line_id: v || null,
                              budget_code: l?.mainCode ?? null,
                            });
                          }}
                          options={budgetOptions}
                          placeholder={t("purchase_orders.select_budget_line")}
                          searchPlaceholder={t("ap.search_budget_line")}
                          ariaLabel={t("ap.budget_line")}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={t("ap.invoice")}
                          value={row?.invoice_id ?? ""}
                          onChange={(e) => update(p.id, { invoice_id: e.target.value || null })}
                          className="min-w-[140px] bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                        >
                          <option value="">{t("ap.not_invoiced")}</option>
                          {invoices
                            .filter(
                              (inv) => !row?.vendor_name || inv.vendorName === row.vendor_name,
                            )
                            .map((inv) => (
                              <option key={inv.id} value={inv.id}>
                                {inv.invoiceNo || inv.id.slice(0, 6)} ·{" "}
                                {formatAmount(Number(inv.price), 2)}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-end">
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
