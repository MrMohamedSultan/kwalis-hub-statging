import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/AppShell";
import { PeoplePage } from "@/components/CrewCastContracts";
import { parseOpenParam } from "@/lib/document-refs";

function CastRoute() {
  const { t } = useTranslation();
  const { open } = Route.useSearch();
  return (
    <AppShell>
      <PeoplePage kind="cast" openId={open} title={t("people.cast")} />
    </AppShell>
  );
}

export const Route = createFileRoute("/_authenticated/cast")({
  validateSearch: (s: Record<string, unknown>): { open?: string } => {
    const open = parseOpenParam(s.open);
    return open ? { open } : {};
  },
  component: CastRoute,
});
