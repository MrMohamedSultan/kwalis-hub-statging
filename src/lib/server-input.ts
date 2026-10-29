import { z } from "zod";

// X05: every createServerFn validates its input with zod. Functions that
// take no input accept nothing (undefined / null / {}) and refuse anything
// else, so an unexpected payload never reaches a handler.
export const NoInputSchema = z
  .union([z.undefined(), z.null(), z.object({}).strict()])
  .transform(() => undefined);

export function noInput(input: unknown): undefined {
  return NoInputSchema.parse(input);
}
