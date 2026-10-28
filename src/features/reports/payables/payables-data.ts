// =====================================================================
// Data for Payments Register (R12), Payments Due (N05), AP Aging (N06),
// Open Purchase Orders (N07) and Petty Cash Reconciliation (N08).
// Every query is scoped to the active project; RLS on each table and the
// access check inside the RPCs protect the rows. Columns added by the
// pending files are not in the generated types yet, hence the casts.
// =====================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invoiceAmountDue, round2 } from "@/lib/ap-calc";
import {
  resolveCashLimits,
  type CashLimits,
  type DueItem,
  type FloatInput,
  type OpenPoInput,
  type RegisterRow,
} from "@/lib/payables-reports";

const from = (t: string) => (supabase.from as unknown as (n: string) => any)(t);
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<any>)(fn, args);
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const toSar = (amount: unknown, currency: unknown, fx: unknown) =>
  !currency || String(currency).toUpperCase() === "SAR" ? n(amount) : n(amount) * (n(fx) || 1);

async function rows<T = any>(q: Promise<{ data: T[] | null; error: { message: string } | null }>) {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

/** R12: the register rows (db/pending/196 get_payments_register). */
export function usePaymentsRegister(projectId: string | null, fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ["payments-register", projectId, fromDate, toDate],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async (): Promise<RegisterRow[]> => {
      const { data, error } = await rpc("get_payments_register", {
        p_project_id: projectId,
        p_from: fromDate || null,
        p_to: toDate || null,
      });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        gross: n(r.gross),
        wht: n(r.wht),
        net: n(r.net),
      }));
    },
  });
}

/** N05 / N06: unpaid instalments and invoice balances of the project. */
export function useDueItems(projectId: string | null) {
  return useQuery({
    queryKey: ["payables-due", projectId],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async (): Promise<DueItem[]> => {
      const [inst, contracts, invoices, pays, pos] = await Promise.all([
        rows(
          from("payroll_instalments")
            .select(
              "payroll_id, milestone_id, seq, label, due_date, amount, status, contract_cancelled",
            )
            .eq("project_id", projectId)
            .neq("status", "Paid"),
        ),
        rows(
          from("payroll")
            .select("id, name, ref_no, ref_id, contract_cancelled_at")
            .eq("project_id", projectId),
        ),
        rows(
          from("invoices")
            .select(
              "id, vendor_name, invoice_no, ref_no, date, due_date, price, vat_amount, wht_amount, net_payable, " +
                // E08 (174 / 190)
                "purchase_order_id, currency, fx_rate, amount_original, fx_rate_source, fx_rate_date, " +
                "service_period_from, service_period_to, service_received_date, is_related_party, related_party_note",
            )
            .eq("project_id", projectId),
        ),
        rows(
          from("payments")
            .select("source_type, source_id, payroll_milestone_id, amount")
            .eq("project_id", projectId),
        ),
        rows(from("purchase_orders").select("id, ref_no, po_number").eq("project_id", projectId)),
      ]);
      const contract = new Map(contracts.map((c: any) => [c.id, c]));
      const poRef = new Map(
        (pos as any[]).map((p) => [
          p.id as string,
          (p.ref_no ?? p.po_number ?? null) as string | null,
        ]),
      );
      const paidInvoice = new Map<string, number>();
      for (const p of pays as any[])
        if (p.source_type === "invoice")
          paidInvoice.set(p.source_id, (paidInvoice.get(p.source_id) ?? 0) + n(p.amount));
      const out: DueItem[] = [];
      for (const i of inst as any[]) {
        const c: any = contract.get(i.payroll_id);
        if (!c || String(c.ref_id ?? "").startsWith("invoice:")) continue; // invoice splits: the invoice row counts
        // decision 3: a cancelled contract still owes its approved instalments, nothing else
        if (i.contract_cancelled && i.status !== "Approved") continue;
        out.push({
          key: `i:${i.payroll_id}:${i.milestone_id}`,
          kind: "instalment",
          payee: c.name ?? "—",
          ref: c.ref_no ?? null,
          instalment: i.label ?? `P${i.seq}`,
          dueDate: i.due_date ?? null,
          amount: round2(n(i.amount)),
          status: i.status,
          payable: i.status === "Approved",
          sourceId: i.payroll_id,
        });
      }
      for (const v of invoices as any[]) {
        const due =
          v.net_payable != null
            ? n(v.net_payable)
            : invoiceAmountDue({
                price: n(v.price),
                vatAmount: n(v.vat_amount),
                whtAmount: n(v.wht_amount),
              });
        const left = round2(due - (paidInvoice.get(v.id) ?? 0));
        if (left <= 0.005) continue;
        out.push({
          key: `v:${v.id}`,
          kind: "invoice",
          payee: v.vendor_name ?? "—",
          ref: v.ref_no ?? v.invoice_no ?? null,
          instalment: v.ref_no && v.invoice_no ? v.invoice_no : null,
          dueDate: v.due_date ?? v.date ?? null,
          amount: left,
          status: "Approved",
          payable: true,
          sourceId: v.id,
          e08: {
            poRef: v.purchase_order_id ? (poRef.get(v.purchase_order_id) ?? null) : null,
            currency: v.currency ?? null,
            fxRate: v.fx_rate != null ? n(v.fx_rate) : null,
            amountOriginal: v.amount_original != null ? n(v.amount_original) : null,
            fxRateSource: v.fx_rate_source ?? null,
            fxRateDate: v.fx_rate_date ?? null,
            servicePeriodFrom: v.service_period_from ?? null,
            servicePeriodTo: v.service_period_to ?? null,
            serviceReceivedDate: v.service_received_date ?? null,
            isRelatedParty: !!v.is_related_party,
            relatedPartyNote: v.related_party_note ?? null,
          },
        });
      }
      return out;
    },
  });
}

/** N07: purchase orders and the invoices matched to them. */
export function useOpenPoData(projectId: string | null) {
  return useQuery({
    queryKey: ["open-pos", projectId],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async () => {
      const [pos, invoices] = await Promise.all([
        rows(
          from("purchase_orders")
            .select(
              "id, ref_no, po_number, vendor_name, budget_code, status, date, amount, currency, fx_rate",
            )
            .eq("project_id", projectId),
        ),
        rows(from("invoices").select("purchase_order_id, price").eq("project_id", projectId)),
      ]);
      return {
        pos: (pos as any[]).map((p): OpenPoInput => ({
          id: p.id,
          ref: p.ref_no ?? p.po_number ?? null,
          vendor: p.vendor_name ?? null,
          budgetCode: p.budget_code ?? null,
          status: p.status ?? null,
          date: p.date ?? null,
          amount: n(p.amount),
        })),
        invoices: (invoices as any[]).map((i) => ({
          purchaseOrderId: i.purchase_order_id ?? null,
          price: n(i.price),
        })),
      };
    },
  });
}

export type PettyData = {
  floats: FloatInput[];
  receipts: { advanceId: string | null; amount: number; status: string }[];
  returns: { cashAdvanceId: string | null; amount: number }[];
  limits: CashLimits;
  /** Cash spent: approved receipts + payments made in cash (SAR). */
  cashSpent: number;
  /** Spend the cash share is measured against (see the screen note). */
  qpeBase: number;
  largestCash: number;
};

/** N08: floats, receipts, returns, cash limits (project_rebate_settings when present). */
export function usePettyData(projectId: string | null) {
  return useQuery({
    queryKey: ["petty-recon", projectId],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async (): Promise<PettyData> => {
      const [floats, receipts, moves, pays, pos] = await Promise.all([
        rows(
          from("cash_advances")
            .select("id, holder, ref_no, total_advance, status, currency, fx_rate")
            .eq("project_id", projectId),
        ),
        rows(
          from("cash_advance_receipts")
            .select("advance_id, amount, status, currency, fx_rate")
            .eq("project_id", projectId),
        ),
        rows(
          from("treasury_movements")
            .select("kind, cash_advance_id, amount")
            .eq("project_id", projectId)
            .eq("kind", "petty_cash_return"),
        ),
        rows(
          from("payments")
            .select("source_type, source_id, amount, method")
            .eq("project_id", projectId),
        ),
        rows(from("v_project_position").select("actual_sar").eq("project_id", projectId)),
      ]);
      // E10 settings come from the Film Commission batch (db/pending/197); until
      // that table exists (or has no limits) the defaults are used and shown so.
      let settings: Record<string, unknown> | null = null;
      try {
        const { data, error } = await from("project_rebate_settings")
          .select("cash_limit_pct_of_qpe, cash_limit_per_txn_sar")
          .eq("project_id", projectId)
          .maybeSingle();
        if (!error) settings = (data as Record<string, unknown> | null) ?? null;
      } catch {
        settings = null;
      }
      const paidToFloat = new Map<string, number>();
      for (const p of pays as any[])
        if (p.source_type === "petty_cash" || p.source_type === "cash_advance")
          paidToFloat.set(p.source_id, (paidToFloat.get(p.source_id) ?? 0) + n(p.amount));
      const rs = (receipts as any[]).map((r) => ({
        advanceId: r.advance_id ?? null,
        amount: round2(toSar(r.amount, r.currency, r.fx_rate)),
        status: String(r.status ?? "pending"),
      }));
      const cashPays = (pays as any[]).filter((p) => p.method === "Cash").map((p) => n(p.amount));
      const approved = rs.filter((r) => r.status === "approved").map((r) => r.amount);
      return {
        // issued: payments recorded against the float, else the approved float (same rule as the ledger)
        floats: (floats as any[])
          .filter((f) => ["open", "approved", "closed"].includes(f.status) || paidToFloat.has(f.id))
          .map((f) => ({
            id: f.id,
            holder: f.holder ?? "—",
            ref: f.ref_no ?? null,
            issued: round2(paidToFloat.get(f.id) ?? toSar(f.total_advance, f.currency, f.fx_rate)),
          })),
        receipts: rs,
        returns: (moves as any[]).map((m) => ({
          cashAdvanceId: m.cash_advance_id,
          amount: n(m.amount),
        })),
        limits: resolveCashLimits(settings),
        cashSpent: round2([...approved, ...cashPays].reduce((a, b) => a + b, 0)),
        qpeBase: n((pos as any[])[0]?.actual_sar),
        largestCash: Math.max(0, ...approved, ...cashPays),
      };
    },
  });
}
