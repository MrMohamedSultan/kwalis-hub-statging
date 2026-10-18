# Database Changelog

Append-only log of schema changes Lovable has applied to this project.
Most recent at top. Each entry lists tables/columns added and how to revert manually.

---

## 2026-06-28 — Mirror Kwalis Vendor Payroll & Budget Top Sheet

**Added tables**

- `public.payroll_payments` — unified Vendor / Crew / Cast payment ledger.
  Columns: `kind` (vendor|crew|cast), `in_process`, `company_name`,
  `invoice_link`, `beneficiary_name`, `iban`, `bank_name`,
  `bank_nationality`, `department`, `position_role`, `deal_notes`,
  `excludes_vat`, `currency` (default `SAR`),
  `scheduled_payments numeric[7]`, `paid_payments numeric[7]`,
  `reserved_budget_sar`, plus stored generated columns
  `scheduled_total_sar`, `paid_total_sar`, `remaining_sar`.
  FKs: `organization_id` → `organizations.id`, `project_id` → `projects.id`,
  `created_by` → `auth.users.id`.

- `public.budget_topsheet_accounts` — fixed account-code catalogue seeded from
  the uploaded _Budget Top Sheet_ CSV. Sections: ATL, Production, Post, Other,
  Adjustments (locked Contingency 20% & Production Fees 15%).

**Added columns (nullable, no backfill)**

- `public.budget_lines.topsheet_code` → `budget_topsheet_accounts.code`
- `public.master_budget.topsheet_code` → `budget_topsheet_accounts.code`

**Row-Level Security**

- `payroll_payments`: select/insert/update allowed when caller is
  super admin OR member of the row's organization. Delete restricted to
  super admin OR org admin.
- `budget_topsheet_accounts`: any signed-in user can read; only super admin
  can write.

**Existing data**

- Untouched. Migration only `CREATE TABLE` and `ALTER TABLE … ADD COLUMN`
  (nullable). No `UPDATE` or `DELETE` against existing rows.

**Linter warnings**

- 8 `SECURITY DEFINER` warnings flagged are pre-existing helper functions
  (`has_role`, `is_super_admin`, `is_org_member`, `is_org_admin`,
  `is_project_member`, `get_invitation_by_token`, `contracts_path_org_id`,
  `validate_custom_role_permissions`). They are intentionally callable by
  authenticated users to break RLS recursion — not introduced by this
  migration.

**Manual rollback** (run only if you need to undo this migration)

```sql
ALTER TABLE public.master_budget DROP COLUMN IF EXISTS topsheet_code;
ALTER TABLE public.budget_lines  DROP COLUMN IF EXISTS topsheet_code;
DROP TABLE IF EXISTS public.payroll_payments;
DROP TABLE IF EXISTS public.budget_topsheet_accounts;
```
