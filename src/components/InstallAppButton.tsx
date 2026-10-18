import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { useTranslation } from "react-i18next";
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "kwalis.pwa.installDismissedAt";
const DISMISS_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function InstallAppButton({ className = "" }: { className?: string }) {
  const { t } = useTranslation();

  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(isStandalone());

  useEffect(() => {
    if (installed) return;

    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    const recentlyDismissed = dismissedAt && Date.now() - dismissedAt < DISMISS_MS;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      if (recentlyDismissed) return;
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [installed]);

  if (installed || !deferred) return null;

  const handleInstall = async () => {
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "dismissed") {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      }
    } catch {
      /* ignore */
    } finally {
      setDeferred(null);
    }
  };

  return (
    <button
      type="button"
      onClick={handleInstall}
      title={t("installappbutton.install_kwalis_hub_as_an_app")}
      aria-label={t("installappbutton.install_app")}
      className={`inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/15 text-brand hover:bg-brand hover:text-brand-foreground px-3 py-1.5 text-xs font-semibold transition ${className}`}
    >
      <Download className="size-3.5" />
      <span className="hidden sm:inline">{t("installappbutton.install_app")}</span>
    </button>
  );
}
