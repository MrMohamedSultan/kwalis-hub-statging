// Hook form of canExportPersonalData (src/lib/crewcast-csv.ts): every CSV
// that carries IBAN / bank / ID / contact data of crew, cast or vendor
// contracts asks this before writing those columns.
import { useEffect, useState } from "react";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { fetchCanAdminRebateSettings } from "@/lib/rebate-settings";
import { useStore } from "@/lib/store";
import { canExportPersonalData } from "@/lib/crewcast-csv";

export function useCanExportPersonalData(): (kind: string | null | undefined) => boolean {
  const perms = usePermissions();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const [rebateAdmin, setRebateAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    setRebateAdmin(false);
    if (activeProjectId)
      void fetchCanAdminRebateSettings(activeProjectId)
        .then((v) => live && setRebateAdmin(v))
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [activeProjectId]);
  const access = {
    rebateAdmin,
    canEditCrew: perms.canEdit("crew-contracts"),
    canEditCast: perms.canEdit("cast-contracts"),
  };
  return (kind) => canExportPersonalData(access, kind);
}
