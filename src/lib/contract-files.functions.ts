import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Contracts bucket: move files saved by old app versions outside a project
 * folder into <project_id>/<old path> (owner decision 28/10, db/pending/201).
 *
 *   1. the plan comes from move_contract_files_to_project_folders(true),
 *      called with the CALLER's token — it refuses anyone but a platform
 *      super admin, so the service role never decides who may do this;
 *   2. the bytes are moved with the Storage API (service role: an UPDATE of
 *      storage.objects does not move the file);
 *   3. repoint_contract_file(old, new) updates every path column that
 *      pointed at the file in one transaction (caller's token again). If it
 *      fails the file is moved back, so no reference ever points nowhere;
 *   4. switch_contracts_bucket_to_project_policy() drops the org-wide read
 *      policy only when nothing is left to move.
 */

const MoveSchema = z.object({
  dryRun: z.boolean().default(true),
  /** Unreferenced files may stay where they are (only super admins read them after the switch). */
  ignoreOrphans: z.boolean().default(false),
  /** Files moved per call (re-run until nothing is left). */
  limit: z.number().int().min(1).max(500).default(200),
});

export type ContractFilePlanRow = {
  object_name: string;
  new_name: string | null;
  owner_table: string | null;
  owner_id: string | null;
  project_id: string | null;
  action: "move" | "repoint" | "repointed" | "orphan" | "conflict";
};

export type ContractFilesResult = {
  plan: ContractFilePlanRow[];
  moved: number;
  failed: { object_name: string; error: string }[];
  policy: string | null;
};

const SAFE_PATH = /^[^\0]{1,1024}$/;

export const moveContractFilesToProjectFolders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MoveSchema.parse(input))
  .handler(async ({ data, context }): Promise<ContractFilesResult> => {
    const { supabase } = context;
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args);

    // 1. authorise (super admin) + plan; dry_run = false also repoints files already moved
    const { data: planData, error: planErr } = await rpc("move_contract_files_to_project_folders", {
      dry_run: data.dryRun,
    });
    if (planErr) throw new Error(planErr.message);
    const plan = (planData ?? []) as ContractFilePlanRow[];
    if (data.dryRun) return { plan, moved: 0, failed: [], policy: null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bucket = supabaseAdmin.storage.from("contracts");
    let moved = 0;
    const failed: ContractFilesResult["failed"] = [];
    for (const row of plan.filter((r) => r.action === "move").slice(0, data.limit)) {
      const from = row.object_name;
      const to = row.new_name;
      if (!to || !SAFE_PATH.test(from) || !SAFE_PATH.test(to) || !to.endsWith("/" + from)) {
        failed.push({ object_name: from, error: "invalid path" });
        continue;
      }
      // 2. bytes
      const { error: mvErr } = await bucket.move(from, to);
      if (mvErr) {
        failed.push({ object_name: from, error: mvErr.message });
        continue;
      }
      // 3. references (one transaction); undo the move if it fails
      const { error: rpErr } = await rpc("repoint_contract_file", { p_old: from, p_new: to });
      if (rpErr) {
        await bucket.move(to, from);
        failed.push({ object_name: from, error: rpErr.message });
        continue;
      }
      moved += 1;
    }

    // 4. policy switch (skipped by the database while files remain)
    const { data: policy, error: swErr } = await rpc("switch_contracts_bucket_to_project_policy", {
      p_ignore_orphans: data.ignoreOrphans,
    });
    if (swErr) throw new Error(swErr.message);
    const { data: after } = await rpc("move_contract_files_to_project_folders", { dry_run: true });
    return {
      plan: (after ?? []) as ContractFilePlanRow[],
      moved,
      failed,
      policy: (policy as string | null) ?? null,
    };
  });
