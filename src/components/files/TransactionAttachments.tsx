import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, Loader2, Paperclip, Search } from "lucide-react";
import { Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/date-format";
import { openSignedFile } from "@/lib/signed-file";

/**
 * D08 — central archive: every file or link attached to a transaction of the
 * project (invoices, petty cash, per diem, contracts, payment proofs…), from
 * public.v_project_attachments (db/pending/195). The view is
 * security_invoker, so storage and table RLS decide what each user sees;
 * files open through 5-minute signed URLs.
 */
type Attachment = {
  source_type: string;
  source_id: string | null;
  reference: string | null;
  counterparty: string | null;
  bucket_id: string | null;
  storage_path: string | null;
  external_url: string | null;
  file_name: string | null;
  size_bytes: number | null;
  attached_at: string | null;
};

const TYPES = [
  "invoice",
  "petty_cash",
  "per_diem",
  "crew_contract",
  "cast_contract",
  "payroll",
  "payment_request",
  "payment",
  "location",
  "other",
] as const;

async function fetchAttachments(projectId: string): Promise<Attachment[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("v_project_attachments")
    .select(
      "source_type, source_id, reference, counterparty, bucket_id, storage_path, external_url, file_name, size_bytes, attached_at",
    )
    .eq("project_id", projectId)
    .order("attached_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as Attachment[];
}

function sizeLabel(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeHttpUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function TransactionAttachments({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [type, setType] = useState<string>("all");
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["project-attachments", projectId],
    queryFn: () => fetchAttachments(projectId),
    staleTime: 30_000,
  });
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (query.data ?? []).filter(
      (r) =>
        (type === "all" || r.source_type === type) &&
        (!needle ||
          [r.reference, r.counterparty, r.file_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle)),
    );
  }, [query.data, type, q]);

  return (
    <Panel className="mt-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2 me-auto">
          <Paperclip className="size-4 text-brand" />
          <h2 className="text-base font-semibold">{t("platform.files.archiveTitle")}</h2>
        </div>
        <label className="relative">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("platform.files.search")}
            className="w-56 max-w-full rounded-lg border border-border bg-surface ps-8 pe-3 py-1.5 text-sm outline-none focus:ring-2 ring-brand"
          />
        </label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          aria-label={t("platform.files.type")}
        >
          <option value="all">{t("platform.files.allTypes")}</option>
          {TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`platform.files.kind.${k}`)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{t("platform.files.archiveIntro")}</p>
      {query.isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : query.isError ? (
        <p className="text-sm text-muted-foreground">{t("platform.files.archiveUnavailable")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("platform.files.archiveEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-start py-2 pe-3">{t("platform.files.type")}</th>
                <th className="text-start py-2 px-3">{t("platform.files.reference")}</th>
                <th className="text-start py-2 px-3">{t("platform.files.file")}</th>
                <th className="text-start py-2 px-3">{t("platform.files.date")}</th>
                <th className="py-2 ps-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const href = safeHttpUrl(r.external_url);
                return (
                  <tr key={`${r.storage_path ?? r.external_url}-${i}`} className="border-t border-border">
                    <td className="py-2 pe-3 whitespace-nowrap">
                      {t(`platform.files.kind.${r.source_type}`, r.source_type)}
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-medium">{r.reference || "—"}</div>
                      {r.counterparty && (
                        <div className="text-xs text-muted-foreground">{r.counterparty}</div>
                      )}
                    </td>
                    <td className="py-2 px-3 max-w-[18rem]">
                      <div className="truncate" dir="ltr" title={r.file_name ?? ""}>
                        {r.file_name}
                      </div>
                      <div className="text-xs text-muted-foreground">{sizeLabel(r.size_bytes)}</div>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap tabular-nums">
                      {formatDate(r.attached_at)}
                    </td>
                    <td className="py-2 ps-3 text-end whitespace-nowrap">
                      {r.bucket_id && r.storage_path ? (
                        <span className="inline-flex gap-3">
                          <button
                            type="button"
                            onClick={() => void openSignedFile(r.bucket_id!, r.storage_path!)}
                            className="inline-flex items-center gap-1 text-brand hover:underline"
                          >
                            <ExternalLink className="size-3.5" /> {t("platform.common.view")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void openSignedFile(r.bucket_id!, r.storage_path!, r.file_name ?? "file")
                            }
                            className="inline-flex items-center gap-1 text-brand hover:underline"
                          >
                            <Download className="size-3.5" /> {t("platform.files.download")}
                          </button>
                        </span>
                      ) : href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          <ExternalLink className="size-3.5" /> {t("platform.files.openLink")}
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
