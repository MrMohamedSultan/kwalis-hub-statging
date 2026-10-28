import { formatDateTime } from "@/lib/date-format";
import { TransactionAttachments } from "@/components/files/TransactionAttachments";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Folder,
  FolderPlus,
  Upload,
  ChevronRight,
  Home as HomeIcon,
  FileText,
  ExternalLink,
  Trash2,
  Loader2,
  ShieldOff,
  MoreVertical,
  Download,
  Pencil,
  Archive,
  Copy,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useStore } from "@/lib/store";
import { useCan } from "@/lib/rbac";
import {
  type FileRow,
  type FolderRow,
  ensureFolder,
  listFolders,
  listFilesInFolder,
  uploadProjectFile,
  getSignedUrl,
  deleteProjectFile,
  renameProjectFile,
  downloadFileBlob,
  getDisplayName,
} from "@/lib/project-files";
import { listCloudLinks, type CloudLink, type CloudLinkSource } from "@/lib/cloud-links";
import {
  loadNativeLibrary,
  isNativeId,
  getContractSignedUrl,
  downloadContractBlob,
  deleteContractObject,
  type NativeFolder,
  type NativeFile,
} from "@/lib/native-files";
import { downloadBlob } from "@/lib/download";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_authenticated/project-files")({
  head: () => ({ meta: [{ title: "File Library · Kwalis Hub" }] }),
  component: ProjectFilesPage,
});

function ProjectFilesPage() {
  const { t } = useTranslation();

  const can = useCan();
  const projectId = useStore((s) => s.activeProjectId);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [cloudLinks, setCloudLinks] = useState<CloudLink[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudFilter, setCloudFilter] = useState<"all" | CloudLinkSource>("all");
  const [cloudSearch, setCloudSearch] = useState("");
  /** One search box drives cloud links, virtual storage files and managed files. */
  const [librarySearch, setLibrarySearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nativeFolders, setNativeFolders] = useState<NativeFolder[]>([]);
  const [nativeFiles, setNativeFiles] = useState<NativeFile[]>([]);
  /** Pending deletion from the 3-dot menu, confirmed via dialog. */
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
    path: string;
    native: boolean;
    row?: FileRow;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const [fs, fl] = await Promise.all([
        listFolders(projectId),
        listFilesInFolder(projectId, currentId),
      ]);
      setFolders(fs);
      setFiles(fl);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load library");
    } finally {
      setBusy(false);
    }
  };

  // Cloud-hosted documents (attachment URLs on crew/cast contracts and invoices)
  // are project-wide, so they load independently of the current folder.
  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setCloudLinks([]);
      return;
    }
    setCloudBusy(true);
    listCloudLinks(projectId)
      .then((rows) => {
        if (!cancelled) setCloudLinks(rows);
      })
      .catch((e: any) => {
        if (!cancelled) toast.error(e?.message ?? "Failed to load cloud documents");
      })
      .finally(() => {
        if (!cancelled) setCloudBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Native uploads (IDs, IBAN certificates, contracts, invoice PDFs) live in the
  // private `contracts` bucket without a metadata row, so they are projected
  // into virtual folders straight from storage.
  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setNativeFolders([]);
      setNativeFiles([]);
      return;
    }
    loadNativeLibrary(projectId)
      .then((res) => {
        if (cancelled) return;
        setNativeFolders(res.folders);
        setNativeFiles(res.files);
      })
      .catch(() => {
        if (!cancelled) {
          setNativeFolders([]);
          setNativeFiles([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentId]);

  // Cross-navigation from contextual attachment lists:
  // /project-files?folder=<folderId>&highlight=<fileId>
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const folder = params.get("folder");
    const highlight = params.get("highlight");
    if (!folder && !highlight) return;
    if (folder) setCurrentId(folder);
    if (highlight) setHighlightId(highlight);
    // Clean the URL so a refresh doesn't re-trigger the highlight.
    params.delete("folder");
    params.delete("highlight");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  useEffect(() => {
    if (!highlightId || busy) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`file-row-${highlightId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("bg-primary/10");
        setTimeout(() => el.classList.remove("bg-primary/10"), 2000);
      }
      setHighlightId(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [highlightId, busy, files]);

  // Dismiss the 3-dot menu when clicking anywhere else.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = () => setMenuOpen(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [menuOpen]);

  const visibleCloudLinks = useMemo(() => {
    const q = (cloudSearch || librarySearch).trim().toLowerCase();
    return cloudLinks.filter((l) => {
      if (cloudFilter !== "all" && l.source !== cloudFilter) return false;
      if (!q) return true;
      return (
        l.beneficiary.toLowerCase().includes(q) ||
        l.detail.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q)
      );
    });
  }, [cloudLinks, cloudFilter, cloudSearch, librarySearch]);

  const cloudCounts = useMemo(() => {
    const c: Record<string, number> = { all: cloudLinks.length };
    for (const l of cloudLinks) c[l.source] = (c[l.source] ?? 0) + 1;
    return c;
  }, [cloudLinks]);

  // Managed folders (project_files metadata) and virtual storage folders share
  // one tree so users navigate both the same way.
  const allFolders = useMemo(
    () => [
      ...folders,
      ...nativeFolders.map((f) => ({
        id: f.id,
        name: f.name,
        parent_id: f.parent_id,
        auto_generated: true,
      })),
    ],
    [folders, nativeFolders],
  );

  const query = librarySearch.trim().toLowerCase();

  const childFolders = useMemo(
    () =>
      allFolders
        .filter((f) => (f.parent_id ?? null) === currentId)
        .filter((f) => !query || f.name.toLowerCase().includes(query)),
    [allFolders, currentId, query],
  );

  const breadcrumbs = useMemo(() => {
    const chain: { id: string; name: string; parent_id: string | null }[] = [];
    let node = allFolders.find((f) => f.id === currentId) ?? null;
    while (node) {
      chain.unshift(node);
      node = node.parent_id ? (allFolders.find((f) => f.id === node!.parent_id) ?? null) : null;
    }
    return chain;
  }, [allFolders, currentId]);

  const folderNameById = useMemo(
    () => new Map(allFolders.map((f) => [f.id, f.name] as const)),
    [allFolders],
  );

  /**
   * Unified row model for managed rows and native storage objects. While a
   * search is active, native uploads are matched across the whole project so
   * a beneficiary's documents are findable without navigating folders.
   */
  const visibleFiles = useMemo(() => {
    type Row = {
      id: string;
      name: string;
      meta: string;
      native: boolean;
      path: string;
      row: FileRow | null;
    };

    const nativeRows: Row[] = nativeFiles
      .filter((f) => (query ? true : f.folderId === currentId))
      .filter((f) => {
        if (!query) return true;
        const beneficiary = folderNameById.get(f.folderId) ?? "";
        return (
          f.name.toLowerCase().includes(query) ||
          beneficiary.toLowerCase().includes(query) ||
          f.sourceLabel.toLowerCase().includes(query)
        );
      })
      .map((f) => ({
        id: f.id,
        name: f.name,
        meta: [
          folderNameById.get(f.folderId) ?? null,
          f.createdAt ? formatDateTime(f.createdAt) : null,
          `from ${f.sourceLabel}`,
          f.size ? `${(f.size / 1024).toFixed(1)} KB` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        native: true,
        path: f.path,
        row: null,
      }));

    if (isNativeId(currentId) && !query) return nativeRows;

    const managedRows: Row[] = files
      .filter((f) => {
        if (!query) return true;
        return (
          getDisplayName(f).toLowerCase().includes(query) ||
          f.name.toLowerCase().includes(query) ||
          (f.entity_type ?? "").toLowerCase().includes(query)
        );
      })
      .map((f) => ({
        id: f.id,
        name: getDisplayName(f),
        meta: [
          formatDateTime(f.created_at),
          f.entity_type ? `from ${f.entity_type}` : null,
          f.size_bytes ? `${(f.size_bytes / 1024).toFixed(1)} KB` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        native: false,
        path: f.storage_path,
        row: f,
      }));

    if (isNativeId(currentId)) return nativeRows;
    return query ? [...managedRows, ...nativeRows] : managedRows;
  }, [currentId, nativeFiles, files, query, folderNameById]);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected =
    visibleFiles.length > 0 && visibleFiles.every((f) => selected.has(f.id));

  const openNative = async (path: string) => {
    try {
      const url = await getContractSignedUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to open file");
    }
  };

  const downloadNative = async (path: string, name: string) => {
    try {
      const blob = await downloadContractBlob(path);
      downloadBlob(name, blob);
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    }
  };

  if (!can("files.library")) {
    return (
      <AppShell>
        <PageTitle title={t("project_files.file_library")} />
        <Panel>
          <div className="p-6 flex items-start gap-3">
            <ShieldOff className="size-5 text-destructive mt-0.5" />
            <div>
              <div className="font-semibold">{t("project_files.access_denied")}</div>
              <p className="text-sm text-muted-foreground mt-1">
                {t("project_files.the_centralized_file_library_requires_the")}
                <code className="mx-1 px-1 py-0.5 rounded bg-black/30">files.library</code>
                permission. Ask an administrator to grant it.
              </p>
            </div>
          </div>
        </Panel>
      </AppShell>
    );
  }

  if (!projectId) {
    return (
      <AppShell>
        <PageTitle title={t("project_files.file_library")} />
        <Panel>
          <div className="p-6 text-sm text-muted-foreground">
            {t("project_files.choose_an_active_project_from_the_top_bar")}
          </div>
        </Panel>
      </AppShell>
    );
  }

  const onCreateFolder = async () => {
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;
    try {
      await ensureFolder(projectId, name, currentId);
      toast.success(`Created "${name}"`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create folder");
    }
  };

  const onUpload: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await uploadProjectFile({ projectId, file, folderId: currentId });
      toast.success(`Uploaded "${file.name}"`);
      refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const openFile = async (row: FileRow) => {
    try {
      const url = await getSignedUrl(row.storage_path);
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to open file");
    }
  };

  const openCloudLink = (row: CloudLink) => {
    window.open(row.url, "_blank", "noopener,noreferrer");
  };

  const copyCloudLink = async (row: CloudLink) => {
    try {
      await navigator.clipboard.writeText(row.url);
      toast.success(t("project_files.cloud_document_link_copied"));
    } catch {
      toast.error(t("project_files.clipboard_unavailable"));
    }
  };

  const downloadFile = async (row: FileRow) => {
    try {
      const blob = await downloadFileBlob(row.storage_path);
      downloadBlob(getDisplayName(row), blob);
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    }
  };

  const renameFile = async (row: FileRow) => {
    const next = window.prompt("Rename file", getDisplayName(row))?.trim();
    if (!next || next === row.name) return;
    try {
      const updated = await renameProjectFile(row.id, next);
      setFiles((prev) => prev.map((f) => (f.id === row.id ? updated : f)));
      toast.success(t("project_files.renamed"));
    } catch (e: any) {
      toast.error(e?.message ?? "Rename failed");
    }
  };

  /**
   * Confirmed deletion. Managed rows drop from Storage then `project_files`;
   * native rows are storage-only objects, so only the object is removed.
   * The row disappears immediately, then the list is refetched for truth.
   */
  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setDeleting(true);
    try {
      if (target.native) await deleteContractObject(target.path);
      else await deleteProjectFile(target.row!);

      // Optimistic removal so the row vanishes right away.
      if (target.native) setNativeFiles((prev) => prev.filter((f) => f.id !== target.id));
      else setFiles((prev) => prev.filter((f) => f.id !== target.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });

      toast.success(`"${target.name}" deleted`);
      setPendingDelete(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  /** Recursively gather every descendant folder id (inclusive of root). */
  const collectFolderTree = (rootId: string): string[] => {
    const out: string[] = [rootId];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const f of folders) {
        if (f.parent_id === id) {
          out.push(f.id);
          stack.push(f.id);
        }
      }
    }
    return out;
  };

  const saveZip = async (zip: JSZip, label: string, total: number) => {
    if (total === 0) {
      toast.error(t("project_files.no_files_to_archive"));
      return;
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(`${label}.zip`, out);
    toast.success(`Archived ${total} file${total === 1 ? "" : "s"}`);
  };

  const downloadCurrentAsZip = async () => {
    if (!projectId) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      let total = 0;

      // Virtual storage folders (crew/cast/invoice uploads) have no metadata
      // rows, so archive them straight from the projected file list.
      if (isNativeId(currentId)) {
        const label = folderNameById.get(currentId!) ?? "folder";
        const scope = new Set<string>([currentId!]);
        for (const f of nativeFolders) {
          if (f.parent_id && scope.has(f.parent_id)) scope.add(f.id);
        }
        for (const f of nativeFiles) {
          if (!scope.has(f.folderId)) continue;
          try {
            const blob = await downloadContractBlob(f.path);
            const prefix =
              f.folderId === currentId ? "" : `${folderNameById.get(f.folderId) ?? ""}/`;
            zip.file(`${prefix}${f.name}`, blob);
            total += 1;
          } catch (err) {
            console.warn("zip skip", f.name, err);
          }
        }
        await saveZip(zip, label, total);
        return;
      }

      const scope = currentId ? collectFolderTree(currentId) : [null, ...folders.map((f) => f.id)];
      const folderById = new Map(folders.map((f) => [f.id, f] as const));

      // Build a relative path for each folder id, rooted at the current folder.
      const rootLabel = currentId ? (folderById.get(currentId)?.name ?? "folder") : "library";
      const pathOf = (fid: string | null): string => {
        if (!fid) return "";
        const chain: string[] = [];
        let cur: FolderRow | undefined = folderById.get(fid);
        while (cur && cur.id !== currentId) {
          chain.unshift(cur.name);
          cur = cur.parent_id ? folderById.get(cur.parent_id) : undefined;
        }
        return chain.join("/");
      };

      for (const fid of scope) {
        const rows = await listFilesInFolder(projectId, fid);
        for (const row of rows) {
          try {
            const blob = await downloadFileBlob(row.storage_path);
            const prefix = pathOf(fid);
            const target = prefix ? `${prefix}/${row.name}` : row.name;
            zip.file(target, blob);
            total += 1;
          } catch (err) {
            // Skip a single failed file rather than aborting the whole archive.
            console.warn("zip skip", row.name, err);
          }
        }
      }

      // At root, include every virtual storage object too so "download all"
      // really means all project documents.
      if (!currentId) {
        for (const f of nativeFiles) {
          try {
            const blob = await downloadContractBlob(f.path);
            zip.file(`${folderNameById.get(f.folderId) ?? "Storage"}/${f.name}`, blob);
            total += 1;
          } catch (err) {
            console.warn("zip skip", f.name, err);
          }
        }
      }

      await saveZip(zip, rootLabel, total);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to build archive");
    } finally {
      setZipping(false);
    }
  };

  const downloadSelectedAsZip = async () => {
    const rows = visibleFiles.filter((f) => selected.has(f.id));
    if (!rows.length) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      let total = 0;
      for (const f of rows) {
        try {
          const blob = f.native
            ? await downloadContractBlob(f.path)
            : await downloadFileBlob(f.path);
          zip.file(f.name, blob);
          total += 1;
        } catch (err) {
          console.warn("zip skip", f.name, err);
        }
      }
      await saveZip(zip, `selected-files-${new Date().toISOString().slice(0, 10)}`, total);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to build archive");
    } finally {
      setZipping(false);
    }
  };

  return (
    <AppShell>
      <PageTitle title={t("project_files.file_library")} />
      <Panel>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-wrap">
          <button
            onClick={() => setCurrentId(null)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <HomeIcon className="size-4" /> {t("platform.files.root")}
          </button>
          {breadcrumbs.map((b) => (
            <div key={b.id} className="flex items-center gap-2">
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <button onClick={() => setCurrentId(b.id)} className="text-sm hover:underline">
                {b.name}
              </button>
            </div>
          ))}

          <div className="ms-auto flex items-center gap-2 flex-wrap">
            <label className="relative">
              <Search className="size-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder={t("project_files.search_beneficiary_file_name_or_type")}
                className="ps-8 pe-3 py-1.5 text-sm rounded-xl bg-surface-2 border border-border outline-none focus:ring-2 ring-brand w-64 max-w-full"
              />
            </label>
            {selected.size > 0 && (
              <button
                onClick={downloadSelectedAsZip}
                disabled={zipping}
                className="inline-flex items-center gap-1 rounded-xl border border-success/30 bg-success/10 text-success px-3 py-1.5 text-sm hover:bg-success/20 disabled:opacity-60"
                title={t("project_files.download_the_selected_files_as_a_zip_archive")}
              >
                {zipping ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Archive className="size-4" />
                )}
                Download selected ({selected.size})
              </button>
            )}
            <button
              onClick={downloadCurrentAsZip}
              disabled={zipping}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
              title={t("project_files.download_this_folder_as_a_zip_archive")}
            >
              {zipping ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Archive className="size-4" />
              )}
              {zipping ? "Archiving…" : "Download folder (.zip)"}
            </button>

            <button
              onClick={onCreateFolder}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-muted"
            >
              <FolderPlus className="size-4" />
              {t("project_files.new_folder")}
            </button>
            <label className="inline-flex items-center gap-1 rounded-xl border border-border bg-brand/20 text-brand px-3 py-1.5 text-sm cursor-pointer hover:bg-brand/30">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {uploading ? "Uploading…" : "Upload"}
              <input type="file" className="hidden" onChange={onUpload} disabled={uploading} />
            </label>
          </div>
        </div>

        <div className="p-4">
          {/* Cloud documents: attachment URLs stored on crew/cast contracts and invoices. */}
          <div className="mb-6 rounded-xl border border-border bg-surface-2/40 p-3">
            <div className="flex flex-col gap-3 mb-3">
              <div className="flex flex-wrap items-center gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Cloud documents ({cloudLinks.length})
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {t("project_files.attachment_urls_from_crew_contracts_cast_contracts_and")}
                  </div>
                </div>
                <input
                  value={cloudSearch}
                  onChange={(e) => setCloudSearch(e.target.value)}
                  placeholder={t("project_files.search_name_or_link")}
                  className="ms-auto px-2.5 py-1.5 text-xs rounded-lg bg-surface-2 border border-border outline-none focus:ring-2 ring-brand w-56 max-w-full"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(["all", "Crew Contract", "Cast Contract", "Invoice"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setCloudFilter(k)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                      cloudFilter === k
                        ? "bg-brand/20 text-brand border-brand/40"
                        : "bg-surface-2 text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {k === "all" ? "All" : k} ({cloudCounts[k] ?? 0})
                  </button>
                ))}
              </div>
            </div>

            {cloudBusy && <TableSkeleton rows={3} cols={4} />}

            {!cloudBusy && (
              <div className="rounded-xl border border-border divide-y divide-border">
                {visibleCloudLinks.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 px-3 py-2">
                    <ExternalLink className="size-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">
                        {l.beneficiary}
                        <span className="ms-2 inline-flex px-1.5 py-0.5 rounded-md border border-border bg-surface-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {l.source}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[l.detail, l.url].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openCloudLink(l)}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border bg-surface-2 text-xs hover:bg-muted"
                        title={`Open ${l.source} document for ${l.beneficiary}`}
                      >
                        <ExternalLink className="size-3.5" />
                        {t("project_files.open")}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyCloudLink(l)}
                        className="p-1.5 rounded-lg hover:bg-muted"
                        title={t("project_files.copy_cloud_document_url")}
                        aria-label={`Copy ${l.source} document URL for ${l.beneficiary}`}
                      >
                        <Copy className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {visibleCloudLinks.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">
                    No cloud documents yet. Add an attachment URL on a crew/cast contract or an
                    invoice and it appears here automatically.
                  </div>
                )}
              </div>
            )}
          </div>

          {busy && <TableSkeleton rows={5} cols={4} />}

          {!busy && (
            <>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Folders
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {childFolders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setCurrentId(f.id)}
                    className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-start hover:bg-muted"
                  >
                    <Folder className="size-4 text-warning" />
                    <span className="truncate flex-1">{f.name}</span>
                    {f.auto_generated && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        auto
                      </span>
                    )}
                  </button>
                ))}
                {childFolders.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    {t("project_files.no_subfolders_here")}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mt-6 mb-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Files ({visibleFiles.length})
                </div>
                {visibleFiles.length > 0 && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() =>
                        setSelected(
                          allVisibleSelected ? new Set() : new Set(visibleFiles.map((f) => f.id)),
                        )
                      }
                    />
                    Select all
                  </label>
                )}
              </div>
              <div className="rounded-xl border border-border divide-y divide-border">
                {visibleFiles.map((f) => (
                  <div
                    key={f.id}
                    id={`file-row-${f.id}`}
                    className="flex items-center gap-3 px-3 py-2 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => toggleSelected(f.id)}
                      aria-label={`Select ${f.name}`}
                    />
                    <FileText className="size-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate" title={f.path}>
                        {f.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{f.meta}</div>
                    </div>

                    <button
                      onClick={() => (f.native ? openNative(f.path) : openFile(f.row!))}
                      className="p-1.5 rounded-lg hover:bg-muted"
                      title={t("project_files.open")}
                    >
                      <ExternalLink className="size-4" />
                    </button>
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        id={`file-menu-trigger-${f.id}`}
                        onClick={() => setMenuOpen(menuOpen === f.id ? null : f.id)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setMenuOpen(f.id);
                          }
                        }}
                        className="p-1.5 rounded-lg hover:bg-muted"
                        title={t("project_files.more_actions")}
                        aria-label={`${t("project_files.more_actions")} — ${f.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen === f.id}
                        aria-controls={menuOpen === f.id ? `file-menu-${f.id}` : undefined}
                      >
                        <MoreVertical className="size-4" />
                      </button>
                      {menuOpen === f.id && (
                        <div
                          id={`file-menu-${f.id}`}
                          role="menu"
                          aria-labelledby={`file-menu-trigger-${f.id}`}
                          ref={(el) => el?.querySelector<HTMLElement>("[role='menuitem']")?.focus()}
                          onKeyDown={(e) => {
                            const items = Array.from(
                              e.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']"),
                            );
                            const idx = items.indexOf(document.activeElement as HTMLElement);
                            if (e.key === "Escape" || e.key === "Tab") {
                              e.preventDefault();
                              setMenuOpen(null);
                              document.getElementById(`file-menu-trigger-${f.id}`)?.focus();
                            } else if (e.key === "ArrowDown") {
                              e.preventDefault();
                              items[(idx + 1) % items.length]?.focus();
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault();
                              items[(idx - 1 + items.length) % items.length]?.focus();
                            } else if (e.key === "Home") {
                              e.preventDefault();
                              items[0]?.focus();
                            } else if (e.key === "End") {
                              e.preventDefault();
                              items[items.length - 1]?.focus();
                            }
                          }}
                          className="absolute end-0 top-full mt-1 z-20 min-w-[160px] rounded-xl border border-border bg-surface-1 shadow-2xl py-1 text-sm"
                        >
                          <button
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setMenuOpen(null);
                              if (f.native) downloadNative(f.path, f.name);
                              else downloadFile(f.row!);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted focus:bg-muted focus:outline-none text-start"
                          >
                            <Download className="size-4" aria-hidden="true" /> Download
                          </button>
                          {!f.native && (
                            <button
                              role="menuitem"
                              type="button"
                              onClick={() => {
                                setMenuOpen(null);
                                renameFile(f.row!);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted focus:bg-muted focus:outline-none text-start"
                            >
                              <Pencil className="size-4" aria-hidden="true" /> Rename
                            </button>
                          )}
                          <button
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setMenuOpen(null);
                              setPendingDelete({
                                id: f.id,
                                name: f.name,
                                path: f.path,
                                native: f.native,
                                row: f.row ?? undefined,
                              });
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-destructive/20 focus:bg-destructive/20 focus:outline-none text-destructive text-start"
                          >
                            <Trash2 className="size-4" aria-hidden="true" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {visibleFiles.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">
                    {t("project_files.no_files_in_this_folder")}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Panel>
      <div className="text-xs text-muted-foreground mt-3">
        Tip: files uploaded via contextual{" "}
        <Link to="/crew" className="underline hover:text-foreground">
          Crew
        </Link>{" "}
        attachments appear here automatically under <em>Crew Profiles → &lt;Name&gt;</em>.
      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        title={t("platform.files.deleteTitle")}
        tone="danger"
        confirmLabel={t("platform.files.deletePermanently")}
        loading={deleting}
        loadingLabel={t("platform.files.deleting")}
        warning={t("platform.files.deleteWarning")}
        message={t("platform.files.deleteMessage", { name: pendingDelete?.name ?? "" })}
        onConfirm={confirmDelete}
        onCancel={() => (deleting ? undefined : setPendingDelete(null))}
      />
      {projectId && <TransactionAttachments projectId={projectId} />}
    </AppShell>
  );
}
