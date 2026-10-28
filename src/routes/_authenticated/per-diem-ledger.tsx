import type React from "react";
import { formatDate } from "@/lib/date-format";
import { perDiemRowTotal, perDiemTotals } from "@/lib/per-diem-calc";
import { assertUploadAllowed, safeStorageName } from "@/lib/upload-policy";
import { DateInput } from "@/components/ui/date-input";
import { createFileRoute } from "@tanstack/react-router";
import { storageAudited } from "@/lib/storage-audit";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseOpenParam } from "@/lib/document-refs";
import { useOpenRowFocus } from "@/lib/use-open-focus";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useStore, formatUSD, formatSAR, useActiveFxRate } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { BudgetCodeSelector } from "@/components/BudgetCodeSelector";
import {
  Coins,
  Loader2,
  Save,
  Trash2,
  Upload,
  FileDown,
  Eye,
  CalendarDays,
  CheckCircle2,
  RotateCcw,
  Wallet,
  Plus,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { exportPdfReport } from "@/lib/export-pdf";
import { useTranslation } from "react-i18next";
import RiyalIcon from "@/components/ui/RiyalIcon";
import {
  fetchProjectBudgetLines,
  projectBudgetLineTotal,
  type ProjectBudgetLine,
} from "@/lib/project-budget-lines";

export const Route = createFileRoute("/_authenticated/per-diem-ledger")({
  validateSearch: (s: Record<string, unknown>): { open?: string } => {
    const open = parseOpenParam(s.open);
    return open ? { open } : {};
  },
  component: () => (
    <AppShell>
      <PerDiemLedgerPage />
    </AppShell>
  ),
});

type Currency = "SAR" | "USD";

type Row = {
  /** Local ID for drafts, DB uuid once saved. */
  key: string;
  id?: string;
  person_id: string;
  period_start: string;
  period_end: string;
  on_set_rate: number;
  off_set_rate: number;
  shoot_days: number;
  off_days: number;
  total_amount: number;
  status: "pending" | "paid";
  budget_code: string | null;
  linked_budget_line_id: string | null;
  currency: Currency;
  cash_advance_id: string | null;
  receipt_path: string | null;
  notes: string | null;
  dirty?: boolean;
};

type CashFloat = {
  id: string;
  holder: string;
  total_advance: number;
  expenses: number;
  status: string;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(iso: string, delta: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}
function daysInclusive(a: string, b: string) {
  if (!a || !b) return 0;
  const s = new Date(a).getTime();
  const e = new Date(b).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.floor((e - s) / 86_400_000) + 1;
}
function overlapDays(rs: string, re: string, ps?: string, pe?: string) {
  const s = ps && ps > rs ? ps : rs;
  const e = pe && pe < re ? pe : re;
  return daysInclusive(s, e);
}
function periodsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}

function fmtMoney(n: number, ccy: Currency) {
  if (ccy === "SAR") return `SAR ${formatSAR(n)}`;
  return formatUSD(n);
}

/** Convert a rate between currencies using project USD→SAR rate. */
function convertRate(amount: number, from: Currency, to: Currency, sarPerUsd: number): number {
  if (!amount || from === to) return +amount.toFixed(2);
  if (from === "USD" && to === "SAR") return +(amount * sarPerUsd).toFixed(2);
  if (from === "SAR" && to === "USD") return +(amount / sarPerUsd).toFixed(2);
  return amount;
}

let draftSeq = 0;
const newKey = () => `draft-${++draftSeq}-${Math.random().toString(36).slice(2, 7)}`;

function PerDiemLedgerPage() {
  const { t } = useTranslation();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const people = useStore((s) => s.people);
  const sarPerUsd = useActiveFxRate();

  const [defaultStart, setDefaultStart] = useState(() => addDaysISO(todayISO(), -6));
  const [defaultEnd, setDefaultEnd] = useState(() => todayISO());
  const [rowsByPerson, setRowsByPerson] = useState<Record<string, Row[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // row keys
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [cashFloats, setCashFloats] = useState<CashFloat[]>([]);
  const [projectDefaultCcy, setProjectDefaultCcy] = useState<Currency>("SAR");
  // Project budget-line map plus per-person inherited code from contract.
  const [projectCodes, setProjectCodes] = useState<string[]>([]);
  const [codeByPerson, setCodeByPerson] = useState<Record<string, string>>({});
  const [lineIdByPerson, setLineIdByPerson] = useState<Record<string, string>>({});
  const [projectBudgetLines, setProjectBudgetLines] = useState<ProjectBudgetLine[]>([]);
  // G11: ?open=<id> scrolls to that per-diem row and highlights it.
  const { open: openId } = Route.useSearch();
  useOpenRowFocus(openId, "perdiem-row-", !loading);

  const eligible = useMemo(
    () =>
      people.filter(
        (p) => p.contractStatus === "Active" && Number(p.onSetPerDiem ?? p.perDiem ?? 0) > 0,
      ),
    [people],
  );

  // Load open petty-cash floats.
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("cash_advances")
        .select("id, holder, total_advance, expenses, status")
        .eq("project_id", activeProjectId)
        .in("status", ["open", "issued", "active"]);
      if (!cancelled) setCashFloats((data ?? []) as CashFloat[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  // Load project budget lines + inherit each active person's exact contract budget line.
  useEffect(() => {
    if (!activeProjectId) {
      setProjectCodes([]);
      setCodeByPerson({});
      setLineIdByPerson({});
      setProjectBudgetLines([]);
      return;
    }
    let cancelled = false;
    (async () => {
      let lines: ProjectBudgetLine[] = [];
      try {
        lines = await fetchProjectBudgetLines(activeProjectId);
      } catch {
        if (!cancelled) {
          setProjectBudgetLines([]);
          setProjectCodes([]);
          setCodeByPerson({});
          setLineIdByPerson({});
        }
        return;
      }
      if (cancelled) return;
      const idToCode = new Map<string, string>();
      const codes = new Set<string>();
      for (const l of lines) {
        const code = String(l.mainCode ?? "").trim();
        if (!code) continue;
        idToCode.set(l.id, code);
        codes.add(code);
      }
      setProjectBudgetLines(lines);
      setProjectCodes(Array.from(codes));

      const ids = eligible.map((p) => p.id);
      const map: Record<string, string> = {};
      const idMap: Record<string, string> = {};
      if (ids.length > 0) {
        const [crewRes, castRes] = await Promise.all([
          supabase.from("crew_members").select("id, linked_budget_line_id").in("id", ids),
          supabase.from("people").select("id, linked_budget_line_id").in("id", ids),
        ]);
        for (const r of [...(crewRes.data ?? []), ...(castRes.data ?? [])] as any[]) {
          const code = r.linked_budget_line_id ? idToCode.get(r.linked_budget_line_id) : null;
          if (code) map[r.id] = code;
          if (code && r.linked_budget_line_id) idMap[r.id] = r.linked_budget_line_id;
        }
      }
      if (!cancelled) {
        setCodeByPerson(map);
        setLineIdByPerson(idMap);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, eligible]);

  // Load ALL rows for the project so multi-batch history is visible.
  useEffect(() => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("per_diem_ledger")
        .select("*")
        .eq("project_id", activeProjectId)
        .order("period_start", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error(t("per_diem_ledger.failed_to_load_perdiem_ledger"));
        setLoading(false);
        return;
      }
      const map: Record<string, Row[]> = {};
      (data ?? []).forEach((r: any) => {
        const row: Row = {
          key: r.id,
          id: r.id,
          person_id: r.person_id,
          period_start: r.period_start,
          period_end: r.period_end,
          on_set_rate: Number(r.on_set_rate ?? 0),
          off_set_rate: Number(r.off_set_rate ?? 0),
          shoot_days: Number(r.shoot_days ?? 0),
          off_days: Number(r.off_days ?? 0),
          total_amount: Number(r.total_amount ?? 0),
          status: (r.status ?? "pending") as Row["status"],
          budget_code: r.budget_code ?? null,
          linked_budget_line_id: r.linked_budget_line_id ?? null,
          currency: (r.currency ?? "SAR") === "USD" ? "USD" : "SAR",
          cash_advance_id: r.cash_advance_id ?? null,
          receipt_path: r.receipt_path ?? null,
          notes: r.notes ?? null,
        };
        (map[r.person_id] ||= []).push(row);
      });
      setRowsByPerson(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  // Backfill inherited budget line onto loaded rows that were saved without one.
  useEffect(() => {
    if (Object.keys(codeByPerson).length === 0 && Object.keys(lineIdByPerson).length === 0) return;
    setRowsByPerson((prev) => {
      let changed = false;
      const next: Record<string, Row[]> = {};
      for (const [pid, list] of Object.entries(prev)) {
        const inherit = codeByPerson[pid];
        const inheritId = lineIdByPerson[pid] ?? null;
        if (!inherit && !inheritId) {
          next[pid] = list;
          continue;
        }
        const patched = list.map((r) => {
          if ((r.budget_code && r.linked_budget_line_id) || r.status === "paid") return r;
          changed = true;
          return {
            ...r,
            budget_code: r.budget_code ?? inherit ?? null,
            linked_budget_line_id: r.linked_budget_line_id ?? inheritId,
            dirty: true,
          };
        });
        next[pid] = patched;
      }
      return changed ? next : prev;
    });
  }, [codeByPerson, lineIdByPerson]);

  /** Build a new draft batch for a person, honoring currency lock from contract. */
  const buildDraft = (personId: string, start?: string, end?: string): Row => {
    const p = eligible.find((x) => x.id === personId);
    const contractCcy: Currency = (p as any)?.ccy === "USD" ? "USD" : "SAR";
    const rowCcy: Currency = projectDefaultCcy;
    const rawOn = Number(p?.onSetPerDiem ?? p?.perDiem ?? 0);
    const rawOff = Number(p?.offSetPerDiem ?? rawOn * 2);
    const on = convertRate(rawOn, contractCcy, rowCcy, sarPerUsd);
    const off = convertRate(rawOff, contractCcy, rowCcy, sarPerUsd);

    // Suggest the next un-used range: day after latest existing period, span same length.
    let s = start ?? defaultStart;
    let e = end ?? defaultEnd;
    if (!start && !end) {
      const existing = rowsByPerson[personId] ?? [];
      const latestEnd = existing.reduce((max, r) => (r.period_end > max ? r.period_end : max), "");
      if (latestEnd) {
        const span = Math.max(1, daysInclusive(defaultStart, defaultEnd));
        s = addDaysISO(latestEnd, 1);
        e = addDaysISO(s, span - 1);
      }
    }

    const shoot = overlapDays(s, e, p?.startDate, p?.endDate);
    // Inherit budget code from most recent existing batch first, then fall back
    // to the contract-linked code. This keeps weekly "+ Add Batch" spawns
    // pre-filled with the same line the accountant already picked.
    const existingRows = rowsByPerson[personId] ?? [];
    const inheritedLineId =
      existingRows.find((r) => r.linked_budget_line_id)?.linked_budget_line_id ??
      lineIdByPerson[personId] ??
      null;
    const inheritedCode =
      existingRows.find((r) => r.budget_code)?.budget_code ??
      (inheritedLineId
        ? projectBudgetLines.find((line) => line.id === inheritedLineId)?.mainCode
        : null) ??
      codeByPerson[personId] ??
      null;
    return {
      key: newKey(),
      person_id: personId,
      period_start: s,
      period_end: e,
      on_set_rate: on,
      off_set_rate: off,
      shoot_days: shoot,
      off_days: 0,
      total_amount: +(shoot * on).toFixed(2),
      status: "pending",
      budget_code: inheritedCode,
      linked_budget_line_id: inheritedLineId,
      currency: rowCcy,
      cash_advance_id: null,
      receipt_path: null,
      notes: null,
      dirty: true,
    };
  };

  const addBatchFor = (personId: string) => {
    setRowsByPerson((prev) => {
      const list = prev[personId] ? [...prev[personId]] : [];
      list.unshift(buildDraft(personId));
      return { ...prev, [personId]: list };
    });
  };

  /** Any person without existing rows gets one draft on first render. */
  const displayRows = useMemo(() => {
    const out: { person: (typeof eligible)[number]; rows: Row[] }[] = [];
    for (const p of eligible) {
      const rs = rowsByPerson[p.id] ?? [];
      out.push({ person: p, rows: rs.length ? rs : [buildDraft(p.id)] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    eligible,
    rowsByPerson,
    defaultStart,
    defaultEnd,
    projectDefaultCcy,
    sarPerUsd,
    codeByPerson,
    lineIdByPerson,
    projectBudgetLines,
  ]);

  const updateRow = (personId: string, rowKey: string, patch: Partial<Row>) => {
    setRowsByPerson((prev) => {
      const list = (
        prev[personId] ??
        displayRows.find((d) => d.person.id === personId)?.rows ??
        []
      ).slice();
      const idx = list.findIndex((r) => r.key === rowKey);
      const base = idx >= 0 ? list[idx] : buildDraft(personId);
      // Currency change → auto-relock rates from contract
      const next: Row = { ...base, ...patch };
      const p = eligible.find((x) => x.id === personId);
      const contractCcy: Currency = (p as any)?.ccy === "USD" ? "USD" : "SAR";
      if (patch.currency && patch.currency !== base.currency) {
        const rawOn = Number(p?.onSetPerDiem ?? p?.perDiem ?? 0);
        const rawOff = Number(p?.offSetPerDiem ?? rawOn * 2);
        next.on_set_rate = convertRate(rawOn, contractCcy, patch.currency, sarPerUsd);
        next.off_set_rate = convertRate(rawOff, contractCcy, patch.currency, sarPerUsd);
      }
      // Date change → re-suggest shoot_days (respect person's contract window)
      if (
        (patch.period_start && patch.period_start !== base.period_start) ||
        (patch.period_end && patch.period_end !== base.period_end)
      ) {
        next.shoot_days = overlapDays(next.period_start, next.period_end, p?.startDate, p?.endDate);
      }
      next.total_amount = +(
        next.shoot_days * next.on_set_rate +
        next.off_days * next.off_set_rate
      ).toFixed(2);
      next.dirty = true;
      if (idx >= 0) list[idx] = next;
      else list.unshift(next);
      return { ...prev, [personId]: list };
    });
  };

  const reconcileTransaction = async (
    rowId: string,
    row: Row,
    person: (typeof eligible)[number],
    wasPaid: boolean,
    isPaid: boolean,
  ) => {
    if (wasPaid === isPaid) return;
    const refNo = `perdiem:${rowId}`;
    try {
      if (isPaid) {
        if (!row.budget_code) {
          toast.warning(
            `${person.fullName}: no per-diem budget code — paid but not reconciled to expenses`,
          );
          return;
        }
        await supabase.from("transactions" as any).insert({
          transaction_type: "per_diem",
          budget_code: row.budget_code,
          description: `Per Diem — ${person.fullName} (${row.period_start} → ${row.period_end})`,
          amount: row.total_amount,
          vat_amount: 0,
          currency: row.currency,
          payment_status: "Paid",
          reference_no: refNo,
          transaction_date: row.period_end,
          project_id: activeProjectId,
          organization_id: (person as any).organizationId ?? null,
          department: person.kind === "cast" ? "Cast" : "Crew",
          metadata: {
            per_diem_row_id: rowId,
            person_id: person.id,
            shoot_days: row.shoot_days,
            off_days: row.off_days,
            cash_advance_id: row.cash_advance_id ?? null,
            currency: row.currency,
          },
        });
        if (row.cash_advance_id) {
          const float = cashFloats.find((f) => f.id === row.cash_advance_id);
          if (float) {
            await supabase
              .from("cash_advances")
              .update({ expenses: Number(float.expenses ?? 0) + row.total_amount })
              .eq("id", row.cash_advance_id);
          }
        }
      } else {
        await supabase
          .from("transactions" as any)
          .delete()
          .eq("reference_no", refNo);
      }
    } catch (e: any) {
      console.error("Per-diem reconcile failed", e);
      toast.error(`Reconcile failed for ${person.fullName}: ${e?.message ?? e}`);
    }
  };

  const findRow = (personId: string, rowKey: string): Row | undefined => {
    const list =
      rowsByPerson[personId] ?? displayRows.find((d) => d.person.id === personId)?.rows ?? [];
    return list.find((r) => r.key === rowKey);
  };

  const validateNoOverlap = (personId: string, current: Row): string | null => {
    const list = rowsByPerson[personId] ?? [];
    for (const other of list) {
      if (other.key === current.key) continue;
      if (
        periodsOverlap(
          current.period_start,
          current.period_end,
          other.period_start,
          other.period_end,
        )
      ) {
        return `Overlaps existing batch ${other.period_start} → ${other.period_end}`;
      }
    }
    return null;
  };

  const save = async (
    personId: string,
    rowKey: string,
    overrides?: Partial<Row>,
  ): Promise<string | null> => {
    if (!activeProjectId) return null;
    const base = findRow(personId, rowKey);
    if (!base) return null;
    const row: Row = { ...base, ...(overrides ?? {}) };
    if (overrides) {
      row.total_amount = +(
        row.shoot_days * row.on_set_rate +
        row.off_days * row.off_set_rate
      ).toFixed(2);
    }
    if (row.period_end < row.period_start) {
      toast.error(t("per_diem_ledger.period_end_must_be_on_or_after_period"));
      return null;
    }
    // Budget line is only mandatory when marking Paid (so GL posts). Pending can save without it.
    if (row.status === "paid" && !row.budget_code) {
      toast.error(t("per_diem_ledger.budget_line_is_required_before_marking_as_paid"));
      return null;
    }
    // Cash float is only required when Paid (petty cash may not be configured on Pending).
    if (row.status === "paid" && !row.cash_advance_id) {
      toast.error(t("per_diem_ledger.select_a_cash_float_before_marking_as_paid"));
      return null;
    }
    const overlapErr = validateNoOverlap(personId, row);
    if (overlapErr) {
      toast.error(overlapErr);
      return null;
    }
    const person = eligible.find((p) => p.id === personId);
    if (!person) return null;
    const prevPaid = (base.status ?? "pending") === "paid" && !!base.id;
    setSavingKey(rowKey);
    const payload: any = {
      organization_id: (person as any).organizationId ?? null,
      project_id: activeProjectId,
      person_id: personId,
      period_start: row.period_start,
      period_end: row.period_end,
      on_set_rate: row.on_set_rate,
      off_set_rate: row.off_set_rate,
      shoot_days: row.shoot_days,
      off_days: row.off_days,
      total_amount: row.total_amount,
      status: row.status,
      budget_code: row.budget_code,
      linked_budget_line_id: row.linked_budget_line_id,
      currency: row.currency,
      cash_advance_id: row.cash_advance_id,
      receipt_path: row.receipt_path,
      notes: row.notes,
    };
    let error;
    let rowId = row.id ?? null;
    if (row.id) {
      ({ error } = await supabase.from("per_diem_ledger").update(payload).eq("id", row.id));
    } else {
      const res = await supabase.from("per_diem_ledger").insert(payload).select("id").single();
      error = res.error;
      if (!error && res.data) rowId = res.data.id;
    }
    setSavingKey(null);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return null;
    }
    setRowsByPerson((prev) => {
      const list = (prev[personId] ?? []).slice();
      const savedRow: Row = { ...row, id: rowId ?? row.id, key: rowId ?? row.key, dirty: false };
      const idx = list.findIndex((r) => r.key === rowKey);
      if (idx >= 0) list[idx] = savedRow;
      else list.unshift(savedRow);
      return { ...prev, [personId]: list };
    });
    if (rowId) {
      await reconcileTransaction(rowId, row, person, prevPaid, row.status === "paid");
    }
    return rowId;
  };

  const bulkMarkPaid = async () => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    let ok = 0;
    for (const key of selected) {
      const entry = Object.entries(rowsByPerson).find(([, list]) =>
        list.some((r) => r.key === key),
      );
      if (!entry) continue;
      const [pid] = entry;
      const id = await save(pid, key, { status: "paid" });
      if (id) ok++;
    }
    setBulkBusy(false);
    setSelected(new Set());
    toast.success(`Marked ${ok} of ${selected.size} as Paid & reconciled`);
  };

  const bulkMarkPending = async () => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    let ok = 0;
    for (const key of selected) {
      const entry = Object.entries(rowsByPerson).find(([, list]) =>
        list.some((r) => r.key === key),
      );
      if (!entry) continue;
      const [pid, list] = entry;
      const row = list.find((r) => r.key === key);
      if (!row?.id) continue;
      const id = await save(pid, key, { status: "pending" });
      if (id) ok++;
    }
    setBulkBusy(false);
    setSelected(new Set());
    toast.success(`Reverted ${ok} of ${selected.size} to Pending — linked transactions removed`);
  };

  const toggleSelect = (rowKey: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });

  const remove = async (personId: string, rowKey: string) => {
    const row = findRow(personId, rowKey);
    if (!row) return;
    if (!row.id) {
      setRowsByPerson((prev) => {
        const list = (prev[personId] ?? []).filter((r) => r.key !== rowKey);
        return { ...prev, [personId]: list };
      });
      return;
    }
    if (row.status === "paid") {
      toast.error(t("per_diem_ledger.revert_to_pending_before_deleting_a_paid_batch"));
      return;
    }
    const { error } = await supabase.from("per_diem_ledger").delete().eq("id", row.id);
    if (error) return toast.error(`Delete failed: ${error.message}`);
    setRowsByPerson((prev) => {
      const list = (prev[personId] ?? []).filter((r) => r.key !== rowKey);
      return { ...prev, [personId]: list };
    });
    toast.success(t("per_diem_ledger.entry_removed"));
  };

  const uploadReceipt = async (personId: string, rowKey: string, file: File) => {
    if (!activeProjectId) return;
    let row = findRow(personId, rowKey);
    if (!row) return;
    let rowId = row.id;
    if (!rowId) {
      rowId = (await save(personId, rowKey)) ?? undefined;
      if (!rowId) return;
      row = findRow(personId, rowId) ?? row;
    }
    assertUploadAllowed(file);
    // X06: under the project folder so project-scoped storage policies apply.
    const path = `${activeProjectId ? `${activeProjectId}/` : ""}per-diem/${rowId}/${Date.now()}-${safeStorageName(file.name)}`;
    const { error: upErr } = await storageAudited
      .from("contracts")
      .upload(path, file, { upsert: false });
    if (upErr) return toast.error(`Upload failed: ${upErr.message}`);
    const { error: dbErr } = await supabase
      .from("per_diem_ledger")
      .update({ receipt_path: path })
      .eq("id", rowId);
    if (dbErr) return toast.error(`Update failed: ${dbErr.message}`);
    setRowsByPerson((prev) => {
      const list = (prev[personId] ?? []).map((r) =>
        r.id === rowId ? { ...r, receipt_path: path, dirty: false } : r,
      );
      return { ...prev, [personId]: list };
    });
    toast.success(t("per_diem_ledger.receipt_uploaded"));
  };

  const viewReceipt = async (path: string) => {
    const { data, error } = await storageAudited.from("contracts").createSignedUrl(path, 60);
    if (error || !data) return toast.error(t("per_diem_ledger.could_not_open_receipt"));
    window.open(data.signedUrl, "_blank");
  };

  // X13: saved rows only (the suggested draft per person is not money yet),
  // each row = days × rates exactly as the database computes it.
  const totals = useMemo(() => {
    const t = perDiemTotals(displayRows.flatMap(({ rows }) => rows));
    return {
      paid: { SAR: t.paid.SAR ?? 0, USD: t.paid.USD ?? 0 } as Record<Currency, number>,
      pending: { SAR: t.pending.SAR ?? 0, USD: t.pending.USD ?? 0 } as Record<Currency, number>,
    };
  }, [displayRows]);

  /** Aggregate per diem budget health across every budget line touched by
   *  personnel currently in this ledger. All amounts normalised to SAR. */
  const budgetHealth = useMemo(() => {
    const lineIds = new Set<string>();
    const codes = new Set<string>();
    for (const { rows } of displayRows) {
      for (const r of rows) {
        if (r.linked_budget_line_id) lineIds.add(r.linked_budget_line_id);
        else if (r.budget_code) codes.add(r.budget_code);
      }
    }
    let totalBudget = 0;
    for (const l of projectBudgetLines) {
      if (!lineIds.has(l.id) && !codes.has(l.mainCode)) continue;
      const line = projectBudgetLineTotal(l);
      const inSar = l.currency === "USD" ? line * sarPerUsd : line;
      if (!l.excluded) totalBudget += inSar;
    }
    const totalPaidSar = totals.paid.SAR + totals.paid.USD * sarPerUsd;
    const remaining = totalBudget - totalPaidSar;
    const pct = totalBudget > 0 ? (totalPaidSar / totalBudget) * 100 : 0;
    const over = totalBudget > 0 && totalPaidSar > totalBudget;
    return { codes: lineIds.size + codes.size, totalBudget, totalPaidSar, remaining, pct, over };
  }, [displayRows, projectBudgetLines, sarPerUsd, totals]);

  const applyPreset = (kind: "7d" | "14d" | "30d" | "week" | "month" | "next7") => {
    const today = todayISO();
    if (kind === "7d") {
      setDefaultStart(addDaysISO(today, -6));
      setDefaultEnd(today);
      return;
    }
    if (kind === "14d") {
      setDefaultStart(addDaysISO(today, -13));
      setDefaultEnd(today);
      return;
    }
    if (kind === "30d") {
      setDefaultStart(addDaysISO(today, -29));
      setDefaultEnd(today);
      return;
    }
    if (kind === "next7") {
      setDefaultStart(today);
      setDefaultEnd(addDaysISO(today, 6));
      return;
    }
    const d = new Date(today);
    if (kind === "week") {
      const dow = d.getDay();
      const start = new Date(d);
      start.setDate(d.getDate() - dow);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      setDefaultStart(start.toISOString().slice(0, 10));
      setDefaultEnd(end.toISOString().slice(0, 10));
      return;
    }
    if (kind === "month") {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      setDefaultStart(start.toISOString().slice(0, 10));
      setDefaultEnd(end.toISOString().slice(0, 10));
    }
  };

  const exportSignoff = () => {
    const rows: string[][] = [];
    for (const { person, rows: personRows } of displayRows) {
      for (const r of personRows) {
        if (!r.id) continue; // X13: unsaved suggestions are not on the sheet
        rows.push([
          person.fullName,
          person.kind === "cast" ? person.character || "Cast" : person.position || "Crew",
          `${formatDate(r.period_start)} → ${formatDate(r.period_end)}`,
          fmtMoney(r.on_set_rate, r.currency),
          fmtMoney(r.off_set_rate, r.currency),
          String(r.shoot_days),
          String(r.off_days),
          fmtMoney(perDiemRowTotal(r), r.currency),
          r.status === "paid" ? "PAID" : "Pending",
          "",
        ]);
      }
    }
    exportPdfReport(
      `per-diem-signoff-${defaultStart}_to_${defaultEnd}.pdf`,
      [
        {
          title: "Per-Diem Sign-Off Sheet",
          subtitle: `SAR ${formatSAR(totals.paid.SAR + totals.pending.SAR)}   |   USD ${formatUSD(totals.paid.USD + totals.pending.USD)}`,
          headers: [
            "Name",
            "Position",
            "Period",
            "On-Set Rate",
            "Off-Set Rate",
            "Shoot D",
            "Off D",
            "Total",
            "Status",
            "Signature",
          ],
          rows,
          numericColumns: [3, 4, 5, 6, 7],
        },
      ],
      { documentTitle: "Per-Diem Sign-Off Sheet" },
    );
  };

  if (!activeProjectId) {
    return (
      <div className="p-6">
        <PageTitle title={t("per_diem_ledger.per_diem_ledger")} />
        <div className="text-sm text-muted-foreground">
          {t("per_diem_ledger.select_an_active_project_to_view_its_perdiem")}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageTitle title={t("per_diem_ledger.per_diem_ledger")} />
      <BudgetHealthWidget health={budgetHealth} />
      <Panel>
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Coins className="size-5 text-brand" />
            <div className="text-sm text-muted-foreground">
              {eligible.length} eligible personnel · rates locked from contract at{" "}
              {sarPerUsd.toFixed(2)} SAR/USD
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2 ms-auto">
            <div className="flex items-center gap-1">
              {(
                [
                  ["7d", "Last 7d"],
                  ["14d", "Last 14d"],
                  ["30d", "Last 30d"],
                  ["week", "This Week"],
                  ["month", "This Month"],
                  ["next7", "Next 7d"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] hover:bg-muted"
                >
                  {label}
                </button>
              ))}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {t("per_diem_ledger.new_batch_start")}
              </div>
              <DateInput
                value={defaultStart}
                onChange={(v) => setDefaultStart(v)}
                className="bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {t("per_diem_ledger.new_batch_end")}
              </div>
              <DateInput
                value={defaultEnd}
                onChange={(v) => setDefaultEnd(v)}
                className="bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {t("per_diem_ledger.default_ccy")}
              </div>
              <select
                value={projectDefaultCcy}
                onChange={(e) => setProjectDefaultCcy(e.target.value as Currency)}
                className="bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-sm"
                title={t("per_diem_ledger.default_currency_for_new_batches")}
              >
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <button
              onClick={exportSignoff}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand text-white px-3 py-1.5 text-xs font-medium"
            >
              <FileDown className="size-3.5" />
              {t("per_diem_ledger.export_signoff_sheet")}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatMini
            label={
              <>
                Pending — <RiyalIcon />
              </>
            }
            value={
              <span className="inline-flex items-center gap-1">
                {formatSAR(totals.pending.SAR)} <RiyalIcon />
              </span>
            }
            tone="text-warning"
          />
          <StatMini
            label={t("platform.ui.pendingUsd")}
            value={formatUSD(totals.pending.USD)}
            tone="text-warning"
          />
          <StatMini
            label={
              <>
                Paid — <RiyalIcon />
              </>
            }
            value={
              <span className="inline-flex items-center gap-1">
                {formatSAR(totals.paid.SAR)} <RiyalIcon />
              </span>
            }
            tone="text-success"
          />
          <StatMini
            label={t("platform.ui.paidUsd")}
            value={formatUSD(totals.paid.USD)}
            tone="text-success"
          />
        </div>

        {loading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : eligible.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No active personnel with a logged on-set per diem. Add rates in the crew or cast
            contract.
          </div>
        ) : (
          <div className="overflow-x-auto">
            {selected.size > 0 && (
              <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-success/30 bg-success/10">
                <div className="text-sm">
                  <span className="font-semibold">{selected.size}</span> batch(es) selected
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelected(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Clear
                  </button>
                  <button
                    disabled={bulkBusy}
                    onClick={bulkMarkPaid}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-success hover:bg-success text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  >
                    {bulkBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    Mark Selected as Paid
                  </button>
                  <button
                    disabled={bulkBusy}
                    onClick={bulkMarkPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-warning hover:bg-warning text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  >
                    {bulkBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                    Mark Selected as Pending
                  </button>
                </div>
              </div>
            )}
            <table className="app-table w-full text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 w-8"></th>
                  {[
                    "Name / Position",
                    "Period",
                    "Budget Line",
                    "On-Set 🔒",
                    "Off-Set 🔒",
                    "Shoot D",
                    "Off D",
                    "Total",
                    "Ccy",
                    "Cash Float",
                    "Status",
                    "Receipt",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-2 py-2 text-left text-[11px] uppercase tracking-wider font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map(({ person: p, rows }) => (
                  <PersonBlock
                    key={p.id}
                    person={p}
                    rows={rows}
                    selected={selected}
                    savingKey={savingKey}
                    cashFloats={cashFloats}
                    projectCodes={projectCodes}
                    activeProjectId={activeProjectId}
                    fileInputs={fileInputs}
                    onAddBatch={() => addBatchFor(p.id)}
                    onToggleSelect={toggleSelect}
                    onUpdate={updateRow}
                    onSave={(rowKey) => save(p.id, rowKey)}
                    onRemove={(rowKey) => remove(p.id, rowKey)}
                    onUpload={(rowKey, file) => uploadReceipt(p.id, rowKey, file)}
                    onViewReceipt={viewReceipt}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-[11px] text-muted-foreground flex items-start gap-2">
          <CalendarDays className="size-3.5 mt-0.5" />
          <div>
            Each person can hold multiple weekly batches. Rates are{" "}
            <span className="font-medium">locked</span> from the contract and auto-convert on
            currency change — edit the contract to change them. Paid batches post to the selected{" "}
            <span className="font-medium">{t("platform.ui.perDiem")}</span> budget line and become
            read-only. Use <span className="font-medium">+ Add Batch</span> for the next week.
          </div>
        </div>
      </Panel>
    </div>
  );
}

function PersonBlock({
  person,
  rows,
  selected,
  savingKey,
  cashFloats,
  projectCodes,
  activeProjectId,
  fileInputs,
  onAddBatch,
  onToggleSelect,
  onUpdate,
  onSave,
  onRemove,
  onUpload,
  onViewReceipt,
}: {
  person: any;
  rows: Row[];
  selected: Set<string>;
  savingKey: string | null;
  cashFloats: CashFloat[];
  projectCodes: string[];
  activeProjectId: string;
  fileInputs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  onAddBatch: () => void;
  onToggleSelect: (rowKey: string) => void;
  onUpdate: (personId: string, rowKey: string, patch: Partial<Row>) => void;
  onSave: (rowKey: string) => void;
  onRemove: (rowKey: string) => void;
  onUpload: (rowKey: string, file: File) => void;
  onViewReceipt: (path: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {rows.map((r, idx) => {
        const isSelected = selected.has(r.key);
        const locked = r.status === "paid" && !!r.id;
        const isFirst = idx === 0;
        return (
          <tr
            key={r.key}
            id={r.id ? `perdiem-row-${r.id}` : undefined}
            className={`border-b border-border align-middle ${isSelected ? "bg-success/5" : ""} ${locked ? "opacity-90" : ""}`}
          >
            <td className="px-2 py-2">
              <input
                type="checkbox"
                aria-label={`Select ${person.fullName} batch`}
                checked={isSelected}
                onChange={() => onToggleSelect(r.key)}
                className="align-middle"
              />
            </td>
            <td className="px-2 py-2">
              {isFirst ? (
                <div>
                  <div className="font-medium">{person.fullName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {person.kind === "cast"
                      ? person.character || "Cast"
                      : person.position || "Crew"}
                  </div>
                  <button
                    onClick={onAddBatch}
                    className="mt-1 inline-flex items-center gap-1 rounded-md bg-brand/15 text-brand border border-brand/30 px-1.5 py-0.5 text-[10px] font-medium hover:bg-brand/25"
                  >
                    <Plus className="size-3" />
                    {t("per_diem_ledger.add_batch")}
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground italic ps-4">↳ next batch</div>
              )}
            </td>
            <td className="px-2 py-2 min-w-[210px]">
              <div className="flex items-center gap-1">
                <DateInput
                  disabled={locked}
                  value={r.period_start}
                  onChange={(v) => onUpdate(person.id, r.key, { period_start: v })}
                  className="bg-surface-2 border border-border rounded px-1.5 py-1 text-xs disabled:opacity-60"
                />
                <span className="text-muted-foreground text-xs">→</span>
                <DateInput
                  disabled={locked}
                  value={r.period_end}
                  onChange={(v) => onUpdate(person.id, r.key, { period_end: v })}
                  className="bg-surface-2 border border-border rounded px-1.5 py-1 text-xs disabled:opacity-60"
                />
              </div>
            </td>
            <td className="px-2 py-2 min-w-[220px]">
              <BudgetCodeSelector
                value={r.budget_code ?? ""}
                selectedLineId={r.linked_budget_line_id}
                onChange={(code) =>
                  !locked && onUpdate(person.id, r.key, { budget_code: code || null })
                }
                onSelectLine={(line) =>
                  !locked &&
                  onUpdate(person.id, r.key, {
                    budget_code: line?.mainCode ?? null,
                    linked_budget_line_id: line?.id ?? null,
                  })
                }
                projectId={activeProjectId}
                restrictToCodes={projectCodes.length > 0 ? projectCodes : undefined}
                disabled={locked}
                emptyLabel="— Select budget line —"
              />
            </td>
            <td className="px-2 py-2">
              <div
                className="inline-flex items-center gap-1 rounded bg-surface-2 border border-border px-2 py-1 text-xs tabular-nums"
                title={t("per_diem_ledger.locked_set_in_the_contract")}
              >
                <Lock className="size-3 text-muted-foreground" />{" "}
                {fmtMoney(r.on_set_rate, r.currency)}
              </div>
            </td>
            <td className="px-2 py-2">
              <div
                className="inline-flex items-center gap-1 rounded bg-surface-2 border border-border px-2 py-1 text-xs tabular-nums"
                title={t("per_diem_ledger.locked_set_in_the_contract")}
              >
                <Lock className="size-3 text-muted-foreground" />{" "}
                {fmtMoney(r.off_set_rate, r.currency)}
              </div>
            </td>
            <td className="px-2 py-2">
              <NumInput
                value={r.shoot_days}
                step={1}
                disabled={locked}
                onChange={(v) => onUpdate(person.id, r.key, { shoot_days: Math.max(0, v) })}
                className="w-16"
              />
            </td>
            <td className="px-2 py-2">
              <NumInput
                value={r.off_days}
                step={1}
                disabled={locked}
                onChange={(v) => onUpdate(person.id, r.key, { off_days: Math.max(0, v) })}
                className="w-16"
              />
            </td>
            <td className="px-2 py-2 font-medium tabular-nums" dir="ltr">
              {fmtMoney(perDiemRowTotal(r), r.currency)}
            </td>
            <td className="px-2 py-2">
              <select
                value={r.currency}
                disabled={locked}
                onChange={(e) =>
                  onUpdate(person.id, r.key, { currency: e.target.value as Currency })
                }
                className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs disabled:opacity-60"
              >
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
              </select>
            </td>
            <td className="px-2 py-2 min-w-[180px]">
              <select
                value={r.cash_advance_id ?? ""}
                disabled={locked}
                onChange={(e) =>
                  onUpdate(person.id, r.key, { cash_advance_id: e.target.value || null })
                }
                className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs w-full disabled:opacity-60"
              >
                <option value="">— None —</option>
                {cashFloats.map((f) => {
                  const rem = Number(f.total_advance ?? 0) - Number(f.expenses ?? 0);
                  return (
                    <option key={f.id} value={f.id}>
                      {f.holder} · rem {formatSAR(rem)}
                    </option>
                  );
                })}
              </select>
              {r.cash_advance_id && (
                <div className="mt-1 text-[10px] text-muted-foreground inline-flex items-center gap-1">
                  <Wallet className="size-3" />
                  {t("per_diem_ledger.posts_to_petty_cash_on_paid")}
                </div>
              )}
            </td>
            <td className="px-2 py-2">
              <select
                value={r.status}
                onChange={(e) =>
                  onUpdate(person.id, r.key, { status: e.target.value as Row["status"] })
                }
                className={`bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs ${
                  r.status === "paid" ? "text-success" : "text-warning"
                }`}
              >
                <option value="pending">{t("platform.ui.pending")}</option>
                <option value="paid">{t("platform.ui.paid")}</option>
              </select>
            </td>
            <td className="px-2 py-2">
              <div className="flex items-center gap-1">
                <input
                  ref={(el) => {
                    fileInputs.current[r.key] = el;
                  }}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUpload(r.key, f);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => fileInputs.current[r.key]?.click()}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-2 border border-border px-2 py-1 text-[11px] hover:bg-muted"
                >
                  <Upload className="size-3" /> Upload
                </button>
                {r.receipt_path && (
                  <button
                    onClick={() => onViewReceipt(r.receipt_path!)}
                    className="inline-flex items-center gap-1 rounded-md bg-success/10 border border-success/20 text-success px-2 py-1 text-[11px]"
                  >
                    <Eye className="size-3" />
                  </button>
                )}
              </div>
            </td>
            <td className="px-2 py-2 text-right whitespace-nowrap">
              <button
                disabled={!r.dirty || savingKey === r.key}
                onClick={() => onSave(r.key)}
                className="inline-flex items-center gap-1 rounded-md bg-brand/90 hover:bg-brand text-white px-2.5 py-1 text-[11px] font-medium disabled:opacity-40"
              >
                {savingKey === r.key ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Save className="size-3" />
                )}
                Save
              </button>
              <button
                onClick={() => onRemove(r.key)}
                className="ms-1 inline-flex items-center rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-2 py-1 text-[11px]"
                title={r.status === "paid" ? "Revert to Pending first" : "Delete batch"}
              >
                <Trash2 className="size-3" />
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function StatMini({
  label,
  value,
  tone,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-0.5 ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  step = 1,
  className,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : 0}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className={`bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs tabular-nums w-24 disabled:opacity-60 ${className ?? ""}`}
    />
  );
}

function BudgetHealthWidget({
  health,
}: {
  health: {
    codes: number;
    totalBudget: number;
    totalPaidSar: number;
    remaining: number;
    pct: number;
    over: boolean;
  };
}) {
  const { t } = useTranslation();

  const { codes, totalBudget, totalPaidSar, remaining, pct, over } = health;
  const barPct = Math.max(0, Math.min(100, pct));
  const barTone = over ? "bg-destructive" : pct >= 85 ? "bg-warning" : "bg-success";
  const remainingTone = over ? "text-destructive" : "text-success";
  const badge = over
    ? { label: "OVER BUDGET", cls: "bg-destructive/15 text-destructive border-destructive/30" }
    : pct >= 85
      ? { label: "NEAR LIMIT", cls: "bg-warning/15 text-warning border-warning/30" }
      : { label: "HEALTHY", cls: "bg-success/15 text-success border-success/30" };

  return (
    <Panel>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("per_diem_ledger.per_diem_budget_health")}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Aggregated across {codes} linked budget line{codes === 1 ? "" : "s"} — all figures in
            SAR.
          </div>
        </div>
        <span
          className={`text-[10px] font-semibold uppercase tracking-widest border rounded-full px-2 py-0.5 ${badge.cls}`}
        >
          {badge.label}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <StatMini
          label={t("platform.ui.totalBudget")}
          value={`SAR ${formatSAR(totalBudget)}`}
          tone="text-foreground"
        />
        <StatMini
          label={t("platform.ui.totalPaid")}
          value={`SAR ${formatSAR(totalPaidSar)}`}
          tone={over ? "text-destructive" : "text-info"}
        />
        <StatMini
          label={over ? "Over Budget By" : "Remaining Balance"}
          value={`SAR ${formatSAR(Math.abs(remaining))}`}
          tone={remainingTone}
        />
      </div>
      <div className="w-full h-2 rounded-full bg-surface overflow-hidden">
        <div className={`h-full ${barTone} transition-all`} style={{ width: `${barPct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground mt-1 tabular-nums">
        <span>{pct.toFixed(1)}% utilised</span>
        <span>
          {over ? `Exceeded by SAR ${formatSAR(-remaining)}` : `SAR ${formatSAR(remaining)} left`}
        </span>
      </div>
    </Panel>
  );
}
