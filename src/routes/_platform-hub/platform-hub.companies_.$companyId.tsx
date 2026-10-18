// ═══════════════════════════════════════════════════════════════════
// Platform Hub → Client Company profile & document vault
// ═══════════════════════════════════════════════════════════════════
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  FileText,
  ExternalLink,
  Trash2,
  Save,
  Users,
  Loader2,
  CheckCircle2,
  ChevronRight,
  FolderKanban,
} from "lucide-react";

import {
  getCompany,
  updateCompany,
  listCompanyDocuments,
  uploadCompanyDocument,
  openCompanyDocument,
  deleteCompanyDocument,
  listCompanyMembers,
  listCompanyProjects,
  documentTypeLabel,
  formatBytes,
  DOCUMENT_TYPES,
  type Company,
  type CompanyDocument,
  type CompanyMember,
  type CompanyProject,
} from "@/lib/platform-companies";
import { INDUSTRIES, industryLabel } from "@/lib/access-requests";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteProjectHard } from "@/lib/projects.functions";
import { useServerFn } from "@tanstack/react-start";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_platform-hub/platform-hub/companies_/$companyId")({
  head: () => ({
    meta: [
      { title: "Client Company · Kwalis HUB" },
      {
        name: "description",
        content: "Company profile, subscription status and compliance document vault.",
      },
      { property: "og:title", content: "Client Company · Kwalis HUB" },
      {
        property: "og:description",
        content: "Company profile, subscription status and compliance document vault.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompanyDetailPage,
});

const SUBSCRIPTION_STATUSES = ["Trial", "Active", "Suspended", "Cancelled"];

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}

function CompanyDetailPage() {
  const { t } = useTranslation();

  const { companyId } = Route.useParams();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [company, setCompany] = useState<Company | null>(null);
  const [docs, setDocs] = useState<CompanyDocument[]>([]);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [projects, setProjects] = useState<CompanyProject[]>([]);
  const [confirmProject, setConfirmProject] = useState<CompanyProject | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const removeProject = useServerFn(deleteProjectHard);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [lastUploaded, setLastUploaded] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [docType, setDocType] = useState<string>(DOCUMENT_TYPES[0].value);
  const [confirmDoc, setConfirmDoc] = useState<CompanyDocument | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [c, d, m, p] = await Promise.all([
        getCompany(companyId),
        listCompanyDocuments(companyId),
        listCompanyMembers(companyId),
        listCompanyProjects(companyId),
      ]);
      setCompany(c);
      setDocs(d);
      setMembers(m);
      setProjects(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the company");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function patchNumber(key: keyof Company, value: number) {
    setCompany((c) => (c ? { ...c, [key]: value } : c));
  }

  function patch(key: keyof Company, value: string) {
    setCompany((c) => (c ? { ...c, [key]: value } : c));
  }

  async function save() {
    if (!company) return;
    setSaving(true);
    try {
      await updateCompany(company.id, {
        name: company.name,
        industry: company.industry,
        contact_email: company.contact_email,
        contact_phone: company.contact_phone,
        website: company.website,
        commercial_registration: company.commercial_registration,
        national_address: company.national_address,
        subscription_status: company.subscription_status,
        max_projects: company.max_projects,
        notes: company.notes,
      });
      toast.success(t("hub_companies_companyid.company_profile_saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error(t("hub_companies_companyid.files_must_be_25_mb_or_smaller"));
      return;
    }
    setUploading(true);
    setUploadingName(file.name);
    setLastUploaded(null);
    try {
      await uploadCompanyDocument(companyId, file, docType);
      toast.success(`${file.name} uploaded`);
      setLastUploaded(file.name);
      setDocs(await listCompanyDocuments(companyId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadingName(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading company…</div>;
  }
  if (!company) {
    return (
      <div className="p-8 space-y-4">
        <div className="text-sm text-muted-foreground">
          {t("hub_companies_companyid.this_company_no_longer_exists")}
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: "/platform-hub/companies" })}
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
        >
          {t("hub_companies_companyid.back_to_companies")}
        </button>
      </div>
    );
  }

  return (
    <div className="p-5 sm:p-8 space-y-6">
      <button
        type="button"
        onClick={() => navigate({ to: "/platform-hub/companies" })}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft className="size-4" />
        {t("hub_companies_companyid.all_companies")}
      </button>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {industryLabel(company.industry)} · {members.length} user
            {members.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-4 py-2 text-sm font-semibold hover:brightness-110 transition disabled:opacity-60"
        >
          <Save className="size-4" /> {saving ? "Saving…" : "Save changes"}
        </button>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Profile */}
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {t("hub_companies_companyid.company_profile")}
          </h2>
          <Input label="Company name" value={company.name} onChange={(v) => patch("name", v)} />
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Industry
            </span>
            <select
              value={company.industry ?? ""}
              onChange={(e) => patch("industry", e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="">—</option>
              {INDUSTRIES.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Contact email"
              type="email"
              value={company.contact_email ?? ""}
              onChange={(v) => patch("contact_email", v)}
            />
            <Input
              label="Contact phone"
              value={company.contact_phone ?? ""}
              onChange={(v) => patch("contact_phone", v)}
            />
          </div>
          <Input
            label="Website"
            value={company.website ?? ""}
            placeholder="https://"
            onChange={(v) => patch("website", v)}
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Commercial registration"
              value={company.commercial_registration ?? ""}
              onChange={(v) => patch("commercial_registration", v)}
            />
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Subscription
              </span>
              <select
                value={company.subscription_status ?? "Trial"}
                onChange={(e) => patch("subscription_status", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {SUBSCRIPTION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Max allowed projects
            </span>
            <input
              type="number"
              min={0}
              max={999}
              value={String(company.max_projects ?? 0)}
              onChange={(e) =>
                patchNumber("max_projects", Math.max(0, Math.min(999, Number(e.target.value) || 0)))
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <span className="text-[11px] text-muted-foreground">
              {projects.length} of {company.max_projects ?? 0} used
            </span>
          </label>
          <Input
            label="National address"
            value={company.national_address ?? ""}
            onChange={(v) => patch("national_address", v)}
          />
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("hub_companies_companyid.internal_notes")}
            </span>
            <textarea
              value={company.notes ?? ""}
              onChange={(e) => patch("notes", e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-brand"
            />
          </label>
        </section>

        <div className="space-y-5">
          {/* Documents */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {t("hub_companies_companyid.legal_documents")}
            </h2>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 min-w-[180px] space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("hub_companies_companyid.document_type")}
                </span>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  disabled={uploading}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
                >
                  {DOCUMENT_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </div>

            {/* Drop zone with explicit idle / uploading / success states */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!uploading) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!uploading) void onFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => !uploading && fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
              }}
              className={`rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition cursor-pointer ${
                dragging ? "border-brand bg-brand/5" : "border-border hover:bg-accent/40"
              } ${uploading ? "opacity-70 cursor-wait" : ""}`}
            >
              {uploading ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Uploading{" "}
                  {uploadingName ? `“${uploadingName}”` : "document"}…
                </span>
              ) : lastUploaded ? (
                <span className="inline-flex items-center gap-2 text-success">
                  <CheckCircle2 className="size-4" /> “{lastUploaded}” uploaded — drop another file
                  or click to browse
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Upload className="size-4" /> Drop a file here or click to browse · max 25 MB
                </span>
              )}
            </div>

            <ul className="divide-y divide-border">
              {docs.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  {t("hub_companies_companyid.no_documents_on_file_yet")}
                </li>
              )}
              {docs.map((d) => (
                <li key={d.id} className="py-3 flex items-center gap-3">
                  <FileText className="size-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{d.file_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {documentTypeLabel(d.document_type)} · {formatBytes(d.file_size_bytes)}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t("hub_companies_companyid.open_document")}
                    onClick={() =>
                      void openCompanyDocument(d).catch((e) =>
                        toast.error(e instanceof Error ? e.message : "Could not open"),
                      )
                    }
                    className="text-muted-foreground hover:text-brand transition"
                  >
                    <ExternalLink className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("hub_companies_companyid.delete_document")}
                    onClick={() => setConfirmDoc(d)}
                    className="text-muted-foreground hover:text-destructive transition"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Projects */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <FolderKanban className="size-4" /> Company projects
              <span className="ms-auto font-normal normal-case tracking-normal">
                {projects.length} / {company.max_projects ?? 0}
              </span>
            </h2>
            <ul className="divide-y divide-border">
              {projects.length === 0 && (
                <li className="py-4 text-sm text-muted-foreground">No projects yet.</li>
              )}
              {projects.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {p.code && (
                        <span className="me-2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          {p.code}
                        </span>
                      )}
                      {p.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.project_type || "—"} · {p.status || "—"}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete project ${p.name}`}
                    onClick={() => setConfirmProject(p)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-2.5 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Members */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Users className="size-4" /> Users
            </h2>
            <ul className="divide-y divide-border">
              {members.length === 0 && (
                <li className="py-4 text-sm text-muted-foreground">
                  {t("hub_companies_companyid.no_users_yet")}
                </li>
              )}
              {members.map((m) => (
                <li key={m.id}>
                  <Link
                    to="/platform-hub/users/$userId"
                    params={{ userId: m.user_id }}
                    search={{ from: companyId }}
                    className="group -mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate group-hover:text-brand">
                        {m.display_name || m.user_id.slice(0, 8)}
                      </div>
                      {m.job_title && (
                        <div className="text-xs text-muted-foreground truncate">{m.job_title}</div>
                      )}
                    </div>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize">
                        {m.role}
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-brand rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {confirmProject && (
        <ConfirmDialog
          open
          tone="danger"
          loading={deletingProject}
          title="Delete this project permanently?"
          message={`“${confirmProject.name}” and all of its budgets, payroll, documents and financial records will be permanently destroyed. This cannot be undone.`}
          confirmLabel="Delete project"
          onCancel={() => !deletingProject && setConfirmProject(null)}
          onConfirm={async () => {
            setDeletingProject(true);
            try {
              await removeProject({ data: { projectId: confirmProject.id } });
              toast.success(`“${confirmProject.name}” deleted`);
              setProjects(await listCompanyProjects(companyId));
              setConfirmProject(null);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Delete failed");
            } finally {
              setDeletingProject(false);
            }
          }}
        />
      )}

      {confirmDoc && (
        <ConfirmDialog
          open
          tone="danger"
          title={t("hub_companies_companyid.delete_this_document")}
          message={`“${confirmDoc.file_name}” will be permanently removed.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDoc(null)}
          onConfirm={async () => {
            try {
              await deleteCompanyDocument(confirmDoc);
              toast.success(t("hub_companies_companyid.document_deleted"));
              setDocs(await listCompanyDocuments(companyId));
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Delete failed");
            } finally {
              setConfirmDoc(null);
            }
          }}
        />
      )}
    </div>
  );
}
