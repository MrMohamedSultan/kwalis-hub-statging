import { createFileRoute } from "@tanstack/react-router";
import { RoleManagementPage } from "@/components/role-management/RoleManagementPage";

export const Route = createFileRoute("/_platform-hub/platform-hub/roles")({
  head: () => ({
    meta: [
      { title: "System Roles & Permissions — Kwalis HUB" },
      {
        name: "description",
        content: "Define and manage platform-wide roles and permission matrices.",
      },
      { property: "og:title", content: "System Roles & Permissions — Kwalis HUB" },
      {
        property: "og:description",
        content: "Define and manage platform-wide roles and permission matrices.",
      },
    ],
  }),
  component: RoleManagementPage,
});
