#!/usr/bin/env bash
# =====================================================================
# Kwalis Hub — staging deploy of the spec work (db/pending 171 → 204)
#
# Run on the self-hosted staging server ONLY, from the repo folder,
# AFTER the owner approved the SQL files listed in deploy/README_2026-10-28.md.
#
#   cd /home/techsjsm/kwalis_staging && git pull && bash deploy/apply_2026-10-28.sh
#
# What it does, in order (stops at the first error):
#   0. read-only pre-checks: storage.objects policy names, amounts with more
#      than 2 decimals on invoices / petty cash receipts (informational)
#   1. full backup of the database (custom format) into ~/kwalis_backups/
#   2. applies every new db/pending file in numeric order, each in one
#      transaction; after 200 and before 201 it STOPS if
#      project_org_mismatches() returns rows (201 updates those tables)
#   3. reloads the PostgREST schema cache
#   4. one-time backfills (only fill new columns / new ledger tables), then
#      ledger_resync_project for every project in ledger_projects
#      (decision 12: approved Exclusive instalments re-posted with the 7099 line)
#   5. prints checks: ledger phases match, project/org mismatches, person-profile preview
#   6. builds the app and restarts the service, then calls /api/health
# Not done here (owner step, see the README): moving the old contract files
# into project folders (Settings → Organization → Contract files).
# =====================================================================
set -euo pipefail

DB_CONTAINER=${DB_CONTAINER:-supabase-db}
PSQL="docker exec -i $DB_CONTAINER psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=${BACKUP_DIR:-$HOME/kwalis_backups}
# 171 → 203 are already recorded in kwalis_deploy.applied_files on the staging
# server and are skipped; 204 (close-out) is the new file.
FILES="171 172 174 176 180 182 184 190 195 196 197 198 199 200 201 202 203 204"

echo "== 0. pre-checks (read-only)"
echo "-- storage.objects policies (the contracts bucket rules 201 builds on):"
$PSQL -c "SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY 1;"
echo "-- amounts with more than 2 decimals (informational: 201 keeps them as stored and they stay editable / cancellable):"
$PSQL -c "SELECT 'invoices' AS table_name, count(*) AS rows_not_rounded
            FROM public.invoices
           WHERE price <> round(price, 2) OR vat_amount <> round(vat_amount, 2)
              OR wht_amount <> round(wht_amount, 2) OR net_payable <> round(net_payable, 2)
          UNION ALL
          SELECT 'cash_advance_receipts', count(*)
            FROM public.cash_advance_receipts
           WHERE amount <> round(amount, 2);"

echo "== 1. backup"
mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/kwalis-before-171-204-$STAMP.dump"
docker exec "$DB_CONTAINER" pg_dump -U supabase_admin -d postgres -Fc > "$BACKUP"
ls -lh "$BACKUP"

echo "== 2. apply pending SQL"
# Each file is recorded once applied, in a schema the API does not expose.
# A file already recorded is skipped: re-running an older file after a newer one
# can fail (e.g. a view that later files widened cannot be narrowed again).
$PSQL -q -c "CREATE SCHEMA IF NOT EXISTS kwalis_deploy;
             REVOKE ALL ON SCHEMA kwalis_deploy FROM PUBLIC;
             CREATE TABLE IF NOT EXISTS kwalis_deploy.applied_files (
               file text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"
# Servers where 171 → 200 were applied by the first run of this script (before the
# record existed): 200's function is there, so 171 → 200 are recorded as applied.
$PSQL -q -c "INSERT INTO kwalis_deploy.applied_files(file)
             SELECT f FROM unnest(ARRAY['171','172','174','176','180','182','184','190','195','196','197','198','199','200']) f
              WHERE to_regprocedure('public.project_org_mismatches()') IS NOT NULL
             ON CONFLICT DO NOTHING;"
for n in $FILES; do
  if [ "$($PSQL -At -c "SELECT count(*) FROM kwalis_deploy.applied_files WHERE file = '$n';")" != "0" ]; then
    echo "-- $n already applied, skipping"
    continue
  fi
  if [ "$n" = "201" ]; then
    # 201's backfill and repoint updates fire 200's project/organization trigger:
    # a row whose project belongs to another organization would abort 201.
    # Rows with an EMPTY organization_id are not a conflict: 200's trigger fills
    # the organization from the project on the next write. Only a row that names a
    # DIFFERENT organization than its project's blocks 201.
    NULL_ORG=$($PSQL -At -c "SELECT count(*) FROM public.project_org_mismatches() WHERE organization_id IS NULL;")
    echo "-- rows with an empty organization_id (filled from their project on next write, not a conflict): $NULL_ORG"
    MISMATCHES=$($PSQL -At -c "SELECT count(*) FROM public.project_org_mismatches() WHERE organization_id IS NOT NULL;")
    if [ "$MISMATCHES" != "0" ]; then
      echo "STOP: $MISMATCHES row(s) name a different organization than their project's — fix them before 201 (171 → 200 are applied):"
      $PSQL -c "SELECT * FROM public.project_org_mismatches() WHERE organization_id IS NOT NULL;"
      echo "Then run the script again: files already applied are skipped."
      exit 1
    fi
    echo "-- no real project/organization conflicts, continuing with 201"
  fi
  f=$(ls db/pending/${n}_*.sql)
  echo "-- $f"
  $PSQL --single-transaction < "$f" > "/tmp/kwalis-apply-$n.log" 2>&1 || {
    echo "FAILED on $f — nothing from this file was applied. Log:"; cat "/tmp/kwalis-apply-$n.log"; exit 1; }
  $PSQL -q -c "INSERT INTO kwalis_deploy.applied_files(file) VALUES ('$n') ON CONFLICT DO NOTHING;"
  grep -E "^(NOTICE|WARNING)" "/tmp/kwalis-apply-$n.log" | head -20 || true
done

echo "== 3. reload API schema"
$PSQL -c "NOTIFY pgrst, 'reload schema';"

echo "== 4. backfills"
$PSQL -c "SELECT count(*) AS numbered FROM public.backfill_document_refs();"
$PSQL -c "SELECT public.backfill_request_payments();"
$PSQL -c "SELECT p.code, public.ledger_backfill_project(p.id)
            FROM public.projects p
           WHERE NOT EXISTS (SELECT 1 FROM public.ledger_projects l WHERE l.project_id = p.id);"
echo "-- decision 12 (201): re-post the ledger of every initialised project (approved Exclusive instalments get their 7099 line)"
$PSQL -c "SELECT p.code, public.ledger_resync_project(p.id)
            FROM public.projects p JOIN public.ledger_projects l ON l.project_id = p.id ORDER BY 1;"

echo "== 5. checks"
$PSQL -c "SELECT p.code, public.ledger_phases_match(p.id) AS ledger_ok FROM public.projects p ORDER BY 1;"
$PSQL -c "SELECT * FROM public.project_org_mismatches();"
echo "-- 204: the board-approval limit must be empty (the app has no board approval action yet; a limit blocks every request above it):"
$PSQL -c "SELECT key, value FROM public.platform_settings WHERE key = 'payment_board_approval_above_sar';"
echo "-- person profiles: PREVIEW only (nothing linked). Apply per org later with persons_backfill(org, true)."
$PSQL -c "SELECT o.name, b.* FROM public.organizations o, LATERAL public.persons_backfill(o.id, false) b LIMIT 200;"

echo "== 6. build + restart"
bun install
NITRO_PRESET=node-server bun run build
systemctl restart kwalis.service
sleep 5
curl -fsS http://127.0.0.1:3080/api/health && echo
echo "DONE. Backup: $BACKUP"
echo
echo "OWNER STEPS (not done by this script — deploy/README_2026-10-28.md):"
echo "  * Contract files: as a super admin open Settings → Organization → Contract files,"
echo "    run the dry run, review conflicts / orphans, then Move files (25 per run, repeat)."
echo "  * Set each project's default region; review the WHT rates (incl. the 5% default row) with the tax adviser."
echo "  * Set DEMO_ACCOUNT_PASSWORD (or keep demo mode off); invoice approval needs a second user."
