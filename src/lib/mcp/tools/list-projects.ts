import { getServerSupabaseForToken } from "@/lib/supabase-singleton.server";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function supabaseForUser(ctx: ToolContext) {
  // Reuses the shared per-token singleton instead of allocating a client per call.
  return getServerSupabaseForToken(ctx.getToken()!);
}

export default defineTool({
  name: "list_projects",
  title: "List my projects",
  description:
    "List every Kwalis HUB production the signed-in user can access, with code, name, status, and budget total.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("projects")
      .select(
        "id, code, name, status, budget, start_date, end_date, production_kind, budget_status",
      )
      .order("created_at", { ascending: false });
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { projects: data ?? [] },
    };
  },
});
