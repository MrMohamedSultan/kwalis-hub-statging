import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import i18n from "@/lib/i18n";
export type BarKind = "shoot" | "editors" | "directors" | "sound" | "color" | "prep";
export type Bar = {
  id: string;
  row: string;
  kind: BarKind;
  label: string;
  start: string;
  end: string;
  cashAlert?: boolean;
};

export type MilestoneKind = "vfx" | "imf" | "holiday" | "bible" | "delivery";
export type Milestone = {
  id: string;
  row: string;
  kind: MilestoneKind;
  label: string;
  date: string;
};

export type VersionStatus = "Active" | "Draft" | "Pending Approval" | "Archived";
export type Version = { id: string; label: string; date: string; status: VersionStatus };

export type TimelineSnapshot = { bars: Bar[]; milestones: Milestone[]; versions: Version[] };

const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function displayDateToIso(input: string): string | null {
  if (!input) return null;
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}
function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function rowToBar(r: any): Bar {
  return {
    id: r.id,
    row: r.row_key,
    kind: r.kind as BarKind,
    label: r.label,
    start: r.start_date,
    end: r.end_date,
    cashAlert: !!r.cash_alert || undefined,
  };
}
function rowToMilestone(r: any): Milestone {
  return {
    id: r.id,
    row: r.row_key,
    kind: r.kind as MilestoneKind,
    label: r.label,
    date: r.milestone_date,
  };
}
function rowToVersion(r: any): Version {
  return {
    id: r.code,
    label: r.label,
    date: isoToDisplay(r.version_date),
    status: (r.status ?? "Draft") as VersionStatus,
  };
}

type Options = {
  projectId: string | null;
  organizationId: string | null;
};

/** Every project starts on a single, completely empty draft. No seed data. */
const BLANK_VERSION_CODE = "v1";

export function useTimelineData(opts: Options) {
  const { projectId, organizationId } = opts;

  const [snap, setSnap] = useState<TimelineSnapshot>({
    bars: [],
    milestones: [],
    versions: [],
  });

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  // Map local version.id (e.g. "v32") → DB uuid
  const versionUuidMap = useRef<Map<string, string>>(new Map());
  const lastSyncedRef = useRef<TimelineSnapshot | null>(null);
  // Latest observed updated_at per row id (for conflict detection)
  const rowVersionsRef = useRef<Map<string, string>>(new Map());
  // Ids we mutated locally most recently — used to distinguish our echoes from remote edits
  const localOriginRef = useRef<Map<string, number>>(new Map());
  const markLocal = (id: string) => localOriginRef.current.set(id, Date.now());
  const isRecentLocal = (id: string) => {
    const t = localOriginRef.current.get(id);
    return typeof t === "number" && Date.now() - t < 4000;
  };
  // Currently open user batch (multi-step edit collapsed into one undo entry)
  const batchDepthRef = useRef(0);
  const batchBaselineRef = useRef<TimelineSnapshot | null>(null);
  const batchActiveVersionRef = useRef<string | null>(null);

  const undoRef = useRef<TimelineSnapshot[]>([]);
  const redoRef = useRef<TimelineSnapshot[]>([]);
  const [, setHistoryTick] = useState(0);
  const bumpHistory = () => setHistoryTick((t) => t + 1);

  // ── Load / seed ──
  useEffect(() => {
    if (!projectId) {
      setReady(false);
      setLoading(false);
      lastSyncedRef.current = null;
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [{ data: vs, error: ve }, { data: bs, error: be }, { data: ms, error: me }] =
          await Promise.all([
            supabase
              .from("timeline_versions" as any)
              .select("*")
              .eq("project_id", projectId)
              .order("created_at", { ascending: false }),
            supabase
              .from("timeline_bars" as any)
              .select("*")
              .eq("project_id", projectId),
            supabase
              .from("timeline_milestones" as any)
              .select("*")
              .eq("project_id", projectId),
          ]);
        if (ve) throw ve;
        if (be) throw be;
        if (me) throw me;
        if (cancelled) return;

        const vsList = (vs ?? []) as any[];
        const captureVersions = (rows: any[]) => {
          for (const r of rows)
            rowVersionsRef.current.set(r.id, r.updated_at ?? r.created_at ?? "");
        };
        if (vsList.length === 0) {
          // Brand-new project → create ONE empty draft. No bars, no milestones.
          const { data: seededVs, error: sVe } = await supabase
            .from("timeline_versions" as any)
            .insert([
              {
                project_id: projectId,
                organization_id: organizationId,
                code: BLANK_VERSION_CODE,
                label: BLANK_VERSION_CODE,
                version_date: new Date().toISOString().slice(0, 10),
                status: "Draft",
                is_active: true,
              },
            ])
            .select("*");
          if (sVe) throw sVe;
          const seededRows = (seededVs ?? []) as any[];
          versionUuidMap.current = new Map(seededRows.map((v: any) => [v.code, v.id]));
          captureVersions(seededRows);
          const next: TimelineSnapshot = {
            versions: seededRows.map(rowToVersion),
            bars: [],
            milestones: [],
          };
          if (!cancelled) {
            setSnap(next);
            lastSyncedRef.current = next;
            setReady(true);
          }
        } else {
          versionUuidMap.current = new Map(vsList.map((v: any) => [v.code, v.id]));
          captureVersions(vsList);
          captureVersions((bs ?? []) as any[]);
          captureVersions((ms ?? []) as any[]);
          const next: TimelineSnapshot = {
            versions: vsList.map(rowToVersion),
            bars: (bs ?? []).map(rowToBar),
            milestones: (ms ?? []).map(rowToMilestone),
          };
          if (!cancelled) {
            setSnap(next);
            lastSyncedRef.current = next;
            setReady(true);
          }
        }
      } catch (err: any) {
        console.error("[timeline] load failed", err);
        if (!cancelled) {
          toast.error(i18n.t("timeline_store.couldnt_load_timeline_from_the_server_showing_local"));
          lastSyncedRef.current = null;
          setReady(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Realtime subscription ──
  useEffect(() => {
    if (!projectId) return;
    const applyRemoteChange = (
      kind: "bar" | "milestone" | "version",
      eventType: "INSERT" | "UPDATE" | "DELETE",
      newRow: any,
      oldRow: any,
    ) => {
      const rowId = (newRow?.id ?? oldRow?.id) as string | undefined;
      if (!rowId) return;

      // Detect conflict: we changed this row locally, and a remote update
      // with a different updated_at just arrived.
      if (eventType !== "DELETE" && isRecentLocal(rowId)) {
        const knownUpdatedAt = rowVersionsRef.current.get(rowId);
        const incomingUpdatedAt = newRow?.updated_at;
        if (incomingUpdatedAt && knownUpdatedAt && incomingUpdatedAt !== knownUpdatedAt) {
          toast.warning(i18n.t("timeline_store.a_newer_change_from_another_device_replaced_yours"));
        }
      }

      if (eventType === "DELETE") {
        rowVersionsRef.current.delete(rowId);
      } else if (newRow?.updated_at) {
        rowVersionsRef.current.set(rowId, newRow.updated_at);
      }

      setSnap((prev) => {
        const next: TimelineSnapshot = {
          bars: prev.bars.slice(),
          milestones: prev.milestones.slice(),
          versions: prev.versions.slice(),
        };
        if (kind === "bar") {
          const idx = next.bars.findIndex((b) => b.id === rowId);
          if (eventType === "DELETE") {
            if (idx >= 0) next.bars.splice(idx, 1);
          } else {
            const mapped = rowToBar(newRow);
            if (idx >= 0) next.bars[idx] = mapped;
            else next.bars.push(mapped);
          }
        } else if (kind === "milestone") {
          const idx = next.milestones.findIndex((m) => m.id === rowId);
          if (eventType === "DELETE") {
            if (idx >= 0) next.milestones.splice(idx, 1);
          } else {
            const mapped = rowToMilestone(newRow);
            if (idx >= 0) next.milestones[idx] = mapped;
            else next.milestones.push(mapped);
          }
        } else if (kind === "version") {
          const code = newRow?.code ?? oldRow?.code;
          const idx = next.versions.findIndex((v) => v.id === code);
          if (eventType === "DELETE") {
            if (idx >= 0) next.versions.splice(idx, 1);
            versionUuidMap.current.delete(code);
          } else {
            const mapped = rowToVersion(newRow);
            if (idx >= 0) next.versions[idx] = mapped;
            else next.versions.unshift(mapped);
            if (newRow?.id) versionUuidMap.current.set(code, newRow.id);
          }
        }
        lastSyncedRef.current = next;
        return next;
      });
    };

    const channel = supabase
      .channel(`timeline-${projectId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "timeline_bars",
          filter: `project_id=eq.${projectId}`,
        },
        (payload: any) => applyRemoteChange("bar", payload.eventType, payload.new, payload.old),
      )
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "timeline_milestones",
          filter: `project_id=eq.${projectId}`,
        },
        (payload: any) =>
          applyRemoteChange("milestone", payload.eventType, payload.new, payload.old),
      )
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "timeline_versions",
          filter: `project_id=eq.${projectId}`,
        },
        (payload: any) => applyRemoteChange("version", payload.eventType, payload.new, payload.old),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  // ── Diff & sync ──
  const syncSnapshot = useCallback(
    async (next: TimelineSnapshot, activeVersionCode: string) => {
      if (!projectId || !lastSyncedRef.current) return;
      const prev = lastSyncedRef.current;
      try {
        const activeVid = versionUuidMap.current.get(activeVersionCode) ?? null;

        // ---- Bars diff ----
        const prevBars = new Map(prev.bars.map((b) => [b.id, b]));
        const nextBars = new Map(next.bars.map((b) => [b.id, b]));
        const barInserts: any[] = [];
        const barUpdates: { id: string; patch: any }[] = [];
        const barDeleteIds: string[] = [];
        for (const [id, b] of nextBars) {
          const p = prevBars.get(id);
          if (!p) {
            if (!activeVid) continue;
            barInserts.push({
              ...(isUuid(id) ? { id } : {}),
              project_id: projectId,
              organization_id: organizationId,
              version_id: activeVid,
              row_key: b.row,
              kind: b.kind,
              label: b.label,
              start_date: b.start,
              end_date: b.end,
              cash_alert: !!b.cashAlert,
            });
          } else if (JSON.stringify(p) !== JSON.stringify(b) && isUuid(id)) {
            barUpdates.push({
              id,
              patch: {
                row_key: b.row,
                kind: b.kind,
                label: b.label,
                start_date: b.start,
                end_date: b.end,
                cash_alert: !!b.cashAlert,
              },
            });
            markLocal(id);
          }
        }
        for (const [id] of prevBars) {
          if (!nextBars.has(id) && isUuid(id)) {
            barDeleteIds.push(id);
            markLocal(id);
          }
        }

        // ---- Milestones diff ----
        const prevMs = new Map(prev.milestones.map((m) => [m.id, m]));
        const nextMs = new Map(next.milestones.map((m) => [m.id, m]));
        const msInserts: any[] = [];
        const msUpdates: { id: string; patch: any }[] = [];
        const msDeleteIds: string[] = [];
        for (const [id, m] of nextMs) {
          const p = prevMs.get(id);
          if (!p) {
            if (!activeVid) continue;
            msInserts.push({
              ...(isUuid(id) ? { id } : {}),
              project_id: projectId,
              organization_id: organizationId,
              version_id: activeVid,
              row_key: m.row,
              kind: m.kind,
              label: m.label,
              milestone_date: m.date,
            });
          } else if (JSON.stringify(p) !== JSON.stringify(m) && isUuid(id)) {
            msUpdates.push({
              id,
              patch: { row_key: m.row, kind: m.kind, label: m.label, milestone_date: m.date },
            });
            markLocal(id);
          }
        }
        for (const [id] of prevMs) {
          if (!nextMs.has(id) && isUuid(id)) {
            msDeleteIds.push(id);
            markLocal(id);
          }
        }

        // ---- Versions diff ----
        const prevVs = new Map(prev.versions.map((v) => [v.id, v]));
        const nextVs = new Map(next.versions.map((v) => [v.id, v]));
        const vInserts: any[] = [];
        const vUpdates: { code: string; patch: any }[] = [];
        for (const [code, v] of nextVs) {
          const p = prevVs.get(code);
          if (!p) {
            vInserts.push({
              project_id: projectId,
              organization_id: organizationId,
              code: v.id,
              label: v.label,
              version_date: displayDateToIso(v.date),
              status: v.status,
              is_active: false,
            });
          } else if (p.status !== v.status || p.label !== v.label || p.date !== v.date) {
            vUpdates.push({
              code: v.id,
              patch: { label: v.label, version_date: displayDateToIso(v.date), status: v.status },
            });
          }
        }

        const ops: Promise<any>[] = [];
        if (barInserts.length)
          ops.push(supabase.from("timeline_bars" as any).insert(barInserts) as any);
        for (const u of barUpdates)
          ops.push(
            supabase
              .from("timeline_bars" as any)
              .update(u.patch)
              .eq("id", u.id) as any,
          );
        if (barDeleteIds.length)
          ops.push(
            supabase
              .from("timeline_bars" as any)
              .delete()
              .in("id", barDeleteIds) as any,
          );
        if (msInserts.length)
          ops.push(supabase.from("timeline_milestones" as any).insert(msInserts) as any);
        for (const u of msUpdates)
          ops.push(
            supabase
              .from("timeline_milestones" as any)
              .update(u.patch)
              .eq("id", u.id) as any,
          );
        if (msDeleteIds.length)
          ops.push(
            supabase
              .from("timeline_milestones" as any)
              .delete()
              .in("id", msDeleteIds) as any,
          );
        if (vInserts.length)
          ops.push(supabase.from("timeline_versions" as any).insert(vInserts) as any);
        for (const u of vUpdates)
          ops.push(
            supabase
              .from("timeline_versions" as any)
              .update(u.patch)
              .eq("project_id", projectId)
              .eq("code", u.code) as any,
          );

        if (ops.length === 0) return;

        const results = await Promise.all(ops);
        const failed = results.find((r: any) => r?.error);
        if (failed?.error) throw failed.error;

        // Refresh id maps for inserted rows so future edits target real uuids
        if (barInserts.length || msInserts.length || vInserts.length) {
          const [{ data: freshBars }, { data: freshMs }, { data: freshVs }] = await Promise.all([
            supabase
              .from("timeline_bars" as any)
              .select("*")
              .eq("project_id", projectId),
            supabase
              .from("timeline_milestones" as any)
              .select("*")
              .eq("project_id", projectId),
            supabase
              .from("timeline_versions" as any)
              .select("*")
              .eq("project_id", projectId)
              .order("created_at", { ascending: false }),
          ]);
          if (freshVs)
            versionUuidMap.current = new Map((freshVs as any[]).map((v: any) => [v.code, v.id]));
          for (const r of (freshBars ?? []) as any[])
            rowVersionsRef.current.set(r.id, r.updated_at ?? "");
          for (const r of (freshMs ?? []) as any[])
            rowVersionsRef.current.set(r.id, r.updated_at ?? "");
          for (const r of (freshVs ?? []) as any[])
            rowVersionsRef.current.set(r.id, r.updated_at ?? "");
          const refreshed: TimelineSnapshot = {
            bars: ((freshBars ?? []) as any[]).map(rowToBar),
            milestones: ((freshMs ?? []) as any[]).map(rowToMilestone),
            versions: ((freshVs ?? []) as any[]).map(rowToVersion),
          };
          setSnap(refreshed);
          lastSyncedRef.current = refreshed;
        } else {
          lastSyncedRef.current = next;
        }
      } catch (err: any) {
        console.error("[timeline] sync failed", err);
        toast.error(
          i18n.t("timeline_store.couldnt_save_timeline_change") + (err?.message ?? "unknown error"),
        );
      }
    },
    [projectId, organizationId],
  );

  // ── Public mutators ──
  const commit = useCallback(
    (recipe: (draft: TimelineSnapshot) => TimelineSnapshot | void, activeVersionCode: string) => {
      const insideBatch = batchDepthRef.current > 0;
      setSnap((prev) => {
        const draft: TimelineSnapshot = {
          bars: prev.bars.map((b) => ({ ...b })),
          milestones: prev.milestones.map((m) => ({ ...m })),
          versions: prev.versions.map((v) => ({ ...v })),
        };
        const returned = recipe(draft);
        const next = returned ?? draft;

        if (insideBatch) {
          // Don't push per-step history; batch flush handles it. Don't sync yet.
          if (!batchBaselineRef.current) batchBaselineRef.current = prev;
          batchActiveVersionRef.current = activeVersionCode;
        } else {
          undoRef.current.push(prev);
          if (undoRef.current.length > 100) undoRef.current.shift();
          redoRef.current = [];
          bumpHistory();
          void syncSnapshot(next, activeVersionCode);
        }
        return next;
      });
    },
    [syncSnapshot],
  );

  const beginBatch = useCallback(() => {
    batchDepthRef.current += 1;
    if (batchDepthRef.current === 1) {
      batchBaselineRef.current = null;
      batchActiveVersionRef.current = null;
    }
  }, []);

  const endBatch = useCallback(() => {
    if (batchDepthRef.current === 0) return;
    batchDepthRef.current -= 1;
    if (batchDepthRef.current > 0) return;
    const baseline = batchBaselineRef.current;
    const activeCode = batchActiveVersionRef.current;
    batchBaselineRef.current = null;
    batchActiveVersionRef.current = null;
    if (!baseline || !activeCode) return;
    setSnap((cur) => {
      // Only push history + sync if something actually changed
      if (JSON.stringify(baseline) !== JSON.stringify(cur)) {
        undoRef.current.push(baseline);
        if (undoRef.current.length > 100) undoRef.current.shift();
        redoRef.current = [];
        bumpHistory();
        void syncSnapshot(cur, activeCode);
      }
      return cur;
    });
  }, [syncSnapshot]);

  const undo = useCallback(
    (activeVersionCode: string) => {
      const prev = undoRef.current.pop();
      if (!prev) return false;
      setSnap((cur) => {
        redoRef.current.push(cur);
        bumpHistory();
        void syncSnapshot(prev, activeVersionCode);
        return prev;
      });
      return true;
    },
    [syncSnapshot],
  );

  const redo = useCallback(
    (activeVersionCode: string) => {
      const next = redoRef.current.pop();
      if (!next) return false;
      setSnap((cur) => {
        undoRef.current.push(cur);
        bumpHistory();
        void syncSnapshot(next, activeVersionCode);
        return next;
      });
      return true;
    },
    [syncSnapshot],
  );

  return {
    snap,
    ready,
    loading,
    commit,
    beginBatch,
    endBatch,
    undo,
    redo,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
  };
}
