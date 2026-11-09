// Production Timeline — downloadable Excel template.
//
// The client fills it outside the system and uploads it back through
// "Import from Excel" (src/lib/timeline-import.ts reads it). The "Task List"
// columns match the client's own planning workbook:
//   Track | Task | Code | Kind | Start | End | Days | Notes
//
// The workbook content is deliberately bilingual (EN + AR in the same file),
// so it does not follow the UI language.

import type ExcelJSNS from "exceljs";
import { BAR_KINDS, MILESTONE_KINDS } from "@/lib/timeline-import";
import type { ImportDictionaryEntry, ImportRowRef } from "@/lib/timeline-import";

type ExcelJsModule = typeof ExcelJSNS;

export const TEMPLATE_HEADERS = ["Track", "Task", "Code", "Kind", "Start", "End", "Days", "Notes"];
export const TEMPLATE_INPUT_ROWS = 1000;

const KIND_HELP: Record<string, { en: string; ar: string; milestone: boolean }> = {
  shoot: { en: "Shooting / principal photography", ar: "التصوير", milestone: false },
  editors: { en: "Editor's cut", ar: "نسخة المونتير", milestone: false },
  directors: { en: "Director's cut", ar: "نسخة المخرج", milestone: false },
  sound: { en: "Sound edit / mix", ar: "الصوت والمكساج", milestone: false },
  color: { en: "Colour grading", ar: "تصحيح الألوان", milestone: false },
  prep: {
    en: "Preparation / general task (default)",
    ar: "تحضير / مهمة عامة (الافتراضي)",
    milestone: false,
  },
  vfx: { en: "Milestone — VFX turnover", ar: "معلم — تسليم المؤثرات البصرية", milestone: true },
  imf: { en: "Milestone — IMF delivery", ar: "معلم — تسليم IMF", milestone: true },
  holiday: { en: "Milestone — holiday", ar: "معلم — عطلة", milestone: true },
  bible: { en: "Milestone — bible delivery", ar: "معلم — تسليم البايبل", milestone: true },
  delivery: { en: "Milestone — delivery", ar: "معلم — تسليم", milestone: true },
};

const HEADER_FILL: ExcelJSNS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF1F2F4" },
};
const EXAMPLE_FILL: ExcelJSNS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFF7E0" },
};

function excelDate(iso: string): Date {
  // ExcelJS stores a Date as its UTC calendar day.
  return new Date(Date.parse(iso + "T00:00:00Z"));
}

function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
}

export type TemplateContext = {
  projectName: string;
  /** The timeline's tracks as shown on screen (film phases or series rows). */
  rows: ImportRowRef[];
  dictionary: ImportDictionaryEntry[];
  /** First example date (defaults to today). */
  today?: string;
};

export function buildTimelineTemplateWorkbook(
  ExcelJS: ExcelJsModule,
  ctx: TemplateContext,
): ExcelJSNS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kwalis HUB";
  wb.created = new Date();

  const tracks = ctx.rows.map((r) => r.label);
  const kinds = [...BAR_KINDS, ...MILESTONE_KINDS] as string[];
  const codes = ctx.dictionary.filter((d) => d.code).sort((a, b) => a.code.localeCompare(b.code));

  /* ── Task List ─────────────────────────────────────────────────────── */
  const ws = wb.addWorksheet("Task List", {
    views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
  });
  const widths = [22, 40, 10, 12, 14, 14, 8, 40];
  ws.columns = TEMPLATE_HEADERS.map((h, i) => ({
    header: h,
    key: h.toLowerCase(),
    width: widths[i],
  }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
  head.height = 20;

  const first = ctx.today ?? new Date().toISOString().slice(0, 10);
  const prepTrack = ctx.rows.find((r) => r.id === "prep") ?? ctx.rows[0];
  const shootTrack = ctx.rows.find((r) => r.id === "shoot") ?? ctx.rows[0];
  const shootCode = codes.find((c) => c.code === "PP");
  const examples: (string | number | Date)[][] = [
    [
      prepTrack?.label ?? "",
      "[Example] Location scout",
      "",
      "prep",
      excelDate(first),
      excelDate(addDaysIso(first, 4)),
      5,
      "EXAMPLE row — delete or overwrite it / صف مثال — احذفه أو اكتب فوقه",
    ],
    [
      shootTrack?.label ?? "",
      `[Example] ${shootCode?.name ?? "Principal Photography"}`,
      shootCode?.code ?? "",
      "shoot",
      excelDate(addDaysIso(first, 14)),
      excelDate(addDaysIso(first, 43)),
      30,
      "EXAMPLE row — delete or overwrite it / صف مثال — احذفه أو اكتب فوقه",
    ],
    [
      shootTrack?.label ?? "",
      "[Example] Delivery",
      "",
      "delivery",
      excelDate(addDaysIso(first, 60)),
      "",
      "",
      "EXAMPLE milestone (one date) / مثال لمعلم (تاريخ واحد)",
    ],
  ];
  examples.forEach((values) => {
    const row = ws.addRow(values);
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col <= TEMPLATE_HEADERS.length) c.fill = EXAMPLE_FILL;
    });
    row.font = { italic: true, color: { argb: "FF6B7280" } };
  });

  /* ── Lists (validation sources) ────────────────────────────────────── */
  const lists = wb.addWorksheet("Lists", { state: "hidden" });
  lists.getCell(1, 1).value = "Track";
  lists.getCell(1, 2).value = "Kind";
  tracks.forEach((t, i) => (lists.getCell(i + 2, 1).value = t));
  kinds.forEach((k, i) => (lists.getCell(i + 2, 2).value = k));

  /* ── Task Dictionary (visible reference + Code list) ───────────────── */
  const dict = wb.addWorksheet("Task Dictionary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  dict.columns = [
    { header: "Code", key: "code", width: 10 },
    { header: "Task", key: "name", width: 40 },
    { header: "Track", key: "track", width: 22 },
  ];
  dict.getRow(1).font = { bold: true };
  dict.getRow(1).eachCell((c) => (c.fill = HEADER_FILL));
  codes.forEach((d) => dict.addRow([d.code, d.name, d.category ?? ""]));

  const lastRow = TEMPLATE_INPUT_ROWS + 1;
  for (let r = 2; r <= lastRow; r += 1) {
    if (tracks.length)
      ws.getCell(r, 1).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`Lists!$A$2:$A$${tracks.length + 1}`],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Track",
        error: "Pick a track from the list / اختر مساراً من القائمة",
      };
    if (codes.length)
      ws.getCell(r, 3).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`'Task Dictionary'!$A$2:$A$${codes.length + 1}`],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Code",
        error: "Code not in the task dictionary / الرمز غير موجود في قاموس المهام",
      };
    ws.getCell(r, 4).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`Lists!$B$2:$B$${kinds.length + 1}`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Kind",
      error: "Pick a kind from the list / اختر نوعاً من القائمة",
    };
    for (const col of [5, 6]) {
      const c = ws.getCell(r, col);
      c.numFmt = "dd mmm yyyy";
      c.dataValidation = {
        type: "date",
        operator: "greaterThan",
        allowBlank: true,
        formulae: [new Date(Date.UTC(1999, 11, 31))],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: col === 5 ? "Start" : "End",
        error: "Enter a date / أدخل تاريخاً",
      };
    }
    ws.getCell(r, 7).dataValidation = {
      type: "whole",
      operator: "greaterThanOrEqual",
      allowBlank: true,
      formulae: [1],
      showErrorMessage: true,
      errorStyle: "stop",
      error: "Whole number of days (1 or more) / عدد أيام صحيح (1 أو أكثر)",
    };
  }

  /* ── Instructions ──────────────────────────────────────────────────── */
  const ins = wb.addWorksheet("Instructions", {
    views: [{ showGridLines: false }],
  });
  ins.columns = [
    { key: "en", width: 70 },
    { key: "ar", width: 70 },
  ];
  const line = (en: string, ar: string, bold = false) => {
    const row = ins.addRow([en, ar]);
    row.alignment = { wrapText: true, vertical: "top" };
    row.getCell(2).alignment = {
      wrapText: true,
      vertical: "top",
      horizontal: "right",
      readingOrder: "rtl",
    };
    if (bold) row.font = { bold: true, size: 12 };
  };
  line(
    `${ctx.projectName} — Production Timeline template`,
    `${ctx.projectName} — قالب الجدول الزمني للإنتاج`,
    true,
  );
  line("", "");
  line("How to use", "طريقة الاستخدام", true);
  line(
    '1. Fill one row per task on the "Task List" sheet. Do not rename the sheet or the header row.',
    '1. اكتب صفاً واحداً لكل مهمة في ورقة "Task List". لا تغيّر اسم الورقة ولا صف العناوين.',
  );
  line(
    "2. The yellow rows starting with [Example] are examples. They are ignored on import — delete them or overwrite them.",
    "2. الصفوف الصفراء التي تبدأ بـ [Example] أمثلة فقط ويتم تجاهلها عند الاستيراد — احذفها أو اكتب فوقها.",
  );
  line(
    "3. In the system open Production Timeline → Import from Excel, choose this file, check the preview and confirm.",
    "3. في النظام افتح الجدول الزمني للإنتاج ← استيراد من Excel، اختر هذا الملف، راجع المعاينة ثم أكّد.",
  );
  line(
    "4. The import goes into the draft that is open on screen. Approved / pending versions cannot be imported into.",
    "4. يتم الاستيراد إلى المسودة المفتوحة على الشاشة. لا يمكن الاستيراد إلى نسخة معتمدة أو بانتظار الاعتماد.",
  );
  line(
    "5. The same import also reads the Excel files exported from the timeline (Excel button), so you can export, edit and re-import.",
    "5. نفس الاستيراد يقرأ ملفات Excel المصدّرة من الجدول الزمني (زر Excel)، فيمكنك التصدير ثم التعديل ثم إعادة الاستيراد.",
  );
  line("", "");
  line("Columns", "الأعمدة", true);
  line(
    "Track — the timeline track (pick from the list). Unknown tracks go to the default track and are flagged.",
    "المسار — مسار الجدول الزمني (اختر من القائمة). المسار غير المعروف يوضع في المسار الافتراضي مع تنبيه.",
  );
  line(
    "Task — the task name shown on the bar. Required (or give a Code from the dictionary).",
    "المهمة — اسم المهمة الظاهر على الشريط. إلزامي (أو اكتب رمزاً من قاموس المهام).",
  );
  line(
    'Code — optional task-dictionary code (see the "Task Dictionary" sheet). It fills the task name and kind when they are empty.',
    'الرمز — رمز اختياري من قاموس المهام (انظر ورقة "Task Dictionary"). يملأ اسم المهمة والنوع إذا كانا فارغين.',
  );
  line(
    "Kind — the bar type (colour) or a milestone type. Empty = prep, or the kind of the dictionary code.",
    "النوع — نوع الشريط (اللون) أو نوع المعلم. فارغ = prep أو نوع رمز القاموس.",
  );
  line("Start — required. A real Excel date.", "البداية — إلزامي. تاريخ Excel حقيقي.");
  line(
    "End — a real Excel date. If empty, End = Start + Days − 1 (or Start when Days is empty).",
    "النهاية — تاريخ Excel حقيقي. إذا كان فارغاً: النهاية = البداية + الأيام − 1 (أو البداية إذا كانت الأيام فارغة).",
  );
  line(
    "Days — optional duration, used only when End is empty.",
    "الأيام — مدة اختيارية، تُستخدم فقط عندما تكون النهاية فارغة.",
  );
  line(
    "Notes — for your own use. Notes are not stored in the timeline.",
    "ملاحظات — لاستخدامك الخاص. لا تُحفظ الملاحظات في الجدول الزمني.",
  );
  line("", "");
  line("Kinds", "الأنواع", true);
  for (const k of kinds) line(`${k} — ${KIND_HELP[k].en}`, `${k} — ${KIND_HELP[k].ar}`);
  line("", "");
  line(
    "Milestones (vfx, imf, holiday, bible, delivery) use the Start date only.",
    "المعالم (vfx, imf, holiday, bible, delivery) تستخدم تاريخ البداية فقط.",
  );
  line("", "");
  line("Tracks in this project", "المسارات في هذا المشروع", true);
  for (const r of ctx.rows) line(r.label, r.ar ?? r.label);

  // Task List first and active.
  wb.views = [
    { x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: "visible" },
  ];
  return wb;
}
