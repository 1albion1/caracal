import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { PlanGraph } from "./components/PlanGraph";
import { ResultsGrid } from "./components/ResultsGrid";
import { Sidebar } from "./components/Sidebar";
import { SqlEditor } from "./components/SqlEditor";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { provider } from "./data";
import type { Connection, NewConnectionInput, QueryTab, TableMeta } from "./types";
import "./App.css";

let tabCounter = 0;

function newTab(title?: string, sql = "", database: string | null = null): QueryTab {
  tabCounter += 1;
  return {
    id: `tab-${tabCounter}`,
    title: title ?? `Query ${tabCounter}`,
    sql,
    database,
    result: null,
    plan: null,
    error: null,
    running: false,
    queryId: null,
  };
}

/** First-100-rows SQL with explicit column names, in the connection's dialect. */
function selectTopSql(driver: Connection["driver"], table: TableMeta): string {
  if (driver === "mssql") {
    const list = table.columns.length
      ? table.columns.map((c) => `[${c.name}]`).join(",\n       ")
      : "*";
    return `SELECT TOP 100 ${list}\nFROM [${table.schema}].[${table.name}];`;
  }
  const list = table.columns.length
    ? table.columns.map((c) => `"${c.name}"`).join(",\n       ")
    : "*";
  if (driver === "sqlite") {
    return `SELECT ${list}\nFROM "${table.name}"\nLIMIT 100;`;
  }
  return `SELECT ${list}\nFROM "${table.schema}"."${table.name}"\nLIMIT 100;`;
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
  const [notice, setNotice] = useState<string | null>(null);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  function showNotice(message: string) {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 8000);
  }

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

  const multiDatabase =
    activeConnection?.driver === "mssql" || activeConnection?.driver === "postgres";

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
    async (tabId: string, sql: string, database: string | null) => {
      if (!activeConnectionId) return;
      const queryId = crypto.randomUUID();
      patchTab(tabId, { running: true, error: null, plan: null, queryId });
      try {
        const result = await provider.runQuery(
          activeConnectionId,
          sql,
          database ?? undefined,
          queryId,
        );
        patchTab(tabId, { running: false, result, error: null, plan: null, queryId: null });
      } catch (err) {
        patchTab(tabId, {
          running: false,
          result: null,
          error: err instanceof Error ? err.message : String(err),
          queryId: null,
        });
      }
    },
    [activeConnectionId, patchTab],
  );

  const explainToGrid = useCallback(
    async (tabId: string, sql: string, database: string | null) => {
      if (!activeConnectionId) return;
      patchTab(tabId, { running: true, error: null, plan: null });
      try {
        const result = await provider.explainQuery(activeConnectionId, sql, database ?? undefined);
        patchTab(tabId, { running: false, result, error: null, plan: null });
      } catch (err) {
        patchTab(tabId, {
          running: false,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [activeConnectionId, patchTab],
  );

  const analyzeToGraph = useCallback(
    async (tabId: string, sql: string, database: string | null) => {
      if (!activeConnectionId) return;
      const queryId = crypto.randomUUID();
      patchTab(tabId, { running: true, error: null, queryId });
      try {
        const plan = await provider.analyzeQuery(
          activeConnectionId,
          sql,
          database ?? undefined,
          queryId,
        );
        patchTab(tabId, { running: false, plan, result: null, error: null, queryId: null });
      } catch (err) {
        patchTab(tabId, {
          running: false,
          plan: null,
          error: err instanceof Error ? err.message : String(err),
          queryId: null,
        });
      }
    },
    [activeConnectionId, patchTab],
  );

  const cancelActiveTab = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab?.queryId) void provider.cancelQuery(tab.queryId);
  }, [tabs, activeTabId]);

  const runActiveTab = useCallback(
    (sqlOverride?: string) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.running) return;
      const sql = sqlOverride?.trim() ? sqlOverride : tab.sql;
      // A tab stays bound to the database it was opened under (SSMS-style);
      // unbound tabs follow the sidebar's current selection.
      void runQuery(tab.id, sql, tab.database ?? activeDatabase);
    },
    [tabs, activeTabId, activeDatabase, runQuery],
  );

  const explainActiveTab = useCallback(
    (sqlOverride?: string) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.running) return;
      const sql = sqlOverride?.trim() ? sqlOverride : tab.sql;
      void explainToGrid(tab.id, sql, tab.database ?? activeDatabase);
    },
    [tabs, activeTabId, activeDatabase, explainToGrid],
  );

  const analyzeActiveTab = useCallback(
    (sqlOverride?: string) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.running) return;
      const sql = sqlOverride?.trim() ? sqlOverride : tab.sql;
      void analyzeToGraph(tab.id, sql, tab.database ?? activeDatabase);
    },
    [tabs, activeTabId, activeDatabase, analyzeToGraph],
  );

  function openTable(table: TableMeta) {
    if (!activeConnection) return;
    // Procedures get an execution template but are NOT auto-run — they can
    // modify data; the user reviews parameters and hits Run themselves.
    if (table.kind === "procedure") {
      const sql =
        activeConnection.driver === "postgres"
          ? `CALL "${table.schema}"."${table.name}"();`
          : `EXEC [${table.schema}].[${table.name}];`;
      const tab = newTab(table.name, sql, activeDatabase);
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      return;
    }
    const sql = selectTopSql(activeConnection.driver, table);
    const tab = newTab(table.name, sql, activeDatabase);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    void runQuery(tab.id, sql, activeDatabase);
  }

  function addTab() {
    const tab = newTab(undefined, "", activeDatabase);
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

  function closeAllTabs() {
    const tab = newTab(undefined, "", activeDatabase);
    setTabs([tab]);
    setActiveTabId(tab.id);
  }

  function closeOtherTabs(id: string) {
    setTabs((prev) => prev.filter((t) => t.id === id));
    setActiveTabId(id);
  }

  function closeTabsToRight(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const kept = prev.slice(0, idx + 1);
      if (!kept.some((t) => t.id === activeTabId)) setActiveTabId(id);
      return kept;
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

  async function exportActiveResult() {
    const tab = tabs.find((t) => t.id === activeTabId);
    const result = tab?.result;
    if (!tab || !result || result.rows.length === 0) return;
    const path = await save({
      defaultPath: `${tab.title.replace(/[^\w.-]+/g, "_")}.csv`,
      filters: [
        { name: "CSV (Excel compatible)", extensions: ["csv"] },
        { name: "Excel workbook", extensions: ["xlsx"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });
    if (!path) return;
    try {
      const written = await provider.exportResult(
        path,
        result.columns.map((c) => c.name),
        result.rows,
      );
      const truncated =
        result.totalRows > result.rows.length
          ? ` (first ${written.toLocaleString()} of ${result.totalRows.toLocaleString()} — re-run with a filter for the rest)`
          : "";
      showNotice(`Exported ${written.toLocaleString()} rows to ${path}${truncated}`);
    } catch (err) {
      showNotice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
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
          onCloseOthers={closeOtherTabs}
          onCloseRight={closeTabsToRight}
          onCloseAll={closeAllTabs}
          onNew={addTab}
        />
        {activeTab && (
          <>
            <div style={{ height: editorHeight, flexShrink: 0 }}>
              <SqlEditor
                value={activeTab.sql}
                running={activeTab.running}
                tables={tables}
                driver={activeConnection?.driver ?? null}
                hasResult={(activeTab.result?.rows.length ?? 0) > 0}
                onChange={(sql) => patchTab(activeTab.id, { sql })}
                onRun={runActiveTab}
                onExplain={explainActiveTab}
                onAnalyze={analyzeActiveTab}
                onCancel={cancelActiveTab}
                onExport={() => void exportActiveResult()}
              />
            </div>
            <div
              className="divider"
              onPointerDown={startDrag}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
            />
            {activeTab.plan && !activeTab.running && !activeTab.error ? (
              <PlanGraph plan={activeTab.plan} />
            ) : (
              <ResultsGrid
                result={activeTab.result}
                error={activeTab.error}
                running={activeTab.running}
              />
            )}
          </>
        )}
        <StatusBar
          connection={activeConnection}
          database={activeTab?.database ?? activeDatabase}
          tab={activeTab}
          notice={notice}
        />
      </div>
      {dialogOpen && (
        <ConnectionDialog onSubmit={addConnection} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

export default App;
