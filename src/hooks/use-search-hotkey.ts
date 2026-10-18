import { useEffect, useRef, type RefObject } from "react";

/**
 * Focus an input when the user presses "/" (or Ctrl/Cmd+K) anywhere on the page.
 * Skips when the focus is already inside an editable element so shortcuts don't
 * hijack typing.
 */
export function useSearchHotkey<T extends HTMLElement = HTMLInputElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (!el) return;
      const active = document.activeElement as HTMLElement | null;
      const isEditable =
        !!active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable);
      const cmdK = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      const slash = e.key === "/" && !isEditable && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (cmdK || slash) {
        e.preventDefault();
        el.focus();
        if ("select" in el && typeof (el as unknown as HTMLInputElement).select === "function") {
          (el as unknown as HTMLInputElement).select();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return ref;
}
