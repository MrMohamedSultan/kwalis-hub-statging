import { ExternalLink, Link as LinkIcon, AlertCircle, AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { useTranslation } from "react-i18next";
/**
 * Cloud attachment link (Google Drive / Dropbox / SharePoint / OneDrive …).
 *
 * Persisted on the record itself (`attachment_url` on crew_members, people
 * and invoices) rather than in local state, so the link travels with the
 * contract or invoice for everyone on the project.
 */

/**
 * Smart coercion for pasted links.
 *
 * Users routinely paste `drive.google.com/file/d/…` or
 * `www.dropbox.com/scl/…` without a protocol, and sometimes with stray
 * whitespace or wrapping angle brackets/quotes from an email or chat.
 * Rejecting those is needless friction, so we repair what we safely can and
 * only complain about input that can't be a web link at all.
 */
export function coerceAttachmentUrl(v: string | null | undefined): string {
  let s = (v ?? "").trim();
  if (!s) return "";
  // Strip wrappers picked up when copying out of email / chat clients.
  s = s.replace(/^[<"'\s]+/, "").replace(/[>"'\s]+$/, "");
  if (!s) return "";
  // Already carries a scheme? Normalize a mistyped one like "https:/host".
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/*/.exec(s);
  if (scheme) {
    const proto = scheme[1].toLowerCase();
    if (proto === "http" || proto === "https") {
      return `${proto}://${s.slice(scheme[0].length)}`;
    }
    return s; // leave other schemes alone — validation will flag them
  }
  // Protocol-relative ("//drive.google.com/…") or bare host — assume https.
  return `https://${s.replace(/^\/+/, "")}`;
}

/**
 * A value is valid when it is empty (the field is optional) or when the
 * coerced form parses as an http(s) URL with a plausible host. Cloud storage
 * links carry long query strings, encoded paths, and fragments — the WHATWG
 * URL parser handles all of those, so no bespoke regex is used.
 */
export function isValidAttachmentUrl(v: string): boolean {
  const raw = (v ?? "").trim();
  if (!raw) return true; // optional field
  try {
    const u = new URL(coerceAttachmentUrl(raw));
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // Require a dotted host (or localhost) so plain prose isn't accepted.
    return u.hostname === "localhost" || /^[^\s.]+(\.[^\s.]+)+$/.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Plain-language description of every repair `coerceAttachmentUrl` applies,
 * so the user can see exactly what will be saved and why it differs from
 * what they pasted.
 */
export function describeAttachmentUrlChanges(v: string | null | undefined): string[] {
  const raw = v ?? "";
  const out: string[] = [];
  if (!raw.trim()) return out;
  const trimmed = raw.trim();
  const unwrapped = trimmed.replace(/^[<"'\s]+/, "").replace(/[>"'\s]+$/, "");
  if (!unwrapped) return out;
  if (raw !== trimmed) out.push("Surrounding spaces were removed.");
  if (unwrapped !== trimmed)
    out.push("Stray quotes or angle brackets from the copied text were stripped.");
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):(\/*)/.exec(unwrapped);
  if (!scheme) {
    out.push("No protocol was given — https:// was added automatically.");
  } else {
    const proto = scheme[1].toLowerCase();
    if (proto === "http" || proto === "https") {
      if (scheme[1] !== proto) out.push("The protocol was lower-cased.");
      if (scheme[2].length !== 2)
        out.push(`Mistyped protocol separator was repaired to "${proto}://".`);
      if (proto === "http") out.push("This is an insecure http:// link.");
    }
  }
  return out;
}

/** Normalize for persistence: coerced absolute URL, or null when empty. */

export function normalizeAttachmentUrl(v: string | null | undefined): string | null {
  const s = coerceAttachmentUrl(v);
  return s ? s : null;
}

export function AttachmentUrlField({
  value,
  onChange,
  className = "",
  label = "Attachment URL (Google Drive, Dropbox, etc.)",
  externalError = null,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  label?: string;
  externalError?: string | null;
}) {
  const { t } = useTranslation();

  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = (value ?? "").trim();
  const valid = useMemo(() => isValidAttachmentUrl(value), [value]);
  const resolved = useMemo(() => coerceAttachmentUrl(value), [value]);
  const changes = useMemo(() => describeAttachmentUrlChanges(value), [value]);

  const localError =
    trimmed.length > 0 && !valid
      ? "That doesn't look like a web link — e.g. drive.google.com/file/d/…"
      : "";
  const errorMessage = localError || externalError || "";
  const showError = !!errorMessage;

  // Block native form submission while the URL is malformed.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.setCustomValidity(errorMessage);
  }, [errorMessage]);

  return (
    <div className={className}>
      <div className="text-muted-foreground mb-1 text-sm">
        {label} <span className="text-foreground/60 font-normal">· رابط المرفق</span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <LinkIcon className="size-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            inputMode="url"
            dir="ltr"
            placeholder="https://drive.google.com/…"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => {
              // Repair pasted links ("drive.google.com/…" → "https://drive.google.com/…")
              const fixed = coerceAttachmentUrl(e.target.value);
              if (fixed !== (value ?? "").trim()) onChange(fixed);
            }}
            aria-invalid={showError || undefined}
            aria-label={label}
            className={`w-full ps-9 pe-3 py-2 rounded-xl bg-surface-2 border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 ${
              showError
                ? "border-destructive/50 focus:ring-destructive/40"
                : "border-border focus:ring-brand/40"
            }`}
          />
        </div>
        <a
          href={valid && resolved ? resolved : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!valid || !resolved}
          onClick={(e) => {
            if (!valid || !resolved) e.preventDefault();
          }}
          title={valid && trimmed ? "Open attachment in a new tab" : "Enter a valid URL to enable"}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm whitespace-nowrap ${
            valid && trimmed
              ? "border-brand/40 bg-brand/10 text-brand hover:bg-brand/20"
              : "border-border bg-surface-2 text-muted-foreground opacity-50 cursor-not-allowed"
          }`}
        >
          <ExternalLink className="size-4" />
          {t("attachmenturlfield.open_attachment")}
        </a>
      </div>
      {showError && (
        <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          {errorMessage}
        </div>
      )}
      {valid && resolved && (
        <div className="mt-1.5 space-y-1">
          <div className="text-xs text-muted-foreground break-all">
            Will be saved as{" "}
            <span className="text-foreground/80 font-medium" dir="ltr">
              {resolved}
            </span>
          </div>
          {changes.map((c) => (
            <div key={c} className="inline-flex items-start gap-1.5 text-xs text-warning me-3">
              <AlertTriangle className="size-3.5 mt-px shrink-0" />
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact table/detail affordance — renders nothing when there is no link. */
export function AttachmentLinkBadge({
  url,
  compact = false,
  title = "Open attachment",
}: {
  url?: string | null;
  compact?: boolean;
  title?: string;
}) {
  const trimmed = (url ?? "").trim();
  if (!trimmed || !isValidAttachmentUrl(trimmed)) return null;
  return (
    <a
      href={trimmed}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 rounded-lg border border-info/30 bg-info/20 text-info font-semibold hover:bg-info/30 ${
        compact ? "p-1.5" : "px-2 py-1 text-xs"
      }`}
    >
      <ExternalLink className="size-3" />
      {!compact && "Attachment"}
    </a>
  );
}
