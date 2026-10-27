// ═══════════════════════════════════════════════════════════════════
// G08 — header search by reference number. Typing "PO-0012" (full or
// partial) lists the matching documents of the active project; picking one
// opens it on its own page (?open=<id>). Documents the user may not open are
// listed without a link.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FileText, Loader2 } from "lucide-react";

import { useStore } from "@/lib/store";
import { usePermissions } from "@/lib/permissions/usePermissions";
import {
  documentLink,
  looksLikeRef,
  searchDocumentRefs,
  type DocumentRef,
} from "@/lib/document-refs";

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function linkForRef(r: DocumentRef) {
  return documentLink(r.source_type, r.record_id, {
    kind: r.doc_type === "CST" ? "cast" : "crew",
    parentType: r.parent_type,
    parentId: r.parent_id,
  });
}

export function RefSearchResults({ query, onPick }: { query: string; onPick: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const perms = usePermissions();
  const projectId = useStore((s) => s.activeProjectId);
  const q = useDebounced(query.trim(), 250);
  const enabled = !!projectId && looksLikeRef(q);

  const res = useQuery({
    queryKey: ["ref-search", projectId, q],
    enabled,
    staleTime: 30_000,
    queryFn: () => searchDocumentRefs(projectId as string, q),
  });

  if (!enabled || !looksLikeRef(query)) return null;

  const rows = res.data ?? [];
  return (
    <div className="absolute start-0 end-0 top-full mt-1 z-50 rounded-xl border border-border bg-surface shadow-xl overflow-hidden">
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
        {t("refs.search_title")}
      </div>
      {res.isLoading && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("common.loading")}
        </div>
      )}
      {res.isError && (
        <div className="px-3 py-2 text-xs text-destructive">{t("refs.search_error")}</div>
      )}
      {!res.isLoading && !res.isError && rows.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">{t("refs.search_none")}</div>
      )}
      <ul>
        {rows.map((r) => {
          const link = linkForRef(r);
          const allowed = !!link && perms.canView(link.module);
          const body = (
            <>
              <FileText className="size-3.5 shrink-0 text-brand" />
              <span className="font-mono text-xs" dir="ltr">
                {r.ref_no}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {t(`refs.source_${r.source_type}`)}
                {r.counterparty || r.label ? ` · ${r.counterparty ?? r.label}` : ""}
              </span>
            </>
          );
          return (
            <li
              key={`${r.source_type}:${r.record_id}`}
              className="border-t border-border first:border-t-0"
            >
              {allowed ? (
                <button
                  type="button"
                  onClick={() => {
                    onPick();
                    void navigate({
                      to: link!.to as "/invoices",
                      search: { open: link!.open } as never,
                    });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-muted"
                >
                  {body}
                </button>
              ) : (
                <div
                  className="flex items-center gap-2 px-3 py-2 opacity-70"
                  title={t("refs.search_no_link")}
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
