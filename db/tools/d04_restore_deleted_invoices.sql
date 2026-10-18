-- =====================================================================
-- D04 — put back the two invoices deleted on 2026-08-03 (project MON26).
-- WRITES DATA. Run only after the client confirms these two should come back.
--
-- Found in the live backup of 2026-10-15 (audit_history, operation DELETE):
--   invoice_no 11111 · Cash · قطع غيار · 16,999.99 · dated 2026-07-16
--   invoice_no 123   · Cash · ماء      ·    999.98 · dated 2026-07-16
-- Both deleted 2026-08-03 09:38 by the account "Ammar Almulki".
--
-- The complete row was kept in audit_history.old_row, so each invoice comes
-- back with its original id, amounts and dates. wht_treatment did not exist
-- when they were deleted, so it gets the table default ('inclusive').
-- Safe to run twice: an invoice whose id already exists is skipped.
-- Undo: DELETE FROM public.invoices WHERE id IN (<the two ids printed below>);
-- =====================================================================
BEGIN;

WITH deleted AS (
  SELECT DISTINCT ON (h.record_id) h.record_id, h.old_row
  FROM public.audit_history h
  WHERE h.table_name = 'invoices'
    AND h.operation = 'DELETE'
    AND h.old_row->>'invoice_no' IN ('11111', '123')
    AND h.created_at::date = DATE '2026-08-03'
  ORDER BY h.record_id, h.created_at DESC
)
INSERT INTO public.invoices
SELECT (jsonb_populate_record(
          NULL::public.invoices,
          d.old_row || jsonb_build_object('wht_treatment', COALESCE(d.old_row->>'wht_treatment', 'inclusive'))
       )).*
FROM deleted d
WHERE NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = d.record_id)
RETURNING id, invoice_no, vendor_name, description, price, date;

COMMIT;
