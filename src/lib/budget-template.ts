// Budget template (D20): the header / main codes list a new budget starts
// from. An organization can keep its own templates (public.budget_templates,
// db/pending/204) and mark one as the default from Settings → Organization;
// without one, the built-in template (HEADER_ACCOUNTS + MAIN_ACCOUNTS) is used.
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { HEADER_ACCOUNTS, MACRO_CATEGORIES, MAIN_ACCOUNTS, type MacroCategory } from "@/lib/data";

export type TemplateLine = {
  group: MacroCategory;
  header_code: string;
  header_name: string;
  code: string;
  description: string;
};

export type BudgetTemplateRow = {
  id: string;
  organization_id: string;
  name: string;
  lines: TemplateLine[];
  is_default: boolean;
  updated_at?: string;
};

export const MAX_TEMPLATE_LINES = 5000;
const CODE_RE = /^[A-Za-z0-9._-]{1,32}$/;

/** One template line, same rules as stamp_budget_template() (db/pending/204); unknown keys dropped. */
export const TemplateLineSchema = z
  .object({
    group: z.enum(MACRO_CATEGORIES),
    header_code: z.string().regex(CODE_RE),
    header_name: z.string().trim().max(200),
    code: z.string().regex(CODE_RE),
    description: z.string().trim().max(300),
  })
  .strip();

/** A whole template as saved: a name and 1–5000 lines with unique codes. */
export const BudgetTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  lines: z
    .array(TemplateLineSchema)
    .min(1)
    .max(MAX_TEMPLATE_LINES)
    .refine((ls) => new Set(ls.map((l) => l.code)).size === ls.length, "duplicate"),
});

/** The built-in template, as template lines (stable order). */
export function builtinTemplateLines(): TemplateLine[] {
  const out: TemplateLine[] = [];
  for (const h of HEADER_ACCOUNTS) {
    const mains = MAIN_ACCOUNTS[h.code] ?? [{ code: `${h.code}-01`, name: h.name }];
    for (const m of mains)
      out.push({
        group: h.group,
        header_code: h.code,
        header_name: h.name,
        code: m.code,
        description: m.name,
      });
  }
  return out;
}

/** Headers of a template, in first-seen order. */
export function templateHeaders(
  lines: TemplateLine[],
): { code: string; name: string; group: MacroCategory }[] {
  const seen = new Map<string, { code: string; name: string; group: MacroCategory }>();
  for (const l of lines)
    if (!seen.has(l.header_code))
      seen.set(l.header_code, { code: l.header_code, name: l.header_name, group: l.group });
  return [...seen.values()];
}

const norm = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

const HEADER_ALIASES: Record<keyof TemplateLine, string[]> = {
  group: ["group", "section", "category", "macro", "القسم", "المجموعة"],
  header_code: ["header code", "header", "topsheet code", "كود الرأس", "كود الحساب الرئيسي"],
  header_name: ["header name", "topsheet", "header description", "اسم الرأس", "اسم الحساب الرئيسي"],
  code: ["code", "main code", "account code", "budget code", "الكود", "كود البند"],
  description: ["description", "item", "account name", "name", "الوصف", "البند"],
};

function groupOf(v: unknown): MacroCategory | null {
  const s = norm(v);
  const hit = MACRO_CATEGORIES.find((g) => g.toLowerCase() === s);
  if (hit) return hit;
  if (s === "above the line") return "ATL";
  if (s === "below the line" || s === "production") return "BTL";
  if (s === "post production" || s === "post-production") return "Post";
  return null;
}

/**
 * Pure: a sheet (array of rows, first row = headers) → template lines.
 * Columns: Group · Header code · Header name · Code · Description (English
 * or Arabic headers). Rows without a code are skipped; problems are listed
 * with their row number (1-based, as in Excel). Unit-tested.
 */
export function parseTemplateSheet(aoa: unknown[][]): {
  lines: TemplateLine[];
  errors: { row: number; problem: "group" | "code" | "header" | "duplicate" | "columns" }[];
} {
  const errors: { row: number; problem: "group" | "code" | "header" | "duplicate" | "columns" }[] =
    [];
  const headIdx = aoa.findIndex((r) =>
    (r ?? []).some((c) => HEADER_ALIASES.code.includes(norm(c))),
  );
  if (headIdx < 0) return { lines: [], errors: [{ row: 1, problem: "columns" }] };
  const head = (aoa[headIdx] ?? []).map(norm);
  const col = (k: keyof TemplateLine) => head.findIndex((h) => HEADER_ALIASES[k].includes(h));
  const idx = {
    group: col("group"),
    header_code: col("header_code"),
    header_name: col("header_name"),
    code: col("code"),
    description: col("description"),
  };
  if (idx.code < 0 || idx.header_code < 0 || idx.group < 0)
    return { lines: [], errors: [{ row: headIdx + 1, problem: "columns" }] };

  const lines: TemplateLine[] = [];
  const codes = new Set<string>();
  for (let i = headIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const code = String(r[idx.code] ?? "").trim();
    if (!code) continue;
    const rowNo = i + 1;
    const group = groupOf(r[idx.group]);
    const headerCode = String(r[idx.header_code] ?? "").trim();
    if (!group) {
      errors.push({ row: rowNo, problem: "group" });
      continue;
    }
    if (!CODE_RE.test(code)) {
      errors.push({ row: rowNo, problem: "code" });
      continue;
    }
    if (!CODE_RE.test(headerCode)) {
      errors.push({ row: rowNo, problem: "header" });
      continue;
    }
    if (codes.has(code)) {
      errors.push({ row: rowNo, problem: "duplicate" });
      continue;
    }
    codes.add(code);
    lines.push({
      group,
      header_code: headerCode,
      header_name: String(idx.header_name >= 0 ? (r[idx.header_name] ?? "") : "")
        .trim()
        .slice(0, 200),
      code,
      description: String(idx.description >= 0 ? (r[idx.description] ?? "") : "")
        .trim()
        .slice(0, 300),
    });
  }
  return { lines, errors };
}

/** Pure: template lines → sheet rows (download a starting file). */
export function templateToSheet(lines: TemplateLine[]): (string | number)[][] {
  return [
    ["Group", "Header code", "Header name", "Code", "Description"],
    ...lines.map((l) => [l.group, l.header_code, l.header_name, l.code, l.description]),
  ];
}

const from = (t: string) => (supabase.from as any)(t);

export async function listBudgetTemplates(orgId: string): Promise<BudgetTemplateRow[]> {
  const { data, error } = await from("budget_templates")
    .select("id, organization_id, name, lines, is_default, updated_at")
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as BudgetTemplateRow[];
}

/** The organization's default template, or null (built-in). */
export async function fetchDefaultBudgetTemplate(
  orgId: string | null,
): Promise<BudgetTemplateRow | null> {
  if (!orgId) return null;
  const { data, error } = await from("budget_templates")
    .select("id, organization_id, name, lines, is_default, updated_at")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) return null; // database without 204: built-in template
  return (data as BudgetTemplateRow | null) ?? null;
}

export const budgetTemplateKey = (orgId: string | null) => ["budget-template", orgId] as const;

/** Lines a new budget starts from: the org default, else the built-in template. */
export function useBudgetTemplate(orgId: string | null) {
  const q = useQuery({
    queryKey: budgetTemplateKey(orgId),
    queryFn: () => fetchDefaultBudgetTemplate(orgId),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
  const org = q.data && Array.isArray(q.data.lines) && q.data.lines.length ? q.data : null;
  return {
    loading: !!orgId && q.isLoading,
    source: org ? ("organization" as const) : ("builtin" as const),
    name: org?.name ?? null,
    lines: org?.lines ?? null,
  };
}

export async function saveBudgetTemplate(input: {
  id?: string;
  organizationId: string;
  name: string;
  lines: TemplateLine[];
}) {
  // validated (and stripped to the known keys) before it is sent
  const clean = BudgetTemplateSchema.parse({
    name: input.name.trim().slice(0, 120),
    lines: input.lines,
  });
  const row = {
    organization_id: input.organizationId,
    name: clean.name,
    lines: clean.lines,
  };
  const q = input.id
    ? from("budget_templates").update(row).eq("id", input.id)
    : from("budget_templates").insert(row);
  const { error } = await q;
  if (error) throw error;
}

/** Make one template the default (or none: back to the built-in template). */
export async function setDefaultBudgetTemplate(orgId: string, id: string | null) {
  const { error: e1 } = await from("budget_templates")
    .update({ is_default: false })
    .eq("organization_id", orgId)
    .eq("is_default", true);
  if (e1) throw e1;
  if (!id) return;
  const { error } = await from("budget_templates").update({ is_default: true }).eq("id", id);
  if (error) throw error;
}

export async function deleteBudgetTemplate(id: string) {
  const { error } = await from("budget_templates").delete().eq("id", id);
  if (error) throw error;
}
