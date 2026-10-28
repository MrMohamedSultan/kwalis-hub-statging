// Supporting document links (invoice / petty-cash receipt / payroll → URL),
// used by the Film Commission export.
//
// D08: the links used to live only in this browser (localStorage), so other
// users, other devices and the server never saw them. They are now stored in
// public.supporting_document_links (db/pending/195), protected by project
// RLS, and set through public.set_supporting_doc_link(), which takes the
// project from the document itself. This module keeps an in-memory copy for
// the synchronous readers (exports, report rows) and moves any old browser
// links to the server once.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SupportingDocKind = "invoice" | "receipt" | "payroll";

const LEGACY_KEY = "kwalishub.supportingDocs.v1";
const EVENT = "supporting-docs:change";

const cache = new Map<string, string>();
const loadedProjects = new Set<string>();
const keyOf = (kind: SupportingDocKind, id: string) => `${kind}:${id}`;

// The table / RPC are new (195) and not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

export function getSupportingDocUrl(kind: SupportingDocKind, id: string): string {
  if (!id) return "";
  return cache.get(keyOf(kind, id)) ?? "";
}

/** Saves (or clears with "") a link on the server; the cache updates at once. */
export async function setSupportingDocUrl(
  kind: SupportingDocKind,
  id: string,
  url: string,
): Promise<void> {
  if (!id) return;
  const next = url.trim();
  if (next) cache.set(keyOf(kind, id), next);
  else cache.delete(keyOf(kind, id));
  emit();
  const { error } = await db.rpc("set_supporting_doc_link", {
    _kind: kind,
    _source: id,
    _url: next,
  });
  if (error) throw error;
}

function readLegacy(): Record<SupportingDocKind, Record<string, string>> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Moves links left in this browser by older versions to the server (once). */
async function migrateLegacy(): Promise<void> {
  const legacy = readLegacy();
  if (!legacy) return;
  let allDone = true;
  for (const kind of ["invoice", "receipt", "payroll"] as const) {
    for (const [id, url] of Object.entries(legacy[kind] ?? {})) {
      if (!url || cache.has(keyOf(kind, id))) continue;
      try {
        await setSupportingDocUrl(kind, id, url);
      } catch {
        // Not a document this user can reach (other project / deleted): keep it for later.
        allDone = false;
      }
    }
  }
  if (allDone) {
    try {
      window.localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
  }
}

export async function loadSupportingDocs(projectId: string): Promise<void> {
  const { data, error } = await db
    .from("supporting_document_links")
    .select("source_kind, source_id, url")
    .eq("project_id", projectId);
  if (error) return; // table not there yet (195 not applied): links stay empty
  for (const r of (data ?? []) as {
    source_kind: SupportingDocKind;
    source_id: string;
    url: string;
  }[]) {
    cache.set(keyOf(r.source_kind, r.source_id), r.url);
  }
  loadedProjects.add(projectId);
  emit();
  await migrateLegacy();
}

/** Loads the open project's links once; re-renders the caller when they change. */
export function useSupportingDocsSync(projectId: string | null | undefined): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(EVENT, bump);
    return () => window.removeEventListener(EVENT, bump);
  }, []);
  useEffect(() => {
    if (projectId && !loadedProjects.has(projectId)) void loadSupportingDocs(projectId);
  }, [projectId]);
  return version;
}

/** React binding for one document's link. */
export function useSupportingDocUrl(kind: SupportingDocKind, id: string) {
  const [value, setValue] = useState(() => getSupportingDocUrl(kind, id));
  useEffect(() => {
    const refresh = () => setValue(getSupportingDocUrl(kind, id));
    refresh();
    window.addEventListener(EVENT, refresh);
    return () => window.removeEventListener(EVENT, refresh);
  }, [kind, id]);
  const update = (next: string) => {
    setValue(next);
    void setSupportingDocUrl(kind, id, next).catch(() => undefined);
  };
  return [value, update] as const;
}
