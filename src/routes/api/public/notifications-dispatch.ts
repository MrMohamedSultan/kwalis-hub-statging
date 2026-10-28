import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * X24 / D04 — cron endpoint (every minute or so, from the server's crontab):
 *
 *   curl -fsS -X POST https://<app>/api/public/notifications-dispatch \
 *        -H "X-Job-Secret: $NOTIFY_DISPATCH_SECRET"
 *
 * 1. runs the overspend check for every live project (public.run_budget_alerts),
 * 2. sends the queued notification e-mails (public.notification_email_outbox).
 *
 * Public route (no user session) → the shared secret is checked first, in
 * constant time. Without e-mail settings the queue is left untouched.
 * Env (read here only): NOTIFY_DISPATCH_SECRET, SUPABASE_SERVICE_ROLE_KEY,
 * APP_BASE_URL, MAIL_* / SMTP_* (see src/lib/email/mailer.server.ts).
 */
const BodySchema = z
  .object({ limit: z.number().int().min(1).max(100).optional() })
  .strict()
  .optional();

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

type OutboxRow = { id: string; to_email: string; subject: string; body: string };

export const Route = createFileRoute("/api/public/notifications-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.NOTIFY_DISPATCH_SECRET;
        if (!secret) return Response.json({ error: "not configured" }, { status: 503 });
        if (!safeEqual(request.headers.get("X-Job-Secret") ?? "", secret)) {
          return new Response("Unauthorized", { status: 401 });
        }
        let raw: unknown = undefined;
        const text = await request.text();
        if (text.length > 1000) return Response.json({ error: "body too large" }, { status: 413 });
        if (text.trim()) {
          try {
            raw = JSON.parse(text);
          } catch {
            return Response.json({ error: "invalid JSON" }, { status: 400 });
          }
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
        const limit = parsed.data?.limit ?? 20;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const admin = supabaseAdmin as any;
        const { mailerConfigFromEnv, sendMail } = await import("@/lib/email/mailer.server");
        const { notificationEmailText } = await import("@/lib/email/mime");

        const alerts = await admin.rpc("run_budget_alerts", { _project: null });
        const cfg = mailerConfigFromEnv();
        if (!cfg) {
          return Response.json({
            alerts: alerts.error ? null : alerts.data,
            email: "not configured",
            sent: 0,
          });
        }

        const claimed = await admin.rpc("claim_notification_emails", { _limit: limit });
        if (claimed.error) return Response.json({ error: "queue unavailable" }, { status: 500 });
        const rows = (claimed.data ?? []) as OutboxRow[];
        let sent = 0;
        let failed = 0;
        for (const row of rows) {
          try {
            await sendMail(cfg, {
              to: row.to_email,
              subject: row.subject,
              text: notificationEmailText({
                body: row.body,
                appUrl: process.env.APP_BASE_URL ?? null,
              }),
            });
            await admin.rpc("mark_notification_email", { _id: row.id, _ok: true, _error: null });
            sent++;
          } catch (e) {
            failed++;
            await admin.rpc("mark_notification_email", {
              _id: row.id,
              _ok: false,
              _error: e instanceof Error ? e.message.slice(0, 200) : "send failed",
            });
          }
        }
        return Response.json({ alerts: alerts.error ? null : alerts.data, sent, failed });
      },
    },
  },
});
