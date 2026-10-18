#!/usr/bin/env node
/**
 * Index suggestion helper (READ-ONLY)
 * -----------------------------------
 * Analyzes the live database and recommends PostgreSQL indexes. It never
 * creates, alters, or deletes anything — it only prints suggested SQL you
 * can copy into a migration after review.
 *
 * What it looks at:
 *   1. Sequential scans      — pg_stat_user_tables: big tables read by seq scan.
 *   2. Slow statements       — pg_stat_statements (if available), ranked by total time.
 *   3. Tenant-scope columns  — organization_id / project_id / user_id / *_by columns
 *                              that RLS policies filter on but have no index.
 *   4. Foreign keys          — FK columns with no supporting index (slow joins + cascades).
 *
 * Usage:
 *   node scripts/index-advisor.mjs            # human-readable report
 *   node scripts/index-advisor.mjs --sql      # only the suggested CREATE INDEX statements
 *   node scripts/index-advisor.mjs --json     # machine-readable output (CI friendly)
 *   node scripts/index-advisor.mjs --fail-on-suggestions   # exit 1 if anything is suggested
 *
 * Requires managed Postgres env vars (PGHOST/PGUSER/PGPASSWORD/PGDATABASE).
 */

import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const AS_SQL = args.has("--sql");
const AS_JSON = args.has("--json");
const FAIL_ON_SUGGESTIONS = args.has("--fail-on-suggestions");

if (!process.env.PGHOST) {
  console.error("index-advisor: PGHOST is not set — cannot reach the database.");
  process.exit(2);
}

/** Run a read-only query and return rows as arrays of strings. */
function q(sql) {
  const out = execFileSync("psql", ["-At", "-F", "\u0001", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.trim()
    ? out
        .trim()
        .split("\n")
        .map((l) => l.split("\u0001"))
    : [];
}

function safeQ(sql, label) {
  try {
    return q(sql);
  } catch (e) {
    if (!AS_JSON && !AS_SQL)
      console.log(`  (skipped ${label}: ${String(e.message).split("\n")[0]})`);
    return null;
  }
}

// ── Thresholds (tunable via env) ─────────────────────────────────────────
const MIN_ROWS = Number(process.env.ADVISOR_MIN_ROWS ?? 500); // ignore tiny tables
const MIN_SEQ_SCANS = Number(process.env.ADVISOR_MIN_SEQ_SCANS ?? 50); // ignore rare scans
const SLOW_MEAN_MS = Number(process.env.ADVISOR_SLOW_MEAN_MS ?? 50);

// Columns that almost always carry tenant / ownership scoping in this app.
const SCOPE_COLUMNS = [
  "organization_id",
  "project_id",
  "user_id",
  "owner_id",
  "budget_code",
  "source_id",
  "payroll_run_id",
];

const suggestions = [];
function suggest({ table, columns, reason, priority }) {
  const cols = Array.isArray(columns) ? columns : [columns];
  const name = `idx_${table}_${cols.join("_")}`.slice(0, 63);
  const sql = `CREATE INDEX IF NOT EXISTS ${name} ON public.${table} (${cols.join(", ")});`;
  if (suggestions.some((s) => s.sql === sql)) return;
  suggestions.push({ table, columns: cols, reason, priority, sql });
}

// ── 1. Existing index map ────────────────────────────────────────────────
const indexRows = q(`
  select tablename, indexdef
  from pg_indexes
  where schemaname = 'public'
`);
const indexesByTable = new Map();
for (const [t, def] of indexRows) {
  if (!indexesByTable.has(t)) indexesByTable.set(t, []);
  indexesByTable.get(t).push(def);
}
/** true when `column` is the leading column of some index on `table`. */
function hasLeadingIndex(table, column) {
  return (indexesByTable.get(table) ?? []).some((def) =>
    new RegExp(`\\(\\s*${column}\\b`).test(def),
  );
}

// ── 2. Table statistics ──────────────────────────────────────────────────
const tableStats = q(`
  select relname,
         coalesce(seq_scan, 0),
         coalesce(idx_scan, 0),
         coalesce(n_live_tup, 0)
  from pg_stat_user_tables
  where schemaname = 'public'
`).map(([relname, seq, idx, rows]) => ({
  table: relname,
  seqScan: Number(seq),
  idxScan: Number(idx),
  rows: Number(rows),
}));
const statByTable = new Map(tableStats.map((s) => [s.table, s]));

const hotTables = tableStats.filter(
  (s) => s.rows >= MIN_ROWS && s.seqScan >= MIN_SEQ_SCANS && s.seqScan > s.idxScan,
);

// ── 3. Tenant-scope columns without an index ─────────────────────────────
const scopeCols = q(`
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
    and column_name in (${SCOPE_COLUMNS.map((c) => `'${c}'`).join(",")})
`);
for (const [table, column] of scopeCols) {
  const stat = statByTable.get(table);
  if (!stat) continue;
  if (hasLeadingIndex(table, column)) continue;
  const hot = hotTables.some((h) => h.table === table);
  if (!hot && stat.rows < MIN_ROWS) continue;
  suggest({
    table,
    columns: column,
    priority: hot ? "high" : "medium",
    reason:
      `RLS and app queries filter ${table}.${column}; no index has it as the leading column` +
      (hot ? ` (table has ${stat.seqScan} sequential scans over ~${stat.rows} rows)` : ""),
  });
}

// ── 4. Foreign keys without a supporting index ───────────────────────────
const fks = q(`
  select c.conrelid::regclass::text as tbl,
         a.attname as col
  from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace
  join unnest(c.conkey) with ordinality k(attnum, ord) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.contype = 'f' and n.nspname = 'public' and k.ord = 1
`);
for (const [rawTable, column] of fks) {
  const table = rawTable.replace(/^public\./, "");
  if (hasLeadingIndex(table, column)) continue;
  const stat = statByTable.get(table);
  if (!stat || stat.rows < MIN_ROWS) continue;
  suggest({
    table,
    columns: column,
    priority: "medium",
    reason: `Foreign key ${table}.${column} has no supporting index — joins and cascading deletes will scan`,
  });
}

// ── 5. Slow statements from pg_stat_statements (optional extension) ──────
const slow = safeQ(
  `select calls, round(mean_exec_time::numeric, 2), round(total_exec_time::numeric, 2),
          left(regexp_replace(query, '\\s+', ' ', 'g'), 240)
   from pg_stat_statements s
   join pg_database d on d.oid = s.dbid and d.datname = current_database()
   where query not ilike '%pg_stat%' and query not ilike '%information_schema%'
     and mean_exec_time >= ${SLOW_MEAN_MS}
   order by total_exec_time desc
   limit 15`,
  "pg_stat_statements",
);
const slowQueries = (slow ?? []).map(([calls, mean, total, query]) => ({
  calls: Number(calls),
  meanMs: Number(mean),
  totalMs: Number(total),
  query,
}));

// Seq-scan hot tables with no obvious suggestion yet still deserve a flag.
for (const h of hotTables) {
  if (suggestions.some((s) => s.table === h.table)) continue;
  suggestions.push({
    table: h.table,
    columns: [],
    priority: "review",
    reason: `${h.seqScan} sequential scans over ~${h.rows} rows — run EXPLAIN (ANALYZE, BUFFERS) on its hottest query to pick an index`,
    sql: `-- review: EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM public.${h.table} WHERE ...;`,
  });
}

// ── Output ───────────────────────────────────────────────────────────────
const order = { high: 0, medium: 1, review: 2 };
suggestions.sort((a, b) => order[a.priority] - order[b.priority] || a.table.localeCompare(b.table));

if (AS_JSON) {
  console.log(JSON.stringify({ suggestions, slowQueries, hotTables }, null, 2));
} else if (AS_SQL) {
  for (const s of suggestions) console.log(s.sql);
} else {
  console.log("\n=== Index Advisor (read-only) ===\n");
  if (hotTables.length) {
    console.log("Tables dominated by sequential scans:");
    for (const h of hotTables)
      console.log(`  • ${h.table.padEnd(28)} seq=${h.seqScan}  idx=${h.idxScan}  rows≈${h.rows}`);
    console.log("");
  }
  if (slowQueries.length) {
    console.log("Slowest statements (pg_stat_statements):");
    for (const s of slowQueries)
      console.log(
        `  • mean ${s.meanMs}ms × ${s.calls} calls (total ${s.totalMs}ms)\n      ${s.query}`,
      );
    console.log("");
  }
  if (!suggestions.length) {
    console.log("No index gaps detected. Tenant-scope and foreign-key columns look covered.\n");
  } else {
    console.log(`${suggestions.length} suggestion(s):\n`);
    for (const s of suggestions) {
      console.log(
        `  [${s.priority}] ${s.table}${s.columns.length ? ` (${s.columns.join(", ")})` : ""}`,
      );
      console.log(`      why: ${s.reason}`);
      console.log(`      sql: ${s.sql}\n`);
    }
    console.log(
      "Review each suggestion, then apply it through a migration. This script changes nothing.\n",
    );
  }
}

const actionable = suggestions.filter((s) => s.priority !== "review").length;
process.exit(FAIL_ON_SUGGESTIONS && actionable > 0 ? 1 : 0);
