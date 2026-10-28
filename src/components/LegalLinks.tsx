import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

/** X26 — Terms of Use / Privacy Policy links (login page and app footer). */
export function LegalLinks({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("platform.legal.navLabel")}
      className={`flex flex-wrap items-center gap-3 text-xs text-muted-foreground ${className}`}
    >
      <Link to="/terms" className="hover:text-foreground hover:underline">
        {t("platform.legal.termsTitle")}
      </Link>
      <span aria-hidden="true">·</span>
      <Link to="/privacy" className="hover:text-foreground hover:underline">
        {t("platform.legal.privacyTitle")}
      </Link>
    </nav>
  );
}
