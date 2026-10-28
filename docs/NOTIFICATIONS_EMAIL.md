# Notification e-mails and overspend alerts (X24 / D04)

## How it works

1. The database creates in-app notifications (`public.notifications`):
   - approvals: a request waiting for you, approved, rejected, paid, cancelled
     (`db/pending/176`);
   - overspend: `public.run_budget_alerts()` (195) when Actual + Commitment of a
     budget code reaches **80 %** and **100 %** of its budget — once per crossing,
     re-armed when the code drops back under the threshold.
2. A trigger (195) queues an e-mail for each of those notifications in
   `public.notification_email_outbox`, to the recipient's sign-in address.
3. The cron calls `POST /api/public/notifications-dispatch` every minute
   (header `X-Job-Secret`). It runs the overspend check for all live projects,
   then sends up to 20 queued e-mails (5 attempts each, then `failed`).
4. The app also runs the overspend check for the open project every 5 minutes,
   so in-app alerts appear even without the cron.

Who gets overspend alerts: the people set in **Notifications → Overspend alert
recipients** (per code, or for all codes of the project; org admins only). When
nobody is set: the project owner and the organization owners/admins.

## Environment variables (server only — never `VITE_`)

| Variable | Example | Needed |
|----------|---------|--------|
| `NOTIFY_DISPATCH_SECRET` | 40+ random characters | yes, same value in the cron |
| `SUPABASE_SERVICE_ROLE_KEY` | (already used for admin actions) | yes |
| `MAIL_FROM` | `Kwalis HUB <noreply@kwalis.technomasr.com>` | yes |
| `MAIL_PROVIDER` | `smtp` (default) or `resend` | no |
| `SMTP_HOST` | `mail.technomasr.com` | for smtp |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (TLS) | for smtp |
| `SMTP_USER` / `SMTP_PASS` | mailbox login | for smtp |
| `RESEND_API_KEY` | | for resend |
| `APP_BASE_URL` | `https://kwalis.technomasr.com` | for the link in the mail |

Without `MAIL_FROM` + a provider the dispatcher still runs the alerts and leaves
the e-mails queued (nothing is lost; they go out once mail is configured).
The password is never sent over a connection without TLS.

The same SMTP account can be set in Supabase Auth (`SMTP_*` in the Supabase
`.env`) so password-reset and invitation e-mails arrive too.

## Not landing in spam

Set these DNS records for the domain in `MAIL_FROM` (values from the mail provider):

- **SPF**: `v=spf1 include:<provider> -all`
- **DKIM**: the provider's selector record, and signing enabled
- **DMARC**: `_dmarc` → `v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>`
- A real mailbox or alias for the `From` address, and reverse DNS on the sending IP
  if you send from your own server.

The messages are plain text, UTF-8, with a Message-ID on the sender's domain and
`Auto-Submitted: auto-generated` — no tracking pixels or link shorteners.

Test: send one approval to a Gmail and an Outlook address; "Show original" must
show `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
