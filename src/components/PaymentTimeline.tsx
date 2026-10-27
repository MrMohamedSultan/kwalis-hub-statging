import { formatDateTime } from "@/lib/date-format";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import type { ChainStatus, PaymentRequest } from "@/lib/payment-requests";
import {
  FileText,
  Send,
  CheckCircle2,
  XCircle,
  Wallet,
  Clock,
  Ban,
  ShieldCheck,
} from "lucide-react";

type Step = {
  icon: React.ReactNode;
  label: string;
  at: string | null;
  detail?: string | null;
  tone: "muted" | "info" | "success" | "danger";
};

const toneCls: Record<Step["tone"], string> = {
  muted: "bg-surface text-muted-foreground border-border",
  info: "bg-info/15 text-info border-info/30",
  success: "bg-success/15 text-success border-success/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
};

/** Audit trail of one request, including every approval-chain level. */
export function PaymentTimeline({
  request,
  chain,
}: {
  request: PaymentRequest;
  chain?: ChainStatus | null;
}) {
  const { t, i18n } = useTranslation();
  const [names, setNames] = useState<Record<string, string>>({});
  const levelSteps = chain?.steps ?? [];

  const ids = [
    request.requested_by,
    request.approved_by,
    request.rejected_by,
    request.executed_by,
    request.cancelled_by ?? null,
    ...levelSteps.map((s) => s.approved_by),
  ].filter(Boolean) as string[];

  useEffect(() => {
    if (!ids.length) return;
    const unique = Array.from(new Set(ids));
    void (async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("id, display_name")
        .in("id", unique);
      const map: Record<string, string> = {};
      for (const row of data ?? []) map[row.id] = row.display_name ?? row.id;
      setNames(map);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  const nameOf = (uid: string | null | undefined) =>
    uid ? (names[uid] ?? t("approvals.timeline.user")) : "—";
  const fmt = (at: string | null) => {
    if (!at) return "";
    try {
      return formatDateTime(at);
    } catch {
      return at;
    }
  };

  const steps: Step[] = [
    {
      icon: <FileText className="size-3.5" />,
      label: t("approvals.timeline.created", { name: nameOf(request.requested_by) }),
      at: request.created_at,
      tone: "muted",
    },
  ];
  if (request.submitted_at)
    steps.push({
      icon: <Send className="size-3.5" />,
      label: t("approvals.timeline.submitted", { name: nameOf(request.requested_by) }),
      at: request.submitted_at,
      tone: "info",
    });
  // chain levels: approved ones, then the ones still to come
  for (const s of levelSteps) {
    steps.push(
      s.approved_by
        ? {
            icon: <ShieldCheck className="size-3.5" />,
            label: t("approvals.timeline.levelApproved", {
              level: s.level,
              label: s.label,
              name: nameOf(s.approved_by),
            }),
            at: s.approved_at,
            detail: s.note,
            tone: "success",
          }
        : {
            icon: <Clock className="size-3.5" />,
            label: t("approvals.timeline.levelWaiting", { level: s.level, label: s.label }),
            at: null,
            tone: "muted",
          },
    );
  }
  if (request.approved_at)
    steps.push({
      icon: <CheckCircle2 className="size-3.5" />,
      label: t("approvals.timeline.approved", { name: nameOf(request.approved_by) }),
      at: request.approved_at,
      tone: "success",
    });
  if (request.rejected_at)
    steps.push({
      icon: <XCircle className="size-3.5" />,
      label: t("approvals.timeline.rejected", { name: nameOf(request.rejected_by) }),
      at: request.rejected_at,
      detail: request.rejection_reason,
      tone: "danger",
    });
  if (request.executed_at)
    steps.push({
      icon: <Wallet className="size-3.5" />,
      label: t("approvals.timeline.paid", { name: nameOf(request.executed_by) }),
      at: request.executed_at,
      detail: request.payment_method
        ? `${t(`approvals.method.${request.payment_method}`, { defaultValue: request.payment_method })} · ${request.payment_date ?? ""}`
        : null,
      tone: "success",
    });
  if (request.cancelled_at)
    steps.push({
      icon: <Ban className="size-3.5" />,
      label: t("approvals.timeline.cancelled", { name: nameOf(request.cancelled_by) }),
      at: request.cancelled_at,
      detail: request.cancellation_reason,
      tone: "danger",
    });

  if (request.status === "waiting_approval" && levelSteps.length === 0) {
    steps.push({
      icon: <Clock className="size-3.5" />,
      label: t("approvals.timeline.waitingApprover"),
      at: null,
      tone: "muted",
    });
  } else if (request.status === "approved" && !request.executed_at) {
    steps.push({
      icon: <Clock className="size-3.5" />,
      label: t("approvals.timeline.waitingPayment"),
      at: null,
      tone: "muted",
    });
  }

  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li
          key={i}
          className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${toneCls[s.tone]}`}
        >
          <span className="mt-0.5 shrink-0">{s.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{s.label}</div>
            {s.at && <div className="text-[11px] opacity-80">{fmt(s.at)}</div>}
            {s.detail && <div className="text-[11px] mt-0.5 opacity-90">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
