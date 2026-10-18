import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/AppShell";
import { PeoplePage } from "@/components/CrewCastContracts";

function CastRoute() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <PeoplePage kind="cast" title={t("people.cast")} />
    </AppShell>
  );
}

export const Route = createFileRoute("/_authenticated/cast")({ component: CastRoute });
