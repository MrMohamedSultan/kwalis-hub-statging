import { formatDateTime } from "@/lib/date-format";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { LifeBuoy, Send, RefreshCw, MessageSquare, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  AttachmentLink,
  ACCEPTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_MB,
  uploadSupportAttachment,
} from "@/lib/support-attachments";

export const Route = createFileRoute("/_authenticated/support")({
  component: () => (
    <AppShell>
      <SupportPage />
    </AppShell>
  ),
});

type Ticket = {
  id: string;
  subject: string;
  category: "Bug" | "Financial" | "Access" | "Other";
  description: string;
  status: "Open" | "In Progress" | "Closed";
  priority: "Normal" | "Urgent";
  admin_reply: string | null;
  admin_replied_at: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_TONE: Record<Ticket["status"], string> = {
  Open: "bg-warning/15 text-warning border-warning/30",
  "In Progress": "bg-info/15 text-info border-info/30",
  Closed: "bg-success/15 text-success border-success/30",
};

const PRIORITY_TONE: Record<Ticket["priority"], string> = {
  Normal: "bg-surface-2 text-foreground border-border",
  Urgent: "bg-destructive/15 text-destructive border-destructive/30",
};

function SupportPage() {
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<Ticket["category"]>("Other");
  const [priority, setPriority] = useState<Ticket["priority"]>("Normal");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("support_tickets" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(t("support.loadFailed"));
    setTickets((data as unknown as Ticket[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      toast.error(t("support.fileTooLarge", { mb: MAX_ATTACHMENT_MB }));
      e.target.value = "";
      return;
    }
    setFile(f);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = subject.trim();
    const d = description.trim();
    if (!s) return toast.error(t("support.subjectRequired"));
    if (!d) return toast.error(t("support.descriptionRequired"));
    setSubmitting(true);
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) {
      setSubmitting(false);
      return toast.error(t("support.notSignedIn"));
    }

    const ticketId = crypto.randomUUID();
    let attachment_path: string | null = null;
    let attachment_name: string | null = null;
    if (file) {
      try {
        const up = await uploadSupportAttachment({
          userId: userRes.user.id,
          ticketId,
          file,
        });
        attachment_path = up.path;
        attachment_name = up.name;
      } catch (err) {
        setSubmitting(false);
        return toast.error(`${t("support.uploadFailed")}: ${(err as Error).message}`);
      }
    }

    const { error } = await supabase.from("support_tickets" as any).insert({
      id: ticketId,
      user_id: userRes.user.id,
      subject: s,
      category,
      priority,
      description: d,
      attachment_path,
      attachment_name,
    } as any);
    setSubmitting(false);
    if (error) return toast.error(error.message || t("support.submitFailed"));
    toast.success(t("support.submitted"));
    setSubject("");
    setDescription("");
    setCategory("Other");
    setPriority("Normal");
    clearFile();
    void load();
  };

  const CATS: Ticket["category"][] = ["Bug", "Financial", "Access", "Other"];
  const PRIOS: Ticket["priority"][] = ["Normal", "Urgent"];

  return (
    <>
      <PageTitle
        title={t("support.center")}
        action={
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-muted"
          >
            <RefreshCw className="size-4" /> {t("common.refresh")}
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <LifeBuoy className="size-5 text-brand" />
            <h2 className="text-lg font-semibold">{t("support.createTicket")}</h2>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("common.subject")}</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                required
                placeholder={t("support.subjectPlaceholder")}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-brand/40"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t("common.category")}</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Ticket["category"])}
                  className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-brand/40"
                >
                  {CATS.map((c) => (
                    <option key={c} value={c}>
                      {t(`support.category.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t("common.priority")}</span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Ticket["priority"])}
                  className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-brand/40"
                >
                  {PRIOS.map((p) => (
                    <option key={p} value={p}>
                      {t(`support.priorityLevel.${p}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("common.description")}</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                required
                rows={6}
                placeholder={t("support.descPlaceholder")}
                className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-brand/40"
              />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {t("common.attachment")} ({t("common.optional")})
              </span>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 cursor-pointer hover:bg-muted text-sm">
                  <Paperclip className="size-4" />
                  <span>{file ? t("support.changeFile") : t("support.attach")}</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_ATTACHMENT_TYPES}
                    onChange={onFileChange}
                    className="hidden"
                  />
                </label>
                {file && (
                  <div className="flex items-center gap-1 rounded-md bg-surface border border-border px-2 py-1 text-xs max-w-[60%]">
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={clearFile}
                      className="text-muted-foreground hover:text-white"
                      aria-label={t("common.remove")}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {t("support.attachHint", { mb: MAX_ATTACHMENT_MB })}
              </span>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white shadow-lg shadow-brand/20 hover:brightness-110 disabled:opacity-60"
            >
              <Send className="size-4" />{" "}
              {submitting ? t("common.submitting") : t("support.submit")}
            </button>
          </form>
        </Panel>

        <Panel className="lg:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="size-5 text-brand" />
            <h2 className="text-lg font-semibold">{t("support.myTickets")}</h2>
            <span className="ms-auto text-xs text-muted-foreground">
              {tickets.length} {t("common.total")}
            </span>
          </div>
          {loading ? (
            <div className="text-muted-foreground text-sm py-6">{t("common.loading")}</div>
          ) : tickets.length === 0 ? (
            <div className="text-muted-foreground text-sm py-6">{t("support.empty")}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="rounded-lg border border-border bg-card/[0.03] hover:bg-card/[0.05] transition"
                >
                  <button
                    onClick={() => setExpandedId(expandedId === ticket.id ? null : ticket.id)}
                    className="w-full text-start px-3 py-2.5 flex items-center gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{ticket.subject}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span>{t(`support.category.${ticket.category}`)}</span>
                        <span>·</span>
                        <span>{formatDateTime(ticket.created_at)}</span>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] uppercase px-2 py-0.5 rounded border ${PRIORITY_TONE[ticket.priority]}`}
                    >
                      {t(`support.priorityLevel.${ticket.priority}`)}
                    </span>
                    <span
                      className={`text-[10px] uppercase px-2 py-0.5 rounded border ${STATUS_TONE[ticket.status]}`}
                    >
                      {t(`support.status.${ticket.status}`)}
                    </span>
                  </button>
                  {expandedId === ticket.id && (
                    <div className="px-3 pb-3 pt-1 border-t border-border flex flex-col gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                          {t("common.description")}
                        </div>
                        <div className="text-sm whitespace-pre-wrap text-foreground">
                          {ticket.description}
                        </div>
                      </div>
                      {ticket.attachment_path && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                            {t("common.attachment")}
                          </div>
                          <AttachmentLink
                            path={ticket.attachment_path}
                            name={ticket.attachment_name}
                          />
                        </div>
                      )}
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                          {t("support.adminReply")}
                        </div>
                        {ticket.admin_reply ? (
                          <div className="rounded-md bg-brand/10 border border-brand/25 p-2 text-sm whitespace-pre-wrap">
                            {ticket.admin_reply}
                            {ticket.admin_replied_at && (
                              <div className="text-[11px] text-muted-foreground mt-1">
                                {formatDateTime(ticket.admin_replied_at)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground italic">
                            {t("support.awaiting")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
