export type Driver = "mssql" | "postgres" | "mysql" | "sqlite";

/** "sql" = login+password, "windows" = integrated, "entra" = Microsoft Entra ID (Azure AD). */
export type AuthMethod = "sql" | "windows" | "entra";

export interface Connection {
  id: string;
  name: string;
  driver: Driver;
  /** Server host, may include a named instance ("server\\SQLEXPRESS"); "local" for sqlite. */
  host: string;
  database: string;
  /** Accent color shown next to the connection (helps tell prod/dev apart). */
  color: string;
  port?: number | null;
  username?: string | null;
  auth?: AuthMethod | null;
  trustCert?: boolean | null;
}

/** A past connection's settings (no secrets) used to prefill the dialog. */
export interface RecentConnection {
  name: string;
  driver: Driver;
  host: string;
  database: string;
  color: string;
  port?: number | null;
  username?: string | null;
  auth?: AuthMethod | null;
  trustCert?: boolean | null;
}

export interface NewConnectionInput {
  name: string;
  driver: Driver;
  /** For sqlite this is the file path; for servers the database name. */
  database: string;
  color: string;
  createIfMissing: boolean;
  host?: string;
  port?: number;
  username?: string;
  /** Sent once at creation; the backend stores it in Windows Credential Manager. */
  password?: string;
  auth?: AuthMethod;
  trustCert?: boolean;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
}

export type ObjectKind = "table" | "partition" | "view" | "materialized_view" | "procedure";

export interface TableMeta {
  schema: string;
  name: string;
  kind: ObjectKind;
  rowCount: number;
  columns: ColumnMeta[];
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: CellValue[][];
  totalRows: number;
  durationMs: number;
}

export type CellValue = string | number | boolean | null;

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  /** Database this tab is bound to (like an SSMS query window); null = connection default. */
  database: string | null;
  result: QueryResult | null;
  error: string | null;
  running: boolean;
}
