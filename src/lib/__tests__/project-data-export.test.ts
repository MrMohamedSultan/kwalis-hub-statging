// D23: export all project data — bank / ID columns, attachment links, sheets.
import { describe, expect, it } from "vitest";
import {
  attachmentLinks,
  attachmentsCsv,
  projectDataDoc,
  sanitizeRows,
  tableSection,
} from "@/features/project-export/project-data-export";

const people = [
  {
    id: "p1",
    full_name: "Sara",
    iban: "SA03 8000",
    bank: "SNB",
    swift_code: "NCBK",
    id_number: "1012",
    contract_path: "org/p1/contract.pdf",
    id_attachment_path: "org/p1/id.pdf",
    daily_rate: 1500,
  },
];

describe("sanitizeRows", () => {
  it("drops bank and ID details unless included", () => {
    const [r] = sanitizeRows(people, false);
    expect(Object.keys(r)).toEqual(["id", "full_name", "contract_path", "daily_rate"]);
    expect(sanitizeRows(people, true)[0].iban).toBe("SA03 8000");
  });
});

describe("attachmentLinks", () => {
  it("lists the stored files of the exported rows only", () => {
    expect(attachmentLinks("people", sanitizeRows(people, false))).toEqual([
      { table: "people", rowId: "p1", column: "contract_path", path: "org/p1/contract.pdf" },
    ]);
    expect(attachmentsCsv([{ table: "t", rowId: "1", column: "c", path: "a,b" }])).toBe(
      'table,row_id,column,path\nt,1,c,"a,b"',
    );
  });
});

describe("tableSection / projectDataDoc", () => {
  it("one sheet per table with the union of columns and a contents sheet", () => {
    const s = tableSection("payments", [
      { id: "1", amount: 10, meta: { a: 1 } },
      { id: "2", method: "Cash", ok: true },
    ]);
    expect(s.columns.map((c) => c.header)).toEqual(["id", "amount", "meta", "method", "ok"]);
    expect(s.rows[0]).toEqual(["1", 10, '{"a":1}', null, null]);
    expect(s.rows[1][4]).toBe("true");
    const doc = projectDataDoc(
      [
        { table: "payments", rows: [{ id: "1" }] },
        { table: "invoices", rows: [], error: "denied" },
      ],
      { title: "Project data", contents: "Contents", table: "Table", rows: "Rows", note: "n" },
    );
    expect(doc.layout).toBe("sheets");
    expect(doc.sections.map((x) => x.title)).toEqual(["Contents", "payments", "invoices"]);
    expect(doc.sections[0].rows).toEqual([
      ["payments", 1, ""],
      ["invoices", 0, "denied"],
    ]);
    expect(doc.sections[2].columns[0].header).toBe("id");
  });
});
