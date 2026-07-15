import {
  MSSQL,
  MySQL,
  PostgreSQL,
  SQLite,
  sql,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { Download, Gauge, ListTree, Play, Square } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Driver, TableMeta } from "../types";

interface SqlEditorProps {
  value: string;
  running: boolean;
  /** Live schema of the active database — feeds autocompletion. */
  tables: TableMeta[];
  driver: Driver | null;
  /** Whether the active tab has a result to export. */
  hasResult: boolean;
  onChange(sql: string): void;
  /** Runs the given SQL; undefined means "run the whole editor content". */
  onRun(sqlOverride?: string): void;
  /** Shows the estimated execution plan for the given SQL (does not run it). */
  onExplain(sqlOverride?: string): void;
  /** Runs the query and shows the actual plan with per-step timing. */
  onAnalyze(sqlOverride?: string): void;
  /** Cancels the currently running query. */
  onCancel(): void;
  onExport(): void;
}

const DIALECTS = {
  mssql: { dialect: MSSQL, defaultSchema: "dbo" },
  postgres: { dialect: PostgreSQL, defaultSchema: "public" },
  mysql: { dialect: MySQL, defaultSchema: undefined },
  sqlite: { dialect: SQLite, defaultSchema: "main" },
};

/** The highlighted text if any — SSMS-style "run selection only". */
function selectionOf(view: EditorView): string | undefined {
  const sel = view.state.selection.main;
  return sel.empty ? undefined : view.state.sliceDoc(sel.from, sel.to);
}

export function SqlEditor({
  value,
  running,
  tables,
  driver,
  hasResult,
  onChange,
  onRun,
  onExplain,
  onAnalyze,
  onCancel,
  onExport,
}: SqlEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const [hasSelection, setHasSelection] = useState(false);

  // schema.table → column names, so completions know tables AND fields.
  const schema = useMemo(() => {
    const namespace: Record<string, Record<string, string[]>> = {};
    for (const table of tables) {
      if (table.kind === "procedure") continue;
      (namespace[table.schema] ??= {})[table.name] = table.columns.map((c) => c.name);
    }
    return namespace as SQLNamespace;
  }, [tables]);

  const extensions = useMemo(() => {
    const { dialect, defaultSchema } = DIALECTS[driver ?? "mssql"];
    return [
      sql({ dialect, schema, defaultSchema, upperCaseKeywords: true }),
      // Highest precedence so shortcuts aren't swallowed by the default keymap.
      Prec.highest(
        keymap.of([
          {
            key: "Ctrl-Enter",
            run: (view) => {
              onRun(selectionOf(view));
              return true;
            },
          },
          {
            key: "Ctrl-Shift-Enter",
            run: (view) => {
              onExplain(selectionOf(view));
              return true;
            },
          },
        ]),
      ),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          setHasSelection(!update.state.selection.main.empty);
        }
      }),
    ];
  }, [onRun, onExplain, schema, driver]);

  function runFromButton() {
    const view = cmRef.current?.view;
    onRun(view ? selectionOf(view) : undefined);
  }

  function explainFromButton() {
    const view = cmRef.current?.view;
    onExplain(view ? selectionOf(view) : undefined);
  }

  function analyzeFromButton() {
    const view = cmRef.current?.view;
    onAnalyze(view ? selectionOf(view) : undefined);
  }

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        {running ? (
          <button className="run-button run-stop" onClick={onCancel}>
            <Square size={13} />
            Stop
          </button>
        ) : (
          <button className="run-button" onClick={runFromButton}>
            <Play size={14} />
            {hasSelection ? "Run selection" : "Run"}
          </button>
        )}
        <button
          className="btn btn-slim"
          onClick={explainFromButton}
          disabled={running}
          title="Show the estimated execution plan (Ctrl+Shift+Enter) — does not run the query"
        >
          <ListTree size={14} />
          Explain
        </button>
        <button
          className="btn btn-slim"
          onClick={analyzeFromButton}
          disabled={running}
          title="Run the query and show the actual plan with per-step timing — this EXECUTES the query"
        >
          <Gauge size={14} />
          Analyze
        </button>
        <span className="editor-hint">Ctrl+Enter runs · Ctrl+Shift+Enter explains · Ctrl+Space suggests</span>
        <span className="toolbar-spacer" />
        <button
          className="btn btn-slim"
          onClick={onExport}
          disabled={!hasResult || running}
          title="Export the current result to CSV, Excel, or JSON"
        >
          <Download size={14} />
          Export…
        </button>
      </div>
      <CodeMirror
        ref={cmRef}
        className="editor-cm"
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={vscodeDark}
        height="100%"
        basicSetup={{ foldGutter: false, autocompletion: true }}
      />
    </div>
  );
}
