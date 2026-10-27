import { formatDate } from "@/lib/date-format";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import {
  Wallet,
  TrendingDown,
  PiggyBank,
  ClipboardCheck,
  UserPlus,
  Receipt,
  FileText,
  Activity,
  Download,
  X,
  Calendar as CalendarIcon,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useStore, useTotals, formatMoney, formatUSD } from "@/lib/store";
import { useGlAccounts, type GlAccountCategory } from "@/lib/gl-accounts";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadCSV } from "@/lib/export-csv";

import { useTranslation } from "react-i18next";
const CATEGORY_COLORS: Record<GlAccountCategory | "Uncategorized", string> = {
  ATL: "#60a5fa",
  BTL: "#34d399",
  "Post-Production": "#a78bfa",
  "Admin & Other": "#f59e0b",
  Uncategorized: "#94a3b8",
};

type Preset = "all" | "mtd" | "ytd" | "30d" | "90d" | "custom";

type Txn = {
  kind: "invoice" | "receipt";
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  date?: string;
  category: string;
  month: string;
};

function monthKey(d: string | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

export function ProductionDashboard() {
  const { t } = useTranslation();

  const { totalBudget } = useTotals();
  const { invoices, receipts, purchaseOrders, bootstrap } = useStore();
  const { rows: glRows } = useGlAccounts();
  const [pendingAccess, setPendingAccess] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Date range filter state
  const [preset, setPreset] = useState<Preset>("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  // Drill-down modal state
  const [drill, setDrill] = useState<{ title: string; items: Txn[] } | null>(null);

  // Live refresh on financial-table changes.
  useEffect(() => {
    const queueRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        bootstrap();
      }, 400);
    };
    const channel = supabase
      .channel("hub-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, queueRefresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cash_advance_receipts" },
        queueRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchase_orders" },
        queueRefresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_lines" }, queueRefresh)
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [bootstrap]);

  // Initial bootstrap (drives loading skeletons on first mount).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await bootstrap();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  // Pending access requests counter (super admins can read; others silently fall back to 0).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await (supabase as any)
        .from("access_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      if (!cancelled) setPendingAccess(count ?? 0);
    })().catch(() => {
      /* ignore — non-admins can't read */
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ------- Date window -------
  const window = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    if (preset === "mtd") return { from: new Date(y, m, 1), to: today };
    if (preset === "ytd") return { from: new Date(y, 0, 1), to: today };
    if (preset === "30d") return { from: new Date(y, m, d - 30), to: today };
    if (preset === "90d") return { from: new Date(y, m, d - 90), to: today };
    if (preset === "custom") {
      return {
        from: customFrom ? new Date(customFrom) : null,
        to: customTo ? new Date(customTo) : null,
      };
    }
    return { from: null, to: null };
  }, [preset, customFrom, customTo]);

  const inRange = (dateStr?: string) => {
    if (!window.from && !window.to) return true;
    if (!dateStr) return false;
    const t = new Date(dateStr).getTime();
    if (Number.isNaN(t)) return false;
    if (window.from && t < window.from.getTime()) return false;
    if (window.to && t > window.to.getTime() + 86_399_000) return false;
    return true;
  };

  // ------- GL lookup -------
  const glMap = useMemo(() => new Map(glRows.map((g) => [g.id, g] as const)), [glRows]);

  // ------- Unified transaction list (filtered by window) -------
  const txns: Txn[] = useMemo(() => {
    const list: Txn[] = [];
    invoices.forEach((i) => {
      if (!inRange(i.date)) return;
      list.push({
        kind: "invoice",
        id: i.id,
        title: i.description || i.invoiceNo || "Invoice",
        subtitle: i.vendorName || i.department || "",
        amount: Number(i.price || 0),
        date: i.date,
        category: (i.glAccountId && glMap.get(i.glAccountId)?.category) || "Uncategorized",
        month: monthKey(i.date),
      });
    });
    receipts.forEach((r) => {
      if (!inRange(r.date)) return;
      list.push({
        kind: "receipt",
        id: r.id,
        title: r.recipient || "Petty cash receipt",
        subtitle: r.department || r.method || "",
        amount: Number(r.amount || 0),
        date: r.date,
        category: (r.glAccountId && glMap.get(r.glAccountId)?.category) || "Uncategorized",
        month: monthKey(r.date),
      });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, receipts, glMap, preset, customFrom, customTo]);

  // ------- Derived metrics -------
  const invoiceSpend = useMemo(
    () => txns.filter((t) => t.kind === "invoice").reduce((a, t) => a + t.amount, 0),
    [txns],
  );
  const receiptSpend = useMemo(
    () => txns.filter((t) => t.kind === "receipt").reduce((a, t) => a + t.amount, 0),
    [txns],
  );
  const totalSpent = invoiceSpend + receiptSpend;
  const remaining = Math.max(0, totalBudget - totalSpent);
  const pendingApprovals = useMemo(
    () => purchaseOrders.filter((p) => p.status === "Open").length,
    [purchaseOrders],
  );

  // ------- Donut: spending by GL category -------
  const donutData = useMemo(() => {
    const byCat = new Map<string, number>();
    txns.forEach((t) => byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount));
    return Array.from(byCat.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [txns]);

  const donutTotal = donutData.reduce((a, r) => a + r.value, 0);

  // ------- Burn rate: monthly spending -------
  const burnData = useMemo(() => {
    const buckets = new Map<string, number>();
    txns.forEach((t) => {
      if (!t.month) return;
      buckets.set(t.month, (buckets.get(t.month) ?? 0) + t.amount);
    });
    const rows = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, spend]) => ({ month, spend }));
    let cum = 0;
    return rows.map((r) => {
      cum += r.spend;
      return { ...r, cumulative: cum };
    });
  }, [txns]);

  // ------- Recent activity (top 5 of filtered) -------
  const recent = useMemo(() => {
    return [...txns]
      .filter((x) => x.date)
      .sort((a, b) => (a.date! < b.date! ? 1 : -1))
      .slice(0, 5);
  }, [txns]);

  const exportRecent = () => {
    const rows = recent.map((r) => ({
      Date: r.date ?? "",
      Kind: r.kind,
      Title: r.title,
      Detail: r.subtitle,
      Category: r.category,
      Amount: r.amount,
    }));
    downloadCSV(`recent-activity-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const openDonutSlice = (name: string) => {
    const items = txns
      .filter((t) => t.category === name)
      .sort((a, b) => (a.date! < b.date! ? 1 : -1));
    setDrill({ title: `Transactions · ${name}`, items });
  };
  const openBurnPoint = (month: string) => {
    const items = txns
      .filter((t) => t.month === month)
      .sort((a, b) => (a.date! < b.date! ? 1 : -1));
    setDrill({ title: `Transactions · ${month}`, items });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <section className="w-full space-y-5">
        {/* Date range toolbar */}
        <div className="flex items-center gap-2 flex-wrap rounded-2xl border border-border bg-surface/60 p-3">
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground pl-1 pr-2">
            <CalendarIcon className="size-4" />
            {t("productiondashboard.date_range")}
          </div>
          {(
            [
              ["all", "All time"],
              ["mtd", "MTD"],
              ["ytd", "YTD"],
              ["30d", "Last 30d"],
              ["90d", "Last 90d"],
              ["custom", "Custom"],
            ] as [Preset, string][]
          ).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setPreset(k)}
              className={`px-2.5 py-1 rounded-full text-xs border transition ${
                preset === k
                  ? "bg-brand/20 border-brand/50 text-brand-foreground"
                  : "bg-surface border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {lbl}
            </button>
          ))}
          {preset === "custom" && (
            <div className="inline-flex items-center gap-2 ml-1">
              <DateInput
                value={customFrom}
                onChange={(v) => setCustomFrom(v)}
                className="px-2 py-1 rounded-md text-xs bg-surface border border-border text-foreground"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <DateInput
                value={customTo}
                onChange={(v) => setCustomTo(v)}
                className="px-2 py-1 rounded-md text-xs bg-surface border border-border text-foreground"
              />
            </div>
          )}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi
            label="Total Budgeted"
            value={isLoading ? null : formatMoney(totalBudget)}
            hint="Project scope"
            icon={<Wallet className="size-4 text-info" />}
            tone="text-info"
            details={
              <>
                <Row k="Locked budget" v={formatUSD(totalBudget)} />
                <Row k="Scope" v="Project-to-date" />
              </>
            }
          />
          <Kpi
            label="Actual Spent"
            value={isLoading ? null : formatMoney(totalSpent)}
            hint="Invoices + petty cash"
            icon={<TrendingDown className="size-4 text-success" />}
            tone="text-success"
            details={
              <>
                <Row k="Invoices" v={formatUSD(invoiceSpend)} />
                <Row k="Petty cash" v={formatUSD(receiptSpend)} />
                <Row k="Transactions" v={String(txns.length)} />
              </>
            }
          />
          <Kpi
            label="Remaining Budget"
            value={isLoading ? null : formatMoney(remaining)}
            hint={totalBudget > 0 ? `${Math.round((remaining / totalBudget) * 100)}% left` : "—"}
            icon={<PiggyBank className="size-4 text-warning" />}
            tone={remaining <= 0 ? "text-destructive" : "text-warning"}
            details={
              <>
                <Row k="Budget" v={formatUSD(totalBudget)} />
                <Row k="Spent" v={formatUSD(totalSpent)} />
                <Row k="Remaining" v={formatUSD(remaining)} />
              </>
            }
          />
          <Kpi
            label="Pending Approvals"
            value={isLoading ? null : String(pendingApprovals)}
            hint={pendingApprovals === 1 ? "Open PO awaiting review" : "Open POs awaiting review"}
            icon={<ClipboardCheck className="size-4 text-highlight" />}
            tone="text-highlight"
            details={
              <>
                <Row k="Open POs" v={String(pendingApprovals)} />
                <Row k="Total POs" v={String(purchaseOrders.length)} />
              </>
            }
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Donut */}
          <div className="lg:col-span-1 rounded-2xl border border-border bg-surface/60 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider">
                {t("productiondashboard.spending_by_category")}
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {t("productiondashboard.click_a_slice")}
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-[240px] w-full rounded-xl" />
            ) : donutData.length === 0 ? (
              <div className="h-[240px] grid place-items-center text-sm text-muted-foreground">
                {t("productiondashboard.no_spend_recorded_in_this_range")}
              </div>
            ) : (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                      stroke="none"
                      onClick={(d: any) => d?.name && openDonutSlice(d.name)}
                      cursor="pointer"
                    >
                      {donutData.map((d) => (
                        <Cell
                          key={d.name}
                          fill={
                            CATEGORY_COLORS[d.name as keyof typeof CATEGORY_COLORS] ?? "#64748b"
                          }
                        />
                      ))}
                    </Pie>
                    <RTooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                      formatter={(v: any, n: any) => [formatUSD(Number(v)), n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <ul className="mt-3 space-y-1.5">
              {donutData.map((d) => (
                <li key={d.name}>
                  <button
                    onClick={() => openDonutSlice(d.name)}
                    className="w-full flex items-center justify-between text-xs px-1 py-1 rounded hover:bg-muted transition"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block size-2.5 rounded-full"
                        style={{
                          background:
                            CATEGORY_COLORS[d.name as keyof typeof CATEGORY_COLORS] ?? "#64748b",
                        }}
                      />
                      {d.name}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {donutTotal > 0 ? `${Math.round((d.value / donutTotal) * 100)}%` : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Line: burn rate */}
          <div className="lg:col-span-2 rounded-2xl border border-border bg-surface/60 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider">
                {t("productiondashboard.burn_rate")}
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {t("productiondashboard.click_a_point")}
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-[240px] w-full rounded-xl" />
            ) : burnData.length === 0 ? (
              <div className="h-[240px] grid place-items-center text-sm text-muted-foreground">
                {t("productiondashboard.no_dated_transactions_in_this_range")}
              </div>
            ) : (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={burnData}
                    margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                    onClick={(state: any) => {
                      const p = state?.activePayload?.[0]?.payload;
                      if (p?.month) openBurnPoint(p.month);
                    }}
                  >
                    <CartesianGrid
                      stroke="rgba(255,255,255,0.08)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="month"
                      stroke="rgba(255,255,255,0.7)"
                      fontSize={11}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="rgba(255,255,255,0.7)"
                      fontSize={11}
                      width={70}
                      tickFormatter={(v) => formatMoney(v as number)}
                    />
                    <RTooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                      formatter={(v: any, n: any) => [
                        formatUSD(Number(v)),
                        n === "spend" ? "Monthly spend" : "Cumulative",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="spend"
                      stroke="#34d399"
                      strokeWidth={2}
                      dot={{ r: 3, cursor: "pointer" }}
                      activeDot={{
                        r: 6,
                        cursor: "pointer",
                        onClick: (_: any, p: any) =>
                          p?.payload?.month && openBurnPoint(p.payload.month),
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumulative"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Recent activity + admin quick view */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 rounded-2xl border border-border bg-surface/60 p-5">
            <div className="flex items-center justify-between mb-3 gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider inline-flex items-center gap-2">
                <Activity className="size-4 text-brand" />
                {t("productiondashboard.recent_activity")}
              </h3>
              <div className="inline-flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {t("productiondashboard.last_5_in_range")}
                </span>
                <button
                  onClick={exportRecent}
                  disabled={recent.length === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-border bg-surface hover:bg-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="size-3.5" /> Export
                </button>
              </div>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-lg" />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("productiondashboard.no_recent_transactions_in_this_range")}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((r) => (
                  <li key={`${r.kind}:${r.id}`} className="flex items-center gap-3 py-2.5">
                    <span
                      className={`size-8 rounded-lg grid place-items-center shrink-0 ${
                        r.kind === "invoice" ? "bg-info/15 text-info" : "bg-success/15 text-success"
                      }`}
                    >
                      {r.kind === "invoice" ? (
                        <FileText className="size-4" />
                      ) : (
                        <Receipt className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.subtitle || (r.kind === "invoice" ? "Invoice" : "Petty cash")}
                        {r.date ? ` · ${formatDate(r.date)}` : ""}
                      </div>
                    </div>
                    <div className="tabular-nums text-sm font-semibold whitespace-nowrap">
                      {formatUSD(r.amount)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface/60 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">
              {t("productiondashboard.admin_quick_view")}
            </h3>
            <a
              href="/admin"
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 hover:bg-muted transition"
            >
              <span className="size-10 rounded-xl bg-highlight/15 text-highlight grid place-items-center">
                <UserPlus className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {t("productiondashboard.pending_access_requests")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("productiondashboard.awaiting_onboarding")}
                </div>
              </div>
              <span
                className={`inline-flex items-center justify-center min-w-8 h-7 px-2 rounded-full text-xs font-bold ${
                  pendingAccess > 0
                    ? "bg-highlight/20 text-highlight border border-highlight/40"
                    : "bg-surface text-muted-foreground border border-border"
                }`}
              >
                {pendingAccess}
              </span>
            </a>
          </div>
        </div>

        {/* Drill-down modal */}
        {drill && (
          <DrillModal title={drill.title} items={drill.items} onClose={() => setDrill(null)} />
        )}
      </section>
    </TooltipProvider>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon,
  tone,
  details,
}: {
  label: string;
  value: string | null;
  hint?: string;
  icon?: React.ReactNode;
  tone?: string;
  details?: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="rounded-2xl border border-border bg-surface/60 p-4 cursor-default hover:border-border transition">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {label}
            </div>
            {icon}
          </div>
          {value === null ? (
            <Skeleton className="h-8 w-24 mt-2" />
          ) : (
            <div className={`text-2xl lg:text-3xl font-bold mt-2 tabular-nums ${tone ?? ""}`}>
              {value}
            </div>
          )}
          {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
        </div>
      </TooltipTrigger>
      {details && (
        <TooltipContent side="bottom" className="min-w-[200px] p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
          {details}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-xs gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular-nums font-medium">{v}</span>
    </div>
  );
}

function DrillModal({
  title,
  items,
  onClose,
}: {
  title: string;
  items: Txn[];
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const total = items.reduce((a, t) => a + t.amount, 0);
  const exportCsv = () => {
    downloadCSV(
      `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
      items.map((t) => ({
        Date: t.date ?? "",
        Kind: t.kind,
        Title: t.title,
        Detail: t.subtitle,
        Category: t.category,
        Amount: t.amount,
      })),
    );
  };
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">
              {items.length} transaction{items.length === 1 ? "" : "s"} · {formatUSD(total)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={items.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-border bg-surface hover:bg-muted transition disabled:opacity-40"
            >
              <Download className="size-3.5" /> Export
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("productiondashboard.no_transactions")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((t) => (
                <li key={`${t.kind}:${t.id}`} className="flex items-center gap-3 py-2.5 px-2">
                  <span
                    className={`size-8 rounded-lg grid place-items-center shrink-0 ${
                      t.kind === "invoice" ? "bg-info/15 text-info" : "bg-success/15 text-success"
                    }`}
                  >
                    {t.kind === "invoice" ? (
                      <FileText className="size-4" />
                    ) : (
                      <Receipt className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{t.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {t.subtitle || (t.kind === "invoice" ? "Invoice" : "Petty cash")}
                      {t.date ? ` · ${formatDate(t.date)}` : ""}
                      {` · ${t.category}`}
                    </div>
                  </div>
                  <div className="tabular-nums text-sm font-semibold whitespace-nowrap">
                    {formatUSD(t.amount)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
