# Option B: Kwalis HUB with self-hosted Supabase on the Techno Masr server

Goal: run `kwalis.technomasr.com` **completely on our server**, against a copy of the
client's data (`kwalishub_261015.backup`, approved by the client), with all the changes
from this repo (`main`), and never touching the production Supabase project
`lzthslbcipamsrephfgp`.

```
browser ──► kwalis.technomasr.com      (nginx → bun app, 127.0.0.1:3080)
        └─► kwalis-api.technomasr.com  (nginx → Supabase Kong, 127.0.0.1:8000)
                                         ├─ auth (GoTrue)    login
                                         ├─ rest (PostgREST) data + RLS
                                         ├─ storage
                                         └─ db (Postgres)    ← restored backup + db/pending
```

The app does **not** talk to Postgres directly. It needs Supabase's Auth, REST and Storage
APIs, which is why a plain PostgreSQL database (`techsjsm_kwalis_hub`) is not enough. That
database can be dropped at the end.

Report the exact commands and their output after each step. Stop and report on any error.
Do not improvise workarounds that change the schema.

---

## 0. Prerequisites (owner)

- DNS: an `A` record `kwalis-api.technomasr.com` → server IP, next to `kwalis.technomasr.com`.
- Server resources: at least 4 GB RAM and 10 GB of free disk.
- Rotate the `root` and `techsjsm` passwords. They are stored in plain text in old helper scripts.

## 1. Install Docker

```bash
docker --version && docker compose version || {
  dnf -y install dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
}
```

## 2. Self-hosted Supabase

```bash
mkdir -p /opt/kwalis-supabase && cd /opt/kwalis-supabase
git clone --depth 1 https://github.com/supabase/supabase.git src
cp -r src/docker/* . && cp src/docker/.env.example .env
```

Edit `.env`:

- `POSTGRES_PASSWORD`, `JWT_SECRET` (40+ chars), `DASHBOARD_USERNAME/PASSWORD`, plus every other
  secret marked "change me": generate new random values.
- `ANON_KEY` and `SERVICE_ROLE_KEY`: generate them from `JWT_SECRET` as described in the
  Supabase self-hosting docs ("Generate API keys").
- `SITE_URL=https://kwalis.technomasr.com`
- `API_EXTERNAL_URL=https://kwalis-api.technomasr.com`
- `SUPABASE_PUBLIC_URL=https://kwalis-api.technomasr.com`
- `ENABLE_EMAIL_AUTOCONFIRM=true` (no SMTP on this test server).
- `DISABLE_SIGNUP=true` (only the restored accounts can sign in).
- **Port clash:** host PostgreSQL 17 already uses 5432. Change `POSTGRES_PORT` (and the pooler
  ports) in `.env`, e.g. 54322 / 64322, and bind everything to `127.0.0.1` only.

```bash
docker compose pull && docker compose up -d && docker compose ps     # all services healthy
```

Do not expose Studio (port 8000 path `/`, dashboard) to the internet without the basic-auth password.

## 3. Restore the client's data

The backup was made by PostgreSQL 17 / pg_dump 18. Use the **host's** `pg_restore` (17 or newer)
to turn it into plain SQL, then run that SQL inside the Supabase db container as the superuser
`supabase_admin`.

```bash
B=/home/techsjsm/kwalishub_261015.backup
W=/opt/kwalis-supabase/restore && mkdir -p $W && cd $W
PGR=$(ls /usr/pgsql-1[78]/bin/pg_restore 2>/dev/null | tail -1); $PGR --version

# a) user accounts (auth.users + auth.identities), data only
$PGR --data-only -n auth -t users -t identities -f auth_data.sql $B
# b) the whole public schema: tables, functions, views, RLS policies, grants, data
$PGR -n public --no-owner -f public.sql $B

DB="docker exec -i supabase-db psql -v ON_ERROR_STOP=0 -U supabase_admin -d postgres"
$DB -c "SET session_replication_role = replica;" -f - < auth_data.sql 2>&1 | grep -E "ERROR" | head -20
$DB < public.sql 2>&1 | grep -E "ERROR" | sort | uniq -c | head -40
```

Expected harmless errors: `transaction_timeout`, `privilege type "maintain"` (PostgreSQL 17-only
settings). If `auth_data.sql` fails because columns don't match, report the error. Do not drop
columns.

Check:

```bash
docker exec supabase-db psql -U supabase_admin -d postgres -Atc "
select 'users',count(*) from auth.users union all
select 'projects',count(*) from public.projects union all
select 'budget_lines',count(*) from public.budget_lines union all
select 'views', count(*) from pg_views where schemaname='public'"
```

Expected: 11 users, 7 projects, 2692 budget lines, 14 views.

## 4. Apply this repo's database changes

```bash
cd /home/techsjsm/kwalis_staging && git pull
for f in db/pending/*.sql; do
  echo "== $f"
  docker exec -i supabase-db psql -v ON_ERROR_STOP=1 --single-transaction -U supabase_admin -d postgres < "$f" || break
done
docker exec supabase-db psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';"
```

All 18 files must print `== …` with no error. They were tested on a copy of this exact backup.

## 5. nginx for the API

New vhost `kwalis-api.technomasr.com` → `proxy_pass http://127.0.0.1:8000;` with SSL (same
certificate method as `kwalis.technomasr.com`), `proxy_set_header Host $host;`, websocket
upgrade headers, and `client_max_body_size 50m;`.
Test: `curl -s https://kwalis-api.technomasr.com/auth/v1/health -H "apikey: <ANON_KEY>"` → JSON.

## 6. Build and run the app against it

```bash
cd /home/techsjsm/kwalis_staging
cat > .env <<'EOF'
VITE_SUPABASE_PROJECT_ID="kwalis-selfhosted"
VITE_SUPABASE_URL="https://kwalis-api.technomasr.com"
VITE_SUPABASE_PUBLISHABLE_KEY="<ANON_KEY>"
SUPABASE_PROJECT_ID="kwalis-selfhosted"
SUPABASE_URL="https://kwalis-api.technomasr.com"
SUPABASE_PUBLISHABLE_KEY="<ANON_KEY>"
EOF
bun install && NITRO_PRESET=node-server bun run build
```

`kwalis.service`: `WorkingDirectory=/home/techsjsm/kwalis_staging`,
`EnvironmentFile=/home/techsjsm/kwalis_staging/.env`, plus a separate
`Environment=SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>`. The service-role key is used only by the
server for admin actions (disable user, force logout…). Never put it in `.env` with a `VITE_`
prefix. Then `systemctl daemon-reload && systemctl restart kwalis`.

## 7. Acceptance

1. https://kwalis.technomasr.com → log in with a restored account (same password as production).
2. The top bar shows the logout button next to the language toggle; switch to Arabic.
3. Project MON26: total budget **17,339,576.48 SAR**, actual **243,039.47 SAR**.
4. `grep -r lzthslbcipamsrephfgp /home/techsjsm/kwalis_staging/.output | wc -l` → **0**
   (no trace of production in the build).

## Known limits on this server

- Uploaded attachments (invoices, contracts…) live in production Storage, not in the database
  backup. Their links will not open here.
- AI features that use Lovable's gateway (`LOVABLE_API_KEY`) are off.
- No e-mail is sent (no SMTP), so password-reset mails don't arrive. Reset passwords in Studio if needed.
- Restored accounts keep their production passwords. Treat this server as holding real client data.
