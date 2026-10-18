# Fix: users see projects they are not assigned to

## Root cause

Project visibility is decided at the **organization** level, not the project level.
Both the server-side project list and the database access rule treat any
*company admin* as able to see every project in the company. In the reported case
the user is a company admin assigned only to "happy meal", so "MuradONabeel" also
appears in their switcher.

Regular members are already correctly restricted — this only affects company admins
and any path that skips the membership check.

## What will change

### 1. Project list filtered by assignment
The server function that returns the project list will apply this rule:

- **System owners (platform level):** see everything (unchanged — needed for support).
- **Company owners:** see all projects in their company (unchanged — they administer it).
- **Everyone else, including company admins:** see only the projects they are
  explicitly assigned to.
- **Safety valve:** a company admin with *zero* assignments keeps seeing their
  company's projects, so nobody gets locked out of an existing workspace by this
  change. Assign them to a project and they immediately narrow down.

### 2. Database-level rule (requires your approval)
A migration will tighten the read rule on projects so the same logic is enforced in
the database, not just in the app. This makes a hand-crafted request unable to read
an unassigned project even if the UI is bypassed.

The helper used by the read rule becomes:
system owner OR company owner OR assigned member OR (company admin with no
assignments at all).

### 3. Single-project users skip the selector
If exactly one project is visible, the app auto-selects it and sends the user
straight to the dashboard instead of showing the "Select a Project" gateway.

### 4. Switch guard
Switching the active project already only accepts an ID present in the
server-filtered list; the store will additionally re-verify the ID server-side
before it becomes active, so a stored or injected project ID that is no longer
authorized is rejected and cleared.

## Notes

- No data is deleted; only visibility rules change.
- Company admins who should keep full visibility can either be made company
  owners or assigned to all projects.
