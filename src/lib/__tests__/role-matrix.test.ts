import { describe, expect, it } from "vitest";
import {
  EMPTY_FLAGS,
  FULL_FLAGS,
  applyToggle,
  buildBaseline,
  countAccessibleModules,
  diffMatrix,
  getFlags,
  normalizeFlags,
  setRoleAll,
  slugify,
  toggleCell,
  triStateOf,
  type MatrixDraft,
} from "@/lib/permissions/role-matrix";

describe("applyToggle — implication invariant", () => {
  it("unchecking view clears every other flag", () => {
    const start = { ...FULL_FLAGS };
    const next = applyToggle(start, "view");
    expect(next).toEqual(EMPTY_FLAGS);
  });

  it("checking a write flag implicitly grants view", () => {
    const next = applyToggle({ ...EMPTY_FLAGS }, "edit");
    expect(next.can_view).toBe(true);
    expect(next.can_edit).toBe(true);
  });

  it("unchecking a write flag keeps view", () => {
    const start = { ...EMPTY_FLAGS, can_view: true, can_edit: true };
    const next = applyToggle(start, "edit");
    expect(next.can_view).toBe(true);
    expect(next.can_edit).toBe(false);
  });
});

describe("normalizeFlags — server mirror", () => {
  it("forces view on when any write flag is set", () => {
    const n = normalizeFlags({ ...EMPTY_FLAGS, can_delete: true });
    expect(n.can_view).toBe(true);
  });

  it("collapses fully-false rows", () => {
    expect(normalizeFlags({ ...EMPTY_FLAGS })).toEqual(EMPTY_FLAGS);
  });
});

describe("triStateOf", () => {
  it("all / none / some", () => {
    expect(triStateOf([FULL_FLAGS, FULL_FLAGS])).toBe("all");
    expect(triStateOf([EMPTY_FLAGS, EMPTY_FLAGS])).toBe("none");
    expect(triStateOf([FULL_FLAGS, EMPTY_FLAGS])).toBe("some");
    expect(
      triStateOf([
        { ...EMPTY_FLAGS, can_view: true },
        { ...EMPTY_FLAGS, can_view: true },
      ]),
    ).toBe("some");
    expect(triStateOf([])).toBe("none");
  });
});

describe("draft edits + diff", () => {
  it("toggleCell is immutable and diff only emits changed cells", () => {
    const baseline = buildBaseline([
      {
        role_id: "r1",
        module_key: "budget",
        can_view: true,
        can_create: false,
        can_edit: false,
        can_delete: false,
        can_export: false,
      },
    ]);
    const draft = toggleCell(baseline, "r1", "budget", "edit");
    expect(getFlags(baseline, "r1", "budget").can_edit).toBe(false);

    const changes = diffMatrix(baseline, draft);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      role_id: "r1",
      module_key: "budget",
      can_view: true,
      can_edit: true,
    });
  });

  it("setRoleAll grants and clears every module", () => {
    let draft: MatrixDraft = {};
    draft = setRoleAll(draft, "r1", ["a", "b"], true);
    expect(getFlags(draft, "r1", "a")).toEqual(FULL_FLAGS);
    expect(getFlags(draft, "r1", "b")).toEqual(FULL_FLAGS);
    draft = setRoleAll(draft, "r1", ["a", "b"], false);
    expect(getFlags(draft, "r1", "a")).toEqual(EMPTY_FLAGS);
  });

  it("diff against empty baseline emits only non-empty cells", () => {
    const draft = toggleCell({}, "r1", "budget", "view");
    const changes = diffMatrix({}, draft);
    expect(changes).toHaveLength(1);
    expect(changes[0].can_view).toBe(true);
  });
});

describe("helpers", () => {
  it("countAccessibleModules counts cells with any flag", () => {
    expect(
      countAccessibleModules({
        a: FULL_FLAGS,
        b: EMPTY_FLAGS,
        c: { ...EMPTY_FLAGS, can_view: true },
      }),
    ).toBe(2);
  });

  it("slugify produces kebab-case slugs", () => {
    expect(slugify("Line Producer")).toBe("line-producer");
    expect(slugify("  CFO / Finance!! ")).toBe("cfo-finance");
    expect(slugify("")).toBe("role");
  });
});
