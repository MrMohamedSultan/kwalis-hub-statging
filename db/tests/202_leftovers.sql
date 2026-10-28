\set PO '70000000-0000-0000-0000-000000000001'
-- N02: purchase orders carry an optional service period
SELECT t.eq('existing PO keeps no period', (SELECT service_period_from FROM purchase_orders WHERE id = :'PO'), NULL::date);
SET session_replication_role = replica;  -- skip unrelated maker-checker / lock triggers for the column check
UPDATE purchase_orders SET service_period_from = '2026-10-01', service_period_to = '2026-10-10' WHERE id = :'PO';
SELECT t.eq('period saved', (SELECT service_period_to - service_period_from FROM purchase_orders WHERE id = :'PO'), 9);
SELECT t.denied('period ending before it starts is refused',
  $$UPDATE purchase_orders SET service_period_to = '2026-09-01' WHERE id = '70000000-0000-0000-0000-000000000001'$$);
UPDATE purchase_orders SET service_period_from = NULL, service_period_to = NULL WHERE id = :'PO';
SET session_replication_role = origin;
SELECT t.eq('file is idempotent (columns exist once)',
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'purchase_orders' AND column_name LIKE 'service_period_%'), 2::bigint);
