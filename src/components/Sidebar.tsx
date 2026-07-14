import { ChevronDown, ChevronRight, Database, Plus, Table2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Connection, TableMeta } from "../types";

interface SidebarProps {
  connections: Connection[];
  activeConnectionId: string | null;
  onSelectConnection(id: string): void;
  onAddConnection(): void;
  onRemoveConnection(id: string): void;
  onCreateDemo(): void;
  demoBusy: boolean;
  databases: string[];
  activeDatabase: string | null;
  onSelectDatabase(db: string): void;
  tables: TableMeta[];
  tablesLoading: boolean;
  tablesError: string | null;
  onOpenTable(table: TableMeta): void;
}

const numberFormat = new Intl.NumberFormat("en-US");

export function Sidebar({
  connections,
  activeConnectionId,
  onSelectConnection,
  onAddConnection,
  onRemoveConnection,
  onCreateDemo,
  demoBusy,
  databases,
  activeDatabase,
  onSelectDatabase,
  tables,
  tablesLoading,
  tablesError,
  onOpenTable,
}: SidebarProps) {
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [dbFilter, setDbFilter] = useState("");

  const visibleDatabases = useMemo(() => {
    const needle = dbFilter.trim().toLowerCase();
    if (!needle) return databases;
    return databases.filter((db) => db.toLowerCase().includes(needle));
  }, [databases, dbFilter]);

  const bySchema = useMemo(() => {
    const groups = new Map<string, TableMeta[]>();
    const needle = filter.trim().toLowerCase();
    for (const table of tables) {
      if (needle && !`${table.schema}.${table.name}`.toLowerCase().includes(needle)) continue;
      const group = groups.get(table.schema) ?? [];
      group.push(table);
      groups.set(table.schema, group);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tables, filter]);

  function toggleSchema(schema: string) {
    setCollapsedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-section-title">
        Connections
        <button className="sidebar-add" onClick={onAddConnection} title="New connection">
          <Plus size={14} />
        </button>
      </div>
      <div className="connection-list">
        {connections.length === 0 && (
          <div className="tree-hint">
            No connections yet.
            <button className="demo-button" onClick={onCreateDemo} disabled={demoBusy}>
              {demoBusy ? "Creating…" : "Create a demo database"}
            </button>
          </div>
        )}
        {connections.map((conn) => (
          <div
            key={conn.id}
            className={`connection-item ${conn.id === activeConnectionId ? "active" : ""}`}
            onClick={() => onSelectConnection(conn.id)}
            title={`${conn.driver} · ${conn.database}`}
          >
            <span className="connection-dot" style={{ background: conn.color }} />
            <Database size={14} />
            <span className="connection-name">{conn.name}</span>
            <span className="connection-driver">{conn.driver}</span>
            <button
              className="connection-remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveConnection(conn.id);
              }}
              title={`Remove ${conn.name}`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {databases.length > 0 && (
        <>
          <div className="sidebar-section-title">
            Databases
            <span className="tree-count">{databases.length}</span>
          </div>
          <input
            className="table-filter"
            placeholder="Filter databases…"
            value={dbFilter}
            onChange={(e) => setDbFilter(e.target.value)}
          />
          <div className="db-list">
            {visibleDatabases.map((db) => (
              <button
                key={db}
                className={`db-item ${db === activeDatabase ? "active" : ""}`}
                onClick={() => onSelectDatabase(db)}
                title={db}
              >
                <Database size={13} />
                <span className="db-item-name">{db}</span>
              </button>
            ))}
            {visibleDatabases.length === 0 && (
              <div className="tree-hint">No databases match.</div>
            )}
          </div>
        </>
      )}

      <div className="sidebar-section-title">Tables</div>
      <input
        className="table-filter"
        placeholder="Filter tables…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="table-tree">
        {tablesLoading && <div className="tree-hint">Loading schema…</div>}
        {!tablesLoading && tablesError && <div className="tree-hint tree-error">{tablesError}</div>}
        {!tablesLoading && !tablesError && tables.length === 0 && (
          <div className="tree-hint">
            {activeConnectionId
              ? "No tables in this database."
              : "Select a connection to browse tables."}
          </div>
        )}
        {bySchema.map(([schema, schemaTables]) => {
          const collapsed = collapsedSchemas.has(schema);
          return (
            <div key={schema}>
              <button className="tree-schema" onClick={() => toggleSchema(schema)}>
                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span>{schema}</span>
                <span className="tree-count">{schemaTables.length}</span>
              </button>
              {!collapsed &&
                schemaTables.map((table) => (
                  <button
                    key={`${table.schema}.${table.name}`}
                    className="tree-table"
                    onClick={() => onOpenTable(table)}
                    title={`Open ${table.schema}.${table.name} (${numberFormat.format(table.rowCount)} rows)`}
                  >
                    <Table2 size={13} />
                    <span className="tree-table-name">{table.name}</span>
                    <span className="tree-count">{numberFormat.format(table.rowCount)}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
