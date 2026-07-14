import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import type { QueryResult } from "../types";

const ROW_HEIGHT = 28;
const DEFAULT_COL_WIDTH = 160;
const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 900;
/** Approximate monospace character width at 12px, used for auto-fit. */
const CHAR_WIDTH = 7.5;

interface ResultsGridProps {
  result: QueryResult | null;
  error: string | null;
  running: boolean;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function clampWidth(width: number): number {
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, width));
}

/**
 * Virtualized result grid: only visible rows are in the DOM, so tens of
 * thousands of rows scroll smoothly. Columns resize by dragging the divider
 * in the header; double-click a divider to auto-fit the column's content.
 */
export function ResultsGrid({ result, error, running }: ResultsGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const resizeState = useRef<{ index: number; startX: number; startWidth: number } | null>(null);

  // A fresh result gets fresh default widths.
  useEffect(() => {
    setColWidths(result ? result.columns.map(() => DEFAULT_COL_WIDTH) : []);
  }, [result]);

  const rows = result?.rows ?? [];
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (running) return <div className="grid-message">Running query…</div>;
  if (error) return <div className="grid-message grid-error">{error}</div>;
  if (!result) return <div className="grid-message">Run a query to see results.</div>;
  if (result.rows.length === 0) return <div className="grid-message">Query returned no rows.</div>;

  const widths = result.columns.map((_, i) => colWidths[i] ?? DEFAULT_COL_WIDTH);
  const gridTemplate = `56px ${widths.map((w) => `${w}px`).join(" ")}`;
  const totalWidth = 56 + widths.reduce((a, b) => a + b, 0);

  function startResize(e: React.PointerEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = { index, startX: e.clientX, startWidth: widths[index] };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResize(e: React.PointerEvent) {
    const state = resizeState.current;
    if (!state) return;
    const width = clampWidth(state.startWidth + e.clientX - state.startX);
    setColWidths((prev) => prev.map((w, i) => (i === state.index ? width : w)));
  }

  function endResize() {
    resizeState.current = null;
  }

  /** Sizes the column to its longest visible content (sampled). */
  function autoFit(index: number) {
    if (!result) return;
    const column = result.columns[index];
    let maxChars = column.name.length + column.dataType.length + 2;
    const sample = Math.min(rows.length, 500);
    for (let i = 0; i < sample; i++) {
      const len = formatCell(rows[i][index]).length;
      if (len > maxChars) maxChars = len;
    }
    const width = clampWidth(Math.ceil(maxChars * CHAR_WIDTH) + 24);
    setColWidths((prev) => prev.map((w, i) => (i === index ? width : w)));
  }

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div className="grid-inner" style={{ minWidth: totalWidth }}>
        <div className="grid-header" style={{ gridTemplateColumns: gridTemplate }}>
          <div className="grid-cell grid-rownum">#</div>
          {result.columns.map((col, index) => (
            <div key={index} className="grid-cell grid-header-cell" title={col.dataType}>
              <span className="grid-col-name">{col.name}</span>
              <span className="grid-col-type">{col.dataType}</span>
              <div
                className="col-resize"
                onPointerDown={(e) => startResize(e, index)}
                onPointerMove={onResize}
                onPointerUp={endResize}
                onDoubleClick={() => autoFit(index)}
                title="Drag to resize · double-click to fit"
              />
            </div>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                className="grid-row"
                style={{
                  gridTemplateColumns: gridTemplate,
                  transform: `translateY(${virtualRow.start}px)`,
                  height: ROW_HEIGHT,
                }}
              >
                <div className="grid-cell grid-rownum">{virtualRow.index + 1}</div>
                {row.map((cell, colIdx) => (
                  <div
                    key={colIdx}
                    className={`grid-cell ${cell === null ? "grid-null" : ""} ${typeof cell === "number" ? "grid-num" : ""}`}
                  >
                    {formatCell(cell)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
