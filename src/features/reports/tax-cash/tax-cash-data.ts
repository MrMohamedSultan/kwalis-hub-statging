// Data for the Tax Cash Impact report (R23 / R24). Every query is scoped to
// the active project; RLS enforces the same. Amounts SAR.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  vatTreatmentOf,
  type PaymentEvent,
  type VatInvoice,
  type WhtDocument,
} from "./tax-cash-calc";

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const from = (t: string) => (supabase.from as any)(t);

export interface TaxCashMovements {
  vatPaid: number;
  vatRecovered: number;
  whtRemitted: number;
  rows: { date: string; kind: "vat_paid" | "vat_recovered" | "wht_remitted"; amount: number }[];
}

/**
 * VAT paid / recovered and WHT remitted — the cash movements with ZATCA that
 * the Funding screen records. ONE place reads them: public.project_tax_payments
 * (180), which db/pending/196 turned into a compatibility view over
 * public.treasury_movements. Re-point this helper only if that view goes.
 */
export async function fetchTaxCashMovements(
  projectId: string,
  asOf?: string | null,
): Promise<TaxCashMovements> {
  let q = from("project_tax_payments")
    .select("payment_date, kind, amount")
    .eq("project_id", projectId)
    .order("payment_date", { ascending: true });
  if (asOf) q = q.lte("payment_date", asOf);
  const { data, error } = await q;
  if (error) throw error;
  const rows = ((data ?? []) as any[]).map((r) => ({
    date: String(r.payment_date ?? "").slice(0, 10),
    kind: r.kind,
    amount: n(r.amount),
  }));
  const sum = (k: string) => rows.filter((r) => r.kind === k).reduce((a, r) => a + r.amount, 0);
  return {
    vatPaid: sum("vat_paid"),
    vatRecovered: sum("vat_recovered"),
    whtRemitted: sum("wht_remitted"),
    rows,
  };
}

export interface TaxCashData {
  whtDocs: WhtDocument[];
  vatInvoices: VatInvoice[];
  movements: TaxCashMovements;
  /** Approved budget of line 7099 (decision 12). */
  budget7099: number;
  /** Open commitments outside contracts (POs, logistics): the VAT forecast base. */
  openCommitments: number;
}

export function useTaxCashData(projectId: string | null) {
  return useQuery({
    queryKey: ["taxlive-tax-cash", projectId],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async (): Promise<TaxCashData> => {
      const pid = projectId!;
      const [payroll, invoices, payments, movements, cost, commitments] = await Promise.all([
        from("payroll").select("*").eq("project_id", pid),
        from("invoices").select("*").eq("project_id", pid),
        from("payments")
          .select("source_type, source_id, amount, payment_date")
          .eq("project_id", pid),
        fetchTaxCashMovements(pid),
        (supabase.rpc as any)("get_cost_report_detail", { p_project_id: pid }),
        from("v_ledger_transactions")
          .select("source_type, amount")
          .eq("project_id", pid)
          .eq("entry_kind", "commitment"),
      ]);
      for (const r of [payroll, invoices, payments, cost, commitments]) if (r.error) throw r.error;

      const paysBy = new Map<string, PaymentEvent[]>();
      for (const p of (payments.data ?? []) as any[]) {
        const k = `${p.source_type}:${p.source_id}`;
        const list = paysBy.get(k) ?? [];
        list.push({ date: String(p.payment_date ?? "").slice(0, 10), amount: n(p.amount) });
        paysBy.set(k, list);
      }

      const prRows = (payroll.data ?? []) as any[];
      const personIds = prRows
        .map((r) => r.ref_id)
        .filter((x: unknown): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
      const people = new Map<string, any>();
      if (personIds.length) {
        const { data, error } = await from("people").select("*").in("id", personIds);
        if (error) throw error;
        for (const p of (data ?? []) as any[]) people.set(p.id, p);
      }

      const whtDocs: WhtDocument[] = [];
      for (const r of prRows) {
        if (n(r.wht_amount) <= 0) continue;
        const pe = people.get(r.ref_id);
        const gross = n(r.total_amount);
        whtDocs.push({
          kind: "contract",
          id: r.id,
          ref: r.ref_no ?? r.ref_id ?? r.id,
          party: r.name,
          residency: pe?.tax_residency ?? null,
          serviceType:
            pe?.wht_service_type ?? (r.kind === "cast" ? "Cast performance" : "Crew service"),
          treatment: r.wht_treatment === "exclusive" ? "exclusive" : "inclusive",
          base: gross,
          storedRate: n(r.wht_percent) > 0 ? n(r.wht_percent) : null,
          storedAmount: n(r.wht_amount),
          payBasis: n(r.net_payable) > 0 ? n(r.net_payable) : gross - n(r.wht_amount),
          budgetCode: r.budget_code ?? null,
          payments: paysBy.get(`payroll:${r.id}`) ?? [],
        });
      }

      const invRows = (invoices.data ?? []) as any[];
      const vatInvoices: VatInvoice[] = [];
      for (const i of invRows) {
        const price = n(i.price);
        const vat = n(i.vat_amount);
        const wht = n(i.wht_amount);
        const payBasis = n(i.net_payable) > 0 ? n(i.net_payable) : price + vat - wht;
        const pays = paysBy.get(`invoice:${i.id}`) ?? [];
        if (wht > 0) {
          whtDocs.push({
            kind: "invoice",
            id: i.id,
            ref: i.ref_no ?? i.invoice_no ?? i.id,
            party: i.vendor_name ?? "—",
            residency: i.is_non_saudi_vendor ? "non_resident" : null,
            serviceType: i.wht_service_type ?? i.department ?? null,
            treatment: i.wht_treatment === "exclusive" ? "exclusive" : "inclusive",
            base: price,
            storedRate: n(i.wht_percent) > 0 ? n(i.wht_percent) : null,
            storedAmount: wht,
            payBasis,
            budgetCode: i.budget_code ?? null,
            payments: pays,
          });
        }
        vatInvoices.push({
          id: i.id,
          ref: i.ref_no ?? i.invoice_no ?? "",
          vendor: i.vendor_name ?? "",
          date: i.date ?? null,
          treatment: vatTreatmentOf(i.vat_treatment, i.vatable),
          net: price,
          vat,
          payBasis,
          payments: pays,
        });
      }

      const budget7099 = ((cost.data ?? []) as any[])
        .filter((r) => String(r.budget_code ?? "").startsWith("7099"))
        .reduce((a, r) => a + n(r.budget), 0);
      const openCommitments = ((commitments.data ?? []) as any[])
        .filter((r) => r.source_type !== "payroll")
        .reduce((a, r) => a + n(r.amount), 0);

      return { whtDocs, vatInvoices, movements, budget7099, openCommitments };
    },
  });
}
