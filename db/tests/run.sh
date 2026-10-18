#!/bin/bash
# Rebuild the local test DB from scratch and run every test file.
# Usage: db/tests/run.sh            (needs a local Postgres on 127.0.0.1:54329)
set -u
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
DB=${DB:-kwalis_test}
P="psql -h 127.0.0.1 -p 54329 -U postgres -q -X"
$P -c "DROP DATABASE IF EXISTS $DB" postgres; $P -c "CREATE DATABASE $DB" postgres
sed "s/ALTER DATABASE kwalis/ALTER DATABASE $DB/" "$HERE/supabase-stubs.sql" > /tmp/stubs-$DB.sql
$P -f /tmp/stubs-$DB.sql $DB 2>&1 | grep -E "ERROR" | grep -v "already exists"
ok=0; bad=0
for f in $(ls "$ROOT/supabase/migrations" | sort); do
  case $f in
    20260824201651_*) # inserts one production payment with a real org id: schema part only
      $P -c "ALTER TABLE public.payments DROP CONSTRAINT payments_source_type_check; ALTER TABLE public.payments ADD CONSTRAINT payments_source_type_check CHECK (source_type IN ('invoice','purchase_order','po','petty_cash','cash_advance','cash_advance_receipt','receipt','payroll','overtime','per_diem'));" $DB; ok=$((ok+1)); continue;;
  esac
  if $P -v ON_ERROR_STOP=1 --single-transaction -f "$ROOT/supabase/migrations/$f" $DB >/dev/null 2>/tmp/err-$DB.txt; then ok=$((ok+1)); else bad=$((bad+1)); echo "MIGRATION FAIL $f: $(grep -m1 ERROR /tmp/err-$DB.txt)"; fi
done
echo "repo migrations: ok=$ok failed=$bad"
$P -v ON_ERROR_STOP=1 --single-transaction -f "$HERE/live_only_migrations.sql" $DB || { echo "LIVE-ONLY MIGRATIONS FAILED"; exit 1; }
$P -v ON_ERROR_STOP=1 -f "$HERE/000_helpers.sql" $DB
# seed BEFORE the pending files, so they are proven to apply on a database that already holds data
$P -v ON_ERROR_STOP=1 --single-transaction -f "$HERE/seed.sql" $DB || { echo "SEED FAILED"; exit 1; }
pok=0; pbad=0
for f in $(ls "$ROOT"/db/pending/*.sql | sort); do
  if $P -v ON_ERROR_STOP=1 --single-transaction -f "$f" $DB >/dev/null 2>/tmp/err-$DB.txt; then pok=$((pok+1)); else pbad=$((pbad+1)); echo "PENDING FAIL $(basename $f): $(grep -m1 -A4 ERROR /tmp/err-$DB.txt)"; fi
done
echo "pending files:   ok=$pok failed=$pbad"
tp=0; tf=0
for f in $(ls "$HERE"/[0-9][0-9][0-9]_*.sql | sort); do
  [ "$(basename $f)" = "000_helpers.sql" ] && continue
  out=$($P -At -v ON_ERROR_STOP=1 -f "$f" $DB 2>&1); rc=$?
  n=$(echo "$out" | grep -c '^ok ')
  if [ $rc -eq 0 ]; then tp=$((tp+n)); echo "PASS $(basename $f)  ($n checks)"; else tf=$((tf+1)); tp=$((tp+n)); echo "FAIL $(basename $f)"; echo "$out" | grep -E "FAIL|ERROR" | head -5; fi
  [ -n "${VERBOSE:-}" ] && echo "$out"
done
echo "checks passed: $tp   test files failed: $tf   pending failed: $pbad"
[ $tf -eq 0 ] && [ $pbad -eq 0 ] && [ $bad -eq 0 ]
