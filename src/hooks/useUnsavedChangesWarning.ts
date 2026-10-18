import { useEffect, useRef } from "react";

import i18n from "@/lib/i18n";
/**
 * Warns the user before the tab is closed / reloaded while a form still has
 * unsaved edits. Browsers show their own generic wording; the message string
 * is only a legacy fallback.
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

/**
 * Marks a form dirty as soon as any tracked value changes after mount.
 * Returns a ref-backed boolean plus a reset callback for post-save.
 */
export function useDirtyTracker(deps: unknown[]) {
  const mounted = useRef(false);
  const dirty = useRef(false);
  const snapshot = JSON.stringify(deps);
  const first = useRef(snapshot);

  if (!mounted.current) {
    mounted.current = true;
  } else if (snapshot !== first.current) {
    dirty.current = true;
  }

  return {
    dirty: dirty.current,
    reset: () => {
      dirty.current = false;
      first.current = snapshot;
    },
  };
}

/** Confirm dialog for closing a modal that still holds unsaved edits. */
export function confirmDiscardChanges(dirty: boolean): boolean {
  if (!dirty) return true;
  return window.confirm(
    i18n.t("useunsavedchangeswarning.you_have_unsaved_changes_discard_them_and_close"),
  );
}
