import type { Connection, QueryTab } from "../types";

interface StatusBarProps {
  connection: Connection | null;
  database: string | null;
  tab: QueryTab | null;
  notice?: string | null;
}

const numberFormat = new Intl.NumberFormat("en-US");

export function StatusBar({ connection, database, tab, notice }: StatusBarProps) {
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
        {tab?.running && "Running…"}
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
