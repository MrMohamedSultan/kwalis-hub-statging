import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useStore } from "@/lib/store";

/**
 * Turns a failed scoped-data fetch into a single retryable toast.
 * Mounted once by the app shell so every list view is covered.
 */
export function DataLoadErrorToast() {
  const { t } = useTranslation();
  const loadError = useStore((s) => s.loadError);
  const reload = useStore((s) => s.reloadScopedData);
  const [retrying, setRetrying] = useState(false);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (!loadError) {
      shownFor.current = null;
      return;
    }
    if (shownFor.current === loadError) return;
    shownFor.current = loadError;

    toast.error(t("common.load_failed", "Couldn't load your data"), {
      id: "data-load-error",
      description: loadError,
      duration: Infinity,
      action: {
        label: retrying ? t("common.retrying", "Retrying…") : t("common.retry", "Retry"),
        onClick: () => {
          setRetrying(true);
          toast.loading(t("common.retrying", "Retrying…"), { id: "data-load-error" });
          reload()
            .then(() => {
              if (!useStore.getState().loadError) {
                toast.success(t("common.load_recovered", "Data loaded"), {
                  id: "data-load-error",
                  duration: 3000,
                });
                shownFor.current = null;
              }
            })
            .catch(() => {
              toast.error(t("common.load_failed", "Couldn't load your data"), {
                id: "data-load-error",
                duration: Infinity,
              });
            })
            .finally(() => setRetrying(false));
        },
      },
    });
  }, [loadError, reload, retrying, t]);

  return null;
}
