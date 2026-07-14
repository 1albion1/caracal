import { sql } from "@codemirror/lang-sql";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { Loader2, Play } from "lucide-react";
import { useMemo, useRef, useState } from "react";

interface SqlEditorProps {
  value: string;
  running: boolean;
  onChange(sql: string): void;
  /** Runs the given SQL; undefined means "run the whole editor content". */
  onRun(sqlOverride?: string): void;
}

/** The highlighted text if any — SSMS-style "run selection only". */
function selectionOf(view: EditorView): string | undefined {
  const sel = view.state.selection.main;
  return sel.empty ? undefined : view.state.sliceDoc(sel.from, sel.to);
}

export function SqlEditor({ value, running, onChange, onRun }: SqlEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const [hasSelection, setHasSelection] = useState(false);

  const extensions = useMemo(
    () => [
      sql(),
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
    ],
    [onRun],
  );

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
        <span className="editor-hint">Ctrl+Enter runs the selection, or everything if nothing is selected</span>
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
