# Kwalis HUB — Technical Handover

Production accounting platform for film / series / commercial productions:
budgets, top sheet, payroll, payables, petty cash, treasury, rebate reporting.
Bilingual EN/AR with RTL. Multi-tenant (organizations → projects).

Audience: senior developer, first day on the codebase. Read this end to end
before touching anything. Section 8 is non-negotiable.

---

## 1. Stack & Structure

### Framework

- **TanStack Start v1** (`@tanstack/react-start` 1.168.26, `@tanstack/react-router` 1.170.16) — React 19 full-stack, file-based routing, SSR.
  **Not** Next.js, **not** React Router. Never install another router.
- **Vite 7** via `@lovable.dev/vite-tanstack-config` 2.13.1 (wraps tanstackStart, viteReact, tailwind, tsconfig-paths, Nitro).
- **Nitro** preset `vercel` — the deploy target is Vercel serverless, not Cloudflare Workers, despite the template default. `src/shims/cloudflare-workers.ts` exists purely to stub `cloudflare:*` virtual modules pulled in by `@lovable.dev/mcp-js`.
- **TypeScript** 5.9, strict. `bun run build` = `tsc --noEmit && vite build`.

### Key libraries

| Area | Library |
|---|---|
| UI | shadcn/ui on Radix (`@radix-ui/*` 1.x–2.x), `lucide-react` 0.575 |
| Styling | Tailwind CSS **v4** via `src/styles.css` `@theme` — there is **no** `tailwind.config.js` |
| Data | `@supabase/supabase-js` 2.110, `@tanstack/react-query` 5.101 |
| Client state | `zustand` 5 (`src/lib/store.ts`, persisted under `kwalis.store.persist.v2`) |
| Forms / validation | `react-hook-form` 7.83, `zod` 3.25, `@hookform/resolvers` |
| i18n | `i18next` 26 + `react-i18next` 17 (`src/lib/i18n.ts`, `src/locales/{en,ar}.json`) |
| Charts | `recharts` 3.10 |
| Export | `exceljs`, `xlsx` (SheetJS CDN tarball), `jspdf` + `jspdf-autotable`, `jszip`, `html2canvas-pro` — all lazy-loaded via `src/lib/lazy-export-libs.ts` |
| Timeline | `@dnd-kit/core` 6.3 |
| Tables | `@tanstack/react-virtual` 3.14 |
| PWA | `vite-plugin-pwa` 1.3 + `workbox-window` |
| AI | `ai` 7 + `@ai-sdk/openai-compatible` (Lovable AI Gateway) |
| MCP | `@lovable.dev/mcp-js` 0.22 |
| Test | `vitest` 4 |

### Folder structure

```
src/
  routes/                 file-based routes (see §4)
    _authenticated/       auth-gated tenant app (55 routes)
    _board/               executive / board member workspace
    _platform-hub/        super-admin platform console
    api/public/           unauthenticated HTTP endpoints
    [.mcp]/, mcp.ts       MCP server endpoints (generated — do not edit)
  components/             shared UI; ui/ = shadcn primitives
    role-management/ payables/ payroll-hub/ dashboard/ budget/
    timeline/ charts/ contracts/ platform/ layouts/ chrome/ currency/
  features/               reports/, timeline/ (feature-scoped modules incl. exports)
  lib/                    130 modules: domain logic, server fns, helpers
    *.functions.ts        createServerFn RPC, client-callable
    *.server.ts           server-only helpers, never imported by components
    dashboard/            dashboard data doctrine (real-financials.ts)
    permissions/          role matrix + role-admin server fns + route→module map
    mcp/                  MCP tool definitions
    i18n/                 translation helpers
  integrations/supabase/  GENERATED clients + types (do not edit)
  config/navigation.ts    sidebar structure (single source for menu)
  stores/, contexts/, hooks/, utils/, locales/, assets/, styles.css
  router.tsx, start.ts, server.ts, routeTree.gen.ts (generated)
scripts/                  rls-regression, deploy-smoke-test, index-advisor, env-injection check
SECURITY.md               authoritative security rule set
CLAUDE.md                 short agent guide
MIGRATION.md              migration notes
```

Where things live:
- **Server logic the app calls itself** → `src/lib/*.functions.ts` (`createServerFn`).
- **External HTTP callers / webhooks** → `src/routes/api/public/*`.
- **Server-only secrets and privileged code** → `*.server.ts`, read `process.env` **inside** handlers.
- **Browser config** → `import.meta.env.VITE_*`.
- **All user-facing strings** → i18next keys in both `en.json` and `ar.json`.

---

## 2. Database

Supabase Postgres, managed by Lovable. 75 tables, 13 views, ~80 functions,
~90 triggers. Row counts below are live production `n_live_tup` at handover.

### 2.1 Tables

#### Tenancy, identity, access

| Table | Rows | Purpose / key columns |
|---|---|---|
| `organizations` | 2 | Tenant root. `base_currency`, `max_allowed_projects`, owner. |
| `organization_members` | 8 | `(user_id, organization_id, role org_role owner/admin/member)`. Drives `is_org_admin` / `is_org_member`. |
| `projects` | 7 | `organization_id`, `code`, `type`, `kind` (film/series), `currency`, `fx_rate`, `budget_status`, `status project_status`. |
| `project_members` | 22 | `(project_id, user_id, role)` — project visibility. |
| `profiles` | 10 | `display_name`, `job_title`, `executive_title`. **No role column — by design.** |
| `user_roles` | 10 | `(user_id, role app_role)`. **The only place platform roles live.** Read by `has_role()` / `is_super_admin()`. |
| `roles` | 5 | RBAC role definitions. `organization_id` (NULL = global), `slug`, `layout_type`, `is_admin`, `is_system`. |
| `role_permissions` | 153 | `(role_id, module_key, can_view/create/edit/delete/export)`. No org column — scope inherited from `roles`. |
| `user_role_assignments` | 10 | `(user_id, organization_id, project_id NULL, role_id)` — who holds which RBAC role where. |
| `user_rbac_settings` | 1 | Per-user RBAC preferences/overrides. |
| `modules` | 53 | Module catalogue: `key`, `label`, `route_path`, `parent_key`, `layer` (operational/executive), `is_active`. Joined by `get_my_permissions`. |
| `invitations` | 4 | Org invitations, token + expiry + accepted/revoked. |
| `access_requests` | 0 | B2B signup CRM inbox. Written by `submit_access_request()`. |
| `verified_devices` | 0 | Device fingerprints for trusted-device checks. |
| `auth_security_log` | 16 | Login lockouts / security events. Written by `log_auth_security_event()`. |
| `pending_project_assignments` | 0 | Project assignments for users who have not signed up yet; resolved by trigger on `profiles`. |
| `user_project_settings` | 2 | Per-user per-project UI settings. |

#### Budget

| Table | Rows | Purpose / key columns |
|---|---|---|
| `budget_lines` | 2688 | The project budget. `project_id`, `version_id`, `header_code`, `main_code`, `topsheet_code`, `description`, `amount`, `rate`, `x`, `unit`, `prep`/`shooting`/`wrap`, `currency`, `excluded`, `rebate_eligible`, `character_id`, `upload_batch_id`. |
| `budget_versions` | 8 | `project_id`, `name` (v1.x), `status` draft/active. Only one active per project. |
| `budget_upload_batches` | 11 | Excel import batches. |
| `budget_topsheet_accounts` | 35 | Shared top-sheet account catalogue (global, read-only to tenants). |
| `master_budget` | 1712 | Shared master chart of budget codes: `budget_code`, `description`, `group`, `category`, `planned_amount`, `actual_amount`. Global catalogue. |
| `gl_accounts` | 26 | Shared GL chart of accounts (global catalogue). |
| `budget_approvers` | 0 | Approval chain rows for a budget. Max 5. Adding a row is what moves a budget to *Pending Approval*. |
| `budget_status_events` | 2 | Budget status transition log. |

#### Contracts, people, payroll

| Table | Rows | Purpose |
|---|---|---|
| `crew_members` | 10 | Crew contracts. `total_deal`, `contract_status`, `linked_budget_line_id`. |
| `people` | 22 | Cast/talent (52 cols). `daily_rate`, `per_diem`, `shooting_days`, `contract_status`, `linked_budget_line_id`. |
| `characters` | 5 | Script characters; linked to budget lines. |
| `character_role_types` | 5 | Lead/supporting/extra taxonomy. |
| `contract_budget_splits` | 0 | Split one contract across several budget lines. |
| `rate_cards` | 0 | Standard rates per role. |
| `timesheets` / `timesheet_entries` | 0 / 0 | Timesheet capture. |
| `overtime_entries` | 0 | OT with approval workflow (`enforce_overtime_approval`). |
| `per_diem_ledger` | 0 | Per diem accruals/payments. |
| `payroll` | 18 | Legacy/canonical payroll postings: `kind`, `total_amount`, `net_payable`, `wht_amount`, `budget_code`, `gl_account_id`. |
| `payroll_payments` | 4 | Executed payroll payments + proof of payment. `paid_total_sar`, `beneficiary_name`. |
| `payroll_runs` / `payroll_run_items` | 0 / 0 | Bulk payroll run engine (state machine, see triggers). |
| `payroll_approval_events` | 0 | Payroll run approval log. |

#### Procurement, payables, cash

| Table | Rows | Purpose |
|---|---|---|
| `vendors` | 6 | Vendor directory. |
| `vendor_categories` | 1 | Vendor taxonomy. |
| `purchase_orders` | 5 | `po_number`, `amount`, `status`, `budget_code`, `linked_budget_line_id`. Approved POs = commitments. |
| `invoices` | 10 | `invoice_no`, `price`, `vat_amount`, `wht_amount`, `net_payable`, `budget_code`, `rebate_eligible`. |
| `payment_requests` | 0 | Approval queue: `source_type`/`source_id`, `requested_amount`, `status`. |
| `payments` | 1 | Executed payments: `source_type`/`source_id`, `amount`, `payment_date`. The canonical "Paid". |
| `cash_advances` / `cash_advance_receipts` | 0 / 0 | Petty cash floats and their receipts (`status`, `linked_budget_line_id`). |
| `transactions` | 0 | Legacy generic ledger keyed to `master_budget.budget_code`. |
| `entities` | 0 | Legacy counterparty directory used by `v_financial_ledger`. |
| `project_fx_rates` | 0 | Per-project FX overrides; read/written by `get_active_project_fx_rate` / `update_project_fx_rate`. |
| `fx_rate_audit_log` | 0 | FX change log. |

#### Production & logistics

| Table | Rows | Purpose |
|---|---|---|
| `locations` | 0 | Filming locations. |
| `accommodations` | 0 | Accommodation roster. |
| `lodging_properties` / `lodging_room_types` | 1 / 2 | Lodging catalogue. |
| `daily_transports` | 0 | Daily transport schedule. |
| `car_rentals` | 0 | Vehicle rentals. |
| `picture_assets` | 0 | Picture vehicles & animals (33 cols). |
| `series_seasons` / `series_episodes` | 1 / 6 | Series structure. |
| `timeline_versions` | 3 | Timeline snapshots. |
| `timeline_bars` | 14 | Gantt bars. |
| `timeline_task_types` | 72 | Task dictionary; project-level overridable. |
| `timeline_milestones` | 0 | Milestones. |

#### Documents, audit, support

| Table | Rows | Purpose |
|---|---|---|
| `project_files` / `project_folders` | 0 / 3 | File library metadata over the `project-documents` bucket. |
| `organization_documents` | 0 | Org-level document vault. |
| `audit_history` | 5163 | Row-level before/after diffs from `log_audit_history()`. |
| `audit_logs` | 116 | Application-level action log. |
| `permission_audit_log` | 166 | RBAC change log (`log_permission_change`). |
| `notifications` | 5 | In-app notifications. |
| `support_tickets` | 0 | Support desk. |

#### Empty tables — expected or not

Expected empty (feature shipped, tenant has not used it yet):
`locations`, `accommodations`, `daily_transports`, `car_rentals`,
`picture_assets`, `timeline_milestones`, `project_files`,
`organization_documents`, `support_tickets`, `access_requests`,
`verified_devices`, `cash_advances`, `cash_advance_receipts`,
`per_diem_ledger`, `overtime_entries`, `contract_budget_splits`,
`rate_cards`, `timesheets`, `timesheet_entries`, `payroll_runs`,
`payroll_run_items`, `payroll_approval_events`, `pending_project_assignments`,
`project_fx_rates`, `fx_rate_audit_log`, `budget_approvers`.

**Not expected / structurally significant:**
- `payment_requests` (0) — yet the entire Payment Approvals screen and the
  `v_paid_by_code` view are built on it. Every "actuals" figure derived from
  `v_paid_by_code` is therefore structurally zero today. See §7.
- `transactions` (0) and `entities` (0) — legacy tables. Three views
  (`v_financial_ledger`, `v_vat_report`, `v_film_commission_report`) read only
  these, so those views return nothing. Dead path.
- `budget_approvers` (0) — combined with every `profiles.executive_title`
  being NULL, the budget approval workflow cannot currently be started from
  the UI at all. See §7.

### 2.2 Views

All reporting views should carry `security_invoker = on`; verify before adding
new ones.

| View | What it does | Read by |
|---|---|---|
| `v_active_budget_lines` | `budget_lines` filtered to the project's **active** budget version, with a fallback for legacy rows where `version_id IS NULL` and the project has no versions. 26 cols. | Every budget-derived view, `get_budget_reconciliation` (CTE `est` only), budget screens |
| `v_ledger_transactions` | Canonical ledger. UNION of invoices (`actual`), payroll (`actual`), purchase_orders (`commitment`), cash_advance_receipts (`actual`), overtime_entries (`actual`), per_diem_ledger (`actual`), payments (`payment`). Carries `entry_kind`, `budget_code`, `vat_amount`, `wht_amount`, `qfe_eligible`. | `v_project_position`, `v_budget_code_position`, `canonical-ledger.ts`, top sheet |
| `v_project_position` | Project-level roll-up: `budget_sar`, `actual_sar`, `committed_sar`, `paid_sar`, `vat_sar`, `wht_sar`, `available_sar`, plus `unallocated_*` for ledger rows whose `budget_code` is not in the budget. | Dashboard, Executive dashboard (`real-financials.ts`) |
| `v_budget_code_position` | Same roll-up per `budget_code`. | Dashboard breakdown, budget screens |
| `v_paid_by_budget_code` | `payments` joined to its source document to resolve `budget_code`; sums `paid_sar`. Canonical "Paid". | `v_project_position`, `v_budget_code_position` |
| `v_paid_by_code` | A **different** "paid" — derived from `payment_requests.status='paid'` plus paid overtime. Exposed as column name `actuals`. | `v_budget_line_financials` |
| `v_source_totals_by_code` | Gross source-document totals per code (invoices + POs + crew deals + cast rate×days + overtime), regardless of status. | `v_budget_line_financials` |
| `v_budget_line_financials` | Per-line estimate / actuals / committed / variance, where `committed = source_total − actuals` floored at 0. | `get_project_budget_financials`, line drilldowns |
| `budget_line_actuals` | Per-line committed (crew + cast + approved POs) and paid (payroll payments matched **by name**, approved receipts, paid per diem). | `BudgetLineActualsModal`, `useBudgetLineActuals` |
| `v_overtime_by_code` | Approved/paid overtime resolved to a budget code. | `v_paid_by_code`, `v_source_totals_by_code` |
| `v_budget_vs_actual` | `master_budget` planned vs actual + variance + % used. | Master budget reporting |
| `v_financial_ledger` | `transactions` joined to `master_budget` and `entities`. | Legacy — currently empty |
| `v_film_commission_report`, `v_vat_report` | Rebate / VAT aggregates over `transactions`. | Legacy — currently empty |

### 2.3 Functions

**Authorization predicates (SECURITY DEFINER, used inside RLS):**
`has_role`, `is_super_admin`, `is_org_member`, `is_org_admin`, `is_org_owner`,
`is_project_member`, `is_project_admin`, `is_admin()` / `is_admin(org, project)`,
`is_company_admin_for_project`, `is_org_member_for_project`,
`can_access_project`, `can_approve_payroll`, `can_edit_timeline`,
`can_view/can_create/can_edit/can_delete/can_export(module_key)`,
`can_access_contract_path`, `contracts_path_org_id`, `contracts_path_scope`,
`current_role_id`, `current_layout_type`, `user_has_permission`,
`is_budget_editable`, `check_admin_unlock`.

**Permission resolution:** `get_my_permissions(p_org_id, p_project_id)` — the
single RPC the UI calls to learn what the current user may see. Three layers:
super admin → all active modules; org membership required; then project-scoped
`user_role_assignments` with org-scoped fallback.

**Budget / finance:**
`budget_line_total_sar(...)` (the one canonical line-total formula, FX-aware),
`active_budget_version_id`, `create_budget_draft`, `publish_budget_version`,
`get_budget_reconciliation(project, from, to)`,
`get_project_budget_financials(project)`, `master_budget_integrity()`,
`get_active_project_fx_rate`, `update_project_fx_rate`,
`reverse_payroll_run(run, reason)`.

**Other:** `submit_access_request`, `get_invitation_by_token`,
`log_auth_security_event`, `seed_demo_data`.

### 2.4 Triggers (by intent)

- **Audit:** `log_audit_history` on `budget_lines` and other mutable tables → `audit_history`; `log_permission_change` → `permission_audit_log`; `log_budget_status_change` → `budget_status_events`; `log_budget_approver_decision`; `log_payroll_run_transition`.
- **Tenant stamping:** `stamp_budget_line_organization`, `stamp_payroll_organization`, `stamp_picture_asset_organization`, `stamp_timeline_organization`, `stamp_audit_fields`, `stamp_budget_line_version`.
- **Money integrity:** `enforce_money_precision(cols…)` on every money-bearing table, `enforce_payment_schedule_precision`, `enforce_transaction_sub_account`, `validate_invoice`, `validate_transaction`, `validate_payroll_ledger`, `enforce_payment_request_limit`, `revalidate_payment_request_on_submit`.
- **Workflow guards:** `enforce_budget_approver_decision`, `enforce_overtime_approval`, `enforce_payroll_run_transition`, `enforce_operational_write`, `check_budget_threshold`.
- **Lockout / integrity guards:** `guard_org_admin_lockout`, `guard_assignment_lockout`, `guard_role_integrity` (system roles immutable, no cross-tenant move), `guard_master_budget_delete`, `guard_master_budget_truncate`, `validate_master_budget_hierarchy`.
- **Lifecycle:** `handle_new_user` (auth.users → profiles), `add_project_owner_as_member`, `resolve_pending_project_assignments`, `notify_super_admins_new_access_request`, `sync_master_budget_actual`, `sync_master_budget_overtime`, `set_updated_at` / `touch_*` everywhere.

---

## 3. Permissions

### Layer 1 — Platform

Single source of truth: a row in **`public.user_roles`** with
`role = 'super_admin'`. Nothing else confers platform ownership — not
`profiles`, not org membership.

Three consumers, all reading that same source:

| Consumer | Path |
|---|---|
| Platform Hub route gate | `src/routes/_platform-hub/route.tsx:27` → `roles.isSuperAdmin` from `src/lib/auth-roles.ts` (browser query on `user_roles`) |
| Database | `is_super_admin(uid)` → `has_role(uid,'super_admin')` (SECURITY DEFINER) |
| Role Management screen | `src/lib/permissions/role-admin.functions.ts:30` → `supabase.rpc("is_super_admin")` on the server with the caller's bearer token |

They agree. A locked Role Management matrix is therefore a signal that the
session is *not* the platform owner, not that the layers disagree.

### Layer 2 — Organization

`organization_members.role ∈ (owner, admin, member)`.
Enforced by `is_org_member` / `is_org_admin` / `is_org_owner` inside RLS, and
mirrored client-side by `auth-roles.ts` (`adminOrgIds`, `memberOrgIds`).

### Layer 3 — Project / module

`user_role_assignments (user_id, organization_id, project_id?, role_id)` →
`roles` → `role_permissions (module_key, can_*)` → `modules`.
Resolved in one call by **`get_my_permissions(org, project)`**; project-scoped
assignment wins, org-scoped assignment is the fallback.
Project *visibility* additionally requires a `project_members` row (org admins
get a fallback to all org projects only when they hold no `project_members`
rows at all).

### How each surface derives its answer

- **Sidebar** (`src/components/Sidebar.tsx`): structure is hardcoded in
  `src/config/navigation.ts` (8 sections, 30 grouped links + Dashboard, plus a
  conditional Series link). Visibility per item:
  `if (!isTenantShell) true; if (matrixActive) perms.can(moduleKey,"view");
  if (!projectRole.ready) true; else canViewModuleForSnapshot(...)`.
  `can()` returns: not-ready → false · super admin → true · `role.is_admin` →
  true · module key absent from `modules` → false · else `can_view`.
  A section whose items are all hidden is **removed entirely** (no header).
- **Route guards**: `src/routes/_authenticated/route.tsx` maps path → module key
  via `src/lib/permissions/route-modules.ts` and calls `can(perms, key, "view")`.
  Some routes add their own `beforeLoad` (`guardRoutePermission`, `requireRoles`) —
  see §4. `_board` requires board membership; `_platform-hub` requires super admin.
- **RLS**: policies call the SECURITY DEFINER predicates above on
  `auth.uid()`.

All three ultimately resolve from `user_roles` + `organization_members` +
`user_role_assignments`/`role_permissions`. The sidebar and route guards use
the same `get_my_permissions` payload; RLS re-derives it in SQL. They are
consistent in source but **not** in coverage: a module key missing from the
`modules` table is hidden in the sidebar yet may still be reachable by URL if
it is also absent from `route-modules.ts` (e.g. Timeline Task Dictionary).

### Role model

- **System roles** — 5 rows in `roles`, all `is_system = true`,
  `organization_id = NULL`: Administrator, Producer, Accountant, Coordinator,
  Executive. These are **global**: one row shared by every tenant. Only a
  super admin may edit them (`canEditRole`: `if (role.is_system) return admin.isSuper`),
  enforced again by RLS and by `guard_role_integrity`.
- **Custom roles** — created per organization (`organization_id` set,
  `is_system = false`). Editable by that org's owner/admin. This is the only
  supported way for a tenant to tailor permissions.
- **Executive layout**: roles with `layout_type = 'executive'` get the board
  workspace and no sidebar; users holding another operational permission can
  switch back via "Return to work mode".

---

## 4. Routes

Parent gate `src/routes/_authenticated/route.tsx` resolves the session and the
RBAC payload, maps the path to a module key, and requires `view` on it. Only
deviations are listed in the "extra guard" column.

| Path | Renders | Module key / extra guard |
|---|---|---|
| `/` | Redirect to gateway or dashboard | parent gate |
| `/main-hub` | Project selection gateway | ungated entry point |
| `/dashboard` | Operational KPI dashboard | `dashboard` |
| `/budget` | Budget workspace (create / upload / top sheet tabs) | `budget`; edit gated by `budget.edit` |
| `/top-sheet-report` | Executive top sheet cost report | `top-sheet-report` |
| `/reports` | GL / rebate / QFE / VAT / WHT sub-reports | `reports` |
| `/budget-reconciliation` | Master vs project reconciliation | `budget-reconciliation` |
| `/petty-cash` | Cash floats and advances | `petty-cash` + component `accounting.view` |
| `/funding` | Funding & cash flow | `funding` |
| `/gl-accounts` | GL chart of accounts | `gl-accounts` |
| `/crew`, `/cast` | Crew / cast contract rosters | `crew-contracts`, `cast-contracts` |
| `/per-diem-ledger` | Per diem ledger | `per-diem` |
| `/payroll-hub` | Rate cards, timesheets, overtime, bulk runs, splits | `payroll-hub` + `guardRoutePermission("payroll.view")` |
| `/payroll`, `/crew-payroll`, `/cast-payroll` | Legacy payroll tables | `payroll`, `crew-payroll`, `cast-payroll` |
| `/vendors` | Vendor directory | `vendors` |
| `/purchase-orders` | Purchase orders | `purchase-orders` |
| `/invoices` | Invoices | `invoices` |
| `/payables` | Legacy payables | `payables` |
| `/vendor-payables` | Vendor payment milestones | `vendor-payables` |
| `/crew-cast-payables` | Crew/cast payment milestones | `crew-cast-payables` + `guardRoutePermission("payroll.view")` |
| `/payment-approvals` | Payment request approval queue | `payment-approvals` + `guardRoutePermission("payments.approve")` |
| `/characters` | Script characters | nav permission `crew.manage`; no route-level guard |
| `/production-timeline` | Gantt timeline | `timeline` |
| `/timeline-task-dictionary` | Task dictionary admin | **unmapped in `route-modules.ts`**; nav requires `system.settings` |
| `/locations`, `/daily-transport`, `/accommodation-roster`, `/car-rentals`, `/picture-assets` | Logistics directories | `locations`, `transport`, `accommodation`, `car-rentals`, `picture-assets` |
| `/series`, `/series/$seasonId` | Series / season management | `series` |
| `/project-files` | File library | `file-library` |
| `/notifications` | Notification inbox | `notifications` |
| `/audit-log` | Audit log viewer | `audit-log` |
| `/settings` | System settings | `system-settings` |
| `/role-management` | RBAC matrix | `role-management` + `requireRoles(...)` |
| `/invitations` | Org invitations | `invitations` + `requireRoles(super or org admin)` |
| `/data-audit` | Data audit tool | `data-audit` + `requireRoles(isSuperAdmin)` |
| `/support-desk` | Internal support desk | `support-desk` + `requireRoles(isSuperAdmin)` |
| `/support` | Support / contact | `support` |
| `/account-settings` | User account settings | `account-settings` |
| `/field-portal` | Field submission portal | `field-portal` |
| `/accounting` | Accounting hub | `accounting` + own `beforeLoad` search-param redirect |
| `/trash` | Recycle bin | `trash` |
| `/executive` | Executive read-only dashboard | **ungated by module** (`UNGATED_PREFIXES`); access controlled by the layout-isolation branch in the parent gate |
| `/no-access` | Access explainer | ungated |
| `/board/dashboard` | Board portfolio summary | `_board` gate: session + `isBoardMember` |
| `/board/budget-review` | Read-only budget hierarchy + approve/reject | `_board` gate |
| `/board/settings` | Board member settings | `_board` gate |
| `/platform-hub/dashboard` | Platform overview | `_platform-hub` gate: `isSuperAdmin` |
| `/platform-hub/companies`, `/companies/$companyId` | Tenant management | `_platform-hub` gate |
| `/platform-hub/users`, `/users/$userId` | Platform user management | `_platform-hub` gate |
| `/platform-hub/roles` | Global role matrix | `_platform-hub` gate |
| `/platform-hub/registration-requests` | Access request CRM | `_platform-hub` gate |
| `/platform-hub/audit-log`, `/platform-hub/settings` | Platform audit / settings | `_platform-hub` gate |
| `/auth` | Sign in / sign up / reset | public |
| `/timeline` | Top-level timeline route outside the auth layout | **no guard traced** — verify |
| `/api/public/ai-job` | AI job endpoint | public prefix — must verify the caller in-handler |
| `/mcp`, `/.mcp/*`, `/.well-known/oauth-protected-resource` | MCP + OAuth metadata (generated) | token-based, not app RBAC |
| `/~oauth` consent | Lovable OAuth consent | own `beforeLoad`, unrelated to app RBAC |

---

## 5. Financial Model

### 5.1 Intended doctrine (database)

| Figure | Definition | Source |
|---|---|---|
| **Budget** | `Σ budget_line_total_sar(amount, rate, x, prep, shooting, wrap, unit, currency, excluded, projects.fx_rate)` over `v_active_budget_lines` | `v_project_position.budget_sar`, `v_budget_code_position.budget_sar` |
| **Actual** | `Σ v_ledger_transactions.amount WHERE entry_kind='actual'` — invoices, payroll, petty-cash receipts, overtime, per diem | `v_project_position.actual_sar` |
| **Committed** | `Σ v_ledger_transactions.amount WHERE entry_kind='commitment'` — currently only approved/issued purchase orders | `v_project_position.committed_sar` |
| **Paid** | `Σ payments.amount` resolved to a budget code through its source document | `v_paid_by_budget_code` → `v_project_position.paid_sar` |
| **Available** | `budget − actual − committed` | `v_project_position.available_sar` |

`unallocated_actual_sar` / `unallocated_committed_sar` / `unallocated_paid_sar`
capture ledger rows whose `budget_code` does not exist in the budget — always
check these before declaring a reconciliation clean.

### 5.2 Competing definitions inside the database

- `v_budget_line_financials` computes `committed = v_source_totals_by_code.source_total − v_paid_by_code.actuals` floored at 0, and labels `v_paid_by_code` output as **actuals**. `v_paid_by_code` is driven by `payment_requests.status='paid'` — a different universe from `v_ledger_transactions`.
- `budget_line_actuals` computes committed from crew deals + cast rate×days + approved POs, and paid from `payroll_payments` matched to crew **by `beneficiary_name` string equality**, plus approved receipts and paid per diem.
- `get_budget_reconciliation` returns both `master_planned`/`master_actual`
  (from `master_budget`) and `project_estimate`/`committed`/`actuals`. Its
  `est` CTE reads `v_active_budget_lines`; its `com` CTE still joins the raw
  source tables.
- `v_budget_vs_actual`, `v_financial_ledger`, `v_vat_report`,
  `v_film_commission_report` compute against `master_budget` / `transactions`
  only — a third, currently empty, model.

So the database itself hosts **three** definitions of "actual" (ledger,
paid-payment-requests, master_budget.actual_amount) and **three** of
"committed" (ledger commitments, source-minus-paid, contract-derived).

### 5.3 Screens that compute financial figures independently

| Screen | Source |
|---|---|
| `/dashboard`, `/executive` | `src/lib/dashboard/real-financials.ts:134-197` → `v_project_position` + `v_budget_code_position`. **This is the doctrine.** |
| `/budget-reconciliation` | RPC `get_budget_reconciliation`; only the on-screen totals are a client reduce (`budget-reconciliation.tsx:132-153`) |
| `/top-sheet-report` | `src/lib/topsheet-report.ts:201-384` — budget column is a **client-side** `lineTotalSAR` sum over the zustand store; actual/committed/paid come from `canonical-ledger.ts:81-144` (`v_ledger_transactions` + `payments`). A fallback path (`top-sheet-report.tsx:297-350`) recomputes the whole table in the browser when no topsheet accounts are configured. |
| `/budget` | Line totals via `lineTotal`/`lineTotalSAR` over the in-memory store (draft editing); actuals via `v_budget_code_position` |
| `/reports` | ~6500 lines with dozens of independent `reduce()`s over store data (`reports.tsx:574-628, 1044, 1261, 1605, 1699-2178, 2488-2627`). No shared view. |
| `/funding` | `useTotals()` (`funding.tsx:120-175`) — client reduce over store `invoices`/`payroll`/`receipts`; classifies money by `payroll.ledger[].status`, not by `entry_kind` |
| `/petty-cash` | Client reduce over advances/balances (`petty-cash.tsx:306-315`) |
| `/vendor-payables`, `/crew-cast-payables` | `PayablesGridConnected.tsx:28-86` — milestones built entirely from store `payroll`/`people`/`vendors`; "Paid" means `paymentSchedule[].status === 'Paid'` |
| `/payment-approvals` | Plain `payment_requests` select + client counts (`payment-requests.ts:79-90`) |
| `/board/dashboard` | `board.dashboard.tsx` — reads `v_active_budget_lines`, converts with `projects.fx_rate`; `actual_spent_sar` from `v_project_position.actual_sar` (fixed 2026-09-15). Budget total still computed in the browser, not by `budget_line_total_sar`. |
| `/board/budget-review` | `board.budget-review.tsx` — a second full calculation engine ("mirrors AdvancedBudgetTable"), now FX-aware and Package/Epi-aware, but still a browser copy of `budget_line_total_sar`; budget only |

### 5.4 Where the definitions plainly disagree

1. **FX**: the app resolves FX per project (`projects.fx_rate`, optionally `project_fx_rates`). The two board screens did hardcode 3.75; fixed 2026-09-15 — they now read `projects.fx_rate` too.
2. **Actual**: ledger `entry_kind='actual'` (dashboard, top sheet) vs `payroll.ledger[].status` (funding) vs `master_budget.actual_amount` (reconciliation, `v_budget_vs_actual`) vs `v_project_position.actual_sar` (board dashboard, fixed 2026-09-15).
3. **Committed**: ledger commitments (dashboard) vs `source_total − paid` (`v_budget_line_financials`) vs contract-derived (`budget_line_actuals`) vs payroll-scheduled (`funding`).
4. **Paid**: `payments` joined to source (`v_paid_by_budget_code`) vs `payment_requests.status='paid'` (`v_paid_by_code`) vs milestone status in the browser store (payables grids) vs `payroll_payments` matched by beneficiary name (`budget_line_actuals`).
5. **Budget version**: the main app and both board screens read `v_active_budget_lines` (drafts excluded). No draft-version line reaches a board figure.
6. **Rounding**: views round with `numeric(14,2)`; client reduces use JS floats.

Observed consequence on project MuradONabeel: dashboard Actual 243,039.47 /
Committed 0.00 / Paid 2,000.00, reconciliation actuals 0 / committed 36,144 on
code 1101, final report actuals 0 / commitments 0 — all four "correct" under
their own definition.

---

## 6. Integrations & Deployment

### Supabase (Lovable Cloud)

- Postgres + Auth + Storage, one instance serving both preview and production.
- Clients, all generated in `src/integrations/supabase/` (**never edit**):
  - `client.ts` — browser, publishable key, session persisted; RLS as the user.
  - `auth-middleware.ts` — `requireSupabaseAuth` for `createServerFn`; injects `supabase`, `userId`, `claims`; RLS as the user.
  - `client.server.ts` — `supabaseAdmin`, service role, **bypasses RLS**; import it only *inside* handlers via `await import(...)`.
  - `auth-attacher.ts` — `attachSupabaseAuth`, registered as `functionMiddleware` in `src/start.ts`; attaches the bearer token to every server-fn call.
  - `types.ts` — generated DB types.
- Auth: email/password with lockout after 5 failed attempts (`auth_security_log`, `check_admin_unlock`), password reset via `resetPasswordForEmail`.

### Storage buckets (all private)

`contracts`, `receipts`, `project-documents`, `org-documents`,
`support-attachments`. Access is policy-gated; `can_access_contract_path` /
`contracts_path_scope` derive the tenant from the object path.

### Other services

- **Lovable AI Gateway** via `ai` + `@ai-sdk/openai-compatible`
  (`src/lib/ai-gateway.server.ts`, exposed through `/api/public/ai-job`
  and `budget-ai-predict.functions.ts`).
- **MCP server** — `src/lib/mcp/` defines tools; `src/routes/mcp.ts`,
  `src/routes/[.mcp]/**` and the OAuth metadata route are generated by the MCP
  Vite plugin.
- **PWA** — `vite-plugin-pwa`, `sw.js` emitted to `dist/client` and mirrored to
  the static output by a custom plugin. HTML is deliberately never precached.

### Build & deploy

```bash
bun install
bun run dev        # http://localhost:8080
bun run build      # tsc --noEmit && vite build
bun run lint
bun run test       # vitest
bun run test:rls   # RLS regression suite
bun run test:deploy-smoke
```

- Nitro preset **`vercel`** → output in `.vercel/output`. Hosted through
  Lovable; production at `kwalishub.com` / `www.kwalishub.com`
  (`kwalishub.lovable.app`), preview at the project preview URL.
- The repo is two-way synced with Lovable: `git pull` before starting,
  push when done.
- Migrations, RLS and grants are applied **through Lovable**, not locally.
- `.env` holds only `VITE_SUPABASE_*`. The service role key and DB password are
  not available locally; features depending on them run only in the hosted app.

---

## 7. Known Defects & Technical Debt

Stated without softening.

**Re-verification 2026-09-15** — all 24 items were re-checked against the
current code and live database, not against notes. Changed: **17** (rewritten —
budget approval is no longer blocked), **19** (executive exit fixed; `/timeline`
clarified as a deliberate public demo route), **11** (16 → 26 orphan codes),
**23** (line count corrected 6500 → 2836). The other 20 items were re-confirmed
unchanged, including: `SAR_RATE = 3.75` still hardcoded at
`board.dashboard.tsx:47` and `board.budget-review.tsx:70`;
`actual_spent_sar: 0` still at `board.dashboard.tsx:110`; `transactions`,
`entities`, `payment_requests`, `budget_approvers` all still 0 rows;
`pending_project_assignments` still has no code reference outside generated
types; `/timeline-task-dictionary` still absent from `route-modules.ts`.

### Financial correctness

1. **Four conflicting definitions of Actual, Committed and Paid** ship
   simultaneously (§5.4). No screen is wrong in isolation; the system has no
   single agreed definition. This is the largest open defect.
2. ~~Two board screens hardcode `SAR_RATE = 3.75`~~ — **fixed 2026-09-15**.
   Both screens now read `projects.fx_rate` (3.75 only as a fallback when the
   column is null or zero).
3. ~~`board.dashboard.tsx` hardcodes `actual_spent_sar = 0`~~ — **fixed
   2026-09-15**. The board dashboard now reads `v_project_position.actual_sar`,
   the same row the operational dashboard uses.
4. **Both board screens still carry a duplicated calculation engine.**
   `board.dashboard.tsx` and `board.budget-review.tsx` each reimplement the
   budget line total in the browser. On 2026-09-15 the missing
   `unit IN ('Package','Epi') → ×1` branch was copied verbatim from
   `public.budget_line_total_sar`, and the three live projects now agree with
   the SQL function to the cent (MuradONabeel 17,339,576.48 SAR;
   Sons Of Muqaisrah 1,531,102.50 SAR; Demo Project 32,512,500.00 SAR).
   **This agreement is coincidental, not structural.** Any future change to
   `budget_line_total_sar` will silently diverge again, because nothing ties
   the two copies together. Known remaining divergence: the SQL function
   defaults a null currency to `'USD'` and compares case-sensitively, while
   the TS copies default to `'SAR'` and uppercase first. The real fix is for
   both screens to call `budget_line_total_sar` (or read a view built on it)
   instead of computing totals in browser memory — **deferred, not done.**
5. ~~Board screens query `budget_lines` directly~~ — both already read
   `v_active_budget_lines`; no draft-version line can reach a board figure.
6. **`v_paid_by_code` is built on `payment_requests`, which has 0 rows**, and
   it exposes that column as `actuals`. Every figure downstream of it
   (`v_budget_line_financials.actuals`, hence its `committed` and `variance`)
   is structurally zero/inflated today.
7. **`budget_line_actuals` matches payroll payments to crew by
   `beneficiary_name` string equality.** Rename a crew member and the payment
   detaches silently. There is no FK between `payroll_payments` and
   `crew_members`/`people`.
8. **`payments` has no `budget_code` column.** Every paid figure is resolved by
   a 6-way LEFT JOIN over source tables (`v_paid_by_budget_code`); any payment
   whose `source_type` is not one of the six recognised strings is silently
   dropped from all paid totals.
9. **Client-side financial math** (the figures below are computed in browser
   memory, not the database): `/reports` (dozens of reduces), `/funding`
   `useTotals()`, `/petty-cash`, both payables grids, both board screens, the
   `/top-sheet-report` budget column and its whole fallback path, `/budget`
   line totals. These run over the persisted zustand store, so a stale store
   produces stale money.
10. **`get_budget_reconciliation` is asymmetric**: its `est` CTE reads
    `v_active_budget_lines`, its `com` CTE still joins raw source tables. Do
    not "fix" the `com` side without a numbers-level regression — this
    function is closed by owner decision.
11. **26 `budget_lines` rows carry a `main_code` that does not exist in
    `master_budget`** (re-counted 2026-09-15; was 16 when this document was
    first written — the gap is growing as lines are added).
    Reconciliation silently drops or orphans them.

### Dead or half-wired data

12. **Written but never read**: `fx_rate_audit_log` (1 code reference, write
    path only), `payroll_approval_events` (1 reference), `audit_history` (5163
    rows, surfaced only in a single panel), `permission_audit_log` (166 rows,
    no UI).
13. **Read but never written**: `transactions` and `entities` are empty, yet
    `v_financial_ledger`, `v_vat_report` and `v_film_commission_report` read
    nothing else. Three views and their report tabs are dead.
14. **`pending_project_assignments` has 0 code references** — written only by
    trigger, never surfaced.
15. **`master_budget` (1712 rows) is a global catalogue with no
    `organization_id`.** All tenants share one chart of accounts.
16. **`role_permissions` has no org/project column.** Scope is inherited from
    `roles.organization_id` only. All 5 roles are global `is_system` rows, so
    no tenant can tailor a system role — only create a custom one.

### Workflow gaps

17. **Budget approval is now startable, but still has no explicit "submit"
    step, and no project has used it yet.** *(Corrected 2026-09-15 — the
    previous text, "the workflow cannot be started", is obsolete.)*
    - An executive-title assignment UI now exists in two places:
      `BudgetGovernancePanel.handleAssignTitle()` (writes
      `project_members.executive_title`, inserting the membership row if the
      user is not yet on the project) and the Executive Title column in
      `ProjectMembersPanel.changeExecutiveTitle()`.
    - The approver picker resolves executives from **both** sources —
      `profiles.executive_title` and `project_members.executive_title`
      (`BudgetGovernancePanel.loadExecutives()`), so a per-project board
      assignment is enough. The old hard block (only a NULL
      `profiles.executive_title` column existed to read) is gone.
    - Still true: there is **no dedicated submit button**. The transition to
      *Pending Approval* is a side effect inside `handleAddApprover` after
      `addBudgetApprover`, gated by
      `canManage && !isExecutive && approvers.length < MAX_APPROVERS (5)`.
    - Production state as of 2026-09-15: `profiles.executive_title` non-null
      = 0, `project_members.executive_title` non-null = 0,
      `budget_approvers` = 0 rows, and every project is still `Draft`. The
      path is open but untravelled in production data.
18. **`/timeline-task-dictionary` is not in the `modules` table nor in
    `route-modules.ts`** — it is visible to admins only by accident of the
    fallback, and its URL is not module-gated.
19. **`/executive` and `/timeline` are ungated by module.** `/executive` sits
    behind the authenticated layout-isolation branch, not a module key;
    `/timeline` is an intentionally **public, auth-bypassing demo route**
    (`src/routes/timeline.tsx` renders `ProductionTimelinePage` outside
    `_authenticated`) — it is a deliberate exposure, not an oversight, but it
    should be removed before wider release.
    *Partially resolved 2026-09-15:* leaving the executive workspace is no
    longer a dead end. `ExecutiveLayout` now signs out correctly (cancels
    queries, clears cached protected data, clears work mode, then
    `navigate("/auth", { replace: true })`) and shows a "Return to work mode"
    exit for anyone `canEnterExecutiveWorkMode()` accepts
    (`src/lib/executive-work-mode.ts`, honoured by
    `src/routes/_authenticated/route.tsx`, `src/lib/rbac.ts`,
    `src/components/Sidebar.tsx`). Executive-only users remain locked to
    `/executive`. Module-level gating of the route itself is still absent.
20. **Three RLS policies remain `USING (true)`** for `authenticated`:
    `budget_topsheet_accounts`, `gl_accounts`, `modules`. Intentional
    (shared catalogues) but they are the only remaining always-true policies.
21. **Nothing prevents the platform from losing its owner.** `user_roles` has
    no trigger guard; the DELETE policy is `is_super_admin(auth.uid())`. The
    single `super_admin` row can delete itself, with no in-app recovery path.
22. **`/api/public/ai-job` bypasses site auth by prefix.** Caller verification
    must live in the handler — confirm it before relying on it.
23. **`reports.tsx` is 2,836 lines** (re-counted 2026-09-15; the earlier
    "~6500" figure was wrong). Still the single largest maintenance liability
    in the frontend, and still full of in-browser financial reduces.
24. **A known hydration warning on `/auth`** ("Text content did not match") is
    deliberate — it comes from reading language/direction out of
    `localStorage`.

---

## 8. Rules That Must Not Be Broken

**Generated files — never edit.** `src/routeTree.gen.ts`,
`src/integrations/supabase/{client.ts, client.server.ts, auth-middleware.ts,
auth-attacher.ts, previewAuthStorage.ts, types.ts}`, `src/routes/mcp.ts`,
`src/routes/[.mcp]/**`, `src/routes/[.well-known]/oauth-protected-resource.ts`,
`supabase/config.toml`, `.env`. They regenerate; your change disappears and the
build breaks in between. Change `src/lib/mcp/` instead of the MCP routes.

**Roles never live on `profiles`.** Only `public.user_roles`, checked through
the SECURITY DEFINER `has_role()`. Storing a role next to user data is a
privilege-escalation path.

**Every new `public` table: CREATE TABLE → GRANT → ENABLE RLS → POLICY, in that
order, in the same migration.** Without the GRANT the Data API returns a
permission error regardless of RLS. Without RLS the table is world-readable.

**No `USING (true)` / `WITH CHECK (true)` on tenant data.** Every policy scopes
through `is_org_member`, `can_access_project`, `is_project_member` or
`is_super_admin`.

**RLS helper functions must be `SECURITY DEFINER` with `SET search_path`** —
otherwise policies recurse infinitely.

**Reporting views need `security_invoker = on`** or they bypass RLS and leak
across tenants.

**Never touch the `auth`, `storage`, `realtime`, `supabase_functions` or
`vault` schemas**, including triggers on them.

**Security changes are proposed as a plan and applied only after the owner
approves.** `SECURITY.md` is the authoritative rule set; read it before any
change to RLS, grants, roles, secrets, `/api/public/*` or `supabaseAdmin`.

**`get_budget_reconciliation` is closed.** Its `est` CTE reads
`v_active_budget_lines`; the four joins in the `com` CTE and
`check_budget_threshold` were explicitly left untouched by owner decision.
Do not "tidy" it.

**`budget_line_total_sar` is the only budget line formula.** Every new figure
must call it, not reimplement it.

**Never read `budget_lines` directly for reporting** — use
`v_active_budget_lines`, or drafts contaminate published numbers.

**Server boundaries.** App-internal logic → `createServerFn` in
`*.functions.ts`. External callers → `src/routes/api/**`. Never create
Supabase Edge Functions. Never import `*.server.ts` or `client.server.ts` from
a component; load `supabaseAdmin` inside the handler with `await import(...)`.
Read `process.env` inside handlers only.

**Never place a `requireSupabaseAuth` server fn in a public route loader** —
prerender has no session and the build fails with `Unauthorized`.

**`src/start.ts` must keep `attachSupabaseAuth` in `functionMiddleware`.**
Remove it and every authenticated server function 401s.

**Theming: semantic tokens only** (`bg-card`, `text-foreground`,
`border-border`, …). No `text-white`, `bg-black`, `bg-[#hex]`. Status badges
are the sole documented exception.

**RTL: logical properties only** (`ms-`, `me-`, `ps-`, `pe-`). No `ml/mr/pl/pr/
left/right`. Arabic is a first-class language, not a translation layer.

**Every user-facing string goes through i18next with both `en` and `ar` keys.**

**Every query is scoped to the active organization/project.** RLS enforces it;
client code mirrors it. Dropping the filter is how cross-tenant leakage starts.

**Do not change the sidebar link set or paths casually.** `navigation.ts`,
`Sidebar.tsx`, `project-role.ts` `MODULE_SECTION`, the `modules` table and
`route-modules.ts` must stay in sync; a key present in one and missing in
another silently hides or exposes a screen.

---

*Generated at handover. Row counts and defect list reflect the production
database at the time of writing; re-verify before acting on any number here.*
