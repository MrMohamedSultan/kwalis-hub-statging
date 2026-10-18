// ═══════════════════════════════════════════════════════════════════
// src/components/role-management/UnsavedChangesBar.tsx
// Phase 7 — sticky batched-save bar. Appears while the matrix draft
// differs from the server baseline; Save persists the whole diff in
// one request, Discard restores the baseline.
// ═══════════════════════════════════════════════════════════════════

import { useTranslation } from "react-i18next";
import { Loader2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UnsavedChangesBar({
  count,
  saving,
  onSave,
  onDiscard,
}: {
  count: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-lg shadow-background/40">
        <span className="text-xs font-semibold text-foreground">
          {t("roleMgmt.unsaved", { count })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onDiscard}
          disabled={saving}
        >
          <Undo2 className="size-3.5 me-1" />
          {t("roleMgmt.discard")}
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={onSave} disabled={saving}>
          {saving ? (
            <Loader2 className="size-3.5 me-1 animate-spin" />
          ) : (
            <Save className="size-3.5 me-1" />
          )}
          {saving ? t("roleMgmt.saving") : t("roleMgmt.save")}
        </Button>
      </div>
    </div>
  );
}
