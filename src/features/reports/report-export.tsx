// Report export plumbing (G03) shared by the Reports page and the report
// components that live in their own files: the visible tab registers ONE
// builder that describes exactly what is on screen; the page's Excel / PDF
// buttons run it through the branded writers in src/lib/export/.
import { createContext, useContext, useEffect } from "react";
import type { ReportDoc } from "@/lib/export/xlsx-report";

export type ReportExport = {
  doc: ReportDoc;
  /** Optional Excel override (e.g. the official Film Commission template). */
  excel?: () => Promise<void>;
};
export type ExportBuilder = () => ReportExport | null;

export const ReportExportContext = createContext<{ current: ExportBuilder | null } | null>(null);

/** Register the visible tab's export: it must describe exactly what is on screen. */
export function useReportExport(builder: ExportBuilder) {
  const ref = useContext(ReportExportContext);
  useEffect(() => {
    if (ref) ref.current = builder;
  });
  useEffect(
    () => () => {
      if (ref) ref.current = null;
    },
    [ref],
  );
}
