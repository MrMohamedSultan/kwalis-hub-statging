\set A '00000000-0000-0000-0000-00000000000a'
\set O1 '10000000-0000-0000-0000-000000000001'
\set P1 '20000000-0000-0000-0000-000000000001'
-- =====================================================================
-- 199 — per diem / overtime / petty-cash rows converted to SAR in the ledger view
-- =====================================================================
INSERT INTO people(id, kind, full_name, project_id, organization_id) VALUES ('a1990000-0000-0000-0000-0000000000f1', 'crew', 'USD Per Diem Person', :'P1', :'O1');
SELECT t.as_user(:'A');
CREATE TEMP TABLE before199 AS
  SELECT COALESCE((SELECT actual_sar FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1997'), 0) AS a;
RESET ROLE;
INSERT INTO per_diem_ledger(id, organization_id, project_id, person_id, period_start, period_end, on_set_rate, off_set_rate, shoot_days, off_days, currency, budget_code)
VALUES ('a1990000-0000-0000-0000-0000000000d1', :'O1', :'P1', 'a1990000-0000-0000-0000-0000000000f1', '2026-10-01', '2026-10-02', 100, 0, 2, 0, 'USD', '1997'),
       ('a1990000-0000-0000-0000-0000000000d2', :'O1', :'P1', 'a1990000-0000-0000-0000-0000000000f1', '2026-10-03', '2026-10-03', 150, 0, 1, 0, 'SAR', '1997');
SELECT t.eq('stored per diem total stays in USD', (SELECT total_amount FROM per_diem_ledger WHERE id = 'a1990000-0000-0000-0000-0000000000d1'), 200.00);
SELECT t.eq('USD per diem enters the ledger in SAR (x3.75)', (SELECT amount FROM v_ledger_transactions WHERE source_type = 'per_diem' AND source_id = 'a1990000-0000-0000-0000-0000000000d1'), 750.00);
SELECT t.eq('ledger row currency is SAR', (SELECT currency FROM v_ledger_transactions WHERE source_type = 'per_diem' AND source_id = 'a1990000-0000-0000-0000-0000000000d1'), 'SAR');
SELECT t.eq('SAR per diem unchanged', (SELECT amount FROM v_ledger_transactions WHERE source_type = 'per_diem' AND source_id = 'a1990000-0000-0000-0000-0000000000d2'), 150.00);
SELECT t.as_user(:'A');
SELECT t.eq('code position adds SAR 900, not 350',
  (SELECT actual_sar FROM v_budget_code_position WHERE project_id = :'P1' AND budget_code = '1997') - (SELECT a FROM before199), 900.00);
RESET ROLE;
-- project rate is used, not a fixed 3.75
UPDATE projects SET fx_rate = 3.80 WHERE id = :'P1';
SELECT t.eq('project rate applied', (SELECT amount FROM v_ledger_transactions WHERE source_type = 'per_diem' AND source_id = 'a1990000-0000-0000-0000-0000000000d1'), 760.00);
UPDATE projects SET fx_rate = 3.75 WHERE id = :'P1';
DELETE FROM per_diem_ledger WHERE id IN ('a1990000-0000-0000-0000-0000000000d1', 'a1990000-0000-0000-0000-0000000000d2');
DELETE FROM people WHERE id = 'a1990000-0000-0000-0000-0000000000f1';
