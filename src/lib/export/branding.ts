// ═══════════════════════════════════════════════════════════════════
// Export identity (G01 / G02) — the ONE header / footer / file name that
// every Excel and PDF export carries.
//
//   Top:    client company logo · company name · project (code — name)
//   Bottom: "Exported from Kwalis Hub" + Kwalis logo · user name ·
//           date & time in Saudi time (Asia/Riyadh) · page X of Y
//   File:   KwalisHub_{ProjectCode}_{Report}_{YYYY-MM-DD}.{ext}
// ═══════════════════════════════════════════════════════════════════
import { useStore } from "@/lib/store";
import { peekAuthRoles } from "@/lib/auth-roles";
import { supabase } from "@/integrations/supabase/client";
import { exportFileName, normalizeExportFileName, type ExportBranding } from "./file-name";

export {
  PRODUCT_NAME,
  exportFileName,
  normalizeExportFileName,
  projectLabel,
  footerLine,
  pageLabel,
  type ExportBranding,
} from "./file-name";

// ── Runtime context (browser) ─────────────────────────────────────────

const imageCache = new Map<string, Promise<string | null>>();

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

/** Fetch an image URL as a data URL (null on any failure — exports never block on a logo). */
export function imageAsDataUrl(url: string | null | undefined): Promise<string | null> {
  const u = String(url ?? "").trim();
  if (!u) return Promise.resolve(null);
  if (/^data:image\/(png|jpe?g);base64,/i.test(u)) return Promise.resolve(u);
  if (!/^(https?:\/\/|\/)/i.test(u) || typeof fetch === "undefined") return Promise.resolve(null);
  let p = imageCache.get(u);
  if (!p) {
    p = fetch(u)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => (blob && /image\/(png|jpe?g)/i.test(blob.type) ? blobToDataUrl(blob) : null))
      .catch(() => null);
    imageCache.set(u, p);
  }
  return p;
}

const orgCache = new Map<string, Promise<{ name: string; logo: string | null } | null>>();

/** Drop the cached company identity (after the logo / name is changed in Settings). */
export function invalidateExportBranding(orgId?: string) {
  if (orgId) orgCache.delete(orgId);
  else orgCache.clear();
}

async function fetchOrgIdentity(orgId: string) {
  let p = orgCache.get(orgId);
  if (!p) {
    p = (async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name, logo_url")
        .eq("id", orgId)
        .maybeSingle();
      const row = data as { name: string | null; logo_url: string | null } | null;
      if (!row) return null;
      return { name: row.name ?? "", logo: row.logo_url ?? null };
    })().catch(() => null);
    orgCache.set(orgId, p);
  }
  return p;
}

/**
 * Collect the identity for an export from the live app state: active
 * project, its company (name + logo), and the signed-in user.
 */
export async function getExportBranding(): Promise<ExportBranding> {
  const s = useStore.getState();
  const project = s.projects.find((p) => p.id === s.activeProjectId) ?? null;
  const orgId = project?.organizationId ?? null;
  const org = orgId ? await fetchOrgIdentity(orgId) : null;
  const roles = peekAuthRoles();
  const [logoDataUrl, productLogoDataUrl] = await Promise.all([
    imageAsDataUrl(org?.logo),
    imageAsDataUrl("/kwalis-logo-dark.png"),
  ]);
  return {
    companyName: org?.name || project?.organizationName || "",
    logoDataUrl,
    productLogoDataUrl,
    projectCode: project?.code ?? null,
    projectName: project?.name ?? s.projectName ?? null,
    userName: roles?.displayName || roles?.email || "",
    exportedAt: new Date(),
  };
}

/** Synchronous project context for file names (active project in the store). */
export function currentProjectContext(): {
  projectCode: string | null;
  projectName: string | null;
} {
  const s = useStore.getState();
  const project = s.projects.find((p) => p.id === s.activeProjectId) ?? null;
  return {
    projectCode: project?.code ?? null,
    projectName: project?.name ?? s.projectName ?? null,
  };
}

/** Standard file name for the active project. */
export function brandedFileName(report: string, ext: string): string {
  return exportFileName({ projectCode: currentProjectContext().projectCode, report, ext });
}

/** Normalise a legacy file name for the active project. */
export function normalizeForActiveProject(raw: string, ext: string): string {
  return normalizeExportFileName(raw, ext, currentProjectContext());
}
