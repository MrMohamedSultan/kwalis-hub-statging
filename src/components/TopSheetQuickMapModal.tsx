// Quick Mapping Assistant — inline fixer for unmapped budget lines and
// transactions that break the Top Sheet rollup. Reachable from the
// validation banner on the Top Sheet Cost Report.
import { formatDateTime } from "@/lib/date-format";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { History, Wand2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { useTranslation } from "react-i18next";
import {
  REPORT_SECTIONS,
  SECTION_LABEL,
  makeCodeResolver,
  type TopsheetAccount,
} from "@/lib/topsheet-report";

type AuditEntry = {
  id: string;
  created_at: string;
  table_name: string;
  record_id: string;
  operation: string;
  changed_fields: Record<string, { from: unknown; to: unknown }>;
  new_row: Record<string, unknown> | null;
  old_row: Record<string, unknown> | null;
};

const MAPPING_TABLES = ["budget_lines", "invoices", "purchase_orders", "cash_advance_receipts"];
const MAPPING_FIELDS = ["topsheet_code", "budget_code"];

type UnmappedTxn = {
  key: string;
  kind: "invoice" | "purchase_order" | "receipt";
  id: string;
  code: string; // the raw unmapped budget code
  label: string;
  amount: number;
};

export function TopSheetQuickMapModal({
  accounts,
  onClose,
}: {
  accounts: TopsheetAccount[];
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const {
    budget,
    invoices,
    purchaseOrders,
    receipts,
    updateBudgetLine,
    updateInvoice,
    updatePurchaseOrder,
    updateReceipt,
  } = useStore();

  const resolve = useMemo(() => makeCodeResolver(accounts), [accounts]);
  const codeIndex = useMemo(() => new Set(accounts.map((a) => a.code)), [accounts]);

  const glToTop = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of budget) {
      const code = resolve(l);
      if (l.mainCode && code) map.set(l.mainCode, code);
    }
    return map;
  }, [budget, resolve]);

  const resolveTxn = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    if (codeIndex.has(raw)) return raw;
    return (
      glToTop.get(raw) ?? resolve({ topsheetCode: null, mainCode: raw, headerCode: "" } as any)
    );
  };

  // Unmapped budget lines
  const unmappedLines = useMemo(
    () => budget.filter((l) => !l.excluded && !resolve(l)),
    [budget, resolve],
  );

  // Unmapped txns grouped by the raw budget code that fails to resolve
  const unmappedTxnGroups = useMemo(() => {
    const groups = new Map<string, UnmappedTxn[]>();
    const push = (t: UnmappedTxn) => {
      const arr = groups.get(t.code) ?? [];
      arr.push(t);
      groups.set(t.code, arr);
    };
    for (const i of invoices) {
      if (!i.budgetCode || resolveTxn(i.budgetCode)) continue;
      push({
        key: `inv:${i.id}`,
        kind: "invoice",
        id: i.id,
        code: i.budgetCode,
        label: `${i.invoiceNo || i.id.slice(0, 6)} — ${i.vendorName || ""}`,
        amount: Number(i.price) || 0,
      });
    }
    for (const p of purchaseOrders) {
      if (!p.budgetCode || resolveTxn(p.budgetCode) || p.status === "Cancelled") continue;
      push({
        key: `po:${p.id}`,
        kind: "purchase_order",
        id: p.id,
        code: p.budgetCode,
        label: `${p.poNumber} — ${p.vendorName}`,
        amount: Number(p.amount) || 0,
      });
    }
    for (const rc of receipts) {
      if (!rc.budgetCode || resolveTxn(rc.budgetCode)) continue;
      push({
        key: `rc:${rc.id}`,
        kind: "receipt",
        id: rc.id,
        code: rc.budgetCode,
        label: `${rc.recipient} — ${rc.department ?? ""}`.trim(),
        amount: Number(rc.amount) || 0,
      });
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [invoices, purchaseOrders, receipts, glToTop, codeIndex]);

  const [lineChoice, setLineChoice] = useState<Record<string, string>>({});
  const [groupChoice, setGroupChoice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        const s = REPORT_SECTIONS.indexOf(a.section) - REPORT_SECTIONS.indexOf(b.section);
        if (s !== 0) return s;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code);
      }),
    [accounts],
  );

  const applyAll = async () => {
    setSaving(true);
    let updated = 0;
    try {
      // Budget lines
      for (const l of unmappedLines) {
        const target = lineChoice[l.id];
        if (!target) continue;
        await updateBudgetLine(l.id, { topsheetCode: target });
        updated += 1;
      }
      // Transaction groups — overwrite each record's budgetCode to the
      // chosen top-sheet account code (resolveTxn recognises direct matches).
      for (const [code, txns] of unmappedTxnGroups) {
        const target = groupChoice[code];
        if (!target) continue;
        for (const t of txns) {
          if (t.kind === "invoice") await updateInvoice(t.id, { budgetCode: target });
          else if (t.kind === "purchase_order")
            await updatePurchaseOrder(t.id, { budgetCode: target });
          else if (t.kind === "receipt") await updateReceipt(t.id, { budgetCode: target });
          updated += 1;
        }
      }
      if (updated === 0) {
        toast.info(t("topsheetquickmapmodal.pick_a_top_sheet_account_for_at_least"));
      } else {
        toast.success(`Mapped ${updated} ${updated === 1 ? "entry" : "entries"} to the Top Sheet.`);
        onClose();
      }
    } catch (e) {
      toast.error(t("topsheetquickmapmodal.couldnt_save_some_mappings"), {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const AccountPicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs px-2 py-1 rounded-md border border-border bg-surface-2 min-w-[220px]"
    >
      <option value="">— Choose Top Sheet account —</option>
      {REPORT_SECTIONS.map((section) => (
        <optgroup key={section} label={SECTION_LABEL[section]}>
          {sortedAccounts
            .filter((a) => a.section === section)
            .map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} — {a.description}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );

  const nothingToFix = unmappedLines.length === 0 && unmappedTxnGroups.length === 0;

  const activeProjectId = useStore((s) => s.activeProjectId);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AuditEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!showHistory || history !== null || !activeProjectId) return;
    let cancelled = false;
    setHistoryLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("audit_history")
        .select(
          "id, created_at, table_name, record_id, operation, changed_fields, new_row, old_row",
        )
        .eq("project_id", activeProjectId)
        .in("table_name", MAPPING_TABLES)
        .eq("operation", "UPDATE")
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        toast.error(t("topsheetquickmapmodal.couldnt_load_mapping_history"), {
          description: error.message,
        });
        setHistory([]);
      } else {
        const filtered = (data ?? [])
          .map((r) => ({
            ...r,
            changed_fields: (r.changed_fields ?? {}) as AuditEntry["changed_fields"],
          }))
          .filter((r) => MAPPING_FIELDS.some((f) => f in r.changed_fields))
          .slice(0, 100) as AuditEntry[];
        setHistory(filtered);
      }
      setHistoryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [showHistory, history, activeProjectId]);

  const renderDescription = (e: AuditEntry): string => {
    const row = (e.new_row ?? e.old_row ?? {}) as Record<string, unknown>;
    return (
      (row.description as string) ||
      (row.invoice_no as string) ||
      (row.po_number as string) ||
      (row.vendor_name as string) ||
      (row.main_code as string) ||
      e.record_id.slice(0, 8)
    );
  };

  return (
    <Modal onClose={onClose} title={t("topsheetquickmapmodal.quick_mapping_assistant")}>
      {nothingToFix ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nothing to map — every budget line and transaction already rolls up cleanly.
        </p>
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground">
            Assign each unmapped entry to a Top Sheet account. Changes save directly to the active
            project and refresh the rollup immediately.
          </p>

          {unmappedLines.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-warning mb-2">
                Unmapped budget lines ({unmappedLines.length})
              </h3>
              <div className="rounded-lg border border-border divide-y divide-border">
                {unmappedLines.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 p-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {l.mainCode || "—"}
                      </div>
                      <div className="truncate">{l.description || "(no description)"}</div>
                    </div>
                    <AccountPicker
                      value={lineChoice[l.id] ?? ""}
                      onChange={(v) => setLineChoice((s) => ({ ...s, [l.id]: v }))}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {unmappedTxnGroups.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-warning mb-2">
                Unmapped transaction codes ({unmappedTxnGroups.length})
              </h3>
              <p className="text-[11px] text-muted-foreground mb-2">
                {t("topsheetquickmapmodal.applies_to_every_invoice_po_and_petty_cash")}
              </p>
              <div className="rounded-lg border border-border divide-y divide-border">
                {unmappedTxnGroups.map(([code, txns]) => (
                  <div key={code} className="p-2 text-xs space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface">
                        {code}
                      </span>
                      <span className="text-muted-foreground">
                        {txns.length} {txns.length === 1 ? "record" : "records"}
                      </span>
                      <AccountPicker
                        value={groupChoice[code] ?? ""}
                        onChange={(v) => setGroupChoice((s) => ({ ...s, [code]: v }))}
                      />
                    </div>
                    <ul className="text-[11px] text-muted-foreground pl-3 list-disc space-y-0.5">
                      {txns.slice(0, 5).map((t) => (
                        <li key={t.key} className="truncate">
                          [{t.kind.replace("_", " ")}] {t.label}
                        </li>
                      ))}
                      {txns.length > 5 && <li>…and {txns.length - 5} more.</li>}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted"
            >
              <History className="size-3.5" />
              {showHistory ? "Hide mapping history" : "View mapping history"}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={applyAll}
                disabled={saving}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-brand text-brand-foreground font-semibold disabled:opacity-50"
              >
                <Wand2 className="size-3.5" />
                {saving ? "Applying…" : "Apply mappings"}
              </button>
            </div>
          </div>

          {showHistory && (
            <section className="border-t border-border pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {t("topsheetquickmapmodal.recent_mapping_changes")}
              </h3>
              {historyLoading ? (
                <p className="text-[11px] text-muted-foreground py-4 text-center">Loading…</p>
              ) : !history || history.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-4 text-center">
                  {t("topsheetquickmapmodal.no_mapping_changes_recorded_yet_for_this_project")}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {history.map((e) => {
                    const desc = renderDescription(e);
                    const fields = MAPPING_FIELDS.filter((f) => f in e.changed_fields);
                    return (
                      <div key={e.id} className="p-2 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            <span className="text-muted-foreground">
                              [{e.table_name.replace("_", " ")}]
                            </span>{" "}
                            {desc}
                          </span>
                          <span className="text-muted-foreground whitespace-nowrap">
                            {formatDateTime(e.created_at)}
                          </span>
                        </div>
                        {fields.map((f) => {
                          const change = e.changed_fields[f];
                          return (
                            <div key={f} className="pl-2 mt-0.5 text-muted-foreground">
                              <span className="font-mono">{f}</span>:{" "}
                              <span className="font-mono">{String(change.from ?? "—")}</span>
                              {" → "}
                              <span className="font-mono text-foreground">
                                {String(change.to ?? "—")}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
