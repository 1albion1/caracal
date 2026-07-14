import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { ResultsGrid } from "./components/ResultsGrid";
import { Sidebar } from "./components/Sidebar";
import { SqlEditor } from "./components/SqlEditor";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { provider } from "./data";
import type { Connection, NewConnectionInput, QueryTab, TableMeta } from "./types";
import "./App.css";

let tabCounter = 0;

function newTab(title?: string, sql = ""): QueryTab {
  tabCounter += 1;
  return {
    id: `tab-${tabCounter}`,
    title: title ?? `Query ${tabCounter}`,
    sql,
    result: null,
    error: null,
    running: false,
  };
}

/** First-N-rows SQL in the active connection's dialect. */
function selectTopSql(driver: Connection["driver"], table: TableMeta): string {
  if (driver === "mssql") {
    return `SELECT TOP 1000 *\nFROM [${table.schema}].[${table.name}];`;
  }
  if (driver === "sqlite") {
    return `SELECT *\nFROM "${table.name}"\nLIMIT 1000;`;
  }
  return `SELECT *\nFROM ${table.schema}.${table.name}\nLIMIT 1000;`;
}

function App() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [activeDatabase, setActiveDatabase] = useState<string | null>(null);
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<QueryTab[]>([newTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  const [editorHeight, setEditorHeight] = useState(220);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const activeConnection = connections.find((c) => c.id === activeConnectionId) ?? null;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  useEffect(() => {
    provider.listConnections().then((conns) => {
      setConnections(conns);
      if (conns.length > 0) setActiveConnectionId(conns[0].id);
    });
  }, []);

  // Load the server's database list when the connection changes.
  useEffect(() => {
    setDatabases([]);
    setActiveDatabase(null);
    if (!activeConnectionId) return;
    let stale = false;
    const preferred = connections.find((c) => c.id === activeConnectionId)?.database;
    provider
      .listDatabases(activeConnectionId)
      .then((dbs) => {
        if (stale) return;
        setDatabases(dbs);
        if (dbs.length > 0) {
          setActiveDatabase(preferred && dbs.includes(preferred) ? preferred : dbs[0]);
        }
      })
      .catch((err) => {
        if (!stale) setTablesError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  const multiDatabase = activeConnection?.driver === "mssql";

  useEffect(() => {
    if (!activeConnectionId) {
      setTables([]);
      setTablesError(null);
      return;
    }
    // Multi-database servers wait until the database list has resolved.
    if (multiDatabase && !activeDatabase) {
      setTables([]);
      return;
    }
    let stale = false;
    setTablesLoading(true);
    setTables([]);
    setTablesError(null);
    provider
      .listTables(activeConnectionId, activeDatabase ?? undefined)
      .then((result) => {
        if (!stale) setTables(result);
      })
      .catch((err) => {
        if (!stale) setTablesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!stale) setTablesLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [activeConnectionId, activeDatabase, multiDatabase]);

  const patchTab = useCallback((id: string, patch: Partial<QueryTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const runQuery = useCallback(
    async (tabId: string, sql: string) => {
      if (!activeConnectionId) return;
      patchTab(tabId, { running: true, error: null });
      try {
        const result = await provider.runQuery(activeConnectionId, sql, activeDatabase ?? undefined);
        patchTab(tabId, { running: false, result, error: null });
      } catch (err) {
        patchTab(tabId, {
          running: false,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [activeConnectionId, activeDatabase, patchTab],
  );

  const runActiveTab = useCallback(
    (sqlOverride?: string) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.running) return;
      const sql = sqlOverride?.trim() ? sqlOverride : tab.sql;
      void runQuery(tab.id, sql);
    },
    [tabs, activeTabId, runQuery],
  );

  function openTable(table: TableMeta) {
    if (!activeConnection) return;
    const sql = selectTopSql(activeConnection.driver, table);
    const tab = newTab(table.name, sql);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    void runQuery(tab.id, sql);
  }

  function addTab() {
    const tab = newTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      const next = remaining.length > 0 ? remaining : [newTab()];
      if (id === activeTabId) {
        const closedIdx = prev.findIndex((t) => t.id === id);
        setActiveTabId(next[Math.max(0, Math.min(closedIdx - 1, next.length - 1))].id);
      }
      return next;
    });
  }

  async function addConnection(input: NewConnectionInput) {
    const connection = await provider.addConnection(input);
    setConnections((prev) => [...prev, connection]);
    setActiveConnectionId(connection.id);
  }

  async function removeConnection(id: string) {
    const target = connections.find((c) => c.id === id);
    if (!target) return;
    if (!window.confirm(`Remove connection "${target.name}"? The database file is not deleted.`)) {
      return;
    }
    await provider.removeConnection(id);
    setConnections((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (id === activeConnectionId) {
        setActiveConnectionId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
  }

  async function createDemo() {
    setDemoBusy(true);
    try {
      const connection = await provider.createDemoDatabase();
      setConnections((prev) =>
        prev.some((c) => c.id === connection.id) ? prev : [...prev, connection],
      );
      setActiveConnectionId(connection.id);
    } catch (err) {
      setTablesError(err instanceof Error ? err.message : String(err));
    } finally {
      setDemoBusy(false);
    }
  }

  // Draggable divider between editor and results.
  function startDrag(e: React.PointerEvent) {
    dragState.current = { startY: e.clientY, startHeight: editorHeight };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: React.PointerEvent) {
    if (!dragState.current) return;
    const delta = e.clientY - dragState.current.startY;
    setEditorHeight(Math.min(600, Math.max(100, dragState.current.startHeight + delta)));
  }
  function endDrag() {
    dragState.current = null;
  }

  return (
    <div className="app">
      <Sidebar
        connections={connections}
        activeConnectionId={activeConnectionId}
        onSelectConnection={setActiveConnectionId}
        onAddConnection={() => setDialogOpen(true)}
        onRemoveConnection={(id) => void removeConnection(id)}
        onCreateDemo={() => void createDemo()}
        demoBusy={demoBusy}
        databases={databases}
        activeDatabase={activeDatabase}
        onSelectDatabase={setActiveDatabase}
        tables={tables}
        tablesLoading={tablesLoading}
        tablesError={tablesError}
        onOpenTable={openTable}
      />
      <div className="main">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onNew={addTab}
        />
        {activeTab && (
          <>
            <div style={{ height: editorHeight, flexShrink: 0 }}>
              <SqlEditor
                value={activeTab.sql}
                running={activeTab.running}
                onChange={(sql) => patchTab(activeTab.id, { sql })}
                onRun={runActiveTab}
              />
            </div>
            <div
              className="divider"
              onPointerDown={startDrag}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
            />
            <ResultsGrid
              result={activeTab.result}
              error={activeTab.error}
              running={activeTab.running}
            />
          </>
        )}
        <StatusBar connection={activeConnection} database={activeDatabase} tab={activeTab} />
      </div>
      {dialogOpen && (
        <ConnectionDialog onSubmit={addConnection} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

export default App;
