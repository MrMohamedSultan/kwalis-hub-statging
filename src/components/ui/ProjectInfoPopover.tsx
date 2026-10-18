import { useEffect, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProjectMetaStrip } from "@/components/ProjectMetaStrip";

/**
 * Compact top-bar affordance that reveals the production metadata grid
 * (production company, shoot days, producer, budget version…) in a popover,
 * so the metadata no longer consumes vertical space on every page.
 */
export function ProjectInfoPopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("productionHeader.projectTitle")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs font-medium text-foreground hover:bg-surface transition"
      >
        <Info className="size-3.5" />
        <span className="hidden sm:inline">Info</span>
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute end-0 top-full z-50 mt-2 w-[min(92vw,34rem)] rounded-xl border border-border bg-card p-4 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Production Details
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground hover:bg-surface-2"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <ProjectMetaStrip />
        </div>
      )}
    </div>
  );
}
