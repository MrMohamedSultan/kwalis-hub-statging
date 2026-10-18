import type { ReactNode } from "react";

type Tone = "info" | "warning" | "danger" | "success";

const toneClasses: Record<Tone, string> = {
  info: "border-info/30 bg-info/10 text-info",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-success/40 bg-success/10 text-success",
};

/**
 * Shared status / warning strip. Uniform typography, radius and spacing across
 * every page — same treatment as the payroll lock banner.
 */
export function PageBanner({
  tone = "info",
  icon,
  title,
  children,
  action,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border ${toneClasses[tone]} px-4 py-3 mb-4 flex items-center gap-3 text-sm`}
      role="status"
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="text-xs opacity-90 mt-0.5">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
