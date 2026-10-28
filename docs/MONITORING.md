# Uptime monitoring and fallback plan (X25)

## Health endpoint

`GET https://<app>/api/health` (no session needed, no secrets in the answer):

```json
{"status":"ok","app":"up","uptime_s":5231,"db":"up","db_ms":12,"auth":"up","checked_at":"..."}
```

- `200` — the app answers, PostgREST reached the database (`public.health_check()`)
  and GoTrue answered.
- `503` with `"status":"degraded"` — the app is up but the database or Auth is not.
- no answer / timeout — the app (bun process / nginx) is down.

Needs `db/pending/195_platform.sql` (creates `health_check()`); before that, `db`
reports `down`.

## Monitor setup (any uptime service: UptimeRobot, Better Stack, Healthchecks.io…)

| Check | Target | Interval | Alert when |
|-------|--------|----------|------------|
| App + DB | `https://<app>/api/health`, expect HTTP 200 and body contains `"status":"ok"` | 1 min | 2 failures in a row |
| API gateway | `https://<api-host>/auth/v1/health` with header `apikey: <anon key>` | 5 min | 2 failures |
| TLS certificate | `<app>` and `<api-host>` | daily | expires in < 14 days |
| Backup heartbeat | heartbeat URL called by `kwalis-backup.sh` (docs/BACKUP_RESTORE.md) | daily, 2 h grace | no ping |
| Notification dispatcher | heartbeat called by the cron after `notifications-dispatch` | 10 min | no ping for 30 min |

Alert channels: the developer's phone (push/SMS) and e-mail, plus the Techno Masr
support address. Keep the list in the monitoring service, not in this repo.

On the server itself, add `Restart=always` and `RestartSec=5` to `kwalis.service`
so a crashed app process comes back on its own, and `docker compose` services use
`restart: unless-stopped` (default in the Supabase compose file).

## When it goes down — fallback plan

1. **App down, DB up** (`/api/health` no answer, `/auth/v1/health` ok):
   `systemctl status kwalis` → `journalctl -u kwalis -n 200` → `systemctl restart kwalis`.
   If a new deploy caused it: `git checkout <previous tag> && bun run build && systemctl restart kwalis`.
2. **DB / Auth down** (`503 degraded`): `docker compose ps` in `/opt/kwalis-supabase`,
   `docker compose logs db --tail 200`, `docker compose restart db rest auth`.
   Check disk space first (`df -h`) — a full disk is the usual cause.
3. **Server down**: provision a new server from `docs/SELF_HOSTED_SUPABASE.md`,
   restore the last backup (`docs/BACKUP_RESTORE.md` §5), point DNS at it.
   Expected recovery time: half a day; data loss: up to the last daily backup.
4. Tell users: a short status message (WhatsApp group / e-mail) when an outage
   is longer than 15 minutes, and again when it is over.
5. After any outage: one paragraph in the incident log — what happened, how long,
   what changes.

## Cron entries on the server

```cron
* * * * *  curl -fsS -m 50 -X POST https://<app>/api/public/notifications-dispatch -H "X-Job-Secret: $NOTIFY_DISPATCH_SECRET" && curl -fsS -m 10 "$DISPATCH_HEARTBEAT_URL" >/dev/null
15 2 * * * /usr/local/sbin/kwalis-backup.sh >> /var/log/kwalis-backup.log 2>&1
```
