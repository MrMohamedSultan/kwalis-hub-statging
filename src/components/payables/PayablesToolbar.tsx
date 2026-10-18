import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SortKey, StatusFilter } from "./payables-types";

/** Search / status / department / sort bar. All filtering is client-side. */
export function PayablesToolbar({
  search,
  onSearch,
  status,
  onStatus,
  department,
  onDepartment,
  departments,
  sort,
  onSort,
  showDepartment,
  countLabel,
}: {
  search: string;
  onSearch: (v: string) => void;
  status: StatusFilter;
  onStatus: (v: StatusFilter) => void;
  department: string;
  onDepartment: (v: string) => void;
  departments: string[];
  sort: SortKey;
  onSort: (v: SortKey) => void;
  showDepartment: boolean;
  countLabel: string;
}) {
  const { t } = useTranslation();
  const selectCls =
    "rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("payables.searchPlaceholder")}
          className="w-[220px] max-w-full rounded-lg border border-border bg-input py-2 pe-3 ps-8 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30"
        />
      </label>

      <select
        value={status}
        onChange={(e) => onStatus(e.target.value as StatusFilter)}
        className={selectCls}
        aria-label={t("payables.statusFilterLabel")}
      >
        <option value="all">{t("payables.statusFilter.all")}</option>
        <option value="has_pending">{t("payables.statusFilter.hasPending")}</option>
        <option value="has_requested">{t("payables.statusFilter.hasRequested")}</option>
        <option value="fully_paid">{t("payables.statusFilter.fullyPaid")}</option>
      </select>

      {showDepartment && departments.length > 0 && (
        <select
          value={department}
          onChange={(e) => onDepartment(e.target.value)}
          className={selectCls}
          aria-label={t("payables.departmentFilter")}
        >
          <option value="all">{t("payables.allDepartments")}</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      )}

      <select
        value={sort}
        onChange={(e) => onSort(e.target.value as SortKey)}
        className={selectCls}
        aria-label={t("payables.sortLabel")}
      >
        <option value="name">{t("payables.sort.name")}</option>
        <option value="remaining">{t("payables.sort.remaining")}</option>
        <option value="deal">{t("payables.sort.deal")}</option>
      </select>

      <div className="ms-auto text-xs text-muted-foreground">{countLabel}</div>
    </div>
  );
}

export default PayablesToolbar;
