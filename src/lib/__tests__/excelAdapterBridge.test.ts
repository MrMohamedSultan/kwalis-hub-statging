import { describe, expect, it } from "vitest";
import { storeGroupOfLine } from "@/lib/excelAdapterBridge";

describe("budget import — category of an imported line (R09)", () => {
  it("Music 6000 and VFX 6100 keep their own category, not Post", () => {
    expect(storeGroupOfLine({ group: "POST", main_code: "6001", header_code: "6000" })).toBe(
      "Music",
    );
    expect(storeGroupOfLine({ group: "POST", main_code: "6101", header_code: "6100" })).toBe("VFX");
  });
  it("other chart-of-accounts codes follow the chart", () => {
    expect(storeGroupOfLine({ group: "OTHER", main_code: "5101", header_code: "5100" })).toBe(
      "Post",
    );
    expect(storeGroupOfLine({ group: "POST", main_code: "1101", header_code: "1100" })).toBe("ATL");
  });
  it("codes outside the chart fall back to the sheet group", () => {
    expect(storeGroupOfLine({ group: "POST", main_code: "X1", header_code: "" })).toBe("Post");
    expect(storeGroupOfLine({ group: "BTL", main_code: "", header_code: "" })).toBe("BTL");
    expect(storeGroupOfLine({ group: "OTHER", main_code: "9999", header_code: "9900" })).toBe(
      "Other",
    );
  });
});
