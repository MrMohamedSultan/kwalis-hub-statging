// Project default KSA region (db/pending/201): budget lines without a region
// count in this region in the Film Commission budget by region.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { KSA_REGIONS, regionSlug } from "@/lib/ksa-regions";

const regionSchema = z.enum(KSA_REGIONS).nullable();

export function ProjectRegionPanel() {
  const { t } = useTranslation();
  const projectId = useStore((s) => s.activeProjectId);
  const [region, setRegion] = useState<string>("");
  const [available, setAvailable] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) return;
    (async () => {
      const { data, error } = await (supabase.from as any)("projects")
        .select("default_region")
        .eq("id", projectId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setAvailable(false); // column not deployed yet (db/pending/201)
        return;
      }
      setAvailable(true);
      setRegion((data?.default_region as string | null) ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId || !available) return null;
  return (
    <Panel className="max-w-2xl space-y-3 p-5">
      <div className="flex items-center gap-2">
        <MapPin className="size-4 text-brand" />
        <h2 className="text-base font-semibold">{t("decisions.region.panelTitle")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t("decisions.region.panelHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          aria-label={t("decisions.region.label")}
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:ring-2 ring-brand"
        >
          <option value="">{t("decisions.region.none")}</option>
          {KSA_REGIONS.map((r) => (
            <option key={r} value={r}>
              {t(`decisions.region.${regionSlug(r)}`)}
            </option>
          ))}
        </select>
        <button
          disabled={saving}
          onClick={async () => {
            const v = regionSchema.safeParse(region || null);
            if (!v.success) return;
            setSaving(true);
            const { error } = await (supabase.rpc as any)("set_project_default_region", {
              p_project: z.string().uuid().parse(projectId),
              p_region: v.data,
            });
            setSaving(false);
            if (error) toast.error(error.message);
            else toast.success(t("decisions.region.saved"));
          }}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground disabled:opacity-50"
        >
          {t("decisions.common.save")}
        </button>
      </div>
    </Panel>
  );
}
