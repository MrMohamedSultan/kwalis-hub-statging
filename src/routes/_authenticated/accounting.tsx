import { formatAmount } from "@/lib/format-number";
import { formatDateTime, formatDate } from "@/lib/date-format";
import { assertUploadAllowed, uploadContentType } from "@/lib/upload-policy";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { LockGuard } from "@/components/chrome/LockGuard";
import { RowSearch } from "@/components/chrome/RowSearch";
import { IntegrityAuditButton } from "@/components/IntegrityAuditModal";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import {
  useStore,
  formatUSD,
  generateId,
  lineTotal,
  useTotals,
  sumPaymentsFor,
  VENDOR_PAYMENT_TERMS,
  INVOICE_PAYMENT_METHODS,
  methodNeedsPurchaser,
  type InvoicePaymentMethod,
} from "@/lib/store";
import type {
  Vendor,
  Invoice,
  CashAdvance,
  CashAdvanceReceipt,
  PurchaseOrder,
  PurchaseOrderStatus,
  BudgetLine,
  Payment,
} from "@/lib/store";
import { VENDOR_CATEGORIES, HEADER_ACCOUNTS } from "@/lib/data";
import { useVendorCategories } from "@/lib/vendor-categories";
import {
  uploadProjectFile,
  listFilesForEntity,
  getSignedUrl,
  type FileRow,
} from "@/lib/project-files";
import { supabase } from "@/integrations/supabase/client";
import {
  Paperclip,
  Plus,
  Pencil,
  Trash2,
  Check,
  HardHat,
  FileText,
  ClipboardList,
  Wallet,
  Users,
  DollarSign,
  Download,
  CheckCircle2,
  Drama,
  ExternalLink,
  Link as LinkIcon,
  Store,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { BankPicker, CountryCombo, validateBankPicker } from "@/components/BankPicker";
import { toast } from "sonner";
import { DateInput } from "@/components/ui/date-input";
import {
  PaymentSplitFields,
  ScheduleRemainderHint,
  SCHEDULE_PCT_TOLERANCE,
  isScheduleTotalValid,
  resolveSplitAmount,
} from "@/components/PaymentSplitFields";
import { useUnsavedChangesWarning, useDirtyTracker } from "@/hooks/useUnsavedChangesWarning";
import {
  AttachmentUrlField,
  AttachmentLinkBadge,
  isValidAttachmentUrl,
  normalizeAttachmentUrl,
} from "@/components/AttachmentUrlField";
import { findDuplicateAttachmentUrl, type AttachmentUrlRecord } from "@/lib/cloud-links";
import { useFormDraft, draftKey } from "@/lib/form-drafts";
import { DatePickerPill } from "@/components/ui/date-picker-pill";
import { AttachmentsButton } from "@/components/AttachmentsModal";
import {
  RecordPaymentModal,
  PaymentStatusPill,
  type PaymentSourceInfo,
} from "@/components/RecordPaymentModal";
import { PaymentHistory, PaymentHistoryToggle } from "@/components/PaymentHistory";
import { useCan } from "@/lib/rbac";
import { usePermissionCheck } from "@/lib/permission-guard";
import { useGlAccounts } from "@/lib/gl-accounts";
import { downloadCSV } from "@/lib/export-csv";
import { BudgetCodeSelector } from "@/components/BudgetCodeSelector";
import { BudgetMappingSelect } from "@/components/BudgetMappingSelect";

import { GlAccountSelector } from "@/components/GlAccountSelector";
import { setSupportingDocUrl } from "@/lib/supporting-docs";
import { SupportingDocField } from "@/components/SupportingDocField";
import { Lock } from "lucide-react";
import { TablePagination, usePagedRows } from "@/components/TablePagination";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { TableEmptyRow } from "@/components/ui/empty-state";
import { humanizeDbError } from "@/lib/db-errors";
import { CrewPayrollTab } from "@/components/CrewPayrollTab";
import {
  VAT_TREATMENTS,
  type VatTreatment,
  deriveGlAccountId,
  dueDateFromTerms,
  expectedVat as calcExpectedVat,
  invoiceAmountDue,
  matchInvoiceToPo,
  toBaseAmount,
  vatWithinTolerance,
} from "@/lib/ap-calc";
import { useLogisticsCommitments, useVatStandardRate, fetchMappedGlAccount } from "@/lib/ap-data";
import {
  computeBudgetPosition,
  invoicedOnPo,
  legacyContractPaid,
  poIsCommitment,
  poOpenCommitment,
} from "@/lib/budget-position";
import { CurrencyFxFields, useProjectFx } from "@/components/ap/CurrencyFxFields";
import {
  VendorTaxFields,
  VendorInheritedSummary,
  invoicePatchFromVendor,
  invoiceVendorChangePatch,
} from "@/components/ap/VendorProfileFields";
import { useHasColumn } from "@/lib/persons";
import { RefFilterInput, RefText, useRefMap } from "@/components/refs/RefListTools";
import { InvoiceE08Details } from "@/components/ap/InvoiceE08Details";

function attachmentRecordsForProject(
  people: Array<{
    id: string;
    projectId?: string | null;
    fullName: string;
    attachmentUrl?: string | null;
  }>,
  invoices: Invoice[],
): AttachmentUrlRecord[] {
  return [
    ...people.map((p) => ({
      id: `person:${p.id}`,
      projectId: p.projectId,
      url: p.attachmentUrl,
      label: `contract: ${p.fullName || "Unnamed"}`,
    })),
    ...invoices.map((i) => ({
      id: `invoice:${i.id}`,
      projectId: i.projectId,
      url: i.attachmentUrl,
      label: `invoice: ${i.invoiceNo || i.vendorName || i.description || "Unnamed"}`,
    })),
  ];
}

// Smart QFE (rebate) rules engine lives in @/lib/qfe-rules so the ledger,
// exports, and audit logger can share the exact same classifier.
import {
  explainAutoQfe,
  computeAutoQfe,
  qfeRuleLabel,
  type QfeExplain,
  type QfeRule,
} from "@/lib/qfe-rules";
import { recordAudit } from "@/lib/audit-log";
import { useTranslation } from "react-i18next";
import {
  ApprovalFilterSelect,
  ApprovalStatusPill,
  InvoiceApprovalActions,
  useCanApproveInvoice,
  type ApprovalFilter,
} from "@/components/decisions/ApprovalControls";
export { explainAutoQfe, computeAutoQfe, qfeRuleLabel };
export type { QfeExplain, QfeRule };

const TAB_KEYS = [
  "vendor",
  "invoices",
  "po",
  "petty",
  "cast_payroll",
  "crew_payroll",
  "vendor_payables",
] as const;
type Tab = (typeof TAB_KEYS)[number];

/**
 * Legacy `/accounting` entry.
 *
 * The old "Operations & Payables" mega-tabbed page has been split into
 * dedicated, clean routes under the new Procurement, Accounts Payable,
 * and Treasury & Cash sidebar sections. This route now only exists as a
 * redirect so any existing bookmark or `?tab=…` deep-link continues to
 * work instead of 404-ing.
 */
export const Route = createFileRoute("/_authenticated/accounting")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab; focus?: string } => {
    const t = search.tab;
    const f = search.focus;
    const out: { tab?: Tab; focus?: string } = {};
    if (typeof t === "string" && (TAB_KEYS as readonly string[]).includes(t)) out.tab = t as Tab;
    if (typeof f === "string" && f) out.focus = f;
    return out;
  },
  beforeLoad: ({ search }) => {
    const s = search as { tab?: Tab; focus?: string };
    const to =
      s.tab === "vendor"
        ? "/vendors"
        : s.tab === "po"
          ? "/purchase-orders"
          : s.tab === "petty"
            ? "/petty-cash"
            : s.tab === "cast_payroll" || s.tab === "crew_payroll"
              ? "/crew-cast-payables"
              : s.tab === "vendor_payables"
                ? "/vendor-payables"
                : "/invoices";
    throw redirect({ to, search: s.focus ? { focus: s.focus } : undefined, replace: true });
  },
  component: () => null,
});

export function FinancialSummary() {
  const { t } = useTranslation();
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  // B17/B20: Remaining Budget = Budget − Actual − Commitment, with contracts,
  // POs (net of their invoices) and car rentals / accommodation in Commitment.
  const logistics = useLogisticsCommitments(
    activeProject?.id ?? null,
    Number(activeProject?.fxRate ?? 3.75) || 3.75,
  );
  const {
    totalBudget,
    committed,
    actualSpend,
    remaining,
    poOpen,
    contractsCommitment,
    logisticsCommitment,
    paid,
  } = useTotals(logistics);
  const invoices = useStore((s) => s.invoices);
  const payroll = useStore((s) => s.payroll);
  const totalWht =
    invoices.reduce((a, i) => a + (Number(i.whtAmount) || 0), 0) +
    payroll.reduce((a, p) => a + (Number(p.whtAmount) || 0), 0);
  const cards: {
    label: string;
    value: string;
    sub?: string;
    tone: string;
    icon: React.ReactNode;
  }[] = [
    {
      label: t("ap.card_budget"),
      value: formatUSD(totalBudget),
      tone: "from-info/20 to-info/5 border-info/30",
      icon: <Wallet className="size-4 text-info" />,
    },
    {
      label: t("ap.card_commitment"),
      value: formatUSD(committed),
      sub: t("ap.card_commitment_sub", {
        contracts: formatUSD(contractsCommitment),
        pos: formatUSD(poOpen),
        logistics: formatUSD(logisticsCommitment),
      }),
      tone: "from-warning/20 to-warning/5 border-warning/30",
      icon: <ClipboardList className="size-4 text-warning" />,
    },
    {
      label: t("ap.card_actual"),
      value: formatUSD(actualSpend),
      sub: t("ap.card_actual_sub", { paid: formatUSD(paid) }),
      tone: "from-success/20 to-success/5 border-success/30",
      icon: <Check className="size-4 text-success" />,
    },
    {
      label: t("ap.card_remaining"),
      value: formatUSD(remaining),
      sub: t("ap.card_remaining_sub"),
      tone:
        remaining < 0
          ? "from-destructive/20 to-destructive/5 border-destructive/40"
          : "from-highlight/20 to-highlight/5 border-highlight/30",
      icon: (
        <FileText className={`size-4 ${remaining < 0 ? "text-destructive" : "text-highlight"}`} />
      ),
    },
    {
      label: "Total Withheld Tax Liability",
      value: formatUSD(totalWht),
      sub: "GL 2140 · Non-Saudi contracts & vendors (5% WHT)",
      tone: "from-highlight/20 to-highlight/5 border-highlight/30",
      icon: <FileText className="size-4 text-highlight" />,
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-2xl border bg-gradient-to-br p-4 ${c.tone}`}>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            {c.icon}
            {c.label}
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
          {c.sub && <div className="mt-1 text-[11px] text-muted-foreground">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function PillTabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: [Tab, string, React.ReactNode][] = [
    ["crew_payroll", "Crew Payables", <HardHat key="crp" className="size-4" />],
    ["cast_payroll", "Cast Payables", <Drama key="cap" className="size-4" />],
    ["vendor_payables", "Vendor Payables", <Store key="vp" className="size-4" />],
    ["petty", "Petty Cash", <Wallet key="c" className="size-4" />],
    ["po", "Purchase Orders", <ClipboardList key="p" className="size-4" />],
    ["invoices", "Invoices", <FileText key="i" className="size-4" />],
    ["vendor", "Vendors", <Users key="v" className="size-4" />],
  ];
  return (
    <div className="rounded-2xl bg-surface/60 border border-border p-2 mb-6 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="inline-flex flex-nowrap gap-2 min-w-max">
        {tabs.map(([k, l, icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition ${tab === k ? "bg-gradient-to-b from-card to-card text-white ring-1 ring-border" : "text-foreground/80 hover:bg-muted"}`}
          >
            {icon}
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Vendor Tab ---------------- */

export function VendorTab() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"new" | "list">("new");
  const [editing, setEditing] = useState<Vendor | null>(null);
  return (
    <>
      <h2 className="text-2xl font-semibold mb-3">{t("platform.ui.suppliers")}</h2>
      <div className="rounded-2xl bg-surface/60 border border-border p-4 inline-flex flex-col gap-2 mb-6">
        <RadioCard
          checked={mode === "new"}
          onClick={() => {
            setMode("new");
            setEditing(null);
          }}
          label={t("platform.ui.newVendor")}
        />
        <RadioCard
          checked={mode === "list"}
          onClick={() => setMode("list")}
          label={t("platform.ui.vendorList")}
        />
      </div>
      {mode === "new" ? (
        <NewVendorForm
          initial={editing}
          onDone={() => {
            setEditing(null);
            setMode("list");
          }}
        />
      ) : (
        <VendorList
          onEdit={(v) => {
            setEditing(v);
            setMode("new");
          }}
        />
      )}
    </>
  );
}

function RadioCard({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between gap-6 px-4 py-2.5 rounded-xl text-sm font-semibold min-w-[220px] transition ${checked ? "bg-gradient-to-b from-card to-card ring-1 ring-border text-white" : "bg-surface-2/40 hover:bg-muted"}`}
    >
      <span>{label}</span>
      <span
        className={`size-5 rounded grid place-items-center border ${checked ? "border-brand bg-brand text-brand-foreground" : "border-border"}`}
      >
        {checked && "✓"}
      </span>
    </button>
  );
}

function VendorCategoryEditor({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();

  const { rows, add, rename, remove, orgId, loading } = useVendorCategories();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  return (
    <Modal title={t("accounting.vendor_category_editor")} onClose={onDone}>
      {!orgId && (
        <div className="text-xs text-warning mb-2">
          {t("accounting.select_an_active_project_to_manage_categories")}
        </div>
      )}
      <div className="flex gap-2 mb-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("accounting.eg_postproduction_insurance")}
          className={`${inputCls} flex-1`}
        />
        <button
          type="button"
          disabled={!orgId || !draft.trim()}
          onClick={async () => {
            try {
              await add(draft);
              setDraft("");
              toast.success(t("accounting.category_added"));
            } catch (e: any) {
              toast.error(e?.message ?? "Failed to add category.");
            }
          }}
          className="px-3 py-2 rounded-xl bg-brand/80 text-white text-sm disabled:opacity-40"
        >
          <Plus className="size-4 inline -mt-0.5" /> Add
        </button>
      </div>
      <div className="grid gap-2">
        {loading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No custom categories yet — the built-in defaults will be used.
          </div>
        )}
        {rows.map((r) => {
          const isEditingRow = editing?.id === r.id;
          const editingName = editing?.name ?? "";
          return (
            <div
              key={r.id}
              className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 bg-surface-2/40"
            >
              {isEditingRow ? (
                <>
                  <input
                    value={editingName}
                    onChange={(e) => setEditing({ id: r.id, name: e.target.value })}
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    className="text-xs px-2 py-1 rounded bg-success/20 text-success"
                    onClick={async () => {
                      try {
                        await rename(r.id, editingName);
                        setEditing(null);
                        toast.success(t("accounting.renamed"));
                      } catch (e: any) {
                        toast.error(e?.message ?? "Failed to rename.");
                      }
                    }}
                  >
                    {t("platform.ui.save")}
                  </button>
                  <button
                    className="text-xs px-2 py-1 rounded bg-surface-2"
                    onClick={() => setEditing(null)}
                  >
                    {t("platform.ui.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{r.name}</span>
                  <button
                    className="p-1 hover:bg-muted rounded"
                    onClick={() => setEditing({ id: r.id, name: r.name })}
                    title={t("accounting.rename")}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    className="p-1 hover:bg-destructive/20 rounded text-destructive"
                    onClick={async () => {
                      if (!confirm(`Delete category "${r.name}"?`)) return;
                      try {
                        await remove(r.id);
                        toast.success(t("accounting.deleted"));
                      } catch (e: any) {
                        toast.error(e?.message ?? "Failed to delete.");
                      }
                    }}
                    title={t("platform.ui.delete")}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** Docs cell: lists uploaded documents for a vendor with signed-URL download links. */
function VendorDocsCell({ vendor }: { vendor: Vendor }) {
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!activeProjectId) return;
      setLoading(true);
      try {
        const rows = await listFilesForEntity(activeProjectId, "vendor", vendor.id);
        if (alive) setFiles(rows);
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeProjectId, vendor.id]);

  const openFile = async (f: FileRow) => {
    try {
      const url = await getSignedUrl(f.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to open document.");
    }
  };

  const hasDrive = vendor.sharedDriveUrl && /^https?:\/\//i.test(vendor.sharedDriveUrl);
  const nothing = !loading && files.length === 0 && !hasDrive;
  if (nothing) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="relative inline-flex items-center gap-2">
      {files.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-brand hover:underline text-xs"
          title={t("accounting.view_uploaded_documents")}
        >
          <Paperclip className="size-3.5" /> {files.length}
        </button>
      )}
      {hasDrive && (
        <a
          href={vendor.sharedDriveUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-brand hover:underline text-xs"
        >
          <ExternalLink className="size-3.5" /> Drive
        </a>
      )}
      {open && files.length > 0 && (
        <div className="absolute z-20 top-full mt-1 left-0 min-w-[220px] max-w-[320px] rounded-xl border border-border bg-surface shadow-xl p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pb-1">
            {t("accounting.library_documents")}
          </div>
          <ul className="max-h-64 overflow-auto">
            {files.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => openFile(f)}
                  className="w-full text-start px-2 py-1.5 rounded-lg hover:bg-muted text-xs flex items-center gap-2"
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NewVendorForm({ initial, onDone }: { initial?: Vendor | null; onDone: () => void }) {
  const { t } = useTranslation();

  const { addVendor, updateVendor, activeProjectId } = useStore();
  const { names: categoryNames } = useVendorCategories();
  const [showCatEditor, setShowCatEditor] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [existingFiles, setExistingFiles] = useState<FileRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [f, setF] = useState<Vendor>(
    initial ?? {
      id: "",
      name: "",
      category: categoryNames[0] ?? "",
      crNo: "",
      vatNo: "",
      email: "",
      contactName: "",
      position: "",
      mobile: "",
      iban: "",
      sharedDriveUrl: "",
      bankName: "",
      bankCountry: "",
      swiftCode: "",
      paymentTerms: "",
      vendorScope: "Local",
      companyNationality: "Saudi Arabia",
    },
  );

  const isEdit = !!initial;
  // E05: tax residency / related party once db/pending/190 is applied.
  const vendorTaxColumns = useHasColumn("vendors", "tax_residency");
  useEffect(() => {
    if (vendorTaxColumns && f.taxResidency === undefined)
      setF((prev) => ({ ...prev, taxResidency: null, relatedParty: !!prev.relatedParty }));
  }, [vendorTaxColumns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ensure category defaults to something valid when the dynamic list resolves.
  useEffect(() => {
    if (!f.category && categoryNames.length)
      setF((prev) => ({ ...prev, category: categoryNames[0] }));
  }, [categoryNames]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing files for this vendor (edit mode).
  useEffect(() => {
    (async () => {
      if (isEdit && initial?.id && activeProjectId) {
        try {
          setExistingFiles(await listFilesForEntity(activeProjectId, "vendor", initial.id));
        } catch {
          /* ignore */
        }
      }
    })();
  }, [isEdit, initial?.id, activeProjectId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Aggregate inline validation errors first so we can highlight every
    // missing field at once instead of one toast at a time.
    const nextErrors: Record<string, string> = {};
    if (!f.name.trim()) nextErrors.name = "Company Name is required.";
    if (!f.iban?.trim()) nextErrors.iban = "IBAN / Account Number is required.";
    if (!activeProjectId)
      nextErrors._project = "Select an active project before creating a vendor.";
    if (
      f.sharedDriveUrl &&
      f.sharedDriveUrl.trim() &&
      !/^https?:\/\//i.test(f.sharedDriveUrl.trim())
    ) {
      nextErrors.sharedDriveUrl = "Must start with http:// or https://";
    }
    const bankErrs = validateBankPicker({
      bankCountry: f.bankCountry ?? "",
      bankName: f.bankName ?? "",
      swiftCode: f.swiftCode ?? "",
    });
    if (bankErrs.bankCountry) nextErrors.bankCountry = bankErrs.bankCountry;
    if (bankErrs.bankName) nextErrors.bankName = bankErrs.bankName;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error(t("accounting.please_fix_the_highlighted_fields_before_saving"));
      return;
    }
    try {
      let vendorId = initial?.id ?? "";
      if (isEdit) {
        await updateVendor(initial!.id, f);
        toast.success(`Vendor "${f.name}" updated.`);
      } else {
        vendorId = generateId();
        await addVendor({ ...f, id: vendorId });
        toast.success(`Vendor "${f.name}" created.`);
      }
      // Upload attached files to the central Library, linked to this vendor.
      if (pendingFiles.length > 0) {
        setUploading(true);
        try {
          for (const file of pendingFiles) {
            await uploadProjectFile({
              projectId: activeProjectId!,
              file,
              entityType: "vendor",
              entityId: vendorId,
              entityLabel: f.name,
            });
          }
          toast.success(`${pendingFiles.length} document(s) uploaded to Library.`);
        } catch (upErr: any) {
          toast.error(`Vendor saved, but upload failed: ${upErr?.message ?? "unknown error"}`);
        } finally {
          setUploading(false);
        }
      }
      onDone();
    } catch (err: any) {
      toast.error(humanizeDbError(err));
    }
  };
  return (
    <>
      {showCatEditor && <VendorCategoryEditor onDone={() => setShowCatEditor(false)} />}
      <Panel>
        <h3 className="text-xl font-semibold mb-4">{isEdit ? "Edit Vendor" : "New Vendor"}</h3>
        <form onSubmit={submit} className="grid grid-cols-2 gap-4">
          <Field label={t("platform.ui.companyName")} required error={errors.name}>
            <input
              value={f.name}
              onChange={(e) => {
                setF({ ...f, name: e.target.value });
                if (errors.name) setErrors({ ...errors, name: "" });
              }}
              placeholder={t("accounting.vendor_a")}
              className={inputCls}
              aria-invalid={!!errors.name}
            />
          </Field>
          <Field label={t("platform.ui.contactName")}>
            <input
              value={f.contactName ?? ""}
              onChange={(e) => setF({ ...f, contactName: e.target.value })}
              placeholder={t("accounting.john_doe")}
              className={inputCls}
            />
          </Field>
          <Field label={t("platform.ui.servicesProductsCategory")}>
            <div className="flex gap-2">
              <select
                value={f.category}
                onChange={(e) => setF({ ...f, category: e.target.value })}
                className={`${inputCls} flex-1`}
              >
                {categoryNames.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowCatEditor((v) => !v)}
                className="px-3 py-2 rounded-xl border border-border bg-surface hover:bg-muted text-xs whitespace-nowrap"
              >
                Manage…
              </button>
            </div>
          </Field>
          <Field label={t("platform.ui.position")}>
            <input
              value={f.position ?? ""}
              onChange={(e) => setF({ ...f, position: e.target.value })}
              placeholder={t("accounting.account_manager")}
              className={inputCls}
            />
          </Field>
          <Field label="C.R No">
            <input
              value={f.crNo}
              onChange={(e) => setF({ ...f, crNo: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("platform.ui.mobile")}>
            <input
              value={f.mobile ?? ""}
              onChange={(e) => setF({ ...f, mobile: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="VAT No">
            <input
              value={f.vatNo}
              onChange={(e) => setF({ ...f, vatNo: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("platform.ui.email")}>
            <input
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="IBAN / Account Number" required error={errors.iban}>
            <input
              value={f.iban ?? ""}
              onChange={(e) => {
                setF({ ...f, iban: e.target.value });
                if (errors.iban) setErrors({ ...errors, iban: "" });
              }}
              className={inputCls}
              aria-invalid={!!errors.iban}
            />
          </Field>
          <Field label={t("platform.ui.vendorScope")}>
            <div className="flex gap-2">
              {(["Local", "International"] as const).map((s) => (
                <label
                  key={s}
                  className={`flex-1 text-center cursor-pointer px-3 py-2 rounded-xl border text-sm ${f.vendorScope === s ? "border-brand bg-brand/20 text-brand" : "border-border bg-surface hover:bg-muted"}`}
                >
                  <input
                    type="radio"
                    name="vendor_scope"
                    className="sr-only"
                    checked={f.vendorScope === s}
                    onChange={() =>
                      setF({
                        ...f,
                        vendorScope: s,
                        companyNationality:
                          s === "Local" ? "Saudi Arabia" : f.companyNationality || "",
                      })
                    }
                  />
                  {s}
                </label>
              ))}
            </div>
          </Field>
          <Field label={t("platform.ui.companyNationalityCountryOfRegistration")}>
            <CountryCombo
              value={f.companyNationality ?? ""}
              onChange={(c) => setF({ ...f, companyNationality: c })}
              placeholder={t("accounting.select_country")}
            />
          </Field>
          <VendorTaxFields
            vendor={f}
            onChange={(patch) => setF((prev) => ({ ...prev, ...patch }))}
            inputCls={inputCls}
          />
          <BankPicker
            bankCountry={f.bankCountry ?? ""}
            bankName={f.bankName ?? ""}
            swiftCode={f.swiftCode ?? ""}
            onChange={(patch) => {
              setF((prev) => ({ ...prev, ...patch }));
              if (errors.bankCountry || errors.bankName) {
                setErrors((prev) => ({ ...prev, bankCountry: "", bankName: "" }));
              }
            }}
            errors={{ bankCountry: errors.bankCountry, bankName: errors.bankName }}
          />

          <Field label={t("platform.ui.paymentTerms")}>
            <select
              value={f.paymentTerms ?? ""}
              onChange={(e) => setF({ ...f, paymentTerms: e.target.value as any })}
              className={inputCls}
            >
              <option value="">— Select —</option>
              {VENDOR_PAYMENT_TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <div className="col-span-2">
            <div className="text-muted-foreground mb-2 uppercase tracking-wider text-xs">
              {t("accounting.vendor_documents_cr_vat_contracts")}
              <span className="text-foreground/60 normal-case font-normal">
                {" "}
                · stored in the project Library
              </span>
            </div>
            <input
              type="file"
              multiple
              onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm text-muted-foreground file:me-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand/20 file:text-brand file:hover:bg-brand/30"
            />
            {pendingFiles.length > 0 && (
              <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
                {pendingFiles.map((f, i) => (
                  <li key={i}>
                    • {f.name}{" "}
                    <span className="text-foreground/50">({Math.round(f.size / 1024)} KB)</span>
                  </li>
                ))}
              </ul>
            )}
            {existingFiles.length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-foreground/70 mb-1">
                  {t("accounting.already_in_library")}
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {existingFiles.map((ef) => (
                    <li key={ef.id}>• {ef.name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Field label={t("platform.ui.sharedDriveLinkOptionalSecondary")}>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={f.sharedDriveUrl ?? ""}
                onChange={(e) => setF({ ...f, sharedDriveUrl: e.target.value })}
                placeholder="https://drive.google.com/…"
                className={`${inputCls} flex-1`}
              />
              {f.sharedDriveUrl && /^https?:\/\//i.test(f.sharedDriveUrl) && (
                <a
                  href={f.sharedDriveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-border bg-surface hover:bg-muted text-xs"
                >
                  <ExternalLink className="size-3.5" /> Open
                </a>
              )}
            </div>
          </Field>
          <button
            disabled={uploading}
            className="col-span-2 mt-2 py-3 rounded-xl bg-gradient-to-b from-card to-card ring-1 ring-border text-white font-semibold disabled:opacity-60"
          >
            {uploading ? "Uploading…" : isEdit ? "Save Changes" : "Create Account"}
          </button>
        </form>
      </Panel>
    </>
  );
}

function VendorList({ onEdit }: { onEdit: (v: Vendor) => void }) {
  const { t } = useTranslation();

  const { vendors, removeVendor } = useStore();
  const storeReady = useStore((s) => s.ready);
  const { pageRows: pagedVendors, paginationProps: vendorPagination } = usePagedRows(vendors, 20);
  const [ledgerFor, setLedgerFor] = useState<Vendor | null>(null);
  if (!storeReady && vendors.length === 0) {
    return (
      <Panel>
        <TableSkeleton rows={6} cols={6} />
      </Panel>
    );
  }
  return (
    <Panel>
      <Table
        headers={["Company", "Contact", "Category", "Terms", "Bank", "Docs", "Email", "Actions"]}
      >
        {pagedVendors.map((v) => (
          <tr key={v.id} className="border-b border-border">
            <Cell className="font-medium">{v.name}</Cell>
            <Cell>{v.contactName || "—"}</Cell>
            <Cell>{v.category}</Cell>
            <Cell>{v.paymentTerms || "—"}</Cell>
            <Cell className="text-xs">
              {v.bankName || "—"}
              {v.swiftCode ? (
                <span className="font-mono text-muted-foreground"> · {v.swiftCode}</span>
              ) : null}
            </Cell>
            <Cell>
              <VendorDocsCell vendor={v} />
            </Cell>

            <Cell>{v.email}</Cell>
            <Cell>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setLedgerFor(v)}
                  className="p-1.5 rounded-lg hover:bg-muted"
                  title={t("accounting.view_ledger")}
                >
                  <ClipboardList className="size-4" />
                </button>
                <button
                  onClick={() => onEdit(v)}
                  className="p-1.5 rounded-lg hover:bg-muted"
                  title={t("platform.ui.edit")}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`Delete vendor "${v.name}"? This cannot be undone.`)) return;
                    try {
                      await removeVendor(v.id);
                      toast.success(`Vendor "${v.name}" deleted.`);
                    } catch (e: any) {
                      toast.error(e?.message ?? "Failed to delete vendor.");
                    }
                  }}
                  className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive"
                  title={t("platform.ui.delete")}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </Cell>
          </tr>
        ))}
        {vendors.length === 0 && (
          <TableEmptyRow
            colSpan={8}
            title={t("accounting.no_vendors_yet")}
            description="Add your first vendor to start recording invoices, purchase orders and payments against it."
          />
        )}
      </Table>
      <TablePagination {...vendorPagination} />
      {ledgerFor && <VendorLedgerModal vendor={ledgerFor} onClose={() => setLedgerFor(null)} />}
    </Panel>
  );
}

const PAYMENT_METHODS: Payment["method"][] = ["Cash", "Transfer", "Check", "Card", "Bank"];

function poPaymentStage(amount: number, paid: number): "Unpaid" | "Partial" | "Paid" {
  if (paid <= 0.005) return "Unpaid";
  if (paid + 0.005 >= amount) return "Paid";
  return "Partial";
}

function VendorLedgerModal({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  const { t } = useTranslation();

  const { invoices, purchaseOrders, payments } = useStore();
  const name = vendor.name.trim().toLowerCase();
  const persistKey = `vendorLedger:${vendor.id}`;
  const persisted: any = (() => {
    if (typeof window === "undefined") return null;
    try {
      return JSON.parse(localStorage.getItem(persistKey) ?? "null");
    } catch {
      return null;
    }
  })();
  const [tab, setTab] = useState<"ledger" | "activity">(persisted?.tab ?? "ledger");
  const [search, setSearch] = useState<string>(persisted?.search ?? "");
  const [startDate, setStartDate] = useState<string>(persisted?.startDate ?? "");
  const [endDate, setEndDate] = useState<string>(persisted?.endDate ?? "");
  const [poStatus, setPoStatus] = useState<"All" | PurchaseOrderStatus>(
    persisted?.poStatus ?? "All",
  );
  const [payStage, setPayStage] = useState<"All" | "Unpaid" | "Partial" | "Paid">(
    persisted?.payStage ?? "All",
  );
  const [payMethod, setPayMethod] = useState<"All" | Payment["method"]>(
    persisted?.payMethod ?? "All",
  );
  const [activity, setActivity] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        persistKey,
        JSON.stringify({ tab, search, startDate, endDate, poStatus, payStage, payMethod }),
      );
    } catch {
      /* ignore quota */
    }
  }, [persistKey, tab, search, startDate, endDate, poStatus, payStage, payMethod]);

  const inRange = (iso: string | undefined | null) => {
    if (!iso) return true;
    if (startDate && iso < startDate) return false;
    if (endDate && iso > endDate) return false;
    return true;
  };
  const matchesSearch = (...parts: (string | number | undefined | null)[]) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return parts.some((p) => p != null && String(p).toLowerCase().includes(q));
  };

  const allVendorInvoices = useMemo(
    () => invoices.filter((i) => (i.vendorName ?? "").trim().toLowerCase() === name),
    [invoices, name],
  );
  const allVendorPOs = useMemo(
    () => purchaseOrders.filter((p) => (p.vendorName ?? "").trim().toLowerCase() === name),
    [purchaseOrders, name],
  );

  const vendorInvoices = useMemo(
    () =>
      allVendorInvoices.filter(
        (i) => inRange(i.date) && matchesSearch(i.invoiceNo, i.description, i.department),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allVendorInvoices, search, startDate, endDate],
  );
  const vendorPOs = useMemo(
    () =>
      allVendorPOs
        .filter((p) => poStatus === "All" || p.status === poStatus)
        .filter((p) => inRange(p.date))
        .filter((p) => {
          if (payStage === "All") return true;
          const paid = sumPaymentsFor(payments, "purchase_order", p.id);
          return poPaymentStage(Number(p.amount || 0), paid) === payStage;
        })
        .filter((p) => matchesSearch(p.poNumber, p.description, p.status)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allVendorPOs, payments, poStatus, payStage, search, startDate, endDate],
  );

  const invoiceTotal = vendorInvoices.reduce((s, i) => s + Number(i.price || 0), 0);
  const poTotal = vendorPOs.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalBilled = invoiceTotal + poTotal;
  const invoicePaid = vendorInvoices.reduce(
    (s, i) => s + sumPaymentsFor(payments, "invoice", i.id),
    0,
  );
  const poPaid = vendorPOs.reduce(
    (s, p) => s + sumPaymentsFor(payments, "purchase_order", p.id),
    0,
  );
  const totalPaid = invoicePaid + poPaid;
  const outstanding = Math.max(0, totalBilled - totalPaid);

  const vendorPayments: (Payment & { label: string })[] = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const i of vendorInvoices)
      labels[`invoice:${i.id}`] = `Invoice #${i.invoiceNo || i.id.slice(0, 6)}`;
    for (const p of vendorPOs)
      labels[`purchase_order:${p.id}`] = `PO ${p.poNumber || p.id.slice(0, 6)}`;
    return payments
      .filter((pm) => labels[`${pm.sourceType}:${pm.sourceId}`] !== undefined)
      .filter((pm) => inRange(pm.paymentDate))
      .filter((pm) => payMethod === "All" || pm.method === payMethod)
      .filter((pm) => matchesSearch(pm.method, pm.notes, labels[`${pm.sourceType}:${pm.sourceId}`]))
      .map((pm) => ({ ...pm, label: labels[`${pm.sourceType}:${pm.sourceId}`] }))
      .sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, vendorInvoices, vendorPOs, payMethod, search, startDate, endDate]);

  const resetFilters = () => {
    setSearch("");
    setStartDate("");
    setEndDate("");
    setPoStatus("All");
    setPayStage("All");
    setPayMethod("All");
  };

  // Activity log — audit_history rows for this vendor + linked POs + invoices + payments.
  useEffect(() => {
    if (tab !== "activity") return;
    let cancelled = false;
    setActivityLoading(true);
    (async () => {
      const poIds = allVendorPOs.map((p) => p.id);
      const invIds = allVendorInvoices.map((i) => i.id);
      const payIds = payments
        .filter(
          (pm) =>
            (pm.sourceType === "purchase_order" && poIds.includes(pm.sourceId)) ||
            (pm.sourceType === "invoice" && invIds.includes(pm.sourceId)),
        )
        .map((pm) => pm.id);
      const parts: any[][] = [];
      const push = async (table: string, ids: string[]) => {
        if (!ids.length) return;
        const { data } = await supabase
          .from("audit_history" as any)
          .select(
            "id, created_at, table_name, operation, actor_id, changed_fields, old_row, new_row",
          )
          .eq("table_name", table)
          .in("record_id", ids)
          .order("created_at", { ascending: false })
          .limit(100);
        if (data) parts.push(data as any[]);
      };
      await Promise.all([
        push("vendors", [vendor.id]),
        push("purchase_orders", poIds),
        push("invoices", invIds),
        push("payments", payIds),
      ]);
      if (cancelled) return;
      const merged = parts
        .flat()
        .sort((a: any, b: any) => (b.created_at || "").localeCompare(a.created_at || ""));
      setActivity(merged);
      setActivityLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, vendor.id, allVendorPOs.length, allVendorInvoices.length, payments.length]);

  const exportRows = () => {
    const poRows = vendorPOs.map((p) => {
      const paid = sumPaymentsFor(payments, "purchase_order", p.id);
      return {
        Type: "PO",
        Reference: p.poNumber,
        Description: p.description,
        Date: p.date,
        Status: p.status,
        Stage: poPaymentStage(Number(p.amount || 0), paid),
        Amount: Number(p.amount || 0),
        Paid: paid,
        Outstanding: Math.max(0, Number(p.amount || 0) - paid),
      };
    });
    const invRows = vendorInvoices.map((i) => {
      const paid = sumPaymentsFor(payments, "invoice", i.id);
      return {
        Type: "Invoice",
        Reference: i.invoiceNo || i.id.slice(0, 6),
        Description: i.description,
        Date: i.date,
        Status: "",
        Stage: poPaymentStage(Number(i.price || 0), paid),
        Amount: Number(i.price || 0),
        Paid: paid,
        Outstanding: Math.max(0, Number(i.price || 0) - paid),
      };
    });
    const payRows = vendorPayments.map((pm) => ({
      Date: pm.paymentDate,
      Source: pm.label,
      Method: pm.method,
      Amount: Number(pm.amount || 0),
      Notes: pm.notes ?? "",
    }));
    const summary = [
      { Metric: "Total Billed", Value: totalBilled },
      { Metric: "Total Paid", Value: totalPaid },
      { Metric: "Outstanding", Value: outstanding },
      { Metric: "Invoices", Value: vendorInvoices.length },
      { Metric: "Purchase Orders", Value: vendorPOs.length },
      { Metric: "Payments", Value: vendorPayments.length },
    ];
    return { poRows, invRows, payRows, summary };
  };

  const handleExportExcel = async () => {
    const { poRows, invRows, payRows, summary } = exportRows();
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(poRows.length ? poRows : [{ Note: "No POs" }]),
      "Purchase Orders",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(invRows.length ? invRows : [{ Note: "No Invoices" }]),
      "Invoices",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(payRows.length ? payRows : [{ Note: "No Payments" }]),
      "Payments",
    );
    const { writeBrandedSheetJs } = await import("@/lib/export/sheetjs-branding");
    await writeBrandedSheetJs(
      XLSX,
      wb,
      `Vendor Ledger ${vendor.name}`,
      `Vendor Ledger — ${vendor.name}`,
    );
    toast.success(t("accounting.excel_export_ready"));
  };

  const handleExportCsv = async () => {
    const { poRows, invRows, payRows, summary } = exportRows();
    const [{ downloadSectionedCSV }, { formatExportNumber }] = await Promise.all([
      import("@/lib/export-csv"),
      import("@/lib/export/number-format"),
    ]);
    // G04: money with 2 decimals; counts in the summary stay whole numbers.
    const summaryRows = summary.map((r, i) => ({
      Metric: r.Metric,
      Value: i < 3 ? formatExportNumber(Number(r.Value) || 0, 2) : r.Value,
    }));
    const money = { money: ["Amount", "Paid", "Outstanding"] };
    const none = t("closeout.csv.no_rows");
    downloadSectionedCSV(`vendor-ledger-${vendor.name.replace(/\s+/g, "_")}`, [
      { title: "Summary", rows: summaryRows, opts: { raw: ["Value"] } },
      { title: "Purchase Orders", rows: poRows, opts: money, emptyText: none },
      { title: "Invoices", rows: invRows, opts: money, emptyText: none },
      { title: "Payments", rows: payRows, opts: money, emptyText: none },
    ]);
    toast.success(t("accounting.csv_export_ready"));
  };

  const handleExportPdf = async () => {
    const { poRows, invRows, payRows, summary } = exportRows();
    const { exportPdfReport } = await import("@/lib/export-pdf");
    exportPdfReport(
      `vendor-ledger-${vendor.name.replace(/\s+/g, "_")}.pdf`,
      [
        {
          title: "Summary",
          headers: ["Metric", "Value"],
          rows: summary.map((s) => [s.Metric, String(s.Value)]),
          numericColumns: [1],
        },
        {
          title: "Purchase Orders",
          headers: [
            "PO #",
            "Description",
            "Date",
            "Status",
            "Stage",
            "Amount",
            "Paid",
            "Outstanding",
          ],
          rows: poRows.map((r) => [
            r.Reference,
            r.Description,
            r.Date,
            r.Status,
            r.Stage,
            r.Amount,
            r.Paid,
            r.Outstanding,
          ]),
          numericColumns: [5, 6, 7],
        },
        {
          title: "Invoices",
          headers: ["Invoice #", "Description", "Date", "Stage", "Amount", "Paid", "Outstanding"],
          rows: invRows.map((r) => [
            r.Reference,
            r.Description,
            r.Date,
            r.Stage,
            r.Amount,
            r.Paid,
            r.Outstanding,
          ]),
          numericColumns: [4, 5, 6],
        },
        {
          title: "Payments",
          headers: ["Date", "Source", "Method", "Amount", "Notes"],
          rows: payRows.map((r) => [r.Date, r.Source, r.Method, r.Amount, r.Notes]),
          numericColumns: [3],
        },
      ],
      { documentTitle: `Vendor Ledger — ${vendor.name}` },
    );
    toast.success(t("accounting.pdf_export_ready"));
  };

  return (
    <Modal onClose={onClose} title={`Vendor Ledger — ${vendor.name}`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          <button
            onClick={() => setTab("ledger")}
            className={`px-3 py-1.5 text-xs rounded-md ${tab === "ledger" ? "bg-brand text-brand-foreground font-semibold" : "text-muted-foreground"}`}
          >
            Ledger
          </button>
          <button
            onClick={() => setTab("activity")}
            className={`px-3 py-1.5 text-xs rounded-md ${tab === "activity" ? "bg-brand text-brand-foreground font-semibold" : "text-muted-foreground"}`}
          >
            Activity
          </button>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Download className="size-3.5" /> Excel
          </button>
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Download className="size-3.5" /> CSV
          </button>
          <button
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Download className="size-3.5" /> PDF
          </button>
        </div>
      </div>

      {tab === "ledger" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="rounded-xl border border-info/30 bg-info/10 p-3">
              <div className="text-[11px] text-info uppercase tracking-wide">
                {t("accounting.total_billed")}
              </div>
              <div className="text-xl font-semibold text-info mt-1">{formatUSD(totalBilled)}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {vendorInvoices.length} invoice{vendorInvoices.length === 1 ? "" : "s"} ·{" "}
                {vendorPOs.length} PO{vendorPOs.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="rounded-xl border border-success/30 bg-success/10 p-3">
              <div className="text-[11px] text-success uppercase tracking-wide">
                {t("accounting.total_paid")}
              </div>
              <div className="text-xl font-semibold text-success mt-1">{formatUSD(totalPaid)}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {vendorPayments.length} payment{vendorPayments.length === 1 ? "" : "s"}
              </div>
            </div>
            <div
              className={`rounded-xl border p-3 ${outstanding > 0 ? "border-warning/30 bg-warning/10" : "border-border bg-surface"}`}
            >
              <div className="text-[11px] uppercase tracking-wide text-warning">
                {t("accounting.outstanding_balance")}
              </div>
              <div
                className={`text-xl font-semibold mt-1 ${outstanding > 0 ? "text-warning" : "text-muted-foreground"}`}
              >
                {formatUSD(outstanding)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Terms: {vendor.paymentTerms || "—"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4 rounded-xl border border-border bg-surface p-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("accounting.search_description_notes")}
              className="flex-1 min-w-[180px] bg-transparent border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:ring-2 ring-brand/40"
            />
            <label className="text-[11px] text-muted-foreground flex items-center gap-1">
              From{" "}
              <DateInput
                value={startDate}
                onChange={(v) => setStartDate(v)}
                className="bg-transparent border border-border rounded-md px-1.5 py-1 text-xs"
              />
            </label>
            <label className="text-[11px] text-muted-foreground flex items-center gap-1">
              To{" "}
              <DateInput
                value={endDate}
                onChange={(v) => setEndDate(v)}
                className="bg-transparent border border-border rounded-md px-1.5 py-1 text-xs"
              />
            </label>
            <select
              value={poStatus}
              onChange={(e) => setPoStatus(e.target.value as any)}
              className="bg-transparent border border-border rounded-md px-2 py-1 text-xs"
            >
              <option value="All">{t("accounting.po_status_all")}</option>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={payStage}
              onChange={(e) => setPayStage(e.target.value as any)}
              className="bg-transparent border border-border rounded-md px-2 py-1 text-xs"
            >
              <option value="All">{t("accounting.stage_all")}</option>
              <option>{t("platform.ui.unpaid")}</option>
              <option>{t("platform.ui.partial")}</option>
              <option>{t("platform.ui.paid")}</option>
            </select>
            <select
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as any)}
              className="bg-transparent border border-border rounded-md px-2 py-1 text-xs"
            >
              <option value="All">{t("accounting.method_all")}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              onClick={resetFilters}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              Reset
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <FileText className="size-4" />
                {t("accounting.purchase_orders")}
              </h4>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-surface text-muted-foreground">
                    <tr>
                      <th className="text-start p-2">PO #</th>
                      <th className="text-start p-2">{t("platform.ui.description")}</th>
                      <th className="text-start p-2">{t("accounting.date")}</th>
                      <th className="text-start p-2">{t("accounting.status")}</th>
                      <th className="text-start p-2">{t("platform.ui.stage")}</th>
                      <th className="text-end p-2">{t("accounting.amount")}</th>
                      <th className="text-end p-2">{t("platform.ui.paid")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorPOs.map((p) => {
                      const paid = sumPaymentsFor(payments, "purchase_order", p.id);
                      const stage = poPaymentStage(Number(p.amount || 0), paid);
                      return (
                        <tr key={p.id} className="border-t border-border">
                          <td className="p-2 font-mono">{p.poNumber}</td>
                          <td className="p-2">{p.description}</td>
                          <td className="p-2 text-muted-foreground">
                            {formatDate(p.date) || p.date}
                          </td>
                          <td className="p-2">{p.status}</td>
                          <td className="p-2">{stage}</td>
                          <td className="p-2 text-end">{formatUSD(Number(p.amount || 0))}</td>
                          <td className="p-2 text-end text-success">{formatUSD(paid)}</td>
                        </tr>
                      );
                    })}
                    {vendorPOs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-muted-foreground">
                          {t("accounting.no_pos_match_the_filters")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <FileText className="size-4" /> {t("platform.ui.invoices")}
              </h4>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-surface text-muted-foreground">
                    <tr>
                      <th className="text-start p-2">{t("accounting.invoice")}</th>
                      <th className="text-start p-2">{t("platform.ui.description")}</th>
                      <th className="text-start p-2">{t("accounting.date")}</th>
                      <th className="text-end p-2">{t("platform.ui.total")}</th>
                      <th className="text-end p-2">{t("platform.ui.paid")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorInvoices.map((i) => {
                      const paid = sumPaymentsFor(payments, "invoice", i.id);
                      return (
                        <tr key={i.id} className="border-t border-border">
                          <td className="p-2 font-mono">{i.invoiceNo || i.id.slice(0, 6)}</td>
                          <td className="p-2">{i.description}</td>
                          <td className="p-2 text-muted-foreground">
                            {formatDate(i.date) || i.date}
                          </td>
                          <td className="p-2 text-end">{formatUSD(Number(i.price || 0))}</td>
                          <td className="p-2 text-end text-success">{formatUSD(paid)}</td>
                        </tr>
                      );
                    })}
                    {vendorInvoices.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-muted-foreground">
                          {t("accounting.no_invoices_match_the_filters")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Wallet className="size-4" /> Payments
              </h4>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-surface text-muted-foreground">
                    <tr>
                      <th className="text-start p-2">{t("accounting.date")}</th>
                      <th className="text-start p-2">{t("platform.ui.source")}</th>
                      <th className="text-start p-2">{t("accounting.method")}</th>
                      <th className="text-end p-2">{t("accounting.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorPayments.map((pm) => (
                      <tr key={pm.id} className="border-t border-border">
                        <td className="p-2 text-muted-foreground">
                          {formatDate(pm.paymentDate) || "—"}
                        </td>
                        <td className="p-2">{pm.label}</td>
                        <td className="p-2">{pm.method}</td>
                        <td className="p-2 text-end text-success">
                          {formatUSD(Number(pm.amount || 0))}
                        </td>
                      </tr>
                    ))}
                    {vendorPayments.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-muted-foreground">
                          {t("accounting.no_payments_match_the_filters")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "activity" && (
        <div className="rounded-xl border border-border overflow-hidden">
          {activityLoading && (
            <div className="p-6 text-sm text-muted-foreground">Loading activity…</div>
          )}
          {!activityLoading && activity.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">
              {t("accounting.no_recorded_changes_yet")}
            </div>
          )}
          {!activityLoading && activity.length > 0 && (
            <ul className="divide-y divide-border max-h-[420px] overflow-auto">
              {activity.map((r) => {
                const label = (r.new_row?.name ??
                  r.new_row?.po_number ??
                  r.new_row?.invoice_no ??
                  r.old_row?.name ??
                  r.old_row?.po_number ??
                  r.old_row?.invoice_no ??
                  "—") as string;
                const changed = Object.keys(r.changed_fields ?? {});
                const desc =
                  r.operation === "INSERT"
                    ? `Created ${r.table_name.replace(/_/g, " ")} "${label}"`
                    : r.operation === "DELETE"
                      ? `Deleted ${r.table_name.replace(/_/g, " ")} "${label}"`
                      : `Updated ${r.table_name.replace(/_/g, " ")} "${label}" (${changed.join(", ") || "no diff"})`;
                return (
                  <li
                    key={r.id}
                    className="px-3 py-2.5 text-xs flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{desc}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        by {r.actor_id ? r.actor_id.slice(0, 8) : "system"}
                      </div>
                    </div>
                    <time className="text-[10px] text-muted-foreground shrink-0" dir="ltr">
                      {formatDateTime(r.created_at)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Invoice Tab ---------------- */

/** Blank invoice for the "New Invoice" form. */
function newInvoiceDraft(vendorName: string, today: string, baseCurrency = "SAR"): Invoice {
  return {
    id: "",
    description: "",
    department: "",
    budgetCode: "",
    price: 0,
    vatable: true,
    date: today,
    invoiceNo: "",
    vendorName,
    purchaserName: "",
    purchaserId: null,
    paymentTerm: 100,
    glAccountId: null,
    beneficiaryId: null,
    serviceInsideKsa: true,
    rebateManualOverride: false,
    rebateEligible: true,
    vatTreatment: "standard",
    vatAmount: 0,
    paymentMethod: "bank_transfer",
    currency: baseCurrency,
    fxRate: 1,
    purchaseOrderId: null,
    paymentTerms: null,
    dueDate: today,
    servicePeriodFrom: null,
    servicePeriodTo: null,
    serviceReceivedDate: null,
    isRelatedParty: false,
    relatedPartyNote: null,
  };
}

export function InvoiceTab({ focus }: { focus?: string } = {}) {
  const { t } = useTranslation();

  const {
    invoices,
    vendors,
    budget,
    addInvoice,
    updateInvoice,
    addPayroll,
    removeInvoice,
    purchaseOrders,
    payments,
    people,
  } = useStore();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const can = useCan();
  const { requireOrToast } = usePermissionCheck();
  const { rows: glAccounts } = useGlAccounts();
  const purchasers = useMemo(
    () => people.filter((p) => p.isPurchaser).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [people],
  );
  const [open, setOpen] = useState(false);
  const [editFor, setEditFor] = useState<Invoice | null>(null);
  const [payFor, setPayFor] = useState<PaymentSourceInfo | null>(null);
  const vatRate = useVatStandardRate();
  const fx = useProjectFx(activeProjectId);
  const [f, setF] = useState<Invoice>(() =>
    newInvoiceDraft(vendors[0]?.name ?? "Cash", new Date().toISOString().slice(0, 10)),
  );
  // B15: the due date follows invoice date + vendor terms until edited by hand.
  const [dueDirty, setDueDirty] = useState(false);
  // B15: the single default installment follows the due date until edited.
  const [scheduleDateTouched, setScheduleDateTouched] = useState(false);
  // E09: GL account follows the budget code until picked by hand.
  const [glManual, setGlManual] = useState(false);
  const [invoicePdf, setInvoicePdf] = useState<File | null>(null);

  // Highlight & auto-scroll to a deep-linked invoice (e.g. from Vendor Payables).
  const [focusedId, setFocusedId] = useState<string | undefined>(focus);
  useEffect(() => {
    setFocusedId(focus);
  }, [focus]);
  useEffect(() => {
    if (!focusedId) return;
    const el = document.getElementById(`invoice-row-${focusedId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const t = setTimeout(() => setFocusedId(undefined), 3500);
    return () => clearTimeout(t);
  }, [focusedId, invoices.length]);

  const [receiptPdf, setReceiptPdf] = useState<File | null>(null);
  const [invoiceUrlInput, setInvoiceUrlInput] = useState("");
  const [receiptUrlInput, setReceiptUrlInput] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [supportingUrl, setSupportingUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [schedule, setSchedule] = useState<{ date: string; pct: number; amount?: number | null }[]>(
    [{ date: new Date().toISOString().slice(0, 10), pct: 100, amount: null }],
  );
  const [lastAddedIdx, setLastAddedIdx] = useState<number | null>(null);
  // Auditor-facing VAT breakdown: user types VAT Amount and the Total on the
  // physical invoice; we validate excl + VAT ≈ total before allowing submit
  // or letting the record flow through as QFE-eligible.
  const [vatAmountInput, setVatAmountInput] = useState<number>(0);
  const [totalInput, setTotalInput] = useState<number>(0);
  // Track whether the user manually edited the VAT/Total fields. As long as
  // they haven't, we keep them in sync with the computed values so typing
  // "1000" in Excl. VAT auto-fills 150 and 1150 (not the stale 0.15 / 1.15
  // that a fixed-threshold auto-sync would leave behind).
  const [vatDirty, setVatDirty] = useState(false);
  const [totalDirty, setTotalDirty] = useState(false);
  // E07: VAT treatment + rate from the platform setting; the VAT on the
  // vendor's document is accepted within a rounding tolerance.
  const vatTreatment: VatTreatment = f.vatTreatment ?? "standard";
  const expectedVat = calcExpectedVat(Number(f.price) || 0, vatTreatment, vatRate);
  const expectedTotal = +((Number(f.price) || 0) + expectedVat).toFixed(2);
  const enteredSum = +((Number(f.price) || 0) + (Number(vatAmountInput) || 0)).toFixed(2);
  const vatMathValid =
    Math.abs(enteredSum - (Number(totalInput) || 0)) < 0.01 && (Number(totalInput) || 0) > 0;
  const vatExpectedValid = vatWithinTolerance(Number(vatAmountInput) || 0, expectedVat);
  // B09/E08: amounts are typed in the invoice currency, stored in the base currency.
  const isBaseCcy = !f.currency || f.currency === fx.baseCurrency;
  const fxUsed = isBaseCcy ? 1 : Number(f.fxRate) || 0;
  const priceBase = toBaseAmount(Number(f.price) || 0, fxUsed);
  const selectedVendor = vendors.find((v) => v.name === f.vendorName);
  // B05/X12: purchase orders that can take this invoice.
  const poChoices = useMemo(
    () =>
      purchaseOrders.filter(
        (p) =>
          poIsCommitment(p.status) &&
          (!selectedVendor ||
            p.vendorId === selectedVendor.id ||
            p.vendorName.trim().toLowerCase() === selectedVendor.name.trim().toLowerCase()),
      ),
    [purchaseOrders, selectedVendor],
  );
  const linkedPo = f.purchaseOrderId
    ? (purchaseOrders.find((p) => p.id === f.purchaseOrderId) ?? null)
    : null;
  const poMatch = linkedPo
    ? matchInvoiceToPo(Number(linkedPo.amount) || 0, invoicedOnPo(linkedPo.id, invoices), priceBase)
    : null;
  const totalPct = useMemo(
    () => schedule.reduce((a, r) => a + (Number(r.pct) || 0), 0),
    [schedule],
  );
  const scheduleAllocated = useMemo(
    () =>
      schedule.reduce(
        (a, r) => a + resolveSplitAmount(r.pct, Number(totalInput) || 0, r.amount),
        0,
      ),
    [schedule, totalInput],
  );
  const scheduleValid = isScheduleTotalValid(totalPct);
  const attachmentDuplicate = useMemo(
    () =>
      findDuplicateAttachmentUrl(attachmentUrl, attachmentRecordsForProject(people, invoices), {
        projectId: activeProjectId,
      }),
    [activeProjectId, attachmentUrl, invoices, people],
  );
  // Only what the user typed counts as unsaved: values the form derives by
  // itself (terms, due date, GL account, QFE flag, installment date) are left
  // out, so a freshly reset form is never "dirty" (B23).
  const { dirty: invoiceDirty, reset: resetInvoiceDirty } = useDirtyTracker([
    {
      ...f,
      paymentTerms: undefined,
      dueDate: dueDirty ? f.dueDate : undefined,
      glAccountId: glManual ? f.glAccountId : undefined,
      rebateEligible: f.rebateManualOverride ? f.rebateEligible : undefined,
    },
    scheduleDateTouched ? schedule : schedule.map((r) => ({ ...r, date: "" })),
  ]);

  // Draft persistence — an accidental refresh or tab close never loses typed
  // invoice data or payment splits (files can't be serialized and are skipped).
  const invoiceDraftKey = draftKey("invoice", "new", activeProjectId ?? "no-project");
  const invoiceDraft = useMemo(
    () => ({
      f,
      schedule,
      invoiceUrlInput,
      receiptUrlInput,
      supportingUrl,
      attachmentUrl,
      vatAmountInput,
      totalInput,
      vatDirty,
      totalDirty,
    }),
    [
      f,
      schedule,
      invoiceUrlInput,
      receiptUrlInput,
      supportingUrl,
      attachmentUrl,
      vatAmountInput,
      totalInput,
      vatDirty,
      totalDirty,
    ],
  );
  const { clear: clearInvoiceDraft } = useFormDraft(invoiceDraftKey, invoiceDraft, (saved: any) => {
    if (!saved) return;
    if (saved.f) setF(saved.f);
    if (Array.isArray(saved.schedule) && saved.schedule.length) setSchedule(saved.schedule);
    if (typeof saved.invoiceUrlInput === "string") setInvoiceUrlInput(saved.invoiceUrlInput);
    if (typeof saved.receiptUrlInput === "string") setReceiptUrlInput(saved.receiptUrlInput);
    if (typeof saved.supportingUrl === "string") setSupportingUrl(saved.supportingUrl);
    if (typeof saved.attachmentUrl === "string") setAttachmentUrl(saved.attachmentUrl);
    if (typeof saved.vatAmountInput === "number") setVatAmountInput(saved.vatAmountInput);
    if (typeof saved.totalInput === "number") setTotalInput(saved.totalInput);
    if (saved.vatDirty) setVatDirty(true);
    if (saved.totalDirty) setTotalDirty(true);
    toast.info(t("accounting.unsaved_invoice_draft_restored"));
  });
  useUnsavedChangesWarning(invoiceDirty);
  // Quick add: new row pre-fills the remaining percentage and takes focus.
  const addScheduleRow = () =>
    setSchedule((s) => {
      const used = s.reduce((a, r) => a + (Number(r.pct) || 0), 0);
      setLastAddedIdx(s.length);
      return [...s, { date: f.date, pct: Math.max(0, +(100 - used).toFixed(2)), amount: null }];
    });
  const [err, setErr] = useState<string | null>(null);

  // Budget mapping row id for the invoice (authoritative many-to-one key).
  const [invoiceLineId, setInvoiceLineId] = useState<string | null>(null);

  const reset = () => {
    const today = new Date().toISOString().slice(0, 10);
    setF(newInvoiceDraft(vendors[0]?.name ?? "Cash", today, fx.baseCurrency));
    setDueDirty(false);
    setScheduleDateTouched(false);
    setGlManual(false);
    setInvoicePdf(null);
    setReceiptPdf(null);
    setErr(null);
    setInvoiceUrlInput("");
    setReceiptUrlInput("");
    setSupportingUrl("");
    setAttachmentUrl("");
    clearInvoiceDraft();
    setVatAmountInput(0);
    setTotalInput(0);
    setVatDirty(false);
    setTotalDirty(false);
    setSchedule([{ date: today, pct: 100, amount: null }]);
    setLastAddedIdx(null);
    resetInvoiceDirty();
    setInvoiceLineId(null);
  };

  // Keep VAT + Total in sync with Excl. VAT × rate until the user overrides them.
  useEffect(() => {
    if (!vatDirty) setVatAmountInput(expectedVat);
    if (!totalDirty) setTotalInput(expectedTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.price, vatTreatment, vatRate]);

  // E05: a new invoice inherits the vendor profile (CR, VAT, country, tax
  // residency → WHT, bank, related party).
  const invoice190 = useHasColumn("invoices", "vendor_id");
  useEffect(() => {
    const patch: Partial<Invoice> = invoicePatchFromVendor(selectedVendor);
    if (!invoice190) {
      // db/pending/190 not applied: keep only the flags the invoice already has
      for (const k of [
        "vendorId",
        "vendorCrNo",
        "vendorVatNo",
        "vendorCountry",
        "vendorTaxResidency",
        "vendorBankCountry",
        "vendorBankName",
      ] as const)
        delete patch[k];
    }
    setF((prev) => {
      const next = { ...prev, ...patch } as Invoice;
      // a vatable KSA supply is never an international WHT vendor (existing rule)
      if (prev.vatable) next.isNonSaudiVendor = false;
      if (!selectedVendor) {
        next.isNonSaudiVendor = prev.isNonSaudiVendor;
        next.isRelatedParty = prev.isRelatedParty;
        next.relatedPartyNote = prev.relatedPartyNote;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.vendorName, vendors, invoice190]);

  // B15: vendor payment terms → due date (invoice date + terms).
  useEffect(() => {
    const terms = selectedVendor?.paymentTerms || null;
    setF((prev) => (prev.paymentTerms === terms ? prev : { ...prev, paymentTerms: terms }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.vendorName, vendors]);
  useEffect(() => {
    if (dueDirty) return;
    const due = dueDateFromTerms(f.date, f.paymentTerms);
    setF((prev) => (prev.dueDate === due ? prev : { ...prev, dueDate: due }));
  }, [f.date, f.paymentTerms, dueDirty]);
  useEffect(() => {
    if (scheduleDateTouched) return;
    const target = f.dueDate || f.date;
    if (!target) return;
    setSchedule((s) => (s.length === 1 && s[0].date !== target ? [{ ...s[0], date: target }] : s));
  }, [f.dueDate, f.date, scheduleDateTouched]);

  // E09: GL account from the budget code (organization mapping, then code range).
  useEffect(() => {
    if (glManual) return;
    const code = f.budgetCode;
    if (!code) return;
    let cancelled = false;
    void fetchMappedGlAccount(activeProject?.organizationId, code).then((mapped) => {
      if (cancelled) return;
      const id = deriveGlAccountId(code, glAccounts, mapped);
      setF((prev) =>
        prev.budgetCode !== code || prev.glAccountId === id ? prev : { ...prev, glAccountId: id },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [f.budgetCode, glAccounts, glManual, activeProject?.organizationId]);

  // Legacy invoices.rebate_eligible is still filled from the QFE rules so the
  // column stays consistent; the UI no longer shows or edits it (eligibility
  // comes from the rebate module's single source, db/pending/197).
  useEffect(() => {
    if (f.rebateManualOverride) return;
    const beneficiary = f.beneficiaryId ? people.find((p) => p.id === f.beneficiaryId) : null;
    const vendor = f.vendorName ? vendors.find((v) => v.name === f.vendorName) : undefined;
    const auto = computeAutoQfe({
      serviceInsideKsa: f.serviceInsideKsa !== false,
      description: f.description,
      department: f.department,
      budgetCode: f.budgetCode,
      beneficiaryNationality: beneficiary?.nationality ?? null,
      beneficiaryMotherSaudi: beneficiary?.motherSaudi ?? null,
      vendorNationality: vendor?.companyNationality ?? null,
      vendorCrNo: vendor?.crNo ?? null,
      isNonSaudiVendor: !!f.isNonSaudiVendor,
    });
    if (!!f.rebateEligible !== auto) setF((prev) => ({ ...prev, rebateEligible: auto }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    f.beneficiaryId,
    f.serviceInsideKsa,
    f.vendorName,
    f.isNonSaudiVendor,
    f.description,
    f.department,
    f.budgetCode,
    f.rebateManualOverride,
    people,
    vendors,
  ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const fail = (msg: string) => {
      setErr(msg);
      toast.error(msg);
    };
    if (invoicePdf && invoicePdf.type !== "application/pdf") {
      fail("Invoice attachment must be a PDF file.");
      return;
    }
    if (receiptPdf && receiptPdf.type !== "application/pdf") {
      fail("Receipt attachment must be a PDF file.");
      return;
    }
    if (!f.invoiceNo?.trim()) {
      fail("Invoice Number is required.");
      return;
    }
    if (!f.vendorName?.trim()) {
      fail("Vendor is required.");
      return;
    }
    if (!f.date) {
      fail("Invoice Date is required.");
      return;
    }
    if (!f.price || f.price <= 0) {
      fail("Excl. VAT amount must be greater than 0.");
      return;
    }
    // B14: a Purchaser is only needed when the money came from a person's float / card.
    if (methodNeedsPurchaser(f.paymentMethod) && !f.purchaserId) {
      fail(t("ap.purchaser_required_for_method"));
      return;
    }
    // Budget code is optional — accountants can map to master budget later.
    if (!vatMathValid) {
      fail("VAT check failed: (Excl. VAT + VAT Amount) must equal the Total Invoice Amount.");
      return;
    }
    if (vatTreatment === "standard" && !vatExpectedValid) {
      fail(t("ap.vat_mismatch", { rate: vatRate, expected: expectedVat.toFixed(2) }));
      return;
    }
    if (vatTreatment === "standard" && selectedVendor && !selectedVendor.vatNo?.trim()) {
      fail(t("ap.vendor_vat_required", { vendor: selectedVendor.name }));
      return;
    }
    if (!isBaseCcy && !(fxUsed > 0)) {
      fail(t("ap.fx_rate_required"));
      return;
    }
    if (f.servicePeriodFrom && f.servicePeriodTo && f.servicePeriodTo < f.servicePeriodFrom) {
      fail(t("ap.service_period_order"));
      return;
    }
    if (f.budgetCode && !f.glAccountId) {
      fail(t("ap.gl_required"));
      return;
    }
    if (!scheduleValid) {
      fail("Payment Schedule total must equal 100%.");
      return;
    }
    if (schedule.some((r) => !r.date)) {
      fail("Every milestone row needs a date.");
      return;
    }
    if (!isValidAttachmentUrl(attachmentUrl)) {
      fail("Attachment URL must start with http:// or https://.");
      return;
    }
    if (attachmentDuplicate) {
      fail(`Attachment URL is already used on ${attachmentDuplicate.label}.`);
      return;
    }
    if (!activeProjectId) {
      fail("An active project is required before saving an invoice.");
      return;
    }
    setSubmitting(true);
    const id = generateId();
    try {
      const up = async (file: File, kind: "invoice" | "receipt") => {
        // Storage keys must be ASCII — non-ASCII names (Arabic/CJK) throw "Invalid key".
        // Use a UUID path; the original filename is preserved in DB metadata/URL fields.
        const dot = file.name.lastIndexOf(".");
        const ext =
          dot > -1
            ? file.name
                .slice(dot + 1)
                .replace(/[^A-Za-z0-9]/g, "")
                .slice(0, 10)
                .toLowerCase()
            : "";
        const safeExt = ext ? `.${ext}` : "";
        assertUploadAllowed(file);
        const path = `${activeProjectId}/invoices/${id}/${kind}-${crypto.randomUUID()}${safeExt}`;
        const { error } = await supabase.storage
          .from("contracts")
          .upload(path, file, { contentType: uploadContentType(file), upsert: false });
        if (error) throw error;
      };
      const uploads: Promise<void>[] = [];
      if (invoicePdf) uploads.push(up(invoicePdf, "invoice"));
      if (receiptPdf) uploads.push(up(receiptPdf, "receipt"));
      if (uploads.length) await Promise.all(uploads);

      // Classify schedule rows: those dated on/before invoice date are paid-now (actuals);
      // those scheduled later become open liabilities routed to Payroll/AP.
      const invoiceDate = f.date;
      const paidNow = schedule.filter((r) => r.date <= invoiceDate);
      const dueLater = schedule.filter((r) => r.date > invoiceDate);
      const paidPct = +paidNow.reduce((a, r) => a + (Number(r.pct) || 0), 0).toFixed(4);

      // paymentTerm drives the Actuals split inside addInvoice + Reports useSummary
      const whtPercent = f.isNonSaudiVendor ? 5 : 0;
      const whtAmount = +(priceBase * (whtPercent / 100)).toFixed(2);
      const netPayable = +(priceBase - whtAmount).toFixed(2);
      const totalInclVat = toBaseAmount(Number(totalInput) || 0, fxUsed);
      if (poMatch && poMatch.status !== "match") {
        toast.warning(
          t(poMatch.status === "over" ? "ap.po_over_warning" : "ap.po_under_warning", {
            po: linkedPo?.poNumber ?? "",
            diff: formatUSD(Math.abs(poMatch.difference)),
          }),
        );
      }
      const invoicePayload: Invoice = {
        ...f,
        id,
        price: priceBase,
        vatAmount: toBaseAmount(Number(vatAmountInput) || 0, fxUsed),
        vatable: vatTreatment === "standard",
        vatTreatment,
        vatRate: vatTreatment === "standard" ? vatRate : null,
        currency: f.currency || fx.baseCurrency,
        fxRate: fxUsed,
        ...(invoice190
          ? {
              fxRateSource: isBaseCcy ? null : (f.fxRateSource ?? "manual"),
              fxRateDate: isBaseCcy ? null : (f.fxRateDate ?? null),
            }
          : {}),
        amountOriginal: Number(f.price) || 0,
        purchaserId: f.purchaserId || null,
        projectId: activeProjectId,
        organizationId: activeProject?.organizationId ?? null,
        paymentTerm: paidPct,
        whtPercent,
        whtAmount,
        netPayable,
        invoiceUrl: invoiceUrlInput.trim() || null,
        receiptUrl: receiptUrlInput.trim() || null,
        attachmentUrl: normalizeAttachmentUrl(attachmentUrl),
      };
      console.log("SUBMIT PAYLOAD:", invoicePayload);
      await addInvoice(invoicePayload);
      if (supportingUrl.trim())
        void setSupportingDocUrl("invoice", id, supportingUrl).catch(() => undefined);

      // Inject one scheduled liability per future milestone (based on Total incl. VAT)
      for (let i = 0; i < dueLater.length; i++) {
        const row = dueLater[i];
        const pct = Number(row.pct) || 0;
        if (pct <= 0) continue;
        try {
          await addPayroll({
            id: generateId(),
            refId: `invoice:${id}:${i}`,
            name: `${f.vendorName || "Vendor"} — Invoice #${f.invoiceNo} — Due ${row.date}`,
            kind: "vendor",
            totalAmount: resolveSplitAmount(pct, totalInclVat, row.amount),
            payments: ["Due"],
            receipts: [null],
            percents: [100],
            budgetCode: f.budgetCode || null,
          });
        } catch (err) {
          console.error("Payroll milestone injection failed", err);
        }
      }

      const budgetLine = budget.find((b) => b.mainCode === f.budgetCode);
      const budgetName = budgetLine
        ? `${budgetLine.mainCode} — ${budgetLine.description}`
        : f.budgetCode;
      toast.success(
        `Invoice recorded against ${budgetName}. Paid portion posted to Actuals; balance queued in Payroll.`,
      );
      setOpen(false);
      reset();
    } catch (e: any) {
      const friendly = humanizeDbError(e);
      setErr(friendly);
      toast.error(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  // Compute the QFE rule per invoice (used by the filter + row badge).
  const invoiceRule = (i: Invoice): { rule: QfeRule; reason: string } => {
    const beneficiary = i.beneficiaryId ? people.find((p) => p.id === i.beneficiaryId) : null;
    const vendor = i.vendorName ? vendors.find((v) => v.name === i.vendorName) : undefined;
    const ex = explainAutoQfe({
      serviceInsideKsa: i.serviceInsideKsa !== false,
      description: i.description,
      department: i.department,
      budgetCode: i.budgetCode,
      beneficiaryNationality: beneficiary?.nationality ?? null,
      beneficiaryMotherSaudi: beneficiary?.motherSaudi ?? null,
      vendorNationality: vendor?.companyNationality ?? null,
      vendorCrNo: vendor?.crNo ?? null,
      isNonSaudiVendor: !!i.isNonSaudiVendor,
    });
    return { rule: ex.rule, reason: ex.reason };
  };

  const [qfeRuleFilter, setQfeRuleFilter] = useState<"all" | "A" | "B" | "C" | "override">("all");
  // G08: Kwalis reference number column + filter
  const [refQuery, setRefQuery] = useState("");
  // db/pending/201: invoice approval status filter + approver check
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>("all");
  const canApproveInvoices = useCanApproveInvoice(activeProjectId);
  const refs = useRefMap(invoices.length);
  const filteredInvoices = useMemo(() => {
    const byStatus =
      approvalFilter === "all"
        ? invoices
        : invoices.filter((i) => (i.approvalStatus ?? "approved") === approvalFilter);
    const byRule =
      qfeRuleFilter === "all"
        ? byStatus
        : qfeRuleFilter === "override"
          ? byStatus.filter((i) => !!i.rebateManualOverride)
          : byStatus.filter(
              (i) => !i.rebateManualOverride && invoiceRule(i).rule === qfeRuleFilter,
            );
    return refQuery.trim() ? byRule.filter((i) => refs.matches(i.id, refQuery)) : byRule;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, qfeRuleFilter, approvalFilter, people, vendors, refQuery, refs.refOf]);

  // Render only one page of rows at a time. Filtering above stays untouched —
  // pagination always operates on the already-filtered result set.
  const {
    pageRows: pagedInvoices,
    offset: invoiceOffset,
    paginationProps: invoicePagination,
  } = usePagedRows(filteredInvoices, 20);
  const storeReady = useStore((s) => s.ready);

  return (
    <Panel>
      <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
        <h3 className="text-xl font-semibold">{t("platform.ui.invoices")}</h3>
        <div className="flex gap-2 items-center flex-wrap">
          <RefFilterInput value={refQuery} onChange={setRefQuery} />
          <ApprovalFilterSelect value={approvalFilter} onChange={setApprovalFilter} />
          <label className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("accounting.qfe_rule")}
          </label>
          <select
            value={qfeRuleFilter}
            onChange={(e) => setQfeRuleFilter(e.target.value as any)}
            className="px-3 py-2 rounded-xl bg-surface-2 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
            title={t("accounting.filter_invoices_by_which_qfe_rule_or_manual")}
          >
            <option value="all">{t("accounting.all_rules")}</option>
            <option value="A">{t("platform.ui.ruleABeneficiaryResidency")}</option>
            <option value="B">{t("platform.ui.ruleBVendorNationality")}</option>
            <option value="C">{t("platform.ui.ruleCOutsideKsa")}</option>
            <option value="override">{t("accounting.manual_overrides")}</option>
          </select>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {filteredInvoices.length} of {invoices.length}
          </span>
          <button
            onClick={() => {
              if (!requireOrToast("invoices.add", "add invoices")) return;
              reset();
              setOpen(true);
            }}
            disabled={!can("invoices.add")}
            title={!can("invoices.add") ? "Permission required: invoices.add" : undefined}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-brand-foreground font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {!can("invoices.add") ? <Lock className="size-4" /> : <Plus className="size-4" />}New
            Invoice
          </button>
        </div>
      </div>
      {!storeReady && invoices.length === 0 ? (
        <TableSkeleton rows={8} cols={7} />
      ) : (
        <>
          <Table
            headers={[
              "#",
              t("polish.refs.ref_no"),
              "Description",
              "Dept",
              "Budget",
              "Price",
              "VAT",
              "Date",
              t("ap.due_date"),
              "Invoice #",
              "Vendor",
              "Purchaser",
              t("decisions.approval.column"),
              "Status",
              "Actions",
            ]}
          >
            {pagedInvoices.map((i, pageIdx) => {
              const idx = invoiceOffset + pageIdx;
              const bl = budget.find((b) => b.mainCode === i.budgetCode);
              // Paid status is driven ONLY by recorded/approved payments — never
              // by the payment schedule %. The schedule dictates WHEN money is
              // due, not IF it has been physically paid.
              const paidTotal = sumPaymentsFor(payments, "invoice", i.id);
              // B06/B16: what the vendor receives — incl. VAT, less WHT.
              const amountDue = invoiceAmountDue(i);
              const needsPurchaser = methodNeedsPurchaser(i.paymentMethod);
              const po = i.purchaseOrderId
                ? purchaseOrders.find((p) => p.id === i.purchaseOrderId)
                : null;
              return (
                <Fragment key={i.id}>
                  <tr
                    id={`invoice-row-${i.id}`}
                    className={`border-b border-border transition-colors ${focusedId === i.id ? "bg-brand/15 ring-2 ring-brand/60" : ""}`}
                  >
                    <Cell>{idx + 1}</Cell>
                    <Cell>
                      <RefText refNo={refs.refOf(i.id)} />
                    </Cell>
                    <Cell>
                      {i.description}
                      <InvoiceE08Details invoice={i} />
                    </Cell>
                    <Cell>{i.department}</Cell>
                    <Cell className="font-mono text-xs">
                      {i.budgetCode}
                      {bl ? ` · ${bl.description}` : ""}
                    </Cell>
                    <Cell className="font-semibold">{formatUSD(i.price)}</Cell>
                    <Cell>
                      {(Number(i.vatAmount) || 0) > 0
                        ? formatUSD(Number(i.vatAmount))
                        : t(`ap.vat.${i.vatTreatment ?? (i.vatable ? "standard" : "exempt")}`, {
                            rate: vatRate,
                          })}
                    </Cell>
                    <Cell>{formatDate(i.date) || i.date}</Cell>
                    <Cell className="whitespace-nowrap">{formatDate(i.dueDate) || "—"}</Cell>
                    <Cell className="font-mono">
                      {i.invoiceNo}
                      {po && <div className="text-[10px] text-muted-foreground">{po.poNumber}</div>}
                    </Cell>
                    <Cell>{i.vendorName}</Cell>
                    <Cell>
                      {i.purchaserId ? (
                        (people.find((pp) => pp.id === i.purchaserId)?.fullName ??
                        i.purchaserName ??
                        "—")
                      ) : needsPurchaser ? (
                        <span className="text-warning text-xs font-semibold">
                          {i.purchaserName || "— (unassigned)"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {t(`ap.method.${i.paymentMethod ?? "bank_transfer"}`)}
                        </span>
                      )}
                    </Cell>
                    <Cell>
                      <div className="flex flex-col items-start gap-1">
                        <ApprovalStatusPill
                          status={i.approvalStatus ?? "approved"}
                          reason={i.rejectionReason ?? i.cancellationReason}
                        />
                        <InvoiceApprovalActions invoice={i} canApprove={canApproveInvoices} />
                      </div>
                    </Cell>
                    <Cell>
                      <PaymentStatusPill paid={paidTotal} total={amountDue} />
                    </Cell>
                    <Cell>
                      <div className="flex items-center gap-1">
                        {i.invoiceUrl && (
                          <a
                            href={i.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t("accounting.open_invoice_link")}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-info/20 text-info text-xs font-semibold hover:bg-info/30 border border-info/30"
                          >
                            <ExternalLink className="size-3" />
                            Inv
                          </a>
                        )}
                        {i.receiptUrl && (
                          <a
                            href={i.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t("accounting.open_receipt_link")}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-info/20 text-info text-xs font-semibold hover:bg-info/30 border border-info/30"
                          >
                            <ExternalLink className="size-3" />
                            Rcpt
                          </a>
                        )}
                        <AttachmentLinkBadge
                          url={i.attachmentUrl}
                          compact
                          title={t("accounting.open_cloud_attachment")}
                        />
                        <button
                          onClick={() => {
                            if (needsPurchaser && !i.purchaserId) {
                              toast.error(
                                t("accounting.set_a_purchaser_paid_by_before_recording_payment"),
                              );
                              setEditFor(i);
                              return;
                            }
                            if (!requireOrToast("invoices.pay", "record invoice payments")) return;
                            setPayFor({
                              type: "invoice",
                              id: i.id,
                              label: `Invoice #${i.invoiceNo || i.id.slice(0, 6)} — ${i.vendorName}`,
                              totalAmount: amountDue,
                            });
                          }}
                          disabled={
                            paidTotal >= amountDue - 0.005 ||
                            !can("invoices.pay") ||
                            (i.approvalStatus ?? "approved") !== "approved"
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-success/20 text-success text-xs font-semibold hover:bg-success/30 border border-success/30 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={
                            !can("invoices.pay")
                              ? "Permission required: invoices.pay"
                              : (i.approvalStatus ?? "approved") !== "approved"
                                ? t("decisions.invoice.payNeedsApproval")
                                : needsPurchaser && !i.purchaserId
                                  ? "Assign a Purchaser first"
                                  : "Record Payment"
                          }
                        >
                          {!can("invoices.pay") ? (
                            <Lock className="size-3" />
                          ) : (
                            <DollarSign className="size-3" />
                          )}
                          Pay
                        </button>
                        <button
                          onClick={() => setEditFor(i)}
                          disabled={!can("transactions.modify")}
                          className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                          title={
                            !can("transactions.modify")
                              ? "Permission required: transactions.modify"
                              : "Edit invoice"
                          }
                        >
                          <Pencil className="size-4" />
                        </button>
                        <AttachmentsButton
                          entityType="invoice"
                          entityId={i.id}
                          entityLabel={`Invoice #${i.invoiceNo || i.id.slice(0, 6)} — ${i.vendorName}`}
                        />
                        <button
                          onClick={async () => {
                            if (!requireOrToast("transactions.modify", "delete/void invoices"))
                              return;
                            if (!confirm(`Delete invoice #${i.invoiceNo}? This cannot be undone.`))
                              return;
                            try {
                              await removeInvoice(i.id);
                              toast.success(`Invoice #${i.invoiceNo} deleted.`);
                            } catch (e: any) {
                              toast.error(e?.message ?? "Failed to delete invoice.");
                            }
                          }}
                          disabled={
                            !can("transactions.modify") ||
                            ["approved", "cancelled"].includes(i.approvalStatus ?? "approved")
                          }
                          className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                          title={
                            !can("transactions.modify")
                              ? "Permission required: transactions.modify"
                              : ["approved", "cancelled"].includes(i.approvalStatus ?? "approved")
                                ? t("decisions.invoice.deleteApproved")
                                : "Delete/Void"
                          }
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </Cell>
                  </tr>
                  <PaymentHistoryToggle
                    sourceType="invoice"
                    sourceId={i.id}
                    colSpan={15}
                    initialOpen={focusedId === i.id}
                  />
                </Fragment>
              );
            })}
            {filteredInvoices.length === 0 && (
              <TableEmptyRow
                colSpan={15}
                variant={invoices.length === 0 ? "empty" : "filtered"}
                title={invoices.length === 0 ? "No invoices yet" : "No matching invoices"}
                description={
                  invoices.length === 0
                    ? "Invoices you create for this project will appear here."
                    : refQuery.trim()
                      ? t("polish.refs.no_match")
                      : "No invoices match the selected QPE rule filter. Try switching back to All rules."
                }
                action={
                  invoices.length > 0 ? (
                    <button
                      onClick={() => {
                        setQfeRuleFilter("all");
                        setRefQuery("");
                      }}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted"
                    >
                      {t("accounting.all_rules")}
                    </button>
                  ) : undefined
                }
              />
            )}
          </Table>
          <TablePagination {...invoicePagination} />
        </>
      )}
      {payFor && <RecordPaymentModal source={payFor} onClose={() => setPayFor(null)} />}
      {editFor && (
        <EditInvoiceModal
          invoice={editFor}
          purchasers={purchasers}
          onClose={() => setEditFor(null)}
          onSave={async (patch) => {
            try {
              await updateInvoice(editFor.id, patch);
              toast.success(`Invoice #${editFor.invoiceNo} updated.`);
              setEditFor(null);
            } catch (e: any) {
              toast.error(humanizeDbError(e));
            }
          }}
        />
      )}
      {open && (
        <Modal title={t("accounting.new_invoice")} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <Field label={t("platform.ui.vendorName")}>
              <select
                value={f.vendorName}
                onChange={(e) => setF({ ...f, vendorName: e.target.value })}
                className={inputCls}
              >
                <option value="Cash">{t("platform.ui.cash")}</option>
                {vendors.map((v) => (
                  <option key={v.id}>{v.name}</option>
                ))}
              </select>
            </Field>
            <VendorInheritedSummary vendor={selectedVendor} />
            <Field label={t("platform.ui.date")}>
              <DateInput
                value={f.date}
                onChange={(iso) => setF({ ...f, date: iso })}
                className={inputCls}
              />
            </Field>
            <Field label={t("ap.vat_treatment")}>
              <select
                value={vatTreatment}
                onChange={(e) => {
                  const next = e.target.value as VatTreatment;
                  const standard = next === "standard";
                  // A standard-rated (KSA local supply) invoice can never be an
                  // international non-Saudi vendor subject to 5% WHT.
                  setF({
                    ...f,
                    vatTreatment: next,
                    vatable: standard,
                    isNonSaudiVendor: standard ? false : f.isNonSaudiVendor,
                  });
                  setVatDirty(false);
                  setTotalDirty(false);
                }}
                className={inputCls}
              >
                {VAT_TREATMENTS.map((v) => (
                  <option key={v} value={v}>
                    {t(`ap.vat.${v}`, { rate: vatRate })}
                  </option>
                ))}
              </select>
              {vatTreatment === "standard" && selectedVendor && !selectedVendor.vatNo?.trim() && (
                <p className="mt-1 text-[11px] text-warning">
                  {t("ap.vendor_vat_required", { vendor: selectedVendor.name })}
                </p>
              )}
            </Field>
            <Field label={t("platform.ui.internationalNonSaudiVendor5Wht")}>
              <select
                value={f.vatable ? "No" : f.isNonSaudiVendor ? "Yes" : "No"}
                onChange={(e) => setF({ ...f, isNonSaudiVendor: e.target.value === "Yes" })}
                className={inputCls}
                disabled={f.vatable}
                title={
                  f.vatable
                    ? "Locked to No — a vatable KSA invoice cannot be an international vendor."
                    : undefined
                }
              >
                <option>{t("platform.ui.no")}</option>
                <option>{t("platform.ui.yes")}</option>
              </select>
              {f.vatable && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Locked to “No” because the invoice is vatable (local KSA supply).
                </p>
              )}
            </Field>

            <Field label={t("ap.payment_method")}>
              <select
                value={f.paymentMethod ?? "bank_transfer"}
                onChange={(e) =>
                  setF({ ...f, paymentMethod: e.target.value as InvoicePaymentMethod })
                }
                className={inputCls}
              >
                {INVOICE_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`ap.method.${m}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("ap.purchaser_label")} required={methodNeedsPurchaser(f.paymentMethod)}>
              <select
                required={methodNeedsPurchaser(f.paymentMethod)}
                value={f.purchaserId ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  const p = id ? purchasers.find((pp) => pp.id === id) : null;
                  setF({ ...f, purchaserId: id, purchaserName: p?.fullName ?? "" });
                }}
                className={inputCls}
              >
                <option value="">
                  {methodNeedsPurchaser(f.paymentMethod)
                    ? "— Select Purchaser —"
                    : t("ap.purchaser_optional")}
                </option>
                {purchasers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                    {p.position ? ` · ${p.position}` : ""}
                  </option>
                ))}
              </select>
              {purchasers.length === 0 && methodNeedsPurchaser(f.paymentMethod) && (
                <div className="text-[11px] text-warning mt-1">
                  No purchasers yet — tick "Authorized Purchaser" on a Crew/Cast profile first.
                </div>
              )}
            </Field>
            <Field label={t("ap.gl_account")} required={!!f.budgetCode}>
              <GlAccountSelector
                value={f.glAccountId ?? null}
                onChange={(id) => {
                  setGlManual(true);
                  setF({ ...f, glAccountId: id });
                }}
                emptyLabel="— None —"
                placeholder={t("accounting.search_gl_code_or_name")}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {glManual ? (
                  <button
                    type="button"
                    className="text-brand hover:underline"
                    onClick={() => setGlManual(false)}
                  >
                    {t("ap.gl_reset_auto")}
                  </button>
                ) : (
                  t("ap.gl_auto_hint")
                )}
              </p>
            </Field>

            <div className="col-span-2 grid grid-cols-2 gap-3">
              <BudgetMappingSelect
                headerCode={f.department}
                lineId={invoiceLineId}
                required
                onChange={(v) => {
                  setInvoiceLineId(v.lineId);
                  setF({ ...f, department: v.headerCode, budgetCode: v.code });
                }}
              />
              <div className="col-span-2">
                <BudgetReadout
                  budgetCode={f.budgetCode}
                  pendingAmount={priceBase}
                  purchaseOrderId={f.purchaseOrderId}
                />
              </div>
            </div>

            <Field label={t("platform.ui.description")}>
              <input
                required
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label={t("platform.ui.invoice")}>
              <input
                required
                value={f.invoiceNo}
                onChange={(e) => setF({ ...f, invoiceNo: e.target.value })}
                className={inputCls}
              />
            </Field>
            {/* B05 / X12: raise the invoice against a purchase order */}
            <Field label={t("ap.purchase_order")} className="col-span-2">
              <select
                value={f.purchaseOrderId ?? ""}
                onChange={(e) => {
                  const po = purchaseOrders.find((p) => p.id === e.target.value) ?? null;
                  if (!po) return setF({ ...f, purchaseOrderId: null });
                  const line = po.linkedBudgetLineId
                    ? budget.find((b) => b.id === po.linkedBudgetLineId)
                    : budget.find((b) => b.mainCode === po.budgetCode);
                  if (!f.budgetCode && line) setInvoiceLineId(line.id);
                  setF({
                    ...f,
                    purchaseOrderId: po.id,
                    budgetCode: f.budgetCode || po.budgetCode || "",
                    department: f.budgetCode ? f.department : (line?.headerCode ?? f.department),
                    description: f.description || po.description,
                  });
                }}
                className={inputCls}
              >
                <option value="">{t("ap.no_purchase_order")}</option>
                {poChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.poNumber} · {p.vendorName} ·{" "}
                    {t("ap.po_open_amount", {
                      amount: formatUSD(poOpenCommitment(p, invoices)),
                    })}
                  </option>
                ))}
              </select>
              {linkedPo && poMatch && (
                <div
                  className={`mt-1 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                    poMatch.status === "match"
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-warning/40 bg-warning/10 text-warning"
                  }`}
                >
                  {poMatch.status === "match"
                    ? t("ap.po_match_ok", { po: linkedPo.poNumber })
                    : t(poMatch.status === "over" ? "ap.po_over_warning" : "ap.po_under_warning", {
                        po: linkedPo.poNumber,
                        diff: formatUSD(Math.abs(poMatch.difference)),
                      })}
                  {selectedVendor &&
                    linkedPo.vendorName.trim().toLowerCase() !==
                      selectedVendor.name.trim().toLowerCase() && (
                      <div>{t("ap.po_vendor_differs", { vendor: linkedPo.vendorName })}</div>
                    )}
                </div>
              )}
            </Field>
            <div className="col-span-2">
              <CurrencyFxFields
                fx={fx}
                currency={f.currency || fx.baseCurrency}
                fxRate={Number(f.fxRate) || 1}
                inputCls={inputCls}
                // D03: the rate in force on the invoice date, with its source
                projectId={invoice190 ? activeProjectId : null}
                date={f.date}
                rateSource={f.fxRateSource ?? null}
                rateDate={f.fxRateDate ?? null}
                onChange={(v) =>
                  setF((prev) => ({
                    ...prev,
                    currency: v.currency,
                    fxRate: v.fxRate,
                    ...(invoice190 && v.fxRateSource !== undefined
                      ? { fxRateSource: v.fxRateSource, fxRateDate: v.fxRateDate ?? null }
                      : {}),
                  }))
                }
              />
              {!isBaseCcy && (
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  {t("ap.amounts_in_currency_hint", { ccy: f.currency, base: fx.baseCurrency })}{" "}
                  {t("ap.equals_base", {
                    amount: formatAmount(priceBase, 2),
                    base: fx.baseCurrency,
                  })}
                </p>
              )}
            </div>
            <Field label={t("ap.payment_terms")}>
              <select
                value={f.paymentTerms ?? ""}
                onChange={(e) => {
                  setDueDirty(false);
                  setF({ ...f, paymentTerms: e.target.value || null });
                }}
                className={inputCls}
              >
                <option value="">{t("ap.terms_none")}</option>
                {VENDOR_PAYMENT_TERMS.map((term) => (
                  <option key={term} value={term}>
                    {term}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("ap.due_date")}>
              <DateInput
                value={f.dueDate ?? ""}
                onChange={(iso) => {
                  setDueDirty(true);
                  setF({ ...f, dueDate: iso || null });
                }}
                className={inputCls}
              />
            </Field>
            <Field label={t("ap.service_period_from")}>
              <DateInput
                value={f.servicePeriodFrom ?? ""}
                onChange={(iso) => setF({ ...f, servicePeriodFrom: iso || null })}
                className={inputCls}
              />
            </Field>
            <Field label={t("ap.service_period_to")}>
              <DateInput
                value={f.servicePeriodTo ?? ""}
                onChange={(iso) => setF({ ...f, servicePeriodTo: iso || null })}
                className={inputCls}
              />
            </Field>
            <Field label={t("ap.service_received_date")}>
              <DateInput
                value={f.serviceReceivedDate ?? ""}
                onChange={(iso) => setF({ ...f, serviceReceivedDate: iso || null })}
                className={inputCls}
              />
            </Field>
            <Field label={t("ap.related_party")}>
              <label className="flex items-center gap-2 text-sm normal-case tracking-normal">
                <input
                  type="checkbox"
                  checked={!!f.isRelatedParty}
                  onChange={(e) => setF({ ...f, isRelatedParty: e.target.checked })}
                />
                {t("ap.related_party_check")}
              </label>
              {f.isRelatedParty && (
                <input
                  value={f.relatedPartyNote ?? ""}
                  maxLength={1000}
                  placeholder={t("ap.related_party_note")}
                  onChange={(e) => setF({ ...f, relatedPartyNote: e.target.value })}
                  className={`mt-1 ${inputCls}`}
                />
              )}
            </Field>
            <div className="col-span-2">
              <div className="text-muted-foreground mb-2 uppercase tracking-wider text-xs">
                Amount Breakdown · تفاصيل المبالغ
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Excl. VAT · بدون ضريبة
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    step="0.01"
                    value={f.price}
                    onChange={(e) => setF({ ...f, price: +e.target.value })}
                    className={`${inputCls} ${vatMathValid ? "" : "!border-destructive/60 !ring-1 !ring-destructive/40"}`}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    VAT Amount · مبلغ الضريبة{" "}
                    {f.vatable && <span className="text-foreground/60">({vatRate}%)</span>}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={vatAmountInput}
                    disabled={!f.vatable}
                    onChange={(e) => {
                      setVatDirty(true);
                      setVatAmountInput(+e.target.value);
                    }}
                    className={`${inputCls} disabled:opacity-50 ${
                      vatMathValid && (!f.vatable || vatExpectedValid)
                        ? ""
                        : "!border-destructive/60 !ring-1 !ring-destructive/40"
                    }`}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Total Invoice · الإجمالي
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    step="0.01"
                    value={totalInput}
                    onChange={(e) => {
                      setTotalDirty(true);
                      setTotalInput(+e.target.value);
                    }}
                    className={`${inputCls} ${vatMathValid ? "" : "!border-destructive/60 !ring-1 !ring-destructive/40"}`}
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground tabular-nums">
                  Excl. + VAT ={" "}
                  <span
                    className={vatMathValid ? "text-success" : "text-destructive font-semibold"}
                  >
                    {formatUSD(enteredSum)}
                  </span>
                  {" · "}Total ={" "}
                  <span className="tabular-nums">{formatUSD(Number(totalInput) || 0)}</span>
                </span>
                {vatMathValid ? (
                  <span className="text-success font-medium">✓ VAT math OK</span>
                ) : (
                  <span className="text-destructive font-medium">✗ Amounts don't balance</span>
                )}
              </div>
            </div>

            {f.isNonSaudiVendor && Number(f.price) > 0 && (
              <div className="col-span-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Invoice Total · إجمالي الفاتورة</span>
                  <span className="tabular-nums" dir="ltr">
                    {formatUSD(Number(f.price) || 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-warning">
                  <span>Withholding Tax (5%) · ضريبة الاستقطاع</span>
                  <span className="tabular-nums" dir="ltr">
                    − {formatUSD(+((Number(f.price) || 0) * 0.05).toFixed(2))}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-warning/20 font-semibold">
                  <span>Net Payable · صافي المستحق</span>
                  <span className="tabular-nums" dir="ltr">
                    {formatUSD(+((Number(f.price) || 0) * 0.95).toFixed(2))}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground pt-1">
                  International vendor — 5% posts to Withholding Tax Liability (GL). Cash flow uses
                  Net Payable.
                </div>
              </div>
            )}
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-2">
                <div className="text-muted-foreground uppercase tracking-wider text-xs">
                  {t("accounting.payment_schedule")}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Base: Total Invoice (incl. VAT) ·{" "}
                  <span className="tabular-nums text-foreground/80">
                    {formatUSD(+(Number(totalInput) || 0).toFixed(2))}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
                <div className="grid grid-cols-[1fr_110px_140px_36px] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground px-1">
                  <span>{t("accounting.date")}</span>
                  <span>{t("platform.ui.percent")}</span>
                  <span className="text-end">{t("accounting.amount")}</span>
                  <span />
                </div>
                {schedule.map((row, i) => {
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_110px_140px_36px] gap-2 items-center"
                    >
                      <DatePickerPill
                        value={row.date}
                        onChange={(iso) => {
                          setScheduleDateTouched(true);
                          setSchedule((s) =>
                            s.map((r, idx) => (idx === i ? { ...r, date: iso } : r)),
                          );
                        }}
                        className={`${inputCls} !rounded-xl px-3 py-2 border border-border bg-surface-2`}
                        textAlign="start"
                        align="start"
                      />
                      <PaymentSplitFields
                        percent={row.pct}
                        amount={row.amount ?? null}
                        total={Number(totalInput) || 0}
                        onPercentChange={(pct) =>
                          setSchedule((s) => s.map((r, idx) => (idx === i ? { ...r, pct } : r)))
                        }
                        onAmountChange={(amount) =>
                          setSchedule((s) => s.map((r, idx) => (idx === i ? { ...r, amount } : r)))
                        }
                        onQuickAdd={addScheduleRow}
                        autoFocusPercent={i === lastAddedIdx}
                        percentClassName={`${inputCls} pr-7 tabular-nums`}
                        amountClassName={`${inputCls} text-end tabular-nums`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setSchedule((s) => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s))
                        }
                        disabled={schedule.length <= 1}
                        aria-label={t("accounting.remove_milestone")}
                        className="flex items-center justify-center size-9 rounded-lg border border-border text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between gap-3">
                  <ScheduleRemainderHint
                    totalPct={totalPct}
                    total={Number(totalInput) || 0}
                    allocatedAmount={scheduleAllocated}
                  />
                  <button
                    type="button"
                    onClick={addScheduleRow}
                    title={t("accounting.add_milestone_enter_inside_a_percentamount_field")}
                    className="inline-flex items-center gap-1 text-sm text-brand hover:opacity-80 shrink-0"
                  >
                    <Plus className="size-4" />
                    {t("accounting.add_row")}
                  </button>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2 mt-1 text-sm">
                  <span className="text-muted-foreground">
                    Total must equal 100% (±{SCHEDULE_PCT_TOLERANCE}%)
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${scheduleValid ? "text-success" : "text-destructive"}`}
                  >
                    {totalPct.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
            <Field label={t("platform.ui.invoicePdfOptional")}>
              <label className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2 cursor-pointer hover:bg-muted">
                <Paperclip className="size-4" />
                <span className="truncate text-xs">
                  {invoicePdf ? invoicePdf.name : "Attach invoice.pdf later if not available…"}
                </span>
                {invoicePdf && <Check className="size-4 text-success ms-auto" />}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => setInvoicePdf(e.target.files?.[0] ?? null)}
                />
              </label>
            </Field>
            <Field label={t("platform.ui.receiptPdfOptional")}>
              <label className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2 cursor-pointer hover:bg-muted">
                <Paperclip className="size-4" />
                <span className="truncate text-xs">
                  {receiptPdf ? receiptPdf.name : "Attach receipt.pdf later if not available…"}
                </span>
                {receiptPdf && <Check className="size-4 text-success ms-auto" />}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => setReceiptPdf(e.target.files?.[0] ?? null)}
                />
              </label>
            </Field>
            <Field label={t("platform.ui.invoiceAttachmentLinkEGGoogleDriveUrl")}>
              <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2 focus-within:ring-1 focus-within:ring-brand/40">
                <LinkIcon className="size-4 text-muted-foreground" />
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://drive.google.com/…"
                  value={invoiceUrlInput}
                  onChange={(e) => setInvoiceUrlInput(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                />
              </div>
            </Field>
            <Field label={t("platform.ui.receiptAttachmentLinkEGGoogleDriveUrl")}>
              <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2 focus-within:ring-1 focus-within:ring-brand/40">
                <LinkIcon className="size-4 text-muted-foreground" />
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://drive.google.com/…"
                  value={receiptUrlInput}
                  onChange={(e) => setReceiptUrlInput(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                />
              </div>
            </Field>
            <div className="col-span-2">
              <SupportingDocField value={supportingUrl} onChange={setSupportingUrl} />
            </div>
            <AttachmentUrlField
              className="col-span-2"
              value={attachmentUrl}
              onChange={setAttachmentUrl}
              externalError={
                attachmentDuplicate
                  ? `This link is already used on ${attachmentDuplicate.label}.`
                  : null
              }
            />
            {err && (
              <div className="col-span-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
                {err}
              </div>
            )}
            <button
              disabled={
                submitting ||
                !!attachmentDuplicate ||
                !vatMathValid ||
                !scheduleValid ||
                !isValidAttachmentUrl(attachmentUrl)
              }
              className="col-span-2 mt-2 py-3 rounded-xl bg-gradient-to-b from-card to-card ring-1 ring-border text-white font-semibold disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Add Invoice"}
            </button>
          </form>
        </Modal>
      )}
    </Panel>
  );
}

/* ---------------- Edit Invoice Modal ---------------- */

function EditInvoiceModal({
  invoice,
  purchasers,
  onClose,
  onSave,
}: {
  invoice: Invoice;
  purchasers: Array<{ id: string; fullName: string; position: string }>;
  onClose: () => void;
  onSave: (patch: Partial<Invoice>) => void | Promise<void>;
}) {
  const { t } = useTranslation();

  const [purchaserId, setPurchaserId] = useState<string | null>(invoice.purchaserId ?? null);
  const [invoiceNo, setInvoiceNo] = useState(invoice.invoiceNo ?? "");
  const [description, setDescription] = useState(invoice.description ?? "");
  const [date, setDate] = useState(invoice.date ?? "");
  const [invoiceUrl, setInvoiceUrl] = useState(invoice.invoiceUrl ?? "");
  const [receiptUrl, setReceiptUrl] = useState(invoice.receiptUrl ?? "");
  const [attachmentUrl, setAttachmentUrl] = useState(invoice.attachmentUrl ?? "");
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>(
    invoice.paymentMethod ?? "bank_transfer",
  );
  const [dueDate, setDueDate] = useState(invoice.dueDate ?? "");
  const [servicePeriodFrom, setServicePeriodFrom] = useState(invoice.servicePeriodFrom ?? "");
  const [servicePeriodTo, setServicePeriodTo] = useState(invoice.servicePeriodTo ?? "");
  const [serviceReceivedDate, setServiceReceivedDate] = useState(invoice.serviceReceivedDate ?? "");
  const [isRelatedParty, setIsRelatedParty] = useState(!!invoice.isRelatedParty);
  const [relatedPartyNote, setRelatedPartyNote] = useState(invoice.relatedPartyNote ?? "");
  const [saving, setSaving] = useState(false);
  const activeProjectId = useStore((s) => s.activeProjectId);
  // E05 on edit: another vendor → the invoice takes that vendor's profile again.
  const vendors = useStore((s) => s.vendors);
  const invoice190 = useHasColumn("invoices", "vendor_id");
  const [vendorName, setVendorName] = useState(invoice.vendorName ?? "");
  const vendorChange = useMemo(
    () =>
      vendorName === (invoice.vendorName ?? "")
        ? null
        : invoiceVendorChangePatch(
            invoice,
            vendors.find((v) => v.name === vendorName),
            invoice190,
          ),
    [invoice, invoice190, vendorName, vendors],
  );
  const pickVendor = (name: string) => {
    setVendorName(name);
    const next = invoiceVendorChangePatch(
      invoice,
      vendors.find((v) => v.name === name),
      invoice190,
    ).patch;
    if (next.isRelatedParty !== undefined) setIsRelatedParty(!!next.isRelatedParty);
    if (next.relatedPartyNote !== undefined) setRelatedPartyNote(next.relatedPartyNote ?? "");
  };
  const people = useStore((s) => s.people);
  const invoices = useStore((s) => s.invoices);
  const attachmentDuplicate = useMemo(
    () =>
      findDuplicateAttachmentUrl(attachmentUrl, attachmentRecordsForProject(people, invoices), {
        currentId: `invoice:${invoice.id}`,
        projectId: activeProjectId,
      }),
    [activeProjectId, attachmentUrl, invoice.id, invoices, people],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (methodNeedsPurchaser(paymentMethod) && !purchaserId) {
      toast.error(t("ap.purchaser_required_for_method"));
      return;
    }
    if (servicePeriodFrom && servicePeriodTo && servicePeriodTo < servicePeriodFrom) {
      toast.error(t("ap.service_period_order"));
      return;
    }
    if (!isValidAttachmentUrl(attachmentUrl)) {
      toast.error(t("accounting.attachment_url_must_start_with_http_or_https"));
      return;
    }
    if (attachmentDuplicate) {
      toast.error(`Attachment URL is already used on ${attachmentDuplicate.label}.`);
      return;
    }
    const p = purchasers.find((pp) => pp.id === purchaserId);
    setSaving(true);
    try {
      await onSave({
        ...(vendorChange?.patch ?? {}),
        purchaserId,
        purchaserName: p?.fullName ?? invoice.purchaserName ?? "",
        invoiceNo,
        description,
        date,
        invoiceUrl: invoiceUrl.trim() || null,
        receiptUrl: receiptUrl.trim() || null,
        attachmentUrl: normalizeAttachmentUrl(attachmentUrl),
        paymentMethod,
        dueDate: dueDate || null,
        servicePeriodFrom: servicePeriodFrom || null,
        servicePeriodTo: servicePeriodTo || null,
        serviceReceivedDate: serviceReceivedDate || null,
        isRelatedParty,
        relatedPartyNote: isRelatedParty ? relatedPartyNote : null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Edit Invoice #${invoice.invoiceNo || invoice.id.slice(0, 6)}`} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label={t("ap.payment_method")}>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as InvoicePaymentMethod)}
            className={inputCls}
          >
            {INVOICE_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`ap.method.${m}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("ap.purchaser_label")} required={methodNeedsPurchaser(paymentMethod)}>
          <select
            required={methodNeedsPurchaser(paymentMethod)}
            value={purchaserId ?? ""}
            onChange={(e) => setPurchaserId(e.target.value || null)}
            className={inputCls}
          >
            <option value="">
              {methodNeedsPurchaser(paymentMethod)
                ? "— Select Purchaser —"
                : t("ap.purchaser_optional")}
            </option>
            {purchasers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
                {p.position ? ` · ${p.position}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("polish.invoice.vendor")} className="col-span-2">
          <select
            value={vendorName}
            onChange={(e) => pickVendor(e.target.value)}
            className={inputCls}
          >
            {!vendors.some((v) => v.name === vendorName) && (
              <option value={vendorName}>{vendorName || "—"}</option>
            )}
            {vendors.map((v) => (
              <option key={v.id} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
          {vendorChange && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("polish.invoice.vendor_reinherited")}
            </p>
          )}
          {vendorChange?.whtDiffers && (
            <p className="mt-1 text-[11px] text-warning">
              {t("polish.invoice.vendor_wht_differs")}
            </p>
          )}
        </Field>
        <Field label={t("platform.ui.invoice")}>
          <input
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label={t("platform.ui.date")}>
          <DateInput value={date} onChange={setDate} className={inputCls} />
        </Field>
        <Field label={t("platform.ui.description")}>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label={t("ap.due_date")}>
          <DateInput value={dueDate} onChange={setDueDate} className={inputCls} />
        </Field>
        <Field label={t("ap.service_received_date")}>
          <DateInput
            value={serviceReceivedDate}
            onChange={setServiceReceivedDate}
            className={inputCls}
          />
        </Field>
        <Field label={t("ap.service_period_from")}>
          <DateInput
            value={servicePeriodFrom}
            onChange={setServicePeriodFrom}
            className={inputCls}
          />
        </Field>
        <Field label={t("ap.service_period_to")}>
          <DateInput value={servicePeriodTo} onChange={setServicePeriodTo} className={inputCls} />
        </Field>
        <Field label={t("ap.related_party")} className="col-span-2">
          <label className="flex items-center gap-2 text-sm normal-case tracking-normal">
            <input
              type="checkbox"
              checked={isRelatedParty}
              onChange={(e) => setIsRelatedParty(e.target.checked)}
            />
            {t("ap.related_party_check")}
          </label>
          {isRelatedParty && (
            <input
              value={relatedPartyNote}
              maxLength={1000}
              placeholder={t("ap.related_party_note")}
              onChange={(e) => setRelatedPartyNote(e.target.value)}
              className={`mt-1 ${inputCls}`}
            />
          )}
        </Field>
        <Field label={t("platform.ui.invoiceUrl")}>
          <input
            type="url"
            value={invoiceUrl}
            onChange={(e) => setInvoiceUrl(e.target.value)}
            className={inputCls}
            placeholder="https://…"
          />
        </Field>
        <Field label={t("platform.ui.receiptUrl")}>
          <input
            type="url"
            value={receiptUrl}
            onChange={(e) => setReceiptUrl(e.target.value)}
            className={inputCls}
            placeholder="https://…"
          />
        </Field>
        <AttachmentUrlField
          className="col-span-2"
          value={attachmentUrl}
          onChange={setAttachmentUrl}
          externalError={
            attachmentDuplicate
              ? `This link is already used on ${attachmentDuplicate.label}.`
              : null
          }
        />
        <div className="col-span-2 flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface-2 border border-border hover:bg-muted"
          >
            {t("platform.ui.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving || !!attachmentDuplicate || !isValidAttachmentUrl(attachmentUrl)}
            className="px-4 py-2 rounded-xl bg-brand text-brand-foreground font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Advances Tab ---------------- */

type AdvanceView = "list" | "receipt" | "receipts" | "report";

function AdvancesTab() {
  const { t } = useTranslation();

  const [view, setView] = useState<AdvanceView>("list");
  const { cashAdvances, receipts } = useStore();
  const { rows: glRows } = useGlAccounts();

  const exportAll = () => {
    const glMap = new Map(glRows.map((g) => [g.id, `${g.code} · ${g.name}`]));
    const advRows = cashAdvances.map((a) => {
      const spent = receipts
        .filter((r) => r.advanceId === a.id)
        .reduce((s, r) => s + Number(r.amount || 0), 0);
      return {
        Type: "Advance",
        Holder: a.holder,
        Recipient: "",
        Department: "",
        Method: "",
        Date: "",
        Amount: a.totalAdvance.toFixed(2),
        Spent: spent.toFixed(2),
        Remaining: (a.totalAdvance - spent).toFixed(2),
        Status: a.status,
        "GL Account": "",
      };
    });
    const recRows = receipts.map((r) => {
      const adv = cashAdvances.find((a) => a.id === r.advanceId);
      return {
        Type: "Receipt",
        Holder: adv?.holder ?? r.receivedFrom ?? "",
        Recipient: r.recipient,
        Department: r.department ?? "",
        Method: r.method,
        Date: r.date ?? "",
        Amount: Number(r.amount || 0).toFixed(2),
        Spent: "",
        Remaining: "",
        Status: adv?.status ?? "",
        "GL Account": r.glAccountId ? (glMap.get(r.glAccountId) ?? "") : "",
      };
    });
    downloadCSV(`petty-cash-${new Date().toISOString().slice(0, 10)}.csv`, [
      ...advRows,
      ...recRows,
    ]);
    toast.success(t("accounting.petty_cash_export_downloaded"));
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-5 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["list", "Cards"],
              ["receipt", "Add Receipt"],
              ["receipts", "Receipts"],
              ["report", "Cash Advance Report"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setView(k as AdvanceView)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold ${view === k ? "bg-brand text-brand-foreground" : "bg-surface hover:bg-muted"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          onClick={exportAll}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-border text-sm font-semibold hover:bg-muted"
        >
          <Download className="size-4" />
          {t("accounting.export_csv")}
        </button>
      </div>
      {view === "list" && <AdvanceCards />}
      {view === "receipt" && <AddReceiptForm />}
      {view === "receipts" && <ReceiptsList />}
      {view === "report" && <AdvanceReport />}
    </>
  );
}

function AdvanceCards() {
  const { t } = useTranslation();

  const { cashAdvances, addCashAdvance, people, payments, receipts } = useStore();
  const can = useCan();
  const { requireOrToast } = usePermissionCheck();
  const [open, setOpen] = useState(false);
  const [payFor, setPayFor] = useState<PaymentSourceInfo | null>(null);
  const [f, setF] = useState<CashAdvance>({
    id: "",
    holder: "",
    totalAdvance: 0,
    expenses: 0,
    status: "Active",
  });

  const holders = useMemo(() => {
    const fromRoster = (people ?? []).map((p) => p.fullName).filter(Boolean);
    const fallback = [
      "Production Manager",
      "Assistant Director",
      "Location Coordinator",
      "Line Producer",
      "1st AD",
      "Location Manager",
    ];
    return Array.from(new Set([...fromRoster, ...fallback]));
  }, [people]);

  return (
    <Panel>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => {
            if (!requireOrToast("pettycash.log", "log petty cash advances")) return;
            setOpen(true);
          }}
          disabled={!can("pettycash.log")}
          title={!can("pettycash.log") ? "Permission required: pettycash.log" : undefined}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-brand-foreground font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!can("pettycash.log") ? <Lock className="size-4" /> : <Plus className="size-4" />}New
          Advance
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cashAdvances.map((a) => {
          const paidTotal = sumPaymentsFor(payments, "petty_cash", a.id);
          // Real-time reconciliation: use sum of receipts as the authoritative "spent" figure.
          const spent = receipts
            .filter((r) => r.advanceId === a.id)
            .reduce((s, r) => s + Number(r.amount || 0), 0);
          const remaining = Math.max(0, a.totalAdvance - spent);
          const pct = a.totalAdvance > 0 ? (spent / a.totalAdvance) * 100 : 0;
          const isReconciled = a.status === "Reconciled" || spent >= a.totalAdvance - 0.005;
          return (
            <div key={a.id} className="rounded-2xl bg-surface-2 border border-border p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{a.holder}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("accounting.cash_advance")}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${
                      isReconciled
                        ? "bg-muted/20 text-foreground border-border"
                        : "bg-success/20 text-success border-success/30"
                    }`}
                  >
                    {isReconciled ? "Reconciled" : "Active"}
                  </span>
                  <PaymentStatusPill paid={paidTotal} total={a.totalAdvance} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="text-muted-foreground">{t("platform.ui.total")}</div>
                  <div className="font-semibold mt-1">{formatUSD(a.totalAdvance)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("platform.ui.spent")}</div>
                  <div className="font-semibold mt-1">{formatUSD(spent)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("platform.ui.remaining")}</div>
                  <div className="font-semibold mt-1 text-success">{formatUSD(remaining)}</div>
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-highlight to-highlight"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    if (!requireOrToast("pettycash.reconcile", "reconcile & clear petty cash"))
                      return;
                    setPayFor({
                      type: "petty_cash",
                      id: a.id,
                      label: `Petty Cash — ${a.holder}`,
                      totalAmount: a.totalAdvance,
                    });
                  }}
                  disabled={paidTotal >= a.totalAdvance - 0.005 || !can("pettycash.reconcile")}
                  title={
                    !can("pettycash.reconcile")
                      ? "Permission required: pettycash.reconcile"
                      : "Reconcile & record payment"
                  }
                  className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-success/20 text-success text-xs font-semibold hover:bg-success/30 border border-success/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {!can("pettycash.reconcile") ? (
                    <Lock className="size-3" />
                  ) : (
                    <DollarSign className="size-3" />
                  )}
                  Reconcile & Clear
                </button>
                <button
                  onClick={async () => {
                    if (isReconciled) {
                      toast.info(t("accounting.this_advance_is_already_reconciled"));
                      return;
                    }
                    if (!requireOrToast("pettycash.reconcile", "manually reconcile advances"))
                      return;
                    if (
                      !confirm(
                        `Manually close advance for ${a.holder}? This marks it as Reconciled and blocks new receipts.`,
                      )
                    )
                      return;
                    try {
                      await useStore.getState().reconcileCashAdvance(a.id);
                      toast.success(`Advance for ${a.holder} marked as Reconciled.`);
                    } catch (err: any) {
                      toast.error(err?.message ?? "Failed to reconcile advance.");
                    }
                  }}
                  disabled={isReconciled || !can("pettycash.reconcile")}
                  title={
                    isReconciled
                      ? "Already reconciled"
                      : "Mark this advance as Reconciled without recording payment"
                  }
                  className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-muted/20 text-foreground text-xs font-semibold hover:bg-muted/30 border border-border disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="size-3" />
                  {t("accounting.mark_reconciled")}
                </button>
              </div>
              <details className="mt-3 rounded-lg bg-surface-1/50 border border-border">
                <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground px-3 py-2 select-none">
                  {t("accounting.payment_history")}
                </summary>
                <div className="border-t border-border">
                  <PaymentHistory sourceType="petty_cash" sourceId={a.id} />
                </div>
              </details>
            </div>
          );
        })}
      </div>
      {payFor && <RecordPaymentModal source={payFor} onClose={() => setPayFor(null)} />}
      {open && (
        <Modal title={t("accounting.new_cash_advance")} onClose={() => setOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!f.holder) {
                toast.error(t("accounting.holder_is_required"));
                return;
              }
              if (!f.totalAdvance || f.totalAdvance <= 0) {
                toast.error(t("accounting.total_advance_must_be_greater_than_0"));
                return;
              }
              try {
                await addCashAdvance({ ...f, id: generateId(), expenses: 0, status: "Active" });
                toast.success(`Cash advance for ${f.holder} recorded.`);
                setOpen(false);
              } catch (err: any) {
                toast.error(err?.message ?? "Failed to record cash advance.");
              }
            }}
            className="grid grid-cols-2 gap-3"
          >
            <Field label={t("platform.ui.holder")} className="col-span-2">
              <select
                required
                value={f.holder}
                onChange={(e) => setF({ ...f, holder: e.target.value })}
                className={inputCls}
              >
                <option value="">Select holder…</option>
                {holders.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("platform.ui.totalAdvance")} className="col-span-2">
              <input
                type="number"
                min={0}
                step="0.01"
                value={f.totalAdvance}
                onChange={(e) => setF({ ...f, totalAdvance: +e.target.value })}
                className={inputCls}
              />
            </Field>
            <button className="col-span-2 mt-2 py-2.5 rounded-xl bg-brand text-brand-foreground font-semibold">
              {t("accounting.save_advance")}
            </button>
          </form>
        </Modal>
      )}
    </Panel>
  );
}

function AddReceiptForm() {
  const { t } = useTranslation();

  const { cashAdvances, addReceipt, people, receipts } = useStore();
  const { rows: glRows } = useGlAccounts();

  // Only Active advances (not fully spent / not reconciled) can receive new receipts.
  const activeAdvances = useMemo(
    () =>
      cashAdvances.filter((a) => {
        if (a.status === "Reconciled") return false;
        const spent = receipts
          .filter((r) => r.advanceId === a.id)
          .reduce((s, r) => s + Number(r.amount || 0), 0);
        return spent < a.totalAdvance - 0.005;
      }),
    [cashAdvances, receipts],
  );

  const initial = (): CashAdvanceReceipt => ({
    id: "",
    advanceId: activeAdvances[0]?.id,
    receivedFrom: activeAdvances[0]?.holder ?? "",
    recipient: "",
    department: "",
    method: "Cash",
    amount: 0,
    date: new Date().toISOString().slice(0, 10),
    glAccountId: null,
  });
  const [f, setF] = useState<CashAdvanceReceipt>(initial);
  const [file, setFile] = useState<File | null>(null);
  const [supportingUrl, setSupportingUrl] = useState("");

  const selectedAdv = useMemo(
    () =>
      activeAdvances.find((a) => a.id === f.advanceId) ??
      cashAdvances.find((a) => a.id === f.advanceId),
    [activeAdvances, cashAdvances, f.advanceId],
  );
  const spentOnSelected = useMemo(
    () =>
      selectedAdv
        ? receipts
            .filter((r) => r.advanceId === selectedAdv.id)
            .reduce((s, r) => s + Number(r.amount || 0), 0)
        : 0,
    [receipts, selectedAdv],
  );
  const remainingOnSelected = selectedAdv
    ? Math.max(0, selectedAdv.totalAdvance - spentOnSelected)
    : 0;

  const recipients = useMemo(() => {
    const fromRoster = (people ?? []).map((p) => p.fullName).filter(Boolean);
    const fallback = [
      "John Doe",
      "Production Manager",
      "Assistant Director",
      "Line Producer",
      "1st AD",
      "Location Manager",
    ];
    return Array.from(new Set([...fromRoster, ...fallback]));
  }, [people]);

  const departments = useMemo(
    () => HEADER_ACCOUNTS.map((h) => ({ code: h.code, label: h.name })),
    [],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.advanceId) {
      toast.error(t("accounting.select_an_active_cash_advance_to_link_this"));
      return;
    }
    if (!selectedAdv || selectedAdv.status === "Reconciled") {
      toast.error(t("accounting.the_selected_advance_is_not_active"));
      return;
    }
    if (!f.recipient) {
      toast.error(t("accounting.select_an_advance_recipient"));
      return;
    }
    if (!f.department) {
      toast.error(t("accounting.select_a_department"));
      return;
    }
    if (!f.glAccountId) {
      toast.error(t("accounting.gl_account_is_required_for_accurate_financial_reporting"));
      return;
    }
    if (!f.amount || f.amount <= 0) {
      toast.error(t("accounting.enter_a_valid_amount"));
      return;
    }
    if (f.amount > remainingOnSelected + 0.005) {
      toast.error(
        `Amount exceeds remaining balance (${formatUSD(remainingOnSelected)}) on the selected advance.`,
      );
      return;
    }
    try {
      const newId = generateId();
      await addReceipt({ ...f, id: newId });
      if (supportingUrl.trim())
        void setSupportingDocUrl("receipt", newId, supportingUrl).catch(() => undefined);
      toast.success(t("accounting.petty_cash_receipt_recorded_holder_balances_and_cost"));
      setF(initial());
      setFile(null);
      setSupportingUrl("");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to record receipt.");
    }
  };

  return (
    <Panel>
      <h3 className="text-xl font-semibold mb-4">{t("accounting.add_receipt")}</h3>
      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-4">
        <Field label={t("platform.ui.activeCashAdvanceRequired")}>
          <select
            required
            value={f.advanceId ?? ""}
            onChange={(e) => {
              const adv = activeAdvances.find((a) => a.id === e.target.value);
              setF({ ...f, advanceId: e.target.value, receivedFrom: adv?.holder ?? "" });
            }}
            className={inputCls}
          >
            <option value="">Select active advance…</option>
            {activeAdvances.length === 0 && (
              <option value="" disabled>
                No active advances — create one first
              </option>
            )}
            {activeAdvances.map((a) => {
              const spent = receipts
                .filter((r) => r.advanceId === a.id)
                .reduce((s, r) => s + Number(r.amount || 0), 0);
              const rem = Math.max(0, a.totalAdvance - spent);
              return (
                <option key={a.id} value={a.id}>
                  {a.holder} — remaining {formatUSD(rem)}
                </option>
              );
            })}
          </select>
          {selectedAdv && (
            <div className="mt-1 text-xs text-muted-foreground">
              Remaining balance:{" "}
              <span className="font-semibold text-success">{formatUSD(remainingOnSelected)}</span>
            </div>
          )}
        </Field>
        <Field label={t("platform.ui.date")}>
          <DateInput
            value={f.date ?? ""}
            onChange={(iso) => setF({ ...f, date: iso })}
            className={inputCls}
          />
        </Field>
        <Field label={t("platform.ui.advanceRecipient")}>
          <select
            value={f.recipient}
            onChange={(e) => setF({ ...f, recipient: e.target.value })}
            className={inputCls}
          >
            <option value="">Select recipient…</option>
            {recipients.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("platform.ui.receiptAttachment")}>
          <label className="flex cursor-pointer items-center gap-2 bg-surface-2 border border-border rounded-xl px-3 py-2 hover:bg-muted">
            <Paperclip className="size-4 shrink-0" />
            <span
              className={`truncate text-sm ${file ? "text-foreground" : "text-muted-foreground"}`}
            >
              {file ? file.name : "Click to attach image or PDF…"}
            </span>
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const sel = e.target.files?.[0] ?? null;
                if (sel) {
                  setFile(sel);
                  toast.success(t("accounting.receipt_image_attached_successfully"));
                }
              }}
            />
          </label>
        </Field>
        <Field label={t("platform.ui.department")}>
          <select
            value={f.department ?? ""}
            onChange={(e) => setF({ ...f, department: e.target.value })}
            className={inputCls}
          >
            <option value="">Select department…</option>
            {departments.map((d) => (
              <option key={d.code} value={d.label}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="GL Account (required)">
          <select
            required
            value={f.glAccountId ?? ""}
            onChange={(e) => setF({ ...f, glAccountId: e.target.value || null })}
            className={inputCls}
          >
            <option value="">Select a GL account…</option>
            {glRows
              .filter((g) => g.isActive)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} · {g.name} ({g.category})
                </option>
              ))}
          </select>
        </Field>
        <Field label={t("platform.ui.method")}>
          <select
            value={f.method}
            onChange={(e) => setF({ ...f, method: e.target.value as any })}
            className={inputCls}
          >
            <option>{t("platform.ui.cash")}</option>
            <option>{t("platform.ui.bank")}</option>
            <option>{t("platform.ui.card")}</option>
          </select>
        </Field>
        <Field label={`Amount${selectedAdv ? ` (max ${formatUSD(remainingOnSelected)})` : ""}`}>
          <input
            type="number"
            min={0}
            step="0.01"
            max={selectedAdv ? remainingOnSelected : undefined}
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: +e.target.value })}
            className={inputCls}
          />
        </Field>
        <div className="col-span-2">
          <SupportingDocField value={supportingUrl} onChange={setSupportingUrl} />
        </div>
        <button
          disabled={activeAdvances.length === 0}
          className="col-span-2 mt-2 py-3 rounded-xl bg-gradient-to-b from-card to-card ring-1 ring-border text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t("accounting.add_receipt")}
        </button>
      </form>
    </Panel>
  );
}

function ReceiptsList() {
  const { t } = useTranslation();

  const { receipts, cashAdvances, updateReceipt, removeReceipt } = useStore();
  const { rows: glRows } = useGlAccounts();
  const can = useCan();
  const { requireOrToast } = usePermissionCheck();
  const [editing, setEditing] = useState<CashAdvanceReceipt | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const glMap = useMemo(
    () => new Map(glRows.map((g) => [g.id, `${g.code} · ${g.name}`])),
    [glRows],
  );
  const advMap = useMemo(() => new Map(cashAdvances.map((a) => [a.id, a.holder])), [cashAdvances]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = [...receipts].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.recipient,
        r.department,
        r.receivedFrom,
        advMap.get(r.advanceId ?? ""),
        glMap.get(r.glAccountId ?? ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [receipts, query, advMap, glMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  const exportReceipts = () => {
    if (!filtered.length) {
      toast.error(t("accounting.no_receipts_to_export"));
      return;
    }
    const rows = filtered.map((r) => ({
      Date: r.date ?? "",
      Advance_Holder: advMap.get(r.advanceId ?? "") ?? r.receivedFrom ?? "",
      Recipient: r.recipient ?? "",
      Department: r.department ?? "",
      GL_Account: r.glAccountId ? (glMap.get(r.glAccountId) ?? "") : "",
      Method: r.method ?? "",
      Amount_USD: Number(r.amount || 0).toFixed(2),
    }));
    downloadCSV(`petty-cash-receipts-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success(t("accounting.receipts_export_downloaded"));
  };

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-xl font-semibold">{t("platform.ui.receipts")}</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={t("accounting.search_recipient_department_gl")}
            className="bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 ring-brand w-64"
          />
          <button
            onClick={exportReceipts}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-2 border border-border text-sm hover:bg-muted"
          >
            <Download className="size-4" />
            {t("accounting.export_receipts")}
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          {t("accounting.no_receipts_yet")}
        </div>
      ) : (
        <>
          <Table
            headers={[
              "Date",
              "Holder / Advance",
              "Recipient",
              "Department",
              "GL Account",
              "Method",
              "Amount",
              "Actions",
            ]}
          >
            {pageRows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Cell className="whitespace-nowrap">{formatDate(r.date) || "—"}</Cell>
                <Cell>{advMap.get(r.advanceId ?? "") ?? r.receivedFrom ?? "—"}</Cell>
                <Cell>{r.recipient}</Cell>
                <Cell>{r.department || "—"}</Cell>
                <Cell className="text-xs">
                  {r.glAccountId ? (
                    (glMap.get(r.glAccountId) ?? "—")
                  ) : (
                    <span className="text-destructive">{t("platform.ui.missing")}</span>
                  )}
                </Cell>
                <Cell>{r.method}</Cell>
                <Cell className="tabular-nums font-semibold">
                  {formatUSD(Number(r.amount || 0))}
                </Cell>
                <Cell>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (!requireOrToast("pettycash.log", "edit receipts")) return;
                        setEditing(r);
                      }}
                      disabled={!can("pettycash.log")}
                      title={
                        !can("pettycash.log")
                          ? "Permission required: pettycash.log"
                          : "Edit receipt"
                      }
                      className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!requireOrToast("pettycash.log", "delete receipts")) return;
                        if (
                          !confirm(
                            `Delete receipt of ${formatUSD(Number(r.amount || 0))} for ${r.recipient}?`,
                          )
                        )
                          return;
                        try {
                          await removeReceipt(r.id);
                          toast.success(t("accounting.receipt_deleted"));
                        } catch (err: any) {
                          toast.error(err?.message ?? "Failed to delete.");
                        }
                      }}
                      disabled={!can("pettycash.log")}
                      title={
                        !can("pettycash.log")
                          ? "Permission required: pettycash.log"
                          : "Delete receipt"
                      }
                      className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </Cell>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
            <div>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border disabled:opacity-40"
              >
                Previous
              </button>
              <span className="tabular-nums">
                Page {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 rounded-lg bg-surface-2 border border-border disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
      {editing && (
        <EditReceiptModal
          receipt={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            try {
              await updateReceipt(editing.id, patch);
              toast.success(t("accounting.receipt_updated"));
              setEditing(null);
            } catch (err: any) {
              toast.error(err?.message ?? "Failed to update.");
            }
          }}
        />
      )}
    </Panel>
  );
}

function EditReceiptModal({
  receipt,
  onClose,
  onSave,
}: {
  receipt: CashAdvanceReceipt;
  onClose: () => void;
  onSave: (patch: Partial<CashAdvanceReceipt>) => Promise<void>;
}) {
  const { t } = useTranslation();

  const { rows: glRows } = useGlAccounts();
  const [f, setF] = useState<CashAdvanceReceipt>({ ...receipt });
  const departments = useMemo(
    () => HEADER_ACCOUNTS.map((h) => ({ code: h.code, label: h.name })),
    [],
  );
  return (
    <Modal title={t("accounting.edit_receipt")} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!f.recipient) return toast.error(t("accounting.recipient_is_required"));
          if (!f.department) return toast.error(t("accounting.department_is_required"));
          if (!f.glAccountId) return toast.error(t("accounting.gl_account_is_required"));
          if (!f.amount || f.amount <= 0) return toast.error(t("accounting.enter_a_valid_amount"));
          await onSave({
            recipient: f.recipient,
            department: f.department,
            method: f.method,
            amount: f.amount,
            date: f.date,
            glAccountId: f.glAccountId,
          });
        }}
        className="grid grid-cols-2 gap-3"
      >
        <Field label={t("platform.ui.date")}>
          <DateInput
            value={f.date ?? ""}
            onChange={(iso) => setF({ ...f, date: iso })}
            className={inputCls}
          />
        </Field>
        <Field label={t("platform.ui.method")}>
          <select
            value={f.method}
            onChange={(e) => setF({ ...f, method: e.target.value as any })}
            className={inputCls}
          >
            <option>{t("platform.ui.cash")}</option>
            <option>{t("platform.ui.bank")}</option>
            <option>{t("platform.ui.card")}</option>
          </select>
        </Field>
        <Field label={t("platform.ui.recipient")} className="col-span-2">
          <input
            value={f.recipient}
            onChange={(e) => setF({ ...f, recipient: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label={t("platform.ui.department")}>
          <select
            value={f.department ?? ""}
            onChange={(e) => setF({ ...f, department: e.target.value })}
            className={inputCls}
          >
            <option value="">Select department…</option>
            {departments.map((d) => (
              <option key={d.code} value={d.label}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="GL Account (required)">
          <select
            value={f.glAccountId ?? ""}
            onChange={(e) => setF({ ...f, glAccountId: e.target.value || null })}
            className={inputCls}
          >
            <option value="">Select a GL account…</option>
            {glRows
              .filter((g) => g.isActive)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} · {g.name} ({g.category})
                </option>
              ))}
          </select>
        </Field>
        <Field label={t("platform.ui.amount")} className="col-span-2">
          <input
            type="number"
            min={0}
            step="0.01"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: +e.target.value })}
            className={inputCls}
          />
        </Field>
        <button className="col-span-2 mt-2 py-2.5 rounded-xl bg-brand text-brand-foreground font-semibold">
          {t("accounting.save_changes")}
        </button>
      </form>
    </Modal>
  );
}

function AdvanceReport() {
  const { t } = useTranslation();

  const { cashAdvances, receipts } = useStore();
  const [advanceId, setAdvanceId] = useState(cashAdvances[0]?.id ?? "");
  const adv = useMemo(
    () => cashAdvances.find((a) => a.id === advanceId),
    [cashAdvances, advanceId],
  );
  // Real-time reconciliation: total advance − sum of associated receipts.
  const totalExpenses = useMemo(
    () =>
      receipts
        .filter((r) => r.advanceId === advanceId)
        .reduce((a, r) => a + Number(r.amount || 0), 0),
    [receipts, advanceId],
  );
  const remaining = (adv?.totalAdvance ?? 0) - totalExpenses;
  const isReconciled =
    adv?.status === "Reconciled" || (adv ? totalExpenses >= adv.totalAdvance - 0.005 : false);
  return (
    <Panel>
      <h3 className="text-xl font-semibold mb-4">{t("accounting.cash_advance_report")}</h3>
      <div className="grid gap-4 max-w-xl">
        <Field label={t("platform.ui.advanceRecipient")}>
          <select
            value={advanceId}
            onChange={(e) => setAdvanceId(e.target.value)}
            className={inputCls}
          >
            {cashAdvances.map((a) => (
              <option key={a.id} value={a.id}>
                {a.holder} — {a.status ?? "Active"}
              </option>
            ))}
          </select>
        </Field>
        {adv && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Status:</span>
            <span
              className={`px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border ${
                isReconciled
                  ? "bg-muted/20 text-foreground border-border"
                  : "bg-success/20 text-success border-success/30"
              }`}
            >
              {isReconciled ? "Reconciled" : "Active"}
            </span>
          </div>
        )}
        <ReportCard
          label={t("platform.ui.totalAdvance")}
          value={formatUSD(adv?.totalAdvance ?? 0)}
        />
        <ReportCard label={t("platform.ui.totalReceipts")} value={formatUSD(totalExpenses)} />
        <ReportCard
          label={t("platform.ui.remainingBalance")}
          value={formatUSD(remaining)}
          tone={remaining < 0 ? "danger" : "good"}
        />
      </div>
    </Panel>
  );
}

function ReportCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "danger";
}) {
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div
        className={`rounded-2xl px-5 py-4 text-lg font-semibold bg-surface-2 border border-border ${tone === "danger" ? "text-destructive" : tone === "good" ? "text-success" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

/* ---------------- shared ---------------- */

const inputCls =
  "w-full bg-surface-2 border border-border rounded-xl px-3 py-2 outline-none focus:ring-2 ring-brand";
function Field({
  label,
  children,
  className = "",
  required = false,
  error,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <label className={`text-sm ${className}`}>
      <div className="text-muted-foreground mb-1 uppercase tracking-wider text-xs">
        {label}
        {required && (
          <span className="text-destructive ms-1" aria-hidden>
            *
          </span>
        )}
      </div>
      <div
        className={
          error
            ? "[&_input]:!border-destructive/70 [&_select]:!border-destructive/70 [&_button]:!border-destructive/70"
            : ""
        }
      >
        {children}
      </div>
      {error && <div className="text-[11px] text-destructive mt-1">{error}</div>}
    </label>
  );
}
function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="app-table w-full">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            {headers.map((h) => (
              <th
                key={h}
                className="text-start px-3 py-2 font-medium text-xs uppercase tracking-wider"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 ${className}`}>{children}</td>;
}

/* ---------------- Budget Readout ---------------- */

function BudgetReadout({
  budgetCode,
  pendingAmount = 0,
  purchaseOrderId = null,
}: {
  budgetCode: string;
  pendingAmount?: number;
  /** When the new invoice converts a PO, only the part above the PO's open amount is new. */
  purchaseOrderId?: string | null;
}) {
  const { t } = useTranslation();

  const { budget, invoices, purchaseOrders, payroll, payments, receipts } = useStore();
  if (!budgetCode) return null;
  const line = budget.find((b) => b.mainCode === budgetCode);
  if (!line)
    return (
      <div className="mt-2 text-xs text-muted-foreground">
        {t("accounting.no_matching_budget_line")}
      </div>
    );
  // Same definitions as every other screen (B17): actual + commitment of this code.
  const codeInvoices = invoices.filter((i) => i.budgetCode === budgetCode);
  const codePos = purchaseOrders.filter((p) => p.budgetCode === budgetCode);
  const pos = computeBudgetPosition({
    totalBudget: budget
      .filter((b) => b.mainCode === budgetCode)
      .reduce((a, b) => a + lineTotal(b), 0),
    payroll: payroll.filter((r) => r.budgetCode === budgetCode),
    invoices: codeInvoices,
    purchaseOrders: codePos,
    payments,
    receipts: receipts.filter((r) => r.budgetCode === budgetCode),
    legacyPaidFor: (r) => legacyContractPaid(r, payments),
  });
  const budgeted = pos.budget;
  const alreadyCommitted = pos.actual + pos.commitment;
  const po = purchaseOrderId ? purchaseOrders.find((p) => p.id === purchaseOrderId) : null;
  const poOpenOnCode = po && po.budgetCode === budgetCode ? poOpenCommitment(po, invoices) : 0;
  const newMoney = Math.max(0, Number(pendingAmount || 0) - poOpenOnCode);
  const remaining = budgeted - alreadyCommitted - newMoney;
  const over = remaining < 0;
  return (
    <div
      className={`mt-2 text-xs rounded-lg border px-2.5 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 ${over ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-surface-2 text-muted-foreground"}`}
    >
      <span>
        Budgeted: <b className="tabular-nums text-foreground">{formatUSD(budgeted)}</b>
      </span>
      <span>
        Committed: <b className="tabular-nums text-foreground">{formatUSD(alreadyCommitted)}</b>
      </span>
      <span>
        Remaining after this:{" "}
        <b className={`tabular-nums ${over ? "text-destructive" : "text-success"}`}>
          {formatUSD(remaining)}
        </b>
      </span>
      {over && <span className="font-semibold">⚠ Exceeds budget</span>}
    </div>
  );
}

/* ---------------- Purchase Orders Tab ---------------- */

const PO_STATUSES: PurchaseOrderStatus[] = ["Open", "Committed", "Received", "Cancelled"];

function PurchaseOrderTab() {
  const { t } = useTranslation();

  const {
    purchaseOrders,
    vendors,
    budget,
    addPurchaseOrder,
    updatePurchaseOrder,
    removePurchaseOrder,
    payments,
  } = useStore();
  const can = useCan();
  const { requireOrToast } = usePermissionCheck();
  const [open, setOpen] = useState(false);
  const [payFor, setPayFor] = useState<PaymentSourceInfo | null>(null);
  const emptyPO = (): PurchaseOrder => ({
    id: "",
    poNumber: `PO-${Date.now().toString().slice(-6)}`,
    vendorName: vendors[0]?.name ?? "",
    description: "",
    budgetCode: "",
    amount: 0,
    status: "Open",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [f, setF] = useState<PurchaseOrder>(emptyPO());

  const budgetOptions = useMemo(
    () => budget.map((b) => ({ code: b.mainCode, label: `${b.mainCode} — ${b.description}` })),
    [budget],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.poNumber.trim()) {
      toast.error(t("accounting.po_number_is_required"));
      return;
    }
    if (!f.vendorName.trim()) {
      toast.error(t("accounting.vendor_is_required"));
      return;
    }
    if (!f.budgetCode) {
      toast.error(t("accounting.link_to_budget_item_is_required"));
      return;
    }
    if (!f.amount || f.amount <= 0) {
      toast.error(t("accounting.amount_must_be_greater_than_0"));
      return;
    }
    try {
      await addPurchaseOrder({ ...f, id: generateId() });
      const bl = budget.find((b) => b.mainCode === f.budgetCode);
      toast.success(
        `PO ${f.poNumber} recorded against ${bl ? `${bl.mainCode} — ${bl.description}` : f.budgetCode}.`,
      );
      setF(emptyPO());
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create Purchase Order.");
    }
  };

  return (
    <Panel>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">{t("accounting.purchase_orders")}</h3>
        <button
          onClick={() => {
            if (!requireOrToast("invoices.add", "create purchase orders")) return;
            setF(emptyPO());
            setOpen(true);
          }}
          disabled={!can("invoices.add")}
          title={!can("invoices.add") ? "Permission required: invoices.add" : undefined}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-brand-foreground font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!can("invoices.add") ? <Lock className="size-4" /> : <Plus className="size-4" />} New
          Purchase Order
        </button>
      </div>
      <Table
        headers={[
          "PO #",
          "Vendor",
          "Description",
          "Budget",
          "Amount",
          "Status",
          "Payment",
          "Date",
          "Actions",
        ]}
      >
        {purchaseOrders.map((p) => {
          const bl = budget.find((b) => b.mainCode === p.budgetCode);
          const paidTotal = sumPaymentsFor(payments, "purchase_order", p.id);
          return (
            <Fragment key={p.id}>
              <tr className="border-b border-border">
                <Cell className="font-mono text-xs">{p.poNumber}</Cell>
                <Cell>{p.vendorName}</Cell>
                <Cell>{p.description}</Cell>
                <Cell className="font-mono text-xs">
                  {p.budgetCode}
                  {bl ? ` · ${bl.description}` : ""}
                </Cell>
                <Cell className="font-semibold tabular-nums">{formatUSD(p.amount)}</Cell>
                <Cell>
                  <select
                    value={p.status}
                    disabled={!can("transactions.modify") && !can("invoices.approve")}
                    title={
                      !can("transactions.modify") && !can("invoices.approve")
                        ? "Permission required: transactions.modify / invoices.approve"
                        : undefined
                    }
                    onChange={async (e) => {
                      const status = e.target.value as PurchaseOrderStatus;
                      // Committing/receiving requires approval authority; other transitions need modify perm.
                      const needsApprove = status === "Committed" || status === "Received";
                      const perm = needsApprove ? "invoices.approve" : "transactions.modify";
                      if (
                        !requireOrToast(
                          perm,
                          needsApprove ? "approve purchase orders" : "modify pending transactions",
                        )
                      )
                        return;
                      try {
                        await updatePurchaseOrder(p.id, { status });
                        toast.success(`PO ${p.poNumber} → ${status}.`);
                      } catch (err: any) {
                        toast.error(err?.message ?? "Failed to update status.");
                      }
                    }}
                    className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                  >
                    {PO_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Cell>
                <Cell>
                  <PaymentStatusPill paid={paidTotal} total={p.amount} />
                </Cell>
                <Cell>{formatDate(p.date) || p.date}</Cell>
                <Cell>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (!requireOrToast("invoices.pay", "record PO payments")) return;
                        setPayFor({
                          type: "purchase_order",
                          id: p.id,
                          label: `PO ${p.poNumber} — ${p.vendorName}`,
                          totalAmount: p.amount,
                        });
                      }}
                      disabled={
                        paidTotal >= p.amount - 0.005 ||
                        p.status === "Cancelled" ||
                        !can("invoices.pay")
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-success/20 text-success text-xs font-semibold hover:bg-success/30 border border-success/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      title={
                        !can("invoices.pay")
                          ? "Permission required: invoices.pay"
                          : "Record Payment"
                      }
                    >
                      {!can("invoices.pay") ? (
                        <Lock className="size-3" />
                      ) : (
                        <DollarSign className="size-3" />
                      )}
                      Pay
                    </button>
                    <button
                      onClick={async () => {
                        if (!requireOrToast("transactions.modify", "void purchase orders")) return;
                        if (!confirm(`Delete PO ${p.poNumber}? This cannot be undone.`)) return;
                        try {
                          await removePurchaseOrder(p.id);
                          toast.success(`PO ${p.poNumber} deleted.`);
                        } catch (err: any) {
                          toast.error(err?.message ?? "Failed to delete PO.");
                        }
                      }}
                      disabled={
                        !can("transactions.modify") || ["Approved", "Issued"].includes(p.status)
                      }
                      className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                      title={
                        !can("transactions.modify")
                          ? "Permission required: transactions.modify"
                          : ["Approved", "Issued"].includes(p.status)
                            ? t("closeout.po.no_delete_hint")
                            : "Void/Delete"
                      }
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </Cell>
              </tr>
              <PaymentHistoryToggle sourceType="purchase_order" sourceId={p.id} colSpan={9} />
            </Fragment>
          );
        })}
        {purchaseOrders.length === 0 && (
          <tr>
            <td colSpan={9} className="text-center py-8 text-muted-foreground">
              {t("accounting.no_purchase_orders_yet_create_one_to_commit")}
            </td>
          </tr>
        )}
      </Table>
      {payFor && <RecordPaymentModal source={payFor} onClose={() => setPayFor(null)} />}

      {open && (
        <Modal title={t("accounting.new_purchase_order")} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <Field label="PO Number">
              <input
                required
                value={f.poNumber}
                onChange={(e) => setF({ ...f, poNumber: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label={t("platform.ui.date")}>
              <DateInput
                value={f.date}
                onChange={(iso) => setF({ ...f, date: iso })}
                className={inputCls}
              />
            </Field>
            <Field label={t("platform.ui.vendor")}>
              <select
                required
                value={f.vendorName}
                onChange={(e) => setF({ ...f, vendorName: e.target.value })}
                className={inputCls}
              >
                <option value="">Select vendor…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("platform.ui.status")}>
              <select
                value={f.status}
                onChange={(e) => setF({ ...f, status: e.target.value as PurchaseOrderStatus })}
                className={inputCls}
              >
                {PO_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("platform.ui.description")} className="col-span-2">
              <input
                required
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
                placeholder={t("accounting.what_is_being_purchased")}
                className={inputCls}
              />
            </Field>
            <Field label={t("platform.ui.linkToBudgetItem")} className="col-span-2">
              <BudgetCodeSelector
                value={f.budgetCode}
                onChange={(code) => setF({ ...f, budgetCode: code })}
                allowEmpty={false}
                required
                emptyLabel="Select budget line…"
                restrictToCodes={budgetOptions.map((b) => b.code)}
              />
              <BudgetReadout budgetCode={f.budgetCode} pendingAmount={Number(f.amount) || 0} />
            </Field>
            <Field label={t("platform.ui.amount")} className="col-span-2">
              <input
                required
                type="number"
                min={0}
                step="0.01"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: +e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label={t("platform.ui.notes")} className="col-span-2">
              <textarea
                value={f.notes ?? ""}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
                rows={2}
                className={inputCls}
              />
            </Field>
            <div className="col-span-2 flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-xl border border-border hover:bg-muted"
              >
                {t("platform.ui.cancel")}
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-brand text-brand-foreground font-semibold"
              >
                {t("accounting.create_po")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Panel>
  );
}
