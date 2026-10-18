// ═══════════════════════════════════════════════════════════════════
// src/routes/_authenticated/main-hub.tsx
// Project Selection Gateway — the authenticated entry point.
//
// Users pick a project workspace here. Selecting a card sets the global
// active project (useStore.setActiveProject) and enters /dashboard.
// Inner routes are guarded: no active project → redirect back here.
// ═══════════════════════════════════════════════════════════════════

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Check,
  Clapperboard,
  Megaphone,
  Plus,
  Search,
  SearchX,
  Tv,
} from "lucide-react";
import { useStore, type ProductionKind, type ProjectSummary } from "@/lib/store";
import { ProjectStatusBadge } from "@/components/ProjectBadges";
import { CreateProjectModal } from "@/components/CreateProjectModal";
import { useAuthRoles } from "@/lib/auth-roles";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { firstViewableModulePath } from "@/lib/permissions/landing";
import { APP_NAME } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/main-hub")({
  head: () => ({
    meta: [
      { title: `Select a Project — ${APP_NAME}` },
      {
        name: "description",
        content:
          "Project Selection Gateway — choose a production workspace to enter. Every project is fully isolated.",
      },
      { property: "og:title", content: `Select a Project — ${APP_NAME}` },
      {
        property: "og:description",
        content: "Choose a production workspace to enter. Every project is fully isolated.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MainHubPage,
});

const KIND_ICON: Record<ProductionKind, typeof Clapperboard> = {
  film: Clapperboard,
  series: Tv,
  commercial: Megaphone,
};

const KIND_LABEL_KEY: Record<ProductionKind, string> = {
  film: "gateway.kindFilm",
  series: "gateway.kindSeries",
  commercial: "gateway.kindCommercial",
};

function ProjectCard({
  project,
  isActive,
  isSelecting,
  onSelect,
}: {
  project: ProjectSummary;
  isActive: boolean;
  isSelecting: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const KindIcon = KIND_ICON[project.productionKind] ?? Clapperboard;

  return (
    <button
      type="button"
      onClick={() => onSelect(project.id)}
      disabled={isSelecting}
      aria-busy={isSelecting}
      className={`group relative flex flex-col w-full sm:w-[calc(50%-10px)] xl:w-[calc(33.333%-14px)] max-w-[420px] text-start rounded-2xl border bg-card p-6 min-h-[180px] transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand hover:-translate-y-1 hover:shadow-xl hover:shadow-black/20 disabled:opacity-70 disabled:cursor-wait ${
        isActive ? "border-brand/60 ring-1 ring-brand/40" : "border-border hover:border-brand/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3 w-full">
        <div className="size-12 rounded-xl bg-brand/15 ring-1 ring-brand/30 grid place-items-center shrink-0">
          <KindIcon className="size-6 text-brand" />
        </div>
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/15 text-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            <Check className="size-3" />
            {t("gateway.current")}
          </span>
        )}
      </div>

      <div className="mt-4 min-w-0 w-full">
        <div className="flex items-center gap-2 min-w-0">
          {project.code && (
            <span className="inline-flex items-center rounded-md border border-brand/40 bg-brand/15 text-brand px-1.5 py-0.5 text-[10px] font-bold tracking-wider shrink-0">
              {project.code}
            </span>
          )}
          <h3 className="text-lg font-semibold leading-tight truncate">{project.name}</h3>
        </div>
        {project.organizationName && (
          <div className="text-xs text-muted-foreground mt-1 truncate">
            {project.organizationName}
          </div>
        )}
      </div>

      <div className="mt-auto pt-4 flex items-center justify-between gap-2 w-full">
        <div className="flex items-center gap-2 min-w-0">
          <ProjectStatusBadge value={project.status} />
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
            {t(KIND_LABEL_KEY[project.productionKind] ?? "gateway.kindFilm")}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {t("gateway.enter")}
          <ArrowRight className="size-3.5 rtl:-scale-x-100" />
        </span>
      </div>
    </button>
  );
}

function MainHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const bootstrap = useStore((s) => s.bootstrap);
  const ready = useStore((s) => s.ready);
  const [query, setQuery] = useState("");
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { isSuperAdmin, adminOrgIds, loaded: rolesLoaded } = useAuthRoles();
  // Only platform super admins and company owners/admins may create projects.
  const canCreate = rolesLoaded && (isSuperAdmin || adminOrgIds.length > 0);
  // Phase 5: after selection, land on the first module the role can view.
  const permissionState = usePermissions();

  useEffect(() => {
    if (!ready) bootstrap();
  }, [ready, bootstrap]);

  // Single-project users bypass the selector entirely: if exactly one project
  // is authorized, select it and go straight to the workspace.
  const autoEnteredRef = useRef(false);
  useEffect(() => {
    if (!ready || autoEnteredRef.current) return;
    if (projects.length !== 1) return;
    autoEnteredRef.current = true;
    void (async () => {
      await setActiveProject(projects[0].id);
      const target = firstViewableModulePath(permissionState) ?? "/dashboard";
      navigate({ to: target as "/" });
    })();
  }, [ready, projects, setActiveProject, navigate, permissionState]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q) ||
        (p.organizationName ?? "").toLowerCase().includes(q),
    );
  }, [projects, query]);

  const handleSelect = async (id: string) => {
    if (selectingId) return;
    setSelectingId(id);
    try {
      await setActiveProject(id);
      // Phase 5: first viewable module by sort_order (admins/legacy users
      // fall back to /dashboard via the resolver).
      const target = firstViewableModulePath(permissionState) ?? "/dashboard";
      navigate({ to: target as "/" });
    } finally {
      setSelectingId(null);
    }
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center py-6 lg:py-10">
      <div className="w-full max-w-6xl">
        {/* ── Header ── */}
        <div className="text-center mb-8 lg:mb-10">
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight">{t("gateway.title")}</h1>
          <p className="text-muted-foreground mt-3 text-sm lg:text-base max-w-xl mx-auto">
            {t("gateway.subtitle")}
          </p>
        </div>

        {/* ── Search + admin create ── */}
        {ready && projects.length > 0 && (
          <div className="mx-auto mb-8 flex w-full max-w-md items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("gateway.searchPlaceholder")}
                aria-label={t("gateway.searchPlaceholder")}
                className="w-full rounded-xl bg-surface-2 border border-border text-foreground placeholder:text-muted-foreground text-sm ps-9 pe-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-brand px-3.5 py-2.5 text-sm font-semibold text-brand-foreground hover:brightness-110"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">{t("gateway.createProject")}</span>
              </button>
            )}
          </div>
        )}

        {/* ── Grid ── */}
        {!ready ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border bg-card min-h-[180px] p-6 animate-pulse"
              >
                <div className="size-12 rounded-xl bg-muted" />
                <div className="h-5 w-2/3 rounded bg-muted mt-4" />
                <div className="h-3 w-1/3 rounded bg-muted mt-2" />
                <div className="h-5 w-24 rounded-full bg-muted mt-6" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-10 text-center flex flex-col items-center gap-4">
            <div className="size-16 rounded-2xl bg-muted/50 grid place-items-center">
              <Clapperboard className="size-8 text-muted-foreground" />
            </div>
            <div className="text-lg font-semibold">{t("gateway.emptyTitle")}</div>
            <p className="text-sm text-muted-foreground">{t("gateway.emptyBody")}</p>
            {canCreate && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground hover:brightness-110"
              >
                <Plus className="size-4" />
                {t("gateway.createProject")}
              </button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-10 text-center flex flex-col items-center gap-3">
            <SearchX className="size-8 text-muted-foreground" />
            <div className="text-sm font-medium">{t("gateway.noMatches")}</div>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-xs font-semibold text-brand hover:underline"
            >
              {t("appshell.clear_search")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-5">
            {filtered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                isActive={p.id === activeProjectId}
                isSelecting={selectingId === p.id}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}
      </div>

      {createOpen && canCreate && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            // Reload the gateway grid so the new project card appears.
            await bootstrap();
          }}
        />
      )}
    </div>
  );
}
