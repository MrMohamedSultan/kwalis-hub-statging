// ═══════════════════════════════════════════════════════════════════
// General Ledger — transaction detail drawer (G09 / G10 / G11 / G12).
//
// Plain language for an accountant: reference number, name, budget code and
// account with their names, gross / WHT / net, who created it and who last
// changed it. The payment schedule of a contract is a table with a total
// row. "Open document" deep-links to the source page (?open=<id>) and is
// hidden without view permission on that page. Raw database columns are
// behind "Technical data", for administrators only.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { formatAmount } from "@/lib/format-number";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { documentLink, refNoOf } from "@/lib/document-refs";
import {
  documentAmounts,
  documentName,
  externalNumber,
  scheduleRows,
  scheduleTotal,
} from "@/lib/document-detail";
import {
  fetchAuditTrail,
  fieldChanges,
  humanizeField,
  type AuditTrailRow,
} from "@/lib/audit-trail";
import { SOURCE_TABLE, type GlTransaction } from "./gl-transactions-data";

type Rec = Record<string, unknown>;

function useUserName(id: string | null | undefined) {
  return useQuery({
    queryKey: ["user-display-name", id],
    enabled: !!id,
    staleTime: 600_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("user_display_name" as never, { p_uid: id } as never);
      return (data as unknown as string | null) ?? null;
    },
  });
}

function fmtDate(v: unknown, locale: string): string {
  if (typeof v !== "string" || !v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? d.toLocaleDateString(locale) : d.toLocaleString(locale);
}

function rawValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,40%)_1fr] gap-2 px-3 py-2 text-sm odd:bg-surface-2/50">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function GlTransactionDrawer({
  row,
  onClose,
}: {
  row: GlTransaction | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar-EG" : "en-US";
  const navigate = useNavigate();
  const perms = usePermissions();
  const [showTech, setShowTech] = useState(false);
  const table = row ? SOURCE_TABLE[row.source_type] : null;

  const recordQuery = useQuery({
    queryKey: ["gltx-record", table, row?.id],
    enabled: !!row && !!table,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as "payroll")
        .select("*")
        .eq("id", row!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Rec | null;
    },
  });
  const record = recordQuery.data ?? null;

  const budgetCode = (record?.budget_code as string | undefined) ?? row?.budget_code ?? null;
  const glId = (record?.gl_account_id as string | undefined) ?? row?.gl_account_id ?? null;

  const budgetName = useQuery({
    queryKey: ["gltx-budget-name", budgetCode],
    enabled: !!budgetCode,
    staleTime: 600_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("master_budget")
        .select("description, organization_id")
        .eq("budget_code", budgetCode!)
        .limit(5);
      const list = (data ?? []) as { description: string; organization_id: string | null }[];
      const own = list.find((m) => m.organization_id && m.organization_id === row?.organization_id);
      return (own ?? list.find((m) => !m.organization_id) ?? list[0])?.description ?? null;
    },
  });
  const glAccount = useQuery({
    queryKey: ["gltx-gl-account", glId],
    enabled: !!glId,
    staleTime: 600_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("gl_accounts")
        .select("code, name")
        .eq("id", glId!)
        .maybeSingle();
      return (data ?? null) as { code: string; name: string } | null;
    },
  });

  const auditQuery = useQuery({
    queryKey: ["gltx-audit", table, row?.id],
    enabled: !!row && !!table,
    staleTime: 60_000,
    queryFn: () => fetchAuditTrail(table!, row!.id),
  });
  const audit: AuditTrailRow[] = auditQuery.data ?? [];
  const created = audit.find((a) => a.operation === "INSERT") ?? null;
  const last = audit[0] ?? null;

  const createdById = (record?.created_by ?? record?.recorded_by ?? null) as string | null;
  const createdByName = useUserName(created?.actor_name ? null : createdById);
  const updatedByName = useUserName(
    last?.actor_name ? null : ((record?.updated_by as string | null) ?? null),
  );

  const parentSource = row?.parent_type ?? (record?.source_type as string | undefined) ?? null;
  const parentId = row?.parent_id ?? (record?.source_id as string | undefined) ?? null;
  const parentKind = useQuery({
    queryKey: ["gltx-parent-kind", parentSource, parentId],
    enabled: row?.source_type === "payment" && parentSource === "payroll" && !!parentId,
    staleTime: 600_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("payroll")
        .select("kind")
        .eq("id", parentId!)
        .maybeSingle();
      return ((data as { kind?: string } | null)?.kind ?? null) as string | null;
    },
  });

  const link = useMemo(() => {
    if (!row) return null;
    return documentLink(row.source_type, row.id, {
      kind: row.source_type === "payroll" ? (record?.kind as string | null) : parentKind.data,
      parentType: parentSource,
      parentId,
    });
  }, [row, record, parentKind.data, parentSource, parentId]);
  const canOpen = !!link && perms.canView(link.module);

  if (!row) return null;

  const amounts = record ? documentAmounts(row.source_type, record) : null;
  const ccy = row.resolvedCurrency ?? "";
  const money = (n: number) => `${formatAmount(n, 2)} ${ccy}`.trim();
  const refNo = refNoOf(record) ?? row.ref_no ?? null;
  const name = record
    ? documentName(row.source_type, record, row.counterparty ?? row.description)
    : null;
  const ext = record ? externalNumber(row.source_type, record) : null;
  const schedule =
    record && row.source_type === "payroll"
      ? scheduleRows(record.payment_schedule, Number(record.total_amount) || 0)
      : [];
  const total = scheduleTotal(schedule);
  const contractValue = Number(record?.total_amount) || 0;
  const typeLabel = t(`refs.source_${row.source_type}`);

  const createdName = created?.actor_name ?? createdByName.data ?? null;
  const createdAt = created?.created_at ?? (record?.created_at as string | undefined) ?? null;
  const lastName = last?.actor_name ?? updatedByName.data ?? null;
  const lastAt = last?.created_at ?? (record?.updated_at as string | undefined) ?? null;

  const openDoc = () => {
    if (!link) return;
    onClose();
    void navigate({ to: link.to as "/invoices", search: { open: link.open } as never });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-surface border-s border-border shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-surface border-b border-border">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {refNo ?? t("reports.gltx_drawer_title")}
            </div>
            <div className="text-xs text-muted-foreground">
              {typeLabel} · {fmtDate(row.entry_date, locale)}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canOpen && (
              <button
                type="button"
                onClick={openDoc}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20"
              >
                <ExternalLink className="size-3.5 rtl:-scale-x-100" />
                {t("refs.open_document")}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label={t("reports.gltx_close")}
              className="size-8 rounded-lg bg-surface-2 border border-border flex items-center justify-center hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {recordQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" />
              {t("reports.gltx_loading")}
            </div>
          )}
          {recordQuery.isError && (
            <div className="text-sm text-destructive py-2">{t("reports.gltx_error")}</div>
          )}
          {!recordQuery.isLoading && !record && !recordQuery.isError && (
            <div className="text-sm text-muted-foreground py-2">{t("refs.record_missing")}</div>
          )}

          {record && amounts && (
            <dl className="rounded-xl border border-border overflow-hidden">
              <Field label={t("refs.ref_no")}>
                <span className="font-mono" dir="ltr">
                  {refNo ?? t("refs.not_numbered")}
                </span>
              </Field>
              <Field label={t("refs.type")}>{typeLabel}</Field>
              <Field label={t("refs.name")}>{name ?? "—"}</Field>
              {ext && (
                <Field
                  label={t(
                    row.source_type === "invoice" ? "refs.vendor_invoice_no" : "refs.external_no",
                  )}
                >
                  <span dir="ltr">{ext}</span>
                </Field>
              )}
              <Field label={t("refs.budget_line")}>
                {budgetCode ? (
                  <>
                    <span className="font-mono" dir="ltr">
                      {budgetCode}
                    </span>
                    {budgetName.data ? ` — ${budgetName.data}` : ""}
                  </>
                ) : (
                  "—"
                )}
              </Field>
              <Field label={t("refs.account")}>
                {glAccount.data ? `${glAccount.data.code} — ${glAccount.data.name}` : "—"}
              </Field>
              <Field label={t("refs.gross")}>
                <span className="tabular-nums">{money(amounts.gross)}</span>
              </Field>
              <Field label={t("refs.wht")}>
                <span className="tabular-nums">{money(amounts.wht)}</span>
              </Field>
              <Field label={t("refs.net")}>
                <span className="tabular-nums font-semibold">{money(amounts.net)}</span>
              </Field>
              {row.status && <Field label={t("refs.status")}>{row.status}</Field>}
              <Field label={t("refs.created_by")}>
                {createdName ?? t("refs.system")}
                {createdAt ? (
                  <span className="text-muted-foreground"> · {fmtDate(createdAt, locale)}</span>
                ) : null}
              </Field>
              <Field label={t("refs.last_modified")}>
                {lastName ?? t("refs.system")}
                {lastAt ? (
                  <span className="text-muted-foreground"> · {fmtDate(lastAt, locale)}</span>
                ) : null}
              </Field>
            </dl>
          )}

          {/* G10 — payment schedule as a table */}
          {schedule.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                {t("refs.payment_schedule")}
              </div>
              <div className="rounded-xl border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-start font-medium">{t("refs.ms_name")}</th>
                      <th className="px-2 py-1.5 text-end font-medium">%</th>
                      <th className="px-2 py-1.5 text-end font-medium">{t("refs.ms_amount")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("refs.ms_due")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("refs.status")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("refs.ms_paid_on")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("refs.ms_method")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("refs.ms_receipt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="px-2 py-1.5">{m.label}</td>
                        <td className="px-2 py-1.5 text-end tabular-nums">
                          {m.percent != null ? formatAmount(m.percent, 2) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums">
                          {formatAmount(m.amount, 2)}
                        </td>
                        <td className="px-2 py-1.5">{fmtDate(m.dueDate, locale)}</td>
                        <td className="px-2 py-1.5">
                          {t(`refs.ms_status_${m.status.toLowerCase()}`, m.status)}
                        </td>
                        <td className="px-2 py-1.5">{fmtDate(m.paidDate, locale)}</td>
                        <td className="px-2 py-1.5">{m.method ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          {m.receipt && /^https?:\/\//i.test(m.receipt) ? (
                            <a
                              href={m.receipt}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand underline"
                            >
                              {t("refs.ms_view")}
                            </a>
                          ) : m.receipt ? (
                            "✓"
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold">
                      <td className="px-2 py-1.5">{t("refs.total")}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums">
                        {formatAmount(total.percent, 2)}
                      </td>
                      <td className="px-2 py-1.5 text-end tabular-nums">
                        {formatAmount(total.amount, 2)}
                      </td>
                      <td colSpan={5} className="px-2 py-1.5 text-muted-foreground">
                        {Math.abs(total.amount - contractValue) < 0.01
                          ? t("refs.schedule_matches")
                          : t("refs.schedule_differs", { value: formatAmount(contractValue, 2) })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* G12 — audit trail: action, user, time, before -> after */}
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {t("reports.gltx_audit_trail")}
            </div>
            {auditQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="size-4 animate-spin" />
                {t("reports.gltx_loading")}
              </div>
            )}
            {auditQuery.data && audit.length === 0 && (
              <div className="text-sm text-muted-foreground py-2">{t("reports.gltx_no_audit")}</div>
            )}
            <div className="space-y-2">
              {audit.map((a) => {
                const changes = a.operation === "UPDATE" ? fieldChanges(a, locale) : [];
                return (
                  <div
                    key={a.id}
                    className="rounded-xl border border-border bg-surface-2/50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-full border bg-brand/15 text-brand border-brand/30">
                        {t(`refs.action_${a.action}`)}
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {fmtDate(a.created_at, locale)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs">{a.actor_name ?? t("refs.system")}</div>
                    {changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[11px]">
                        {changes.map((c) => (
                          <li key={c.field} className="break-words">
                            <span className="text-muted-foreground">
                              {t(`refs.field_${c.field}`, humanizeField(c.field))}:
                            </span>{" "}
                            <span className="text-destructive line-through">{c.from}</span>
                            {" → "}
                            <span className="text-success">{c.to}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Technical data — administrators only */}
          {perms.isAdmin && record && (
            <div>
              <button
                type="button"
                onClick={() => setShowTech((v) => !v)}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground underline"
              >
                {showTech ? t("refs.hide_technical") : t("refs.show_technical")}
              </button>
              {showTech && (
                <dl className="mt-2 rounded-xl border border-border overflow-hidden">
                  {Object.entries(record).map(([k, v], i) => (
                    <div
                      key={k}
                      className={`grid grid-cols-[minmax(0,40%)_1fr] gap-2 px-3 py-2 text-xs ${i % 2 ? "bg-surface-2/50" : ""}`}
                    >
                      <dt className="font-mono text-muted-foreground truncate" title={k}>
                        {k}
                      </dt>
                      <dd className="break-all tabular-nums font-mono" dir="ltr">
                        {rawValue(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
