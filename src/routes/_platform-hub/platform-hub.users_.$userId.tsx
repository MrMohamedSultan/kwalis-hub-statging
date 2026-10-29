// ═══════════════════════════════════════════════════════════════════
// Platform Hub → single user detail / edit page
// Reached from the Users list or a Company profile's USERS card.
// ═══════════════════════════════════════════════════════════════════
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ArrowLeft, Save, ShieldAlert, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const searchSchema = z.object({
  from: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_platform-hub/platform-hub/users_/$userId")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "User Profile · Kwalis HUB" },
      {
        name: "description",
        content: "Review and edit a platform user's profile details and organization role.",
      },
      { property: "og:title", content: "User Profile · Kwalis HUB" },
      {
        property: "og:description",
        content: "Review and edit a platform user's profile details and organization role.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlatformUserDetailPage,
});

const ORG_ROLES = ["owner", "admin", "member"] as const;

const profileSchema = z.object({
  display_name: z.string().trim().min(1, "closeout.ui.usr.err_name").max(120),
  job_title: z.string().trim().max(60, "closeout.ui.usr.err_title"),
  org_role: z.enum(ORG_ROLES).optional(),
});

const fieldClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand";
const labelClass = "block text-xs font-semibold uppercase tracking-wider text-muted-foreground";

type Membership = { id: string; role: string; organization_id: string; org_name: string | null };

function PlatformUserDetailPage() {
  const { t } = useTranslation();

  const { userId } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [orgRole, setOrgRole] = useState<string>("member");
  const [baseline, setBaseline] = useState({ displayName: "", jobTitle: "", orgRole: "member" });
  const [discardOpen, setDiscardOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const dirty = useMemo(
    () =>
      displayName !== baseline.displayName ||
      jobTitle !== baseline.jobTitle ||
      orgRole !== baseline.orgRole,
    [displayName, jobTitle, orgRole, baseline],
  );
  useUnsavedChangesWarning(dirty);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("id, display_name, job_title")
          .eq("id", userId)
          .maybeSingle();
        if (error) throw error;
        if (!active) return;
        if (!profile) {
          setMissing(true);
          return;
        }
        setDisplayName(profile.display_name ?? "");
        setJobTitle(profile.job_title ?? "");
        setBaseline({
          displayName: profile.display_name ?? "",
          jobTitle: profile.job_title ?? "",
          orgRole: "member",
        });

        const { data: rows } = await supabase
          .from("organization_members")
          .select("id, role, organization_id")
          .eq("user_id", userId);
        const row = (rows ?? []).find((r) => (from ? r.organization_id === from : true)) ?? null;
        if (!row) {
          if (active) setMembership(null);
          return;
        }
        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", row.organization_id)
          .maybeSingle();
        if (!active) return;
        setMembership({ ...row, org_name: org?.name ?? null });
        setOrgRole(row.role);
        setBaseline((b) => ({ ...b, orgRole: row.role }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("closeout.ui.usr.load_failed"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, from]);

  const leave = useCallback(() => {
    if (from) {
      navigate({ to: "/platform-hub/companies/$companyId", params: { companyId: from } });
    } else {
      navigate({ to: "/platform-hub/users" });
    }
  }, [from, navigate]);

  function goBack() {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    leave();
  }

  async function removeMembership() {
    if (!membership) return;
    setRemoving(true);
    try {
      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("id", membership.id);
      if (error) throw error;
      toast.success(t("hub_users_userid.user_removed_from_company"));
      setRemoveOpen(false);
      leave();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("closeout.ui.usr.remove_failed"));
    } finally {
      setRemoving(false);
    }
  }

  async function save() {
    const parsed = profileSchema.safeParse({
      display_name: displayName,
      job_title: jobTitle,
      org_role: membership ? (orgRole as (typeof ORG_ROLES)[number]) : undefined,
    });
    if (!parsed.success) {
      // zod messages are i18n keys (D19)
      toast.error(t(parsed.error.issues[0]?.message ?? "closeout.ui.usr.check_form"));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: parsed.data.display_name,
          job_title: parsed.data.job_title === "" ? null : parsed.data.job_title,
        } as never)
        .eq("id", userId);
      if (error) throw error;

      if (membership && parsed.data.org_role && parsed.data.org_role !== membership.role) {
        const { error: roleError } = await supabase
          .from("organization_members")
          .update({ role: parsed.data.org_role } as never)
          .eq("id", membership.id);
        if (roleError) throw roleError;
        setMembership({ ...membership, role: parsed.data.org_role });
      }
      setBaseline({
        displayName: parsed.data.display_name,
        jobTitle: parsed.data.job_title,
        orgRole: parsed.data.org_role ?? baseline.orgRole,
      });
      setDisplayName(parsed.data.display_name);
      setJobTitle(parsed.data.job_title);
      toast.success(t("hub_users_userid.user_updated"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("closeout.ui.co.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">{t("closeout.ui.usr.loading")}</div>;
  }

  if (missing) {
    return (
      <div className="p-8 space-y-4">
        <div className="text-sm text-muted-foreground">
          {t("hub_users_userid.this_user_profile_no_longer_exists")}
        </div>
        <button
          type="button"
          onClick={goBack}
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
        >
          {t("hub_users_userid.go_back")}
        </button>
      </div>
    );
  }

  return (
    <div className="p-5 sm:p-8 space-y-6">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {from
          ? t("closeout.ui.usr.back_to", {
              name: membership?.org_name ?? t("closeout.ui.usr.the_company"),
            })
          : t("closeout.ui.usr.all_users")}
      </button>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <UserRound className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {displayName || t("closeout.ui.usr.unnamed")}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {membership?.org_name ? `${membership.org_name} · ` : ""}
              {jobTitle || t("closeout.ui.usr.no_title")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-4 py-2 text-sm font-semibold hover:brightness-110 transition disabled:opacity-60"
        >
          <Save className="size-4" />{" "}
          {saving ? t("closeout.ui.saving") : t("closeout.ui.save_changes")}
        </button>
      </header>

      <section className="max-w-xl rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          {t("hub_users_userid.profile_details")}
        </h2>
        <label className="block space-y-1.5">
          <span className={labelClass}>{t("closeout.ui.usr.full_name")}</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className={labelClass}>
            {t("closeout.ui.hub_job_title")}{" "}
            <span className="font-normal normal-case">({t("common.optional")})</span>
          </span>
          <input
            value={jobTitle}
            maxLength={60}
            placeholder={t("hub_users_userid.eg_producer_line_producer")}
            onChange={(e) => setJobTitle(e.target.value)}
            className={fieldClass}
          />
        </label>
        {membership ? (
          <label className="block space-y-1.5">
            <span className={labelClass}>
              {t("closeout.ui.usr.company_role")}{" "}
              {membership.org_name ? `· ${membership.org_name}` : ""}
            </span>
            <select
              value={orgRole}
              onChange={(e) => setOrgRole(e.target.value)}
              className={fieldClass}
            >
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`closeout.ui.usr.role.${r}`)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("hub_users_userid.this_user_is_not_a_member_of_any")}
          </p>
        )}
      </section>

      {membership ? (
        <section className="max-w-xl rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-destructive">
            <ShieldAlert className="size-4" />
            {t("hub_users_userid.danger_zone")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("closeout.ui.usr.remove_explain", {
              name: membership.org_name ?? t("closeout.ui.usr.this_company"),
            })}
          </p>
          <button
            type="button"
            onClick={() => setRemoveOpen(true)}
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/20 transition"
          >
            {t("hub_users_userid.remove_from_company")}
          </button>
        </section>
      ) : null}

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("closeout.ui.usr.remove_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("closeout.ui.usr.remove_confirm", {
                user: displayName || t("closeout.ui.usr.this_user"),
                name: membership?.org_name ?? t("closeout.ui.usr.this_company"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(e) => {
                e.preventDefault();
                void removeMembership();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? t("closeout.ui.usr.removing") : t("closeout.ui.usr.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("closeout.ui.usr.discard_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("hub_users_userid.you_have_unsaved_edits_on_this_profile_leaving")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("hub_users_userid.keep_editing")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscardOpen(false);
                leave();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("hub_users_userid.discard_changes")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
