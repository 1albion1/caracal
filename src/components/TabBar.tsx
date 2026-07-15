import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { QueryTab } from "../types";

interface TabBarProps {
  tabs: QueryTab[];
  activeTabId: string | null;
  onSelect(id: string): void;
  onClose(id: string): void;
  onCloseOthers(id: string): void;
  onCloseRight(id: string): void;
  onCloseAll(): void;
  onNew(): void;
}

interface MenuState {
  x: number;
  y: number;
  tabId: string;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
  onNew,
}: TabBarProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Any click elsewhere or Escape dismisses the context menu.
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function openMenu(e: React.MouseEvent, tabId: string) {
    e.preventDefault();
    // Keep the menu on screen near the right edge.
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: e.clientY, tabId });
  }

  function menuAction(action: () => void) {
    action();
    setMenu(null);
  }

  const menuTabIndex = menu ? tabs.findIndex((t) => t.id === menu.tabId) : -1;
  const hasRight = menuTabIndex >= 0 && menuTabIndex < tabs.length - 1;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""}`}
          onMouseDown={(e) => {
            // Middle-click closes, like a browser tab.
            if (e.button === 1) onClose(tab.id);
            else if (e.button === 0) onSelect(tab.id);
          }}
          onContextMenu={(e) => openMenu(e, tab.id)}
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

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={() => menuAction(() => onClose(menu.tabId))}>Close</button>
          <button
            onClick={() => menuAction(() => onCloseOthers(menu.tabId))}
            disabled={tabs.length < 2}
          >
            Close others
          </button>
          <button onClick={() => menuAction(() => onCloseRight(menu.tabId))} disabled={!hasRight}>
            Close tabs to the right
          </button>
          <button onClick={() => menuAction(onCloseAll)}>Close all</button>
        </div>
      )}
    </div>
  );
}
