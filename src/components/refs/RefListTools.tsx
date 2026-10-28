// ═══════════════════════════════════════════════════════════════════
// G08 on list pages: the Kwalis reference number (db/pending/184 ref_no,
// e.g. MON26-PO-0012) as a column and a filter. The store rows do not carry
// ref_no yet, so one query to v_document_refs per project gives every
// document's number, keyed by record id.
// ═══════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Hash } from "lucide-react";

import { useStore } from "@/lib/store";
import { fetchRefMap, refMatches, type DocumentRef } from "@/lib/document-refs";

/**
 * Reference numbers of the active project, by record id. `version` (e.g. the
 * row count of the list) refetches when documents are added.
 */
export function useRefMap(version: number | string = 0) {
  const projectId = useStore((s) => s.activeProjectId);
  const q = useQuery({
    queryKey: ["ref-map", projectId, version],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: () => fetchRefMap(projectId!),
  });
  const data = q.data;
  return useMemo(() => {
    const map = data ?? new Map<string, DocumentRef>();
    const refOf = (id: string | null | undefined) => (id ? (map.get(id)?.ref_no ?? null) : null);
    const matches = (id: string | null | undefined, query: string) =>
      !query.trim() || refMatches(refOf(id), query);
    return { refOf, matches };
  }, [data]);
}

export function RefFilterInput({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <Hash className="pointer-events-none absolute start-2 size-3.5 text-muted-foreground" />
      <input
        value={value}
        maxLength={64}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("polish.refs.filter_placeholder")}
        aria-label={t("polish.refs.filter_label")}
        className="h-9 w-40 rounded-xl border border-border bg-surface-2 ps-7 pe-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
    </label>
  );
}

export function RefText({ refNo }: { refNo: string | null | undefined }) {
  return refNo ? (
    <span className="font-mono text-xs whitespace-nowrap">{refNo}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}
