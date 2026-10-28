import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft } from "lucide-react";

type Section = { heading: string; body: string[] };

/**
 * X26 — Terms of Use / Privacy Policy. The text lives in the locale files
 * (platform.legal.<doc>) so both languages stay side by side. Both pages are
 * DRAFTS until the client's legal adviser approves them — the banner says so.
 */
export function LegalPage({ doc }: { doc: "terms" | "privacy" }) {
  const { t } = useTranslation();
  const sections = t(`platform.legal.${doc}.sections`, { returnObjects: true }) as unknown;
  const list: Section[] = Array.isArray(sections) ? (sections as Section[]) : [];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <Link
          to="/auth"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t("platform.legal.back")}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{t(`platform.legal.${doc}Title`)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("platform.legal.lastUpdated")}</p>
        <div
          role="note"
          className="mt-6 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <p>{t("platform.legal.draftNotice")}</p>
        </div>
        <div className="mt-8 space-y-8">
          {list.map((s, i) => (
            <section key={i} className="space-y-2">
              <h2 className="text-lg font-semibold">
                {i + 1}. {s.heading}
              </h2>
              {s.body.map((p, j) => (
                <p key={j} className="text-sm leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
        <p className="mt-10 text-sm text-muted-foreground">{t("platform.legal.contact")}</p>
      </main>
    </div>
  );
}
