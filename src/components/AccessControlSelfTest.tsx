import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, ShieldAlert, Play, Loader2 } from "lucide-react";

import { useTranslation } from "react-i18next";
type Check = {
  name: string;
  status: "pending" | "pass" | "fail" | "skip";
  detail?: string;
};

/**
 * Access Control Self-Test
 *
 * Live-verifies that the RLS policies + `can_access_project` helper are
 * actually enforcing project isolation for the currently signed-in user.
 *
 * For each sensitive table we run a broad SELECT with no filter. The Data
 * API should ONLY return rows belonging to projects/orgs where the user
 * is a member (or super admin). If any row comes back with a project_id
 * the caller is NOT a member of, the check fails loudly.
 */
export function AccessControlSelfTest() {
  const { t } = useTranslation();

  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);

  const run = async () => {
    setRunning(true);
    const results: Check[] = [];

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setChecks([{ name: "auth", status: "fail", detail: "Not signed in." }]);
      setRunning(false);
      return;
    }

    // Collect the set of project_ids the current user is allowed to see.
    const { data: memberProjects } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", uid);
    const allowedProjects = new Set(
      (memberProjects ?? []).map((r: { project_id: string }) => r.project_id),
    );

    const { data: orgMemberships } = await supabase
      .from("organization_members")
      .select("organization_id,role")
      .eq("user_id", uid);
    const adminOrgs = new Set(
      (orgMemberships ?? [])
        .filter((r: { role: string }) => r.role === "owner" || r.role === "admin")
        .map((r: { organization_id: string }) => r.organization_id),
    );

    const { data: superRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("role", "super_admin")
      .maybeSingle();
    const isSuper = !!superRow;

    if (isSuper) {
      setChecks([
        {
          name: "super_admin",
          status: "skip",
          detail: "Super admins bypass project scoping — self-test not applicable.",
        },
      ]);
      setRunning(false);
      return;
    }

    // Fetch project_id → organization_id map for the projects we CAN see, so
    // we can tell whether a row belongs to an admin-org (legitimate) vs a
    // truly foreign project (leak).
    const { data: visibleProjects } = await supabase.from("projects").select("id,organization_id");
    const projOrg = new Map(
      (visibleProjects ?? []).map((p: { id: string; organization_id: string | null }) => [
        p.id,
        p.organization_id ?? "",
      ]),
    );

    const tables = [
      "budget_lines",
      "invoices",
      "payroll",
      "purchase_orders",
      "cash_advances",
      "transactions",
      "people",
      "vendors",
    ] as const;

    for (const t of tables) {
      const { data, error } = await supabase
        .from(t)
        .select("project_id,organization_id")
        .limit(500);
      if (error) {
        results.push({ name: t, status: "fail", detail: error.message });
        continue;
      }
      const rows = (data ?? []) as { project_id: string | null; organization_id: string | null }[];
      const leaks = rows.filter((r) => {
        if (!r.project_id) return false;
        if (allowedProjects.has(r.project_id)) return false;
        const org = r.organization_id ?? projOrg.get(r.project_id) ?? null;
        if (org && adminOrgs.has(org)) return false;
        return true;
      });
      if (leaks.length > 0) {
        results.push({
          name: t,
          status: "fail",
          detail: `RLS leak: ${leaks.length} row(s) returned from projects the user is not a member of.`,
        });
      } else {
        results.push({
          name: t,
          status: "pass",
          detail: `${rows.length} row(s) visible — all within allowed projects.`,
        });
      }
      setChecks([...results]);
    }

    setRunning(false);
  };

  const failed = checks.filter((c) => c.status === "fail").length;
  const passed = checks.filter((c) => c.status === "pass").length;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand" />
          <h3 className="text-sm font-semibold text-card-foreground">
            {t("accesscontrolselftest.access_control_selftest")}
          </h3>
        </div>
        <button
          onClick={() => void run()}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-brand-foreground text-xs font-semibold hover:brightness-110 disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {running ? "Running…" : "Run tests"}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Verifies your account cannot read rows from projects you are not a member of. Runs live
        against the database with your current credentials — a passing result means RLS policies are
        enforcing project isolation end-to-end.
      </p>
      {checks.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-muted-foreground">
            {passed} passed · {failed} failed
          </div>
          <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
            {checks.map((c) => (
              <li key={c.name} className="flex items-start gap-2 px-3 py-2 text-xs">
                {c.status === "pass" ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                ) : c.status === "fail" ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-foreground">{c.name}</div>
                  {c.detail && <div className="text-[11px] text-muted-foreground">{c.detail}</div>}
                </div>
                <span
                  className={`text-[10px] uppercase tracking-wide font-semibold ${
                    c.status === "pass"
                      ? "text-success"
                      : c.status === "fail"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
