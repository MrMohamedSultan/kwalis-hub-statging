import i18n from "@/lib/i18n";

/**
 * X06 — one rule for every upload: at most 20 MB, documents and images only.
 * The same limit and list are set on the storage buckets
 * (db/pending/195_platform.sql §2), so a direct API upload is refused too.
 * Every bucket is private: files open through short-lived signed URLs only.
 */
export const MAX_UPLOAD_MB = 20;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const ALLOWED_UPLOAD_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "heic",
  "heif",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "csv",
  "txt",
  "zip",
] as const;

/** Value for `<input type="file" accept>` — the picker shows only allowed files. */
export const UPLOAD_ACCEPT = ALLOWED_UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(",");

const ALLOWED_MIME_PREFIXES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "text/csv",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
];

export type UploadProblem = "empty" | "tooLarge" | "badType";

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > -1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Why a file may not be uploaded, or null when it is fine. */
export function uploadProblem(file: {
  name: string;
  size: number;
  type?: string;
}): UploadProblem | null {
  if (!file || file.size <= 0) return "empty";
  if (file.size > MAX_UPLOAD_BYTES) return "tooLarge";
  const ext = fileExtension(file.name);
  if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) return "badType";
  const mime = (file.type ?? "").toLowerCase();
  if (mime && !ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) return "badType";
  return null;
}

/** Throws a translated error when the file breaks the rule (use before every upload). */
export function assertUploadAllowed(file: { name: string; size: number; type?: string }): void {
  const problem = uploadProblem(file);
  if (!problem) return;
  throw new Error(
    i18n.t(`platform.upload.${problem}`, {
      name: file.name,
      max: MAX_UPLOAD_MB,
      types: ALLOWED_UPLOAD_EXTENSIONS.join(", "),
    }),
  );
}

/**
 * ASCII-only object name (Storage rejects Arabic / CJK keys with "Invalid
 * key"); the extension is kept so the file opens with the right app.
 */
export function safeStorageName(name: string): string {
  const rawExt = fileExtension(name);
  const ext = rawExt.replace(/[^a-z0-9]/g, "").slice(0, 10);
  const base = name
    .slice(0, rawExt ? name.length - rawExt.length - 1 : name.length)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${base || "file"}${ext ? `.${ext}` : ""}`;
}
