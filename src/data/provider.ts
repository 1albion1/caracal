import type {
  Connection,
  NewConnectionInput,
  QueryResult,
  RecentConnection,
  TableMeta,
} from "../types";

/**
 * Everything the UI needs from a database lives behind this interface.
 * Inside the Tauri shell it is served by the Rust backend (tauri.ts);
 * in a plain browser the in-memory mock (mock.ts) keeps the UI usable.
 */
export interface DataProvider {
  listConnections(): Promise<Connection[]>;
  /** Recently used connection setups (newest first, no secrets). */
  listRecentConnections(): Promise<RecentConnection[]>;
  addConnection(input: NewConnectionInput): Promise<Connection>;
  removeConnection(id: string): Promise<void>;
  /** Creates a seeded local demo database and returns its connection. */
  createDemoDatabase(): Promise<Connection>;
  /** Databases on the server; empty for single-database drivers (sqlite). */
  listDatabases(connectionId: string): Promise<string[]>;
  listTables(connectionId: string, database?: string): Promise<TableMeta[]>;
  runQuery(connectionId: string, sql: string, database?: string): Promise<QueryResult>;
}
