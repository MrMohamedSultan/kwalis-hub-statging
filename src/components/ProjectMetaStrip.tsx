import { useTranslation } from "react-i18next";
import { useProjectMetadata } from "@/lib/project-metadata";
import { useBudgetHeader } from "@/lib/budget-header";
import { useStore } from "@/lib/store";

/**
 * Production header — the top-sheet summary grid shown under the project title.
 * Mirrors a standard film production top sheet: Production Co., Project Title,
 * Budget Date, Shoot Days, Prep Days, Budget Setting, Producer, Line Producer,
 * Prepared By, Filming Locations and Budget Version.
 *
 * Reads the shared project-metadata store, so saving Project Settings repaints
 * it in the same tick with no page refresh.
 */
export function ProjectMetaStrip({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const { metadata } = useProjectMetadata();
  const [budgetMeta] = useBudgetHeader();
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);

  const days = (n: number | null) => (n != null ? String(n) : "");
  const label = (key: string) => t(`productionHeader.${key}`);

  const items: Array<{ label: string; value: string; wide?: boolean }> = [
    { label: label("productionCompany"), value: metadata.productionCompany, wide: true },
    { label: label("projectTitle"), value: project?.name ?? "", wide: true },
    { label: label("budgetDate"), value: budgetMeta.versionDate ?? "" },
    { label: label("shootDays"), value: days(metadata.shootDays) },
    { label: label("prepDays"), value: days(metadata.prepDays) },
    { label: label("budgetSetting"), value: metadata.budgetSetting },
    { label: label("producer"), value: metadata.producer },
    { label: label("lineProducer"), value: metadata.lineProducer },
    { label: label("preparedBy"), value: metadata.preparedBy },
    { label: label("filmingLocations"), value: metadata.filmingLocations, wide: true },
    { label: label("budgetVersion"), value: budgetMeta.version ?? "" },
  ];

  if (items.every(({ value }) => !value)) return null;

  return (
    <dl
      className={`grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 ${className}`}
    >
      {items.map(({ label, value, wide }) => (
        <div key={label} className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
          <dd
            className="mt-0.5 truncate text-xs font-semibold text-foreground"
            title={value || undefined}
          >
            {value || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
