import { formatAmount } from "@/lib/format-number";

/**
 * D19 / X24 / D04 — how a notification reads on screen. The database writes
 * one English title + body (also used for the e-mail); for the categories it
 * knows, the app rebuilds the text from `metadata` in the active language.
 */
export type NotificationLike = {
  category: string;
  title: string;
  body: string | null;
  project_id: string | null;
  metadata?: Record<string, unknown> | null;
};

type T = (key: string, opts?: Record<string, unknown>) => string;

const PAYMENT_STATUSES = ["waiting_approval", "approved", "rejected", "paid", "cancelled"] as const;

export function notificationText(
  n: NotificationLike,
  t: T,
): { title: string; body: string | null } {
  const m = (n.metadata ?? {}) as Record<string, unknown>;
  if (n.category === "budget_alert" && typeof m.budget_code === "string") {
    const threshold = Number(m.threshold);
    return {
      title: t(
        threshold >= 100 ? "platform.notify.budget100Title" : "platform.notify.budget80Title",
        {
          code: m.budget_code,
        },
      ),
      body: t("platform.notify.budgetBody", {
        project: String(m.project_name ?? ""),
        code: m.budget_code,
        spent: formatAmount(Number(m.spent_sar) || 0, 2),
        budget: formatAmount(Number(m.budget_sar) || 0, 2),
        pct: Number(m.pct ?? 0).toFixed(1),
      }),
    };
  }
  if (n.category === "payment_approval") {
    const status = String(m.status ?? "");
    if ((PAYMENT_STATUSES as readonly string[]).includes(status)) {
      const reason =
        typeof m.rejection_reason === "string" && m.rejection_reason ? m.rejection_reason : null;
      // The body (document — currency amount) is data, not language: keep it.
      const base = n.body ? n.body.split(" · Reason: ")[0] : null;
      return {
        title: t(`platform.notify.payment_${status}`),
        body: reason ? `${base ?? ""} · ${t("platform.notify.reason", { reason })}` : base,
      };
    }
  }
  return { title: n.title, body: n.body };
}

/** Where clicking a notification goes. */
export function notificationTarget(
  n: NotificationLike,
): { to: string; search?: Record<string, unknown> } | null {
  if (n.category === "access_request") return { to: "/platform-hub/registration-requests" };
  if (!n.project_id) return null;
  if (n.category === "budget" || n.category === "budget_approval") {
    return { to: "/budget", search: { focus: "governance" } };
  }
  if (n.category === "budget_alert") return { to: "/budget" };
  if (
    n.category === "payment" ||
    n.category === "payment_request" ||
    n.category === "payment_approval"
  ) {
    return { to: "/payment-approvals" };
  }
  return null;
}
