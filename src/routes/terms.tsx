import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Use — Kwalis HUB" }] }),
  component: () => <LegalPage doc="terms" />,
});
