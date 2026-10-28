# Backup and restore — self-hosted server (X04)

Target: the self-hosted Supabase stack described in `docs/SELF_HOSTED_SUPABASE.md`
(container `supabase-db`, Storage files under the stack's `volumes/storage`).
Goal: **daily, encrypted** backups kept off the server, and a **restore that is
actually tested** every month on a scratch database.

Nothing here was run from this repo — these are the steps for the server owner.

## 1. What is backed up

| Part | How | Why |
|------|-----|-----|
| Database (all schemas: `public`, `auth`, `storage` metadata) | `pg_dump -Fc` | Data, users, RLS policies, functions |
| Storage files (`volumes/storage/`) | `tar` | Uploaded invoices, contracts, receipts |
| Config (`/opt/kwalis-supabase/.env`, app `.env`, nginx vhosts, systemd units) | `tar` | Rebuild the server |

Secrets in the config archive are why every archive is encrypted.

## 2. One-time setup

```bash
# backup user + folders
useradd -r -m -d /var/backups/kwalis kwbackup
install -d -m 700 -o kwbackup /var/backups/kwalis/daily

# encryption key: an age key pair. The PRIVATE key is NOT kept on the server:
# store it in the company password manager (two people) and print a paper copy.
age-keygen -o kwalis-backup.key          # on an admin laptop
grep 'public key' kwalis-backup.key      # → age1...
echo 'age1...' > /var/backups/kwalis/recipient.txt   # on the server (public key only)
```

(`gpg --symmetric --cipher-algo AES256` with a passphrase file is an acceptable
alternative if `age` cannot be installed.)

## 3. Daily job — `/usr/local/sbin/kwalis-backup.sh`

```bash
#!/bin/bash
set -euo pipefail
TS=$(date -u +%Y%m%d-%H%M)
OUT=/var/backups/kwalis/daily
R=/var/backups/kwalis/recipient.txt

docker exec supabase-db pg_dump -U supabase_admin -d postgres -Fc --no-owner \
  | age -R "$R" > "$OUT/db-$TS.dump.age"

tar -C /opt/kwalis-supabase -czf - volumes/storage \
  | age -R "$R" > "$OUT/storage-$TS.tgz.age"

tar -czf - /opt/kwalis-supabase/.env /home/techsjsm/kwalis_staging/.env \
  /etc/nginx/conf.d /etc/systemd/system/kwalis.service 2>/dev/null \
  | age -R "$R" > "$OUT/config-$TS.tgz.age"

sha256sum "$OUT"/*-"$TS".* > "$OUT/SHA256SUMS-$TS"

# copy off the server (any S3-compatible bucket or a second server)
rclone copy "$OUT" kwalis-offsite:kwalis-backups/daily --include "*$TS*"

# keep 14 daily copies locally; the offsite bucket keeps 30 daily + 12 monthly (lifecycle rule)
find "$OUT" -type f -mtime +14 -delete

# tell the monitor the backup ran (see docs/MONITORING.md, heartbeat check)
curl -fsS -m 10 "${BACKUP_HEARTBEAT_URL:-}" >/dev/null || true
```

```bash
chmod 700 /usr/local/sbin/kwalis-backup.sh
# root crontab — 02:15 Riyadh time every day
15 2 * * * /usr/local/sbin/kwalis-backup.sh >> /var/log/kwalis-backup.log 2>&1
```

A failed run sends no heartbeat, so the monitor alerts the developer.

## 4. Restore test — every month (and after any schema change)

Never restore over the live database. Use a scratch database in the same container.

```bash
KEY=~/kwalis-backup.key            # private key, brought in for the test only
F=$(ls -t /var/backups/kwalis/daily/db-*.dump.age | head -1)
sha256sum -c /var/backups/kwalis/daily/SHA256SUMS-$(basename "$F" | sed 's/db-\(.*\)\.dump\.age/\1/')

age -d -i "$KEY" "$F" > /tmp/restore.dump
docker exec supabase-db psql -U supabase_admin -d postgres -c "DROP DATABASE IF EXISTS restore_test"
docker exec supabase-db psql -U supabase_admin -d postgres -c "CREATE DATABASE restore_test"
docker exec -i supabase-db pg_restore -U supabase_admin -d restore_test --no-owner < /tmp/restore.dump

# checks: counts must match the live database at backup time (± the day's activity)
docker exec supabase-db psql -U supabase_admin -d restore_test -Atc "
select 'users',count(*) from auth.users union all
select 'projects',count(*) from public.projects union all
select 'budget_lines',count(*) from public.budget_lines union all
select 'invoices',count(*) from public.invoices union all
select 'payments',count(*) from public.payments union all
select 'policies',count(*) from pg_policies where schemaname='public'"

# storage archive opens and lists files
age -d -i "$KEY" $(ls -t /var/backups/kwalis/daily/storage-*.age | head -1) | tar -tzf - | head

docker exec supabase-db psql -U supabase_admin -d postgres -c "DROP DATABASE restore_test"
shred -u /tmp/restore.dump; rm -f "$KEY"
```

Write the date, the backup file, the counts and who ran it in the restore log
(`docs/restore-log` in the company drive). A test that is not logged did not happen.

## 5. Real restore (disaster)

1. Stop the app: `systemctl stop kwalis`.
2. Decrypt the chosen `db-*.dump.age` as above.
3. `docker exec -i supabase-db pg_restore -U supabase_admin -d postgres --clean --if-exists --no-owner < restore.dump`
4. Restore files: `age -d -i KEY storage-*.tgz.age | tar -C /opt/kwalis-supabase -xzf -`
5. `docker exec supabase-db psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';"`
6. Re-apply any `db/pending` file newer than the backup.
7. Start the app, open `/api/health`, sign in with a test account, check one project's totals.

Recovery point: up to 24 h of data. If that is too much, add WAL archiving
(`archive_mode=on` + `wal-g`) — not set up yet.
