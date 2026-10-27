import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/AppShell";
import { PeoplePage } from "@/components/CrewCastContracts";
import { parseOpenParam } from "@/lib/document-refs";

function CrewRoute() {
  const { t } = useTranslation();
  const { open } = Route.useSearch();
  return (
    <AppShell>
      <PeoplePage kind="crew" openId={open} title={t("people.crew")} />
    </AppShell>
  );
}

export const Route = createFileRoute("/_authenticated/crew")({
  validateSearch: (s: Record<string, unknown>): { open?: string } => {
    const open = parseOpenParam(s.open);
    return open ? { open } : {};
  },
  component: CrewRoute,
});
