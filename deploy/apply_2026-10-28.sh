#!/usr/bin/env bash
# =====================================================================
# Kwalis Hub — staging deploy of the spec work (db/pending 171 → 200)
#
# Run on the self-hosted staging server ONLY, from the repo folder,
# AFTER the owner approved the SQL files listed in deploy/README_2026-10-28.md.
#
#   cd /home/techsjsm/kwalis_staging && git pull && bash deploy/apply_2026-10-28.sh
#
# What it does, in order (stops at the first error):
#   1. full backup of the database (custom format) into ~/kwalis_backups/
#   2. applies every new db/pending file in numeric order, each in one transaction
#   3. reloads the PostgREST schema cache
#   4. one-time backfills (only fill new columns / new ledger tables)
#   5. prints checks: ledger phases match, project/org mismatches, person-profile preview
#   6. builds the app and restarts the service, then calls /api/health
# =====================================================================
set -euo pipefail

DB_CONTAINER=${DB_CONTAINER:-supabase-db}
PSQL="docker exec -i $DB_CONTAINER psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=${BACKUP_DIR:-$HOME/kwalis_backups}
FILES="171 172 174 176 180 182 184 190 195 196 197 198 199 200"

echo "== 1. backup"
mkdir -p "$BACKUP_DIR"
docker exec "$DB_CONTAINER" pg_dump -U supabase_admin -d postgres -Fc > "$BACKUP_DIR/kwalis-before-171-200-$STAMP.dump"
ls -lh "$BACKUP_DIR/kwalis-before-171-200-$STAMP.dump"

echo "== 2. apply pending SQL"
for n in $FILES; do
  f=$(ls db/pending/${n}_*.sql)
  echo "-- $f"
  $PSQL --single-transaction < "$f" > "/tmp/kwalis-apply-$n.log" 2>&1 || {
    echo "FAILED on $f — nothing from this file was applied. Log:"; cat "/tmp/kwalis-apply-$n.log"; exit 1; }
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

echo "== 5. checks"
$PSQL -c "SELECT p.code, public.ledger_phases_match(p.id) AS ledger_ok FROM public.projects p ORDER BY 1;"
$PSQL -c "SELECT * FROM public.project_org_mismatches();"
echo "-- person profiles: PREVIEW only (nothing linked). Apply per org later with persons_backfill(org, true)."
$PSQL -c "SELECT o.name, b.* FROM public.organizations o, LATERAL public.persons_backfill(o.id, false) b LIMIT 200;"

echo "== 6. build + restart"
bun install
NITRO_PRESET=node-server bun run build
systemctl restart kwalis.service
sleep 5
curl -fsS http://127.0.0.1:3080/api/health && echo
echo "DONE. Backup: $BACKUP_DIR/kwalis-before-171-200-$STAMP.dump"
