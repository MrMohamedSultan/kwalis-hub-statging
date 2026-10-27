import { getServerSupabaseForToken } from "@/lib/supabase-singleton.server";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  // Reuses the shared per-token singleton instead of allocating a client per call.
  return getServerSupabaseForToken(ctx.getToken()!);
}

export default defineTool({
  name: "list_payment_requests",
  title: "List payment requests",
  description:
    "List payment requests for a project, optionally filtered by status (draft, waiting_approval, approved, paid, rejected, cancelled).",
  inputSchema: {
    project_id: z.string().uuid().describe("Project UUID."),
    status: z
      .enum(["draft", "waiting_approval", "approved", "paid", "rejected", "cancelled"])
      .nullable()
      .describe("Optional status filter; null returns all statuses."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("payment_requests")
      .select(
        "id, source_type, source_id, source_label, requested_amount, total_amount, currency, status, notes, rejection_reason, created_at",
      )
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { requests: data ?? [] },
    };
  },
});
