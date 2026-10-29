// =====================================================================
// Company subscription status — the single source (D01).
//
// The database stores lowercase values and enforces them with
// organizations_subscription_status_check: active | trial | suspended |
// cancelled. Screens used to keep their own Title Case lists ("Active",
// "Trial"...), so a stored "active" matched no <option>, the dropdown fell
// back to its first entry ("Trial"), and saving wrote that wrong value back.
//
// Everything that reads or writes organizations.subscription_status goes
// through this file: normalise on read, write the canonical value.
// =====================================================================

import i18n from "@/lib/i18n";

export const SUBSCRIPTION_STATUSES = ["trial", "active", "suspended", "cancelled"] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const LABELS: Record<SubscriptionStatus, string> = {
  trial: "Trial",
  active: "Active",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

/**
 * Canonical value for whatever is stored ("Active", " ACTIVE ", "active").
 * Returns null for an empty or unrecognised value — callers must NOT replace
 * that with a default before saving, or an unknown status would be silently
 * overwritten.
 */
export function normalizeSubscriptionStatus(
  value: string | null | undefined,
): SubscriptionStatus | null {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "canceled") return "cancelled";
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(v)
    ? (v as SubscriptionStatus)
    : null;
}

/** Display label; the raw value is shown as-is when it is not a known status. */
export function subscriptionStatusLabel(value: string | null | undefined): string {
  const s = normalizeSubscriptionStatus(value);
  if (s) return i18n.t(`closeout.ui.sub.${s}`, { defaultValue: LABELS[s] }); // D19
  const raw = (value ?? "").trim();
  return raw || "—";
}

/** Badge classes (semantic tokens only). */
export function subscriptionStatusBadgeClass(value: string | null | undefined): string {
  switch (normalizeSubscriptionStatus(value)) {
    case "active":
      return "bg-success/15 text-success border-success/30";
    case "trial":
      return "bg-brand/15 text-brand border-brand/30";
    case "suspended":
      return "bg-warning/15 text-warning border-warning/30";
    case "cancelled":
      return "bg-destructive/15 text-destructive border-destructive/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
