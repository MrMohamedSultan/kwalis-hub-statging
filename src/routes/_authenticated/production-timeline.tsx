import {
  MACRO_PHASES,
  MACRO_PHASE_AR,
  MACRO_PHASE_ID,
  DEFAULT_MACRO_PHASE,
  normalizeMacroPhase,
  phaseOfLaneId,
  type MacroPhase,
} from "@/lib/timeline-phases";
import { DateInput } from "@/components/ui/date-input";
import { useTimelinePhaseSettings } from "@/lib/timeline-settings";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  Film,
  Tv,
  ChevronDown,
  ChevronRight,
  Search,
  Plus,
  Diamond,
  Calendar,
  CheckCircle2,
  Clock,
  Archive,
  Send,
  ShieldCheck,
  GitBranch,
  X,
  DollarSign,
  AlertTriangle,
  PanelRightOpen,
  PanelBottomOpen,
  Filter,
  Sparkles,
  GripHorizontal,
  Undo2,
  Redo2,
  Loader2,
  History,
  Pencil,
  Trash2,
  Settings,
  Eye,
  EyeOff,
  Printer,
  FileSpreadsheet,
  FolderClock,
} from "lucide-react";

import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useTimelineData } from "@/lib/timeline-store";
import { useTimelineTaskTypes, type TimelineTaskType } from "@/lib/timeline-task-types";
import { TimelineAuditLog } from "@/components/TimelineAuditLog";
import { toast } from "sonner";

import { TimelineDraftsPanel } from "@/components/timeline/TimelineDraftsPanel";
import { runGanttExcelExport, runGanttPdfExport } from "@/features/timeline/export/runGanttExport";
import { useExportAction } from "@/hooks/use-export-action";

import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/production-timeline")({
  component: () => (
    <AppShell>
      <ProductionTimelinePage />
    </AppShell>
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Real "today" (UTC midnight) — the grid window is anchored to it.
const TODAY = (() => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
})();
const DAY_MS = 86_400_000;

function d(iso: string) {
  return new Date(iso + "T00:00:00Z");
}
function fmt(dt: Date) {
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
function shortFmt(dt: Date) {
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function diffDays(a: Date, b: Date) {
  return Math.round((+b - +a) / DAY_MS);
}
function addDays(dt: Date, n: number) {
  return new Date(+dt + n * DAY_MS);
}
function weeksBetween(a: Date, b: Date) {
  return Math.max(0, Math.round(diffDays(a, b) / 7));
}

// ─────────────────────────────────────────────────────────────────────────────
// Macro phase bands are DERIVED from the project's own bars — no hardcoded dates.
// All six phases come from the shared list in src/lib/timeline-phases.ts.
const PHASE_META: Record<MacroPhase, { bar: string; text: string }> = {
  Development: { bar: "bg-highlight/70 border-highlight/60", text: "text-primary-foreground" },
  "Soft prep": { bar: "bg-warning/70 border-warning/60", text: "text-primary-foreground" },
  "Pre-Production": { bar: "bg-info/70 border-info/60", text: "text-primary-foreground" },
  Production: { bar: "bg-brand/70 border-brand/60", text: "text-primary-foreground" },
  "Post production": { bar: "bg-success/70 border-success/60", text: "text-primary-foreground" },
  Wrap: {
    bar: "bg-muted-foreground/50 border-muted-foreground/40",
    text: "text-primary-foreground",
  },
};

/** Buckets a bar into its macro phase: film lanes by lane id, others by bar kind. */
const KIND_PHASE: Record<BarKind, MacroPhase> = {
  prep: "Pre-Production",
  shoot: "Production",
  editors: "Post production",
  directors: "Post production",
  sound: "Post production",
  color: "Post production",
};
function phaseOfBar(b: Bar): MacroPhase {
  return phaseOfLaneId(b.row) ?? KIND_PHASE[b.kind] ?? DEFAULT_MACRO_PHASE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Micro Gantt window — anchored to today, not to a fixed calendar year.
const GRID_START = addDays(TODAY, -28);
const GRID_END = addDays(TODAY, 330);
const GRID_DAYS = diffDays(GRID_START, GRID_END);
const CELL_W = 28; // px per day column

type Row = { id: string; label: string; ar: string };

/** Feature film → one continuous track split into Prep / Shoot / Wrap. */
const FILM_ROWS: Row[] = MACRO_PHASES.map((phase) => ({
  id: MACRO_PHASE_ID[phase],
  label: phase,
  ar: MACRO_PHASE_AR[phase],
}));
/** Series with no seasons configured yet still needs one place to drop events. */
const SERIES_FALLBACK_ROWS: Row[] = [{ id: "s1", label: "Season 1 — Master", ar: "الموسم الأول" }];

type BarKind = "shoot" | "editors" | "directors" | "sound" | "color" | "prep";
type Bar = {
  id: string;
  row: string;
  kind: BarKind;
  label: string;
  start: string;
  end: string;
  cashAlert?: boolean;
};
type MilestoneKind = "vfx" | "imf" | "holiday" | "bible" | "delivery";
type Milestone = { id: string; row: string; kind: MilestoneKind; label: string; date: string };

const BAR_STYLE: Record<BarKind, { cls: string; label: string }> = {
  shoot: { cls: "bg-info/80 border-info/40", label: "Principal Photography" },
  editors: { cls: "bg-destructive/80 border-destructive/40", label: "Editor's Cut" },
  directors: { cls: "bg-destructive/80 border-destructive/40", label: "Director's Cut" },
  sound: { cls: "bg-highlight/80 border-highlight/40", label: "Sound Edit" },
  color: { cls: "bg-highlight/80 border-highlight/40", label: "Color Grading" },
  prep: { cls: "bg-info/80 border-info/40", label: "Prep" },
};

// Choose readable text color for a Tailwind bg-* utility. Light shades (50-400) get dark text; else white.
function textOnBg(cls: string): string {
  const m = cls.match(/bg-[a-z]+-(\d{2,3})/);
  const shade = m ? parseInt(m[1], 10) : 500;
  return shade <= 400 ? "text-foreground" : "text-white";
}

const MILESTONE_STYLE: Record<MilestoneKind, string> = {
  vfx: "text-warning",
  imf: "text-success",
  holiday: "text-destructive",
  bible: "text-info",
  delivery: "text-success",
};

// Event catalog (for modal)
type CatalogEntry = {
  name: string;
  phase: "Development" | "Pre-Production" | "Production" | "Post Production";
  discipline: string;
  dateType: "Single Date" | "Date Range";
  count: number;
};
const EVENT_CATALOG: CatalogEntry[] = [
  {
    name: "Bible Delivery",
    phase: "Development",
    discipline: "Writers Room",
    dateType: "Single Date",
    count: 3,
  },
  {
    name: "Respect@ HR Training",
    phase: "Development",
    discipline: "General",
    dateType: "Single Date",
    count: 1,
  },
  {
    name: "Table Read",
    phase: "Pre-Production",
    discipline: "Cast",
    dateType: "Single Date",
    count: 6,
  },
  {
    name: "Location Scout",
    phase: "Pre-Production",
    discipline: "Locations",
    dateType: "Date Range",
    count: 4,
  },
  {
    name: "Principal Photography",
    phase: "Production",
    discipline: "Camera",
    dateType: "Date Range",
    count: 6,
  },
  { name: "Reshoots", phase: "Production", discipline: "Camera", dateType: "Date Range", count: 0 },
  {
    name: "Editor's Cut",
    phase: "Post Production",
    discipline: "Editorial",
    dateType: "Date Range",
    count: 6,
  },
  {
    name: "Director's Cut",
    phase: "Post Production",
    discipline: "Editorial",
    dateType: "Date Range",
    count: 6,
  },
  {
    name: "Sound Edit",
    phase: "Post Production",
    discipline: "Sound",
    dateType: "Date Range",
    count: 6,
  },
  {
    name: "Color Grading",
    phase: "Post Production",
    discipline: "Post",
    dateType: "Date Range",
    count: 6,
  },
  {
    name: "VFX Turnover",
    phase: "Post Production",
    discipline: "Post production",
    dateType: "Single Date",
    count: 6,
  },
  {
    name: "IMF Delivery",
    phase: "Post Production",
    discipline: "Delivery",
    dateType: "Single Date",
    count: 6,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Unified event-type registry (drives dropdown + bottom cards)
type EventPhase = MacroPhase;
type EventTypeDef = { code: string; name: string; bg: string; phase: EventPhase };

const PHASE_OF_CODE: Record<string, EventPhase> = {
  PRE: "Pre-Production",
  PP: "Production",
  TR: "Pre-Production",
  TS: "Pre-Production",
  PM: "Pre-Production",
  "R@N": "Pre-Production",
  W: "Production",
  Dir: "Pre-Production",
  Eid: "Production",
  NC1: "Post production",
  NC2: "Post production",
  NC3: "Post production",
  NC4: "Post production",
  NC5: "Post production",
  NC6: "Post production",
  NN1: "Post production",
  NN2: "Post production",
  NN3: "Post production",
  NN4: "Post production",
  NN5: "Post production",
  PL: "Post production",
  ME1: "Post production",
  PM1: "Post production",
  IMF: "Post production",
  DC: "Post production",
  EC: "Post production",
  PC: "Post production",
  Stu: "Post production",
  CF: "Post production",
  CG: "Post production",
  CGT: "Post production",
  CRV: "Post production",
  PCF: "Post production",
  MIX: "Post production",
  MF: "Post production",
  MP: "Post production",
  MR: "Post production",
  SE: "Post production",
  Loc: "Post production",
  Sol: "Post production",
  EPL: "Post production",
  pla: "Post production",
  Fic: "Post production",
  PAD: "Post production",
  VFD: "Post production",
  VPT: "Post production",
  VT: "Post production",
  B3: "Development",
  OD: "Development",
  SD1: "Development",
  SD2: "Development",
  SD3: "Development",
  SD4: "Development",
  WRE: "Development",
  WRT: "Development",
  WRS: "Development",
  SFD: "Development",
  SRW: "Development",
  S1N: "Development",
  S2N: "Development",
  S3N: "Development",
  S4N: "Development",
  "01": "Development",
  Scr: "Development",
};

// Kind mapping so events created from the dropdown pick a sensible bar color.
const KIND_OF_CODE: Record<string, BarKind> = {
  PRE: "prep",
  PP: "shoot",
  EC: "editors",
  DC: "directors",
  SE: "sound",
  CG: "color",
  MIX: "sound",
  MF: "sound",
  MP: "sound",
  MR: "sound",
  CGT: "color",
  CRV: "color",
  CF: "color",
};

function inferKind(code: string): BarKind {
  return KIND_OF_CODE[code] ?? "prep";
}
function inferPhase(code: string): EventPhase {
  return PHASE_OF_CODE[code] ?? DEFAULT_MACRO_PHASE;
}

// ─────────────────────────────────────────────────────────────────────────────

type VersionStatus = "Active" | "Draft" | "Pending Approval" | "Archived";
type Version = { id: string; label: string; date: string; status: VersionStatus };

const STATUS_BADGE: Record<VersionStatus, string> = {
  Active: "bg-success/15 text-success border-success/30",
  Draft: "bg-warning/15 text-warning border-warning/30",
  "Pending Approval": "bg-info/15 text-info border-info/30",
  Archived: "bg-surface text-muted-foreground border-border",
};

// ─────────────────────────────────────────────────────────────────────────────

export function ProductionTimelinePage() {
  const { t } = useTranslation();
  const { rows: dictionary } = useTimelineTaskTypes();

  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeProjectOrg = useStore((s) => {
    const id = s.activeProjectId;
    const p = id ? s.projects.find((x) => x.id === id) : null;
    return (p as any)?.organizationId ?? null;
  });
  const activeProjectName = useStore((s) => {
    const id = s.activeProjectId;
    const p = id ? s.projects.find((x) => x.id === id) : null;
    return p?.name ?? s.projectName ?? "Production Timeline";
  });
  // Structure follows the project's configured production kind.
  const productionKind = useStore((s) => {
    const id = s.activeProjectId;
    const p = id ? s.projects.find((x) => x.id === id) : null;
    return ((p as any)?.productionKind ?? "film") as string;
  });

  // Layout is derived strictly from the project's configured production kind.
  const mode: "series" | "film" = productionKind === "series" ? "series" : "film";

  const [activeVersionId, setActiveVersionId] = useState<string>("");
  const [adminView, setAdminView] = useState(false);
  const [versionMenu, setVersionMenu] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const { run: runExport, isPending: exportPending } = useExportAction();

  const { settings: phaseSettings, update: updatePhaseSetting } =
    useTimelinePhaseSettings(activeProjectId);
  const hiddenPhases = useMemo(
    () => new Set(MACRO_PHASES.filter((p) => !phaseSettings[p].visible)),
    [phaseSettings],
  );
  const [filter, setFilter] = useState("All Project Dates");
  const [modal, setModal] = useState<{
    row: string;
    date: Date;
    endDate?: Date;
    prefilled?: EventTypeDef | null;
  } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Series structure comes from the project's own seasons/episodes — never a
  // hardcoded sample season.
  const [seriesRows, setSeriesRows] = useState<Row[]>([]);
  useEffect(() => {
    setSeriesRows([]);
    setActiveVersionId("");
    if (!activeProjectId) return;
    let cancelled = false;
    (async () => {
      const [{ data: seasons }, { data: episodes }] = await Promise.all([
        supabase
          .from("series_seasons")
          .select("id,season_number,title")
          .eq("project_id", activeProjectId)
          .order("season_number"),
        supabase
          .from("series_episodes")
          .select("id,season_id,episode_number,title")
          .eq("project_id", activeProjectId)
          .order("episode_number"),
      ]);
      if (cancelled) return;
      const out: Row[] = [];
      for (const s of seasons ?? []) {
        out.push({
          id: `s${s.season_number}`,
          label: `Season ${s.season_number} — Master`,
          ar: `الموسم ${s.season_number}`,
        });
        for (const e of (episodes ?? []).filter((x: any) => x.season_id === s.id)) {
          out.push({
            id: `s${s.season_number}e${e.episode_number}`,
            label: e.title
              ? `Episode ${e.episode_number} — ${e.title}`
              : `Episode ${e.episode_number}`,
            ar: `الحلقة ${e.episode_number}`,
          });
        }
      }
      setSeriesRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  // Supabase-backed persistence with undo/redo + realtime + batching
  const { snap, ready, loading, commit, undo, redo, canUndo, canRedo, beginBatch, endBatch } =
    useTimelineData({
      projectId: activeProjectId,
      organizationId: activeProjectOrg,
    });
  const [auditOpen, setAuditOpen] = useState(false);
  // Expose batching hooks for future multi-step callers; suppress unused-var lint.
  void beginBatch;
  void endBatch;

  const versions = snap.versions;
  const bars = snap.bars;
  const milestones = snap.milestones;
  const activeVersion: Version = versions.find((v) => v.id === activeVersionId) ??
    versions[0] ?? { id: "v1", label: "v1", date: fmt(TODAY), status: "Draft" };

  useEffect(() => {
    if (!activeVersionId && versions.length) setActiveVersionId(versions[0].id);
  }, [versions, activeVersionId]);

  const rows: Row[] =
    mode === "series"
      ? seriesRows.length
        ? seriesRows
        : SERIES_FALLBACK_ROWS
      : FILM_ROWS.filter((r) => !hiddenPhases.has(phaseOfLaneId(r.id) ?? DEFAULT_MACRO_PHASE));
  const rowIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  // Anything stored against a track that doesn't exist in the current structure
  // is folded into the first track so nothing silently disappears.
  const fallbackRow = rows[0]?.id ?? "";
  const visibleBars = useMemo(
    () => bars.map((b) => (rowIds.has(b.row) ? b : { ...b, row: fallbackRow })),
    [bars, rowIds, fallbackRow],
  );
  const visibleMs = useMemo(
    () => milestones.map((m) => (rowIds.has(m.row) ? m : { ...m, row: fallbackRow })),
    [milestones, rowIds, fallbackRow],
  );

  // Instance counts for the unified Event Type dropdown.
  const instanceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of bars) c[b.label] = (c[b.label] ?? 0) + 1;
    for (const m of milestones) c[m.label] = (c[m.label] ?? 0) + 1;
    return c;
  }, [bars, milestones]);

  const submitForApproval = () => {
    commit((draft) => {
      draft.versions = draft.versions.map((v) =>
        v.id === activeVersionId ? { ...v, status: "Pending Approval" } : v,
      );
    }, activeVersionId);
  };
  const approveSchedule = () => {
    commit((draft) => {
      draft.versions = draft.versions.map((v) => {
        if (v.status === "Active") return { ...v, status: "Archived" };
        if (v.id === activeVersionId) return { ...v, status: "Active" };
        return v;
      });
    }, activeVersionId);
  };
  const duplicateAsDraft = () => {
    const nextNum = Math.max(...versions.map((v) => parseInt(v.id.slice(1), 10) || 0)) + 1;
    const id = `v${nextNum}`;
    const newV: Version = { id, label: id, date: fmt(TODAY), status: "Draft" };
    commit((draft) => {
      draft.versions = [newV, ...draft.versions];
    }, activeVersionId);
    setActiveVersionId(id);
    setVersionMenu(false);
  };

  /** Save the current schedule as the next auto-numbered draft (v1, v2, …). */
  const saveDraft = () => {
    const nextNum = Math.max(0, ...versions.map((v) => parseInt(v.id.slice(1), 10) || 0)) + 1;
    const id = `v${nextNum}`;
    commit((draft) => {
      draft.versions = [{ id, label: id, date: fmt(TODAY), status: "Draft" }, ...draft.versions];
    }, activeVersionId);
    setActiveVersionId(id);
    setVersionMenu(false);
    toast.success(`Draft ${id} saved`);
  };

  // ── Exports ──────────────────────────────────────────────────────────────
  const exportLanes = useMemo(() => rows.map((r) => ({ id: r.id, label: r.label })), [rows]);
  const hasBars = visibleBars.length + visibleMs.length > 0;
  const handleExportXlsx = () =>
    runExport("xlsx", async () => {
      try {
        await runGanttExcelExport({
          projectName: activeProjectName,
          bars: visibleBars,
          milestones: visibleMs,
          rows,
          cards: dictionary,
          versionLabel: activeVersion.label,
          strictCount: visibleBars.length + visibleMs.length,
        });
      } catch (err) {
        toast.error("Export failed", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    });
  const handleExportPdf = () =>
    runExport("pdf", async () => {
      try {
        await runGanttPdfExport({
          projectName: activeProjectName,
          subtitle: `Version ${activeVersion.label} · ${activeVersion.date}`,
          variant: activeVersion.label,
        });
      } catch (err) {
        toast.error("Export failed", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    });

  const canEdit = (activeVersion?.status ?? "Draft") === "Draft";

  // ── Drag a card from the bank onto a track/date ──────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragCard, setDragCard] = useState<DrawerCard | null>(null);

  const onDragStart = (e: DragStartEvent) => {
    setDragCard((e.active.data.current as any)?.card ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const card = (e.active.data.current as any)?.card as DrawerCard | undefined;
    setDragCard(null);
    if (!card || !e.over) return;
    if (!canEdit) {
      toast.error(t("production_timeline.you_dont_have_permission_to_edit_the_timeline"));
      return;
    }
    const rowId = String(e.over.id).replace(/^track:/, "");
    const pointerX =
      (e.activatorEvent as PointerEvent | undefined)?.clientX != null
        ? (e.activatorEvent as PointerEvent).clientX + e.delta.x
        : (e.over.rect.left ?? 0);
    const idx = Math.max(
      0,
      Math.min(GRID_DAYS - 1, Math.floor((pointerX - e.over.rect.left) / CELL_W)),
    );
    const start = addDays(GRID_START, idx);
    const dropPhase = phaseOfLaneId(rowId) ?? DEFAULT_MACRO_PHASE;
    const end = addDays(start, Math.max(1, phaseSettings[dropPhase].defaultDays) - 1);
    handleCreateBar({
      id: crypto.randomUUID(),
      row: rowId,
      kind: inferKind(card.code),
      label: card.name,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    });
    toast.success(`${card.name} scheduled on ${fmt(start)}`);
  };

  const scrollToEvent = (name: string) => {
    const bar = visibleBars.find((b) => b.label === name);
    const ms = visibleMs.find((m) => m.label === name);
    const iso = bar?.start ?? ms?.date;
    const id = bar?.id ?? ms?.id;
    if (!iso || !id || !scrollRef.current) return;
    const left = diffDays(GRID_START, d(iso)) * CELL_W;
    scrollRef.current.scrollTo({ left: Math.max(0, left - 240), behavior: "smooth" });
    setHighlightId(id);
    window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2400);
  };

  // Click a card → open modal pre-populated with that event type.
  const handleSelectCard = (card: { name: string; code: string; jumpName?: string }) => {
    if (!canEdit) return;
    const evt: EventTypeDef = {
      code: card.code,
      name: card.name,
      bg: "bg-info",
      phase: inferPhase(card.code),
    };
    const startDt = TODAY;
    const endDt = addDays(TODAY, 4);
    setModal({ row: rows[0].id, date: startDt, endDate: endDt, prefilled: evt });
  };

  const handleCreateBar = (b: Bar) => {
    commit((draft) => {
      draft.bars = [...draft.bars, b];
    }, activeVersionId);
    setHighlightId(b.id);
    window.setTimeout(() => setHighlightId((cur) => (cur === b.id ? null : cur)), 2400);
  };

  const handleUpdateBar = (id: string, patch: Partial<Bar>) => {
    commit((draft) => {
      draft.bars = draft.bars.map((b) => (b.id === id ? { ...b, ...patch } : b));
    }, activeVersionId);
  };

  const handleDeleteBar = (id: string) => {
    commit((draft) => {
      draft.bars = draft.bars.filter((b) => b.id !== id);
    }, activeVersionId);
    toast.success(t("production_timeline.event_deleted"));
  };

  const handleUpdateMilestone = (id: string, patch: Partial<Milestone>) => {
    commit((draft) => {
      draft.milestones = draft.milestones.map((m) => (m.id === id ? { ...m, ...patch } : m));
    }, activeVersionId);
  };

  const handleDeleteMilestone = (id: string) => {
    commit((draft) => {
      draft.milestones = draft.milestones.filter((m) => m.id !== id);
    }, activeVersionId);
    toast.success(t("production_timeline.milestone_deleted"));
  };

  const openCustomEventModal = () => {
    if (!canEdit) {
      toast.error(t("production_timeline.you_dont_have_permission_to_edit_the_timeline"));
      return;
    }
    setModal({ row: rows[0]?.id ?? "", date: TODAY, endDate: addDays(TODAY, 3) });
  };

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl+Y or Cmd+Shift+Z = redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (undo(activeVersionId))
          toast.success(t("production_timeline.undone"), { duration: 1200 });
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        if (redo(activeVersionId))
          toast.success(t("production_timeline.redone"), { duration: 1200 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, activeVersionId]);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <PageTitle title={`${activeProjectName} — Production Timeline`} />

      {/* Top control bar */}
      <Panel className="p-3 mb-3 no-print">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setDraftsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted"
            title="Saved drafts — resume or export"
          >
            <FolderClock className="size-3.5" /> Drafts
          </button>
          <button
            type="button"
            onClick={() => void handleExportXlsx()}
            disabled={exportPending("xlsx") || !hasBars}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            title="Export the current schedule to Excel"
          >
            {exportPending("xlsx") ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-3.5" />
            )}{" "}
            Excel
          </button>
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={exportPending("pdf") || !hasBars}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            title="Export the Gantt chart as a paginated landscape PDF"
          >
            {exportPending("pdf") ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Printer className="size-3.5" />
            )}{" "}
            PDF
          </button>

          {/* Layout is auto-detected from the project's production type. */}
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground">
            {mode === "series" ? <Tv className="size-3.5" /> : <Film className="size-3.5" />}
            {mode === "series"
              ? t("production_timeline.series_multiepisode")
              : t("production_timeline.film_singletrack")}
          </div>

          <div className="relative">
            <button
              onClick={() => setVersionMenu((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted"
            >
              <GitBranch className="size-3.5" />
              <span className="font-semibold">{activeVersion.label}</span>
              <span className="text-muted-foreground">· {activeVersion.date}</span>
              <span
                className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[activeVersion.status]}`}
              >
                {activeVersion.status}
              </span>
              <ChevronDown className="size-3.5 opacity-70" />
            </button>
            {versionMenu && (
              <div className="absolute z-30 mt-1 w-80 rounded-xl border border-border bg-popover shadow-xl p-2">
                <button
                  onClick={duplicateAsDraft}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted text-left"
                >
                  <Plus className="size-3.5" />
                  {t("production_timeline.duplicate_current_schedule_create_draft")}
                </button>
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                  <Search className="size-3.5 text-muted-foreground" />
                  <input
                    placeholder={t("production_timeline.search_schedule_versions")}
                    className="flex-1 bg-transparent outline-none text-xs"
                  />
                </div>
                <div className="mt-2 max-h-72 overflow-y-auto">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setActiveVersionId(v.id);
                        setVersionMenu(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted ${v.id === activeVersionId ? "bg-surface" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{v.label}</span>
                        <span className="text-muted-foreground">{v.date}</span>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[v.status]}`}
                      >
                        {v.status === "Active" ? "Latest Published" : v.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${STATUS_BADGE[activeVersion.status]}`}
          >
            <span className="size-1.5 rounded-full bg-current opacity-80" /> State:{" "}
            {activeVersion.status}
          </span>

          <div className="ms-auto flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={adminView}
                onChange={(e) => setAdminView(e.target.checked)}
              />
              {t("production_timeline.admin_view")}
            </label>
            <button
              onClick={saveDraft}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
              title="Snapshot the current schedule as a new draft version"
            >
              <GitBranch className="size-3.5" />
              Save draft
            </button>
            {activeVersion.status === "Draft" && (
              <button
                onClick={submitForApproval}
                className="inline-flex items-center gap-1.5 rounded-lg bg-info/90 hover:bg-info text-white text-xs font-semibold px-3 py-1.5"
              >
                <Send className="size-3.5" />
                {t("production_timeline.submit_for_approval")}
              </button>
            )}
            {adminView && activeVersion.status === "Pending Approval" && (
              <button
                onClick={approveSchedule}
                className="inline-flex items-center gap-1.5 rounded-lg bg-success/90 hover:bg-success text-white text-xs font-semibold px-3 py-1.5"
              >
                <ShieldCheck className="size-3.5" />
                {t("production_timeline.approve_schedule")}
              </button>
            )}
            <div className="inline-flex items-center rounded-lg border border-border bg-surface p-0.5">
              <button
                onClick={() => undo(activeVersionId)}
                disabled={!canUndo}
                title={t("production_timeline.undo_ctrlcmd_z")}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Undo2 className="size-3.5" />
              </button>
              <button
                onClick={() => redo(activeVersionId)}
                disabled={!canRedo}
                title={t("production_timeline.redo_ctrlcmd_y")}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Redo2 className="size-3.5" />
              </button>
            </div>
            {loading && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Syncing…
              </span>
            )}
            <button
              onClick={openCustomEventModal}
              disabled={!canEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/15 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/25 disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("production_timeline.add_a_custom_timeline_event")}
            >
              <Plus className="size-3.5" />
              {t("production_timeline.add_custom_event")}
            </button>
            <div className="relative">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-muted ${settingsOpen ? "border-brand/40 bg-brand/15 text-brand" : "border-border bg-surface"}`}
                title="Timeline Settings"
              >
                <Settings className="size-3.5" /> Timeline Settings
              </button>
              {settingsOpen && (
                <Panel className="absolute end-0 top-full mt-1.5 z-40 w-80 p-3 shadow-xl">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold flex items-center gap-1.5">
                      <Settings className="size-3.5" /> Timeline Settings
                    </h4>
                    <button
                      onClick={() => setSettingsOpen(false)}
                      className="p-1 rounded hover:bg-muted"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    Manage macro phase lanes: visibility and default event duration.
                  </p>
                  <div className="space-y-1">
                    {MACRO_PHASES.map((phase) => {
                      const s = phaseSettings[phase];
                      return (
                        <div
                          key={phase}
                          className={`flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 ${s.visible ? "" : "opacity-55"}`}
                        >
                          <button
                            type="button"
                            onClick={() => updatePhaseSetting(phase, { visible: !s.visible })}
                            className="p-1 rounded hover:bg-muted shrink-0"
                            title={s.visible ? "Hide lane" : "Show lane"}
                          >
                            {s.visible ? (
                              <Eye className="size-3.5 text-brand" />
                            ) : (
                              <EyeOff className="size-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{phase}</div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {MACRO_PHASE_AR[phase]}
                            </div>
                          </div>
                          <label className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground">
                            <input
                              type="number"
                              min={1}
                              max={3650}
                              value={s.defaultDays}
                              onChange={(e) =>
                                updatePhaseSetting(phase, {
                                  defaultDays: Number(e.target.value) || 1,
                                })
                              }
                              className="w-14 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-end tabular-nums outline-none focus:ring-2 focus:ring-brand"
                            />
                            days
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              )}
            </div>
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-muted"
            >
              <PanelRightOpen className="size-3.5" /> Filters
            </button>
            <button
              onClick={() => setAuditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-muted"
              title={t("production_timeline.view_change_history")}
            >
              <History className="size-3.5" /> Activity
            </button>
            <button
              onClick={() => setDrawerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-muted"
            >
              <PanelBottomOpen className="size-3.5" />
              {t("production_timeline.all_project_dates")}
            </button>
          </div>
        </div>
      </Panel>

      <div className="timeline-print-area" data-timeline-export-root>
        <MacroTimeline bars={visibleBars} hidden={hiddenPhases} />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 mt-3">
          <GanttGrid
            rows={rows}
            bars={visibleBars}
            milestones={visibleMs}
            canEdit={canEdit}
            scrollRef={scrollRef}
            highlightId={highlightId}
            onCreateRange={(rowId, startIdx, endIdx) => {
              if (!canEdit) return;
              const lo = Math.min(startIdx, endIdx);
              const hi = Math.max(startIdx, endIdx);
              setModal({
                row: rowId,
                date: addDays(GRID_START, lo),
                endDate: addDays(GRID_START, hi),
              });
            }}
            onUpdateBar={handleUpdateBar}
            onDeleteBar={handleDeleteBar}
            onUpdateMilestone={handleUpdateMilestone}
            onDeleteMilestone={handleDeleteMilestone}
          />
          {sidebarOpen && (
            <div className="no-print" data-export-hide>
              <FiltersSidebar
                filter={filter}
                setFilter={setFilter}
                onClose={() => setSidebarOpen(false)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="no-print">
        <FinancialAlerts />
      </div>

      {drawerOpen && (
        <AllProjectDatesDrawer
          onClose={() => setDrawerOpen(false)}
          onSelectCard={(card) => handleSelectCard(card)}
          counts={instanceCounts}
        />
      )}

      {draftsOpen && (
        <TimelineDraftsPanel
          onClose={() => setDraftsOpen(false)}
          versions={versions}
          activeVersionId={activeVersionId}
          projectId={activeProjectId}
          projectName={activeProjectName}
          lanes={exportLanes}
          phaseOfBar={phaseOfBar}
          liveBars={visibleBars}
          liveMilestones={visibleMs}
          onResume={(id) => setActiveVersionId(id)}
        />
      )}

      {modal && (
        <CreateEventModal
          rows={rows}
          initialRowId={modal.row}
          date={modal.date}
          endDate={modal.endDate}
          prefilledEvent={modal.prefilled ?? null}
          instanceCounts={instanceCounts}
          onClose={() => setModal(null)}
          onCreate={(bar) => {
            handleCreateBar(bar);
            setModal(null);
          }}
        />
      )}
      {auditOpen && (
        <TimelineAuditLog projectId={activeProjectId} onClose={() => setAuditOpen(false)} />
      )}

      <DragOverlay dropAnimation={null}>
        {dragCard && (
          <div className="flex items-center gap-2 rounded-lg border border-brand/50 bg-card p-1.5 shadow-2xl">
            <div
              className={`${dragCard.bg} ${textOnBg(dragCard.bg)} w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-extrabold`}
            >
              {dragCard.code}
            </div>
            <span className="text-[11px] font-semibold pe-1">{dragCard.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Macro phase tracker

function MacroTimeline({ bars, hidden }: { bars: Bar[]; hidden?: Set<MacroPhase> }) {
  const { t } = useTranslation();

  const phases = useMemo(() => {
    const acc = Object.fromEntries(MACRO_PHASES.map((p) => [p, null])) as Record<
      MacroPhase,
      { start: Date; end: Date } | null
    >;
    for (const b of bars) {
      const k = phaseOfBar(b);
      const s = d(b.start);
      const e = d(b.end);
      const cur = acc[k];
      acc[k] = cur
        ? { start: s < cur.start ? s : cur.start, end: e > cur.end ? e : cur.end }
        : { start: s, end: e };
    }
    return MACRO_PHASES.map((k) => ({ key: k, span: acc[k] })).filter((p) => !hidden?.has(p.key));
  }, [bars, hidden]);

  const spans = phases.map((p) => p.span).filter(Boolean) as { start: Date; end: Date }[];
  const macroStart = spans.length
    ? spans.reduce((a, s) => (s.start < a ? s.start : a), spans[0].start)
    : addDays(TODAY, -30);
  const macroEnd = spans.length
    ? spans.reduce((a, s) => (s.end > a ? s.end : a), spans[0].end)
    : addDays(TODAY, 180);
  const macroDays = Math.max(1, diffDays(macroStart, macroEnd));
  const pctOfMacro = (dt: Date) =>
    Math.max(0, Math.min(100, (diffDays(macroStart, dt) / macroDays) * 100));

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">Schedule Summary — Macro Phases</h3>
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">
          {spans.length ? `${shortFmt(macroStart)} → ${shortFmt(macroEnd)}` : "No scheduled dates"}
        </div>
      </div>

      <div className="space-y-1.5">
        {phases.map((p) => {
          const meta = PHASE_META[p.key];
          if (!p.span) {
            return (
              <div key={p.key} className="grid grid-cols-[140px_1fr_180px] items-center gap-2">
                <div className="text-xs font-medium">{p.key}</div>
                <div className="relative h-6 rounded-md bg-surface border border-dashed border-border" />
                <div className="text-[11px] text-muted-foreground text-end">
                  {t("production_timeline.not_scheduled")}
                </div>
              </div>
            );
          }
          const { start: s, end: e } = p.span;
          const left = pctOfMacro(s);
          const width = Math.max(1, pctOfMacro(e) - left);
          const wk = weeksBetween(s, e);
          return (
            <div key={p.key} className="grid grid-cols-[140px_1fr_220px] items-center gap-2">
              <div className="text-xs font-medium">{p.key}</div>
              <div className="relative h-6 rounded-md bg-card/[0.03] border border-border">
                <div
                  className={`absolute inset-y-0.5 rounded-md border ${meta.bar} ${meta.text} shadow-md flex items-center px-2 text-[10px] font-semibold uppercase tracking-wide`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${p.key}: ${fmt(s)} → ${fmt(e)}`}
                >
                  <span className="truncate">{p.key}</span>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground text-end tabular-nums" dir="ltr">
                {shortFmt(s)} → {shortFmt(e)} ({wk}wk)
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gantt grid

function GanttGrid({
  rows,
  bars,
  milestones,
  canEdit,
  scrollRef,
  highlightId,
  onCreateRange,
  onUpdateBar,
  onDeleteBar,
  onUpdateMilestone,
  onDeleteMilestone,
}: {
  rows: Row[];
  bars: Bar[];
  milestones: Milestone[];
  canEdit: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  highlightId: string | null;
  onCreateRange: (rowId: string, startIdx: number, endIdx: number) => void;
  onUpdateBar: (id: string, patch: Partial<Bar>) => void;
  onDeleteBar: (id: string) => void;
  onUpdateMilestone: (id: string, patch: Partial<Milestone>) => void;
  onDeleteMilestone: (id: string) => void;
}) {
  const totalW = GRID_DAYS * CELL_W;

  const weeks: { start: Date; days: Date[] }[] = [];
  let cursor = GRID_START;
  while (cursor < GRID_END) {
    const days: Date[] = [];
    for (let i = 0; i < 7 && cursor < GRID_END; i++) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push({ start: days[0], days });
  }

  const todayLeft = diffDays(GRID_START, TODAY) * CELL_W;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayLeft - 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayLeft]);

  return (
    <Panel className="p-0 overflow-hidden">
      <div className="grid grid-cols-[220px_1fr]">
        <div className="border-e border-border bg-card/[0.02]" data-export-freeze-x>
          <div className="h-14 border-b border-border flex items-center px-3 text-xs font-semibold text-muted-foreground">
            Track
          </div>
          {rows.map((r) => (
            <div key={r.id} className="h-14 border-b border-border flex items-center gap-2 px-3">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold truncate">{r.label}</span>
                <span className="text-[11px] text-muted-foreground truncate" dir="rtl">
                  {r.ar}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div ref={scrollRef} className="overflow-x-auto">
          <div style={{ width: totalW }} className="relative">
            <div className="h-7 flex border-b border-border bg-card/[0.03]" data-export-freeze-y>
              {weeks.map((w, i) => (
                <div
                  key={i}
                  className="border-e border-border text-[10px] text-muted-foreground flex items-center px-2 tabular-nums"
                  style={{ width: 7 * CELL_W }}
                >
                  {shortFmt(w.start)}
                </div>
              ))}
            </div>
            <div className="h-7 flex border-b border-border" data-export-freeze-y>
              {weeks.map((w, i) =>
                w.days.map((day, di) => {
                  const isSun = day.getUTCDay() === 0;
                  const isFri = day.getUTCDay() === 5;
                  const letter = ["S", "M", "T", "W", "T", "F", "S"][day.getUTCDay()];
                  return (
                    <div
                      key={`${i}-${di}`}
                      className={`flex flex-col items-center justify-center text-[9px] border-e ${isSun ? "border-border" : "border-border"} ${isFri || isSun ? "bg-card/[0.04]" : ""}`}
                      style={{ width: CELL_W }}
                    >
                      <span className="text-muted-foreground">{letter}</span>
                      <span className="tabular-nums">{day.getUTCDate()}</span>
                    </div>
                  );
                }),
              )}
            </div>

            {todayLeft > 0 && todayLeft < totalW && (
              <div
                className="absolute top-0 bottom-0 z-20 pointer-events-none"
                style={{ left: todayLeft }}
              >
                <div className="w-px h-full bg-info shadow-[0_0_8px_rgba(56,189,248,0.7)]" />
                <div className="absolute -top-1 -left-6 text-[9px] bg-info text-white px-1 rounded shadow">
                  TODAY
                </div>
              </div>
            )}

            {rows.map((r) => (
              <RowTrack
                key={r.id}
                row={r}
                bars={bars.filter((b) => b.row === r.id)}
                milestones={milestones.filter((m) => m.row === r.id)}
                canEdit={canEdit}
                highlightId={highlightId}
                onCreateRange={onCreateRange}
                onUpdateBar={onUpdateBar}
                onDeleteBar={onDeleteBar}
                onUpdateMilestone={onUpdateMilestone}
                onDeleteMilestone={onDeleteMilestone}
              />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function RowTrack({
  row,
  bars,
  milestones,
  canEdit,
  highlightId,
  onCreateRange,
  onUpdateBar,
  onDeleteBar,
  onUpdateMilestone,
  onDeleteMilestone,
}: {
  row: Row;
  bars: Bar[];
  milestones: Milestone[];
  canEdit: boolean;
  highlightId: string | null;
  onCreateRange: (rowId: string, startIdx: number, endIdx: number) => void;
  onUpdateBar: (id: string, patch: Partial<Bar>) => void;
  onDeleteBar: (id: string) => void;
  onUpdateMilestone: (id: string, patch: Partial<Milestone>) => void;
  onDeleteMilestone: (id: string) => void;
}) {
  const { t } = useTranslation();

  const rowRef = useRef<HTMLDivElement>(null);
  // Drop target for cards dragged out of the event bank.
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `track:${row.id}` });
  const attachRow = (node: HTMLDivElement | null) => {
    rowRef.current = node;
    setDropRef(node);
  };
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  // Live bar resize state — snapped to day grid.
  const [resize, setResize] = useState<{
    id: string;
    edge: "left" | "right";
    startIso: string;
    endIso: string;
  } | null>(null);
  // Bar move drag — shifts both start & end by the same day delta.
  const [move, setMove] = useState<{
    id: string;
    anchorIdx: number;
    startIso: string;
    endIso: string;
    origStartIso: string;
    origEndIso: string;
  } | null>(null);
  // Milestone drag — snaps to day grid.
  const [msDrag, setMsDrag] = useState<{ id: string; iso: string } | null>(null);

  const idxFromX = (clientX: number): number => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(GRID_DAYS - 1, Math.floor((clientX - rect.left) / CELL_W)));
  };

  // Create-range drag (empty cells)
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => setDrag((d) => (d ? { ...d, end: idxFromX(e.clientX) } : d));
    const onUp = (e: MouseEvent) => {
      const endIdx = idxFromX(e.clientX);
      const startIdx = drag.start;
      setDrag(null);
      onCreateRange(row.id, startIdx, endIdx);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.start]);

  // Bar resize drag
  useEffect(() => {
    if (!resize) return;
    const onMove = (e: MouseEvent) => {
      const idx = idxFromX(e.clientX);
      const day = addDays(GRID_START, idx).toISOString().slice(0, 10);
      setResize((r) => {
        if (!r) return r;
        if (r.edge === "left") {
          if (day > r.endIso) return r;
          return { ...r, startIso: day };
        }
        if (day < r.startIso) return r;
        return { ...r, endIso: day };
      });
    };
    const onUp = () => {
      setResize((r) => {
        if (r) onUpdateBar(r.id, { start: r.startIso, end: r.endIso });
        return null;
      });
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resize?.id, resize?.edge]);

  // Bar move drag
  useEffect(() => {
    if (!move) return;
    const onMove = (e: MouseEvent) => {
      const idx = idxFromX(e.clientX);
      setMove((m) => {
        if (!m) return m;
        const delta = idx - m.anchorIdx;
        const s = d(m.origStartIso),
          en = d(m.origEndIso);
        const ns = addDays(s, delta).toISOString().slice(0, 10);
        const ne = addDays(en, delta).toISOString().slice(0, 10);
        return { ...m, startIso: ns, endIso: ne };
      });
    };
    const onUp = () => {
      setMove((m) => {
        if (m && (m.startIso !== m.origStartIso || m.endIso !== m.origEndIso)) {
          onUpdateBar(m.id, { start: m.startIso, end: m.endIso });
          toast.success(t("production_timeline.event_moved"));
        }
        return null;
      });
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.id]);

  // Milestone drag
  useEffect(() => {
    if (!msDrag) return;
    const onMove = (e: MouseEvent) => {
      const idx = idxFromX(e.clientX);
      const iso = addDays(GRID_START, idx).toISOString().slice(0, 10);
      setMsDrag((m) => (m ? { ...m, iso } : m));
    };
    const onUp = () => {
      setMsDrag((m) => {
        if (m) {
          onUpdateMilestone(m.id, { date: m.iso });
          toast.success(t("production_timeline.milestone_moved"));
        }
        return null;
      });
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msDrag?.id]);

  return (
    <div
      ref={attachRow}
      className={`relative h-14 border-b border-border select-none ${isOver ? "bg-brand/10 ring-1 ring-inset ring-brand/40" : ""}`}
    >
      <div
        className="absolute inset-0 flex"
        onMouseDown={(e) => {
          if (!canEdit) return;
          const i = idxFromX(e.clientX);
          setDrag({ start: i, end: i });
          e.preventDefault();
        }}
      >
        {Array.from({ length: GRID_DAYS }).map((_, i) => {
          const day = addDays(GRID_START, i);
          const dow = day.getUTCDay();
          const isWeekend = dow === 5 || dow === 6;
          return (
            <div
              key={i}
              className={`border-e border-border/[0.04] ${isWeekend ? "bg-card/[0.03]" : ""} ${canEdit ? "hover:bg-brand/10 cursor-crosshair" : ""}`}
              style={{ width: CELL_W }}
              title={canEdit ? `Drag to schedule from ${fmt(day)}` : ""}
            />
          );
        })}
      </div>

      {drag && (
        <div
          className="absolute top-2 h-10 rounded-lg bg-info border border-info/40 text-white flex items-center px-2 text-[11px] font-semibold pointer-events-none z-30 shadow-lg ring-2 ring-info/60"
          style={{
            left: Math.min(drag.start, drag.end) * CELL_W,
            width: (Math.abs(drag.end - drag.start) + 1) * CELL_W,
          }}
        >
          <span className="truncate">{t("production_timeline.new_activity")}</span>
        </div>
      )}

      {bars.map((b) => {
        // Use live resize/move preview if this bar is being resized or moved.
        const isMoving = move?.id === b.id;
        const startIso = isMoving
          ? move!.startIso
          : resize && resize.id === b.id
            ? resize.startIso
            : b.start;
        const endIso = isMoving
          ? move!.endIso
          : resize && resize.id === b.id
            ? resize.endIso
            : b.end;
        const s = d(startIso),
          e = d(endIso);
        const left = diffDays(GRID_START, s) * CELL_W;
        const width = Math.max(CELL_W, (diffDays(s, e) + 1) * CELL_W);
        const style = BAR_STYLE[b.kind];
        const isHi = highlightId === b.id;
        return (
          <div
            key={b.id}
            onMouseDown={(ev) => {
              if (!canEdit) return;
              // Ignore clicks on resize handles / buttons (they stopPropagation already)
              ev.preventDefault();
              ev.stopPropagation();
              document.body.style.cursor = "grabbing";
              const anchorIdx = idxFromX(ev.clientX);
              setMove({
                id: b.id,
                anchorIdx,
                startIso: b.start,
                endIso: b.end,
                origStartIso: b.start,
                origEndIso: b.end,
              });
            }}
            className={`absolute top-2 h-10 rounded-lg border shadow-md ${style.cls} ${textOnBg(style.cls)} flex items-center gap-1.5 px-2 text-[11px] font-semibold overflow-hidden transition group ${canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${isHi ? "ring-2 ring-border ring-offset-2 ring-offset-transparent animate-pulse z-20" : ""} ${isMoving ? "ring-2 ring-border opacity-90" : ""}`}
            style={{ left, width }}
            title={`${b.label}: ${shortFmt(s)} → ${shortFmt(e)}${canEdit ? " · drag to move" : ""}`}
          >
            {b.cashAlert && <DollarSign className="size-3 shrink-0 text-warning drop-shadow" />}
            <span className="truncate">{b.label}</span>
            {canEdit && (
              <>
                {/* Left resize handle */}
                <div
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    document.body.style.cursor = "col-resize";
                    setResize({ id: b.id, edge: "left", startIso: b.start, endIso: b.end });
                  }}
                  className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize bg-surface hover:bg-muted opacity-0 group-hover:opacity-100 transition"
                />
                {/* Right resize handle */}
                <div
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    document.body.style.cursor = "col-resize";
                    setResize({ id: b.id, edge: "right", startIso: b.start, endIso: b.end });
                  }}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize bg-surface hover:bg-muted opacity-0 group-hover:opacity-100 transition"
                />
                {/* Inline edit / delete controls */}
                <div className="absolute -top-2 right-1 hidden group-hover:flex items-center gap-0.5 z-30">
                  <button
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const next = window.prompt("Rename event", b.label);
                      if (next && next.trim() && next !== b.label)
                        onUpdateBar(b.id, { label: next.trim() });
                    }}
                    className="p-0.5 rounded bg-card border border-border text-white hover:bg-card shadow"
                    title={t("production_timeline.rename_event")}
                  >
                    <Pencil className="size-3" />
                  </button>
                  {(Object.keys(BAR_STYLE) as BarKind[]).map((k) => (
                    <button
                      key={k}
                      onMouseDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (k !== b.kind) onUpdateBar(b.id, { kind: k });
                      }}
                      className={`size-3 rounded-full border border-border shadow ${BAR_STYLE[k].cls} ${k === b.kind ? "ring-1 ring-foreground" : ""}`}
                      title={BAR_STYLE[k].label}
                    />
                  ))}
                  <button
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (window.confirm(`Delete "${b.label}"?`)) onDeleteBar(b.id);
                    }}
                    className="p-0.5 rounded bg-destructive/90 border border-destructive/40 text-white hover:bg-destructive shadow"
                    title={t("production_timeline.delete_event")}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}

      {milestones.map((m) => {
        const liveIso = msDrag?.id === m.id ? msDrag.iso : m.date;
        const dt = d(liveIso);
        const left = diffDays(GRID_START, dt) * CELL_W + CELL_W / 2;
        const isHi = highlightId === m.id;
        const isDragging = msDrag?.id === m.id;
        return (
          <div
            key={m.id}
            className={`absolute top-3 -translate-x-1/2 z-10 group ${isHi ? "animate-pulse" : ""} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
            style={{ left }}
            title={`${m.label} — ${fmt(dt)}${canEdit ? " · drag to reschedule" : ""}`}
            onMouseDown={(ev) => {
              if (!canEdit) return;
              ev.preventDefault();
              ev.stopPropagation();
              document.body.style.cursor = "grabbing";
              setMsDrag({ id: m.id, iso: m.date });
            }}
          >
            <Diamond
              className={`size-4 ${MILESTONE_STYLE[m.kind]} fill-current drop-shadow ${isHi || isDragging ? "scale-150 transition-transform" : ""}`}
            />
            <div
              className={`absolute left-1/2 -translate-x-1/2 mt-1 ${isDragging ? "block" : "hidden group-hover:block"} whitespace-nowrap rounded-md bg-popover border border-border px-2 py-1 text-[10px] shadow-lg`}
            >
              {m.label}
              {canEdit && (
                <span className="ms-2 inline-flex items-center gap-0.5">
                  <button
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const next = window.prompt("Rename milestone", m.label);
                      if (next && next.trim() && next !== m.label)
                        onUpdateMilestone(m.id, { label: next.trim() });
                    }}
                    className="p-0.5 rounded hover:bg-muted"
                    title="Rename"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (window.confirm(`Delete milestone "${m.label}"?`)) onDeleteMilestone(m.id);
                    }}
                    className="p-0.5 rounded hover:bg-destructive/30 text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create event modal

function CreateEventModal({
  rows,
  initialRowId,
  date,
  endDate,
  prefilledEvent,
  instanceCounts,
  onClose,
  onCreate,
}: {
  rows: Row[];
  initialRowId: string;
  date: Date;
  endDate?: Date;
  prefilledEvent: EventTypeDef | null;
  instanceCounts: Record<string, number>;
  onClose: () => void;
  onCreate: (bar: Bar) => void;
}) {
  const { t } = useTranslation();

  const initialEnd = endDate ?? addDays(date, 4);
  const [rowId, setRowId] = useState<string>(initialRowId);
  const [start, setStart] = useState<string>(date.toISOString().slice(0, 10));
  const [end, setEnd] = useState<string>(initialEnd.toISOString().slice(0, 10));
  const [tentative, setTentative] = useState(false);
  const [workMode, setWorkMode] = useState<"5" | "6">("6");
  const initCal = Math.max(1, diffDays(date, initialEnd) + 1);
  const initWD = Math.max(1, Math.round((initCal * 6) / 7));
  const [weeks, setWeeks] = useState(Math.floor(initWD / 6));
  const [days, setDays] = useState(initWD % 6);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cashAlert, setCashAlert] = useState(false);
  const [chosen, setChosen] = useState<EventTypeDef | null>(prefilledEvent);

  // Build the unified event catalog from the Timeline Task Dictionary (DB).
  const { rows: dictionary } = useTimelineTaskTypes();
  const allEvents: EventTypeDef[] = useMemo(() => {
    const seen = new Set<string>();
    const list: EventTypeDef[] = [];
    for (const c of dictionary) {
      const key = `${c.code}::${c.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        code: c.code,
        name: c.name,
        bg: c.color,
        phase: c.category ? normalizeMacroPhase(c.category) : inferPhase(c.code),
      });
    }
    return list;
  }, [dictionary]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filt = q
      ? allEvents.filter(
          (e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q),
        )
      : allEvents;
    return filt.reduce<Record<EventPhase, EventTypeDef[]>>(
      (acc, e) => {
        (acc[e.phase] ??= []).push(e);
        return acc;
      },
      {} as Record<EventPhase, EventTypeDef[]>,
    );
  }, [query, allEvents]);

  useEffect(() => {
    if (!dirty) return;
    const perWeek = workMode === "5" ? 5 : 6;
    const workingDays = weeks * perWeek + days;
    const calDays = Math.round((workingDays / perWeek) * 7);
    const s = d(start);
    setEnd(
      addDays(s, Math.max(0, calDays - 1))
        .toISOString()
        .slice(0, 10),
    );
  }, [weeks, days, workMode, start, dirty]);

  const submit = () => {
    if (!chosen) return;
    const id = `b-${Date.now()}`;
    const bar: Bar = {
      id,
      row: rowId,
      kind: inferKind(chosen.code),
      label: chosen.name,
      start,
      end,
      cashAlert: cashAlert || undefined,
    };
    onCreate(bar);
  };

  const PHASE_ORDER: EventPhase[] = [...MACRO_PHASES];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Plus className="size-4 text-brand" />
              {t("production_timeline.create_event")}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {t("production_timeline.target_row_date")}
              <span className="font-medium">{fmt(date)}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Row selector */}
          <div>
            <label className="text-xs text-muted-foreground">
              {t("production_timeline.target_row")}
            </label>
            <select
              value={rowId}
              onChange={(e) => setRowId(e.target.value)}
              className="w-full mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none"
            >
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Unified Event Type dropdown */}
          <div>
            <label className="text-xs text-muted-foreground">
              {t("production_timeline.event_type")}
            </label>
            <div className="relative mt-1">
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2 py-2 text-xs hover:bg-muted"
              >
                {chosen ? (
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className={`${chosen.bg} ${textOnBg(chosen.bg)} w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-extrabold shrink-0 ring-1 ring-border`}
                    >
                      {chosen.code}
                    </span>
                    <span className="truncate font-semibold">{chosen.name}</span>
                    <span className="text-[10px] text-muted-foreground">· {chosen.phase}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Select an event type…</span>
                )}
                <ChevronDown className="size-3.5 opacity-70 shrink-0" />
              </button>
              {pickerOpen && (
                <div className="absolute z-50 mt-1 left-0 right-0 rounded-xl border border-border bg-popover shadow-2xl">
                  <div className="p-2 border-b border-border">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5">
                      <Search className="size-3.5 text-muted-foreground" />
                      <input
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t("production_timeline.search_for_event_types")}
                        className="flex-1 bg-transparent outline-none text-xs"
                      />
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-1">
                    {PHASE_ORDER.map((phase) => {
                      const items = grouped[phase] ?? [];
                      if (!items.length) return null;
                      return (
                        <div key={phase}>
                          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {phase}
                          </div>
                          {items.map((it) => {
                            const count = instanceCounts[it.name] ?? 0;
                            const selected = chosen?.code === it.code && chosen?.name === it.name;
                            return (
                              <button
                                key={`${it.code}-${it.name}`}
                                type="button"
                                onClick={() => {
                                  setChosen(it);
                                  setPickerOpen(false);
                                }}
                                className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-left hover:bg-muted ${selected ? "bg-brand/10" : ""}`}
                              >
                                <span
                                  className={`${it.bg} ${textOnBg(it.bg)} w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-extrabold shrink-0 ring-1 ring-border`}
                                >
                                  {it.code}
                                </span>
                                <span className="flex-1 truncate">{it.name}</span>
                                <span className="text-[10px] rounded-full bg-card dark:bg-surface-2 text-foreground dark:text-foreground px-1.5 py-0.5 min-w-[22px] text-center">
                                  {count}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Start</label>
              <DateInput
                value={start}
                onChange={(v) => setStart(v)}
                className="w-full mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End</label>
              <DateInput
                value={end}
                onChange={(v) => setEnd(v)}
                className="w-full mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={tentative}
              onChange={(e) => setTentative(e.target.checked)}
            />
            {t("production_timeline.dates_are_tentative")}
          </label>

          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {t("production_timeline.working_duration")}
            </div>
            <div className="grid grid-cols-3 gap-2 items-end">
              <div>
                <label className="text-[10px] text-muted-foreground">
                  {t("production_timeline.weeks_w")}
                </label>
                <input
                  type="number"
                  min={0}
                  value={weeks}
                  onChange={(e) => {
                    setDirty(true);
                    setWeeks(Number(e.target.value) || 0);
                  }}
                  className="w-full mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">
                  {t("production_timeline.days_d")}
                </label>
                <input
                  type="number"
                  min={0}
                  value={days}
                  onChange={(e) => {
                    setDirty(true);
                    setDays(Number(e.target.value) || 0);
                  }}
                  className="w-full mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">
                  {t("production_timeline.working_week")}
                </label>
                <select
                  value={workMode}
                  onChange={(e) => setWorkMode(e.target.value as "5" | "6")}
                  className="w-full mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none"
                >
                  <option value="5">5-day work week</option>
                  <option value="6">6-day work week (Saudi)</option>
                </select>
              </div>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={cashAlert}
              onChange={(e) => setCashAlert(e.target.checked)}
            />
            <DollarSign className="size-3.5 text-warning" />
            {t("production_timeline.enable_cash_flow_alert_trigger")}
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!chosen}
            className="rounded-lg bg-brand text-brand-foreground px-3 py-1.5 text-xs font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("production_timeline.create_event")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filters sidebar

function FiltersSidebar({
  filter,
  setFilter,
  onClose,
}: {
  filter: string;
  setFilter: (v: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const basePresets = [
    "All Project Dates",
    "Required Dates",
    ...MACRO_PHASES.map((p) => `${p} only`),
  ];
  const [customPresets, setCustomPresets] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPhase, setDraftPhase] = useState<MacroPhase>(DEFAULT_MACRO_PHASE);
  const presets = [...basePresets, ...customPresets];

  const saveFilter = () => {
    const name = draftName.trim() || `${draftPhase} filter`;
    if (presets.includes(name)) {
      toast.error("A filter with this name already exists.");
      return;
    }
    setCustomPresets((c) => [...c, name]);
    setFilter(name);
    setDraftName("");
    setCreating(false);
    toast.success(`Filter "${name}" created.`);
  };

  const tree: Record<string, string[]> = {
    Development: ["Bible Delivery (3)", "Respect@ HR Training (1)", "Writers' Room (1)"],
    "Soft prep": ["Key Crew Start (2)", "Budget Lock (1)"],
    "Pre-Production": ["Table Read (6)", "Location Scout (4)", "Camera Test (2)"],
    Production: ["Principal Photography (6)", "Reshoots (0)"],
    "Post production": [
      "Editor's Cut (6)",
      "Director's Cut (6)",
      "Sound Edit (6)",
      "Color Grading (6)",
      "VFX Turnover (6)",
      "IMF Delivery (6)",
    ],
    Wrap: ["Asset Return (1)", "Final Cost Report (1)"],
  };
  const [open, setOpen] = useState<Record<string, boolean>>({
    Production: true,
    "Post production": true,
  });

  return (
    <Panel className="p-3 w-full lg:w-72 self-start">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Filter className="size-3.5" /> Filters
        </h4>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="space-y-1 mb-3">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`w-full text-left rounded-lg px-2 py-1.5 text-xs hover:bg-muted ${filter === p ? "bg-brand/15 text-brand-foreground font-semibold" : ""}`}
          >
            {p}
          </button>
        ))}
        {creating ? (
          <div className="rounded-lg border border-border bg-surface p-2 space-y-2">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveFilter();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder={t("production_timeline.create_new_filter")}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand"
            />
            <select
              value={draftPhase}
              onChange={(e) => setDraftPhase(e.target.value as MacroPhase)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
            >
              {MACRO_PHASES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <button
                onClick={saveFilter}
                className="rounded-md bg-brand px-2 py-1 text-xs font-semibold text-brand-foreground"
              >
                {t("common.save", "Save")}
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded-md border border-border px-2 py-1 text-xs"
              >
                {t("common.cancel", "Cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="w-full text-left rounded-lg px-2 py-1.5 text-xs text-brand hover:bg-muted flex items-center gap-1.5"
          >
            <Plus className="size-3" />
            {t("production_timeline.create_new_filter")}
          </button>
        )}
      </div>
      <div className="border-t border-border pt-2">
        <h5 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          {t("production_timeline.phase_tree")}
        </h5>
        {Object.entries(tree).map(([phase, items]) => (
          <div key={phase} className="text-xs">
            <button
              onClick={() => setOpen((o) => ({ ...o, [phase]: !o[phase] }))}
              className="w-full flex items-center justify-between rounded px-1 py-1 hover:bg-muted"
            >
              <span className="flex items-center gap-1 font-medium">
                {open[phase] ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {phase}
              </span>
              <span className="text-muted-foreground">{items.length}</span>
            </button>
            {open[phase] && (
              <ul className="ms-4 my-1 space-y-0.5 text-muted-foreground">
                {items.map((it) => (
                  <li key={it} className="px-1 py-0.5 rounded hover:bg-muted cursor-pointer">
                    {it}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial alerts

function FinancialAlerts() {
  const { t } = useTranslation();

  const alerts = [
    {
      tone: "amber",
      icon: AlertTriangle,
      msg: "WARNING: Pre-Production is scheduled to start in 5 days (Jul 20). Ensure Saudi bank balance covers the 1st week of crew payroll/advances.",
    },
    {
      tone: "sky",
      icon: DollarSign,
      msg: "INFO: Principal Photography (Ep 101) triggers a projected SAR 1.2M cash outflow between Oct 25 – Nov 05.",
    },
    {
      tone: "rose",
      icon: AlertTriangle,
      msg: "ALERT: VFX Turnover (Ep 101, Dec 22) coincides with Eid Holiday buffer — confirm vendor availability.",
    },
  ];
  const tones: Record<string, string> = {
    amber: "border-warning/30 bg-warning/10 text-warning",
    sky: "border-info/30 bg-info/10 text-info",
    rose: "border-destructive/30 bg-destructive/10 text-destructive",
  };
  return (
    <Panel className="p-3 mt-3">
      <div className="flex items-center gap-2 mb-2">
        <DollarSign className="size-4 text-warning" />
        <h4 className="text-sm font-semibold">{t("production_timeline.financial_alerts_queue")}</h4>
        <span className="text-[10px] text-muted-foreground">(mock reactive alerts)</span>
      </div>
      <ul className="space-y-1.5">
        {alerts.map((a, i) => (
          <li
            key={i}
            className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${tones[a.tone]}`}
          >
            <a.icon className="size-3.5 shrink-0 mt-0.5" />
            <span>{a.msg}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bottom drawer

type DrawerCard = {
  name: string;
  jumpName?: string;
  done: number;
  required: number;
  code: string;
  bg: string;
  instancesLabel?: string;
};
type DrawerFilter = "all" | "required" | "prod" | "post" | "vfx";

/** Map a dictionary row (managed in Settings → Timeline Task Dictionary) to a bank card. */
function toDrawerCard(t: TimelineTaskType): DrawerCard {
  return {
    name: t.name,
    done: 0,
    required: t.requiredCount,
    code: t.code,
    bg: t.color,
  };
}

function AllProjectDatesDrawer({
  onClose,
  onSelectCard,
  counts,
}: {
  onClose: () => void;
  onSelectCard: (card: DrawerCard) => void;
  /** Live instance count per event name in THIS project's timeline. */
  counts: Record<string, number>;
}) {
  const { t } = useTranslation();
  const { rows: taskTypes, loading: taskTypesLoading } = useTimelineTaskTypes();
  const taskCards: DrawerCard[] = useMemo(() => taskTypes.map(toDrawerCard), [taskTypes]);

  const [height, setHeight] = useState<number>(320);
  const [filter, setFilter] = useState<DrawerFilter>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const resizing = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const next = Math.max(160, Math.min(550, window.innerHeight - e.clientY));
      setHeight(next);
    };
    const onUp = () => {
      resizing.current = false;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const flat = taskCards;
  const filtered = useMemo(() => {
    const chunk = (list: DrawerCard[]) => {
      const out: DrawerCard[][] = [];
      for (let i = 0; i < list.length; i += 9) out.push(list.slice(i, i + 9));
      return out;
    };
    if (filter === "required") return chunk(flat.filter((c) => c.required > 0));
    if (filter === "prod")
      return chunk(
        flat.filter((c) =>
          /Photography|Table Read|Tech Scout|Production|Wrap|Meeting/i.test(c.name),
        ),
      );
    if (filter === "post")
      return chunk(
        flat.filter((c) =>
          /Cut|Color|Mix|Sound|IMF|Conform|Master|M&E|Netflix|Picture Lock|Editor/i.test(c.name),
        ),
      );
    if (filter === "vfx") return chunk(flat.filter((c) => /VFX/i.test(c.name)));
    return chunk(flat);
  }, [filter, flat]);

  const filterLabel: Record<DrawerFilter, string> = {
    all: "All Project Dates",
    required: "Required Dates",
    prod: "Production (Series)",
    post: "Post Production (Series)",
    vfx: "VFX (Series)",
  };

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-40 border-t border-border dark:border-border bg-card dark:bg-card text-foreground dark:text-white shadow-2xl"
      style={{ height }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={(e) => {
          resizing.current = true;
          document.body.style.cursor = "ns-resize";
          e.preventDefault();
        }}
        className="absolute top-0 left-0 right-0 h-2 -translate-y-1/2 flex items-center justify-center cursor-ns-resize group"
      >
        <div className="h-1 w-24 rounded-full bg-card dark:bg-surface-2 group-hover:bg-brand transition" />
        <GripHorizontal className="absolute size-3.5 text-foreground dark:text-muted-foreground group-hover:text-brand" />
      </div>

      <div className="h-full flex flex-col">
        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border dark:border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-foreground dark:text-white hover:bg-card dark:hover:bg-muted"
              >
                <Calendar className="size-4 text-brand" />
                {filterLabel[filter]}
                <ChevronDown className="size-3.5 opacity-70" />
              </button>
              {menuOpen && (
                <div className="absolute z-50 mt-1 w-64 rounded-xl border border-border dark:border-border bg-popover text-popover-foreground shadow-2xl p-1.5">
                  {(
                    [
                      ["all", "All Project Dates"],
                      ["required", "Required Dates"],
                    ] as [DrawerFilter, string][]
                  ).map(([k, lbl]) => (
                    <button
                      key={k}
                      onClick={() => {
                        setFilter(k);
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-card dark:hover:bg-muted text-left"
                    >
                      {filter === k ? (
                        <CheckCircle2 className="size-3.5 text-brand" />
                      ) : (
                        <span className="size-3.5" />
                      )}
                      {lbl}
                    </button>
                  ))}
                  <div className="my-1 border-t border-border dark:border-border" />
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("production_timeline.preset_filters")}
                  </div>
                  {(
                    [
                      ["prod", "Production (Series)"],
                      ["post", "Post Production (Series)"],
                      ["vfx", "VFX (Series)"],
                    ] as [DrawerFilter, string][]
                  ).map(([k, lbl]) => (
                    <button
                      key={k}
                      onClick={() => {
                        setFilter(k);
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-card dark:hover:bg-muted text-left"
                    >
                      {filter === k ? (
                        <CheckCircle2 className="size-3.5 text-brand" />
                      ) : (
                        <span className="size-3.5" />
                      )}
                      {lbl}
                    </button>
                  ))}
                  <div className="my-1 border-t border-border dark:border-border" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      toast.info(
                        "Create custom filters from the Filters panel in the timeline header.",
                      );
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-brand hover:bg-card dark:hover:bg-muted"
                  >
                    <Plus className="size-3.5" />
                    {t("production_timeline.create_new_filter")}
                  </button>
                </div>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground dark:text-muted-foreground truncate">
              {t("production_timeline.click_or_drag_the_dates_onto_the_schedule")}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-card dark:hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        {/* Scrollable cards grid */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {taskTypesLoading && (
            <div className="p-4 text-xs text-muted-foreground">Loading task dictionary…</div>
          )}
          {!taskTypesLoading && filtered.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">
              No task cards defined. Add them in Settings → Timeline Task Dictionary.
            </div>
          )}
          {filtered.map((row, ri) => (
            <div
              key={ri}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-9 gap-2"
            >
              {row.map((rawCard, i) => {
                const done = counts[rawCard.jumpName ?? rawCard.name] ?? 0;
                const c: DrawerCard = {
                  ...rawCard,
                  done,
                  instancesLabel: `${done} instance${done === 1 ? "" : "s"}`,
                };
                const complete = c.required > 0 && c.done >= c.required;
                return (
                  <BankCard
                    key={`${ri}-${i}-${c.name}`}
                    card={c}
                    complete={complete}
                    onSelect={() => onSelectCard(c)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A draggable event-type card in the bottom bank. */
function BankCard({
  card: c,
  complete,
  onSelect,
}: {
  card: DrawerCard;
  complete: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `bank:${c.code}:${c.name}`,
    data: { card: c },
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={onSelect}
      style={{ opacity: isDragging ? 0.4 : undefined }}
      className={`flex items-center gap-2 rounded-lg border border-border dark:border-border bg-surface-2 dark:bg-card p-1.5 text-start transition hover:bg-surface-2 dark:hover:bg-card hover:border-border dark:hover:border-border cursor-pointer`}
      title={`Add ${c.name} to schedule`}
    >
      <div
        className={`${c.bg} ${textOnBg(c.bg)} w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 shadow-md ring-1 ring-border`}
      >
        {c.code}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-foreground dark:text-white truncate leading-tight">
          {c.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px]">
          {c.required > 0 ? (
            complete ? (
              <span className="text-success dark:text-success flex items-center gap-1">
                <CheckCircle2 className="size-3" /> {c.done} of {c.required} required
              </span>
            ) : (
              <span className="text-warning dark:text-warning flex items-center gap-1">
                <Clock className="size-3" /> {c.done} of {c.required} required
              </span>
            )
          ) : (
            <span className="text-foreground dark:text-muted-foreground flex items-center gap-1">
              <Archive className="size-3" /> {c.instancesLabel ?? `${c.done} instances`}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
