import { useEffect, type RefObject } from "react";

/**
 * Auto-populates `data-label` on every `<td>` inside `.app-table` using the
 * corresponding `<th>` text. This drives the mobile card layout defined in
 * `src/styles.css` without requiring call sites to add labels manually.
 *
 * Per-column overrides:
 *   - Set `data-card-label="Custom Label"` on a `<th>` to override the text
 *     used for that column's cards.
 *   - Set `data-card-label=""` on a `<th>` to hide the label entirely (the
 *     cell will span the full card width on mobile).
 *
 * Per-cell overrides:
 *   - Set `data-card-label="..."` (or `""` to hide) on an individual `<td>`
 *     to override just that cell.
 *
 * Runs once on mount and re-runs on DOM mutations within `document.body`.
 */
export function useTableCardLabels(rootRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = rootRef?.current ?? document.body;

    const resolveLabel = (el: Element): string => {
      const override = el.getAttribute("data-card-label");
      if (override !== null) return override;
      return (el.textContent ?? "").trim();
    };

    const apply = (cell: Element, label: string) => {
      if (label === "") {
        if (cell.hasAttribute("data-label")) cell.removeAttribute("data-label");
        return;
      }
      if (cell.getAttribute("data-label") !== label) {
        cell.setAttribute("data-label", label);
      }
    };

    const label = (table: HTMLTableElement) => {
      const heads = Array.from(table.querySelectorAll(":scope > thead > tr > th")).map(
        resolveLabel,
      );
      if (!heads.length) return;
      table.querySelectorAll(":scope > tbody > tr").forEach((tr) => {
        Array.from(tr.children).forEach((cell, i) => {
          const cellOverride = cell.getAttribute("data-card-label");
          const text = cellOverride !== null ? cellOverride : heads[i];
          if (text === undefined) return;
          apply(cell, text);
        });
      });
    };

    const nodeContainsTable = (node: Node): boolean => {
      if (!(node instanceof Element)) return false;
      return node.matches("table.app-table") || !!node.querySelector("table.app-table");
    };

    const mutationTouchesTable = (mutation: MutationRecord): boolean => {
      const target = mutation.target;
      if (target instanceof Element && target.closest("table.app-table")) return true;
      return (
        Array.from(mutation.addedNodes).some(nodeContainsTable) ||
        Array.from(mutation.removedNodes).some(nodeContainsTable)
      );
    };

    const labelAll = () => {
      root.querySelectorAll<HTMLTableElement>("table.app-table").forEach(label);
    };

    labelAll();

    let raf = 0;
    const observer = new MutationObserver((mutations) => {
      if (!mutations.some(mutationTouchesTable)) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(labelAll);
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [rootRef]);
}
