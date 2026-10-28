import { describe, expect, it } from "vitest";
import { uploadContentType } from "@/lib/upload-policy";

describe("uploadContentType (buckets refuse application/octet-stream, db/pending/195)", () => {
  it("keeps a specific allowed type the browser reports", () => {
    expect(uploadContentType({ name: "a.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(uploadContentType({ name: "photo.JPG", type: "image/jpeg" })).toBe("image/jpeg");
  });
  it("uses the extension when the type is empty or generic", () => {
    expect(uploadContentType({ name: "scan.heic", type: "" })).toBe("image/heic");
    expect(uploadContentType({ name: "list.csv", type: "application/octet-stream" })).toBe(
      "text/csv",
    );
    expect(uploadContentType({ name: "Contract.DOCX" })).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });
  it("never sends a non-allowed browser type for an allowed extension", () => {
    expect(uploadContentType({ name: "x.pdf", type: "text/html" })).toBe("application/pdf");
  });
  it("falls back to what was given for an unknown extension", () => {
    expect(uploadContentType({ name: "clip.mp4", type: "video/mp4" })).toBe("video/mp4");
    expect(uploadContentType({ name: "noext", type: "" })).toBe("application/octet-stream");
  });
});
