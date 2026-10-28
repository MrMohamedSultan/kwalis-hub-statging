import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageTitle, Panel } from "@/components/AppShell";
import { useStore } from "@/lib/store";
import { useCharacters, createCharacter, updateCharacter, deleteCharacter } from "@/lib/characters";
import {
  useCharacterRoleTypes,
  addRoleType,
  deleteRoleType,
  renameRoleType,
  roleTone,
} from "@/lib/character-role-types";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X, Check, Users, Tags } from "lucide-react";

import { useTranslation } from "react-i18next";
/** Role types are a per-project taxonomy, editable from the panel below. */
type CharacterRoleType = string;

function CharactersPage() {
  const { t } = useTranslation();

  const projectId = useStore((s) => s.activeProjectId);
  const activeProject = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const orgId = activeProject?.organizationId ?? null;
  const isSeries = activeProject?.productionKind === "series";
  const { characters, loading, refresh } = useCharacters();
  const { roleTypes, labels: roleLabels, refresh: refreshRoles } = useCharacterRoleTypes();
  const defaultRole = roleLabels[0] ?? "Main";

  const [seasons, setSeasons] = useState<
    Array<{ id: string; season_number: number; title: string }>
  >([]);
  const [budgetLines, setBudgetLines] = useState<
    Array<{ id: string; main_code: string; description: string }>
  >([]);
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      if (isSeries) {
        const { data } = await supabase
          .from("series_seasons" as any)
          .select("id, season_number, title")
          .eq("project_id", projectId)
          .order("season_number");
        setSeasons((data ?? []) as any);
      }
      const { data: bl } = await supabase
        .from("v_active_budget_lines" as any)
        .select("id, main_code, description, group")
        .eq("project_id", projectId)
        .eq("group", "ATL");
      setBudgetLines((bl ?? []) as any);
    })();
  }, [projectId, isSeries]);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    roleType: CharacterRoleType;
    description: string;
    seasonId: string | null;
    budgetLineId: string | null;
  }>({
    name: "",
    roleType: "Main",
    description: "",
    seasonId: null,
    budgetLineId: null,
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<typeof draft>({
    name: "",
    roleType: "Main",
    description: "",
    seasonId: null,
    budgetLineId: null,
  });

  const resetDraft = () =>
    setDraft({ name: "", roleType: "Main", description: "", seasonId: null, budgetLineId: null });

  const submitNew = async () => {
    if (!projectId) {
      toast.error(t("characters.select_a_project_first"));
      return;
    }
    if (!draft.name.trim()) {
      toast.error(t("characters.character_name_is_required"));
      return;
    }
    try {
      await createCharacter({
        projectId,
        organizationId: orgId,
        name: draft.name,
        roleType: draft.roleType,
        description: draft.description || null,
        seasonId: draft.seasonId,
        budgetLineId: draft.budgetLineId,
      });
      toast.success(`Added character "${draft.name}"`);
      setAdding(false);
      resetDraft();
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create character");
    }
  };

  const startEdit = (id: string) => {
    const c = characters.find((x) => x.id === id);
    if (!c) return;
    setEditing(id);
    setEditDraft({
      name: c.name,
      roleType: c.role_type,
      description: c.description ?? "",
      seasonId: c.season_id,
      budgetLineId: c.budget_line_id,
    });
  };
  const saveEdit = async () => {
    if (!editing) return;
    try {
      await updateCharacter(editing, {
        name: editDraft.name,
        role_type: editDraft.roleType,
        description: editDraft.description || null,
        season_id: editDraft.seasonId,
        budget_line_id: editDraft.budgetLineId,
      });
      toast.success(t("characters.character_updated"));
      setEditing(null);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update");
    }
  };
  const remove = async (id: string, name: string) => {
    if (
      !confirm(
        `Delete character "${name}"? Cast members assigned to this character will keep their contract but lose the link.`,
      )
    )
      return;
    try {
      await deleteCharacter(id);
      toast.success(t("characters.character_removed"));
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove");
    }
  };

  // Group by the project's taxonomy, plus any legacy label still in use so no
  // character is ever hidden after a role type is renamed or removed.
  const usedLabels = Array.from(new Set(characters.map((c) => c.role_type).filter(Boolean)));
  const allLabels = [...roleLabels, ...usedLabels.filter((l) => !roleLabels.includes(l))];
  const grouped = allLabels.map((rt) => ({
    rt,
    list: characters.filter((c) => c.role_type === rt),
  }));

  return (
    <AppShell>
      <PageTitle title={t("characters.characters")} />
      <p className="text-sm text-muted-foreground -mt-3 mb-4 flex items-center gap-2">
        <Users className="size-4" />
        Fictional roles Cast members are contracted to play. Link a character to a series season and
        a Budget line so cast contracts auto-fill actuals.
      </p>
      <RoleTypeManager
        roleTypes={roleTypes}
        projectId={projectId}
        orgId={orgId}
        onChanged={async () => {
          await refreshRoles();
          await refresh();
        }}
      />
      <Panel>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${characters.length} character${characters.length === 1 ? "" : "s"}`}
            {isSeries ? " · Series-aware (season scope available)" : ""}
          </div>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-3 py-1.5 text-sm"
            >
              <Plus className="size-4" />
              {t("characters.new_character")}
            </button>
          )}
        </div>

        {adding && (
          <div className="mb-6 rounded-xl border border-border bg-surface/60 p-4 grid grid-cols-1 md:grid-cols-6 gap-3 text-sm">
            <input
              className="md:col-span-2 bg-sidebar-active border border-border rounded px-3 py-2 outline-none"
              placeholder={t("characters.character_name")}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              autoFocus
            />
            <select
              className="bg-sidebar-active border border-border rounded px-3 py-2 outline-none"
              value={draft.roleType}
              onChange={(e) =>
                setDraft({ ...draft, roleType: e.target.value as CharacterRoleType })
              }
            >
              {allLabels.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {isSeries && (
              <select
                className="bg-sidebar-active border border-border rounded px-3 py-2 outline-none"
                value={draft.seasonId ?? ""}
                onChange={(e) => setDraft({ ...draft, seasonId: e.target.value || null })}
              >
                <option value="">{t("characters.all_seasons")}</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    S{s.season_number} — {s.title}
                  </option>
                ))}
              </select>
            )}
            <select
              className={`bg-sidebar-active border border-border rounded px-3 py-2 outline-none ${isSeries ? "" : "md:col-span-2"}`}
              value={draft.budgetLineId ?? ""}
              onChange={(e) => setDraft({ ...draft, budgetLineId: e.target.value || null })}
            >
              <option value="">{t("characters.budget_line_optional")}</option>
              {budgetLines.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.main_code} — {b.description}
                </option>
              ))}
            </select>
            <input
              className="md:col-span-full bg-sidebar-active border border-border rounded px-3 py-2 outline-none"
              placeholder="Description (optional)"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <div className="md:col-span-full flex justify-end gap-2">
              <button
                onClick={() => {
                  setAdding(false);
                  resetDraft();
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={submitNew}
                className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-3 py-1.5 text-sm"
              >
                <Check className="size-4" /> Save
              </button>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {grouped
            .filter((g) => g.list.length > 0)
            .map(({ rt, list }) => (
              <div key={rt}>
                <div
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs border ${roleTone(rt)} mb-2`}
                >
                  {rt}
                </div>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-surface/60 text-muted-foreground text-xs uppercase tracking-wider">
                      <tr>
                        <th className="text-start px-3 py-2">Name</th>
                        <th className="text-start px-3 py-2">Description</th>
                        <th className="text-start px-3 py-2">Season</th>
                        <th className="text-start px-3 py-2">
                          {t("characters.linked_budget_line")}
                        </th>
                        <th className="text-end px-3 py-2 w-28">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((c) => {
                        const isEdit = editing === c.id;
                        const bl = budgetLines.find(
                          (b) => b.id === (isEdit ? editDraft.budgetLineId : c.budget_line_id),
                        );
                        const s = seasons.find(
                          (x) => x.id === (isEdit ? editDraft.seasonId : c.season_id),
                        );
                        return (
                          <tr key={c.id} className="border-t border-border">
                            <td className="px-3 py-2">
                              {isEdit ? (
                                <input
                                  className="bg-sidebar-active border border-border rounded px-2 py-1 outline-none w-full"
                                  value={editDraft.name}
                                  onChange={(e) =>
                                    setEditDraft({ ...editDraft, name: e.target.value })
                                  }
                                />
                              ) : (
                                <span className="font-medium">{c.name}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {isEdit ? (
                                <input
                                  className="bg-sidebar-active border border-border rounded px-2 py-1 outline-none w-full"
                                  value={editDraft.description}
                                  onChange={(e) =>
                                    setEditDraft({ ...editDraft, description: e.target.value })
                                  }
                                />
                              ) : (
                                c.description || "—"
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {isEdit && isSeries ? (
                                <select
                                  className="bg-sidebar-active border border-border rounded px-2 py-1 outline-none"
                                  value={editDraft.seasonId ?? ""}
                                  onChange={(e) =>
                                    setEditDraft({ ...editDraft, seasonId: e.target.value || null })
                                  }
                                >
                                  <option value="">—</option>
                                  {seasons.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      S{x.season_number}
                                    </option>
                                  ))}
                                </select>
                              ) : s ? (
                                `S${s.season_number} — ${s.title}`
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {isEdit ? (
                                <select
                                  className="bg-sidebar-active border border-border rounded px-2 py-1 outline-none max-w-[280px]"
                                  value={editDraft.budgetLineId ?? ""}
                                  onChange={(e) =>
                                    setEditDraft({
                                      ...editDraft,
                                      budgetLineId: e.target.value || null,
                                    })
                                  }
                                >
                                  <option value="">—</option>
                                  {budgetLines.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.main_code} — {b.description}
                                    </option>
                                  ))}
                                </select>
                              ) : bl ? (
                                `${bl.main_code} — ${bl.description}`
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-end">
                              {isEdit ? (
                                <div className="inline-flex gap-1">
                                  <button
                                    onClick={saveEdit}
                                    className="p-1.5 rounded-md hover:bg-brand/20"
                                    title="Save"
                                  >
                                    <Check className="size-4" />
                                  </button>
                                  <button
                                    onClick={() => setEditing(null)}
                                    className="p-1.5 rounded-md hover:bg-muted"
                                    title="Cancel"
                                  >
                                    <X className="size-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex gap-1">
                                  <button
                                    onClick={() => startEdit(c.id)}
                                    className="p-1.5 rounded-md hover:bg-muted"
                                    title="Edit"
                                  >
                                    <Pencil className="size-4" />
                                  </button>
                                  <button
                                    onClick={() => remove(c.id, c.name)}
                                    className="p-1.5 rounded-md hover:bg-destructive/20 text-destructive"
                                    title="Delete"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          {!loading && characters.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8">
              No characters yet. Create characters here so Cast contracts can be attached to a role
              instead of a free-text field.
            </div>
          )}
        </div>
      </Panel>
    </AppShell>
  );
}

/** Editable per-project role taxonomy (Main, Supporting, Cameo, Stunt Double, …). */
function RoleTypeManager({
  roleTypes,
  projectId,
  orgId,
  onChanged,
}: {
  roleTypes: Array<{ id: string; label: string }>;
  projectId: string | null;
  orgId: string | null;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();

  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const add = async () => {
    if (!projectId) {
      toast.error(t("characters.select_a_project_first"));
      return;
    }
    const clean = label.trim();
    if (!clean) {
      toast.error(t("characters.enter_a_role_type"));
      return;
    }
    if (roleTypes.some((r) => r.label.toLowerCase() === clean.toLowerCase())) {
      toast.error(`"${clean}" already exists`);
      return;
    }
    setBusy(true);
    try {
      await addRoleType({
        projectId,
        organizationId: orgId,
        label: clean,
        sortOrder: roleTypes.length,
      });
      setLabel("");
      await onChanged();
      toast.success(`Added role type "${clean}"`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add role type");
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async () => {
    if (!editingId) return;
    const clean = editLabel.trim();
    if (!clean) {
      toast.error(t("characters.role_type_cannot_be_empty"));
      return;
    }
    try {
      await renameRoleType(editingId, clean);
      setEditingId(null);
      await onChanged();
      toast.success(t("characters.role_type_renamed"));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to rename");
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Remove role type "${name}"? Existing characters keep their label.`)) return;
    try {
      await deleteRoleType(id);
      await onChanged();
      toast.success(t("characters.role_type_removed"));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove");
    }
  };

  return (
    <Panel>
      <div className="flex items-center gap-2 mb-1">
        <Tags className="size-4 text-brand" />
        <h2 className="text-sm font-semibold">{t("characters.role_types")}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Customise this production's character taxonomy — add, rename or remove role types.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {roleTypes.map((r) => (
          <span
            key={r.id}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${roleTone(r.label)}`}
          >
            {editingId === r.id ? (
              <>
                <input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="bg-transparent border-b border-current outline-none w-24"
                  aria-label={`Rename ${r.label}`}
                  autoFocus
                />
                <button onClick={saveRename} aria-label={t("characters.save_role_type")}>
                  <Check className="size-3" />
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  aria-label={t("characters.cancel_rename")}
                >
                  <X className="size-3" />
                </button>
              </>
            ) : (
              <>
                {r.label}
                <button
                  onClick={() => {
                    setEditingId(r.id);
                    setEditLabel(r.label);
                  }}
                  aria-label={`Rename ${r.label}`}
                >
                  <Pencil className="size-3 opacity-70 hover:opacity-100" />
                </button>
                <button onClick={() => remove(r.id, r.label)} aria-label={`Remove ${r.label}`}>
                  <Trash2 className="size-3 opacity-70 hover:opacity-100" />
                </button>
              </>
            )}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder={t("characters.new_role_type")}
            aria-label={t("characters.new_role_type")}
            className="bg-sidebar-active border border-border rounded px-2 py-1 text-xs outline-none w-36"
          />
          <button
            onClick={add}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-brand text-brand-foreground px-2.5 py-1 text-xs disabled:opacity-40"
          >
            <Plus className="size-3" /> Add
          </button>
        </span>
      </div>
    </Panel>
  );
}

export const Route = createFileRoute("/_authenticated/characters")({ component: CharactersPage });
