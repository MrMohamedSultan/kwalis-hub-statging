// ============================================================
// Super Admin context switcher.
//
// Lets a platform admin flip between the "Platform Hub"
// (/platform-admin — global, cross-tenant) and any specific
// Organization Workspace (/settings scoped to that org via
// useAdminScope).
//
// Only rendered for users where `useAuthRoles().isSuperAdmin`
// is true; everyone else sees nothing.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Crown, Building2, ChevronDown, Check, Globe2 } from "lucide-react";
import { useAuthRoles } from "@/lib/auth-roles";
import { useAdminScope } from "@/lib/admin-scope";
import { supabase } from "@/integrations/supabase/client";

import { useTranslation } from "react-i18next";
type Org = { id: string; name: string };

export function PlatformSwitcher() {
  const { t } = useTranslation();

  const { isSuperAdmin, loaded } = useAuthRoles();
  const orgId = useAdminScope((s) => s.orgId);
  const setOrgId = useAdminScope((s) => s.setOrgId);
  const navigate = useNavigate();
  const location = useLocation();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded || !isSuperAdmin) return;
    (async () => {
      const { data } = await supabase.from("organizations").select("id,name").order("name");
      setOrgs((data ?? []) as Org[]);
    })();
  }, [loaded, isSuperAdmin]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!loaded || !isSuperAdmin) return null;

  const onPlatformRoute =
    location.pathname === "/platform-hub" || location.pathname.startsWith("/platform-hub/");
  const activeOrg = onPlatformRoute ? null : (orgs.find((o) => o.id === orgId) ?? null);

  const gotoPlatform = () => {
    setOrgId(null);
    setOpen(false);
    navigate({ to: "/platform-hub/dashboard" });
  };

  const gotoOrg = (id: string) => {
    setOrgId(id);
    setOpen(false);
    navigate({ to: "/settings" });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-warning hover:bg-warning/15 transition"
      >
        <Crown className="size-4 text-warning shrink-0" />
        <div className="flex flex-col leading-tight text-left min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-warning">Super Admin</span>
          <span className="text-sm font-semibold truncate max-w-[180px]">
            {activeOrg ? activeOrg.name : "Platform Hub"}
          </span>
        </div>
        <ChevronDown
          className={`size-4 text-warning shrink-0 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className="absolute top-full mt-2 start-0 z-40 w-[280px] max-w-[calc(100vw-2rem)] rounded-xl bg-popover text-popover-foreground border border-border shadow-2xl overflow-hidden"
          role="listbox"
        >
          <div className="px-3 py-2 border-b border-border text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
            {t("platformswitcher.switch_context")}
          </div>
          <button
            onClick={gotoPlatform}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition ${!orgId ? "bg-accent/50" : ""}`}
          >
            <Globe2 className="size-4 text-brand shrink-0" />
            <div className="flex-1 text-left">
              <div className="font-semibold">Platform Hub</div>
              <div className="text-[11px] text-muted-foreground">Global — cross-tenant admin</div>
            </div>
            {(onPlatformRoute || !orgId) && <Check className="size-4 text-brand shrink-0" />}
          </button>
          <div className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-t border-border">
            {t("platformswitcher.org_workspaces")}
          </div>
          <div className="max-h-[50vh] overflow-y-auto py-1">
            {orgs.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                {t("platformswitcher.no_organizations_yet")}
              </div>
            ) : (
              orgs.map((o) => {
                const active = o.id === orgId;
                return (
                  <button
                    key={o.id}
                    onClick={() => gotoOrg(o.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition ${active ? "bg-accent/50" : ""}`}
                  >
                    <Building2 className="size-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-left truncate">{o.name}</span>
                    {active && <Check className="size-4 text-brand shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
