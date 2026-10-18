import { useCallback, useRef, useState } from "react";

/**
 * Tracks which export is currently running so buttons can show a spinner.
 *
 * Export libraries (xlsx / exceljs / jspdf) are now fetched on the first
 * click, so there is a short network moment before the file is produced —
 * without feedback that reads as a dead button. Usage:
 *
 *   const { run, isPending } = useExportAction();
 *   <Button disabled={isPending("xlsx")} onClick={() => run("xlsx", exportXlsx)}>
 *     {isPending("xlsx") ? <Loader2 className="animate-spin" /> : <Download />}
 *   </Button>
 */
export function useExportAction() {
  const [pending, setPending] = useState<string | null>(null);
  const active = useRef(false);

  const run = useCallback(async (key: string, action: () => void | Promise<void>) => {
    if (active.current) return;
    active.current = true;
    setPending(key);
    try {
      await action();
    } finally {
      active.current = false;
      setPending(null);
    }
  }, []);

  const isPending = useCallback(
    (key?: string) => (key ? pending === key : pending !== null),
    [pending],
  );

  return { run, isPending, pending };
}
