import { describe, expect, it } from "vitest";
import type ExcelJS from "exceljs";
import { loadExcelJs } from "@/lib/lazy-export-libs";
import {
  buildTelfazWorkbook,
  fitTelfazLine,
  isTelfazWorkbook,
  parseTelfazBudgetPreview,
  parseTelfazCode,
  parseTelfazWorkbook,
  type TelfazParseResult,
} from "@/lib/budget-telfaz-format";
import { cleanImportedBudget } from "@/lib/budget-import-clean";
import type { BudgetLine } from "@/lib/store";
import { countExistingMatches, importTargetChoices } from "@/lib/budget-import-target";

// ─────────────────────────────────────────────────────────────────
// Synthetic workbook in the client's layout (fake names, small).
// Mirrors the real file's quirks: per-row formulas, a section whose column F
// is "Amount", cast codes with line breaks, inner "Sub Total for …" rows, a
// header row without a code, a hard-coded SAR figure, a subtotal formula
// that skips a row, Post rows "Included in Production", child rows without
// a code, a header lump sum (6000) and a "VFX" text row, sheet-4 codes
// "55-01" and rows without a code.
// ─────────────────────────────────────────────────────────────────

type V = ExcelJS.CellValue;
const f = (formula: string, result: number): V => ({ formula, result }) as V;

type FixtureOpts = { hardCodedSar?: boolean; subtotalGap?: boolean };

async function buildFixture(opts: FixtureOpts = {}): Promise<ExcelJS.Workbook> {
  const ExcelJSLib = await loadExcelJs();
  const wb = new ExcelJSLib.Workbook();
  const top = wb.addWorksheet("Top Sheet");
  const fx = 3.75;
  const put = (ws: ExcelJS.Worksheet, r: number, cells: Record<string, V>) => {
    for (const [col, v] of Object.entries(cells)) ws.getCell(`${col}${r}`).value = v;
  };
  const header = (
    ws: ExcelJS.Worksheet,
    r: number,
    code: string,
    name: string,
    fLabel = "SHOOTING WEEKS",
    eLabel = "PREP WEEKS",
  ) =>
    put(ws, r, {
      B: code,
      C: name,
      D: "NAME",
      E: eLabel,
      F: fLabel,
      G: "WRAP WEEKS",
      H: "TOTAL WEEKS",
      I: "Unit",
      J: "Quantity",
      K: "Rate",
      L: "NOTES",
      N: "SAR",
      O: "Dollar",
    });
  /** a USD line: O = formula, N = O*3.75 */
  const usd = (
    ws: ExcelJS.Worksheet,
    r: number,
    cells: Record<string, V>,
    oFormula: string,
    o: number,
  ) => put(ws, r, { ...cells, O: f(oFormula, o), N: f(`O${r}*3.75`, o * fx) });

  // ── 1-Above The Line ──
  const atl = wb.addWorksheet("1-Above The Line");
  atl.getCell("A2").value = "ABOVE THE LINE";
  atl.mergeCells("A2:O2");
  header(atl, 3, "1000", "DEVELOPMENT COSTS", "Amount");
  usd(
    atl,
    4,
    { B: "1001", C: "Prelim Breakdown", F: 1, I: "Allow", J: 6, K: 1000 },
    "F4*J4*K4",
    6000,
  );
  if (opts.hardCodedSar)
    put(atl, 5, { B: "1004", C: "Travel Expenses", I: "Allow", J: 1, K: 2600, N: 10000, O: 2600 });
  else usd(atl, 5, { B: "1004", C: "Travel Expenses", I: "Allow", J: 1, K: 2600 }, "J5*K5", 2600);
  usd(atl, 6, { B: "1005", C: "Legal" }, "F6*J6*K6", 0);
  const s1Sar = 6000 * fx + (opts.hardCodedSar ? 10000 : 2600 * fx);
  put(atl, 7, { B: "Subtotal", N: f("SUM(N4:N6)", s1Sar), O: f("SUM(O4:O6)", 8600) });

  header(atl, 9, "1200", "PRODUCERS UNIT");
  usd(
    atl,
    10,
    { B: "1201", C: "Executive Producer", D: "Test Person A", I: "Epi", J: 6, K: 15000 },
    "J10*K10",
    90000,
  );
  usd(
    atl,
    11,
    {
      B: "1202",
      C: "Producer",
      D: "Test Person B",
      E: 8,
      F: 5,
      G: 2,
      H: f("E11+F11+G11", 15),
      I: "Package",
      J: 1,
      K: 60000,
    },
    "(J11)*(K11)",
    60000,
  );
  usd(
    atl,
    12,
    {
      B: "1222",
      C: "Assistant to the producer",
      D: "TBA",
      E: 8,
      F: 5,
      G: 1,
      H: f("E12+F12+G12", 14),
      I: "Package",
      J: 1,
      K: 15000,
    },
    "J12*K12",
    15000,
  );
  // the real file's 1200 subtotal SUM(N24:N30) leaves the last row out of the SAR column
  const s2SarRows = (90000 + 60000 + 15000) * fx;
  const s2Sar = opts.subtotalGap ? (90000 + 60000) * fx : s2SarRows;
  put(atl, 13, {
    B: "Subtotal",
    N: f(opts.subtotalGap ? "SUM(N10:N11)" : "SUM(N10:N12)", s2Sar),
    O: f("SUM(O10:O12)", 165000),
  });

  header(atl, 15, "1400", "CAST TITLE", "SHOOTING WEEKS", "PREP DAYS");
  usd(atl, 16, { B: "1401\nMain\nRoles" }, "F16*J16*K16", 0);
  usd(
    atl,
    17,
    {
      B: "1401\nMain\nRoles",
      C: "Role One",
      D: "Actor One",
      F: 24,
      H: 24,
      I: "Days",
      J: 1,
      K: 4500,
      L: "EP+Actor",
    },
    "F17*J17*K17",
    108000,
  );
  put(atl, 18, {
    B: "1401\nMain\nRoles",
    C: "Sub Total for Main Roles",
    N: f("SUM(N16:N17)", 108000 * fx),
    O: f("SUM(O16:O17)", 108000),
  });
  usd(
    atl,
    19,
    { B: "1403\nSupporting \nRoles", C: "Role Two", F: 3, H: 3, I: "Days", J: 1, K: 1333.34 },
    "F19*J19*K19",
    4000.02,
  );
  put(atl, 20, { C: "CAST", D: "NAME", E: "PREP WEEKS", F: "SHOOTING WEEKS" });
  usd(
    atl,
    21,
    {
      B: "1410",
      C: "Stunt Coordinator",
      E: 1,
      F: 1,
      I: "Allow",
      J: 1,
      K: 6000,
      L: "For the crash",
    },
    "F21*J21*K21",
    6000,
  );
  usd(
    atl,
    22,
    {
      B: "1420",
      C: "Casting Director",
      E: 8,
      F: 6,
      G: 1,
      H: f("E22+F22+G22", 15),
      I: "Weeks",
      J: 1,
      K: 1600,
    },
    "H22*J22*K22",
    24000,
  );
  usd(
    atl,
    23,
    { B: "1435", C: "Storyboard", E: 8, H: 500, I: "Frames", J: 1, K: 12 },
    "H23*J23*K23",
    6000,
  );
  const s3Usd = 108000 + 4000.02 + 6000 + 24000 + 6000;
  put(atl, 24, {
    B: "Subtotal",
    N: f("SUM(N18,N19,N21:N23)", s3Usd * fx),
    O: f("SUM(O18,O19,O21:O23)", s3Usd),
  });
  const atlUsd = 8600 + 165000 + s3Usd;
  const atlSarTop = s1Sar + s2Sar + s3Usd * fx;
  put(atl, 26, {
    B: "Total Above The Line",
    O: f("SUM(O7,O13,O24)", atlUsd),
    N: f("O26*3.75", atlUsd * fx),
  });

  // ── 2- Production Expenses ──
  const btl = wb.addWorksheet("2- Production Expenses");
  btl.getCell("A2").value = "PRODUCTION EXPENSES";
  header(btl, 3, "2600", "Picture Vehicals & Animals");
  usd(
    btl,
    4,
    { B: "2602", C: "Picture Car Rentals", D: "Car A", F: 15, H: 15, I: "Day", J: 1, K: 400 },
    "J4*K4*H4",
    6000,
  );
  usd(btl, 5, { B: "2602", D: "Trailer", F: 6, H: 6, I: "Day", J: 3, K: 660 }, "J5*K5*H5", 11880);
  put(btl, 6, {
    B: "2602",
    C: "Sub Total for Picture Cars",
    N: f("SUM(N4:N5)", 17880 * fx),
    O: f("SUM(O4:O5)", 17880),
  });
  usd(
    btl,
    7,
    { B: "2623", C: "Animals", D: "Sheep", H: 1, I: "Allow", J: 1, K: 400 },
    "J7*K7*H7",
    400,
  );
  put(btl, 8, { B: "Subtotal", N: f("SUM(N6,N7)", 18280 * fx), O: f("SUM(O6,O7)", 18280) });
  header(btl, 10, "3100", "Camera");
  usd(
    btl,
    11,
    { B: "3109", C: "DIT", E: 1, F: 5, H: 7, I: "Weeks", J: 1, K: 1800 },
    "J11*K11*H11",
    12600,
  );
  usd(
    btl,
    12,
    {
      B: "3193",
      C: "Technical Equipment Rentals",
      D: "Cam, Light & Grip",
      E: 1,
      F: 5,
      H: 5,
      I: "Allow",
      J: 1,
      K: 350000,
    },
    "J12*K12",
    350000,
  );
  usd(btl, 13, { B: "3683", C: "Set Production Vehicles" }, "J13*K13*H13", 0);
  usd(
    btl,
    14,
    {
      B: "3683",
      C: "Breakdown:",
      D: "Mini Van",
      E: 1,
      F: 5,
      H: f("F14+G14+E14", 6),
      I: "Allow",
      J: 3,
      K: 707,
    },
    "J14*K14*H14",
    12726,
  );
  put(btl, 15, {
    B: "3902",
    C: "Hotel Cost - Post Team",
    H: 45,
    I: "Day",
    J: 4,
    K: 6140,
    O: 6140,
    N: f("O15*3.75", 6140 * fx),
  });
  usd(btl, 16, {}, "J16*K16*H16", 0); // a formula-only blank row
  usd(
    btl,
    17,
    {
      B: "3712",
      C: "Production Office Space Rental",
      E: 8,
      F: 5,
      G: 2,
      H: f("F17+G17+E17", 15),
      I: "Allow",
      J: 1,
      K: 12000,
    },
    "J17*K17",
    12000,
  );
  const s4Usd = 12600 + 350000 + 12726 + 6140 + 12000;
  put(btl, 18, { B: "Subtotal", N: f("SUM(N11:N17)", s4Usd * fx), O: f("SUM(O11:O17)", s4Usd) });
  const btlUsd = 18280 + s4Usd;
  put(btl, 20, {
    B: "Total Below The Line",
    N: f("SUM(N8,N18)", btlUsd * fx),
    O: f("SUM(O8,O18)", btlUsd),
  });

  // ── 3- Post-Production ──
  const post = wb.addWorksheet("3- Post-Production");
  post.getCell("A3").value = "POST PRODUCTION";
  put(post, 6, {
    B: "Code of Chart of Accounts",
    C: "Item",
    D: "Description",
    E: "Amount",
    F: "Unit",
    G: "Quantity B",
    H: "Rate ($)",
    I: "Subtotal",
    J: "Comment",
  });
  put(post, 7, { B: 3100, C: "CAMERA", I: f("SUM(I8:I8)", 12600) });
  put(post, 8, {
    B: 3109,
    C: "DIT - Unit 01",
    E: 7,
    F: "Week",
    G: 1,
    H: 1800,
    I: f("H8*E8*G8", 12600),
    J: "Included in Production ",
  });
  put(post, 9, { B: 5000, C: "EDITORIAL", I: f("SUM(I10:I14)", 21000 + 6400 + 6120 + 3600) });
  put(post, 10, { B: 5001, C: "PICTURE EDITOR" });
  put(post, 11, {
    C: "Picture Editor 1",
    E: 3,
    F: "Episode",
    G: 1,
    H: 7000,
    I: f("H11*E11*G11", 21000),
  });
  put(post, 12, {
    B: 5140,
    C: "AIRFARES",
    E: 4,
    F: "Package",
    G: 1,
    H: 1600,
    I: f("H12*E12*G12", 6400),
  });
  put(post, 13, {
    B: 5110,
    C: "IMF DELIVERY",
    D: "IMF + Supp",
    E: 6,
    F: "Episode",
    G: 1,
    H: 1020,
    I: f("E13*G13*H13", 6120),
  });
  put(post, 14, {
    C: "MASTERING",
    D: "PRORES",
    E: 6,
    F: "Episode",
    G: 1,
    H: 600,
    I: f("E14*G14*H14", 3600),
  });
  put(post, 15, { B: 6000, C: "MUSIC", I: 120000, J: "Supervisor - Licensing and Composer" });
  const edUsd = 21000 + 6400 + 6120 + 3600;
  put(post, 16, { B: "TOTAL POST PRODUCTION (accounts 5000-5400)", I: f("I9", edUsd) });
  put(post, 17, { B: "TOTAL MUSIC (accounts 6000)", I: f("I15", 120000) });
  put(post, 18, { B: "VFX", I: 60000, J: "Estimate" });
  const postUsd = edUsd + 120000 + 60000;

  // ── 4- Other Expenses ──
  const oth = wb.addWorksheet("4- Other Expenses");
  oth.getCell("A2").value = "OTHER EXPENSES\t\t";
  put(oth, 3, {
    B: "55-00",
    C: "PUBLICITY",
    D: "NAME",
    E: "DAYS",
    F: "NOTES",
    G: "SAR",
    H: "Dollar",
  });
  put(oth, 4, { B: "55-01", C: "Still Photographer", G: f("H4*3.75", 0), H: 0 });
  put(oth, 5, { B: "Subtotal", G: f("SUM(G4)", 0), H: f("SUM(H4)", 0) });
  put(oth, 7, {
    B: "7000",
    C: "Administrative Expenses",
    D: "NAME",
    E: "DAYS",
    F: "NOTES",
    G: "SAR",
    H: "Dollar",
  });
  put(oth, 8, { C: "Copier", G: f("H8*3.75", 0), H: 0 });
  put(oth, 9, { B: "7094", C: "Production Office Supplies", G: f("H9*3.75", 22500), H: 6000 });
  put(oth, 10, { C: "WHT", F: "Estimtion", G: f("H10*3.75", 37500), H: 10000 });
  put(oth, 11, { B: "Subtotal", G: f("SUM(G8:G10)", 60000), H: f("SUM(H8:H10)", 16000) });
  const othUsd = 16000;

  // ── Top Sheet ──
  put(top, 3, { B: "BUDGET TOPSHEET || Fixture || V1" });
  put(top, 21, {
    C: "TOTAL ABOVE THE LINE",
    G: f("SUM(G15:G20)", atlSarTop),
    H: f("SUM(H15:H20)", atlUsd),
  });
  put(top, 44, {
    C: "TOTAL PRODUCTION",
    G: f("SUM(G24:G43)", btlUsd * fx),
    H: f("SUM(H24:H43)", btlUsd),
  });
  put(top, 50, {
    C: "TOTAL POST PRODUCTION ",
    G: f("H50*3.75", postUsd * fx),
    H: f("SUM(H47:H49)", postUsd),
  });
  put(top, 57, {
    C: "TOTAL OTHER ",
    G: f("SUM(G53:G56)", othUsd * fx),
    H: f("SUM(H53:H56)", othUsd),
  });
  const gSar = atlSarTop + btlUsd * fx + postUsd * fx + othUsd * fx;
  const gUsd = atlUsd + btlUsd + postUsd + othUsd;
  put(top, 60, {
    C: "Total Budget Before Contengency ",
    G: f("G57+G50+G44+G21", gSar),
    H: f("H57+H50+H44+H21", gUsd),
  });
  return wb;
}

async function roundTripWorkbook(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const ExcelJSLib = await loadExcelJs();
  const buf = await wb.xlsx.writeBuffer();
  const out = new ExcelJSLib.Workbook();
  await out.xlsx.load(buf as ArrayBuffer);
  return out;
}

const byRow = (p: TelfazParseResult, sheet: string, row: number) =>
  p.lines.find((l) => p.sheetOfLine[l.id] === sheet && p.rowOfLine[l.id] === row);

const lineKey = (l: BudgetLine) =>
  JSON.stringify([
    l.group,
    l.headerCode,
    l.mainCode,
    l.description,
    l.name ?? "",
    l.prep ?? 0,
    l.shooting ?? 0,
    l.wrap ?? 0,
    l.x,
    l.unit,
    l.amount,
    l.rate,
    l.currency,
    l.notes ?? "",
    !!l.excluded,
  ]);

describe("Telfaz budget layout — import", () => {
  it("is detected, and reads every line with the file's totals to the cent", async () => {
    const wb = await roundTripWorkbook(await buildFixture());
    expect(isTelfazWorkbook(wb)).toBe(true);
    const p = parseTelfazWorkbook(wb);
    const v = p.validation;
    expect(v.fx).toBe(3.75);
    expect(v.ok).toBe(true);
    for (const s of v.sheets) {
      expect(s.status, s.sheet).toBe("match");
      expect(s.parsedSar).toBe(s.fileSar);
      expect(s.parsedUsd).toBe(s.fileUsd);
      for (const sec of s.sections) expect(sec.status, `${s.sheet} ${sec.code}`).toBe("match");
    }
    expect(v.grand.status).toBe("match");
    expect(v.grand.parsedSar).toBe(v.grand.fileSar);
    expect(v.grand.parsedUsd).toBe(v.grand.fileUsd);
    // "Included in Production" is left out on purpose — and reported
    const post = v.sheets.find((s) => s.sheetKey === "POST")!;
    expect(post.excludedUsd).toBe(12600);
    expect(v.skipped.filter((s) => s.reason === "included_in_production")).toHaveLength(1);
  });

  it("maps the rows the way the file means them", async () => {
    const p = parseTelfazWorkbook(await roundTripWorkbook(await buildFixture()));
    const ATL = "1-Above The Line";
    const BTL = "2- Production Expenses";
    const POST = "3- Post-Production";
    const OTH = "4- Other Expenses";
    // column F labelled "Amount" is a multiplier, not shooting weeks
    expect(byRow(p, ATL, 4)).toMatchObject({
      mainCode: "1001",
      headerCode: "1000",
      shooting: 0,
      x: 1,
      amount: 6,
      rate: 1000,
      currency: "USD",
      group: "ATL",
    });
    // names stay in the NAME column (the app's convention for budget lines)
    expect(byRow(p, ATL, 10)).toMatchObject({
      name: "Test Person A",
      unit: "Epi",
      amount: 6,
      rate: 15000,
    });
    // Package ignores periods, as in the file (=J*K)
    expect(byRow(p, ATL, 11)).toMatchObject({ unit: "Package", prep: 8, shooting: 5, wrap: 2 });
    // cast code with line breaks; inner "Sub Total for Main Roles" skipped
    expect(byRow(p, ATL, 16)).toBeUndefined();
    expect(byRow(p, ATL, 17)).toMatchObject({
      mainCode: "1401",
      description: "Role One",
      name: "Actor One",
      shooting: 24,
      x: 24,
    });
    expect(byRow(p, ATL, 18)).toBeUndefined();
    expect(byRow(p, ATL, 19)).toMatchObject({ mainCode: "1403", rate: 1333.34 });
    // formula =F*J*K → shooting kept, prep moved to the notes
    const stunt = byRow(p, ATL, 21)!;
    expect(stunt).toMatchObject({ prep: 0, shooting: 1, x: 1 });
    expect(stunt.notes).toContain("For the crash");
    expect(stunt.notes).toContain("Prep 1 not counted");
    // =H*J*K with a TOTAL that is not prep+shoot+wrap
    expect(byRow(p, ATL, 23)).toMatchObject({ prep: 0, x: 500, rate: 12 });
    // a row without item inherits the item of its code; the name stays the name
    expect(byRow(p, BTL, 5)).toMatchObject({
      mainCode: "2602",
      description: "Picture Car Rentals",
      name: "Trailer",
      x: 6,
      amount: 3,
    });
    expect(byRow(p, BTL, 6)).toBeUndefined();
    // "Breakdown:" is a label, not an item
    expect(byRow(p, BTL, 14)).toMatchObject({
      description: "Set Production Vehicles",
      name: "Mini Van",
    });
    // hard-coded USD total that no formula explains → lump sum, numbers in the notes
    const hotel = byRow(p, BTL, 15)!;
    expect(hotel).toMatchObject({ amount: 1, rate: 6140, x: 1 });
    expect(hotel.notes).toContain("lump sum 6,140");
    // qty × rate only
    expect(byRow(p, BTL, 17)).toMatchObject({
      prep: 0,
      shooting: 0,
      wrap: 0,
      x: 1,
      amount: 1,
      rate: 12000,
    });
    // post: title row skipped, uncoded child under its parent code
    expect(byRow(p, POST, 10)).toBeUndefined();
    expect(byRow(p, POST, 11)).toMatchObject({
      mainCode: "5001",
      headerCode: "5000",
      group: "Post",
      x: 3,
      amount: 1,
      rate: 7000,
    });
    expect(byRow(p, POST, 14)).toMatchObject({
      mainCode: "5110",
      description: "MASTERING",
      name: "PRORES",
    });
    // Package with a period → folded into the quantity
    expect(byRow(p, POST, 12)).toMatchObject({ unit: "Package", amount: 4, rate: 1600 });
    expect(byRow(p, POST, 8)).toBeUndefined();
    // header lump sums → package detail codes, Music / VFX groups
    expect(byRow(p, POST, 15)).toMatchObject({
      mainCode: "6001",
      headerCode: "6000",
      group: "Music",
      rate: 120000,
    });
    expect(byRow(p, POST, 18)).toMatchObject({
      mainCode: "6113",
      headerCode: "6100",
      group: "VFX",
      rate: 60000,
    });
    // sheet 4: 55-01 → 5501 (original code kept in the notes); WHT matched by name
    expect(byRow(p, OTH, 4)).toMatchObject({
      mainCode: "5501",
      headerCode: "5500",
      group: "Other",
    });
    expect(byRow(p, OTH, 4)!.notes).toContain("File code 55-01");
    expect(byRow(p, OTH, 10)).toMatchObject({ mainCode: "7038", rate: 10000, currency: "USD" });
    expect(byRow(p, OTH, 8)).toBeUndefined(); // no code, zero → skipped and listed
    expect(p.validation.skipped.some((s) => s.reason === "no_code" && s.item === "Copier")).toBe(
      true,
    );
    // the import cleaner keeps every line (no false duplicates)
    const clean = cleanImportedBudget(p.lines);
    expect(clean.stats.duplicates).toBe(0);
    expect(clean.lines).toHaveLength(p.lines.length);
  });

  it("keeps a hard-coded SAR figure and explains file-side differences", async () => {
    const p = parseTelfazWorkbook(
      await roundTripWorkbook(await buildFixture({ hardCodedSar: true, subtotalGap: true })),
    );
    const travel = byRow(p, "1-Above The Line", 5)!;
    expect(travel).toMatchObject({ currency: "SAR", amount: 1, rate: 10000 });
    expect(travel.notes).toContain("SAR 10,000 hard-coded");
    const atl = p.validation.sheets.find((s) => s.sheetKey === "ATL")!;
    expect(atl.status).toBe("explained");
    // SAR: the file's subtotal formula leaves 15,000 USD × 3.75 out — the line is still imported
    expect(atl.parsedSar - atl.fileSar!).toBeCloseTo(15000 * 3.75, 2);
    // USD: the SAR row is worth 10,000 / 3.75 instead of the file's 2,600
    expect(atl.parsedUsd - atl.fileUsd!).toBeCloseTo(10000 / 3.75 - 2600, 2);
    expect(atl.sarKeptUsdDelta).toBeCloseTo(10000 / 3.75 - 2600, 2);
    expect(p.validation.ok).toBe(true);
    expect(p.validation.adjustments.some((a) => a.kind === "sar_kept")).toBe(true);
  });

  it("preview wraps the lines for the upload flow", async () => {
    const buf = await (await buildFixture()).xlsx.writeBuffer();
    const pv = await parseTelfazBudgetPreview(buf as ArrayBuffer);
    expect(pv).not.toBeNull();
    expect(pv!.result.sheetsScanned).toHaveLength(4);
    expect(pv!.result.budget.length).toBeGreaterThan(20);
    expect(pv!.mismatches).toHaveLength(0);
    expect(Object.keys(pv!.sheetOfLine!)).toHaveLength(pv!.result.budget.length);
  });

  it("is not triggered by the old multi-sheet export", async () => {
    const ExcelJSLib = await loadExcelJs();
    const wb = new ExcelJSLib.Workbook();
    const ws = wb.addWorksheet("1-ATL");
    ws.getRow(3).values = ["CODE", "ITEM", "NAME", "PREP", "SHOOTING", "WRAP", "TOTAL"];
    expect(isTelfazWorkbook(wb)).toBe(false);
  });
});

describe("Telfaz budget layout — export round trip", () => {
  it("export → import gives back the same lines and totals", async () => {
    const first = parseTelfazWorkbook(
      await roundTripWorkbook(await buildFixture({ hardCodedSar: true })),
    );
    const out = await roundTripWorkbook(
      await buildTelfazWorkbook(first.lines, { fx: 3.75, projectTitle: "Fixture" }),
    );
    expect(isTelfazWorkbook(out)).toBe(true);
    const again = parseTelfazWorkbook(out);
    expect(again.lines.map(lineKey).sort()).toEqual(first.lines.map(lineKey).sort());
    expect(again.validation.grand.parsedSar).toBe(first.validation.grand.parsedSar);
    expect(again.validation.grand.parsedUsd).toBe(first.validation.grand.parsedUsd);
    expect(again.validation.adjustments).toHaveLength(0); // nothing left to fix
    for (const s of again.validation.sheets) expect(s.status, s.sheet).toBe("match");
    expect(again.validation.grand.status).toBe("match");
  });

  it("round-trips lines made in Kwalis (SAR, excluded, Package, Other with qty × rate × periods)", async () => {
    const base = {
      prep: 0,
      shooting: 0,
      wrap: 0,
      notes: undefined,
      excluded: false,
      topsheetCode: null,
    };
    const lines: BudgetLine[] = [
      {
        ...base,
        id: "a",
        group: "ATL",
        headerCode: "1200",
        mainCode: "1202",
        description: "Producer",
        name: "Someone",
        amount: 1,
        rate: 50000,
        currency: "SAR",
        unit: "Package",
        x: 14,
        prep: 8,
        shooting: 5,
        wrap: 1,
      },
      {
        ...base,
        id: "b",
        group: "BTL",
        headerCode: "2000",
        mainCode: "2001",
        description: "PM",
        amount: 2,
        rate: 1500.5,
        currency: "USD",
        unit: "Weeks",
        x: 10,
        prep: 4,
        shooting: 5,
        wrap: 1,
        notes: "two people",
      },
      {
        ...base,
        id: "c",
        group: "BTL",
        headerCode: "2000",
        mainCode: "2003",
        description: "1st AD",
        amount: 1,
        rate: 3000,
        currency: "USD",
        unit: "Weeks",
        x: 13,
        excluded: true,
        prep: 8,
        shooting: 5,
      },
      {
        ...base,
        id: "d",
        group: "Post",
        headerCode: "5100",
        mainCode: "5101",
        description: "Conform",
        amount: 6,
        rate: 135,
        currency: "SAR",
        unit: "Hour",
        x: 7,
      },
      {
        ...base,
        id: "e",
        group: "VFX",
        headerCode: "6100",
        mainCode: "6113",
        description: "VFX",
        amount: 1,
        rate: 60000,
        currency: "USD",
        unit: "Allow",
        x: 1,
      },
      {
        ...base,
        id: "f",
        group: "Other",
        headerCode: "7000",
        mainCode: "7038",
        description: "WHT",
        amount: 3,
        rate: 1000,
        currency: "USD",
        unit: "Month",
        x: 4,
        notes: "estimate",
      },
      {
        ...base,
        id: "g",
        group: "Other",
        headerCode: "7200",
        mainCode: "7201",
        description: "Insurance",
        amount: 1,
        rate: 168750,
        currency: "SAR",
        unit: "Allow",
        x: 1,
      },
    ];
    const wb = await roundTripWorkbook(await buildTelfazWorkbook(lines, { fx: 3.75 }));
    const p = parseTelfazWorkbook(wb);
    expect(p.lines.map(lineKey).sort()).toEqual(lines.map(lineKey).sort());
    expect(p.validation.adjustments).toHaveLength(0);
    for (const s of p.validation.sheets) expect(s.status, s.sheet).toBe("match");
  });

  it("writes the project's own rate into the formulas and reads it back", async () => {
    const line: BudgetLine = {
      id: "a",
      group: "ATL",
      headerCode: "1000",
      mainCode: "1001",
      description: "x",
      amount: 1,
      rate: 100,
      currency: "USD",
      unit: "Allow",
      x: 1,
    };
    const p = parseTelfazWorkbook(
      await roundTripWorkbook(await buildTelfazWorkbook([line], { fx: 3.8 })),
    );
    expect(p.validation.fx).toBe(3.8);
    expect(p.lines[0]).toMatchObject({ currency: "USD", rate: 100 });
    expect(p.validation.grand.parsedSar).toBe(380);
  });
});

describe("fitTelfazLine", () => {
  const basis = { prep: 0, shooting: 0, wrap: 0, total: 0, unit: "Weeks", qty: 1, rate: 100 };
  it("keeps the row as it is when the arithmetic already matches", () => {
    expect(fitTelfazLine({ ...basis, prep: 2, shooting: 3 }, 500).kind).toBe("as_is");
  });
  it("uses the formula's own period columns when given", () => {
    const f = fitTelfazLine({ ...basis, prep: 1, shooting: 1 }, 100, new Set(["shooting"]));
    expect(f).toMatchObject({ kind: "periods", prep: 0, shooting: 1 });
  });
  it("never changes the total — falls back to a lump sum", () => {
    const f = fitTelfazLine({ ...basis, qty: 4, rate: 6140, total: 45, unit: "Day" }, 6140.55);
    expect(f).toMatchObject({ kind: "lump", amount: 1, rate: 6140.55, x: 1 });
  });
});

describe("parseTelfazCode", () => {
  it("cleans the file's codes", () => {
    expect(parseTelfazCode("1401\nMain\nRoles")).toMatchObject({
      code: "1401",
      label: "Main Roles",
    });
    expect(parseTelfazCode("55-01")).toMatchObject({
      code: "5501",
      original: "55-01",
      mapped: true,
    });
    expect(parseTelfazCode(3100)).toMatchObject({ code: "3100" });
    expect(parseTelfazCode("Subtotal")).toBeNull();
    expect(parseTelfazCode("5000 - 5400 ")).toMatchObject({ code: "5000" });
  });
});

describe("import target (no silent duplicates on re-import)", () => {
  it("offers a new draft by default when the version already has lines", () => {
    expect(importTargetChoices("active", 0)).toEqual({ options: ["add"], defaultTarget: "add" });
    expect(importTargetChoices("active", 12)).toEqual({
      options: ["new_draft", "add"],
      defaultTarget: "new_draft",
    });
    expect(importTargetChoices("draft", 3).options).toContain("replace_draft");
    expect(importTargetChoices("active", 3).options).not.toContain("replace_draft");
    // no budget versions in the database → append, as before
    expect(importTargetChoices(null, 3, false)).toEqual({ options: ["add"], defaultTarget: "add" });
  });
  it("counts incoming lines that already exist", () => {
    const l: BudgetLine = {
      id: "1",
      group: "ATL",
      headerCode: "1000",
      mainCode: "1001",
      description: "A",
      amount: 1,
      rate: 1,
      currency: "USD",
      unit: "Allow",
      x: 1,
    };
    expect(
      countExistingMatches(
        [
          { ...l, id: "2" },
          { ...l, id: "3", rate: 2 },
        ],
        [l],
      ),
    ).toBe(1);
  });
});
