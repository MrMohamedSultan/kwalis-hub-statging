// Company settings for exports and dates (G02 / G05):
//   - the client company logo printed at the top of every Excel / PDF export;
//   - the ONE date format used by every screen, input and export.
// Saved on public.organizations (logo_url, date_format) — writable by the
// company's owners/admins under the existing "Org admins update orgs" policy.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarDays, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DATE_FORMATS, formatDate, riyadhToday, type DateFormat } from "@/lib/date-format";
import { fetchOrgDateFormat, saveOrgDateFormat } from "@/lib/use-platform-date-format";
import { invalidateExportBranding } from "@/lib/export/branding";

const MAX_LOGO_W = 480;
const MAX_LOGO_H = 240;
const MAX_LOGO_BYTES = 512 * 1024;

/** Downscale any uploaded image to a small PNG data URL (keeps exports light). */
async function imageFileToPng(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.type)) {
    throw new Error("unsupported");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("unreadable"));
      el.src = url;
    });
    const scale = Math.min(1, MAX_LOGO_W / img.naturalWidth, MAX_LOGO_H / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("unreadable");
    ctx.drawImage(img, 0, 0, w, h);
    const data = canvas.toDataURL("image/png");
    if (data.length > MAX_LOGO_BYTES) throw new Error("too_large");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ExportBrandingPanel({ organizationId }: { organizationId: string | null }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState<DateFormat>("dd/MM/yyyy");
  const [logo, setLogo] = useState<string | null>(null);
  const [savingFormat, setSavingFormat] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      fetchOrgDateFormat(organizationId),
      supabase.from("organizations").select("logo_url").eq("id", organizationId).maybeSingle(),
    ]).then(([f, res]) => {
      if (cancelled) return;
      setFormat(f as DateFormat);
      setLogo(((res.data as { logo_url: string | null } | null)?.logo_url ?? null) || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (!organizationId) {
    return <p className="text-sm text-muted-foreground">{t("exports.settings_no_company")}</p>;
  }

  const saveFormat = async () => {
    setSavingFormat(true);
    try {
      await saveOrgDateFormat(organizationId, format);
      toast.success(t("exports.settings_format_saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("exports.settings_save_failed"));
    } finally {
      setSavingFormat(false);
    }
  };

  const writeLogo = async (value: string | null) => {
    setSavingLogo(true);
    try {
      const { error } = await supabase
        .from("organizations")
        .update({ logo_url: value })
        .eq("id", organizationId);
      if (error) throw new Error(error.message);
      setLogo(value);
      invalidateExportBranding(organizationId);
      toast.success(value ? t("exports.settings_logo_saved") : t("exports.settings_logo_removed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("exports.settings_save_failed"));
    } finally {
      setSavingLogo(false);
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const png = await imageFileToPng(file);
      await writeLogo(png);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      toast.error(
        code === "too_large"
          ? t("exports.settings_logo_too_large")
          : t("exports.settings_logo_unsupported"),
      );
    }
  };

  const today = riyadhToday();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-brand" />
          <h2 className="text-base font-semibold">{t("exports.settings_date_title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t("exports.settings_date_help")}</p>
        {loading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">
                {t("exports.settings_date_label")}
              </span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as DateFormat)}
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()} — {formatDate(today, f)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={saveFormat}
              disabled={savingFormat}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50"
            >
              {savingFormat && <Loader2 className="size-3.5 animate-spin" />}
              {t("exports.settings_save_format")}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ImageIcon className="size-4 text-brand" />
          <h2 className="text-base font-semibold">{t("exports.settings_logo_title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t("exports.settings_logo_help")}</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-48 items-center justify-center rounded-lg border border-dashed border-border bg-card p-2">
            {logo ? (
              <img
                src={logo}
                alt={t("exports.settings_logo_title")}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-muted-foreground">{t("exports.settings_no_logo")}</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={onPick}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={savingLogo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            {savingLogo ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {logo ? t("exports.settings_replace_logo") : t("exports.settings_upload_logo")}
          </button>
          {logo && (
            <button
              type="button"
              onClick={() => writeLogo(null)}
              disabled={savingLogo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
              {t("exports.settings_remove_logo")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
