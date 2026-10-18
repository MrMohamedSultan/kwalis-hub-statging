import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "react-i18next";
export type PageSize = 10 | 20 | 30 | "all";
export const PAGE_SIZE_OPTIONS: PageSize[] = [10, 20, 30, "all"];

/**
 * Client-side chunked rendering for large tables.
 *
 * Keeps the DOM small (default 20 rows) so filtering/scrolling never freezes
 * the browser on multi-thousand-row datasets. Filtering stays entirely in the
 * caller: pass the ALREADY filtered array; the page auto-resets whenever the
 * result set changes size.
 */
export function usePagedRows<T>(
  rows: T[],
  initialSize: PageSize = 20,
  /** Optional hook for views that fetch server-side — called just before the
   *  user is likely to move to `nextPage` (controls scrolled into view / hover). */
  onPrefetchNext?: (nextPage: number) => void,
) {
  const [pageSize, setPageSize] = useState<PageSize>(initialSize);
  const [page, setPage] = useState(0);

  // Any change to the filtered result set sends the user back to page 1 so
  // they never land on an empty page after narrowing a search.
  useEffect(() => {
    setPage(0);
  }, [rows.length, pageSize]);

  const { pageRows, clampedPage, totalPages } = useMemo(
    () => paginate(rows, pageSize, page),
    [rows, pageSize, page],
  );

  // Warm the next page: slicing it here keeps the array identity stable so the
  // rows React renders after "Next" come from an already-computed memo.
  const hasNext = pageSize !== "all" && clampedPage < totalPages - 1;
  const nextPageRows = useMemo(
    () => (hasNext ? paginate(rows, pageSize, clampedPage + 1).pageRows : []),
    [rows, pageSize, clampedPage, hasNext],
  );
  const prefetched = useRef(-1);
  const prefetchNext = useCallback(() => {
    if (!hasNext) return;
    const next = clampedPage + 1;
    if (prefetched.current === next) return;
    prefetched.current = next;
    // Touch the warmed slice so it is retained, then let the caller prefetch.
    void nextPageRows.length;
    onPrefetchNext?.(next);
  }, [hasNext, clampedPage, nextPageRows, onPrefetchNext]);

  useEffect(() => {
    prefetched.current = -1;
  }, [clampedPage, pageSize, rows.length]);

  return {
    pageRows,
    nextPageRows,
    /** Offset of the first rendered row — use for continuous row numbering. */
    offset: pageSize === "all" ? 0 : clampedPage * (pageSize as number),
    paginationProps: {
      total: rows.length,
      pageSize,
      page: clampedPage,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
      onPrefetchNext: prefetchNext,
    },
  };
}

export function paginate<T>(
  rows: T[],
  pageSize: PageSize,
  page: number,
): { pageRows: T[]; totalPages: number; clampedPage: number } {
  if (pageSize === "all") return { pageRows: rows, totalPages: 1, clampedPage: 0 };
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const start = clampedPage * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), totalPages, clampedPage };
}

export function TablePagination({
  total,
  pageSize,
  page,
  onPageChange,
  onPageSizeChange,
  onPrefetchNext,
}: {
  total: number;
  pageSize: PageSize;
  page: number;
  onPageChange: (n: number) => void;
  onPageSizeChange: (s: PageSize) => void;
  /** Warms the next page as soon as the controls are reached or hovered. */
  onPrefetchNext?: () => void;
}) {
  const { t } = useTranslation();

  const { totalPages, clampedPage } = paginate(new Array(total), pageSize, page);
  const from =
    pageSize === "all" ? (total ? 1 : 0) : clampedPage * (pageSize as number) + (total ? 1 : 0);
  const to = pageSize === "all" ? total : Math.min(total, (clampedPage + 1) * (pageSize as number));

  // Prefetch the moment the pagination controls scroll into view — by the time
  // the user actually clicks "Next", the rows are already computed/fetched.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onPrefetchNext || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onPrefetchNext();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onPrefetchNext, clampedPage, pageSize, total]);

  return (
    <div
      ref={rootRef}
      className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-muted-foreground"
    >
      <div className="flex items-center gap-2">
        <span>{t("tablepagination.rows_per_page")}</span>
        <select
          value={String(pageSize)}
          onChange={(e) => {
            const v = e.target.value;
            onPageSizeChange((v === "all" ? "all" : Number(v)) as PageSize);
            onPageChange(0);
          }}
          className="bg-background border border-border rounded-md px-2 py-1 text-foreground"
        >
          {PAGE_SIZE_OPTIONS.map((o) => (
            <option key={String(o)} value={String(o)}>
              {o === "all" ? "All" : o}
            </option>
          ))}
        </select>
        <span>
          {from}–{to} of {total}
        </span>
      </div>
      {pageSize !== "all" && totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(0, clampedPage - 1))}
            disabled={clampedPage === 0}
            className="rounded-md border border-border p-1 disabled:opacity-40 hover:bg-muted"
            aria-label={t("tablepagination.previous_page")}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="px-2">
            Page {clampedPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages - 1, clampedPage + 1))}
            onMouseEnter={onPrefetchNext}
            onFocus={onPrefetchNext}
            disabled={clampedPage >= totalPages - 1}
            className="rounded-md border border-border p-1 disabled:opacity-40 hover:bg-muted"
            aria-label={t("tablepagination.next_page")}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
