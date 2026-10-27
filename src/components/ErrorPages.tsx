// ═══════════════════════════════════════════════════════════════════
// X22 — friendly error pages: page not found, no permission, and an
// unexpected error. No stack traces or database messages in production.
// ═══════════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Compass, Home, RotateCcw, ShieldAlert, TriangleAlert } from "lucide-react";
import { IS_DEV, isPermissionError, userFacingErrorMessage } from "@/lib/error-message";

function goHome() {
  window.location.assign("/");
}
function goBack() {
  if (window.history.length > 1) window.history.back();
  else goHome();
}

const btn =
  "inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 hover:bg-muted px-4 py-2 text-sm font-medium text-foreground transition";

function Frame({
  icon,
  code,
  title,
  body,
  detail,
  children,
}: {
  icon: React.ReactNode;
  code?: string;
  title: string;
  body: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[70vh] grid place-items-center bg-background text-foreground p-6">
      <div className="text-center max-w-md flex flex-col items-center gap-3">
        <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-surface-2">
          {icon}
        </div>
        {code && (
          <div className="text-5xl font-bold tracking-tight text-muted-foreground">{code}</div>
        )}
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        {detail && (
          <pre
            dir="ltr"
            className="max-w-full overflow-auto rounded-lg border border-border bg-surface-2 px-3 py-2 text-start text-[11px] text-muted-foreground"
          >
            {detail}
          </pre>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Frame
      icon={<Compass className="size-8 text-brand" />}
      code="404"
      title={t("refs.err_404_title")}
      body={t("refs.err_404_body")}
    >
      <button type="button" onClick={goBack} className={btn}>
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("refs.err_back")}
      </button>
      <button type="button" onClick={goHome} className={btn}>
        <Home className="size-4" />
        {t("refs.err_home")}
      </button>
    </Frame>
  );
}

export function NoPermissionPage() {
  const { t } = useTranslation();
  return (
    <Frame
      icon={<ShieldAlert className="size-8 text-warning" />}
      title={t("refs.err_denied_title")}
      body={t("refs.err_denied_body")}
    >
      <button type="button" onClick={goBack} className={btn}>
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("refs.err_back")}
      </button>
      <button type="button" onClick={goHome} className={btn}>
        <Home className="size-4" />
        {t("refs.err_home")}
      </button>
    </Frame>
  );
}

export function UnexpectedErrorPage({ error, reset }: { error: unknown; reset?: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    // the raw value stays available to support in the browser console
    console.error("[route-error]", error);
  }, [error]);
  if (isPermissionError(error)) return <NoPermissionPage />;
  return (
    <Frame
      icon={<TriangleAlert className="size-8 text-destructive" />}
      title={t("refs.err_unexpected_title")}
      body={t("refs.err_unexpected_body")}
      detail={userFacingErrorMessage(error, IS_DEV)}
    >
      {reset && (
        <button type="button" onClick={() => reset()} className={btn}>
          <RotateCcw className="size-4" />
          {t("refs.err_try_again")}
        </button>
      )}
      <button type="button" onClick={() => window.location.reload()} className={btn}>
        {t("refs.err_reload")}
      </button>
      <button type="button" onClick={goHome} className={btn}>
        <Home className="size-4" />
        {t("refs.err_home")}
      </button>
    </Frame>
  );
}
