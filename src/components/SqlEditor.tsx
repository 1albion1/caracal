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
import { Download, Loader2, Play } from "lucide-react";
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
      // Highest precedence so Ctrl+Enter isn't swallowed by the default keymap.
      Prec.highest(
        keymap.of([
          {
            key: "Ctrl-Enter",
            run: (view) => {
              onRun(selectionOf(view));
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
  }, [onRun, schema, driver]);

  function runFromButton() {
    const view = cmRef.current?.view;
    onRun(view ? selectionOf(view) : undefined);
  }

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <button className="run-button" onClick={runFromButton} disabled={running}>
          {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {running ? "Running…" : hasSelection ? "Run selection" : "Run"}
        </button>
        <span className="editor-hint">Ctrl+Enter runs the selection, or everything if nothing is selected · Ctrl+Space for suggestions</span>
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
