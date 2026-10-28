// Saudi WHT rate table (wht_rate_rules, db/pending/090 + 201), editable:
// platform rows by a super admin, organization rows (which win) by an org admin.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Percent } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuthRoles } from "@/lib/auth-roles";
import { whtServiceLabel } from "@/lib/wht-rates";

type Row = {
  id: string;
  organization_id: string | null;
  service_type: string;
  rate_pct: number;
  label_en: string | null;
  label_ar: string | null;
  source_note: string | null;
  sort_order: number | null;
};

const rateSchema = z.coerce.number().min(0).max(99.99);
const noteSchema = z.string().trim().max(500);
const from = (t: string) => (supabase.from as any)(t);

export function WhtRatesPanel({ organizationId }: { organizationId: string | null }) {
  const { t, i18n } = useTranslation();
  const roles = useAuthRoles();
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [newType, setNewType] = useState("");
  const [newRate, setNewRate] = useState("");
  const [newNote, setNewNote] = useState("");
  const isOrgAdmin = !!organizationId && roles.adminOrgIds.includes(organizationId);
  const canPlatform = roles.isSuperAdmin;

  const load = useCallback(async () => {
    const { data, error } = await from("wht_rate_rules").select(
      "id, organization_id, service_type, rate_pct, label_en, label_ar, source_note, sort_order",
    );
    if (error) return;
    setRows(
      ((data ?? []) as Row[])
        .filter((r) => !r.organization_id || r.organization_id === organizationId)
        .sort(
          (a, b) =>
            (a.sort_order ?? 1000) - (b.sort_order ?? 1000) ||
            a.service_type.localeCompare(b.service_type),
        ),
    );
  }, [organizationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const platformTypes = useMemo(
    () => rows.filter((r) => !r.organization_id).map((r) => r.service_type),
    [rows],
  );
  const lang = i18n.language?.startsWith("ar") ? "ar" : "en";

  const saveRate = async (r: Row) => {
    const v = rateSchema.safeParse(edit[r.id]);
    if (!v.success) return toast.error(t("decisions.wht.invalidRate"));
    const { error } = await from("wht_rate_rules").update({ rate_pct: v.data }).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(t("decisions.wht.saved"));
    setEdit((e) => ({ ...e, [r.id]: "" }));
    void load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Percent className="size-4 text-brand" />
        <h2 className="text-base font-semibold">{t("decisions.wht.title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t("decisions.wht.hint")}</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">{t("decisions.wht.service")}</th>
              <th className="px-3 py-2 text-end">{t("decisions.wht.rate")}</th>
              <th className="px-3 py-2 text-start">{t("decisions.wht.source")}</th>
              <th className="px-3 py-2 text-start">{t("decisions.wht.scope")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const editable = r.organization_id ? isOrgAdmin || canPlatform : canPlatform;
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {whtServiceLabel(r.service_type, lang, r, t)}
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {r.service_type}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-end whitespace-nowrap">
                    {editable ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={99.99}
                          step={0.01}
                          value={edit[r.id] ?? ""}
                          placeholder={String(r.rate_pct)}
                          onChange={(e) => setEdit((x) => ({ ...x, [r.id]: e.target.value }))}
                          className="w-20 rounded border border-border bg-input px-2 py-1 text-end"
                        />
                        %
                        {edit[r.id] && (
                          <button
                            onClick={() => void saveRate(r)}
                            className="rounded bg-brand px-2 py-1 text-xs text-brand-foreground"
                          >
                            {t("decisions.common.save")}
                          </button>
                        )}
                      </span>
                    ) : (
                      <span dir="ltr">{Number(r.rate_pct).toFixed(2)}%</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.source_note ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.organization_id ? t("decisions.wht.orgRow") : t("decisions.wht.platformRow")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isOrgAdmin && organizationId && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <div className="mb-1 text-muted-foreground">{t("decisions.wht.service")}</div>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {platformTypes.map((st) => (
                <option key={st} value={st}>
                  {whtServiceLabel(
                    st,
                    lang,
                    rows.find((r) => r.service_type === st),
                    t,
                  )}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <div className="mb-1 text-muted-foreground">{t("decisions.wht.rate")}</div>
            <input
              type="number"
              min={0}
              max={99.99}
              step={0.01}
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className="w-24 rounded-lg border border-border bg-input px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs">
            <div className="mb-1 text-muted-foreground">{t("decisions.wht.source")}</div>
            <input
              value={newNote}
              maxLength={500}
              onChange={(e) => setNewNote(e.target.value)}
              className="w-56 rounded-lg border border-border bg-input px-2 py-1.5 text-sm"
            />
          </label>
          <button
            disabled={!newType || !newRate}
            onClick={async () => {
              const rate = rateSchema.safeParse(newRate);
              const note = noteSchema.safeParse(newNote);
              if (!rate.success || !note.success || !newType) {
                return toast.error(t("decisions.wht.invalidRate"));
              }
              const { error } = await from("wht_rate_rules").insert({
                organization_id: z.string().uuid().parse(organizationId),
                service_type: newType,
                rate_pct: rate.data,
                source_note: note.data || null,
              });
              if (error) return toast.error(error.message);
              setNewType("");
              setNewRate("");
              setNewNote("");
              toast.success(t("decisions.wht.saved"));
              void load();
            }}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground disabled:opacity-50"
          >
            {t("decisions.wht.addOrgRate")}
          </button>
        </div>
      )}
    </div>
  );
}
