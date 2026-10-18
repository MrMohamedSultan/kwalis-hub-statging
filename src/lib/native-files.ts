// Native storage aggregation for the File Library.
//
// Contextual forms (crew/cast contracts, invoices) upload straight into the
// private `contracts` bucket under `{projectId}/{kind}/{entityId}/...`.
// Those objects have no `project_files` metadata row, so the library used to
// show nothing. This module walks the bucket prefix for the active project and
// projects the objects into a virtual folder tree that mirrors the canonical
// pathways used by `project-files.ts` (Crew Profiles → {Name}).

import { storageAudited } from "@/lib/storage-audit";
import { supabase } from "@/integrations/supabase/client";

export const CONTRACTS_BUCKET = "contracts";

export type NativeFolder = {
  id: string;
  name: string;
  parent_id: string | null;
};

export type NativeFile = {
  id: string;
  folderId: string;
  name: string;
  path: string;
  size: number | null;
  createdAt: string | null;
  sourceLabel: string;
};

/** Canonical display label for the second path segment. */
const KIND_LABEL: Record<string, string> = {
  crew: "Crew Profiles",
  cast: "Cast Profiles",
  invoices: "Invoices",
  vendors: "Vendors",
  payroll: "Payroll",
  purchase_orders: "Purchase Orders",
};

const SUBFOLDER_LABEL: Record<string, string> = {
  contract: "Contract",
  "id-document": "ID Document",
  "iban-certificate": "IBAN Certificate",
  "ledger-proof": "Proof of Payment",
};

export function nativeFolderId(...parts: string[]) {
  return `native:${parts.join("/")}`;
}

export function isNativeId(id: string | null | undefined) {
  return !!id && id.startsWith("native:");
}

type StorageEntry = { name: string; id: string | null; metadata: any; created_at?: string | null };

async function listPrefix(prefix: string): Promise<StorageEntry[]> {
  const { data, error } = await storageAudited
    .from(CONTRACTS_BUCKET)
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  return (data ?? []) as StorageEntry[];
}

/** Recursively walk a prefix, returning leaf objects (folders have id === null). */
async function walk(
  prefix: string,
  depth: number,
): Promise<{ path: string; entry: StorageEntry }[]> {
  if (depth > 4) return [];
  const entries = await listPrefix(prefix);
  const out: { path: string; entry: StorageEntry }[] = [];
  const nested: Promise<{ path: string; entry: StorageEntry }[]>[] = [];
  for (const e of entries) {
    if (!e.name || e.name === ".emptyFolderPlaceholder") continue;
    const path = `${prefix}/${e.name}`;
    if (e.id) out.push({ path, entry: e });
    else nested.push(walk(path, depth + 1));
  }
  const deeper = await Promise.all(nested);
  for (const d of deeper) out.push(...d);
  return out;
}

/** Resolve friendly names for entity ids referenced by storage paths. */
async function resolveLabels(projectId: string, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const [people, invoices] = await Promise.all([
    supabase.from("people").select("id, full_name").eq("project_id", projectId).in("id", ids),
    supabase
      .from("invoices")
      .select("id, invoice_no, vendor_name")
      .eq("project_id", projectId)
      .in("id", ids),
  ]);
  for (const p of people.data ?? []) {
    if (p.full_name) map.set(p.id as string, p.full_name as string);
  }
  for (const i of invoices.data ?? []) {
    const label = (i.invoice_no as string) || (i.vendor_name as string) || "";
    if (label) map.set(i.id as string, label);
  }
  return map;
}

/**
 * Build the virtual folder/file tree for every native upload that belongs to
 * this project. Never throws for a partially readable bucket — unreadable
 * prefixes are skipped so the library still renders.
 */
export async function loadNativeLibrary(
  projectId: string,
): Promise<{ folders: NativeFolder[]; files: NativeFile[] }> {
  if (!projectId) return { folders: [], files: [] };

  let objects: { path: string; entry: StorageEntry }[] = [];
  try {
    objects = await walk(projectId, 0);
  } catch {
    return { folders: [], files: [] };
  }
  if (!objects.length) return { folders: [], files: [] };

  // `{projectId}/{kind}/{entityId}/{subfolder?}/{file}`
  const entityIds = new Set<string>();
  for (const o of objects) {
    const seg = o.path.split("/");
    if (seg[2]) entityIds.add(seg[2]);
  }
  const labels = await resolveLabels(projectId, [...entityIds]);

  const folders = new Map<string, NativeFolder>();
  const files: NativeFile[] = [];

  const ensure = (id: string, name: string, parent: string | null) => {
    if (!folders.has(id)) folders.set(id, { id, name, parent_id: parent });
  };

  for (const { path, entry } of objects) {
    const seg = path.split("/");
    const kind = seg[1] ?? "other";
    const entityId = seg[2] ?? "";
    const rootName = KIND_LABEL[kind] ?? "Uncategorized";
    const rootId = nativeFolderId(rootName);
    ensure(rootId, rootName, null);

    const subjectName =
      labels.get(entityId) || (entityId ? `Unlinked · ${entityId.slice(0, 8)}` : "General");
    const subjectId = nativeFolderId(rootName, subjectName);
    ensure(subjectId, subjectName, rootId);

    const middle = seg.length > 4 ? seg[3] : "";
    const sourceLabel = SUBFOLDER_LABEL[middle] ?? guessSourceLabel(seg[seg.length - 1]);

    files.push({
      id: `native:${path}`,
      folderId: subjectId,
      name: seg[seg.length - 1],
      path,
      size: typeof entry.metadata?.size === "number" ? entry.metadata.size : null,
      createdAt: entry.created_at ?? entry.metadata?.lastModified ?? null,
      sourceLabel,
    });
  }

  return {
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    files,
  };
}

function guessSourceLabel(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.startsWith("invoice")) return "Invoice PDF";
  if (lower.startsWith("receipt")) return "Receipt";
  return "Uploaded file";
}

/** Signed URL for a native object in the private contracts bucket. */
export async function getContractSignedUrl(path: string, ttlSeconds = 60 * 30) {
  const { data, error } = await storageAudited
    .from(CONTRACTS_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadContractBlob(path: string): Promise<Blob> {
  const { data, error } = await storageAudited.from(CONTRACTS_BUCKET).download(path);
  if (error) throw error;
  return data;
}

/** Permanently remove a native object from the private contracts bucket. */
export async function deleteContractObject(path: string): Promise<void> {
  const { error } = await storageAudited.from(CONTRACTS_BUCKET).remove([path]);
  if (error) throw error;
}
