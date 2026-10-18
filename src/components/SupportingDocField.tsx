import { Upload, LinkIcon, ExternalLink, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useRef } from "react";

import { useTranslation } from "react-i18next";
type Props = {
  value: string;
  onChange: (v: string) => void;
  className?: string;
};

/**
 * Validate a supporting-document URL. Empty is treated as valid (the field is
 * optional). Non-empty values must parse via the WHATWG URL constructor AND
 * use an http/https protocol, so pasted plain text or malformed links are
 * rejected before form submission.
 */
export function isValidSupportingUrl(v: string): boolean {
  const s = (v ?? "").trim();
  if (!s) return true;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Frontend-only supporting-document field.
 * - Free-text URL input with strict http(s) validation.
 * - Mock "Upload File" button that simulates success and prompts the user
 *   to paste the resulting share link into the field.
 * - "View Document / عرض المستند" button surfaces the saved link so a
 *   previously stored URL is always visible and re-openable on edit.
 * Used by Invoice, Petty Cash, and Payroll entry surfaces; the Saudi Film
 * Commission Rebate export reads this value into the last column of both
 * template sheets as a clickable hyperlink (or "N/A" when absent).
 */
export function SupportingDocField({ value, onChange, className }: Props) {
  const { t } = useTranslation();

  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const trimmed = (value ?? "").trim();
  const valid = useMemo(() => isValidSupportingUrl(value), [value]);
  const showError = trimmed.length > 0 && !valid;

  // Wire validity into the surrounding <form> so submission is blocked while
  // the URL is malformed (native constraint validation surfaces the message).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.setCustomValidity(showError ? "Enter a valid URL starting with http:// or https://" : "");
  }, [showError]);

  const onMockUpload: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    toast.success(
      `"${f.name}" uploaded (mock). Paste the shareable link (Google Drive / Dropbox / SharePoint) into the field.`,
    );
    e.target.value = "";
  };

  return (
    <div className={className}>
      <div className="text-muted-foreground mb-2 uppercase tracking-wider text-xs">
        Supporting Document URL{" "}
        <span className="text-foreground/60 normal-case font-normal">· رابط المستند</span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <LinkIcon className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/…  or  https://www.dropbox.com/…"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={showError || undefined}
            className={`w-full pl-9 pr-3 py-2 rounded-xl bg-surface-2 border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 ${
              showError
                ? "border-destructive/50 focus:ring-destructive/40"
                : "border-border focus:ring-brand/40"
            }`}
          />
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
          title={t("supportingdocfield.mock_upload_after_uploading_paste_the_resulting_share")}
        >
          <Upload className="size-4" />
          Upload File
        </button>
        <a
          href={valid && trimmed ? trimmed : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!valid || !trimmed}
          onClick={(e) => {
            if (!valid || !trimmed) e.preventDefault();
          }}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
            valid && trimmed
              ? "border-brand/40 bg-brand/10 text-brand hover:bg-brand/20"
              : "border-border bg-surface-2 text-muted-foreground opacity-50 cursor-not-allowed"
          }`}
          title={valid && trimmed ? "Open document in a new tab" : "Enter a valid URL to enable"}
        >
          <ExternalLink className="size-4" />
          {t("supportingdocfield.view_document")}
          <span className="text-foreground/60 font-normal">· عرض المستند</span>
        </a>
        <input ref={fileRef} type="file" className="hidden" onChange={onMockUpload} />
      </div>
      {showError && (
        <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          {t("supportingdocfield.enter_a_valid_url_starting_with_http_or")}
        </div>
      )}
      {valid && trimmed && (
        <div className="mt-1 text-xs text-muted-foreground break-all">
          <span className="text-foreground/60">Saved:</span> {trimmed}
        </div>
      )}
    </div>
  );
}
