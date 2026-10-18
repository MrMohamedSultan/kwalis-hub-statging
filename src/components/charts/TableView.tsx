// =====================================================================
// Table view — the WCAG-clean twin of every chart. Compact, accessible,
// tabular-nums, hairline row separators. Also what finance people
// actually screenshot into emails.
// =====================================================================

export interface TableColumn {
  key: string;
  label: string;
  align?: "start" | "end";
  /** Numeric columns get tabular-nums even when a custom format returns a string. */
  numeric?: boolean;
  /** Custom cell renderer; defaults to the raw value. */
  format?: (row: Record<string, unknown>) => string;
}

interface TableViewProps {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  /** Accessible caption for screen readers. */
  caption?: string;
}

export function TableView({ columns, rows, caption }: TableViewProps) {
  return (
    <table className="w-full border-collapse text-sm">
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr className="border-b border-border">
          {columns.map((col) => (
            <th
              key={col.key}
              scope="col"
              className={`py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted ${
                col.align === "end" ? "text-end" : "text-start"
              }`}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border last:border-0">
            {columns.map((col) => {
              const raw = row[col.key];
              const text = col.format
                ? col.format(row)
                : typeof raw === "number"
                  ? raw.toLocaleString("en-US")
                  : String(raw ?? "—");
              const numeric = col.numeric ?? typeof raw === "number";
              return (
                <td
                  key={col.key}
                  className={`py-2.5 text-ink-secondary ${
                    numeric ? "tabular-nums" : ""
                  } ${col.align === "end" ? "text-end" : "text-start"}`}
                >
                  {text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
