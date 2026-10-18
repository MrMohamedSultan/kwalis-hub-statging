import { cn } from "@/lib/utils";

/**
 * Single toggle for the BETA badge. Set to `false` to remove the badge from
 * every surface that uses <BetaBadge />.
 */
export const SHOW_BETA_BADGE = true;

export function BetaBadge({ className }: { className?: string }) {
  if (!SHOW_BETA_BADGE) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-current/30 bg-current/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-inherit whitespace-nowrap shrink-0",
        className,
      )}
    >
      BETA
    </span>
  );
}
