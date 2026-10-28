import { describe, expect, it } from "vitest";
import { clientIpFrom, lockMinutesFor, lockRemaining } from "@/lib/login-lockout";
import { passwordResetProblem } from "@/lib/password-policy";
import { MAX_UPLOAD_BYTES, safeStorageName, uploadProblem } from "@/lib/upload-policy";
import { groupPerDiem, perDiemRowTotal, perDiemTotals, toSar } from "@/lib/per-diem-calc";
import {
  addressOf,
  buildMimeMessage,
  dotStuff,
  encodeHeaderWord,
  headerSafe,
  notificationEmailText,
} from "@/lib/email/mime";
import { mailerConfigFromEnv } from "@/lib/email/mailer.server";
import { notificationTarget, notificationText } from "@/lib/notification-display";
import { isReportTabEnabled } from "@/lib/report-flags";
import { cleanTotpCode, needsSecondStep } from "@/lib/mfa";

describe("X02 login lockout schedule (mirrors public.login_lock_minutes)", () => {
  it("locks at 5, 8 and 12+ failures per e-mail", () => {
    expect([1, 4, 5, 6, 8, 9, 12, 20].map((n) => lockMinutesFor(n))).toEqual([
      0, 0, 2, 0, 15, 0, 60, 60,
    ]);
  });
  it("locks an IP at 20 and 40+", () => {
    expect([19, 20, 21, 40, 41].map((n) => lockMinutesFor(n, "ip"))).toEqual([0, 15, 0, 60, 60]);
  });
  it("reads the caller IP from proxy headers, ignoring junk", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe(
      "203.0.113.9",
    );
    expect(clientIpFrom(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "'; drop table" }))).toBe("");
    expect(clientIpFrom(null)).toBe("");
  });
  it("counts down m:ss and ends", () => {
    const now = Date.parse("2026-10-28T10:00:00Z");
    expect(lockRemaining("2026-10-28T10:01:45Z", now)).toBe("1:45");
    expect(lockRemaining("2026-10-28T09:59:00Z", now)).toBeNull();
    expect(lockRemaining(null, now)).toBeNull();
  });
});

describe("X02 password reset rule", () => {
  it("checks length, letter + digit and confirmation", () => {
    expect(passwordResetProblem("a1", "a1")).toBe("tooShort");
    expect(passwordResetProblem("x".repeat(73) + "1", "")).toBe("tooLong");
    expect(passwordResetProblem("abcdefgh", "abcdefgh")).toBe("needsLetterAndDigit");
    expect(passwordResetProblem("12345678", "12345678")).toBe("needsLetterAndDigit");
    expect(passwordResetProblem("كلمةسر123", "كلمةسر123")).toBeNull();
    expect(passwordResetProblem("abcdefg1", "abcdefg2")).toBe("mismatch");
  });
  it("TOTP codes keep six digits only", () => {
    expect(cleanTotpCode("12 34-56 78")).toBe("123456");
  });
  it("second step is needed only on an aal1 session with a factor", () => {
    expect(needsSecondStep({ currentLevel: "aal1", nextLevel: "aal2", factors: [] })).toBe(true);
    expect(needsSecondStep({ currentLevel: "aal2", nextLevel: "aal2", factors: [] })).toBe(false);
    expect(needsSecondStep({ currentLevel: "aal1", nextLevel: "aal1", factors: [] })).toBe(false);
  });
});

describe("X06 upload rule", () => {
  it("accepts documents and images up to 20 MB", () => {
    expect(uploadProblem({ name: "invoice.PDF", size: 1000, type: "application/pdf" })).toBeNull();
    expect(
      uploadProblem({
        name: "sheet.xlsx",
        size: 1000,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBeNull();
    expect(
      uploadProblem({ name: "scan.jpg", size: MAX_UPLOAD_BYTES, type: "image/jpeg" }),
    ).toBeNull();
  });
  it("refuses big, empty and strange files", () => {
    expect(uploadProblem({ name: "big.pdf", size: MAX_UPLOAD_BYTES + 1 })).toBe("tooLarge");
    expect(uploadProblem({ name: "empty.pdf", size: 0 })).toBe("empty");
    expect(uploadProblem({ name: "run.exe", size: 10 })).toBe("badType");
    expect(uploadProblem({ name: "page.html", size: 10, type: "text/html" })).toBe("badType");
    expect(uploadProblem({ name: "fake.pdf", size: 10, type: "text/html" })).toBe("badType");
    expect(uploadProblem({ name: "noext", size: 10 })).toBe("badType");
  });
  it("makes ASCII storage names and keeps the extension", () => {
    expect(safeStorageName("فاتورة رقم 5.pdf")).toBe("5.pdf");
    expect(safeStorageName("Receipt (final).JPG")).toBe("Receipt_final.jpg");
    expect(safeStorageName("عقد.docx")).toBe("file.docx");
  });
});

describe("X13 per diem totals", () => {
  const rows = [
    {
      id: "1",
      person_id: "p1",
      shoot_days: 5,
      off_days: 2,
      on_set_rate: 150,
      off_set_rate: 300,
      status: "paid",
      currency: "SAR",
      budget_code: "2101",
    },
    {
      id: "2",
      person_id: "p1",
      shoot_days: 3,
      off_days: 0,
      on_set_rate: 100.335,
      off_set_rate: 0,
      status: "pending",
      currency: "SAR",
      budget_code: "2101",
    },
    {
      id: "3",
      person_id: "p2",
      shoot_days: 4,
      off_days: 1,
      on_set_rate: 50,
      off_set_rate: 100,
      status: "paid",
      currency: "USD",
      budget_code: "2102",
    },
    // a suggested draft row: not money until saved
    {
      id: null,
      person_id: "p3",
      shoot_days: 9,
      off_days: 0,
      on_set_rate: 999,
      off_set_rate: 0,
      status: "pending",
      currency: "SAR",
    },
  ];
  it("row total = days × rates (2 dp), same as the database", () => {
    expect(perDiemRowTotal(rows[0])).toBe(1350);
    expect(perDiemRowTotal(rows[1])).toBe(301.01);
  });
  it("totals skip unsaved drafts and split by status and currency", () => {
    const t = perDiemTotals(rows);
    expect(t.paid).toEqual({ SAR: 1350, USD: 300 });
    expect(t.pending).toEqual({ SAR: 301.01 });
    expect(t.rows).toBe(3);
    expect(t.days).toEqual({ shoot: 12, off: 3 });
  });
  it("converts to SAR and groups for the report", () => {
    expect(toSar({ SAR: 1350, USD: 300 }, 3.75)).toBe(2475);
    const byPerson = groupPerDiem(rows, "person");
    expect(byPerson.map((g) => [g.key, g.rows])).toEqual([
      ["p1", 2],
      ["p2", 1],
    ]);
    const byCode = groupPerDiem(rows, "code");
    expect(byCode.find((g) => g.key === "2101")?.pending).toEqual({ SAR: 301.01 });
  });
});

describe("X24 e-mail building", () => {
  it("never lets a value add a header", () => {
    expect(headerSafe("Hi\r\nBcc: evil@x.com")).toBe("Hi Bcc: evil@x.com");
  });
  it("parses addresses", () => {
    expect(addressOf("Kwalis HUB <noreply@kwalis.test>")).toBe("noreply@kwalis.test");
    expect(addressOf("a@b.co")).toBe("a@b.co");
    expect(addressOf("not an address")).toBeNull();
  });
  it("encodes Arabic subjects as UTF-8 words and keeps ASCII as is", () => {
    expect(encodeHeaderWord("Approved")).toBe("Approved");
    expect(encodeHeaderWord("تم الاعتماد")).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  });
  it("builds a plain-text MIME message", () => {
    const m = buildMimeMessage(
      {
        from: "Kwalis HUB <noreply@kwalis.test>",
        to: "a@b.co",
        subject: "Test",
        text: "line1\nline2",
      },
      new Date("2026-10-28T10:00:00Z"),
      "id-1",
    );
    expect(m).toContain("Message-ID: <id-1@kwalis.test>");
    expect(m).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(m).toContain("Auto-Submitted: auto-generated");
    const body = m.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("line1\r\nline2");
  });
  it("dot-stuffs SMTP data", () => {
    expect(dotStuff(".a\r\n.b\r\nc.")).toBe("..a\r\n..b\r\nc.");
  });
  it("adds the link to the app", () => {
    expect(notificationEmailText({ body: "X", appUrl: "https://app.test/" })).toContain(
      "https://app.test/notifications",
    );
  });
  it("is off without MAIL_FROM / SMTP_HOST", () => {
    expect(mailerConfigFromEnv({})).toBeNull();
    expect(mailerConfigFromEnv({ MAIL_FROM: "noreply@k.test" })).toBeNull();
    expect(
      mailerConfigFromEnv({ MAIL_FROM: "noreply@k.test", SMTP_HOST: "smtp.k.test" }),
    ).toMatchObject({
      kind: "smtp",
      port: 587,
    });
    expect(
      mailerConfigFromEnv({
        MAIL_FROM: "noreply@k.test",
        MAIL_PROVIDER: "resend",
        RESEND_API_KEY: "k",
      }),
    ).toMatchObject({ kind: "resend" });
  });
});

describe("D04 / X24 notification text", () => {
  const t = (k: string, o?: Record<string, unknown>) => `${k}${o ? JSON.stringify(o) : ""}`;
  it("rebuilds budget alerts from metadata", () => {
    const r = notificationText(
      {
        category: "budget_alert",
        title: "Budget code 1403 reached 80% of its budget",
        body: "x",
        project_id: "p",
        metadata: {
          budget_code: "1403",
          threshold: 80,
          pct: 85,
          spent_sar: 17000,
          budget_sar: 20000,
        },
      },
      t,
    );
    expect(r.title).toContain("platform.notify.budget80Title");
    expect(r.body).toContain('"pct":"85.0"');
  });
  it("translates payment decisions and keeps the document text", () => {
    const r = notificationText(
      {
        category: "payment_approval",
        title: "Your payment request was rejected",
        body: "Casting — SAR 1,000.00 · Reason: no PO",
        project_id: "p",
        metadata: { status: "rejected", rejection_reason: "no PO" },
      },
      t,
    );
    expect(r.title).toBe("platform.notify.payment_rejected");
    expect(r.body).toBe('Casting — SAR 1,000.00 · platform.notify.reason{"reason":"no PO"}');
  });
  it("routes approvals and alerts", () => {
    expect(
      notificationTarget({ category: "payment_approval", title: "", body: null, project_id: "p" })
        ?.to,
    ).toBe("/payment-approvals");
    expect(
      notificationTarget({ category: "budget_alert", title: "", body: null, project_id: "p" })?.to,
    ).toBe("/budget");
    expect(
      notificationTarget({ category: "budget_alert", title: "", body: null, project_id: null }),
    ).toBeNull();
  });
});

describe("X14 report tab flags", () => {
  it("hides GOSI by default and honours overrides", () => {
    expect(isReportTabEnabled("gosi", {})).toBe(false);
    expect(isReportTabEnabled("final", {})).toBe(true);
    expect(isReportTabEnabled("gosi", { VITE_REPORT_TABS_ENABLE: "gosi" })).toBe(true);
    expect(isReportTabEnabled("vat", { VITE_REPORT_TABS_DISABLE: "qfe, vat" })).toBe(false);
  });
});
