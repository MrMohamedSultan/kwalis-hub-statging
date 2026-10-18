import { describe, expect, it } from "vitest";
import {
  NO_ACCOUNT_RESTRICTIONS,
  accountActionFor,
  type AccountStatus,
} from "@/lib/account-status";

const st = (over: Partial<AccountStatus>): AccountStatus => ({
  ...NO_ACCOUNT_RESTRICTIONS,
  ...over,
});

describe("account status gate (D23 / D08)", () => {
  it("does nothing for an unrestricted account", () => {
    expect(accountActionFor(NO_ACCOUNT_RESTRICTIONS, "2026-10-01T10:00:00Z")).toBe("none");
  });

  it("signs a disabled account out, whatever else is set", () => {
    expect(
      accountActionFor(st({ disabled: true, mustChangePassword: true }), "2026-10-01T10:00:00Z"),
    ).toBe("sign_out_disabled");
  });

  it("ends a session that started before the forced sign-out", () => {
    const s = st({ sessionsRevokedAt: "2026-10-01T12:00:00Z" });
    expect(accountActionFor(s, "2026-10-01T10:00:00Z")).toBe("sign_out_revoked");
  });

  it("leaves a session alone once the user signed in again after it", () => {
    const s = st({ sessionsRevokedAt: "2026-10-01T12:00:00Z" });
    expect(accountActionFor(s, "2026-10-01T12:00:05Z")).toBe("none");
  });

  it("treats an unknown sign-in time as before the revocation", () => {
    const s = st({ sessionsRevokedAt: "2026-10-01T12:00:00Z" });
    expect(accountActionFor(s, null)).toBe("sign_out_revoked");
  });

  it("asks for a new password before anything about the company", () => {
    expect(
      accountActionFor(
        st({ mustChangePassword: true, allOrgsSuspended: true }),
        "2026-10-01T10:00:00Z",
      ),
    ).toBe("change_password");
  });

  it("blocks a member whose every company is suspended", () => {
    expect(accountActionFor(st({ allOrgsSuspended: true }), "2026-10-01T10:00:00Z")).toBe(
      "suspended",
    );
  });
});
