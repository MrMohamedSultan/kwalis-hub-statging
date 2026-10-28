// ═══════════════════════════════════════════════════════════════════
// Crew & Cast Deal Summary (N09) — one row per PERSON with all contracts.
//
// The only place these figures are computed, so the definitions can be
// re-pointed when the position views change (glossary batch). Inputs are
// plain rows read from: people (contracts), payroll (contract value / net),
// v_payroll_instalments (182 — instalment status, gross, net) and payments
// (money out per payroll row). All amounts in the project base currency
// (SAR): payroll.total_amount is stored in base already.
//
// Glossary (context.md):
//   Contract value = gross agreed on the contracts (WHT included)
//   Actual         = instalments Approved or Paid (gross)
//   Commitment     = contract value − actual
//   Paid           = money that left the bank (payments ledger; net of WHT)
//   Payable        = actual not yet paid — to the person, so on the NET side:
//                    net of the Approved/Paid instalments − paid (never < 0)
//   WHT            = gross − net on the contracts
// ═══════════════════════════════════════════════════════════════════

export type DealContract = {
  id: string;
  personId: string | null;
  fullName: string;
  kind: "crew" | "cast";
  position?: string | null;
  character?: string | null;
};
export type DealPayroll = {
  id: string;
  refId: string | null;
  totalAmount: number;
  netPayable: number | null;
};
export type DealInstalment = {
  payrollId: string;
  status: string;
  grossAmount: number;
  netAmount: number;
};
export type DealPayment = { sourceId: string | null; amount: number };

export type DealSummaryRow = {
  /** person id, or `contract:<id>` for a contract not linked to a profile */
  key: string;
  personId: string | null;
  name: string;
  kinds: ("crew" | "cast")[];
  roles: string[];
  contracts: number;
  value: number;
  actual: number;
  paid: number;
  payable: number;
  commitment: number;
  wht: number;
};

const ACTUAL_STATUSES = new Set(["approved", "paid"]);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function computeDealSummary(input: {
  contracts: DealContract[];
  payroll: DealPayroll[];
  instalments: DealInstalment[];
  payments: DealPayment[];
  personNames?: Map<string, string>;
}): DealSummaryRow[] {
  const payrollByContract = new Map<string, DealPayroll>();
  for (const p of input.payroll) if (p.refId) payrollByContract.set(p.refId, p);
  const instByPayroll = new Map<string, DealInstalment[]>();
  for (const i of input.instalments) {
    const list = instByPayroll.get(i.payrollId) ?? [];
    list.push(i);
    instByPayroll.set(i.payrollId, list);
  }
  const paidByPayroll = new Map<string, number>();
  for (const p of input.payments) {
    if (!p.sourceId) continue;
    paidByPayroll.set(p.sourceId, (paidByPayroll.get(p.sourceId) ?? 0) + num(p.amount));
  }

  const rows = new Map<string, DealSummaryRow & { actualNet: number }>();
  for (const c of input.contracts) {
    const key = c.personId ?? `contract:${c.id}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        personId: c.personId,
        name: (c.personId && input.personNames?.get(c.personId)) || c.fullName || "—",
        kinds: [],
        roles: [],
        contracts: 0,
        value: 0,
        actual: 0,
        paid: 0,
        payable: 0,
        commitment: 0,
        wht: 0,
        actualNet: 0,
      };
      rows.set(key, row);
    }
    row.contracts += 1;
    if (!row.kinds.includes(c.kind)) row.kinds.push(c.kind);
    const role = (c.kind === "cast" ? c.character : c.position)?.trim();
    if (role && !row.roles.includes(role)) row.roles.push(role);

    const pr = payrollByContract.get(c.id);
    if (!pr) continue;
    const gross = num(pr.totalAmount);
    const net = pr.netPayable == null ? gross : num(pr.netPayable);
    row.value += gross;
    row.wht += Math.max(0, gross - net);
    for (const i of instByPayroll.get(pr.id) ?? []) {
      if (!ACTUAL_STATUSES.has(String(i.status).toLowerCase())) continue;
      row.actual += num(i.grossAmount);
      row.actualNet += num(i.netAmount);
    }
    row.paid += paidByPayroll.get(pr.id) ?? 0;
  }

  return [...rows.values()]
    .map(({ actualNet, ...r }) => ({
      ...r,
      value: r2(r.value),
      actual: r2(r.actual),
      paid: r2(r.paid),
      wht: r2(r.wht),
      commitment: r2(Math.max(0, r.value - r.actual)),
      payable: r2(Math.max(0, actualNet - r.paid)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Column totals of the summary. */
export function dealSummaryTotals(rows: DealSummaryRow[]) {
  const t = { contracts: 0, value: 0, actual: 0, paid: 0, payable: 0, commitment: 0, wht: 0 };
  for (const r of rows) {
    t.contracts += r.contracts;
    t.value += r.value;
    t.actual += r.actual;
    t.paid += r.paid;
    t.payable += r.payable;
    t.commitment += r.commitment;
    t.wht += r.wht;
  }
  return {
    ...t,
    value: r2(t.value),
    actual: r2(t.actual),
    paid: r2(t.paid),
    payable: r2(t.payable),
    commitment: r2(t.commitment),
    wht: r2(t.wht),
  };
}
