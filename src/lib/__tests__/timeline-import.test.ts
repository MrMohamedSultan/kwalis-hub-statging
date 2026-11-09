import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

import {
  applyImportPlan,
  excelSerialToIso,
  isoToExcelSerial,
  locateTaskTable,
  mapImportRows,
  parseImportDate,
  planTimelineImport,
  readTaskRows,
  workbookToGrids,
  type ImportRowRef,
  type SheetGrid,
} from "@/lib/timeline-import";
import { buildTimelineTemplateWorkbook } from "@/lib/timeline-template";
import { buildTimelineRows, buildTimelineSheetAoa } from "@/lib/timeline-export";
import { buildTimelineWorkbook } from "@/features/timeline/export/ganttExcelExport";
import { toGanttTasks } from "@/features/timeline/export/toGanttTasks";
import { MACRO_PHASES, MACRO_PHASE_AR, MACRO_PHASE_ID, phaseOfLaneId } from "@/lib/timeline-phases";
import type { Bar, Milestone } from "@/lib/timeline-store";

const ROWS: ImportRowRef[] = MACRO_PHASES.map((p) => ({
  id: MACRO_PHASE_ID[p],
  label: p,
  ar: MACRO_PHASE_AR[p],
}));

const DICT = [
  { code: "PP", name: "Principal Photography", category: "Production" },
  { code: "EC", name: "Editor's Cut", category: "Post production" },
  { code: "SD1", name: "Script Draft 1", category: "Development" },
];

const BARS: Bar[] = [
  {
    id: "b1",
    row: "prep",
    kind: "prep",
    label: "Location Scout",
    start: "2026-03-01",
    end: "2026-03-05",
  },
  {
    id: "b2",
    row: "shoot",
    kind: "shoot",
    label: "Principal Photography",
    start: "2026-04-01",
    end: "2026-05-15",
  },
  {
    id: "b3",
    row: "post",
    kind: "editors",
    label: "Editor's Cut",
    start: "2026-05-20",
    end: "2026-06-30",
  },
  {
    id: "b4",
    row: "development",
    kind: "prep",
    label: "Script Draft 1",
    start: "2026-01-10",
    end: "2026-01-31",
  },
  {
    id: "b5",
    row: "post",
    kind: "color",
    label: "Color Grading",
    start: "2026-07-01",
    end: "2026-07-01",
  },
];
const MILESTONES: Milestone[] = [
  { id: "m1", row: "post", kind: "vfx", label: "VFX Turnover", date: "2026-06-01" },
  { id: "m2", row: "wrap", kind: "delivery", label: "Final Delivery", date: "2026-08-15" },
];

const comparable = (bars: Bar[], ms: Milestone[]) => ({
  bars: bars
    .map(({ row, kind, label, start, end }) => ({ row, kind, label, start, end }))
    .sort((a, b) => a.label.localeCompare(b.label)),
  milestones: ms
    .map(({ row, kind, label, date }) => ({ row, kind, label, date }))
    .sort((a, b) => a.label.localeCompare(b.label)),
});

async function excelJsToGrids(wb: ExcelJS.Workbook): Promise<SheetGrid[]> {
  const buf = await wb.xlsx.writeBuffer();
  return workbookToGrids(XLSX, new Uint8Array(buf as ArrayBuffer));
}

describe("dates", () => {
  it("converts Excel serials both ways", () => {
    expect(excelSerialToIso(46082)).toBe("2026-03-01");
    expect(isoToExcelSerial("2026-03-01")).toBe(46082);
  });
  it("parses the usual text formats", () => {
    expect(parseImportDate("2026-03-05")).toBe("2026-03-05");
    expect(parseImportDate("05/03/2026")).toBe("2026-03-05");
    expect(parseImportDate("05 Mar 2026")).toBe("2026-03-05");
    expect(parseImportDate("Mar 5, 2026")).toBe("2026-03-05");
    expect(parseImportDate(new Date(Date.UTC(2026, 2, 5)))).toBe("2026-03-05");
    expect(parseImportDate("31/02/2026")).toBeNull();
    expect(parseImportDate("soon")).toBeNull();
    expect(parseImportDate("")).toBeNull();
  });
});

describe("header detection", () => {
  it("finds the header below branding rows and prefers the Task List sheet", () => {
    const sheets: SheetGrid[] = [
      { name: "Track View", rows: [["x"]] },
      {
        name: "Task List",
        rows: [
          ["Company"],
          ["Project"],
          [],
          ["Track", "Task", "Code", "Kind", "Start", "End", "Days", "Notes"],
        ],
      },
    ];
    const t = locateTaskTable(sheets)!;
    expect(t.sheetName).toBe("Task List");
    expect(t.headerRowIndex).toBe(3);
    expect(t.layout).toBe("template");
  });
  it("reads Arabic Gantt headers", () => {
    const t = locateTaskTable([
      {
        name: "قائمة المهام",
        rows: [
          ["عنوان"],
          ["meta"],
          ["المسار", "المهمة", "الرمز", "النوع", "البداية", "النهاية", "الأيام", "مصدر اللون"],
        ],
      },
    ])!;
    expect(t.layout).toBe("gantt");
    expect(t.columns.start).toBe(4);
  });
  it("reports a file with no task table", () => {
    expect(readTaskRows([{ name: "Sheet1", rows: [["hello"]] }])).toEqual({
      ok: false,
      error: "no_task_table",
    });
  });
});

describe("row mapping", () => {
  const raw = (over: Partial<Parameters<typeof mapImportRows>[0][number]>) => ({
    line: 2,
    track: "Production",
    phase: "",
    task: "Shoot",
    code: "",
    kind: "",
    start: "2026-04-01",
    end: "2026-04-10",
    days: "",
    notes: "",
    ...over,
  });
  let n = 0;
  const ctx = { rows: ROWS, dictionary: DICT, newId: () => `id${(n += 1)}` };

  it("flags problems and maps defaults", () => {
    const plan = mapImportRows(
      [
        raw({ line: 2 }),
        raw({ line: 3, start: "", task: "No start" }),
        raw({ line: 4, start: "2026-04-10", end: "2026-04-01", task: "Backwards" }),
        raw({ line: 5, track: "Mars", task: "Unknown track" }),
        raw({ line: 6, kind: "teleport", task: "Unknown kind" }),
        raw({ line: 7, task: "", code: "EC", track: "" }),
        raw({ line: 8, task: "[Example] Location scout" }),
        raw({ line: 9, end: "", days: 5, task: "By days" }),
        raw({ line: 10, kind: "delivery", end: "2026-04-03", task: "Ship" }),
        raw({ line: 11, start: "next week", task: "Bad date" }),
      ],
      ctx,
    );
    const byLine = new Map(plan.preview.map((p) => [p.line, p]));
    const codes = (l: number) => byLine.get(l)!.issues.map((i) => i.code);

    expect(byLine.get(2)!.issues).toEqual([]);
    expect(codes(3)).toEqual(["missing_start"]);
    expect(byLine.get(3)!.skipped).toBe(true);
    expect(codes(4)).toContain("end_before_start");
    expect(byLine.get(4)!.end).toBe("2026-04-10");
    expect(codes(5)).toContain("unknown_track");
    expect(byLine.get(5)!.rowId).toBe("prep");
    expect(codes(6)).toContain("unknown_kind");
    expect(byLine.get(6)!.kind).toBe("prep");
    // Code fills the task name, kind and track from the dictionary.
    expect(byLine.get(7)!.label).toBe("Editor's Cut");
    expect(byLine.get(7)!.kind).toBe("editors");
    expect(byLine.get(7)!.rowId).toBe("post");
    expect(byLine.get(7)!.skipped).toBe(false);
    expect(codes(8)).toEqual(["example_row"]);
    expect(byLine.get(9)!.end).toBe("2026-04-05");
    expect(byLine.get(10)!.isMilestone).toBe(true);
    expect(codes(10)).toContain("milestone_range");
    expect(codes(11)).toEqual(["invalid_start"]);

    expect(plan.counts).toEqual({ read: 10, imported: 7, withWarnings: 4, skipped: 3 });
    expect(plan.bars).toHaveLength(6);
    expect(plan.milestones).toEqual([
      { id: expect.any(String), row: "shoot", kind: "delivery", label: "Ship", date: "2026-04-01" },
    ]);
  });

  it("resolves tracks by id, label, Arabic and legacy names", () => {
    const plan = mapImportRows(
      [
        raw({ track: "shoot" }),
        raw({ track: "الإنتاج" }),
        raw({ track: "PRODUCTION" }),
        raw({ track: "post-production" }),
        raw({ track: "pre-production" }),
      ],
      ctx,
    );
    expect(plan.preview.map((p) => p.rowId)).toEqual(["shoot", "shoot", "shoot", "post", "prep"]);
    expect(plan.preview.every((p) => p.issues.length === 0)).toBe(true);
  });

  it("append keeps the schedule, replace swaps it", () => {
    const snap = { bars: BARS, milestones: MILESTONES, versions: [] };
    const plan = { bars: [BARS[0]], milestones: [] };
    expect(applyImportPlan(snap, plan, "append").bars).toHaveLength(BARS.length + 1);
    const replaced = applyImportPlan(snap, plan, "replace");
    expect(replaced.bars).toEqual([BARS[0]]);
    expect(replaced.milestones).toEqual([]);
    expect(replaced.versions).toBe(snap.versions);
  });
});

describe("round trip", () => {
  it("Gantt export (English) → import gives the same bars and milestones", async () => {
    const { tasks, rows } = toGanttTasks({
      bars: BARS,
      milestones: MILESTONES,
      rows: ROWS,
      cards: DICT.map((d, i) => ({
        id: `c${i}`,
        name: d.name,
        code: d.code,
        bg: "bg-info",
        required: 0,
        done: 0,
        category: d.category,
      })),
    });
    const { workbook } = await buildTimelineWorkbook({
      projectName: "Film",
      tasks,
      rows,
      locale: "en",
    });
    const res = planTimelineImport(await excelJsToGrids(workbook), {
      rows: ROWS,
      dictionary: DICT,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.layout).toBe("gantt");
    expect(res.plan.counts.skipped).toBe(0);
    expect(res.plan.preview.flatMap((p) => p.issues)).toEqual([]);
    expect(comparable(res.plan.bars, res.plan.milestones)).toEqual(comparable(BARS, MILESTONES));
  });

  it("Gantt export (Arabic, RTL) → import gives the same bars and milestones", async () => {
    const { tasks, rows } = toGanttTasks({
      bars: BARS,
      milestones: MILESTONES,
      rows: ROWS,
      cards: [],
    });
    const { workbook } = await buildTimelineWorkbook({
      projectName: "فيلم",
      tasks,
      rows,
      locale: "ar",
      rtl: true,
    });
    const res = planTimelineImport(await excelJsToGrids(workbook), {
      rows: ROWS,
      dictionary: DICT,
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.sheetName).toBe("قائمة المهام");
    expect(comparable(res.plan.bars, res.plan.milestones)).toEqual(comparable(BARS, MILESTONES));
  });

  it("Draft export layout → import keeps labels, dates, lanes and inferable kinds", () => {
    const KIND_PHASE: Record<string, (typeof MACRO_PHASES)[number]> = { prep: "Pre-Production" };
    const exportRows = buildTimelineRows(
      BARS,
      MILESTONES,
      ROWS,
      (b) => phaseOfLaneId(b.row) ?? KIND_PHASE[b.kind],
    );
    const aoa = buildTimelineSheetAoa(exportRows, { projectName: "Film", versionLabel: "v2" });
    // the branding writer adds rows above the table — the header is found anyway
    const grids: SheetGrid[] = [{ name: "Timeline", rows: [["Company"], ["Project"], ...aoa] }];
    const res = planTimelineImport(grids, { rows: ROWS, dictionary: DICT });
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.layout).toBe("draft");
    expect(res.plan.counts.skipped).toBe(0);
    const got = comparable(res.plan.bars, res.plan.milestones);
    const want = comparable(BARS, MILESTONES);
    // The draft layout has no Kind column: bar kinds come from the dictionary
    // code (PP→shoot, EC→editors) or fall back to prep; milestone kinds from the label.
    expect(got.milestones).toEqual(want.milestones);
    expect(got.bars.map(({ kind: _k, ...rest }) => rest)).toEqual(
      want.bars.map(({ kind: _k, ...rest }) => rest),
    );
    const kinds = Object.fromEntries(got.bars.map((b) => [b.label, b.kind]));
    expect(kinds["Principal Photography"]).toBe("shoot");
    expect(kinds["Editor's Cut"]).toBe("editors");
    expect(kinds["Location Scout"]).toBe("prep");
  });

  it("an empty draft export imports nothing and flags its placeholder row", () => {
    const aoa = buildTimelineSheetAoa([], { projectName: "Film", versionLabel: "v1" });
    const res = planTimelineImport([{ name: "Timeline", rows: aoa }], { rows: ROWS });
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.counts.imported).toBe(0);
    expect(res.plan.preview[0].issues.map((i) => i.code)).toContain("placeholder_row");
  });

  it("template: examples are skipped, filled rows import, validations exist", async () => {
    const wb = buildTimelineTemplateWorkbook(ExcelJS, {
      projectName: "Film",
      rows: ROWS,
      dictionary: DICT,
      today: "2026-03-01",
    });
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Task List",
      "Lists",
      "Task Dictionary",
      "Instructions",
    ]);
    const ws = wb.getWorksheet("Task List")!;
    expect(ws.getRow(1).values).toEqual([
      undefined,
      "Track",
      "Task",
      "Code",
      "Kind",
      "Start",
      "End",
      "Days",
      "Notes",
    ]);
    expect(ws.getCell("A10").dataValidation?.formulae).toEqual(["Lists!$A$2:$A$7"]);
    expect(ws.getCell("C10").dataValidation?.formulae).toEqual(["'Task Dictionary'!$A$2:$A$4"]);
    expect(ws.getCell("E10").dataValidation?.type).toBe("date");

    // Untouched template → only example rows, all skipped.
    const blank = planTimelineImport(await excelJsToGrids(wb), { rows: ROWS, dictionary: DICT });
    if (!blank.ok) throw new Error(blank.error);
    expect(blank.plan.layout).toBe("template");
    expect(blank.plan.counts).toMatchObject({ read: 3, imported: 0, skipped: 3 });

    // The user fills a few rows below the examples (real Excel dates).
    const put = (r: number, v: unknown[]) =>
      v.forEach((x, i) => (ws.getCell(r, i + 1).value = x as ExcelJS.CellValue));
    put(5, [
      "Production",
      "Principal Photography",
      "PP",
      "shoot",
      new Date(Date.UTC(2026, 3, 1)),
      new Date(Date.UTC(2026, 4, 15)),
      45,
      "main unit",
    ]);
    put(6, ["Post production", "", "EC", "", new Date(Date.UTC(2026, 4, 20)), "", 42, ""]);
    put(7, ["Wrap", "Final Delivery", "", "delivery", new Date(Date.UTC(2026, 7, 15)), "", "", ""]);
    const filled = planTimelineImport(await excelJsToGrids(wb), { rows: ROWS, dictionary: DICT });
    if (!filled.ok) throw new Error(filled.error);
    expect(filled.plan.counts).toMatchObject({ read: 6, imported: 3, skipped: 3, withWarnings: 0 });
    expect(comparable(filled.plan.bars, filled.plan.milestones)).toEqual({
      bars: [
        {
          row: "post",
          kind: "editors",
          label: "Editor's Cut",
          start: "2026-05-20",
          end: "2026-06-30",
        },
        {
          row: "shoot",
          kind: "shoot",
          label: "Principal Photography",
          start: "2026-04-01",
          end: "2026-05-15",
        },
      ],
      milestones: [{ row: "wrap", kind: "delivery", label: "Final Delivery", date: "2026-08-15" }],
    });
  });
});
