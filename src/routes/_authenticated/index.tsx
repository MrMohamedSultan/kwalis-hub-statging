import { createFileRoute, redirect } from "@tanstack/react-router";

// `/` is the authenticated entry point — everyone lands on the Project
// Selection Gateway. Role-specific landings (Platform Hub, Board portal)
// are handled by the parent `_authenticated` beforeLoad before this runs.
export const Route = createFileRoute("/_authenticated/")({
  beforeLoad: () => {
    throw redirect({ to: "/main-hub" });
  },
  component: () => null,
});
