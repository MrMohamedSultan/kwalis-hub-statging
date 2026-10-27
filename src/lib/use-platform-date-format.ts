// Loads the company's platform date format (organizations.date_format,
// G05) whenever the active company changes, so every screen, input and
// export uses it. Falls back to dd/MM/yyyy when unset or unreadable.
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { DEFAULT_DATE_FORMAT, isDateFormat, setDateFormat, useDateFormat } from "@/lib/date-format";

export async function fetchOrgDateFormat(orgId: string): Promise<string> {
  const { data, error } = await supabase
    .from("organizations")
    .select("date_format" as never)
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) return DEFAULT_DATE_FORMAT;
  const v = (data as unknown as { date_format?: string | null }).date_format;
  return isDateFormat(v) ? v : DEFAULT_DATE_FORMAT;
}

export async function saveOrgDateFormat(orgId: string, format: string): Promise<void> {
  if (!isDateFormat(format)) throw new Error("Unsupported date format");
  const { error } = await supabase
    .from("organizations")
    .update({ date_format: format } as never)
    .eq("id", orgId);
  if (error) throw new Error(error.message);
  const st = useStore.getState();
  const activeOrg = st.projects.find((x) => x.id === st.activeProjectId)?.organizationId ?? null;
  if (!activeOrg || activeOrg === orgId) setDateFormat(format);
}

/** Mount once in the app shell: keeps the platform format in sync and re-renders on change. */
export function usePlatformDateFormat(): void {
  useDateFormat(); // subscribe — pages re-render when the format changes
  const orgId = useStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId);
    return p?.organizationId ?? null;
  });
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetchOrgDateFormat(orgId).then((f) => {
      if (!cancelled) setDateFormat(f);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);
}
