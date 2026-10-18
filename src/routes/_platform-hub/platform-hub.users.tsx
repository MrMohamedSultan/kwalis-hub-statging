import { createFileRoute } from "@tanstack/react-router";
import { UserAccessPage } from "@/components/platform/UserAccessPage";

export const Route = createFileRoute("/_platform-hub/platform-hub/users")({
  head: () => ({
    meta: [
      { title: "Users & Access — Kwalis HUB" },
      {
        name: "description",
        content: "Cross-company user management, role assignments and access control.",
      },
      { property: "og:title", content: "Users & Access — Kwalis HUB" },
      {
        property: "og:description",
        content: "Cross-company user management, role assignments and access control.",
      },
    ],
  }),
  component: UserAccessPage,
});
