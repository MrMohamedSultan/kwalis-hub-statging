import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2, Users, Drama } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import {
  CADENCE_LABEL,
  formatMoney,
  useRateCards,
  useScope,
  type Cadence,
  type RateCard,
} from "@/lib/payroll-hub";
import { TableSkeleton } from "@/components/ui/table-skeleton";

import { useTranslation } from "react-i18next";
type PersonRef = {
  id: string;
  fullName: string;
  role: string;
  kind: "crew" | "cast";
  currency?: string;
  dailyRate?: number;
};

function useAllPeople(): PersonRef[] {
  const people = useStore((s) => s.people);
  return useMemo(
    () =>
      people.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        role: p.position || p.character || "—",
        kind: p.kind,
        currency: p.ccy,
        dailyRate: p.dailyRate,
      })),
    [people],
  );
}

export function RateCardsPanel() {
  const { t } = useTranslation();

  const { rows, loading, refresh } = useRateCards();
  const { projectId, organizationId } = useScope();
  const people = useAllPeople();
  const [showForm, setShowForm] = useState(false);

  if (!projectId) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {t("ratecardspanel.select_a_project_to_manage_rate_cards")}
      </div>
    );
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t("ratecardspanel.delete_this_rate_card"))) return;
    const { error } = await supabase.from("rate_cards").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(t("ratecardspanel.rate_card_deleted"));
      refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{t("ratecardspanel.rate_cards")}</h3>
          <p className="text-xs text-muted-foreground">
            Reusable rate definitions per person — pick a cadence, set the base rate, add
            allowances.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110"
        >
          <Plus className="size-3.5" />
          {t("ratecardspanel.new_rate_card")}
        </button>
      </div>

      {showForm && (
        <RateCardForm
          people={people}
          projectId={projectId}
          organizationId={organizationId}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}

      {loading ? (
        <TableSkeleton rows={4} cols={6} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {t("ratecardspanel.no_rate_cards_yet_create_one_to_speed")}
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left py-2 px-3">{t("ratecardspanel.label")}</th>
                <th className="text-left py-2 px-3">{t("ratecardspanel.person")}</th>
                <th className="text-left py-2 px-3">{t("ratecardspanel.cadence")}</th>
                <th className="text-right py-2 px-3">{t("ratecardspanel.base_rate")}</th>
                <th className="text-right py-2 px-3">Per-diem</th>
                <th className="text-right py-2 px-3">Housing</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RateCardRow
                  key={r.id}
                  row={r}
                  people={people}
                  onDelete={() => handleDelete(r.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RateCardRow({
  row,
  people,
  onDelete,
}: {
  row: RateCard;
  people: PersonRef[];
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  const person = people.find((p) => p.id === row.person_id);
  return (
    <tr className="border-t border-border">
      <td className="py-2 px-3 font-medium">{row.label}</td>
      <td className="py-2 px-3">
        {person ? (
          <span className="inline-flex items-center gap-1.5">
            {person.kind === "cast" ? (
              <Drama className="size-3.5 text-primary" />
            ) : (
              <Users className="size-3.5 text-primary" />
            )}
            {person.fullName}
            <span className="text-xs text-muted-foreground">· {person.role}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-2 px-3">
        <span className="inline-flex items-center rounded-md border border-border bg-surface px-2 py-0.5 text-[11px]">
          {CADENCE_LABEL[row.cadence as Cadence] ?? row.cadence}
        </span>
      </td>
      <td className="py-2 px-3 text-right tabular-nums">
        {formatMoney(Number(row.base_rate), row.currency)}
      </td>
      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
        {formatMoney(Number(row.per_diem), row.currency)}
      </td>
      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
        {formatMoney(Number(row.housing_allowance), row.currency)}
      </td>
      <td className="py-2 px-3 text-right">
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded-md hover:bg-destructive/20 text-destructive"
          aria-label={t("ratecardspanel.delete_rate_card")}
        >
          <Trash2 className="size-3.5" />
        </button>
      </td>
    </tr>
  );
}

function RateCardForm({
  people,
  projectId,
  organizationId,
  onClose,
  onSaved,
}: {
  people: PersonRef[];
  projectId: string;
  organizationId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  const [personId, setPersonId] = useState("");
  const [label, setLabel] = useState("");
  const [cadence, setCadence] = useState<Cadence>("day");
  const [baseRate, setBaseRate] = useState("");
  const [otRate, setOtRate] = useState("");
  const [perDiem, setPerDiem] = useState("");
  const [housing, setHousing] = useState("");
  const [transport, setTransport] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!label.trim()) {
      toast.error("Label is required");
      return;
    }
    if (!personId) {
      toast.error(t("ratecardspanel.pick_a_person"));
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("rate_cards").insert({
      project_id: projectId,
      organization_id: organizationId,
      person_id: personId,
      label: label.trim(),
      cadence,
      base_rate: Number(baseRate) || 0,
      overtime_rate: Number(otRate) || 0,
      per_diem: Number(perDiem) || 0,
      housing_allowance: Number(housing) || 0,
      transport_allowance: Number(transport) || 0,
      currency,
      effective_from: effectiveFrom || null,
      effective_to: effectiveTo || null,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t("ratecardspanel.rate_card_created"));
      onSaved();
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-2/50 p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Label">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("ratecardspanel.eg_dop_day_rate")}
            className={inputCls}
          />
        </Field>
        <Field label="Person">
          <select
            value={personId}
            onChange={(e) => {
              setPersonId(e.target.value);
              const p = people.find((x) => x.id === e.target.value);
              if (p) {
                if (!label) setLabel(`${p.fullName} — ${p.role}`);
                if (p.currency) setCurrency(p.currency);
                if (p.dailyRate && !baseRate) setBaseRate(String(p.dailyRate));
              }
            }}
            className={inputCls}
          >
            <option value="">— select —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.role} ({p.kind})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cadence">
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as Cadence)}
            className={inputCls}
          >
            {(Object.keys(CADENCE_LABEL) as Cadence[]).map((k) => (
              <option key={k} value={k}>
                {CADENCE_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base rate">
          <input
            type="number"
            value={baseRate}
            onChange={(e) => setBaseRate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Overtime rate">
          <input
            type="number"
            value={otRate}
            onChange={(e) => setOtRate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Currency">
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className={inputCls}
          />
        </Field>
        <Field label="Per-diem (daily)">
          <input
            type="number"
            value={perDiem}
            onChange={(e) => setPerDiem(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Housing (period)">
          <input
            type="number"
            value={housing}
            onChange={(e) => setHousing(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Transport (period)">
          <input
            type="number"
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Effective from">
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Effective to">
          <input
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 disabled:opacity-50"
        >
          <Save className="size-3.5" />
          {t("ratecardspanel.save_rate_card")}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-brand";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
      {children}
    </label>
  );
}

export { Field as PayrollHubField, inputCls as payrollHubInput };
