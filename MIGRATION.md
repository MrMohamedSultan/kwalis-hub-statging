# Migration Guide — Lovable Cloud → Vercel + Standalone Supabase

This project can be moved off Lovable Cloud while continuing to be edited
from Lovable. GitHub stays the source of truth; Vercel deploys automatically;
a standalone Supabase project holds the database, storage, and auth.

```text
Edit in Lovable  →  GitHub (auto-sync)  →  Vercel (auto-deploy)
                                              │
                                              ▼
                                   Standalone Supabase project
                                   (DB + Storage + Auth)
```

---

## Phase 1 — Create the standalone Supabase project

1. Sign up at https://supabase.com and create a new project.
   Pick the region closest to your users (Frankfurt / Bahrain / etc).
2. In **Project Settings → API**, copy:
   - `Project URL` (e.g. `https://abcd.supabase.co`)
   - `anon / publishable key`
   - `service_role key` (server-only)
3. Enable Auth providers under **Authentication → Providers**:
   - Email/Password
   - Google (paste your OAuth client ID + secret)
4. Create Storage buckets under **Storage → New bucket** (both private):
   - `contracts`
   - `support-attachments`

## Phase 2 — Export data from Lovable Cloud

Ask Lovable support (or use **Cloud → Advanced settings → Export data**)
to obtain the DB connection string for the current Cloud project. Then:

```bash
export SOURCE_DB_URL="postgres://postgres:PASS@HOST:6543/postgres"
bash scripts/export-cloud.sh
```

This produces `migration-export/schema.sql`, `data.sql`, and `auth-users.sql`.

Import them into the new Supabase project via **SQL Editor**, in this order:

1. `schema.sql` — tables, RLS policies, functions, triggers
2. `data.sql` — row data (34 tables including seeded demo)
3. `auth-users.sql` — existing users (passwords stay hashed and functional)

For Storage files, install the Supabase CLI and run:

```bash
supabase login
supabase storage cp --recursive \
  --source-project=<OLD_REF> --target-project=<NEW_REF> \
  contracts contracts
supabase storage cp --recursive \
  --source-project=<OLD_REF> --target-project=<NEW_REF> \
  support-attachments support-attachments
```

## Phase 3 — Deploy to Vercel

1. Ensure the project is synced to GitHub (Lovable → `+` menu → GitHub).
2. Go to https://vercel.com → **Add New → Project** → select the repo.
3. Framework preset: **Vite**.
4. Add Environment Variables (Production + Preview + Development):

   ```
   VITE_SUPABASE_URL              = https://NEW-REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY  = sb_publishable_...
   VITE_SUPABASE_PROJECT_ID       = NEW-REF
   SUPABASE_URL                   = https://NEW-REF.supabase.co
   SUPABASE_PUBLISHABLE_KEY       = sb_publishable_...
   SUPABASE_SERVICE_ROLE_KEY      = sb_secret_...
   SUPABASE_PROJECT_ID            = NEW-REF
   LOVABLE_API_KEY                = (optional — only if using Lovable AI)
   ```

5. Deploy. Vercel will build with `bun run build` and serve from `.output/public`.
6. Move the custom domain (`kwalishub.com`, `www.kwalishub.com`) from Lovable
   to Vercel:
   - In Lovable: Project Settings → Domains → remove the custom domain.
   - In Vercel: Project Settings → Domains → add both `kwalishub.com` and
     `www.kwalishub.com`. Follow the DNS instructions Vercel shows.

## Phase 4 — Ongoing workflow

- **Editing code:** keep using Lovable. Every commit auto-syncs to GitHub,
  Vercel picks it up, and a new build ships in ~1 min.
- **Schema changes:** run new SQL directly in the standalone Supabase SQL
  editor. The Lovable migration tool no longer applies to this project.
- **Lovable Cloud project:** you can leave it inactive, or disable billing
  from Cloud settings once traffic has fully moved to Vercel.
- **Lovable AI (`LOVABLE_API_KEY`):** still works — it's an external service
  independent of Cloud. Keep the secret in Vercel if you rely on it.

## Notes & caveats

- **RLS policies** are included in `schema.sql`. Spot-check a handful of
  tables (`payment_requests`, `notifications`, `projects`) after import —
  every table you use should reject anonymous reads unless a policy allows.
- **`SECURITY DEFINER` functions** (`has_role`, `can_access_project`,
  `handle_new_user`, `log_audit_history`, `seed_demo_data`, etc.) come with
  the schema. Verify each is `OWNER = postgres` and search_path is `public`.
- **Google OAuth redirect URIs:** in Google Cloud Console, add the new
  Supabase project's callback URL:
  `https://NEW-REF.supabase.co/auth/v1/callback`.
- **Realtime / Storage / Edge Functions:** the new project inherits the
  standard Supabase quotas — you may need a paid Supabase plan for
  production traffic.
- **Rollback:** if anything is missing, keep the Lovable Cloud project alive
  for at least 2 weeks after switchover. Since env vars are the only glue,
  you can point Vercel back at Cloud in seconds.
