// ═══════════════════════════════════════════════════════════════════
// Film Commission Rebate — ONE report with internal sections (decision 11,
// D18). Replaces the old "Saudi Film Commission Rebate", "QFE Rebate
// Report" and "Rebate Tracking" tabs. Every figure comes from
// get_film_commission_rebate (db/pending/197), which reads the single
// eligibility source rebate_transactions(): the same eligible number in
// every section. SAR, excl. VAT. Each section exports alone; "Export all"
// writes one workbook with a sheet per section.
// ═══════════════════════════════════════════════════════════════════
import { KSA_REGIONS, regionSlug, type KsaRegion } from "@/lib/ksa-regions";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Pencil, RotateCcw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { formatAmount } from "@/lib/format-number";
import { formatDateTime } from "@/lib/date-format";
import { useFilmCommissionRebate } from "./rebate-data";
import { exportRebatePdfAll, exportRebateSection, exportRebateWorkbook } from "./rebate-export";
import { formRows, sumBy } from "./rebate-calc";
import {
  REBATE_SECTIONS,
  type EligibilityLogRow,
  type FilmCommissionRebate,
  type RebateSection,
} from "./rebate-types";
import {
  DateText,
  EmptyRow,
  ExportButtons,
  Flags,
  Money,
  SectionHeader,
  StatusPill,
  TableShell,
  Tile,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
} from "./rebate-ui";
import { QpeMappingPanel } from "./QpeMappingPanel";
import { QpeOverrideDialog } from "./QpeOverrideDialog";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${formatAmount(v, 2)}%`);

export function FilmCommissionRebateReport() {
  const { t } = useTranslation();
  const projectId = useStore((s) => s.activeProjectId);
  const q = useFilmCommissionRebate(projectId);
  const [section, setSection] = useState<RebateSection>("summary");
  const [includeAll, setIncludeAll] = useState(false);
  const d = q.data;

  if (!projectId) {
    return <p className="text-sm text-muted-foreground">{t("rebate.no_project")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t("rebate.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("rebate.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeAll}
              onChange={(e) => setIncludeAll(e.target.checked)}
            />
            {t("rebate.include_all_rows")}
          </label>
          <span className="text-xs font-semibold text-muted-foreground">
            {t("rebate.export_all")}
          </span>
          <ExportButtons
            size="md"
            disabled={!d}
            onExport={(kind) =>
              kind === "excel"
                ? exportRebateWorkbook(d!, { includeAll })
                : exportRebatePdfAll(d!, { includeAll })
            }
          />
        </div>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label={t("rebate.sections")}>
        {REBATE_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              section === s ? "bg-brand text-brand-foreground" : "bg-surface hover:bg-muted"
            }`}
          >
            {t(`rebate.section.${s}`)}
          </button>
        ))}
      </nav>

      {q.isLoading && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("rebate.loading")}
        </div>
      )}
      {q.isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {t("rebate.load_failed")}
        </div>
      )}
      {d && (
        <div className="rounded-2xl border border-border bg-surface p-4 md:p-5">
          <SectionBody d={d} section={section} includeAll={includeAll} projectId={projectId} />
        </div>
      )}
    </div>
  );
}

function SectionBody({
  d,
  section,
  includeAll,
  projectId,
}: {
  d: FilmCommissionRebate;
  section: RebateSection;
  includeAll: boolean;
  projectId: string;
}) {
  const { t } = useTranslation();
  const exportThis = (kind: "excel" | "pdf") =>
    exportRebateSection(d, section, kind, { includeAll });
  const header = (hint?: string) => (
    <SectionHeader
      title={t(`rebate.section.${section}`)}
      hint={hint}
      actions={<ExportButtons onExport={exportThis} />}
    />
  );
  switch (section) {
    case "summary":
      return (
        <>
          {header(t("rebate.basis_note"))}
          <SummarySection d={d} />
        </>
      );
    case "general_expenses":
      return (
        <>
          {header(t("rebate.form_56_hint"))}
          <GeneralExpensesSection d={d} includeAll={includeAll} />
        </>
      );
    case "payroll":
      return (
        <>
          {header(t("rebate.form_57_hint"))}
          <PayrollSection d={d} includeAll={includeAll} />
        </>
      );
    case "budget":
      return (
        <>
          {header(t("rebate.variance_note"))}
          <BudgetSection d={d} />
        </>
      );
    case "headcount":
      return (
        <>
          {header()}
          <HeadcountSection d={d} />
        </>
      );
    case "eligibility_log":
      return (
        <>
          {header(t("rebate.eligibility_hint"))}
          <QpeMappingPanel
            projectId={projectId}
            rows={d.mapping ?? []}
            canApprove={!!d.settings?.can_approve_mapping}
          />
          <EligibilityLogSection
            d={d}
            projectId={projectId}
            canOverride={!!d.settings?.can_approve_mapping}
          />
        </>
      );
    case "related_parties":
      return (
        <>
          {header(t("rebate.related_note"))}
          <RelatedSection d={d} />
        </>
      );
    case "documents":
      return (
        <>
          {header(t("rebate.documents_hint"))}
          <DocumentsSection d={d} />
        </>
      );
    case "change_log":
      return (
        <>
          {header(t("rebate.change_log_hint"))}
          <ChangeLogSection d={d} />
        </>
      );
  }
}

function SummarySection({ d }: { d: FilmCommissionRebate }) {
  const { t } = useTranslation();
  const s = d.summary;
  const st = d.settings;
  if (!s) return null;
  const warnings: string[] = [];
  for (const m of s.settings_missing ?? []) warnings.push(t(`rebate.missing.${m}`));
  if (!s.settings_approved) warnings.push(t("rebate.warn.settings_not_approved"));
  if ((s.codes_total ?? 0) > (s.codes_approved ?? 0))
    warnings.push(
      t("rebate.warn.mapping_pending", { count: (s.codes_total ?? 0) - (s.codes_approved ?? 0) }),
    );
  if (s.cash_limit_breached)
    warnings.push(
      t("rebate.warn.cash_limit", {
        pct: formatAmount(s.cash_pct_of_qpe ?? 0, 2),
        limit: formatAmount(s.cash_limit_pct_of_qpe ?? 0, 2),
      }),
    );
  if (s.cash_over_txn_limit > 0)
    warnings.push(t("rebate.warn.cash_txn", { count: s.cash_over_txn_limit }));
  if (s.paid_undocumented > 0)
    warnings.push(t("rebate.warn.undocumented", { amount: formatAmount(s.paid_undocumented, 2) }));
  if (s.needs_review_count > 0)
    warnings.push(t("rebate.warn.needs_review", { count: s.needs_review_count }));
  if (s.cap_reached) warnings.push(t("rebate.warn.cap_reached"));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label={t("rebate.sum.qpe_budget")}
          value={<Money v={s.qpe_budget} />}
          hint={`${t("rebate.sum.budget_total")}: ${formatAmount(s.budget_total, 2)}`}
        />
        <Tile
          label={t("rebate.sum.rate_cap")}
          value={`${pct(s.rebate_rate_pct)} · ${s.rebate_cap_sar == null ? "—" : formatAmount(s.rebate_cap_sar, 2)}`}
          hint={
            st?.fc_agreement_no
              ? `${t("rebate.set.agreement_no")}: ${st.fc_agreement_no}`
              : t("rebate.missing.fc_agreement_no")
          }
        />
        <Tile
          tone="brand"
          label={t("rebate.sum.expected_rebate")}
          value={<Money v={s.expected_rebate ?? null} />}
          hint={`${t("rebate.sum.expected_rebate_contracts")}: ${
            s.expected_rebate_contracts == null ? "—" : formatAmount(s.expected_rebate_contracts, 2)
          }`}
        />
        <Tile
          tone="success"
          label={t("rebate.sum.claimable_rebate")}
          value={<Money v={s.claimable_rebate ?? null} />}
          hint={`${t("rebate.sum.qpe_claimable")}: ${formatAmount(s.qpe_claimable, 2)}`}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={t("rebate.sum.qpe_contracted")} value={<Money v={s.qpe_contracted} />} />
        <Tile label={t("rebate.sum.qpe_actual")} value={<Money v={s.qpe_actual} />} />
        <Tile label={t("rebate.sum.qpe_paid")} value={<Money v={s.qpe_paid} />} />
        <Tile
          tone={s.needs_review_total > 0 ? "warning" : undefined}
          label={t("rebate.sum.needs_review")}
          value={<Money v={s.needs_review_total} />}
          hint={`${t("rebate.sum.not_eligible")}: ${formatAmount(s.not_eligible_total, 2)}`}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          tone={s.cash_limit_breached ? "warning" : undefined}
          label={t("rebate.sum.cash_total")}
          value={<Money v={s.cash_total} />}
          hint={`${pct(s.cash_pct_of_qpe)} / ${t("rebate.sum.cash_limit_pct")} ${pct(s.cash_limit_pct_of_qpe)}`}
        />
        <Tile
          label={t("rebate.sum.transactions")}
          value={`${s.eligible_count} / ${s.transactions}`}
          hint={t("rebate.sum.transactions_hint", {
            review: s.needs_review_count,
            not: s.not_eligible_count,
          })}
        />
        <Tile
          label={t("rebate.sum.shoot_days")}
          value={s.shoot_days}
          hint={
            st?.production_period_from && st?.production_period_to
              ? `${t("rebate.set.period")}: ${st.production_period_from} → ${st.production_period_to}`
              : t("rebate.missing.production_period")
          }
        />
      </div>
      {warnings.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
            <AlertTriangle className="size-4" /> {t("rebate.warnings")}
          </div>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <Link to="/settings" className="mt-2 inline-block text-xs font-semibold text-brand">
            {t("rebate.open_settings")}
          </Link>
        </div>
      )}
    </div>
  );
}

function GeneralExpensesSection({
  d,
  includeAll,
}: {
  d: FilmCommissionRebate;
  includeAll: boolean;
}) {
  const { t } = useTranslation();
  const rows = formRows(d.general_expenses ?? [], includeAll);
  return (
    <TableShell>
      <thead className="bg-surface-2/60">
        <tr>
          <th className={thCls}>{t("rebate.col.ref")}</th>
          <th className={thCls}>{t("rebate.col.category")}</th>
          <th className={thCls}>{t("rebate.col.description")}</th>
          <th className={thCls}>{t("rebate.col.supplier")}</th>
          <th className={thCls}>{t("rebate.col.invoice")}</th>
          <th className={thNumCls}>{t("rebate.col.amount_excl_vat")}</th>
          <th className={thNumCls}>{t("rebate.col.vat")}</th>
          <th className={thNumCls}>{t("rebate.col.paid")}</th>
          <th className={thCls}>{t("rebate.col.payment")}</th>
          <th className={thCls}>{t("rebate.col.status")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow cols={10} text={t("rebate.empty")} />}
        {rows.map((r) => (
          <tr key={r.source_id} className="border-t border-border">
            <td className={tdCls}>
              <div className="font-medium">{r.ref_no ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{t(`rebate.source.${r.source}`)}</div>
            </td>
            <td className={tdCls}>
              {r.qpe_category ? t(`rebate.cat.${r.qpe_category}`) : "—"}
              <div className="text-xs text-muted-foreground">{r.budget_code}</div>
            </td>
            <td className={tdCls}>{r.description}</td>
            <td className={tdCls}>
              {r.supplier}
              <div className="text-xs text-muted-foreground">
                {[r.supplier_nationality, r.vendor_cr ? `CR ${r.vendor_cr}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </td>
            <td className={tdCls}>
              {r.invoice_no}
              <div className="text-xs text-muted-foreground">
                <DateText v={r.invoice_date} />
              </div>
            </td>
            <td className={tdNumCls}>
              <Money v={r.amount_excl_vat} />
            </td>
            <td className={tdNumCls}>
              <Money v={r.vat_amount} />
            </td>
            <td className={tdNumCls}>
              <Money v={r.paid} />
            </td>
            <td className={tdCls}>
              <div className="text-xs">
                {[r.payment_methods, r.payments_count ? `× ${r.payments_count}` : null]
                  .filter(Boolean)
                  .join(" ")}
              </div>
              <div className="text-xs text-muted-foreground">{r.bank_refs}</div>
              <div className="text-xs text-muted-foreground">
                {r.payment_date ? <DateText v={r.payment_date} /> : null}
              </div>
            </td>
            <td className={tdCls}>
              <StatusPill status={r.status} />
              <div className="mt-1 text-xs text-muted-foreground">
                {t(`rebate.reason.${r.reason}`, { defaultValue: r.reason })}
              </div>
              <Flags flags={r.flags} />
            </td>
          </tr>
        ))}
      </tbody>
      {rows.length > 0 && (
        <tfoot className="border-t border-border font-semibold">
          <tr>
            <td className={tdCls} colSpan={5}>
              {t("rebate.total")}
            </td>
            <td className={tdNumCls}>
              <Money v={sumBy(rows, (r) => r.amount_excl_vat)} />
            </td>
            <td className={tdNumCls}>
              <Money v={sumBy(rows, (r) => r.vat_amount)} />
            </td>
            <td className={tdNumCls}>
              <Money v={sumBy(rows, (r) => r.paid)} />
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      )}
    </TableShell>
  );
}

function PayrollSection({ d, includeAll }: { d: FilmCommissionRebate; includeAll: boolean }) {
  const { t } = useTranslation();
  const rows = formRows(d.payroll ?? [], includeAll);
  return (
    <TableShell>
      <thead className="bg-surface-2/60">
        <tr>
          <th className={thCls}>{t("rebate.col.crew_no")}</th>
          <th className={thCls}>{t("rebate.col.name")}</th>
          <th className={thCls}>{t("rebate.col.nationality")}</th>
          <th className={thCls}>{t("rebate.col.related_party")}</th>
          <th className={thCls}>{t("rebate.col.period")}</th>
          <th className={thNumCls}>{t("rebate.col.working_days")}</th>
          <th className={thNumCls}>{t("rebate.col.basic")}</th>
          <th className={thNumCls}>{t("rebate.col.allowances")}</th>
          <th className={thNumCls}>{t("rebate.col.total_salary")}</th>
          <th className={thNumCls}>{t("rebate.col.paid")}</th>
          <th className={thCls}>{t("rebate.col.payment")}</th>
          <th className={thCls}>{t("rebate.col.status")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow cols={12} text={t("rebate.empty")} />}
        {rows.map((r) => (
          <tr key={r.source_id} className="border-t border-border">
            <td className={tdCls}>{r.crew_no ?? "—"}</td>
            <td className={tdCls}>
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.position ?? "—"}</div>
            </td>
            <td className={tdCls}>
              {r.nationality ?? "—"}
              {r.mother_saudi ? (
                <div className="text-xs text-muted-foreground">
                  {t("rebate.mother_saudi_short")}
                </div>
              ) : null}
              <div className="text-xs text-muted-foreground">{r.id_number}</div>
            </td>
            <td className={tdCls}>
              {r.related_party == null ? (
                <span className="text-warning">{t("rebate.answer_missing")}</span>
              ) : r.related_party ? (
                t("rebate.yes")
              ) : (
                t("rebate.no")
              )}
            </td>
            <td className={tdCls}>
              <DateText v={r.from} /> → <DateText v={r.to} />
            </td>
            <td className={tdNumCls}>{r.working_days ?? "—"}</td>
            <td className={tdNumCls}>
              <Money v={r.basic} />
            </td>
            <td className={tdNumCls}>
              <Money v={r.housing + r.overtime + r.per_diem} />
              <div className="text-[10px] text-muted-foreground">
                {t("rebate.col.allowances_breakdown", {
                  housing: formatAmount(r.housing, 0),
                  overtime: formatAmount(r.overtime, 0),
                  per_diem: formatAmount(r.per_diem, 0),
                })}
              </div>
            </td>
            <td className={tdNumCls}>
              <Money v={r.total_salary} />
            </td>
            <td className={tdNumCls}>
              <Money v={r.paid} />
            </td>
            <td className={tdCls}>
              <div className="text-xs">
                {[r.payment_methods, r.payments_count ? `× ${r.payments_count}` : null]
                  .filter(Boolean)
                  .join(" ")}
              </div>
              <div className="text-xs text-muted-foreground">{r.iban}</div>
              <div className="text-xs text-muted-foreground">{r.bank_refs}</div>
            </td>
            <td className={tdCls}>
              <StatusPill status={r.status} />
              <div className="mt-1 text-xs text-muted-foreground">
                {t(`rebate.reason.${r.reason}`, { defaultValue: r.reason })}
              </div>
              <Flags flags={r.flags} />
            </td>
          </tr>
        ))}
      </tbody>
      {rows.length > 0 && (
        <tfoot className="border-t border-border font-semibold">
          <tr>
            <td className={tdCls} colSpan={6}>
              {t("rebate.total")}
            </td>
            <td className={tdNumCls}>
              <Money v={sumBy(rows, (r) => r.basic)} />
            </td>
            <td className={tdNumCls}>
              <Money v={sumBy(rows, (r) => r.housing + r.overtime + r.per_diem)} />
            </td>
            <td className={tdNumCls}>
              <Money v={sumBy(rows, (r) => r.total_salary)} />
            </td>
            <td className={tdNumCls}>
              <Money v={sumBy(rows, (r) => r.paid)} />
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      )}
    </TableShell>
  );
}

/** Region row label: a KSA region, outside KSA or unassigned (db/pending/201). */
export function regionLabel(t: (k: string) => string, region: string): string {
  if (region === "unassigned") return t("rebate.region_unassigned");
  if (region === "outside_ksa") return t("decisions.region.outside_ksa");
  return KSA_REGIONS.includes(region as KsaRegion)
    ? t(`decisions.region.${regionSlug(region)}`)
    : region;
}

function BudgetSection({ d }: { d: FilmCommissionRebate }) {
  const { t } = useTranslation();
  const groups = d.budget?.by_group ?? [];
  const regions = d.budget?.by_region ?? [];
  return (
    <div className="space-y-5">
      <TableShell>
        <thead className="bg-surface-2/60">
          <tr>
            <th className={thCls}>{t("rebate.col.group")}</th>
            <th className={thNumCls}>{t("rebate.col.budget_total")}</th>
            <th className={thNumCls}>{t("rebate.col.budget_qpe")}</th>
            <th className={thNumCls}>{t("rebate.col.actual_total")}</th>
            <th className={thNumCls}>{t("rebate.col.actual_qpe")}</th>
            <th className={thNumCls}>{t("rebate.col.variance_qpe")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && <EmptyRow cols={6} text={t("rebate.empty")} />}
          {groups.map((g) => (
            <tr key={g.group} className="border-t border-border">
              <td className={tdCls}>{t(`rebate.group.${g.group}`)}</td>
              <td className={tdNumCls}>
                <Money v={g.budget_total} />
              </td>
              <td className={tdNumCls}>
                <Money v={g.budget_qpe} />
              </td>
              <td className={tdNumCls}>
                <Money v={g.actual_total} />
              </td>
              <td className={tdNumCls}>
                <Money v={g.actual_qpe} />
              </td>
              <td className={tdNumCls}>
                <Money v={g.variance_qpe} />
              </td>
            </tr>
          ))}
        </tbody>
        {groups.length > 0 && (
          <tfoot className="border-t border-border font-semibold">
            <tr>
              <td className={tdCls}>{t("rebate.total")}</td>
              {(
                [
                  "budget_total",
                  "budget_qpe",
                  "actual_total",
                  "actual_qpe",
                  "variance_qpe",
                ] as const
              ).map((k) => (
                <td key={k} className={tdNumCls}>
                  <Money v={sumBy(groups, (g) => g[k])} />
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </TableShell>
      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("rebate.budget_by_region")}</h4>
        <TableShell>
          <thead className="bg-surface-2/60">
            <tr>
              <th className={thCls}>{t("rebate.col.region")}</th>
              <th className={thNumCls}>{t("decisions.region.estimate")}</th>
              <th className={thNumCls}>{t("rebate.col.actual_total")}</th>
              <th className={thNumCls}>{t("rebate.col.actual_qpe")}</th>
              <th className={thNumCls}>{t("decisions.region.variance")}</th>
            </tr>
          </thead>
          <tbody>
            {regions.length === 0 && <EmptyRow cols={5} text={t("rebate.empty")} />}
            {regions.map((r) => (
              <tr key={r.region} className="border-t border-border">
                <td className={tdCls}>{regionLabel(t, r.region)}</td>
                <td className={tdNumCls}>{r.estimate == null ? "—" : <Money v={r.estimate} />}</td>
                <td className={tdNumCls}>
                  <Money v={r.actual_total ?? 0} />
                </td>
                <td className={tdNumCls}>
                  <Money v={r.actual_qpe ?? 0} />
                </td>
                <td className={tdNumCls}>{r.variance == null ? "—" : <Money v={r.variance} />}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        <p className="mt-1 text-xs text-muted-foreground">{t("decisions.region.reportHint")}</p>
      </div>
    </div>
  );
}

function HeadcountSection({ d }: { d: FilmCommissionRebate }) {
  const { t } = useTranslation();
  const h = d.headcount;
  if (!h) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label={t("rebate.hc.total")}
        value={h.total}
        hint={`${t("rebate.hc.crew")} ${h.crew} · ${t("rebate.hc.cast")} ${h.cast}`}
      />
      <Tile
        tone="success"
        label={t("rebate.hc.saudi")}
        value={h.saudi}
        hint={`${t("rebate.hc.saudi_crew")} ${h.saudi_crew} · ${t("rebate.hc.saudi_cast")} ${h.saudi_cast}`}
      />
      <Tile
        label={t("rebate.hc.saudi_trainees")}
        value={h.saudi_trainees}
        hint={t("rebate.hc.trainee_hint")}
      />
      <Tile
        tone={h.nationality_missing > 0 ? "warning" : undefined}
        label={t("rebate.hc.nationality_missing")}
        value={h.nationality_missing}
      />
    </div>
  );
}

function EligibilityLogSection({
  d,
  projectId,
  canOverride,
}: {
  d: FilmCommissionRebate;
  projectId: string;
  canOverride: boolean;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | "eligible" | "needs_review" | "not_eligible">("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EligibilityLogRow | null>(null);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (d.eligibility_log ?? []).filter(
      (r) =>
        (filter === "all" || r.status === filter) &&
        (!q ||
          [r.ref_no, r.doc_no, r.party, r.budget_code]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))),
    );
  }, [d.eligibility_log, filter, search]);
  const input =
    "rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/40";
  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h4 className="text-sm font-semibold">{t("rebate.log_title")}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("rebate.search")}
            className={input}
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className={input}
          >
            <option value="all">{t("rebate.all_statuses")}</option>
            <option value="eligible">{t("rebate.status.eligible")}</option>
            <option value="needs_review">{t("rebate.status.needs_review")}</option>
            <option value="not_eligible">{t("rebate.status.not_eligible")}</option>
          </select>
        </div>
      </div>
      <TableShell>
        <thead className="bg-surface-2/60">
          <tr>
            <th className={thCls}>{t("rebate.col.ref")}</th>
            <th className={thCls}>{t("rebate.col.party")}</th>
            <th className={thCls}>{t("rebate.col.category")}</th>
            <th className={thNumCls}>{t("rebate.col.amount_excl_vat")}</th>
            <th className={thNumCls}>{t("rebate.col.claimable")}</th>
            <th className={thCls}>{t("rebate.col.status")}</th>
            <th className={thCls}>{t("rebate.col.override")}</th>
            {canOverride && <th className={thCls} />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={canOverride ? 8 : 7} text={t("rebate.empty")} />}
          {rows.map((r) => (
            <tr key={`${r.source}-${r.source_id}`} className="border-t border-border">
              <td className={tdCls}>
                <div className="font-medium">{r.ref_no ?? r.doc_no ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {t(`rebate.source.${r.source}`)} · <DateText v={r.date} />
                </div>
              </td>
              <td className={tdCls}>
                {r.party}
                <div className="text-xs text-muted-foreground">
                  {[r.nationality, r.mother_saudi ? t("rebate.mother_saudi_short") : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </td>
              <td className={tdCls}>
                {r.qpe_category ? t(`rebate.cat.${r.qpe_category}`) : "—"}
                <div className="text-xs text-muted-foreground">
                  {r.budget_code} · {t(`rebate.mapping_status.${r.mapping_status}`)}
                </div>
              </td>
              <td className={tdNumCls}>
                <Money v={r.amount_excl_vat} />
              </td>
              <td className={tdNumCls}>
                <Money v={r.claimable_excl} />
              </td>
              <td className={tdCls}>
                <StatusPill status={r.status} />
                <div className="mt-1 text-xs text-muted-foreground">
                  {t(`rebate.reason.${r.reason}`, { defaultValue: r.reason })}
                </div>
                <Flags flags={r.flags} />
              </td>
              <td className={tdCls}>
                {r.override_reason ? (
                  <div className="text-xs">
                    {r.override_reason}
                    <div className="text-muted-foreground">
                      {[r.override_by_name, r.override_at ? formatDateTime(r.override_at) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
              {canOverride && (
                <td className={tdCls}>
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
                  >
                    {r.rule === "override" ? (
                      <RotateCcw className="size-3" />
                    ) : (
                      <Pencil className="size-3" />
                    )}
                    {t("rebate.override_action")}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </TableShell>
      {editing && (
        <QpeOverrideDialog projectId={projectId} row={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function RelatedSection({ d }: { d: FilmCommissionRebate }) {
  const { t } = useTranslation();
  const rows = d.related_parties ?? [];
  return (
    <TableShell>
      <thead className="bg-surface-2/60">
        <tr>
          <th className={thCls}>{t("rebate.col.name")}</th>
          <th className={thCls}>{t("rebate.col.party_type")}</th>
          <th className={thCls}>{t("rebate.col.nationality")}</th>
          <th className={thCls}>{t("rebate.col.relation")}</th>
          <th className={thCls}>{t("rebate.col.transaction_type")}</th>
          <th className={thNumCls}>{t("rebate.col.total_value")}</th>
          <th className={thNumCls}>{t("rebate.col.count")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow cols={7} text={t("rebate.no_related")} />}
        {rows.map((r) => (
          <tr key={`${r.name}-${r.party_type}`} className="border-t border-border">
            <td className={tdCls}>{r.name}</td>
            <td className={tdCls}>{t(`rebate.party_type.${r.party_type}`)}</td>
            <td className={tdCls}>{r.nationality ?? "—"}</td>
            <td className={tdCls}>{r.relation ?? "—"}</td>
            <td className={tdCls}>
              {(r.transaction_types ?? "")
                .split(", ")
                .filter(Boolean)
                .map((s) => t(`rebate.source.${s}`))
                .join(", ")}
            </td>
            <td className={tdNumCls}>
              <Money v={r.total_value} />
            </td>
            <td className={tdNumCls}>{r.transactions}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function Check({ ok }: { ok: boolean | null | undefined }) {
  const { t } = useTranslation();
  if (ok == null) return <span className="text-muted-foreground">—</span>;
  return ok ? (
    <span className="text-success">{t("rebate.yes")}</span>
  ) : (
    <span className="text-destructive">{t("rebate.no")}</span>
  );
}

function DocumentsSection({ d }: { d: FilmCommissionRebate }) {
  const { t } = useTranslation();
  const rows = d.documents ?? [];
  return (
    <TableShell>
      <thead className="bg-surface-2/60">
        <tr>
          <th className={thCls}>{t("rebate.col.ref")}</th>
          <th className={thCls}>{t("rebate.col.party")}</th>
          <th className={thCls}>{t("rebate.doc.source_document")}</th>
          <th className={thCls}>{t("rebate.doc.payment_proof")}</th>
          <th className={thCls}>{t("rebate.doc.id_document")}</th>
          <th className={thCls}>{t("rebate.doc.vendor_cr")}</th>
          <th className={thCls}>{t("rebate.doc.complete")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow cols={7} text={t("rebate.empty")} />}
        {rows.map((r) => (
          <tr key={`${r.source}-${r.source_id}`} className="border-t border-border">
            <td className={tdCls}>
              <div className="font-medium">{r.ref_no ?? r.doc_no ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{t(`rebate.source.${r.source}`)}</div>
            </td>
            <td className={tdCls}>
              {r.party}
              <Flags flags={r.flags} />
            </td>
            <td className={tdCls}>
              <Check ok={r.source_document} />
            </td>
            <td className={tdCls}>
              <Check ok={r.payment_proof} />
              <div className="text-xs text-muted-foreground">{r.bank_refs}</div>
            </td>
            <td className={tdCls}>
              <Check ok={r.id_document} />
            </td>
            <td className={tdCls}>{r.vendor_cr ?? "—"}</td>
            <td className={tdCls}>
              <Check ok={r.documented} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function ChangeLogSection({ d }: { d: FilmCommissionRebate }) {
  const { t } = useTranslation();
  const rows = d.change_log ?? [];
  return (
    <TableShell>
      <thead className="bg-surface-2/60">
        <tr>
          <th className={thCls}>{t("rebate.col.date")}</th>
          <th className={thCls}>{t("rebate.col.area")}</th>
          <th className={thCls}>{t("rebate.col.subject")}</th>
          <th className={thCls}>{t("rebate.col.changes")}</th>
          <th className={thCls}>{t("rebate.col.user")}</th>
          <th className={thCls}>{t("rebate.col.reason")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow cols={6} text={t("rebate.empty")} />}
        {rows.map((r, i) => (
          <tr key={`${r.changed_at}-${i}`} className="border-t border-border">
            <td className={`${tdCls} whitespace-nowrap`}>{formatDateTime(r.changed_at)}</td>
            <td className={tdCls}>
              {t(`rebate.area.${r.area}`)}
              <div className="text-xs text-muted-foreground">
                {t(`rebate.op.${r.operation}`, { defaultValue: r.operation })}
              </div>
            </td>
            <td className={tdCls}>{r.subject}</td>
            <td className={`${tdCls} text-xs`}>
              {Object.entries(r.changes ?? {})
                .slice(0, 6)
                .map(([k, v]) => (
                  <div key={k} className="break-all">
                    <span className="font-medium">{k}</span>:{" "}
                    {String((v as { from?: unknown })?.from ?? "—")} →{" "}
                    {String((v as { to?: unknown })?.to ?? "—")}
                  </div>
                ))}
            </td>
            <td className={tdCls}>{r.user_name ?? t("rebate.system")}</td>
            <td className={tdCls}>{r.reason ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}
