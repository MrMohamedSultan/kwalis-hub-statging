-- =====================================================================
-- 202 — Leftovers: service period on purchase orders (N02).
--
-- Why: Live Balance (N02) accrues vendor invoices and purchase orders
-- evenly over their service period. Invoices got service_period_from / to
-- in 174; purchase orders had no period, so a PO for a 10-week rental could
-- not accrue week by week. The app reads the new columns only when they
-- exist (useHasColumn), so it runs before and after this file.
--
-- What changes
--   * purchase_orders.service_period_from / service_period_to (date, NULL)
--     with a check that the period does not end before it starts.
--   * Nothing is backfilled; no existing row changes.
--
-- Rollback:
--   ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_service_period_check;
--   ALTER TABLE public.purchase_orders DROP COLUMN IF EXISTS service_period_to,
--                                      DROP COLUMN IF EXISTS service_period_from;
-- =====================================================================

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS service_period_from date,
  ADD COLUMN IF NOT EXISTS service_period_to   date;

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_service_period_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_service_period_check
  CHECK (service_period_from IS NULL OR service_period_to IS NULL OR service_period_to >= service_period_from);

COMMENT ON COLUMN public.purchase_orders.service_period_from IS
  'Start of the service the PO covers; Live Balance accrues the un-invoiced PO amount evenly over the period (N02). db/pending/202.';
COMMENT ON COLUMN public.purchase_orders.service_period_to IS
  'End of the service period (see service_period_from). db/pending/202.';
