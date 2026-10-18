#!/usr/bin/env node
/**
 * Automated RLS regression test suite
 * ------------------------------------
 * Verifies that budget_lines, gl_accounts, budget_topsheet_accounts, and
 * master_budget only expose the rows a caller is authorized to see, for
 * every meaningful role (platform admin, org admin, project-only member,
 * cross-org admin, no-org user).
 *
 * How it works:
 *   1. Uses the service-role client to mint five ephemeral test users, two
 *      test organizations, three projects, and marker rows in the four
 *      target tables. All fixtures use a `RLS-TEST-` prefix so they are
 *      easy to spot and clean up.
 *   2. For each test user, opens a fresh anon-key client and signs them in
 *      to get a real JWT. Queries run through PostgREST just like the
 *      production app — so RLS is exercised end-to-end.
 *   3. Asserts the returned row count matches expectation and prints
 *      PASS / FAIL per scenario.
 *   4. Always runs teardown, even on failure, and exits non-zero if any
 *      check failed (perfect for CI).
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY.
 * Run:      bun scripts/rls-regression.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  createRunTag,
  fixtureEmail,
  fixtureName,
  fixtureSlug,
  fixtureUserMetadata,
  isFixtureUser,
} from "./rls-fixture-tag.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY env vars.",
  );
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Marker so all fixtures for this run are unique and easy to purge.
const runTag = createRunTag();

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}  ${detail}`);
}

async function makeUser(label) {
  const email = fixtureEmail(runTag, label);
  const password = `Rls-${randomUUID()}!A1`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // Dedicated fixture marker — the purge requires this stamp.
    user_metadata: fixtureUserMetadata(runTag),
  });
  if (error) throw new Error(`create ${label}: ${error.message}`);
  return { id: data.user.id, email, password };
}

async function signInAs(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signin ${email}: ${error.message}`);
  return client;
}

/** Count matching rows via a scoped client. */
async function count(client, table, filter) {
  let q = client.from(table).select("*", { count: "exact", head: true });
  for (const [col, val] of Object.entries(filter)) q = q.eq(col, val);
  const { count, error } = await q;
  if (error) throw new Error(`${table} query: ${error.message}`);
  return count ?? 0;
}

async function main() {
  // The public.handle_new_user trigger enforces invitation-only signup, so
  // we must create orgs → projects → invitations BEFORE creating the auth
  // users. The trigger then wires each new user into the target org/project.

  // ── 1. Orgs ───────────────────────────────────────────────────────────
  const orgA = randomUUID();
  const orgB = randomUUID();
  {
    const { error } = await admin.from("organizations").insert([
      { id: orgA, name: fixtureName(runTag, "orgA"), slug: fixtureSlug(runTag, "a") },
      { id: orgB, name: fixtureName(runTag, "orgB"), slug: fixtureSlug(runTag, "b") },
    ]);
    if (error) throw new Error(`orgs: ${error.message}`);
  }

  // ── 2. Invitations for the admin users (no project ref yet) ───────────
  async function invite(label, opts) {
    const { error } = await admin.from("invitations").insert({
      email: fixtureEmail(runTag, label),
      organization_id: opts.organization_id,
      org_role: opts.org_role ?? "member",
      project_id: opts.project_id ?? null,
      project_role: opts.project_role ?? null,
    });
    if (error) throw new Error(`invite ${label}: ${error.message}`);
  }

  await invite("orgA-admin", { organization_id: orgA, org_role: "admin" });
  await invite("orgB-admin", { organization_id: orgB, org_role: "admin" });

  const uOrgAAdmin = await makeUser("orgA-admin");
  const uOrgBAdmin = await makeUser("orgB-admin");

  // ── 3. Projects (owner_id must be a real user) ────────────────────────
  const projA1 = randomUUID();
  const projA2 = randomUUID();
  const projB1 = randomUUID();
  const shortCode = () => "RLS" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const projRow = (id, org, name, owner) => ({
    id,
    organization_id: org,
    name,
    status: "Production",
    owner_id: owner,
    budget: 0,
    team_members: [],
    currency: "SAR",
    project_type: "Feature Film",
    code: shortCode(),
    production_kind: "film",
    budget_status: "Draft",
    fx_rate: 1,
  });
  {
    const { error } = await admin
      .from("projects")
      .insert([
        projRow(projA1, orgA, fixtureName(runTag, "A1"), uOrgAAdmin.id),
        projRow(projA2, orgA, fixtureName(runTag, "A2"), uOrgAAdmin.id),
        projRow(projB1, orgB, fixtureName(runTag, "B1"), uOrgBAdmin.id),
      ]);
    if (error) throw new Error(`projects: ${error.message}`);
  }

  // ── 4. Invitations for remaining users, then create them ──────────────
  await invite("super", { organization_id: orgA }); // detached post-signup
  await invite("orgA-proj", { organization_id: orgA, project_id: projA1, project_role: "member" });
  await invite("noorg", { organization_id: orgA }); // detached post-signup

  const uSuper = await makeUser("super");
  const uOrgAProj = await makeUser("orgA-proj");
  const uNoOrg = await makeUser("noorg");

  // ── 4. Post-signup adjustments ────────────────────────────────────────
  // Detach the "super" and "noorg" users from orgA so their scope is clean.
  {
    const { error } = await admin
      .from("organization_members")
      .delete()
      .in("user_id", [uSuper.id, uNoOrg.id]);
    if (error) throw new Error(`detach members: ${error.message}`);
  }
  // Promote super_admin (upsert-safe).
  {
    const { error } = await admin
      .from("user_roles")
      .upsert({ user_id: uSuper.id, role: "super_admin" }, { onConflict: "user_id,role" });
    if (error) throw new Error(`promote super: ${error.message}`);
  }

  // ── 3. Seed table fixtures ────────────────────────────────────────────
  const mainA1 = `${runTag}-BL-A1`;
  const mainA2 = `${runTag}-BL-A2`;
  const mainB1 = `${runTag}-BL-B1`;
  const glCode = `${runTag}-GL`;
  const tsCode = `${runTag}-TS`;
  const mbGlobal = `${runTag}-MB-G`;
  const mbOrgA = `${runTag}-MB-A`;
  const mbOrgB = `${runTag}-MB-B`;

  {
    const { error } = await admin.from("budget_lines").insert([
      {
        project_id: projA1,
        organization_id: orgA,
        header_code: "H1",
        main_code: mainA1,
        description: "A1",
        amount: 100,
        rate: 1,
      },
      {
        project_id: projA2,
        organization_id: orgA,
        header_code: "H1",
        main_code: mainA2,
        description: "A2",
        amount: 200,
        rate: 1,
      },
      {
        project_id: projB1,
        organization_id: orgB,
        header_code: "H1",
        main_code: mainB1,
        description: "B1",
        amount: 300,
        rate: 1,
      },
    ]);
    if (error) throw new Error(`budget_lines: ${error.message}`);
  }
  {
    const { error } = await admin.from("master_budget").insert([
      { budget_code: mbGlobal, description: "shared", is_header: true, level: 1 },
      {
        budget_code: mbOrgA,
        description: "orgA",
        is_header: true,
        level: 1,
        organization_id: orgA,
      },
      {
        budget_code: mbOrgB,
        description: "orgB",
        is_header: true,
        level: 1,
        organization_id: orgB,
      },
    ]);
    if (error) throw new Error(`master_budget: ${error.message}`);
  }
  {
    const { error } = await admin
      .from("gl_accounts")
      .insert({ code: glCode, name: "RLS GL", category: "ATL" });
    if (error) throw new Error(`gl_accounts: ${error.message}`);
  }
  {
    const { error } = await admin
      .from("budget_topsheet_accounts")
      .insert({ code: tsCode, name: "RLS TS", section: "ATL" });
    if (error) throw new Error(`topsheet: ${error.message}`);
  }

  // ── 4. Sign each user in and run assertions ───────────────────────────
  const clients = {
    super: await signInAs(uSuper.email, uSuper.password),
    orgAAdmin: await signInAs(uOrgAAdmin.email, uOrgAAdmin.password),
    orgAProj: await signInAs(uOrgAProj.email, uOrgAProj.password),
    orgBAdmin: await signInAs(uOrgBAdmin.email, uOrgBAdmin.password),
    noOrg: await signInAs(uNoOrg.email, uNoOrg.password),
  };

  const blCodes = [mainA1, mainA2, mainB1];
  const mbCodes = [mbGlobal, mbOrgA, mbOrgB];

  async function bl(client) {
    const { data, error } = await client
      .from("budget_lines")
      .select("id, main_code")
      .in("main_code", blCodes);
    if (error) throw new Error(error.message);
    return data.length;
  }
  async function mb(client) {
    const { data, error } = await client
      .from("master_budget")
      .select("budget_code")
      .in("budget_code", mbCodes);
    if (error) throw new Error(error.message);
    return data.length;
  }

  /**
   * The header dropdown reads `description` for header rows. Guard that the
   * column is actually selectable through PostgREST for each role (a missing
   * column GRANT surfaces here as a permission error, not as empty data).
   */
  async function mbHeaderDescriptions(client) {
    const { data, error } = await client
      .from("master_budget")
      .select("budget_code, description")
      .eq("is_header", true)
      .in("budget_code", mbCodes);
    if (error) throw new Error(error.message);
    return data.filter((r) => (r.description ?? "").trim().length > 0).length;
  }

  const cases = [
    ["budget_lines / super admin sees all 3", () => bl(clients.super), 3],
    ["budget_lines / org A admin sees 2 (A1+A2)", () => bl(clients.orgAAdmin), 2],
    ["budget_lines / project A1 member sees only A1", () => bl(clients.orgAProj), 1],
    ["budget_lines / org B admin sees only B1", () => bl(clients.orgBAdmin), 1],
    ["budget_lines / no-org user sees zero", () => bl(clients.noOrg), 0],

    ["master_budget / super admin sees all 3 test rows", () => mb(clients.super), 3],
    ["master_budget / org A admin sees global + org A", () => mb(clients.orgAAdmin), 2],
    ["master_budget / org B admin sees global + org B", () => mb(clients.orgBAdmin), 2],
    ["master_budget / no-org user cannot read shared", () => mb(clients.noOrg), 0],

    // Header-description coverage — protects the cascading budget dropdown.
    [
      "master_budget / super admin reads header descriptions",
      () => mbHeaderDescriptions(clients.super),
      3,
    ],
    [
      "master_budget / org A admin reads header descriptions",
      () => mbHeaderDescriptions(clients.orgAAdmin),
      2,
    ],
    [
      "master_budget / org B admin reads header descriptions",
      () => mbHeaderDescriptions(clients.orgBAdmin),
      2,
    ],
    [
      "master_budget / project member reads shared header desc",
      () => mbHeaderDescriptions(clients.orgAProj),
      2,
    ],

    [
      "gl_accounts / org A admin sees shared catalog",
      () => count(clients.orgAAdmin, "gl_accounts", { code: glCode }),
      1,
    ],
    [
      "gl_accounts / org B admin sees shared catalog",
      () => count(clients.orgBAdmin, "gl_accounts", { code: glCode }),
      1,
    ],
    [
      "gl_accounts / no-org user sees shared catalog",
      () => count(clients.noOrg, "gl_accounts", { code: glCode }),
      1,
    ],

    [
      "topsheet / org A admin sees shared catalog",
      () => count(clients.orgAAdmin, "budget_topsheet_accounts", { code: tsCode }),
      1,
    ],
    [
      "topsheet / no-org user sees shared catalog",
      () => count(clients.noOrg, "budget_topsheet_accounts", { code: tsCode }),
      1,
    ],
  ];

  for (const [name, fn, expected] of cases) {
    try {
      const got = await fn();
      record(name, got === expected, `expected ${expected}, got ${got}`);
    } catch (e) {
      record(name, false, `error: ${e.message}`);
    }
  }

  // ── 5. Lightweight performance assertions ─────────────────────────────
  // These are smoke-level guards: they catch RLS policies or lookups that
  // degrade into sequential scans, not micro-benchmarks. Thresholds are
  // deliberately generous so normal network jitter never fails CI.
  await runPerfChecks(clients, { projA1, glCode, tsCode });
  await checkIndexes();
}

/** Median wall-clock ms of `runs` executions (first run discarded as warm-up). */
async function medianMs(fn, runs = 5) {
  await fn(); // warm-up
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const PERF_BUDGET_MS = Number(process.env.RLS_PERF_BUDGET_MS ?? 1500);

async function runPerfChecks(clients, ids) {
  const perfCases = [
    [
      "perf / budget_lines by project_id (org admin)",
      async () => {
        const { error } = await clients.orgAAdmin
          .from("budget_lines")
          .select("id, main_code, amount")
          .eq("project_id", ids.projA1)
          .limit(200);
        if (error) throw new Error(error.message);
      },
    ],
    [
      "perf / budget_lines by main_code (project member)",
      async () => {
        const { error } = await clients.orgAProj
          .from("budget_lines")
          .select("id")
          .like("main_code", "RLS%")
          .limit(200);
        if (error) throw new Error(error.message);
      },
    ],
    [
      "perf / master_budget catalog page (org admin)",
      async () => {
        const { error } = await clients.orgAAdmin
          .from("master_budget")
          .select("budget_code, description")
          .order("budget_code")
          .limit(200);
        if (error) throw new Error(error.message);
      },
    ],
    [
      "perf / master_budget by budget_code (org admin)",
      async () => {
        const { error } = await clients.orgAAdmin
          .from("master_budget")
          .select("budget_code")
          .eq("budget_code", "1000")
          .limit(1);
        if (error) throw new Error(error.message);
      },
    ],
    [
      "perf / gl_accounts by code (no-org user)",
      async () => {
        const { error } = await clients.noOrg
          .from("gl_accounts")
          .select("id, code, name")
          .eq("code", ids.glCode)
          .limit(1);
        if (error) throw new Error(error.message);
      },
    ],
    [
      "perf / budget_topsheet_accounts lookup",
      async () => {
        const { error } = await clients.orgAAdmin
          .from("budget_topsheet_accounts")
          .select("code, name")
          .eq("code", ids.tsCode)
          .limit(1);
        if (error) throw new Error(error.message);
      },
    ],
  ];

  for (const [name, fn] of perfCases) {
    try {
      const ms = await medianMs(fn);
      record(name, ms <= PERF_BUDGET_MS, `median ${ms.toFixed(0)}ms (budget ${PERF_BUDGET_MS}ms)`);
    } catch (e) {
      record(name, false, `error: ${e.message}`);
    }
  }
}

/**
 * Index coverage guard. Uses psql when managed PG* env vars are present;
 * skipped (not failed) otherwise so the suite still runs anywhere.
 */
const EXPECTED_INDEXES = [
  ["budget_lines", "project_id"],
  ["budget_lines", "main_code"],
  ["budget_lines", "topsheet_code"],
  ["master_budget", "budget_code"],
  ["master_budget", "parent_code"],
  ["master_budget", "topsheet_code"],
  ["gl_accounts", "code"],
  ["budget_topsheet_accounts", "code"],
];

async function checkIndexes() {
  if (!process.env.PGHOST) {
    console.log("SKIP  index coverage checks (no PGHOST in environment)");
    return;
  }
  const { execFileSync } = await import("node:child_process");
  let rows;
  try {
    const out = execFileSync(
      "psql",
      [
        "-At",
        "-F",
        "\t",
        "-c",
        `select tablename, indexdef from pg_indexes where schemaname='public'
         and tablename in ('budget_lines','master_budget','gl_accounts','budget_topsheet_accounts')`,
      ],
      { encoding: "utf8" },
    );
    rows = out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t"));
  } catch (e) {
    console.log(`SKIP  index coverage checks (psql unavailable: ${e.message})`);
    return;
  }

  for (const [table, column] of EXPECTED_INDEXES) {
    // Leading-column match: "... USING btree (col" or "(col,"
    const covered = rows.some(
      ([t, def]) => t === table && new RegExp(`\\(${column}[,)\\s]`).test(def),
    );
    record(
      `index / ${table}.${column} is indexed`,
      covered,
      covered ? "index present" : "MISSING index — lookups may seq-scan",
    );
  }
}

async function teardown() {
  // Delete only rows carrying this run's dedicated fixture marker.
  // master_budget is guarded against deletion; the guard makes an explicit
  // exception for the reserved `rlsfixture-` prefix, so a failure here means
  // fixtures would leak into the real catalog and must be reported.
  await admin.from("budget_lines").delete().like("main_code", `${runTag}-%`);
  {
    const { error } = await admin.from("master_budget").delete().like("budget_code", `${runTag}-%`);
    if (error)
      console.error(`Teardown warning — master_budget fixtures not removed: ${error.message}`);
  }
  await admin.from("gl_accounts").delete().like("code", `${runTag}-%`);
  await admin.from("budget_topsheet_accounts").delete().like("code", `${runTag}-%`);

  // Invitations were previously missed here, which is how fixtures leaked
  // into the UI. Always purge them for this run.
  await admin.from("invitations").delete().like("email", fixtureEmail(runTag, "%"));
  await admin
    .from("projects")
    .delete()
    .like("name", `${fixtureName(runTag, "")}%`);
  await admin
    .from("organizations")
    .delete()
    .like("name", `${fixtureName(runTag, "")}%`);

  // Delete ephemeral users we created (metadata marker + email marker).
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const u of data?.users ?? []) {
    if (isFixtureUser(u) && u.user_metadata?.rls_fixture_run === runTag) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }

  // Safety net: sweep any fixtures orphaned by an earlier crashed run.
  // Strictly pattern-matched and protective of real tenants — see
  // scripts/purge-rls-test-data.mjs.
  try {
    const { purgeRlsTestData } = await import("./purge-rls-test-data.mjs");
    const swept = await purgeRlsTestData(admin, { apply: true });
    if (swept.organizations || swept.invitations || swept.users) {
      console.log("Swept orphaned fixtures from earlier runs:", swept);
    }
  } catch (e) {
    console.error("Orphan sweep warning:", e.message);
  }
}

let exitCode = 0;
try {
  await main();
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) exitCode = 1;
} catch (e) {
  console.error("Runner error:", e);
  exitCode = 2;
} finally {
  try {
    await teardown();
  } catch (e) {
    console.error("Teardown warning:", e);
  }
  process.exit(exitCode);
}
