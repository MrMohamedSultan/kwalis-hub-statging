# Deploying Kwalis HUB on a self-hosted test server

Use this guide to run the `main` branch of this repository on your own Linux server, for example
`kwalis.technomasr.com`.

## 1. Backend: never the production project

The app has no database layer of its own. It talks directly to a **Supabase** project
(Auth + PostgREST + Storage), so the values in `.env` decide which data you see and change.

| Supabase project id    | What it is                                    | Use for testing? |
| ---------------------- | --------------------------------------------- | ---------------- |
| `lzthslbcipamsrephfgp` | **PRODUCTION** (www.kwalishub.com, real data) | **NO — never**   |
| `zfycacfkkwcfmjrlxzgm` | Staging (Lovable remix, migrations applied)   | yes              |

A plain PostgreSQL database on the server is **not** used by the app. Restoring a backup into it
changes nothing in the app.

To get the staging values, open the Lovable staging project → Cloud / Project settings and copy
the **project URL** and the **publishable (anon) key**. Only the public key goes on the server.
Never put the service-role key there.

## 2. Build

```bash
git clone https://github.com/MrMohamedSultan/kwalis-hub-statging.git kwalis
cd kwalis
cat > .env <<'EOF'
VITE_SUPABASE_PROJECT_ID="zfycacfkkwcfmjrlxzgm"
VITE_SUPABASE_URL="https://zfycacfkkwcfmjrlxzgm.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<staging publishable key>"
SUPABASE_PROJECT_ID="zfycacfkkwcfmjrlxzgm"
SUPABASE_URL="https://zfycacfkkwcfmjrlxzgm.supabase.co"
SUPABASE_PUBLISHABLE_KEY="<staging publishable key>"
EOF
bun install
NITRO_PRESET=node-server bun run build      # standalone Node server in .output/
```

`NITRO_PRESET=node-server` replaces the old manual edit of `vite.config.ts`. Without it, the build
targets Vercel, which is what Lovable uses. Leave `vite.config.ts` as it is.

## 3. Run

```bash
PORT=3080 HOST=127.0.0.1 bun .output/server/index.mjs
```

For a systemd unit, use the same `ExecStart`, add `EnvironmentFile=/path/to/kwalis/.env`, and put
nginx in front as a reverse proxy to `127.0.0.1:3080`. The `.env` values are already baked into the
client bundle at build time, so after changing `.env` you must **rebuild**, not just restart.

## 4. Update to the latest changes

```bash
cd kwalis && git pull && bun install && NITRO_PRESET=node-server bun run build && sudo systemctl restart kwalis
```

## 5. Database changes

The SQL files in `db/pending/` (005 → 150) are already applied to the **staging** project. Do not
apply them to production without the owner's approval (see `SECURITY.md`).
