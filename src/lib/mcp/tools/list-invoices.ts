import { getServerSupabaseForToken } from "@/lib/supabase-singleton.server";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  // Reuses the shared per-token singleton instead of allocating a client per call.
  return getServerSupabaseForToken(ctx.getToken()!);
}

export default defineTool({
  name: "list_recent_invoices",
  title: "List recent invoices",
  description: "Return the most recent invoices for a project, newest first.",
  inputSchema: {
    project_id: z.string().uuid().describe("Project UUID."),
    limit: z.number().int().min(1).max(100).default(20).describe("Max invoices to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("invoices")
      .select(
        "id, invoice_no, vendor_name, description, department, budget_code, price, vat_amount, date, payment_term",
      )
      .eq("project_id", project_id)
      .order("date", { ascending: false })
      .limit(limit);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { invoices: data ?? [] },
    };
  },
});
