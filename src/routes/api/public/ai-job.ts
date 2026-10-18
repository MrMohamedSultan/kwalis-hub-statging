import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { z } from "zod";
import {
  createLovableAiGatewayProvider,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
} from "@/lib/ai-gateway.server";

const BodySchema = z.object({
  prompt: z.string().min(1).max(50_000),
  system: z.string().max(10_000).optional(),
  model: z.string().min(1).max(120).optional(),
});

/** Constant-time-ish comparison that does not leak length via early exit. */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

export const Route = createFileRoute("/api/public/ai-job")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const jobSecret = process.env.AI_JOB_SECRET;
        if (!jobSecret) {
          return Response.json({ error: "AI_JOB_SECRET is not configured" }, { status: 500 });
        }

        const provided = request.headers.get("X-Job-Secret") ?? "";
        if (!safeEqual(provided, jobSecret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 },
          );
        }

        const lovableApiKey = process.env.LOVABLE_API_KEY;
        if (!lovableApiKey) {
          return Response.json({ error: "LOVABLE_API_KEY is not configured" }, { status: 500 });
        }

        const initialRunId = getLovableAiGatewayRunId(request);
        const gateway = createLovableAiGatewayProvider(lovableApiKey, initialRunId);
        const model = gateway(parsed.data.model ?? "google/gemini-3.6-flash");

        try {
          const result = await generateText({
            model,
            system: parsed.data.system,
            prompt: parsed.data.prompt,
          });

          return Response.json(
            { text: result.text, usage: result.usage },
            { headers: getLovableAiGatewayResponseHeaders(result.response.headers) },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const status = /\b429\b|rate.?limit/i.test(message)
            ? 429
            : /\b402\b|credit/i.test(message)
              ? 402
              : 502;
          console.error(`[ai-job] gateway request failed [${status}]: ${message}`);
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
