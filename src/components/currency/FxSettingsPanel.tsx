import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, History, Shield, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCurrencyStore } from "@/stores/useCurrencyStore";
import { describeFxRate, isValidFxRate } from "@/utils/currency-conversion";

/** Admin-only FX rate management. Invisible to everyone else. */
export function FxSettingsPanel({ projectId }: { projectId: string }) {
  const isCompanyAdmin = useCurrencyStore((s) => s.isCompanyAdmin);
  const projectFxRate = useCurrencyStore((s) => s.projectFxRate);
  const isUpdatingRate = useCurrencyStore((s) => s.isUpdatingRate);
  const lastRecalculationResult = useCurrencyStore((s) => s.lastRecalculationResult);
  const auditLog = useCurrencyStore((s) => s.auditLog);
  const updateProjectFxRate = useCurrencyStore((s) => s.updateProjectFxRate);
  const loadAuditLog = useCurrencyStore((s) => s.loadAuditLog);

  const { t } = useTranslation();
  const [newRate, setNewRate] = useState("");
  const [reason, setReason] = useState("");
  const [showAudit, setShowAudit] = useState(false);

  if (!isCompanyAdmin) return null;

  const handleUpdateRate = async () => {
    const parsed = Number(newRate);
    if (!isValidFxRate(parsed)) {
      toast.error(t("fx.invalidRate"), { description: t("fx.invalidRateDesc") });
      return;
    }
    const result = await updateProjectFxRate(projectId, parsed, reason.trim() || undefined);
    if (result.success) {
      toast.success(t("fx.rateUpdated"), {
        description: t("fx.recalcRows", { count: result.rowsRecalculated ?? 0 }),
      });
      setNewRate("");
      setReason("");
    } else {
      toast.error(t("fx.updateFailed"), { description: result.error });
    }
  };

  const toggleAudit = () => {
    const next = !showAudit;
    setShowAudit(next);
    if (next) void loadAuditLog(projectId);
  };

  return (
    <Card className="border-amber-200 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="size-4" />
          {t("fx.settingsTitle")}
        </CardTitle>
        <CardDescription>{t("fx.settingsDesc")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-background p-4">
          <div className="text-xs text-muted-foreground">{t("fx.currentRate")}</div>
          <div className="text-2xl font-semibold tabular-nums">{describeFxRate(projectFxRate)}</div>
        </div>

        {lastRecalculationResult ? (
          lastRecalculationResult.success ? (
            <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                {t("fx.recalcDone")}.{" "}
                {t("fx.recalcRows", { count: lastRecalculationResult.rowsRecalculated ?? 0 })}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <span>{lastRecalculationResult.error}</span>
            </div>
          )
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fx-new-rate">
              {t("fx.newRate")} (1 {projectFxRate.targetCurrency} = ? {projectFxRate.baseCurrency})
            </Label>
            <Input
              id="fx-new-rate"
              type="number"
              step="0.000001"
              min="0.000001"
              placeholder="3.750000"
              className="font-mono"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fx-reason">{t("fx.reason")}</Label>
            <Textarea
              id="fx-reason"
              rows={2}
              placeholder={t("fx.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full" disabled={!newRate.trim() || isUpdatingRate}>
                {isUpdatingRate ? t("fx.updating") : t("fx.updateRate")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-warning" />
                  {t("fx.confirmTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>{t("fx.confirmDesc")}</AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-3">
                <div className="font-mono text-sm">
                  {projectFxRate.rate} → {newRate || "—"}
                </div>
                <div className="space-y-1 rounded-lg bg-muted p-3 text-xs">
                  <div className="text-success">
                    ✓ Derived base_amount fields will be recalculated
                  </div>
                  <div className="text-info">
                    ✓ Original transaction_amount and transaction_currency are preserved
                  </div>
                  <div className="text-muted-foreground">
                    ✓ Change will be recorded in the audit trail
                  </div>
                </div>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleUpdateRate()}>
                  {t("fx.confirmUpdate")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div>
          <Button variant="ghost" size="sm" onClick={toggleAudit} className="gap-2">
            <History className="size-4" />
            {showAudit ? t("fx.hideAudit") : t("fx.showAudit")}
          </Button>

          {showAudit ? (
            auditLog.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">{t("fx.noHistory")}</div>
            ) : (
              <div className="mt-2 max-h-64 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="p-2 text-start">{t("fx.date")}</th>
                      <th className="p-2 text-start">{t("fx.previousRate")}</th>
                      <th className="p-2 text-start">{t("fx.newRateCol")}</th>
                      <th className="p-2 text-start">{t("fx.rowsCol")}</th>
                      <th className="p-2 text-start">{t("fx.statusCol")}</th>
                      <th className="p-2 text-start">{t("fx.reasonCol")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry) => (
                      <tr key={entry.id} className="border-t">
                        <td className="p-2 whitespace-nowrap">
                          {new Date(entry.changedAt).toLocaleString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="p-2 font-mono">{entry.previousRate ?? "—"}</td>
                        <td className="p-2 font-mono">{entry.newRate}</td>
                        <td className="p-2 tabular-nums">{entry.rowsRecalculated}</td>
                        <td className="p-2">
                          <span
                            className={
                              entry.recalculationStatus === "completed"
                                ? "rounded-full bg-success/15 px-2 py-0.5 text-success"
                                : entry.recalculationStatus === "failed"
                                  ? "rounded-full bg-destructive/15 px-2 py-0.5 text-destructive"
                                  : "rounded-full bg-warning/15 px-2 py-0.5 text-warning"
                            }
                          >
                            {entry.recalculationStatus}
                          </span>
                        </td>
                        <td className="max-w-[12rem] truncate p-2">{entry.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default FxSettingsPanel;
