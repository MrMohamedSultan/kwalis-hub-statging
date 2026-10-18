-- D12 helper — READ ONLY. Lists invoices and payroll rows whose budget code
-- has exactly ONE active budget line, i.e. the only rows that could be linked
-- to a line without a judgement call. It changes nothing: review the list,
-- then set linked_budget_line_id row by row.
WITH single_line_codes AS (
  SELECT project_id, main_code, (array_agg(id))[1] AS line_id, min(description) AS line_description
  FROM public.v_active_budget_lines
  GROUP BY project_id, main_code
  HAVING count(*) = 1
)
SELECT 'invoice' AS source, i.id, i.project_id, i.budget_code, i.invoice_no AS reference,
       i.vendor_name AS party, i.price AS amount, s.line_id AS candidate_line_id, s.line_description
FROM public.invoices i
JOIN single_line_codes s ON s.project_id = i.project_id AND s.main_code = i.budget_code
WHERE i.linked_budget_line_id IS NULL
UNION ALL
SELECT 'payroll', p.id, p.project_id, p.budget_code, p.ref_id, p.name, p.total_amount,
       s.line_id, s.line_description
FROM public.payroll p
JOIN single_line_codes s ON s.project_id = p.project_id AND s.main_code = p.budget_code
WHERE p.linked_budget_line_id IS NULL
ORDER BY 3, 4, 1;
