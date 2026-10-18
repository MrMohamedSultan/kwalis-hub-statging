import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  MapPin,
  Plus,
  X as XIcon,
  Pencil,
  Trash2,
  RotateCcw,
  Loader2,
  Upload,
  FileText,
} from "lucide-react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useStore, formatUSD } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import { useAuthRoles } from "@/lib/auth-roles";
import { PermissionDeniedBanner } from "@/lib/permission-guard";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/locations")({
  component: () => (
    <AppShell>
      <LocationsPage />
    </AppShell>
  ),
});

type Location = {
  id: string;
  project_id: string;
  organization_id: string | null;
  name: string;
  address: string | null;
  city: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  daily_rate: number;
  currency: string;
  permit_status: "None" | "Requested" | "Pending" | "Approved" | "Rejected" | "Expired";
  permit_expiry: string | null;
  shoot_days: number;
  linked_budget_line_id: string | null;
  notes: string | null;
  owner_nationality?: "Saudi" | "Non-Saudi" | null;
  vat_registered?: boolean | null;
  tax_number?: string | null;
  contract_doc_path?: string | null;
  contract_doc_url?: string | null;
  created_at: string;
  updated_at: string;
};

const PERMIT_STATUSES = [
  "None",
  "Requested",
  "Pending",
  "Approved",
  "Rejected",
  "Expired",
] as const;

function LocationsPage() {
  const { t } = useTranslation();

  const roles = useAuthRoles();
  const can = useCan();
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const budget = useStore((s) => s.budget);
  const projectId = activeProject?.id ?? null;
  const orgId = activeProject?.organizationId ?? null;

  const [rows, setRows] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<Location | "new" | null>(null);

  const budgetLines = useMemo(
    () =>
      budget
        .filter((l) => !l.excluded)
        .map((l) => ({ id: l.id, code: l.mainCode, desc: l.description })),
    [budget],
  );

  async function reload() {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("locations")
      .select("*")
      .eq("project_id", projectId)
      .order("name");
    if (error) toast.error(error.message);
    setRows((data ?? []) as unknown as Location[]);
    setLoading(false);
  }

  useEffect(() => {
    if (projectId && roles.loaded) void reload();
  }, [projectId, roles.loaded]);

  // Wait for auth/role state to fully resolve before evaluating permissions —
  // prevents the 403 banner from flashing during hydration.
  if (!roles.loaded) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-5 animate-spin me-2" /> Loading locations…
      </div>
    );
  }
  // Locations is a production-logistics module; gate on the same permission
  // used elsewhere in Production Entities. Fall back gracefully if absent.
  if (!can("crew.manage"))
    return <PermissionDeniedBanner perm="crew.manage" action="View Locations" />;
  if (!projectId)
    return (
      <div className="p-6 text-muted-foreground">{t("locations.select_an_active_project")}</div>
    );

  const totalCost = rows.reduce(
    (s, r) => s + (Number(r.daily_rate) || 0) * (Number(r.shoot_days) || 0),
    0,
  );
  const approvedCount = rows.filter((r) => r.permit_status === "Approved").length;

  return (
    <>
      <PageTitle
        title={t("locations.locations_management")}
        action={
          <button
            onClick={() => setEditor("new")}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:opacity-90"
          >
            <Plus className="size-4" />
            {t("locations.new_location")}
          </button>
        }
      />

      <div className="grid gap-3 md:grid-cols-3 mb-6">
        {[
          {
            label: "Total Locations",
            value: String(rows.length),
            tone: "from-info/20 to-info/5 border-info/30",
          },
          {
            label: "Permits Approved",
            value: `${approvedCount} / ${rows.length}`,
            tone: "from-success/20 to-success/5 border-success/30",
          },
          {
            label: "Projected Location Cost",
            value: formatUSD(totalCost),
            tone: "from-warning/20 to-warning/5 border-warning/30",
          },
        ].map((c) => (
          <div key={c.label} className={`rounded-2xl border bg-gradient-to-br p-4 ${c.tone}`}>
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <MapPin className="size-4" />
              {c.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-surface/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-semibold flex items-center justify-between">
          <span>Locations</span>
          <button
            onClick={reload}
            className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Refresh
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-start p-3">Name</th>
              <th className="text-start p-3">{t("locations.city")}</th>
              <th className="text-start p-3">Nationality</th>
              <th className="text-start p-3">Contact</th>
              <th className="text-end p-3">Daily Rate</th>
              <th className="text-end p-3">{t("locations.shoot_days")}</th>
              <th className="text-end p-3">{t("locations.est_cost")}</th>
              <th className="text-start p-3">Permit</th>
              <th className="text-start p-3">Tax</th>
              <th className="text-start p-3">Contract</th>
              <th className="text-start p-3">{t("locations.budget_line")}</th>
              <th className="text-end p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={12} className="p-4 text-center text-muted-foreground">
                  <Loader2 className="size-4 animate-spin inline me-2" />
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => {
                const line = budgetLines.find((l) => l.id === r.linked_budget_line_id);
                const est = (Number(r.daily_rate) || 0) * (Number(r.shoot_days) || 0);
                const contractHref =
                  r.contract_doc_url ||
                  (r.contract_doc_path
                    ? supabase.storage.from("project-documents").getPublicUrl(r.contract_doc_path)
                        .data.publicUrl
                    : null);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-3 font-semibold">{r.name}</td>
                    <td className="p-3 text-muted-foreground">{r.city ?? "—"}</td>
                    <td className="p-3 text-xs">
                      {r.owner_nationality ? (
                        <span
                          className={`px-2 py-0.5 rounded-full ${r.owner_nationality === "Saudi" ? "bg-success/20 text-success" : "bg-info/20 text-info"}`}
                        >
                          {r.owner_nationality}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {r.contact_name ?? "—"}
                      {r.contact_phone ? ` · ${r.contact_phone}` : ""}
                    </td>
                    <td className="p-3 text-end tabular-nums">
                      {formatUSD(Number(r.daily_rate) || 0)}
                    </td>
                    <td className="p-3 text-end tabular-nums">{r.shoot_days}</td>
                    <td className="p-3 text-end tabular-nums font-semibold">{formatUSD(est)}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                          r.permit_status === "Approved"
                            ? "bg-success/20 text-success"
                            : r.permit_status === "Rejected" || r.permit_status === "Expired"
                              ? "bg-destructive/20 text-destructive"
                              : r.permit_status === "None"
                                ? "bg-surface-2 text-muted-foreground"
                                : "bg-warning/20 text-warning"
                        }`}
                      >
                        {r.permit_status}
                      </span>
                    </td>
                    <td className="p-3 text-xs">
                      {r.vat_registered ? (
                        <span
                          title={r.tax_number ?? ""}
                          className="px-2 py-0.5 rounded-full bg-info/20 text-info"
                        >
                          VAT · {r.tax_number || "—"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {contractHref ? (
                        <a
                          href={contractHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <FileText className="size-3" />
                          View
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {line ? `${line.code} — ${line.desc}` : "—"}
                    </td>
                    <td className="p-3 text-end space-x-1">
                      <button
                        onClick={() => setEditor(r)}
                        className="text-xs px-2 py-1 rounded-lg bg-surface-2 hover:bg-muted inline-flex items-center gap-1"
                      >
                        <Pencil className="size-3" />
                        Edit
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete location "${r.name}"?`)) return;
                          const { error } = await supabase
                            .from("locations")
                            .delete()
                            .eq("id", r.id);
                          if (error) toast.error(error.message);
                          else {
                            toast.success("Deleted");
                            void reload();
                          }
                        }}
                        className="text-xs px-2 py-1 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive inline-flex items-center gap-1"
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={12} className="p-6 text-center text-muted-foreground">
                  {t("locations.no_locations_yet")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editor && (
        <LocationForm
          initial={editor === "new" ? null : editor}
          budgetLines={budgetLines}
          projectId={projectId}
          onClose={() => setEditor(null)}
          onSave={async (v) => {
            const payload: any = {
              project_id: projectId,
              organization_id: orgId,
              name: v.name,
              address: v.address || null,
              city: v.city || null,
              contact_name: v.contact_name || null,
              contact_phone: v.contact_phone || null,
              contact_email: v.contact_email || null,
              daily_rate: v.daily_rate,
              currency: "USD",
              permit_status: v.permit_status,
              permit_expiry: v.permit_expiry || null,
              shoot_days: v.shoot_days,
              linked_budget_line_id: v.linked_budget_line_id || null,
              notes: v.notes || null,
              owner_nationality: v.owner_nationality,
              vat_registered: v.vat_registered,
              tax_number: v.vat_registered ? v.tax_number || null : null,
              contract_doc_path: v.contract_doc_path || null,
              contract_doc_url: v.contract_doc_url || null,
            };
            if (editor !== "new" && editor) {
              const { error } = await supabase
                .from("locations")
                .update(payload)
                .eq("id", editor.id);
              if (error) return toast.error(error.message);
              toast.success(t("locations.location_updated"));
            } else {
              const { error } = await supabase.from("locations").insert(payload);
              if (error) return toast.error(error.message);
              toast.success(t("locations.location_added"));
            }
            setEditor(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

type FormValues = {
  name: string;
  address: string;
  city: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  daily_rate: number;
  permit_status: Location["permit_status"];
  permit_expiry: string;
  shoot_days: number;
  linked_budget_line_id: string;
  notes: string;
  owner_nationality: "Saudi" | "Non-Saudi";
  vat_registered: boolean;
  tax_number: string;
  contract_doc_path: string;
  contract_doc_url: string;
};

function LocationForm({
  initial,
  budgetLines,
  projectId,
  onClose,
  onSave,
}: {
  initial: Location | null;
  budgetLines: { id: string; code: string; desc: string }[];
  projectId: string;
  onClose: () => void;
  onSave: (v: FormValues) => void;
}) {
  const { t } = useTranslation();

  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [contactName, setContactName] = useState(initial?.contact_name ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.contact_phone ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contact_email ?? "");
  const [dailyRate, setDailyRate] = useState(initial ? Number(initial.daily_rate) : 0);
  const [permit, setPermit] = useState<Location["permit_status"]>(initial?.permit_status ?? "None");
  const [permitExpiry, setPermitExpiry] = useState(initial?.permit_expiry ?? "");
  const [shootDays, setShootDays] = useState(initial?.shoot_days ?? 0);
  const [lineId, setLineId] = useState(initial?.linked_budget_line_id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [nationality, setNationality] = useState<"Saudi" | "Non-Saudi">(
    initial?.owner_nationality ?? "Saudi",
  );
  const [vatRegistered, setVatRegistered] = useState<boolean>(!!initial?.vat_registered);
  const [taxNumber, setTaxNumber] = useState(initial?.tax_number ?? "");
  const [contractPath, setContractPath] = useState(initial?.contract_doc_path ?? "");
  const [contractUrl, setContractUrl] = useState(initial?.contract_doc_url ?? "");
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const key = `locations/${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("project-documents")
        .upload(key, file, { upsert: false });
      if (error) throw error;
      setContractPath(key);
      toast.success(t("locations.contract_uploaded"));
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-border bg-background p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <MapPin className="size-4" />
            {initial ? "Edit Location" : "New Location"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <XIcon className="size-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return toast.error(t("locations.name_is_required"));
            if (vatRegistered && !taxNumber.trim())
              return toast.error(t("locations.tax_number_is_required_when_vat_registered"));
            onSave({
              name,
              address,
              city,
              contact_name: contactName,
              contact_phone: contactPhone,
              contact_email: contactEmail,
              daily_rate: dailyRate,
              permit_status: permit,
              permit_expiry: permitExpiry,
              shoot_days: shootDays,
              linked_budget_line_id: lineId,
              notes,
              owner_nationality: nationality,
              vat_registered: vatRegistered,
              tax_number: taxNumber,
              contract_doc_path: contractPath,
              contract_doc_url: contractUrl,
            });
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
                required
              />
            </Field>
            <Field label="City">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
            />
          </Field>

          {/* Compliance — Rebate */}
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("locations.compliance_rebate")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner Nationality *">
                <select
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value as "Saudi" | "Non-Saudi")}
                  className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
                  required
                >
                  <option value="Saudi">Saudi</option>
                  <option value="Non-Saudi">Non-Saudi</option>
                </select>
              </Field>
              <Field label="Tax Status">
                <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-background border border-border">
                  <input
                    type="checkbox"
                    checked={vatRegistered}
                    onChange={(e) => setVatRegistered(e.target.checked)}
                  />
                  {t("locations.vat_registered")}
                </label>
              </Field>
            </div>
            {vatRegistered && (
              <Field label="Tax Number *">
                <input
                  value={taxNumber}
                  onChange={(e) => setTaxNumber(e.target.value)}
                  className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
                  required
                  placeholder={t("locations.15digit_vat_tax_number")}
                />
              </Field>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Contact Name">
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Phone">
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Daily Rate (USD)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={dailyRate}
                onChange={(e) => setDailyRate(Number(e.target.value))}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Shoot Days">
              <input
                type="number"
                min={0}
                value={shootDays}
                onChange={(e) => setShootDays(Number(e.target.value))}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Est. Total">
              <div className="rounded-lg bg-surface border border-border px-3 py-2 text-sm font-semibold tabular-nums">
                {formatUSD(dailyRate * shootDays)}
              </div>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Permit Status">
              <select
                value={permit}
                onChange={(e) => setPermit(e.target.value as Location["permit_status"])}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              >
                {PERMIT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Permit Expiry">
              <input
                type="date"
                value={permitExpiry}
                onChange={(e) => setPermitExpiry(e.target.value)}
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
              />
            </Field>
          </div>

          {/* Contract / Title Deed */}
          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("locations.location_contract_title_deed")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Upload File">
                <label className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-background border border-border cursor-pointer hover:bg-muted">
                  <Upload className="size-4" />
                  {uploading ? "Uploading…" : contractPath ? "Replace file" : "Choose file"}
                  <input
                    type="file"
                    className="hidden"
                    accept="application/pdf,image/*"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                    }}
                  />
                </label>
                {contractPath && (
                  <div className="mt-1 text-[11px] text-muted-foreground truncate">
                    {contractPath}
                  </div>
                )}
              </Field>
              <Field label="Or external URL">
                <input
                  value={contractUrl}
                  onChange={(e) => setContractUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </div>

          <Field label="Linked Budget Line">
            <select
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
            >
              <option value="">— None —</option>
              {budgetLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} — {l.desc}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-surface hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
