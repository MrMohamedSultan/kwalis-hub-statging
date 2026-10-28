/**
 * X24 — server-only e-mail sender for notification e-mails.
 *
 * Configured ONLY through environment variables, read inside the call
 * (never at import time, never sent to the browser):
 *
 *   MAIL_FROM            "Kwalis HUB <noreply@kwalis.example>"  (required)
 *   MAIL_PROVIDER        "smtp" (default) | "resend"
 *   SMTP_HOST            smtp.example.com
 *   SMTP_PORT            465 (implicit TLS) or 587 (STARTTLS, default)
 *   SMTP_USER / SMTP_PASS  login (AUTH PLAIN, only over TLS)
 *   RESEND_API_KEY       when MAIL_PROVIDER=resend
 *
 * See docs/NOTIFICATIONS_EMAIL.md for SPF / DKIM / DMARC (needed so the
 * mails do not land in spam).
 */
import { addressOf, buildMimeMessage, dotStuff, type MailMessage } from "./mime";

export type MailerConfig =
  | { kind: "smtp"; from: string; host: string; port: number; user: string | null; pass: string | null }
  | { kind: "resend"; from: string; apiKey: string };

/** The configuration from process.env, or null when e-mail is not set up. */
export function mailerConfigFromEnv(env: Record<string, string | undefined> = process.env): MailerConfig | null {
  const from = env.MAIL_FROM?.trim();
  if (!from || !addressOf(from)) return null;
  const provider = (env.MAIL_PROVIDER ?? "smtp").trim().toLowerCase();
  if (provider === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    return apiKey ? { kind: "resend", from, apiKey } : null;
  }
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT ?? 587) || 587;
  return {
    kind: "smtp",
    from,
    host,
    port,
    user: env.SMTP_USER?.trim() || null,
    pass: env.SMTP_PASS ?? null,
  };
}

export async function sendMail(cfg: MailerConfig, msg: Omit<MailMessage, "from">): Promise<void> {
  const to = addressOf(msg.to);
  if (!to) throw new Error("invalid recipient");
  if (cfg.kind === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
    return;
  }
  await smtpSend(cfg, { ...msg, to, from: cfg.from });
}

// ---------------------------------------------------------------------
// Minimal SMTP client (EHLO, STARTTLS or implicit TLS, AUTH PLAIN, one
// recipient). Node runtime only (self-hosted node-server build).
// ---------------------------------------------------------------------
type Sock = import("node:net").Socket | import("node:tls").TLSSocket;

class SmtpConversation {
  private buf = "";
  private waiters: ((line: string) => void)[] = [];
  private lines: string[] = [];
  private failed: Error | null = null;
  constructor(public socket: Sock) {
    this.attach(socket);
  }
  attach(socket: Sock) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf("\r\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        const w = this.waiters.shift();
        if (w) w(line);
        else this.lines.push(line);
      }
    });
    socket.on("error", (e: Error) => {
      this.failed = e;
    });
  }
  detach() {
    this.socket.removeAllListeners("data");
  }
  private nextLine(): Promise<string> {
    if (this.failed) return Promise.reject(this.failed);
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("smtp timeout")), 20_000);
      this.waiters.push((l) => {
        clearTimeout(timer);
        resolve(l);
      });
    });
  }
  /** Reads one (multi-line) reply and checks its code. */
  async expect(...codes: number[]): Promise<string[]> {
    const out: string[] = [];
    for (;;) {
      const line = await this.nextLine();
      out.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) break;
    }
    const code = Number(out[out.length - 1].slice(0, 3));
    if (!codes.includes(code)) throw new Error(`smtp ${code}`);
    return out;
  }
  send(cmd: string) {
    this.socket.write(`${cmd}\r\n`);
  }
}

async function smtpSend(
  cfg: Extract<MailerConfig, { kind: "smtp" }>,
  msg: MailMessage,
): Promise<void> {
  const net = await import("node:net");
  const tls = await import("node:tls");
  const implicitTls = cfg.port === 465;
  const socket: Sock = implicitTls
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : net.connect({ host: cfg.host, port: cfg.port });
  const c = new SmtpConversation(socket);
  const ehloName = addressOf(cfg.from)?.split("@")[1] ?? "localhost";
  try {
    await c.expect(220);
    c.send(`EHLO ${ehloName}`);
    let caps = await c.expect(250);
    let secure = implicitTls;
    if (!secure && caps.some((l) => /STARTTLS/i.test(l))) {
      c.send("STARTTLS");
      await c.expect(220);
      c.detach();
      const upgraded = tls.connect({ socket: c.socket as import("node:net").Socket, servername: cfg.host });
      await new Promise<void>((resolve, reject) => {
        upgraded.once("secureConnect", () => resolve());
        upgraded.once("error", reject);
      });
      c.attach(upgraded);
      secure = true;
      c.send(`EHLO ${ehloName}`);
      caps = await c.expect(250);
    }
    if (cfg.user) {
      // Never send a password over a plain connection.
      if (!secure) throw new Error("smtp server offers no TLS");
      c.send(`AUTH PLAIN ${Buffer.from(`\u0000${cfg.user}\u0000${cfg.pass ?? ""}`).toString("base64")}`);
      await c.expect(235);
    }
    c.send(`MAIL FROM:<${addressOf(cfg.from)}>`);
    await c.expect(250);
    c.send(`RCPT TO:<${msg.to}>`);
    await c.expect(250, 251);
    c.send("DATA");
    await c.expect(354);
    c.socket.write(`${dotStuff(buildMimeMessage(msg))}\r\n.\r\n`);
    await c.expect(250);
    c.send("QUIT");
  } finally {
    c.socket.end();
  }
}
