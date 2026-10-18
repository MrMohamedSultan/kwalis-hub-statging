// ═══════════════════════════════════════════════════════════════════
// Platform Hub → Registration Requests (B2B lead inbox / CRM)
// ═══════════════════════════════════════════════════════════════════
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Search,
  Mail,
  Phone,
  Building2,
  Trash2,
  ArrowRight,
  RefreshCw,
  Inbox,
  Check,
  X,
} from "lucide-react";
import {
  listAccessRequests,
  updateAccessRequest,
  deleteAccessRequest,
  approveAccessRequest,
  rejectAccessRequest,
  subscribeToNewAccessRequests,
  industryLabel,
  type AccessRequest,
  type AccessRequestStatus,
} from "@/lib/access-requests";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_platform-hub/platform-hub/registration-requests")({
  head: () => ({
    meta: [
      { title: "Registration Requests · Kwalis HUB" },
      {
        name: "description",
        content: "Review and qualify incoming company access requests for Kwalis HUB.",
      },
      { property: "og:title", content: "Registration Requests · Kwalis HUB" },
      {
        property: "og:description",
        content: "Review and qualify incoming company access requests for Kwalis HUB.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegistrationRequestsPage,
});

const STATUSES: { value: AccessRequestStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "converted", label: "Converted" },
  { value: "rejected", label: "Rejected" },
];

function statusClass(status: string) {
  switch (status) {
    case "new":
    case "pending":
      return "bg-brand/15 text-brand border-brand/30";
    case "contacted":
      return "bg-warning/15 text-warning border-warning/30";
    case "qualified":
      return "bg-info/15 text-info border-info/30";
    case "converted":
    case "onboarded":
    case "approved":
      return "bg-success/15 text-success border-success/30";
    case "rejected":
      return "bg-destructive/15 text-destructive border-destructive/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function RegistrationRequestsPage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const [rows, setRows] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AccessRequestStatus | "all">("all");
  const [selected, setSelected] = useState<AccessRequest | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AccessRequest | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await listAccessRequests());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load requests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Realtime: new leads appear (and alert) without a manual refresh.
  useEffect(() => {
    const unsubscribe = subscribeToNewAccessRequests((row) => {
      setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
      toast.info(t("hub_registration_requests.new_registration_request"), {
        description: `${row.company || row.name} — ${row.email}`,
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    setNotes(selected?.admin_notes ?? "");
  }, [selected]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!needle) return true;
      return [r.name, r.company, r.email, r.mobile]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [rows, q, status]);

  async function setStatusFor(req: AccessRequest, next: AccessRequestStatus) {
    setBusy(true);
    try {
      await updateAccessRequest(req.id, { status: next });
      toast.success(`Marked as ${next}`);
      await refresh();
      setSelected((s) => (s && s.id === req.id ? { ...s, status: next } : s));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes(req: AccessRequest) {
    setBusy(true);
    try {
      await updateAccessRequest(req.id, { admin_notes: notes });
      toast.success(t("hub_registration_requests.notes_saved"));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save notes");
    } finally {
      setBusy(false);
    }
  }

  /** Approve → create the tenant company, link it, mark converted, open it. */
  async function approve(req: AccessRequest) {
    setBusy(true);
    try {
      const orgId = await approveAccessRequest(req);
      toast.success(`${req.company || req.name} approved and created as a client company`);
      await refresh();
      navigate({ to: "/platform-hub/companies/$companyId", params: { companyId: orgId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject(req: AccessRequest) {
    setBusy(true);
    try {
      await rejectAccessRequest(req.id, notes);
      toast.success(t("hub_registration_requests.request_rejected"));
      await refresh();
      setSelected((s) => (s && s.id === req.id ? { ...s, status: "rejected" } : s));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rejection failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5 sm:p-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("hub_registration_requests.registration_requests")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("hub_registration_requests.incoming_company_access_requests_from_the_public_signin")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent transition"
        >
          <RefreshCw className="size-4" /> Refresh
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="size-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("hub_registration_requests.search_name_company_email")}
            className="w-full rounded-lg border border-border bg-card ps-9 pe-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatus(s.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
                status === s.value
                  ? "bg-brand text-brand-foreground border-brand"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-start font-semibold px-4 py-3">Company</th>
                  <th className="text-start font-semibold px-4 py-3">Contact</th>
                  <th className="text-start font-semibold px-4 py-3">Industry</th>
                  <th className="text-start font-semibold px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                      Loading requests…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                      <Inbox className="size-6 mx-auto mb-2 opacity-60" />
                      {t("hub_registration_requests.no_requests_match_this_view")}
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className={`border-t border-border cursor-pointer hover:bg-accent/40 transition ${
                      selected?.id === r.id ? "bg-accent/60" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{r.company || "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">{r.email}</div>
                      <div className="text-xs text-muted-foreground">{r.mobile || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {industryLabel(r.industry)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${statusClass(r.status)}`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail panel */}
        <div className="rounded-xl border border-border bg-card p-5 h-fit">
          {!selected ? (
            <div className="text-sm text-muted-foreground text-center py-12">
              {t("hub_registration_requests.select_a_request_to_review_its_details")}
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="text-lg font-bold">{selected.company || selected.name}</div>
                <div className="text-sm text-muted-foreground">{selected.name}</div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-muted-foreground shrink-0" />
                  <a href={`mailto:${selected.email}`} className="text-brand hover:underline">
                    {selected.email}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="size-4 text-muted-foreground shrink-0" />
                  <span>{selected.mobile || "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-muted-foreground shrink-0" />
                  <span>{industryLabel(selected.industry)}</span>
                </div>
              </div>

              {selected.message && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                  {selected.message}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Internal notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-brand"
                  placeholder={t("hub_registration_requests.call_summary_next_steps")}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveNotes(selected)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent transition disabled:opacity-60"
                >
                  {t("hub_registration_requests.save_notes")}
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Pipeline
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(["contacted", "qualified"] as AccessRequestStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => void setStatusFor(selected, s)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold capitalize hover:bg-accent transition disabled:opacity-60"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {selected.organization_id && (
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/platform-hub/companies/$companyId",
                      params: { companyId: selected.organization_id! },
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-accent transition"
                >
                  <Building2 className="size-4" />
                  {t("hub_registration_requests.open_linked_company")}
                </button>
              )}

              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  disabled={busy || selected.status === "converted"}
                  onClick={() => void approve(selected)}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-3 py-2 text-sm font-semibold hover:brightness-110 transition disabled:opacity-60"
                >
                  <Check className="size-4" />
                  {selected.status === "converted" ? "Approved" : "Approve & create company"}
                  <ArrowRight className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={busy || selected.status === "rejected"}
                  onClick={() => void reject(selected)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent transition disabled:opacity-60"
                >
                  <X className="size-4" /> Reject
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(selected)}
                  className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 text-destructive px-3 py-2 text-sm font-semibold hover:bg-destructive/10 transition disabled:opacity-60"
                >
                  <Trash2 className="size-4" /> Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t("hub_registration_requests.delete_this_request")}
          message={`“${confirmDelete.company || confirmDelete.name}” will be removed permanently.`}
          confirmLabel="Delete"
          open
          tone="danger"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await deleteAccessRequest(confirmDelete.id);
              toast.success(t("hub_registration_requests.request_deleted"));
              setSelected(null);
              await refresh();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Delete failed");
            } finally {
              setConfirmDelete(null);
            }
          }}
        />
      )}
    </div>
  );
}
