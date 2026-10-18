#!/usr/bin/env bash
# ==============================================================
# Export current Lovable Cloud (Supabase) project to a portable
# SQL dump you can import into a standalone Supabase project.
#
# Usage:
#   1. Get the DB connection string from Lovable:
#      Cloud → Advanced settings → Export data (or ask support).
#   2. export SOURCE_DB_URL="postgres://postgres:PASS@host:6543/postgres"
#   3. bash scripts/export-cloud.sh
#   4. Import each *.sql file into the new Supabase project via
#      the SQL editor, in this order:
#        schema.sql → data.sql → auth-users.sql
# ==============================================================
set -euo pipefail

if [[ -z "${SOURCE_DB_URL:-}" ]]; then
  echo "ERROR: SOURCE_DB_URL not set."
  echo 'export SOURCE_DB_URL="postgres://postgres:PASS@host:6543/postgres"'
  exit 1
fi

OUT_DIR="${OUT_DIR:-./migration-export}"
mkdir -p "$OUT_DIR"

echo "[1/3] Dumping public schema (tables, policies, functions, triggers)..."
pg_dump "$SOURCE_DB_URL" \
  --schema=public \
  --no-owner --no-privileges \
  --schema-only \
  -f "$OUT_DIR/schema.sql"

echo "[2/3] Dumping public data..."
pg_dump "$SOURCE_DB_URL" \
  --schema=public \
  --no-owner --no-privileges \
  --data-only \
  --disable-triggers \
  -f "$OUT_DIR/data.sql"

echo "[3/3] Dumping auth.users (users only — passwords are hashed and portable)..."
pg_dump "$SOURCE_DB_URL" \
  --table=auth.users \
  --table=auth.identities \
  --no-owner --no-privileges \
  --data-only \
  -f "$OUT_DIR/auth-users.sql"

echo ""
echo "Done. Files written to $OUT_DIR/"
echo "Next: import schema.sql → data.sql → auth-users.sql into the new Supabase project."
echo ""
echo "For Storage buckets, run separately:"
echo "  supabase storage cp --recursive src://contracts dst://contracts"
echo "  supabase storage cp --recursive src://support-attachments dst://support-attachments"
