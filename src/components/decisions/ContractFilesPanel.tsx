// Super admin: move contract files into project folders, then switch the
// contracts bucket to project-scoped reading (db/pending/201).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { FolderInput } from "lucide-react";
import { toast } from "sonner";
import { useAuthRoles } from "@/lib/auth-roles";
import {
  moveContractFilesToProjectFolders,
  type ContractFilesResult,
} from "@/lib/contract-files.functions";

export function ContractFilesPanel() {
  const { t } = useTranslation();
  const roles = useAuthRoles();
  const run = useServerFn(moveContractFilesToProjectFolders);
  const [busy, setBusy] = useState(false);
  const [ignoreOrphans, setIgnoreOrphans] = useState(false);
  const [res, setRes] = useState<ContractFilesResult | null>(null);
  if (!roles.isSuperAdmin) return null;

  const go = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await run({ data: { dryRun, ignoreOrphans, limit: 200 } });
      setRes(r);
      if (!dryRun) {
        toast.success(
          t("decisions.files.done", {
            moved: r.moved,
            policy: t(`decisions.files.policy.${r.policy ?? "skipped"}`),
          }),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const counts = (res?.plan ?? []).reduce<Record<string, number>>((a, r) => {
    a[r.action] = (a[r.action] ?? 0) + 1;
    return a;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FolderInput className="size-4 text-brand" />
        <h2 className="text-base font-semibold">{t("decisions.files.title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{t("decisions.files.hint")}</p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={ignoreOrphans}
          onChange={(e) => setIgnoreOrphans(e.target.checked)}
        />
        {t("decisions.files.ignoreOrphans")}
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={() => void go(true)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          {t("decisions.files.dryRun")}
        </button>
        <button
          disabled={busy || !res}
          onClick={() => void go(false)}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground disabled:opacity-50"
        >
          {t("decisions.files.move")}
        </button>
      </div>
      {res && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(["move", "repoint", "conflict", "orphan"] as const).map((k) => (
              <span key={k}>
                {t(`decisions.files.action.${k}`)}:{" "}
                <b className="text-foreground">{counts[k] ?? 0}</b>
              </span>
            ))}
          </div>
          {res.failed.length > 0 && (
            <ul className="list-disc ps-5 text-xs text-destructive">
              {res.failed.slice(0, 20).map((f) => (
                <li key={f.object_name} dir="ltr">
                  {f.object_name}: {f.error}
                </li>
              ))}
            </ul>
          )}
          <div className="max-h-64 overflow-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-2/60 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-start">{t("decisions.files.file")}</th>
                  <th className="px-2 py-1 text-start">{t("decisions.files.newPath")}</th>
                  <th className="px-2 py-1 text-start">{t("decisions.files.owner")}</th>
                  <th className="px-2 py-1 text-start">{t("decisions.files.actionCol")}</th>
                </tr>
              </thead>
              <tbody>
                {res.plan.slice(0, 300).map((r) => (
                  <tr key={r.object_name + r.action} className="border-t border-border">
                    <td className="px-2 py-1 font-mono" dir="ltr">
                      {r.object_name}
                    </td>
                    <td className="px-2 py-1 font-mono" dir="ltr">
                      {r.new_name ?? "—"}
                    </td>
                    <td className="px-2 py-1">{r.owner_table ?? "—"}</td>
                    <td className="px-2 py-1">{t(`decisions.files.action.${r.action}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
