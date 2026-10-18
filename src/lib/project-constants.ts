// Centralized master lists for project metadata.
// Single source of truth — imported by Settings, project modals, and any
// other UI that renders status/type dropdowns.

export const PROJECT_STATUSES = [
  "Planning",
  "Development",
  "Pre-Production",
  "Production",
  "Post-Production",
  "Finalized",
  "Archived",
] as const;

export type ProjectStatusOption = (typeof PROJECT_STATUSES)[number];

/** Statuses shown in the New/Edit Project dropdown. "Archived" is reserved
 *  for soft-delete and only reachable via the archive/restore action. */
export const SELECTABLE_PROJECT_STATUSES = PROJECT_STATUSES.filter(
  (s) => s !== "Archived",
) as readonly ProjectStatusOption[];

export const PROJECT_TYPES = [
  "Feature Film",
  "Short Film",
  "TV Series",
  "Long-form Series",
  "Program",
] as const;

export type ProjectTypeOption = (typeof PROJECT_TYPES)[number];

export const DEFAULT_PROJECT_STATUS: ProjectStatusOption = "Planning";
export const DEFAULT_PROJECT_TYPE: ProjectTypeOption = "Feature Film";
