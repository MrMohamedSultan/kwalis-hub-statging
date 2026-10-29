import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Building2 } from "lucide-react";
import { toast } from "sonner";
import { PageTitle } from "@/components/AppShell";
import { AddOrgModal } from "@/components/platform/AddOrgModal";
import { listCompanies, type CompanyRow } from "@/lib/platform-companies";
import { industryLabel } from "@/lib/access-requests";

import { useTranslation } from "react-i18next";
import { subscriptionStatusBadgeClass, subscriptionStatusLabel } from "@/lib/subscription-status";
export const Route = createFileRoute("/_platform-hub/platform-hub/companies")({
  head: () => ({
    meta: [
      { title: "Client Companies — Kwalis HUB" },
      {
        name: "description",
        content: "Manage tenant organizations across the Kwalis HUB platform.",
      },
      { property: "og:title", content: "Client Companies — Kwalis HUB" },
      {
        property: "og:description",
        content: "Manage tenant organizations across the Kwalis HUB platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompaniesPage,
});

function CompaniesPage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      setRows(await listCompanies());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("closeout.ui.gov.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [
        r.name,
        r.contact_email,
        r.contact_phone,
        r.commercial_registration,
        r.subscription_status,
        industryLabel(r.industry),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  return (
    <>
      <PageTitle
        title={t("closeout.ui.gov.client_companies")}
        back={false}
        action={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground hover:opacity-90"
          >
            <Plus className="size-3.5" />
            {t("hub_companies.add_company")}
          </button>
        }
      />

      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="size-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("hub_companies.search_name_email_phone_cr_industry")}
              className="w-full rounded-lg border border-border bg-card ps-9 pe-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          {!loading && (
            <span className="text-xs text-muted-foreground">
              {t("platform.billing.countOf", { shown: filtered.length, total: rows.length })}
            </span>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-start font-semibold px-4 py-3">
                  {t("platform.billing.company")}
                </th>
                <th className="text-start font-semibold px-4 py-3">
                  {t("platform.billing.industry")}
                </th>
                <th className="text-start font-semibold px-4 py-3">
                  {t("platform.billing.users")}
                </th>
                <th className="text-start font-semibold px-4 py-3">
                  {t("platform.billing.projects")}
                </th>
                <th className="text-start font-semibold px-4 py-3">
                  {t("platform.billing.activeProjects")}
                </th>
                <th className="text-start font-semibold px-4 py-3">
                  {t("platform.billing.billable")}
                </th>
                <th className="text-start font-semibold px-4 py-3">
                  {t("platform.billing.subscription")}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    {t("platform.common.loading")}
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Building2 className="size-6 mx-auto mb-2 opacity-60" />
                    {t("hub_companies.no_companies_found")}
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() =>
                    navigate({
                      to: "/platform-hub/companies/$companyId",
                      params: { companyId: c.id },
                    })
                  }
                  className="border-t border-border cursor-pointer hover:bg-accent/40 transition"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.contact_email || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {industryLabel(c.industry)}
                  </td>
                  <td className="px-4 py-3">{c.userCount}</td>
                  <td className="px-4 py-3 tabular-nums">{c.projectCount}</td>
                  <td className="px-4 py-3 tabular-nums">{c.activeProjectCount}</td>
                  <td className="px-4 py-3 tabular-nums">
                    <span
                      className={
                        c.max_projects > 0 && c.billableProjectCount > c.max_projects
                          ? "font-semibold text-destructive"
                          : ""
                      }
                      title={t("platform.billing.limitHint")}
                    >
                      {c.billableProjectCount} / {c.max_projects}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${subscriptionStatusBadgeClass(c.subscription_status)}`}
                    >
                      {subscriptionStatusLabel(c.subscription_status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen && (
        <AddOrgModal
          onClose={() => {
            setAddOpen(false);
            void refresh();
          }}
        />
      )}
    </>
  );
}
