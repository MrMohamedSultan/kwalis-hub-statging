import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { ShieldCheck, AlertTriangle, Info, Download } from "lucide-react";
import { useIntegrityAudit } from "@/lib/integrity-audit";
import { useFundingEntries, useVatPayments } from "@/lib/funding-store";
import { useStore } from "@/lib/store";
import { downloadCSV } from "@/lib/export-csv";

import { useTranslation } from "react-i18next";
export function IntegrityAuditButton({ className = "" }: { className?: string }) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-info/40 bg-info/10 px-3 py-1.5 text-xs font-semibold text-info hover:bg-info/20 transition ${className}`}
      >
        <ShieldCheck className="size-3.5" />
        {t("integrityauditmodal.run_integrity_audit")}
      </button>
      {open && <IntegrityAuditModal onClose={() => setOpen(false)} />}
    </>
  );
}

function IntegrityAuditModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  const { items: funding } = useFundingEntries();
  const { items: vat } = useVatPayments();
  const fundingInflows = useMemo(
    () => funding.reduce((a, e) => a + Number(e.amount || 0), 0),
    [funding],
  );
  const directVatPaid = useMemo(() => vat.reduce((a, e) => a + Number(e.amount || 0), 0), [vat]);

  const findings = useIntegrityAudit({ fundingInflows, directVatPaid });
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  const exportCsv = () => {
    downloadCSV(
      "integrity-audit.csv",
      findings.map((f) => ({
        severity: f.severity,
        category: f.category,
        title: f.title,
        detail: f.detail,
        refId: f.refId ?? "",
        expected: f.expected ?? "",
        actual: f.actual ?? "",
        delta: f.delta ?? "",
      })),
    );
  };

  return (
    <Modal title={t("integrityauditmodal.integrity_audit")} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border ${errors ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-success/40 bg-success/10 text-success"}`}
          >
            {errors ? <AlertTriangle className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
            {errors} error{errors === 1 ? "" : "s"}
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 text-warning px-2.5 py-1 text-xs font-semibold">
            <AlertTriangle className="size-3.5" />
            {warnings} warning{warnings === 1 ? "" : "s"}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-semibold hover:bg-surface transition"
          >
            <Download className="size-3.5" />
            Export CSV
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2 space-y-2">
          {findings.length === 0 && (
            <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success">
              {t("integrityauditmodal.all_checks_passed_no_mismatches_detected")}
            </div>
          )}
          {findings.map((f) => (
            <div
              key={f.id}
              className={`rounded-xl border p-3 text-sm ${
                f.severity === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : f.severity === "warning"
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : "border-info/30 bg-info/10 text-info"
              }`}
            >
              <div className="flex items-start gap-2">
                {f.severity === "info" ? (
                  <Info className="size-4 mt-0.5" />
                ) : (
                  <AlertTriangle className="size-4 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{f.title}</div>
                  <div className="text-xs opacity-90 mt-1">{f.detail}</div>
                  {(f.expected !== undefined || f.actual !== undefined) && (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="opacity-70">Expected</div>
                        <div className="font-mono">{f.expected?.toLocaleString() ?? "—"}</div>
                      </div>
                      <div>
                        <div className="opacity-70">Actual</div>
                        <div className="font-mono">{f.actual?.toLocaleString() ?? "—"}</div>
                      </div>
                      <div>
                        <div className="opacity-70">Delta</div>
                        <div className="font-mono">{f.delta?.toLocaleString() ?? "—"}</div>
                      </div>
                    </div>
                  )}
                  {f.refId && <div className="text-[10px] opacity-60 mt-1">ref: {f.refId}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
