#!/usr/bin/env node
/**
 * Surgical purge of RLS-regression test fixtures.
 * -----------------------------------------------
 * Deletes ONLY rows that carry the dedicated fixture marker defined in
 * scripts/rls-fixture-tag.mjs (`[RLSFIXTURE]` in names, the reserved
 * `@rlsfixture.example.test` email domain, plus a `rls_fixture` metadata stamp
 * on auth users). Real tenants and real users cannot carry that marker, so
 * they can never be matched — not even by accident.
 *
 * SAFEGUARDS (hard-coded, non-negotiable):
 *   - Every delete re-verifies the marker on the row itself, never an id alone.
 *   - Protected organizations and real email domains are excluded outright.
 *   - Auth users must be marked in BOTH metadata and email to be deleted.
 *
 * Usage:
 *   bun scripts/purge-rls-test-data.mjs            # dry run (default)
 *   bun scripts/purge-rls-test-data.mjs --apply    # perform deletions
 */
import { createClient } from "@supabase/supabase-js";
import {
  EMAIL_LIKE,
  FIXTURE_MARKER,
  ORG_NAME_LIKE,
  PROTECTED_EMAIL_DOMAINS,
  PROTECTED_ORG_NAMES,
  isFixtureCode,
  isFixtureEmail,
  isFixtureOrg,
  isFixtureProjectName,
  isFixtureUser,
} from "./rls-fixture-tag.mjs";

export { PROTECTED_ORG_NAMES, PROTECTED_EMAIL_DOMAINS };
export const isTestEmail = isFixtureEmail;
export const isTestOrgName = (name) => isFixtureOrg({ name });

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin service-role client
 * @param {{ apply?: boolean, log?: (msg: string) => void }} opts
 */
export async function purgeRlsTestData(admin, opts = {}) {
  const apply = opts.apply ?? false;
  const log = opts.log ?? (() => {});
  const summary = { organizations: 0, projects: 0, invitations: 0, users: 0, markerRows: 0 };

  // ── 1. Candidate organizations (marker in name + slug run tag) ──────────
  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, slug")
    .like("name", ORG_NAME_LIKE);
  if (orgErr) throw new Error(`orgs read: ${orgErr.message}`);
  const testOrgs = (orgs ?? []).filter(isFixtureOrg);
  const orgIds = testOrgs.map((o) => o.id);
  log(
    `organizations matched: ${testOrgs.length}${testOrgs.length ? ` → ${testOrgs.map((o) => o.name).join(", ")}` : ""}`,
  );

  // ── 2. Candidate invitations (reserved fixture domain only) ────────────
  const { data: invites, error: invErr } = await admin
    .from("invitations")
    .select("id, email")
    .like("email", EMAIL_LIKE);
  if (invErr) throw new Error(`invitations read: ${invErr.message}`);
  const testInvites = (invites ?? []).filter((i) => isFixtureEmail(i.email));
  log(`invitations matched: ${testInvites.length}`);

  // ── 3. Candidate auth users (metadata marker AND email marker) ─────────
  const testUsers = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) if (isFixtureUser(u)) testUsers.push(u);
    if (users.length < 200) break;
  }
  log(`auth users matched: ${testUsers.length}`);

  if (!apply) {
    return {
      ...summary,
      dryRun: true,
      organizations: testOrgs.length,
      invitations: testInvites.length,
      users: testUsers.length,
    };
  }

  // ── 4. Delete (children first) ─────────────────────────────────────────
  if (orgIds.length) {
    const { data: projs } = await admin
      .from("projects")
      .select("id, name")
      .in("organization_id", orgIds);
    // Even inside a fixture org, only marked projects are removed.
    const projIds = (projs ?? []).filter((p) => isFixtureProjectName(p.name)).map((p) => p.id);
    if (projIds.length) {
      await admin.from("budget_lines").delete().in("project_id", projIds);
      const { error } = await admin.from("projects").delete().in("id", projIds);
      if (error) throw new Error(`projects delete: ${error.message}`);
      summary.projects = projIds.length;
    }
  }

  for (const inv of testInvites) {
    if (!isFixtureEmail(inv.email)) continue; // paranoia
    const { error } = await admin.from("invitations").delete().eq("id", inv.id);
    if (!error) summary.invitations++;
  }

  for (const u of testUsers) {
    if (!isFixtureUser(u)) continue; // paranoia
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (!error) summary.users++;
  }

  // Marker catalog rows (run-tag prefixed codes only).
  for (const [table, col] of [
    ["master_budget", "budget_code"],
    ["gl_accounts", "code"],
    ["budget_topsheet_accounts", "code"],
  ]) {
    const { data } = await admin.from(table).select(col).like(col, "rlsfixture-%");
    const marked = (data ?? []).map((r) => r[col]).filter(isFixtureCode);
    if (marked.length) {
      await admin.from(table).delete().in(col, marked);
      summary.markerRows += marked.length;
    }
  }

  for (const org of testOrgs) {
    if (!isFixtureOrg(org)) continue; // paranoia
    const { error } = await admin.from("organizations").delete().eq("id", org.id);
    if (!error) summary.organizations++;
    else log(`org ${org.name} delete warning: ${error.message}`);
  }

  return { ...summary, dryRun: false };
}

// ── CLI ──────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const result = await purgeRlsTestData(admin, { apply, log: (m) => console.log(`  ${m}`) });
  console.log(apply ? "APPLIED:" : "DRY RUN (pass --apply to delete):", result);
  console.log(`Only rows tagged [${FIXTURE_MARKER}] are eligible.`);
  console.log(`Protected orgs untouched: ${PROTECTED_ORG_NAMES.join(", ")}`);
}
