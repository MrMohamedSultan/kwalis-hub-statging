import { formatDateTime } from "@/lib/date-format";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PaymentRequest } from "@/lib/payment-requests";
import { FileText, Send, CheckCircle2, XCircle, Wallet, Clock } from "lucide-react";

type Step = {
  icon: React.ReactNode;
  label: string;
  actorId: string | null;
  at: string | null;
  detail?: string | null;
  tone: "muted" | "info" | "success" | "danger";
};

function fmt(at: string | null) {
  if (!at) return "";
  try {
    return formatDateTime(at);
  } catch {
    return at;
  }
}

const toneCls: Record<Step["tone"], string> = {
  muted: "bg-surface text-muted-foreground border-border",
  info: "bg-info/15 text-info border-info/30",
  success: "bg-success/15 text-success border-success/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
};

export function PaymentTimeline({ request }: { request: PaymentRequest }) {
  const [names, setNames] = useState<Record<string, string>>({});

  const ids = [
    request.requested_by,
    request.approved_by,
    request.rejected_by,
    request.executed_by,
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

  const nameOf = (uid: string | null) => (uid ? (names[uid] ?? "مستخدم") : "—");

  const METHOD_AR: Record<string, string> = {
    Cash: "نقدي",
    Transfer: "تحويل بنكي",
    Check: "شيك",
    Card: "بطاقة",
    Bank: "بنك",
  };

  const steps: Step[] = [
    {
      icon: <FileText className="size-3.5" />,
      label: `تم إنشاء الطلب بواسطة ${nameOf(request.requested_by)}`,
      actorId: request.requested_by,
      at: request.created_at,
      tone: "muted",
    },
    ...(request.submitted_at
      ? [
          {
            icon: <Send className="size-3.5" />,
            label: `تم الإرسال للاعتماد بواسطة ${nameOf(request.requested_by)}`,
            actorId: request.requested_by,
            at: request.submitted_at,
            tone: "info" as const,
          },
        ]
      : []),
    ...(request.approved_at
      ? [
          {
            icon: <CheckCircle2 className="size-3.5" />,
            label: `تم الاعتماد بواسطة ${nameOf(request.approved_by)}`,
            actorId: request.approved_by,
            at: request.approved_at,
            tone: "success" as const,
          },
        ]
      : []),
    ...(request.rejected_at
      ? [
          {
            icon: <XCircle className="size-3.5" />,
            label: `تم الرفض بواسطة ${nameOf(request.rejected_by)}`,
            actorId: request.rejected_by,
            at: request.rejected_at,
            detail: request.rejection_reason,
            tone: "danger" as const,
          },
        ]
      : []),
    ...(request.executed_at
      ? [
          {
            icon: <Wallet className="size-3.5" />,
            label: `تم السداد ورفع الإيصال بواسطة ${nameOf(request.executed_by)}`,
            actorId: request.executed_by,
            at: request.executed_at,
            detail: request.payment_method
              ? `${METHOD_AR[request.payment_method] ?? request.payment_method} · ${request.payment_date ?? ""}`
              : null,
            tone: "success" as const,
          },
        ]
      : []),
  ];

  if (
    request.status === "waiting_approval" ||
    (request.status === "approved" && !request.executed_at)
  ) {
    steps.push({
      icon: <Clock className="size-3.5" />,
      label: request.status === "waiting_approval" ? "بانتظار المعتمد" : "بانتظار التنفيذ",
      actorId: null,
      at: null,
      tone: "muted",
    });
  }

  return (
    <ol className="space-y-2" dir="rtl">
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
