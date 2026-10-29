import { describe, expect, it } from "vitest";
import {
  PLATFORM_DEFAULTS,
  PlatformSettingsSchema,
  changedSettingRows,
  settingsFromRows,
} from "@/lib/platform-settings";

describe("platform settings (D20)", () => {
  it("rows → form, empty approval limit = off", () => {
    const s = settingsFromRows([
      { key: "fx_usd_to_base", value: "3.7500" },
      { key: "payment_board_approval_above_sar", value: null },
      { key: "default_language", value: "ar" },
    ]);
    expect(s.usdRate).toBe("3.7500");
    expect(s.requireApprovalAbove).toBe("");
    expect(s.defaultLanguage).toBe("ar");
    expect(s.vatRate).toBe(PLATFORM_DEFAULTS.vatRate);
  });
  it("only changed keys are written; empty → NULL", () => {
    const before = { ...PLATFORM_DEFAULTS, requireApprovalAbove: "50000" };
    const after = { ...before, eurRate: "4.10", requireApprovalAbove: "" };
    expect(changedSettingRows(before, after)).toEqual([
      { key: "fx_eur_to_base", value: "4.10" },
      { key: "payment_board_approval_above_sar", value: null },
    ]);
    expect(changedSettingRows(before, before)).toEqual([]);
  });
  it("validates like the database", () => {
    expect(PlatformSettingsSchema.safeParse(PLATFORM_DEFAULTS).success).toBe(true);
    for (const bad of [
      { fiscalYearStart: "13-01" },
      { usdRate: "-1" },
      { whtRate: "150" },
      { defaultProjectLimit: "2.5" },
      { requireApprovalAbove: "0" },
      { baseCurrency: "sar" },
    ])
      expect(PlatformSettingsSchema.safeParse({ ...PLATFORM_DEFAULTS, ...bad }).success).toBe(
        false,
      );
  });
});
