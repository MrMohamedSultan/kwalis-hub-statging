import type { ReactNode } from "react";
import { Lock, Unlock } from "lucide-react";
import { useProjectLock } from "@/lib/project-lock";
import { useCan } from "@/lib/rbac";
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
  const { locked: rawLocked, dbLocked, toggle } = useProjectLock();
  const locked = bypass ? false : rawLocked;
  const can = useCan();
  const canToggle = can("system.settings");

  return (
    <>
      {locked && (
        <PageBanner
          tone="warning"
          icon={<Lock className="size-4" />}
          title={`${scopeLabel} version is locked${dbLocked ? " (approved budget)" : ""}`}
          action={
            canToggle &&
            !dbLocked && (
              <button
                type="button"
                onClick={toggle}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warning/50 bg-warning/20 px-2.5 py-1.5 text-xs font-semibold text-warning hover:bg-warning/30 transition"
              >
                <Unlock className="size-3.5" />
                Unlock
              </button>
            )
          }
        >
          All edit actions (payroll, budget, accounting, contracts) are disabled until unlocked.
        </PageBanner>
      )}
      <fieldset disabled={locked} className={locked ? "opacity-95" : ""}>
        {children}
      </fieldset>
    </>
  );
}
