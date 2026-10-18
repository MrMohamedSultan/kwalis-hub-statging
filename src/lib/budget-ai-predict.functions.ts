// Server function that uses Lovable AI Gateway to predict header codes
// and macro-category groups for budget rows based on their description.
//
// This runs strictly on the server (LOVABLE_API_KEY never touches the browser)
// and returns a compact array of { description, headerCode, group, confidence }.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        description: z.string().min(1).max(500),
        currentCode: z.string().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export type PredictSuggestion = {
  id: string;
  headerCode: string;
  group: "ATL" | "BTL" | "Post" | "Music" | "VFX" | "Other";
  confidence: number; // 0-1
  rationale?: string;
};

// The canonical header catalogue the model chooses from — mirrors data.ts.
const CATALOGUE: ReadonlyArray<readonly [string, string, PredictSuggestion["group"]]> = [
  // ATL
  ["1100", "SCRIPT", "ATL"],
  ["1200", "PRODUCERS UNIT", "ATL"],
  ["1300", "DIRECTION", "ATL"],
  ["1400", "CAST", "ATL"],
  ["1600", "ATL TRAVEL & LIVING", "ATL"],
  // BTL
  ["2000", "PRODUCTION STAFF", "BTL"],
  ["2100", "EXTRA TALENT", "BTL"],
  ["2200", "SET DESIGN", "BTL"],
  ["2300", "SET CONSTRUCTION", "BTL"],
  ["2400", "SET DRESSING", "BTL"],
  ["2500", "PROPERTY", "BTL"],
  ["2600", "PICTURE VEHICLES / ANIMALS", "BTL"],
  ["2700", "WARDROBE", "BTL"],
  ["2800", "MAKE-UP & HAIR", "BTL"],
  ["2900", "GRIP", "BTL"],
  ["3000", "ELECTRICAL", "BTL"],
  ["3100", "CAMERA", "BTL"],
  ["3200", "PRODUCTION SOUND", "BTL"],
  ["3300", "SPECIAL EFFECTS", "BTL"],
  ["3400", "LOCATION EXPENSES", "BTL"],
  ["3500", "AERIAL, MARINE & DRONE UNITS", "BTL"],
  ["3600", "LOCATION TRANSPORTATION", "BTL"],
  ["3700", "STAGE & OFFICE RENTALS", "BTL"],
  ["3800", "PRODUCTION LAB & MEDIA MANAGEMENT", "BTL"],
  ["3900", "BELOW THE LINE TRAVEL & LIVING", "BTL"],
  // POST
  ["5000", "EDITORIAL", "Post"],
  ["5100", "PICTURE FINISHING", "Post"],
  ["5200", "POST PRODUCTION SOUND", "Post"],
  ["5300", "CLIPS & CLEARANCES", "Post"],
  ["5400", "TITLES & GRAPHICS", "Post"],
  // MUSIC / VFX
  ["6000", "MUSIC", "Music"],
  ["6100", "VISUAL EFFECTS", "VFX"],
  // OTHER
  ["5500", "PUBLICITY & MARKETING", "Other"],
  ["7000", "ADMINISTRATIVE EXPENSES", "Other"],
  ["7200", "INSURANCE", "Other"],
  ["7900", "COMPLETION BOND", "Other"],
] as const;

export const predictBudgetCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<{ suggestions: PredictSuggestion[] }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY on the server.");

    const catalogueText = CATALOGUE.map(
      ([code, name, group]) => `${code} | ${group} | ${name}`,
    ).join("\n");

    const system = [
      "You are a film-production budget classification assistant.",
      "For each line item description, choose the SINGLE best matching header account from the catalogue.",
      'Return ONLY a compact JSON object: { "results": [ { "id": string, "headerCode": string, "group": "ATL"|"BTL"|"Post"|"Music"|"VFX"|"Other", "confidence": number, "rationale": string } ] }.',
      "Confidence is 0-1. Never invent a code that is not in the catalogue.",
      "Catalogue (code | group | name):\n" + catalogueText,
    ].join("\n\n");

    const userPayload = data.items
      .map(
        (i) =>
          `id=${i.id} | current=${i.currentCode ?? "?"} | desc="${i.description.replace(/\n/g, " ")}"`,
      )
      .join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPayload },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AI gateway failed [${res.status}]: ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { results?: PredictSuggestion[] } = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      // Some models wrap JSON in ```json blocks — best-effort extract.
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          /* noop */
        }
      }
    }

    const validCodes = new Set(CATALOGUE.map(([c]) => c));
    const codeToGroup = new Map<string, PredictSuggestion["group"]>(
      CATALOGUE.map(([c, , g]) => [c, g as PredictSuggestion["group"]]),
    );

    const suggestions: PredictSuggestion[] = (parsed.results ?? [])
      .filter((r) => r && typeof r.id === "string" && validCodes.has(r.headerCode))
      .map((r) => ({
        id: r.id,
        headerCode: r.headerCode,
        group: codeToGroup.get(r.headerCode) ?? "BTL",
        confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
        rationale: r.rationale ? String(r.rationale).slice(0, 200) : undefined,
      }));

    return { suggestions };
  });
