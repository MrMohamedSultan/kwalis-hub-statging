-- Test helpers (local test database only — never applied to a real project).
CREATE SCHEMA IF NOT EXISTS t;
GRANT USAGE ON SCHEMA t TO authenticated, anon;
CREATE OR REPLACE FUNCTION t.eq(label text, actual anyelement, expected anyelement) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: got %, expected %', label, actual, expected;
  END IF;
  RETURN 'ok   ' || label;
END $$;
-- Runs a statement and expects it to raise; returns ok when it does.
CREATE OR REPLACE FUNCTION t.denied(label text, stmt text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  BEGIN
    EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'ok   ' || label || '  (' || SQLERRM || ')';
  END;
  IF n = 0 THEN RETURN 'ok   ' || label || '  (0 rows affected)'; END IF;
  RAISE EXCEPTION 'FAIL %: statement succeeded but should have been refused', label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated, anon;
-- Act as a signed-in user / as anon / back to superuser.
CREATE OR REPLACE FUNCTION t.as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', uid::text, false); PERFORM set_config('role','authenticated',false); END $$;
