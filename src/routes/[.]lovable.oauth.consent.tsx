import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck, Check, X, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
// Beta namespace; keep a local wrapper so TS is happy.
type OAuthResult = {
  data: {
    client?: { name?: string; client_uri?: string; redirect_uris?: string[] } | null;
    scope?: string;
    redirect_url?: string;
    redirect_to?: string;
  } | null;
  error: { message: string } | null;
};
const oauth = (
  supabase.auth as unknown as {
    oauth: {
      getAuthorizationDetails(id: string): Promise<OAuthResult>;
      approveAuthorization(id: string): Promise<OAuthResult>;
      denyAuthorization(id: string): Promise<OAuthResult>;
    };
  }
).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen grid place-items-center p-6 text-foreground">
      <div className="max-w-md w-full rounded-2xl border border-destructive/40 bg-destructive/10 p-6">
        <div className="flex items-center gap-2 text-destructive font-semibold">
          <AlertTriangle className="size-5" />
          {i18n.t("lovable_oauth_consent.could_not_load_this_authorization_request")}
        </div>
        <div className="mt-2 text-sm text-destructive">
          {String((error as Error)?.message ?? error)}
        </div>
      </div>
    </main>
  ),
});

function Consent() {
  const { t } = useTranslation();

  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "an app";
  const redirectUri = details?.client?.redirect_uris?.[0];

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-background text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-brand mb-3">
          <ShieldCheck className="size-3.5" />
          {t("lovable_oauth_consent.authorize_access")}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Connect {clientName} to Kwalis HUB</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {clientName} will be able to call this app's enabled tools while you are signed in. This
          does not bypass Kwalis HUB permissions or backend policies.
        </p>

        {redirectUri && (
          <div className="mt-4 text-xs text-muted-foreground">
            <div className="uppercase tracking-widest font-semibold mb-1">
              {t("lovable_oauth_consent.redirect_uri")}
            </div>
            <div className="font-mono break-all bg-black/20 rounded-lg px-2 py-1">
              {redirectUri}
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-brand text-brand-foreground font-semibold py-2.5 text-sm shadow-lg shadow-brand/20 hover:brightness-110 transition disabled:opacity-60"
          >
            <Check className="size-4" /> Approve
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-transparent font-semibold py-2.5 text-sm hover:bg-muted transition disabled:opacity-60"
          >
            <X className="size-4" /> Deny
          </button>
        </div>
      </div>
    </main>
  );
}
