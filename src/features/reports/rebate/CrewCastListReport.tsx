// ═══════════════════════════════════════════════════════════════════
// N04 — Crew List / Cast List for the Film Commission (no amounts):
// name, position / role, department, ATL/BTL, nationality, Saudi yes/no,
// phone, e-mail, start, end. Phone and e-mail come back from the database
// only for users who may edit crew / cast contracts (get_crew_cast_list,
// db/pending/197). Excel / PDF through the shared writers.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { HEADER_ACCOUNTS } from "@/lib/data";
import { exportReportPdf, exportReportXlsx, type ReportDoc } from "@/lib/export/xlsx-report";
import { DateText, EmptyRow, ExportButtons, TableShell, tdCls, thCls } from "./rebate-ui";

export interface CrewCastListRow {
  person_id: string;
  ref_no: string | null;
  full_name: string;
  position: string | null;
  character_name: string | null;
  department_code: string | null;
  cost_group: string | null;
  nationality: string | null;
  is_saudi: boolean;
  mother_saudi: boolean | null;
  is_trainee: boolean | null;
  phone: string | null;
  email: string | null;
  start_date: string | null;
  end_date: string | null;
  contacts_visible: boolean;
}

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

export async function fetchCrewCastList(
  projectId: string,
  kind: "crew" | "cast",
): Promise<CrewCastListRow[]> {
  const { data, error } = await (supabase.rpc as unknown as Rpc)("get_crew_cast_list", {
    p_project_id: projectId,
    p_kind: kind,
  });
  if (error) throw error;
  return (data ?? []) as CrewCastListRow[];
}

const deptNames = new Map(HEADER_ACCOUNTS.map((h) => [h.code, h.name]));
export const departmentName = (code: string | null) =>
  code ? `${code} ${deptNames.get(code) ?? ""}`.trim() : "";

export function crewCastListDoc(
  rows: readonly CrewCastListRow[],
  kind: "crew" | "cast",
  t: (k: string) => string,
  withContacts: boolean,
): ReportDoc {
  const yes = t("rebate.yes");
  const no = t("rebate.no");
  const columns = [
    { header: t("rebate.col.name"), width: 26 },
    { header: kind === "cast" ? t("rebate.cl.role") : t("rebate.cl.position"), width: 22 },
    { header: t("rebate.cl.department"), width: 24 },
    { header: t("rebate.cl.atl_btl") },
    { header: t("rebate.col.nationality") },
    { header: t("rebate.cl.saudi") },
    ...(withContacts
      ? [{ header: t("rebate.cl.phone") }, { header: t("rebate.cl.email"), width: 26 }]
      : []),
    { header: t("rebate.cl.start"), type: "date" as const },
    { header: t("rebate.cl.end"), type: "date" as const },
  ];
  return {
    report: kind === "cast" ? "Cast List" : "Crew List",
    title: kind === "cast" ? t("rebate.cl.cast_title") : t("rebate.cl.crew_title"),
    sections: [
      {
        columns,
        rows: rows.map((r) => [
          r.full_name,
          kind === "cast"
            ? [r.character_name, r.position].filter(Boolean).join(" — ")
            : (r.position ?? ""),
          departmentName(r.department_code),
          r.cost_group ?? "",
          r.nationality ?? "",
          r.is_saudi || r.mother_saudi
            ? `${yes}${r.mother_saudi && !r.is_saudi ? ` (${t("rebate.mother_saudi_short")})` : ""}`
            : no,
          ...(withContacts ? [r.phone ?? "", r.email ?? ""] : []),
          r.start_date,
          r.end_date,
        ]),
      },
    ],
  };
}

export function CrewCastListReport() {
  const { t } = useTranslation();
  const projectId = useStore((s) => s.activeProjectId);
  const [kind, setKind] = useState<"crew" | "cast">("crew");
  const [withContacts, setWithContacts] = useState(false);
  const q = useQuery({
    queryKey: ["crew-cast-list", projectId, kind],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: () => fetchCrewCastList(projectId as string, kind),
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const contactsAllowed = rows.some((r) => r.contacts_visible);
  const showContacts = contactsAllowed && withContacts;
  const tt = (k: string) => t(k) as string;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("rebate.cl.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("rebate.cl.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-full bg-surface p-1">
            {(["crew", "cast"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${kind === k ? "bg-brand text-brand-foreground" : "hover:bg-muted"}`}
              >
                {k === "crew" ? t("rebate.cl.crew_title") : t("rebate.cl.cast_title")}
              </button>
            ))}
          </div>
          {contactsAllowed && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={withContacts}
                onChange={(e) => setWithContacts(e.target.checked)}
              />
              {t("rebate.cl.include_contacts")}
            </label>
          )}
          <ExportButtons
            disabled={rows.length === 0}
            onExport={(k) => {
              const doc = crewCastListDoc(rows, kind, tt, showContacts);
              return k === "excel" ? exportReportXlsx(doc) : exportReportPdf(doc);
            }}
          />
        </div>
      </div>
      {!contactsAllowed && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">{t("rebate.cl.contacts_hidden")}</p>
      )}
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("rebate.loading")}
        </div>
      ) : (
        <TableShell>
          <thead className="bg-surface-2/60">
            <tr>
              <th className={thCls}>{t("rebate.col.name")}</th>
              <th className={thCls}>
                {kind === "cast" ? t("rebate.cl.role") : t("rebate.cl.position")}
              </th>
              <th className={thCls}>{t("rebate.cl.department")}</th>
              <th className={thCls}>{t("rebate.cl.atl_btl")}</th>
              <th className={thCls}>{t("rebate.col.nationality")}</th>
              <th className={thCls}>{t("rebate.cl.saudi")}</th>
              {showContacts && <th className={thCls}>{t("rebate.cl.phone")}</th>}
              {showContacts && <th className={thCls}>{t("rebate.cl.email")}</th>}
              <th className={thCls}>{t("rebate.cl.start")}</th>
              <th className={thCls}>{t("rebate.cl.end")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow cols={showContacts ? 10 : 8} text={t("rebate.empty")} />
            )}
            {rows.map((r) => (
              <tr key={r.person_id} className="border-t border-border">
                <td className={tdCls}>
                  <div className="font-medium">{r.full_name}</div>
                  <div className="text-xs text-muted-foreground">{r.ref_no}</div>
                </td>
                <td className={tdCls}>
                  {kind === "cast"
                    ? [r.character_name, r.position].filter(Boolean).join(" — ")
                    : r.position}
                </td>
                <td className={tdCls}>{departmentName(r.department_code)}</td>
                <td className={tdCls}>{r.cost_group ?? "—"}</td>
                <td className={tdCls}>{r.nationality ?? "—"}</td>
                <td className={tdCls}>
                  {r.is_saudi
                    ? t("rebate.yes")
                    : r.mother_saudi
                      ? `${t("rebate.yes")} (${t("rebate.mother_saudi_short")})`
                      : t("rebate.no")}
                </td>
                {showContacts && <td className={tdCls}>{r.phone}</td>}
                {showContacts && <td className={tdCls}>{r.email}</td>}
                <td className={tdCls}>
                  <DateText v={r.start_date} />
                </td>
                <td className={tdCls}>
                  <DateText v={r.end_date} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}
