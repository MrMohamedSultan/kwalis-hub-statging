import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Users, Clapperboard, Activity } from "lucide-react";
import { PageTitle } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { MetricCard } from "@/components/ui/MetricCard";
import { SecurityAlertsWidget } from "@/components/SecurityAlertsWidget";

import { useTranslation } from "react-i18next";
import {
  GlobalAnalytics,
  PlatformProjectsOverview,
  OrgTable,
} from "@/components/platform/GovernanceWidgets";

export const Route = createFileRoute("/_platform-hub/platform-hub/dashboard")({
  head: () => ({
    meta: [
      { title: "Governance Dashboard — Kwalis HUB" },
      {
        name: "description",
        content: "Platform-wide governance overview across all client companies and productions.",
      },
      { property: "og:title", content: "Governance Dashboard — Kwalis HUB" },
      {
        property: "og:description",
        content: "Platform-wide governance overview across all client companies and productions.",
      },
    ],
  }),
  component: GovernanceDashboard,
});

type PlatformStats = {
  totalCompanies: number;
  totalUsers: number;
  totalProjects: number;
  activeProjects: number;
};

function GovernanceDashboard() {
  const { t } = useTranslation();

  const [stats, setStats] = useState<PlatformStats>({
    totalCompanies: 0,
    totalUsers: 0,
    totalProjects: 0,
    activeProjects: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [companies, users, projects] = await Promise.all([
          supabase.from("organizations").select("id", { count: "exact", head: true }),
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("projects").select("id, status"),
        ]);
        if (cancelled) return;
        const list = projects.data ?? [];
        setStats({
          totalCompanies: companies.count ?? 0,
          totalUsers: users.count ?? 0,
          totalProjects: list.length,
          activeProjects: list.filter((p) => p.status === "active").length,
        });
      } catch (err) {
        console.error("Failed to load platform stats:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageTitle title={t("hub_dashboard.governance_dashboard")} back={false} />
      <p className="-mt-2 mb-5 text-sm text-muted-foreground">
        {t("hub_dashboard.platformwide_overview_across_all_client_companies_and_productions")}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Client Companies"
          value={stats.totalCompanies}
          loading={loading}
          icon={<Building2 className="size-5 text-brand" />}
        />
        <StatCard
          label="Platform Users"
          value={stats.totalUsers}
          loading={loading}
          icon={<Users className="size-5 text-brand" />}
        />
        <StatCard
          label="Productions"
          value={stats.totalProjects}
          loading={loading}
          icon={<Clapperboard className="size-5 text-brand" />}
        />
        <StatCard
          label="Active Productions"
          value={stats.activeProjects}
          loading={loading}
          icon={<Activity className="size-5 text-brand" />}
        />
      </div>

      <div className="mt-6 space-y-6">
        <SecurityAlertsWidget />
        <GlobalAnalytics />
        <PlatformProjectsOverview />
        <OrgTable />
      </div>

      <div className="mt-5 text-xs text-muted-foreground">
        Platform-level data • Cross-company aggregation
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  icon,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <MetricCard
      label={label}
      value={loading ? "—" : value.toLocaleString()}
      icon={icon}
      sentiment="neutral"
    />
  );
}
