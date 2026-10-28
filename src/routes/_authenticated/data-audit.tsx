import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { requireRoles } from "@/lib/auth-roles";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, Wand2 } from "lucide-react";

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
export const Route = createFileRoute("/_authenticated/data-audit")({
  beforeLoad: () => requireRoles((r) => r.isSuperAdmin),
  component: () => (
    <AppShell>
      <DataAuditPage />
    </AppShell>
  ),
});

type TableKey =
  | "budget_lines"
  | "payroll"
  | "invoices"
  | "crew_members"
  | "vendors"
  | "purchase_orders"
  | "people";
const TABLES: { key: TableKey; label: string; nameCol: string }[] = [
  { key: "budget_lines", label: "Budget", nameCol: "description" },
  { key: "payroll", label: "Payroll", nameCol: "name" },
  { key: "invoices", label: "Invoices", nameCol: "description" },
  { key: "crew_members", label: "Crew", nameCol: "full_name" },
  { key: "vendors", label: "Vendors", nameCol: "name" },
  { key: "purchase_orders", label: "Purchase Orders", nameCol: "po_number" },
  { key: "people", label: "Cast/People", nameCol: "full_name" },
];

type Orphan = { table: TableKey; id: string; label: string; organization_id: string | null };
type Project = { id: string; name: string; organization_id: string | null };

function DataAuditPage() {
  const { t } = useTranslation();

  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: projs }, ...results] = await Promise.all([
        supabase.from("projects").select("id,name,organization_id").order("name"),
        ...TABLES.map((t) =>
          supabase
            .from(t.key as any)
            .select(`id, organization_id, ${t.nameCol}`)
            .is("project_id", null)
            .limit(500),
        ),
      ]);
      setProjects((projs ?? []) as any);
      const found: Orphan[] = [];
      results.forEach((res, i) => {
        const t = TABLES[i];
        for (const row of (res.data ?? []) as any[]) {
          found.push({
            table: t.key,
            id: row.id,
            label: String(row[t.nameCol] ?? "(unnamed)"),
            organization_id: row.organization_id ?? null,
          });
        }
      });
      setOrphans(found);
    } catch (e: any) {
      toast.error(e?.message ?? "Scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const assign = async (o: Orphan, projectId: string) => {
    setAssigning(`${o.table}:${o.id}`);
    try {
      const { error } = await supabase
        .from(o.table as any)
        .update({ project_id: projectId })
        .eq("id", o.id);
      if (error) throw error;
      setOrphans((rs) => rs.filter((x) => !(x.table === o.table && x.id === o.id)));
      toast.success(t("data_audit.assigned_to_project"));
    } catch (e: any) {
      toast.error(e?.message ?? "Assign failed");
    } finally {
      setAssigning(null);
    }
  };

  const byTable = TABLES.map((t) => ({ ...t, rows: orphans.filter((o) => o.table === t.key) }));
  const totalOrphans = orphans.length;

  return (
    <>
      <PageTitle
        title={t("data_audit.data_audit")}
        action={
          <button
            onClick={scan}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Rescan
          </button>
        }
      />

      <Panel className="mb-5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <div className="font-semibold">
              {loading
                ? "Scanning…"
                : totalOrphans === 0
                  ? "✓ No orphan records — every row is linked to a project."
                  : `${totalOrphans} orphan record(s) missing a project link`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Orphan rows are invisible in project-scoped views. Use Quick Assign to map them to an
              active project.
            </p>
          </div>
        </div>
      </Panel>

      <div className="space-y-4">
        {byTable.map((t) => (
          <Panel key={t.key} className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2.5">
              <div className="text-sm font-semibold">{t.label}</div>
              <div className="text-xs text-muted-foreground">{t.rows.length} orphan(s)</div>
            </div>
            {t.rows.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                {i18n.t("data_audit.all_rows_scoped")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="app-table w-full text-sm">
                  <thead className="bg-surface text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-start">Record</th>
                      <th className="px-4 py-2 text-start">Organization</th>
                      <th className="px-4 py-2 text-end">{i18n.t("data_audit.quick_assign")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((o) => {
                      const eligible = projects.filter(
                        (p) => !o.organization_id || p.organization_id === o.organization_id,
                      );
                      const busy = assigning === `${o.table}:${o.id}`;
                      return (
                        <tr key={o.id} className="border-t border-border">
                          <td className="px-4 py-2">{o.label}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground font-mono">
                            {o.organization_id?.slice(0, 8) ?? "—"}
                          </td>
                          <td className="px-4 py-2 text-end">
                            <div className="inline-flex items-center gap-2">
                              <select
                                disabled={busy || eligible.length === 0}
                                defaultValue=""
                                onChange={(e) => e.target.value && assign(o, e.target.value)}
                                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                              >
                                <option value="">
                                  {eligible.length === 0 ? "No projects in org" : "Pick project…"}
                                </option>
                                {eligible.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                              <Wand2 className="size-3.5 text-muted-foreground" />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}
