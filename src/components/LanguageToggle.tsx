import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { setLanguage } from "@/lib/i18n";

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = (i18n.language || "en").startsWith("ar") ? "ar" : "en";
  const next = current === "en" ? "ar" : "en";

  return (
    <button
      onClick={() => setLanguage(next)}
      title={current === "en" ? "العربية" : "English"}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface hover:bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-widest transition"
      aria-label={i18n.t("languagetoggle.toggle_language")}
    >
      <Languages className="size-3.5" />
      <span className={current === "en" ? "text-brand" : "opacity-60"}>EN</span>
      <span className="opacity-40">/</span>
      <span className={current === "ar" ? "text-brand" : "opacity-60"}>AR</span>
    </button>
  );
}
