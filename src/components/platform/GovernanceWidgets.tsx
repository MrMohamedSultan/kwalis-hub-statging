// ═══════════════════════════════════════════════════════════════════
// Governance widgets for the Platform Hub dashboard.
// Super-admin only surfaces — RLS scopes every query to platform
// owners; these components render cross-company aggregates.
// ═══════════════════════════════════════════════════════════════════

import { formatDate } from "@/lib/date-format";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { listCompanies, type CompanyRow } from "@/lib/platform-companies";
import {
  normalizeSubscriptionStatus,
  subscriptionStatusBadgeClass,
  subscriptionStatusLabel,
} from "@/lib/subscription-status";

function statusBadgeClass(status?: string | null) {
  switch (status) {
    case "Active":
    case "active":
      return "bg-success/15 text-success border-success/30";
    case "Trial":
    case "trial":
    case "planning":
      return "bg-brand/15 text-brand border-brand/30";
    case "Suspended":
    case "suspended":
    case "on_hold":
      return "bg-warning/15 text-warning border-warning/30";
    case "Cancelled":
    case "cancelled":
      return "bg-destructive/15 text-destructive border-destructive/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ─── GlobalAnalytics ────────────────────────────────────────────────

export function GlobalAnalytics() {
  const { t } = useTranslation();
  const [companyStatus, setCompanyStatus] = useState<Record<string, number>>({});
  const [projectStatus, setProjectStatus] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [orgs, projects] = await Promise.all([
          supabase.from("organizations").select("subscription_status"),
          supabase.from("projects").select("status"),
        ]);
        if (cancelled) return;
        const byStatus = (rows: { [k: string]: string | null }[], key: string) => {
          const out: Record<string, number> = {};
          for (const r of rows) {
            const v = (r[key] as string | null) ?? "unknown";
            out[v] = (out[v] ?? 0) + 1;
          }
          return out;
        };
        // D01: group by the canonical status so "Active" and "active" are one bucket
        // (D19: the label is translated when shown, the bucket key stays canonical).
        setCompanyStatus(
          byStatus(
            (orgs.data ?? []).map((o) => ({
              subscription_status:
                normalizeSubscriptionStatus(o.subscription_status) ?? o.subscription_status,
            })),
            "subscription_status",
          ),
        );
        setProjectStatus(byStatus(projects.data ?? [], "status"));
      } catch (err) {
        console.error("GlobalAnalytics failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const renderBreakdown = (
    title: string,
    data: Record<string, number>,
    label: (k: string) => string,
  ) => (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : Object.keys(data).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("closeout.ui.gov.no_data")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {Object.entries(data).map(([k, v]) => (
            <span
              key={k}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadgeClass(k)}`}
            >
              {label(k)}
              <span className="tabular-nums font-semibold">{v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Panel title={t("closeout.ui.gov.analytics")}>
      <div className="grid gap-5 sm:grid-cols-2">
        {renderBreakdown(t("closeout.ui.gov.by_subscription"), companyStatus, (k) =>
          k === "unknown" ? t("closeout.ui.gov.unknown") : subscriptionStatusLabel(k),
        )}
        {renderBreakdown(t("closeout.ui.gov.by_status"), projectStatus, (k) =>
          k === "unknown" ? t("closeout.ui.gov.unknown") : k,
        )}
      </div>
    </Panel>
  );
}

// ─── PlatformProjectsOverview ───────────────────────────────────────

type ProjectRow = {
  id: string;
  name: string;
  code: string | null;
  status: string | null;
  created_at: string;
  orgName: string | null;
};

export function PlatformProjectsOverview() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("projects")
          .select("id, name, code, status, created_at, organizations:organization_id(name)")
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        if (cancelled) return;
        setRows(
          (data ?? []).map(
            (p: {
              id: string;
              name: string;
              code: string | null;
              status: string | null;
              created_at: string;
              organizations: { name: string } | { name: string }[] | null;
            }) => {
              const org = Array.isArray(p.organizations) ? p.organizations[0] : p.organizations;
              return {
                id: p.id,
                name: p.name,
                code: p.code,
                status: p.status,
                created_at: p.created_at,
                orgName: org?.name ?? null,
              };
            },
          ),
        );
      } catch (err) {
        console.error("PlatformProjectsOverview failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel title={t("closeout.ui.gov.productions_overview")}>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("closeout.ui.gov.no_productions")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 text-start font-medium">
                  {t("closeout.ui.gov.production")}
                </th>
                <th className="px-2 py-2 text-start font-medium">{t("closeout.ui.code")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("closeout.ui.company")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("common.status")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("closeout.ui.created")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-2 font-medium text-foreground">{p.name}</td>
                  <td className="px-2 py-2">
                    {p.code ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {p.code}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{p.orgName ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(p.status)}`}
                    >
                      {p.status ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">
                    {formatDate(p.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ─── OrgTable ───────────────────────────────────────────────────────

export function OrgTable() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    listCompanies()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((err) => console.error("OrgTable failed:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel title={t("closeout.ui.gov.client_companies")}>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("closeout.ui.gov.no_companies")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 text-start font-medium">{t("closeout.ui.company")}</th>
                <th className="px-2 py-2 text-start font-medium">
                  {t("closeout.ui.org.industry")}
                </th>
                <th className="px-2 py-2 text-start font-medium">{t("common.status")}</th>
                <th className="px-2 py-2 text-end font-medium">{t("closeout.ui.gov.users")}</th>
                <th className="px-2 py-2 text-end font-medium">
                  {t("closeout.ui.gov.productions")}
                </th>
                <th className="px-2 py-2 text-start font-medium">
                  {t("closeout.ui.gov.onboarded")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  onClick={() =>
                    navigate({
                      to: "/platform-hub/companies/$companyId",
                      params: { companyId: c.id },
                    })
                  }
                >
                  <td className="px-2 py-2 font-medium text-foreground">{c.name}</td>
                  <td className="px-2 py-2 text-muted-foreground">{c.industry ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${subscriptionStatusBadgeClass(c.subscription_status)}`}
                    >
                      {subscriptionStatusLabel(c.subscription_status)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums text-muted-foreground">
                    {c.userCount}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums text-muted-foreground">
                    {c.projectCount}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">
                    {c.onboarded_at ? formatDate(c.onboarded_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
