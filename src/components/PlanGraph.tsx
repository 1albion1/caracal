import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { PlanNode } from "../types";

interface PlanGraphProps {
  plan: PlanNode;
}

const numberFormat = new Intl.NumberFormat("en-US");

/** Self metric = this node's own time (or cost) minus its children's. */
function selfMetric(node: PlanNode): number {
  const childSum = node.children.reduce((sum, c) => sum + (c.timeMs ?? c.cost ?? 0), 0);
  const total = node.timeMs ?? node.cost ?? 0;
  return Math.max(0, total - childSum);
}

/** Largest self metric in the tree — the denominator for the heat scale. */
function maxSelf(node: PlanNode): number {
  return node.children.reduce((m, c) => Math.max(m, maxSelf(c)), selfMetric(node));
}

/** Cool→hot background for a node given its share of the heaviest step. */
function heatColor(fraction: number): string {
  if (!(fraction > 0)) return "var(--bg-panel)";
  const alpha = 0.12 + fraction * 0.6;
  return `rgba(229, 83, 75, ${alpha.toFixed(3)})`;
}

function fmt(n: number): string {
  if (n >= 1000) return numberFormat.format(Math.round(n));
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(3);
}

function PlanTreeNode({
  node,
  max,
  selected,
  onSelect,
}: {
  node: PlanNode;
  max: number;
  selected: PlanNode | null;
  onSelect: (n: PlanNode) => void;
}) {
  const self = selfMetric(node);
  const fraction = max > 0 ? self / max : 0;
  // Show the step's OWN time/cost (children subtracted), which is what the
  // heat reflects — that's where the work in this step actually happens.
  const metricLabel =
    node.timeMs != null
      ? `${fmt(self)} ms self`
      : node.cost != null
        ? `cost ${fmt(self)}`
        : null;

  return (
    <li>
      <button
        className={`plan-node ${selected === node ? "selected" : ""}`}
        style={{ background: heatColor(fraction) }}
        onClick={() => onSelect(node)}
      >
        <div className="plan-node-title">
          {node.label}
          {node.parallel && <span className="plan-parallel" title="Ran in parallel across threads/workers">∥</span>}
        </div>
        <div className="plan-node-metrics">
          {metricLabel && <span className="plan-metric-strong">{metricLabel}</span>}
          {node.rows != null && <span>{numberFormat.format(Math.round(node.rows))} rows</span>}
          {fraction > 0.01 && <span className="plan-metric-share">{Math.round(fraction * 100)}%</span>}
        </div>
        {node.detail && <div className="plan-node-detail">{node.detail}</div>}
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, i) => (
            <PlanTreeNode key={i} node={child} max={max} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DetailPanel({ node, onClose }: { node: PlanNode; onClose: () => void }) {
  const self = selfMetric(node);
  return (
    <div className="plan-detail">
      <div className="plan-detail-head">
        <span className="plan-detail-title">{node.label}</span>
        <button className="plan-detail-close" onClick={onClose} aria-label="Close details">
          <X size={14} />
        </button>
      </div>
      <table className="plan-detail-table">
        <tbody>
          {node.timeMs != null && (
            <tr>
              <td>Time (incl. children)</td>
              <td>{fmt(node.timeMs)} ms</td>
            </tr>
          )}
          {(node.timeMs != null || node.cost != null) && (
            <tr>
              <td>Self {node.timeMs != null ? "time" : "cost"}</td>
              <td>{fmt(self)}{node.timeMs != null ? " ms" : ""}</td>
            </tr>
          )}
          {node.rows != null && (
            <tr>
              <td>Rows</td>
              <td>{numberFormat.format(Math.round(node.rows))}</td>
            </tr>
          )}
          {node.extra.map(([k, v], i) => (
            <tr key={i}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlanGraph({ plan }: PlanGraphProps) {
  const [selected, setSelected] = useState<PlanNode | null>(null);
  const max = useMemo(() => maxSelf(plan), [plan]);
  const hasTiming = useMemo(() => {
    const anyTime = (n: PlanNode): boolean => n.timeMs != null || n.children.some(anyTime);
    return anyTime(plan);
  }, [plan]);

  return (
    <div className="plan-area">
      <div className="plan-scroll">
        <div className="plan-legend">
          <span className="plan-legend-swatch" />
          {hasTiming
            ? "Shows self time per step (children excluded) · hotter = slower · click a step for details"
            : "Relative self cost per step · click a step for details"}
        </div>
        <ul className="plan-tree">
          <PlanTreeNode node={plan} max={max} selected={selected} onSelect={setSelected} />
        </ul>
      </div>
      {selected && <DetailPanel node={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
