// =====================================================================
// DashboardControls — the shared header control cluster for both
// dashboards. The dashboards always run on the live Supabase data
// engine, so the only control left is the date range picker. State
// lives in the persisted useDashboardControls store so both pages
// stay in sync.
// =====================================================================
import { useDashboardControls } from "@/stores/useDashboardControls";
import { DateRangePicker } from "./DateRangePicker";

export function DashboardControls() {
  const rangeFrom = useDashboardControls((s) => s.rangeFrom);
  const rangeTo = useDashboardControls((s) => s.rangeTo);
  const setRange = useDashboardControls((s) => s.setRange);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangePicker from={rangeFrom} to={rangeTo} onChange={setRange} />
    </div>
  );
}
