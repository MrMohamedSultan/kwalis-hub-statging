// =====================================================================
// Dashboard i18n facade.
//
// The platform standardises on i18next (src/lib/i18n.ts + src/locales);
// this hook exposes the small { t, lang, setLang, dir } surface the
// dashboard components consume so they never touch i18next directly.
// Language choice persistence + <html dir/lang> mutation are handled by
// the existing setLanguage() implementation.
// =====================================================================
import { useTranslation } from "react-i18next";
import { setLanguage } from "@/lib/i18n";

export type DashboardLang = "en" | "ar";

export function useI18n() {
  const { t, i18n } = useTranslation();
  const lang: DashboardLang = (i18n.language || "en").startsWith("ar") ? "ar" : "en";
  const dir: "ltr" | "rtl" = lang === "ar" ? "rtl" : "ltr";
  return {
    t,
    lang,
    dir,
    isRtl: dir === "rtl",
    setLang: setLanguage,
  } as const;
}
