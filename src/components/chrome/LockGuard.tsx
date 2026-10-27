import type { ReactNode } from "react";
import { Lock, Unlock } from "lucide-react";
import { useProjectLock } from "@/lib/project-lock";
import { useCan } from "@/lib/rbac";
import { useTranslation } from "react-i18next";
import { PageBanner } from "./PageBanner";

/**
 * Wrap an entire page (or a mutation-heavy sub-tree) with LockGuard to enforce
 * project-version lock uniformly. When locked, every native form control
 * (input/select/textarea/button) inside is disabled by the surrounding
 * <fieldset disabled> — no per-component wiring needed.
 *
 * A visible lock banner is rendered on top. Admins with `settings.admin`
 * can toggle the lock inline.
 */
export function LockGuard({
  children,
  scopeLabel = "This project",
  bypass = false,
}: {
  children: ReactNode;
  scopeLabel?: string;
  /** Editing an unpublished draft is always allowed — it cannot move actuals. */
  bypass?: boolean;
}) {
  const { t } = useTranslation();
  const { locked: rawLocked, dbLocked, archived, lockReason, toggle } = useProjectLock();
  const locked = bypass ? false : rawLocked;
  const can = useCan();
  const canToggle = can("system.settings");

  return (
    <>
      {locked && (
        <PageBanner
          tone="warning"
          icon={<Lock className="size-4" />}
          title={
            archived
              ? t("refs.lock_banner_archived")
              : dbLocked
                ? `${scopeLabel} version is locked (approved budget)`
                : t("refs.lock_banner_title")
          }
          action={
            canToggle &&
            !dbLocked &&
            !archived && (
              <button
                type="button"
                onClick={toggle}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warning/50 bg-warning/20 px-2.5 py-1.5 text-xs font-semibold text-warning hover:bg-warning/30 transition"
              >
                <Unlock className="size-3.5" />
                {t("refs.unlock")}
              </button>
            )
          }
        >
          {t("refs.lock_banner_body")}
          {lockReason ? ` — ${lockReason}` : ""}
        </PageBanner>
      )}
      <fieldset disabled={locked} className={locked ? "opacity-95" : ""}>
        {children}
      </fieldset>
    </>
  );
}
