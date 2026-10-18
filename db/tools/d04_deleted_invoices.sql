-- =====================================================================
-- D04 — what happened to the deleted invoices?   READ ONLY, changes nothing.
--
-- Run on the live database (Lovable SQL editor). Two places a "missing"
-- invoice can be:
--
--  A. It was really deleted. invoices has had the row-audit trigger for a
--     long time, so every DELETE left the complete row in audit_history
--     (old_row), with who and when. Section A lists them. Such a row can be
--     put back by hand from old_row — after 130_d02_d03 is applied this
--     becomes one click (restore_trash_item).
--
--  B. Its PROJECT was deleted. The foreign key invoices.project_id is
--     ON DELETE SET NULL, so the invoice is still in the table with
--     project_id = NULL and no screen shows it. Section B lists those, and
--     section C does the same for the other money tables.
-- =====================================================================

-- A. invoices that were deleted, newest first
SELECT h.created_at                         AS deleted_at,
       h.actor_id                           AS deleted_by,
       pr.display_name                      AS deleted_by_name,
       h.organization_id, h.project_id,
       h.old_row->>'invoice_no'             AS invoice_no,
       h.old_row->>'vendor_name'            AS vendor,
       h.old_row->>'description'            AS description,
       (h.old_row->>'price')::numeric       AS price,
       h.old_row->>'budget_code'            AS budget_code,
       h.old_row->>'date'                   AS invoice_date,
       h.record_id                          AS invoice_id,
       EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = h.record_id) AS exists_again
FROM public.audit_history h
LEFT JOIN public.profiles pr ON pr.id = h.actor_id
WHERE h.table_name = 'invoices' AND h.operation = 'DELETE'
ORDER BY h.created_at DESC;

-- B. invoices orphaned by a deleted project (still stored, shown nowhere)
SELECT i.id, i.invoice_no, i.vendor_name, i.description, i.price, i.budget_code, i.date,
       i.organization_id, i.created_at
FROM public.invoices i
WHERE i.project_id IS NULL
ORDER BY i.created_at DESC;

-- C. the same check across the other money tables
SELECT 'payroll' AS table_name, count(*) AS orphaned_rows, sum(total_amount) AS amount FROM public.payroll WHERE project_id IS NULL
UNION ALL SELECT 'payments', count(*), sum(amount) FROM public.payments WHERE project_id IS NULL
UNION ALL SELECT 'purchase_orders', count(*), sum(amount) FROM public.purchase_orders WHERE project_id IS NULL
UNION ALL SELECT 'cash_advance_receipts', count(*), sum(amount) FROM public.cash_advance_receipts WHERE project_id IS NULL
UNION ALL SELECT 'budget_lines', count(*), NULL FROM public.budget_lines WHERE project_id IS NULL
ORDER BY 1;
