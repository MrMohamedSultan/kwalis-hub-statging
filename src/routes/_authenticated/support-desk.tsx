import { formatDate, formatDateTime } from "@/lib/date-format";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { requireRoles } from "@/lib/auth-roles";
import { Headphones, RefreshCw, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AttachmentLink } from "@/lib/support-attachments";

export const Route = createFileRoute("/_authenticated/support-desk")({
  beforeLoad: async () => {
    await requireRoles((r) => r.isSuperAdmin, "/");
    return {};
  },
  component: () => (
    <AppShell>
      <SupportDeskPage />
    </AppShell>
  ),
});

type Ticket = {
  id: string;
  user_id: string;
  subject: string;
  category: string;
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

function SupportDeskPage() {
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("support_tickets" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message || t("support.loadFailed"));
    const list = (data as unknown as Ticket[]) ?? [];
    setTickets(list);

    const ids = Array.from(new Set(list.map((r) => r.user_id)));
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      const map: Record<string, string> = {};
      for (const p of (profs ?? []) as { id: string; display_name: string | null }[]) {
        map[p.id] = p.display_name ?? p.id.slice(0, 8);
      }
      setEmails(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (priorityFilter !== "all" && r.priority !== priorityFilter) return false;
      if (!q) return true;
      return (
        r.subject.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        (emails[r.user_id] ?? "").toLowerCase().includes(q)
      );
    });
  }, [tickets, query, statusFilter, categoryFilter, priorityFilter, emails]);

  const selected = tickets.find((r) => r.id === selectedId) ?? null;
  const STATUSES: Ticket["status"][] = ["Open", "In Progress", "Closed"];
  const CATS = ["Bug", "Financial", "Access", "Other"] as const;
  const PRIOS: Ticket["priority"][] = ["Normal", "Urgent"];

  return (
    <>
      <PageTitle
        title={t("support.desk")}
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
        <Panel className="lg:col-span-3">
          <div className="flex items-center gap-2 mb-3">
            <Headphones className="size-5 text-brand" />
            <h2 className="text-lg font-semibold">{t("support.allTickets")}</h2>
            <span className="ms-auto text-xs text-muted-foreground">
              {filtered.length} / {tickets.length}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="size-4 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("support.searchPlaceholder")}
                className="w-full ps-8 pe-3 py-2 rounded-lg border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="all">{t("support.allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`support.status.${s}`)}
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="all">{t("support.allCategories")}</option>
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {t(`support.category.${c}`)}
                </option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="all">{t("support.allPriorities")}</option>
              {PRIOS.map((p) => (
                <option key={p} value={p}>
                  {t(`support.priorityLevel.${p}`)}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="text-muted-foreground text-sm py-6">{t("common.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground text-sm py-6">{t("support.notFound")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="py-2 pe-3 text-start">{t("common.subject")}</th>
                    <th className="py-2 pe-3 text-start">{t("common.user")}</th>
                    <th className="py-2 pe-3 text-start">{t("common.category")}</th>
                    <th className="py-2 pe-3 text-start">{t("common.priority")}</th>
                    <th className="py-2 pe-3 text-start">{t("common.status")}</th>
                    <th className="py-2 pe-3 text-start">{t("common.created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`border-b border-border cursor-pointer hover:bg-muted ${selectedId === r.id ? "bg-card/[0.06]" : ""}`}
                    >
                      <td className="py-2 pe-3 font-medium max-w-[220px] truncate">{r.subject}</td>
                      <td className="py-2 pe-3 text-muted-foreground">
                        {emails[r.user_id] ?? r.user_id.slice(0, 8)}
                      </td>
                      <td className="py-2 pe-3 text-muted-foreground">
                        {t(`support.category.${r.category}`, { defaultValue: r.category })}
                      </td>
                      <td className="py-2 pe-3">
                        <span
                          className={`text-[10px] uppercase px-2 py-0.5 rounded border ${PRIORITY_TONE[r.priority]}`}
                        >
                          {t(`support.priorityLevel.${r.priority}`)}
                        </span>
                      </td>
                      <td className="py-2 pe-3">
                        <span
                          className={`text-[10px] uppercase px-2 py-0.5 rounded border ${STATUS_TONE[r.status]}`}
                        >
                          {t(`support.status.${r.status}`)}
                        </span>
                      </td>
                      <td className="py-2 pe-3 text-muted-foreground">
                        {formatDate(r.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel className="lg:col-span-2">
          {selected ? (
            <TicketDetail
              ticket={selected}
              userLabel={emails[selected.user_id] ?? selected.user_id}
              onUpdated={() => void load()}
            />
          ) : (
            <div className="text-muted-foreground text-sm py-6">{t("support.selectHint")}</div>
          )}
        </Panel>
      </div>
    </>
  );
}

function TicketDetail({
  ticket,
  userLabel,
  onUpdated,
}: {
  ticket: Ticket;
  userLabel: string;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Ticket["status"]>(ticket.status);
  const [reply, setReply] = useState(ticket.admin_reply ?? "");
  const [saving, setSaving] = useState(false);
  const STATUSES: Ticket["status"][] = ["Open", "In Progress", "Closed"];

  useEffect(() => {
    setStatus(ticket.status);
    setReply(ticket.admin_reply ?? "");
  }, [ticket.id]);

  const save = async () => {
    setSaving(true);
    const patch: Record<string, unknown> = { status };
    const trimmedReply = reply.trim();
    if (trimmedReply !== (ticket.admin_reply ?? "").trim()) {
      patch.admin_reply = trimmedReply || null;
    }
    const { error } = await supabase
      .from("support_tickets" as any)
      .update(patch as any)
      .eq("id", ticket.id);
    setSaving(false);
    if (error) return toast.error(error.message || t("support.updateFailed"));
    toast.success(t("support.updated"));
    onUpdated();
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("common.subject")}
        </div>
        <div className="font-semibold">{ticket.subject}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("common.user")}
          </div>
          <div className="text-foreground">{userLabel}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("common.priority")}
          </div>
          <div>
            <span
              className={`text-[10px] uppercase px-2 py-0.5 rounded border ${PRIORITY_TONE[ticket.priority]}`}
            >
              {t(`support.priorityLevel.${ticket.priority}`)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("common.category")}
          </div>
          <div className="text-foreground">
            {t(`support.category.${ticket.category}`, { defaultValue: ticket.category })}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("common.created")}
          </div>
          <div className="text-foreground">{formatDateTime(ticket.created_at)}</div>
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          {t("common.description")}
        </div>
        <div className="rounded-lg border border-border bg-card/[0.04] p-3 text-sm whitespace-pre-wrap">
          {ticket.description}
        </div>
      </div>
      {ticket.attachment_path && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            {t("common.attachment")}
          </div>
          <AttachmentLink path={ticket.attachment_path} name={ticket.attachment_name} />
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("common.status")}</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Ticket["status"])}
          className="rounded-lg border border-border bg-surface px-3 py-2"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`support.status.${s}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{t("support.adminReply")}</span>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={5}
          placeholder={t("support.adminReplyPlaceholder")}
          className="rounded-lg border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-brand/40"
        />
      </label>

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white shadow-lg shadow-brand/20 hover:brightness-110 disabled:opacity-60"
      >
        <Send className="size-4" /> {saving ? t("common.saving") : t("support.saveUpdate")}
      </button>
    </div>
  );
}
