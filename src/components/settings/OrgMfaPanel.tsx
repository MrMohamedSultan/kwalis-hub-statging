import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { setOrgRequireMfa } from "@/lib/mfa";

/** X02 — organization admins can require two-step verification for every member. */
export function OrgMfaPanel({ organizationId }: { organizationId: string | null }) {
  const { t } = useTranslation();
  const [value, setValue] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      // require_mfa is new (db/pending/195) and not in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("organizations")
        .select("require_mfa")
        .eq("id", organizationId)
        .maybeSingle();
      if (!cancelled) setValue(Boolean((data as { require_mfa?: boolean } | null)?.require_mfa));
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (!organizationId || value === null) return null;

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await setOrgRequireMfa(organizationId, next);
      setValue(next);
      toast.success(next ? t("platform.mfa.orgRequiredOn") : t("platform.mfa.orgRequiredOff"));
    } catch {
      toast.error(t("platform.mfa.orgRequiredFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-brand" />
        <h2 className="text-base font-semibold">{t("platform.mfa.orgTitle")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t("platform.mfa.orgBody")}</p>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={value}
          disabled={saving}
          onChange={(e) => void toggle(e.target.checked)}
          className="size-4 accent-[var(--brand)]"
        />
        {t("platform.mfa.orgToggle")}
      </label>
    </div>
  );
}
