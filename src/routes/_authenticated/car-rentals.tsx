import { createFileRoute } from "@tanstack/react-router";
import { formatAmount } from "@/lib/format-number";
import { DateInput } from "@/components/ui/date-input";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { Car, Plus, Save, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/SearchableSelect";
import { rentalTotal } from "@/lib/ap-calc";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/car-rentals")({
  component: () => (
    <AppShell>
      <CarRentalsPage />
    </AppShell>
  ),
});

type RateType = "daily" | "monthly";

type Row = {
  id?: string;
  make_model: string;
  license_plate: string;
  vendor_id: string | null;
  vendor_name: string | null;
  driver_person_id: string | null;
  driver_name: string | null;
  rate_type: RateType;
  daily_rate: number;
  monthly_rate: number;
  currency: string;
  rental_start_date: string;
  rental_end_date: string;
  invoice_id: string | null;
  reconciled_at: string | null;
  notes: string;
  /** B20: the budget line the rental is charged to (commitment until invoiced). */
  linked_budget_line_id: string | null;
  budget_code: string | null;
  dirty?: boolean;
  isNew?: boolean;
};

const emptyRow = (): Row => ({
  make_model: "",
  license_plate: "",
  vendor_id: null,
  vendor_name: null,
  driver_person_id: null,
  driver_name: null,
  rate_type: "daily",
  daily_rate: 0,
  monthly_rate: 0,
  currency: "SAR",
  rental_start_date: "",
  rental_end_date: "",
  invoice_id: null,
  reconciled_at: null,
  notes: "",
  linked_budget_line_id: null,
  budget_code: null,
  dirty: true,
  isNew: true,
});

/** Rental commitment across the booked period (same formula as car_rentals.total_amount). */
const commitmentFor = (row: Row): number => rentalTotal(row);

function CarRentalsPage() {
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const vendors = useStore((s) => s.vendors);
  const people = useStore((s) => s.people);
  const invoices = useStore((s) => s.invoices);
  const budget = useStore((s) => s.budget);
  const orgId = useStore(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.organizationId ?? null,
  );
  const budgetOptions = useMemo(
    () =>
      budget
        .filter((l) => !l.excluded)
        .map((l) => ({ value: l.id, code: l.mainCode, label: l.description })),
    [budget],
  );

  // Only people flagged as production drivers on their contract may be assigned to a vehicle.
  const activeDrivers = useMemo(
    () => people.filter((p) => p.contractStatus === "Active" && p.isDriver),
    [people],
  );

  // Rental commitments reconcile against AP invoices from the same rental vendor.
  const vendorInvoices = (vendorId: string | null) => {
    const name = vendors.find((v) => v.id === vendorId)?.name ?? null;
    return (invoices ?? []).filter((i) => !name || i.vendorName === name);
  };

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("car_rentals")
        .select("*")
        .eq("project_id", activeProjectId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error(t("car_rentals.failed_to_load_car_rentals"));
        setLoading(false);
        return;
      }
      setRows(
        (data ?? []).map((r: any): Row => ({
          id: r.id,
          make_model: r.make_model ?? "",
          license_plate: r.license_plate ?? "",
          vendor_id: r.vendor_id ?? null,
          vendor_name: r.vendor_name ?? null,
          driver_person_id: r.driver_person_id ?? null,
          driver_name: r.driver_name ?? null,
          rate_type: (r.rate_type === "monthly" ? "monthly" : "daily") as RateType,
          daily_rate: Number(r.daily_rate ?? 0),
          monthly_rate: Number(r.monthly_rate ?? 0),
          currency: r.currency ?? "SAR",
          rental_start_date: r.rental_start_date ?? "",
          rental_end_date: r.rental_end_date ?? "",
          invoice_id: r.invoice_id ?? null,
          reconciled_at: r.reconciled_at ?? null,
          notes: r.notes ?? "",
          linked_budget_line_id: r.linked_budget_line_id ?? null,
          budget_code: r.budget_code ?? null,
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const update = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch, dirty: true } : r)));
  };

  const addRow = () => setRows((prev) => [emptyRow(), ...prev]);

  const save = async (idx: number) => {
    if (!activeProjectId) return;
    const row = rows[idx];
    if (!row) return;
    if (!row.make_model.trim() || !row.license_plate.trim()) {
      toast.error(t("car_rentals.makemodel_and_license_plate_are_required"));
      return;
    }
    if (
      row.rental_start_date &&
      row.rental_end_date &&
      row.rental_end_date < row.rental_start_date
    ) {
      toast.error(t("car_rentals.end_date_cannot_be_before_start_date"));
      return;
    }
    const plate = row.license_plate.trim().toUpperCase();
    const duplicate = rows.some(
      (r, i) => i !== idx && r.license_plate.trim().toUpperCase() === plate,
    );
    if (duplicate) {
      toast.error(`License plate "${plate}" is already registered on this project`);
      return;
    }
    if (!row.linked_budget_line_id && !row.budget_code) {
      toast.error(t("ap.budget_line_required"));
      return;
    }
    setSavingIdx(idx);
    const line = budget.find((l) => l.id === row.linked_budget_line_id);
    const payload = {
      project_id: activeProjectId,
      organization_id: orgId,
      linked_budget_line_id: row.linked_budget_line_id,
      budget_code: line?.mainCode ?? row.budget_code,
      make_model: row.make_model.trim(),
      license_plate: plate,
      vendor_id: row.vendor_id,
      vendor_name: row.vendor_name,
      driver_person_id: row.driver_person_id,
      driver_name: row.driver_name,
      rate_type: row.rate_type,
      daily_rate: row.daily_rate || 0,
      monthly_rate: row.monthly_rate || 0,
      currency: row.currency || "SAR",
      rental_start_date: row.rental_start_date || null,
      rental_end_date: row.rental_end_date || null,
      invoice_id: row.invoice_id,
      notes: row.notes || null,
    };
    let error;
    if (row.id) {
      ({ error } = await supabase
        .from("car_rentals")
        .update(payload as any)
        .eq("id", row.id));
    } else {
      const res = await supabase
        .from("car_rentals")
        .insert(payload as any)
        .select("id")
        .single();
      error = res.error;
      if (!error && res.data) {
        setRows((prev) =>
          prev.map((r, i) =>
            i === idx ? { ...r, id: res.data.id, dirty: false, isNew: false } : r,
          ),
        );
      }
    }
    setSavingIdx(null);
    if (error) {
      // Postgres unique-violation code = 23505
      if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
        toast.error(`License plate "${plate}" is already registered on this project`);
      } else {
        toast.error(`Save failed: ${error.message}`);
      }
    } else {
      toast.success(t("car_rentals.car_rental_saved"));
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, dirty: false, isNew: false } : r)));
    }
  };

  const remove = async (idx: number) => {
    const row = rows[idx];
    if (!row) return;
    if (!row.id) {
      setRows((prev) => prev.filter((_, i) => i !== idx));
      return;
    }
    if (!confirm(`Delete rental "${row.make_model} — ${row.license_plate}"?`)) return;
    const { error } = await supabase.from("car_rentals").delete().eq("id", row.id);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
    toast.success("Deleted");
  };

  if (!activeProjectId) {
    return (
      <div className="p-6">
        <PageTitle title={t("car_rentals.car_rentals")} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageTitle title={t("car_rentals.car_rentals")} />
      <Panel>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Car className="size-5 text-brand" />
            <div className="text-sm text-muted-foreground">
              {rows.length} vehicle{rows.length === 1 ? "" : "s"} on this project
            </div>
          </div>
          <button
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded-lg bg-brand/90 hover:bg-brand text-white px-3 py-1.5 text-xs font-medium"
          >
            <Plus className="size-3" />
            {t("car_rentals.add_vehicle")}
          </button>
        </div>

        {loading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No rentals yet. Click "Add Vehicle" to register the first one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="app-table w-full">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  {[
                    "Make & Model",
                    "License Plate",
                    "Vendor",
                    "Driver",
                    t("ap.budget_line"),
                    "Rate Type",
                    "Rate",
                    "Start",
                    "End",
                    "Commitment",
                    "AP Invoice",
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
                {rows.map((row, idx) => (
                  <tr key={row.id ?? `new-${idx}`} className="border-b border-border">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.make_model}
                        onChange={(e) => update(idx, { make_model: e.target.value })}
                        placeholder={t("car_rentals.eg_gmc_yukon")}
                        className="w-full bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.license_plate}
                        onChange={(e) =>
                          update(idx, { license_plate: e.target.value.toUpperCase() })
                        }
                        placeholder={t("car_rentals.abc1234")}
                        className="w-28 bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm font-mono outline-none focus:ring-2 ring-brand"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.vendor_id ?? ""}
                        onChange={(e) => {
                          const v = vendors.find((x) => x.id === e.target.value);
                          update(idx, { vendor_id: v?.id ?? null, vendor_name: v?.name ?? null });
                        }}
                        className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand min-w-[140px]"
                      >
                        <option value="">— Select —</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.driver_person_id ?? ""}
                        onChange={(e) => {
                          const p = activeDrivers.find((x) => x.id === e.target.value);
                          update(idx, {
                            driver_person_id: p?.id ?? null,
                            driver_name: p?.fullName ?? null,
                          });
                        }}
                        className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand min-w-[140px]"
                      >
                        <option value="">— Unassigned —</option>
                        {activeDrivers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.fullName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 min-w-[200px]">
                      <SearchableSelect
                        value={row.linked_budget_line_id ?? ""}
                        onChange={(v) => {
                          const l = budget.find((x) => x.id === v);
                          update(idx, {
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
                      <div
                        className="inline-flex rounded-lg border border-border overflow-hidden text-xs"
                        role="group"
                        aria-label={t("car_rentals.rate_type")}
                      >
                        {(["daily", "monthly"] as RateType[]).map((t) => (
                          <button
                            key={t}
                            type="button"
                            aria-pressed={row.rate_type === t}
                            onClick={() => update(idx, { rate_type: t })}
                            className={`px-2.5 py-1 font-medium capitalize ${row.rate_type === t ? "bg-brand text-white" : "bg-surface-2 text-muted-foreground hover:bg-muted"}`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        aria-label={row.rate_type === "monthly" ? "Monthly rate" : "Daily rate"}
                        value={row.rate_type === "monthly" ? row.monthly_rate : row.daily_rate}
                        onChange={(e) =>
                          update(
                            idx,
                            row.rate_type === "monthly"
                              ? { monthly_rate: Number(e.target.value) || 0 }
                              : { daily_rate: Number(e.target.value) || 0 },
                          )
                        }
                        className="w-24 bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm text-end outline-none focus:ring-2 ring-brand"
                        dir="ltr"
                      />
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {row.currency}/{row.rate_type === "monthly" ? "mo" : "day"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <DateInput
                        value={row.rental_start_date}
                        onChange={(v) => update(idx, { rental_start_date: v })}
                        className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <DateInput
                        value={row.rental_end_date}
                        onChange={(v) => update(idx, { rental_end_date: v })}
                        className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand"
                      />
                    </td>
                    <td className="px-3 py-2 text-end font-mono tabular-nums text-sm whitespace-nowrap">
                      {formatAmount(commitmentFor(row), 2)} {row.currency}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={t("car_rentals.reconcile_against_ap_invoice")}
                        value={row.invoice_id ?? ""}
                        onChange={(e) => update(idx, { invoice_id: e.target.value || null })}
                        className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 ring-brand min-w-[150px]"
                      >
                        <option value="">— Not reconciled —</option>
                        {vendorInvoices(row.vendor_id).map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.invoiceNo || inv.id.slice(0, 6)} ·{" "}
                            {formatAmount(Number(inv.price), 2)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-end whitespace-nowrap">
                      <button
                        disabled={!row.dirty || savingIdx === idx}
                        onClick={() => save(idx)}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand/90 hover:bg-brand text-white px-3 py-1.5 text-xs font-medium disabled:opacity-40 me-1"
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
                        aria-label={t("car_rentals.delete_rental")}
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
