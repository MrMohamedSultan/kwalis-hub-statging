// =====================================================================
// StatTile — KPI tile.
// label · formatted value (proportional figures — never tabular-nums on
// a KPI value) · optional signed delta with a named comparison period ·
// optional sublabel · optional 12-point sparkline.
// =====================================================================
import { useId } from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { formatDelta } from "@/lib/format";
import { safeNumber } from "@/lib/safe";
import type { StatusTone } from "./StatusChip";

interface StatTileDelta {
  /** Signed percentage, e.g. +4.2. */
  value: number;
  /** Named comparison period — "vs. plan", "vs. last week". */
  period: string;
  /** Whether an upward movement is good news (default false = cost). */
  goodWhenUp?: boolean;
}

interface StatTileProps {
  label: string;
  /** Pre-formatted, compact value. */
  value: string;
  delta?: StatTileDelta | null;
  sublabel?: React.ReactNode;
  /** 12-point sparkline series. */
  spark?: number[];
  sparkTone?: StatusTone;
  className?: string;
}

function Sparkline({ points, tone }: { points: number[]; tone: StatusTone }) {
  const id = useId();
  const clean = points.map((p) => safeNumber(p)).filter((p) => Number.isFinite(p));
  if (clean.length < 2) return null;
  const W = 96;
  const H = 28;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = W / (clean.length - 1);
  const coords = clean.map((p, i) => [i * step, H - 3 - ((p - min) / span) * (H - 6)] as const);
  const path = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const [lastX, lastY] = coords[coords.length - 1];
  const dotColor = tone === "neutral" ? "var(--ink-secondary)" : `var(--status-${tone})`;

  return (
    <svg
      key={id}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--ink-muted)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={dotColor} />
    </svg>
  );
}

/** Number part of a formatted amount (Latin or Arabic-Indic digits). */
const NUMBER_RE =
  /^(\D*?)([-−+]?[\d\u0660-\u0669](?:[\d\u0660-\u0669.,\u066B\u066C]*[\d\u0660-\u0669])?)(\D*)$/;

function KpiValue({ value }: { value: string }) {
  const m = NUMBER_RE.exec(value.trim());
  const base = "mt-2 font-semibold tracking-tight text-ink-primary text-lg 2xl:text-xl";
  if (!m) return <div className={`${base} break-words`}>{value}</div>;
  const [, prefix, number, suffix] = m;
  return (
    <div className={`${base} flex flex-wrap items-baseline gap-x-1`}>
      {prefix.trim() && <span className="text-xs font-medium text-ink-muted">{prefix.trim()}</span>}
      <span className="whitespace-nowrap" dir="ltr">
        {number}
      </span>
      {suffix.trim() && <span className="text-xs font-medium text-ink-muted">{suffix.trim()}</span>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  delta,
  sublabel,
  spark,
  sparkTone = "neutral",
  className = "",
}: StatTileProps) {
  const up = (delta?.value ?? 0) > 0;
  const flat = (delta?.value ?? 0) === 0;
  const good = delta ? (delta.goodWhenUp ? up : !up) : true;
  const DeltaIcon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const deltaColor = flat ? "text-ink-muted" : good ? "text-status-good" : "text-status-critical";

  return (
    <div
      className={`flex h-full flex-col justify-between rounded-xl border border-border bg-surface p-6 ${className}`}
    >
      <div className="min-w-0">
        <div className="text-xs font-medium text-ink-muted">{label}</div>
        {/* KPI value: proportional figures — tabular-nums here makes the
            number look loose and broken. The number itself never wraps;
            the currency code is set smaller beside it so the full amount
            fits the narrow 6-column strip. */}
        <KpiValue value={value} />
        {spark && spark.length >= 2 && (
          <div className="mt-2 flex justify-end">
            <Sparkline points={spark} tone={sparkTone} />
          </div>
        )}
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-1.5">
          <DeltaIcon className={`size-3.5 rtl:-scale-x-100 ${deltaColor}`} aria-hidden="true" />
          <span className={`text-xs font-semibold tabular-nums ${deltaColor}`}>
            {formatDelta(delta.value)}
          </span>
          <span className="text-xs text-ink-muted">{delta.period}</span>
        </div>
      )}
      {sublabel && <div className="mt-3 text-xs text-ink-muted">{sublabel}</div>}
    </div>
  );
}
