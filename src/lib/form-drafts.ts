// Draft persistence for long-lived creation/edit forms.
//
// Contract and invoice modals hold a lot of typed state (payment splits, bank
// details, budget mapping). Losing it to an accidental tab close, a refresh,
// or a dropped connection is expensive, so every keystroke is mirrored into
// localStorage under a namespaced key and restored automatically next time
// the same form is opened.
//
// Drafts are intentionally scoped per project (and per record when editing)
// by the caller passing a fully-qualified key.
import { useEffect, useRef } from "react";

const PREFIX = "kwalishub.draft.";
/** Drafts older than this are considered stale and dropped on read. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Envelope<T> = { savedAt: number; value: T; version?: string | null };

export function draftKey(...parts: Array<string | null | undefined>): string {
  return PREFIX + parts.filter(Boolean).join(":");
}

/**
 * Stable fingerprint of the server record a draft was started from.
 *
 * Records don't all carry an `updated_at` we can read client-side, so the
 * snapshot the modal was opened with is hashed instead. If anyone else edits
 * the record in the meantime, the next open produces a different fingerprint
 * and the stored draft is recognised as stale.
 */
export function recordVersion(record: unknown): string | null {
  if (record == null) return null;
  try {
    const anyRec = record as Record<string, unknown>;
    const stamp = anyRec.updatedAt ?? anyRec.updated_at;
    if (typeof stamp === "string" || typeof stamp === "number") return String(stamp);
    const json = JSON.stringify(record, Object.keys(anyRec).sort());
    let h = 5381;
    for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
    return `h${(h >>> 0).toString(36)}:${json.length}`;
  } catch {
    return null;
  }
}

export function readDraftEnvelope<T>(key: string): Envelope<T> | null {
  if (typeof window === "undefined" || !key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || typeof env.savedAt !== "number") return null;
    if (Date.now() - env.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return env;
  } catch {
    return null;
  }
}

export function readDraft<T>(key: string): T | null {
  return readDraftEnvelope<T>(key)?.value ?? null;
}

export function writeDraft<T>(key: string, value: T, version?: string | null) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        value,
        version: version ?? null,
      } satisfies Envelope<T>),
    );
  } catch {
    /* quota / private mode — drafting is best-effort */
  }
}

export function clearDraft(key: string) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Mirror `value` into localStorage and restore it once on mount.
 *
 * `onRestore` is called at most once per key with the previously saved
 * snapshot. Files (which can't be serialized) must be excluded from the
 * snapshot by the caller.
 *
 * Conflict guard: pass `version` (see `recordVersion`) when editing an
 * existing record. If the stored draft was started from a different version
 * of that record — i.e. someone saved changes elsewhere in the meantime —
 * the draft is discarded instead of restored, and `onConflict` fires so the
 * UI can tell the user. The stale snapshot is also never written back over
 * the fresher server data by a pending debounce.
 */
export function useFormDraft<T>(
  key: string | null,
  value: T,
  onRestore: (saved: T) => void,
  opts: {
    enabled?: boolean;
    debounceMs?: number;
    version?: string | null;
    onConflict?: () => void;
  } = {},
): { clear: () => void; restored: boolean; conflicted: boolean } {
  // 700ms: long enough that continuous typing never touches localStorage,
  // short enough that a brief pause already secures the draft.
  const { enabled = true, debounceMs = 700, version = null, onConflict } = opts;
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const conflictRef = useRef(onConflict);
  conflictRef.current = onConflict;
  const restoredFor = useRef<string | null>(null);
  const restoredFlag = useRef(false);
  const conflictedFlag = useRef(false);

  // Restore first, so the very next persist pass doesn't overwrite the draft
  // with the form's empty initial state.
  useEffect(() => {
    if (!enabled || !key || restoredFor.current === key) return;
    restoredFor.current = key;
    const env = readDraftEnvelope<T>(key);
    if (!env || env.value == null) return;
    // Stale draft: the record changed underneath it. Drop it — restoring
    // would silently revert someone else's saved edits.
    if (version != null && env.version != null && env.version !== version) {
      conflictedFlag.current = true;
      clearDraft(key);
      conflictRef.current?.();
      return;
    }
    restoredFlag.current = true;
    restoreRef.current(env.value);
  }, [enabled, key, version]);

  useEffect(() => {
    if (!enabled || !key || restoredFor.current !== key) return;
    const id = window.setTimeout(() => writeDraft(key, value, version), debounceMs);
    return () => window.clearTimeout(id);
  }, [enabled, key, value, debounceMs, version]);

  // Flush synchronously if the tab goes away (or is backgrounded) mid-debounce.
  useEffect(() => {
    if (!enabled || !key) return;
    const flush = () => {
      // Never let a queued debounce clobber a draft another tab wrote against
      // a newer version of the same record.
      const existing = readDraftEnvelope<T>(key);
      if (existing && version != null && existing.version != null && existing.version !== version) {
        return;
      }
      writeDraft(key, value, version);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [enabled, key, value, version]);

  return {
    clear: () => {
      if (key) clearDraft(key);
    },
    restored: restoredFlag.current,
    conflicted: conflictedFlag.current,
  };
}
