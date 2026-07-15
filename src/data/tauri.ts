import { invoke } from "@tauri-apps/api/core";
import type { CellValue, NewConnectionInput } from "../types";
import type { DataProvider } from "./provider";

/** Serves the DataProvider interface from the Rust backend via IPC. */
export const tauriProvider: DataProvider = {
  listConnections: () => invoke("list_connections"),
  listRecentConnections: () => invoke("list_recent_connections"),
  addConnection: (input: NewConnectionInput) => invoke("add_connection", { input }),
  removeConnection: (id: string) => invoke("remove_connection", { id }),
  createDemoDatabase: () => invoke("create_demo_database"),
  listDatabases: (connectionId: string) => invoke("list_databases", { connectionId }),
  listTables: (connectionId: string, database?: string) =>
    invoke("list_tables", { connectionId, database }),
  runQuery: (connectionId: string, sql: string, database?: string) =>
    invoke("run_query", { connectionId, sql, database }),
  exportResult: (path: string, columns: string[], rows: CellValue[][]) =>
    invoke("export_result", { path, columns, rows }),
};
