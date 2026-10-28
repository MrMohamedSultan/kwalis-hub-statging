/**
 * X24 — plain-text e-mail in a form mail servers and spam filters accept:
 * RFC 5322 headers, UTF-8 (Arabic safe) via RFC 2047 encoded words and a
 * base64 body, a Message-ID on the sender's domain, and Auto-Submitted so
 * autoresponders do not answer. Pure — tested in mime.test.ts.
 */
export type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
};

/** Removes CR/LF so a value can never add a header (header injection). */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** The bare address of "Name <a@b.c>" or "a@b.c"; null when not an address. */
export function addressOf(value: string): string | null {
  const v = headerSafe(value);
  const m = v.match(/<([^>]+)>\s*$/);
  const addr = (m ? m[1] : v).trim();
  return EMAIL_RE.test(addr) ? addr : null;
}

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/** RFC 2047 encoded word when the text is not plain ASCII. */
export function encodeHeaderWord(value: string): string {
  const v = headerSafe(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  return `=?UTF-8?B?${b64(v)}?=`;
}

function encodeMailbox(value: string): string {
  const v = headerSafe(value);
  const m = v.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (!m) return v;
  const name = m[1].replace(/^"|"$/g, "");
  return name ? `${encodeHeaderWord(name)} <${m[2]}>` : `<${m[2]}>`;
}

function wrap76(s: string): string {
  return s.replace(/.{1,76}/g, (line) => `${line}\r\n`);
}

export function buildMimeMessage(msg: MailMessage, now = new Date(), id = cryptoId()): string {
  const fromAddr = addressOf(msg.from) ?? "noreply@localhost";
  const domain = fromAddr.split("@")[1] ?? "localhost";
  const headers = [
    `From: ${encodeMailbox(msg.from)}`,
    `To: ${encodeMailbox(msg.to)}`,
    `Subject: ${encodeHeaderWord(msg.subject)}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
  ];
  if (msg.replyTo && addressOf(msg.replyTo)) headers.push(`Reply-To: ${encodeMailbox(msg.replyTo)}`);
  const body = msg.text.replace(/\r?\n/g, "\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${wrap76(b64(body))}`;
}

function cryptoId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `${Date.now()}.${Math.random().toString(36).slice(2)}`;
}

/** SMTP DATA: lines starting with "." get a second dot (RFC 5321 §4.5.2). */
export function dotStuff(data: string): string {
  return data.replace(/(^|\r\n)\./g, "$1..");
}

/** Text of a notification e-mail (English + Arabic lead line, link to the app). */
export function notificationEmailText(input: {
  body: string;
  appUrl: string | null;
}): string {
  const link = input.appUrl ? `${input.appUrl.replace(/\/+$/, "")}/notifications` : null;
  return [
    "لديك إشعار جديد في Kwalis HUB / You have a new notification in Kwalis HUB.",
    "",
    input.body,
    "",
    link ? `Open / افتح: ${link}` : "",
    "",
    "—",
    "This message was sent automatically. Do not reply.",
    "هذه رسالة آلية، الرجاء عدم الرد عليها.",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}
