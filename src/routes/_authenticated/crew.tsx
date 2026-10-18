import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/AppShell";
import { PeoplePage } from "@/components/CrewCastContracts";

function CrewRoute() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <PeoplePage kind="crew" title={t("people.crew")} />
    </AppShell>
  );
}

export const Route = createFileRoute("/_authenticated/crew")({ component: CrewRoute });
