import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_STATUSES,
  normalizeSubscriptionStatus,
  subscriptionStatusLabel,
} from "@/lib/subscription-status";

describe("subscription status (D01)", () => {
  it("accepts the stored lowercase values unchanged", () => {
    for (const s of SUBSCRIPTION_STATUSES) expect(normalizeSubscriptionStatus(s)).toBe(s);
  });

  it("maps the old Title Case / padded values to the stored form", () => {
    expect(normalizeSubscriptionStatus("Active")).toBe("active");
    expect(normalizeSubscriptionStatus("  TRIAL ")).toBe("trial");
    expect(normalizeSubscriptionStatus("Canceled")).toBe("cancelled");
  });

  it("never invents a status for an empty or unknown value", () => {
    expect(normalizeSubscriptionStatus(null)).toBeNull();
    expect(normalizeSubscriptionStatus("")).toBeNull();
    expect(normalizeSubscriptionStatus("Past Due")).toBeNull();
  });

  it("labels known values and shows unknown ones as stored", () => {
    expect(subscriptionStatusLabel("active")).toBe("Active");
    expect(subscriptionStatusLabel("Past Due")).toBe("Past Due");
    expect(subscriptionStatusLabel(null)).toBe("—");
  });
});
