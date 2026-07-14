import { Plus, X } from "lucide-react";
import type { QueryTab } from "../types";

interface TabBarProps {
  tabs: QueryTab[];
  activeTabId: string | null;
  onSelect(id: string): void;
  onClose(id: string): void;
  onNew(): void;
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, onNew }: TabBarProps) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""}`}
          onMouseDown={(e) => {
            // Middle-click closes, like a browser tab.
            if (e.button === 1) onClose(tab.id);
            else onSelect(tab.id);
          }}
        >
          <span className={`tab-title ${tab.running ? "running" : ""}`}>{tab.title}</span>
          {tab.database && <span className="tab-db">{tab.database}</span>}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            aria-label={`Close ${tab.title}`}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} aria-label="New query tab">
        <Plus size={14} />
      </button>
    </div>
  );
}
