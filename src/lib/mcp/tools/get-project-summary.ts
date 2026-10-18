import { getServerSupabaseForToken } from "@/lib/supabase-singleton.server";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  // Reuses the shared per-token singleton instead of allocating a client per call.
  return getServerSupabaseForToken(ctx.getToken()!);
}

export default defineTool({
  name: "get_project_summary",
  title: "Get project financial summary",
  description:
    "Return budget total, actual spent, remaining, invoice count, and payroll totals for a Kwalis HUB project.",
  inputSchema: {
    project_id: z.string().uuid().describe("The project UUID (from list_projects)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const [proj, budget, invoices, payroll] = await Promise.all([
      supabase
        .from("projects")
        .select("id, code, name, status, budget_status, budget, currency")
        .eq("id", project_id)
        .maybeSingle(),
      supabase
        .from("v_active_budget_lines" as any)
        .select("amount, rate, x, excluded")
        .eq("project_id", project_id),
      supabase.from("invoices").select("price").eq("project_id", project_id),
      supabase.from("payroll").select("total_amount").eq("project_id", project_id),
    ]);
    const err = proj.error || budget.error || invoices.error || payroll.error;
    if (err) return { content: [{ type: "text", text: err.message }], isError: true };
    if (!proj.data)
      return {
        content: [{ type: "text", text: "Project not found or access denied" }],
        isError: true,
      };

    const budgetTotal = (budget.data ?? []).reduce(
      (s, l: any) =>
        l.excluded
          ? s
          : s + Number(l.amount ?? 0) * Number(l.rate ?? 0) * Math.max(Number(l.x ?? 1), 1),
      0,
    );
    const invoiceTotal = (invoices.data ?? []).reduce((s, r: any) => s + Number(r.price ?? 0), 0);
    const payrollTotal = (payroll.data ?? []).reduce(
      (s, r: any) => s + Number(r.total_amount ?? 0),
      0,
    );
    const spent = invoiceTotal + payrollTotal;

    const summary = {
      project: proj.data,
      budget_total: budgetTotal,
      invoice_total: invoiceTotal,
      payroll_total: payrollTotal,
      spent,
      remaining: budgetTotal - spent,
      invoice_count: invoices.data?.length ?? 0,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});
