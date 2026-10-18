import { createFileRoute } from "@tanstack/react-router";
import { AuditLogPage } from "@/routes/_authenticated/audit-log";

export const Route = createFileRoute("/_platform-hub/platform-hub/audit-log")({
  head: () => ({
    meta: [
      { title: "Platform Audit Log — Kwalis HUB" },
      {
        name: "description",
        content: "Platform-wide activity trail: logins, approvals and data changes.",
      },
      { property: "og:title", content: "Platform Audit Log — Kwalis HUB" },
      {
        property: "og:description",
        content: "Platform-wide activity trail: logins, approvals and data changes.",
      },
    ],
  }),
  component: AuditLogPage,
});
