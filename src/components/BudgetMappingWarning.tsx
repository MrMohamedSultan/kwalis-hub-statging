import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { MappingIssue } from "@/lib/budget-mapping-check";

/** Inline banner listing Budget Code mapping problems before save / post. */
export function BudgetMappingWarning({
  issues,
  className = "",
}: {
  issues: MappingIssue[];
  className?: string;
}) {
  if (issues.length === 0) return null;
  const blocking = issues.some((i) => i.severity === "error");
  return (
    <div
      role="alert"
      className={`rounded-lg border p-3 text-xs space-y-1.5 ${
        blocking
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-warning/40 bg-warning/10 text-warning"
      } ${className}`}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        {blocking ? (
          <ShieldAlert className="size-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="size-3.5 shrink-0" />
        )}
        {blocking
          ? "Budget Code mapping must be fixed before saving"
          : "Check the Budget Code mapping"}
      </div>
      <ul className="list-disc ps-5 space-y-0.5">
        {issues.map((i, idx) => (
          <li key={`${i.subject ?? ""}-${i.code ?? ""}-${idx}`}>
            {i.subject ? <span className="font-medium">{i.subject}: </span> : null}
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
