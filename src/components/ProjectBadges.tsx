import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  type ProjectStatusOption,
  type ProjectTypeOption,
} from "@/lib/project-constants";

// Color-coded pill styling per official status/type — single source of truth
// for how these values are rendered anywhere in the app.

const STATUS_STYLES: Record<ProjectStatusOption, string> = {
  Planning: "bg-muted/15 text-foreground border-border",
  Development: "bg-info/15 text-info border-info/30",
  "Pre-Production": "bg-info/15 text-info border-info/30",
  Production: "bg-success/15 text-success border-success/30",
  "Post-Production": "bg-warning/15 text-warning border-warning/30",
  Finalized: "bg-highlight/15 text-highlight border-highlight/30",
  Archived: "bg-muted/15 text-muted-foreground border-border opacity-80",
};

const TYPE_STYLES: Record<ProjectTypeOption, string> = {
  "Feature Film": "bg-destructive/15 text-destructive border-destructive/30",
  "Short Film": "bg-destructive/15 text-destructive border-destructive/30",
  "TV Series": "bg-success/15 text-success border-success/30",
  "Long-form Series": "bg-info/15 text-info border-info/30",
  Program: "bg-warning/15 text-warning border-warning/30",
};

const BASE =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap";

function isStatus(v: string): v is ProjectStatusOption {
  return (PROJECT_STATUSES as readonly string[]).includes(v);
}

function isType(v: string): v is ProjectTypeOption {
  return (PROJECT_TYPES as readonly string[]).includes(v);
}

export function ProjectStatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const known = isStatus(value);
  const cls = known ? STATUS_STYLES[value] : "bg-surface text-muted-foreground border-border";
  return <span className={`${BASE} ${cls}`}>{value.replace(/_/g, " ")}</span>;
}

export function ProjectTypeBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const known = isType(value);
  const cls = known ? TYPE_STYLES[value] : "bg-surface text-muted-foreground border-border";
  return <span className={`${BASE} ${cls}`}>{value}</span>;
}
