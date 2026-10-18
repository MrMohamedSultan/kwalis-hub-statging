import { useImpersonation } from "@/lib/impersonation";
import { ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";

import { useTranslation } from "react-i18next";
/**
 * Persistent banner shown while a Super Admin is impersonating a tenant.
 * Renders nothing when no impersonation session is active.
 */
export function ImpersonationBanner() {
  const { t } = useTranslation();

  const isImpersonating = useImpersonation((s) => s.isImpersonating);
  const orgName = useImpersonation((s) => s.orgName);
  const stop = useImpersonation((s) => s.stop);

  if (!isImpersonating) return null;

  const handleExit = async () => {
    await stop();
    toast.success(t("impersonationbanner.exited_impersonation"));
  };

  return (
    <div
      role="alert"
      className="w-full bg-warning text-foreground border-b-2 border-warning/40 shadow-md"
    >
      <div className="mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm font-semibold">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="size-4 shrink-0" />
          <span className="truncate">
            {t("impersonationbanner.viewing_as")}
            <span className="font-bold">{orgName ?? "Tenant"}</span> · Super Admin impersonation
            active
          </span>
        </div>
        <button
          type="button"
          onClick={handleExit}
          className="inline-flex items-center gap-1.5 rounded-md bg-black/90 px-3 py-1 text-xs font-bold text-warning hover:bg-black"
        >
          <X className="size-3.5" />
          {t("impersonationbanner.exit_impersonation")}
        </button>
      </div>
    </div>
  );
}
