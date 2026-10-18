import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjects from "./tools/list-projects";
import getProjectSummary from "./tools/get-project-summary";
import listInvoices from "./tools/list-invoices";
import listPaymentRequests from "./tools/list-payment-requests";

// Direct Supabase issuer required — the proxy URL fails RFC 8414 issuer check.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "kwalis-hub-mcp",
  title: "Kwalis HUB",
  version: "0.1.0",
  instructions:
    "Read production financials from Kwalis HUB. Use list_projects first to discover the projects the signed-in user can access, then call get_project_summary, list_recent_invoices, or list_payment_requests with the returned project_id. All data is scoped to the caller by row-level security.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProjects, getProjectSummary, listInvoices, listPaymentRequests],
});
