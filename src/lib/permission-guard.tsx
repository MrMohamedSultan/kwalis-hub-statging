import { ReactNode, useEffect } from "react";
import { toast } from "sonner";
import { Lock, ShieldAlert } from "lucide-react";
import { useCan, type Permission } from "@/lib/rbac";
import type { PaymentSource } from "@/lib/store";
import { logPermissionDenied } from "@/lib/permission-audit";

import { useTranslation } from "react-i18next";
/** Map every payment source to the permission that authorizes recording it. */
export const PAYMENT_PERMISSIONS: Record<PaymentSource, Permission> = {
  invoice: "invoices.pay",
  purchase_order: "invoices.pay",
  petty_cash: "pettycash.reconcile",
};

export function usePermissionCheck() {
  const can = useCan();
  return {
    can,
    requireOrToast(perm: Permission, action = "perform this action"): boolean {
      if (can(perm)) return true;
      logPermissionDenied({ perm, action, surface: "requireOrToast" });
      toast.error(`Permission required to ${action}.`, {
        description: "Ask an administrator to grant the required role permission.",
      });
      return false;
    },
  };
}

/**
 * Button gated by a specific permission.
 * When the user lacks the permission, it stays visible but disabled with an
 * inline "Permission required" tooltip — so the workflow is discoverable
 * without being executable. Set `hideWhenDenied` to remove entirely.
 */
export function GuardedButton({
  perm,
  onClick,
  children,
  className = "",
  disabled = false,
  title,
  hideWhenDenied = false,
  actionLabel,
  ...rest
}: {
  perm: Permission;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  hideWhenDenied?: boolean;
  actionLabel?: string;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "children" | "className" | "disabled" | "title"
>) {
  const can = useCan();
  const allowed = can(perm);
  if (!allowed && hideWhenDenied) return null;
  const deniedTitle = `Permission required: ${perm}${actionLabel ? ` — cannot ${actionLabel}` : ""}`;
  return (
    <button
      {...rest}
      disabled={disabled || !allowed}
      onClick={(e) => {
        if (!allowed) {
          e.preventDefault();
          logPermissionDenied({
            perm,
            action: actionLabel ?? "perform this action",
            surface: "GuardedButton",
          });
          toast.error(`Permission required to ${actionLabel ?? "perform this action"}.`, {
            description: `Missing "${perm}". Ask an admin to grant it.`,
          });
          return;
        }
        onClick?.(e);
      }}
      title={!allowed ? deniedTitle : title}
      className={`${className} ${!allowed ? "opacity-50 cursor-not-allowed relative" : ""}`}
      aria-disabled={!allowed}
    >
      {!allowed ? (
        <span className="inline-flex items-center gap-1">
          <Lock className="size-3" />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/** Inline banner for a modal or panel that the user cannot use. */
export function PermissionDeniedBanner({ perm, action }: { perm: Permission; action: string }) {
  const { t } = useTranslation();

  useEffect(() => {
    logPermissionDenied({ perm, action, surface: "PermissionDeniedBanner" });
  }, [perm, action]);
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <ShieldAlert className="size-4 text-destructive mt-0.5 shrink-0" />
      <div>
        <div className="font-semibold text-destructive">403 · Permission required</div>
        <div className="text-xs text-destructive mt-0.5">
          {t("permission_guard.you_need_the")}
          <code className="px-1 py-0.5 rounded bg-black/30">{perm}</code> permission to {action}.
          Ask an administrator to update your role.
        </div>
      </div>
    </div>
  );
}
