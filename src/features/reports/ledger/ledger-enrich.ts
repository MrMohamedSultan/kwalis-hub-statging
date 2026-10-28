// =====================================================================
// R03 — General Ledger columns that the journal itself does not carry:
//   - QPE: read from the ONE Film Commission eligibility source,
//     rebate_transactions() (db/pending/197), not the old invoice flag.
//     A payment line takes the eligibility of the document it pays.
//   - Department: when the journal line has none (instalments, overtime,
//     per diem…), the budget header of its budget code (2101 → 2100 name).
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { GeneralLedgerLine } from "@/lib/ledger-calc";
import {
  baseBudgetCode,
  headerNameForBudgetLine,
  isHeaderBudgetCode,
  type ProjectBudgetLine,
} from "@/lib/project-budget-lines";

export type QpeStatus = "eligible" | "not_eligible" | "needs_review";
export type LedgerQpeLine = GeneralLedgerLine & { qpe_status: QpeStatus | null };

/** rebate_transactions() source per journal event / payment source type. */
const EVENT_SOURCE: Record<string, string> = {
  invoice: "invoice",
  instalment: "payroll",
  overtime: "overtime",
  per_diem: "per_diem",
  petty_receipt: "petty_cash",
};
const PAYMENT_SOURCE: Record<string, string> = {
  invoice: "invoice",
  payroll: "payroll",
  overtime: "overtime",
  per_diem: "per_diem",
  receipt: "petty_cash",
  cash_advance_receipt: "petty_cash",
};

export type LedgerEnrichment = {
  /** `${source}:${source_id}` → status, from rebate_transactions(). */
  qpe: Map<string, QpeStatus>;
  /** payment id → [source_type, source_id]. */
  payments: Map<string, [string, string]>;
  /** budget code → department label (budget header). */
  department: (code: string) => string | null;
};

/** The rebate_transactions() key of a ledger event (null when not a QPE document). */
export function qpeKeyForEvent(
  eventKey: string,
  payments: Map<string, [string, string]>,
): string | null {
  const [kind, id] = eventKey.split(":");
  if (!kind || !id) return null;
  if (kind === "payment") {
    const src = payments.get(id);
    const source = src ? PAYMENT_SOURCE[src[0]] : undefined;
    return source && src ? `${source}:${src[1]}` : null;
  }
  const source = EVENT_SOURCE[kind];
  return source ? `${source}:${id}` : null;
}

/** Pure: fill QPE status and the missing department on each line (unit-tested). */
export function enrichLedgerLines(
  lines: GeneralLedgerLine[],
  e: LedgerEnrichment | null,
): LedgerQpeLine[] {
  return lines.map((l) => {
    if (!e) return { ...l, qpe_status: l.qpe_eligible ? "eligible" : null };
    const key = qpeKeyForEvent(l.event_key, e.payments);
    const status = key ? (e.qpe.get(key) ?? null) : null;
    const department =
      (l.department ?? "").trim() || (l.budget_code ? e.department(l.budget_code) : null);
    return {
      ...l,
      department: department || null,
      qpe_status: status,
      qpe_eligible: status === "eligible",
    };
  });
}

type BudgetRow = { headerCode: string; mainCode: string; description: string; name?: string };

/**
 * Budget code → its header ("2100 CAMERA"), from the project's budget lines.
 * `nameOf` resolves a header code's title (defaults to the header row's own
 * description; the hook passes the Master Chart of Accounts fallback too).
 */
export function departmentResolver(
  lines: BudgetRow[],
  nameOf?: (header: string) => string,
): (code: string) => string | null {
  const byCode = new Map<string, string>();
  const names = new Map<string, string>();
  for (const l of lines) {
    const main = baseBudgetCode(String(l.mainCode ?? ""));
    const header = baseBudgetCode(String(l.headerCode ?? ""));
    if (main && isHeaderBudgetCode(header)) byCode.set(main, header);
    if (main && isHeaderBudgetCode(main)) {
      const own = (l.description || l.name || "").trim();
      if (own) names.set(main, own);
    }
  }
  const cache = new Map<string, string | null>();
  return (code: string) => {
    if (cache.has(code)) return cache.get(code)!;
    const c = baseBudgetCode(code);
    const header = isHeaderBudgetCode(c)
      ? c
      : (byCode.get(c) ?? (/^\d{4}$/.test(c) ? `${c.slice(0, 2)}00` : null));
    let out: string | null = null;
    if (header) {
      const name = (nameOf?.(header) ?? "").trim() || names.get(header) || "";
      out = name && name !== header ? `${header} ${name}` : header;
    }
    cache.set(code, out);
    return out;
  };
}

const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<any>)(fn, args);
const table = (name: string) => (supabase.from as unknown as (n: string) => any)(name);

/** Loads the eligibility rows and the payment → document links for one project. */
export function useLedgerEnrichment(
  projectId: string | null,
  budget: BudgetRow[],
): LedgerEnrichment | null {
  const [state, setState] = useState<Omit<LedgerEnrichment, "department"> | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const [tx, pays] = await Promise.all([
        rpc("rebate_transactions", { p_project_id: projectId }),
        table("payments")
          .select("id, source_type, source_id")
          .eq("project_id", projectId)
          .limit(50000),
      ]);
      if (cancelled) return;
      const qpe = new Map<string, QpeStatus>();
      for (const r of (tx?.data ?? []) as { source: string; source_id: string; status: string }[])
        if (r.source && r.source_id) qpe.set(`${r.source}:${r.source_id}`, r.status as QpeStatus);
      const payments = new Map<string, [string, string]>();
      for (const p of (pays?.data ?? []) as {
        id: string;
        source_type: string | null;
        source_id: string | null;
      }[])
        if (p.source_type && p.source_id) payments.set(p.id, [p.source_type, p.source_id]);
      // Without the eligibility source (old server) keep the journal's own flag.
      setState(tx?.error ? null : { qpe, payments });
    })().catch(() => !cancelled && setState(null));
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const department = useMemo(
    () =>
      departmentResolver(budget, (h) => {
        const n = headerNameForBudgetLine(h, budget as unknown as ProjectBudgetLine[]);
        // its last-resort answers are a group tag, not a department name
        return /^(budget|atl|btl|post|music|vfx|other)$/i.test(n) ? "" : n;
      }),
    [budget],
  );
  return state ? { ...state, department } : null;
}
