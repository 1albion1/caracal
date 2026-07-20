import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Layers,
  Plus,
  RefreshCw,
  Table2,
  Terminal,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Connection, ObjectKind, TableMeta } from "../types";

interface SidebarProps {
  connections: Connection[];
  activeConnectionId: string | null;
  onSelectConnection(id: string): void;
  onAddConnection(): void;
  onRemoveConnection(id: string): void;
  onCreateDemo(): void;
  demoBusy: boolean;
  databases: string[];
  databasesLoading: boolean;
  onRefreshDatabases(): void;
  activeDatabase: string | null;
  onSelectDatabase(db: string): void;
  tables: TableMeta[];
  tablesLoading: boolean;
  tablesError: string | null;
  onOpenTable(table: TableMeta): void;
}

const numberFormat = new Intl.NumberFormat("en-US");

/** Object-explorer sections in display order; sections without items are hidden. */
const KIND_SECTIONS: { kind: ObjectKind; label: string; icon: typeof Table2 }[] = [
  { kind: "table", label: "Tables", icon: Table2 },
  { kind: "partition", label: "Partitions", icon: Layers },
  { kind: "view", label: "Views", icon: Eye },
  { kind: "materialized_view", label: "Materialized Views", icon: Layers },
  { kind: "procedure", label: "Procedures", icon: Terminal },
];

/** Row counts are meaningless for procedures. */
const COUNTLESS_KINDS: ObjectKind[] = ["procedure"];

export function Sidebar({
  connections,
  activeConnectionId,
  onSelectConnection,
  onAddConnection,
  onRemoveConnection,
  onCreateDemo,
  demoBusy,
  databases,
  databasesLoading,
  onRefreshDatabases,
  activeDatabase,
  onSelectDatabase,
  tables,
  tablesLoading,
  tablesError,
  onOpenTable,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [dbFilter, setDbFilter] = useState("");

  const visibleDatabases = useMemo(() => {
    const needle = dbFilter.trim().toLowerCase();
    if (!needle) return databases;
    return databases.filter((db) => db.toLowerCase().includes(needle));
  }, [databases, dbFilter]);

  /** kind → schema → objects, after applying the name filter. */
  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return KIND_SECTIONS.map((section) => {
      const groups = new Map<string, TableMeta[]>();
      for (const table of tables) {
        if (table.kind !== section.kind) continue;
        if (needle && !`${table.schema}.${table.name}`.toLowerCase().includes(needle)) continue;
        const group = groups.get(table.schema) ?? [];
        group.push(table);
        groups.set(table.schema, group);
      }
      return {
        ...section,
        schemas: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)),
        count: [...groups.values()].reduce((sum, list) => sum + list.length, 0),
      };
    }).filter((section) => section.count > 0);
  }, [tables, filter]);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
            <button
              className="sidebar-add"
              onClick={onRefreshDatabases}
              disabled={databasesLoading}
              title="Refresh database list"
            >
              <RefreshCw size={13} className={databasesLoading ? "spin" : ""} />
            </button>
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

      <div className="sidebar-section-title">Objects</div>
      <input
        className="table-filter"
        placeholder="Filter objects…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="table-tree">
        {tablesLoading && <div className="tree-hint">Loading schema…</div>}
        {!tablesLoading && tablesError && <div className="tree-hint tree-error">{tablesError}</div>}
        {!tablesLoading && !tablesError && sections.length === 0 && (
          <div className="tree-hint">
            {activeConnectionId
              ? filter
                ? "No objects match."
                : "No objects in this database."
              : "Select a connection to browse objects."}
          </div>
        )}
        {sections.map((section) => {
          const sectionCollapsed = collapsed.has(section.kind);
          const Icon = section.icon;
          return (
            <div key={section.kind}>
              <button className="tree-kind" onClick={() => toggle(section.kind)}>
                {sectionCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <Icon size={13} />
                <span>{section.label}</span>
                <span className="tree-count">{section.count}</span>
              </button>
              {!sectionCollapsed &&
                section.schemas.map(([schema, objects]) => {
                  const schemaKey = `${section.kind}.${schema}`;
                  const schemaCollapsed = collapsed.has(schemaKey);
                  return (
                    <div key={schemaKey}>
                      <button className="tree-schema" onClick={() => toggle(schemaKey)}>
                        {schemaCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <span>{schema}</span>
                        <span className="tree-count">{objects.length}</span>
                      </button>
                      {!schemaCollapsed &&
                        objects.map((table) => (
                          <button
                            key={`${table.schema}.${table.name}`}
                            className="tree-table"
                            onClick={() => onOpenTable(table)}
                            title={
                              COUNTLESS_KINDS.includes(table.kind)
                                ? `${table.schema}.${table.name}`
                                : `${table.schema}.${table.name} (${numberFormat.format(table.rowCount)} rows)`
                            }
                          >
                            <Icon size={13} />
                            <span className="tree-table-name">{table.name}</span>
                            {!COUNTLESS_KINDS.includes(table.kind) && (
                              <span className="tree-count">
                                {numberFormat.format(table.rowCount)}
                              </span>
                            )}
                          </button>
                        ))}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
