import { useEffect, useState } from "react";
import { Drama, HardHat, Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PayablesGridConnected } from "./PayablesGridConnected";
import type { PayableCategory } from "./payables-types";

const STORAGE_KEY = "payables.tab";

const TABS: { key: PayableCategory; labelKey: string; Icon: typeof HardHat }[] = [
  { key: "crew", labelKey: "payables.tabs.crew", Icon: HardHat },
  { key: "cast", labelKey: "payables.tabs.cast", Icon: Drama },
  { key: "vendor", labelKey: "payables.tabs.vendor", Icon: Building2 },
];

/** Tab container: one grid component powers all three categories. */
export function PayablesPage({ initial }: { initial?: PayableCategory }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PayableCategory>(() => {
    if (initial) return initial;
    if (typeof window !== "undefined") {
      const s = window.localStorage.getItem(STORAGE_KEY);
      if (s === "crew" || s === "cast" || s === "vendor") return s;
    }
    return "crew";
  });

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, tab);
  }, [tab]);

  return (
    <div className="space-y-4">
      <div className="inline-flex gap-2 rounded-2xl border border-border bg-surface/60 p-2">
        {TABS.map(({ key, labelKey, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
              tab === key
                ? "bg-card text-foreground ring-1 ring-border"
                : "text-foreground/80 hover:bg-muted"
            }`}
          >
            <Icon className="size-4" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <PayablesGridConnected key={tab} category={tab} />
    </div>
  );
}

export default PayablesPage;
