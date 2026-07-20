import type { Connection, QueryTab } from "../types";

interface StatusBarProps {
  connection: Connection | null;
  database: string | null;
  tab: QueryTab | null;
  /** Live elapsed time of the running query, in ms (null when idle). */
  runningMs?: number | null;
  notice?: string | null;
}

const numberFormat = new Intl.NumberFormat("en-US");

/** mm:ss.d once past a minute, else seconds with one decimal. */
function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")} min`;
  }
  return `${seconds.toFixed(1)}s`;
}

export function StatusBar({ connection, database, tab, runningMs, notice }: StatusBarProps) {
  const result = tab?.result ?? null;
  const db = database ?? connection?.database;
  return (
    <footer className="status-bar">
      <span className="status-left" title={notice ?? undefined}>
        {notice ??
          (connection
            ? `${connection.name} — ${connection.host}${db ? `/${db}` : ""} (${connection.driver})`
            : "No connection")}
      </span>
      <span className="status-right">
        {/* Show the live timer only once a query has been running a moment,
            so quick queries don't flash a counter. */}
        {tab?.running &&
          (runningMs != null && runningMs > 500
            ? `Running… ${formatElapsed(runningMs)}`
            : "Running…")}
        {!tab?.running && result && (
          <>
            {numberFormat.format(result.rows.length)} rows
            {result.totalRows > result.rows.length &&
              ` of ${numberFormat.format(result.totalRows)}`}{" "}
            · {result.durationMs} ms
          </>
        )}
      </span>
    </footer>
  );
}
