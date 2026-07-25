import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
} from "react";
import { classNames } from "../../shared/classNames";
import { MiniAppButton } from "../controls/MiniAppButton";
import "./MiniAppTabs.css";

export interface MiniAppTabDescriptor<TabId extends string = string> {
  id: TabId;
  label: string;
}

/**
 * Element ids linking a tab to its panel. Surfaces render the strip and the
 * panel as separate components, so both build their ids here from the caller's
 * `idPrefix` rather than restating the format — that shared prefix is the only
 * thing the two sides need to agree on.
 */
function miniAppTabId(idPrefix: string, tabId: string): string {
  return `${idPrefix}-${tabId}-tab`;
}

function miniAppTabPanelId(idPrefix: string, tabId: string): string {
  return `${idPrefix}-${tabId}-panel`;
}

/**
 * The shared tab strip: WAI-ARIA tab semantics, roving tabindex, and the tab
 * chrome from MiniAppTabs.css. `className` is for per-surface layout only (flex
 * sizing and the like) — the look belongs to the shared stylesheet so a change
 * there reaches every tabbed mini-app at once.
 */
export function MiniAppTabList<TabId extends string>({
  activeTab,
  className,
  idPrefix,
  label,
  onSelect,
  tabs,
}: {
  activeTab: TabId;
  className?: string | undefined;
  idPrefix: string;
  label: string;
  onSelect: (tab: TabId) => void;
  tabs: ReadonlyArray<MiniAppTabDescriptor<TabId>>;
}) {
  // Roving tabindex per the WAI-ARIA tab pattern: only the active tab is in the
  // tab order; arrow/Home/End keys move focus (and selection) between tabs.
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const lastIndex = tabs.length - 1;
      const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
      let nextIndex: number;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = lastIndex;
          break;
        default:
          return;
      }
      const nextTab = tabs[nextIndex];
      if (!nextTab) {
        return;
      }
      event.preventDefault();
      onSelect(nextTab.id);
      document.getElementById(miniAppTabId(idPrefix, nextTab.id))?.focus();
    },
    [activeTab, idPrefix, onSelect, tabs],
  );

  return (
    <div
      aria-label={label}
      className={classNames("mini-app-tabs", className)}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isSelected = tab.id === activeTab;
        return (
          <MiniAppButton
            // Surfaces render only the active panel, so only the active tab may
            // point at one: an inactive `aria-controls` would name an id that is
            // not in the document.
            aria-controls={
              isSelected ? miniAppTabPanelId(idPrefix, tab.id) : undefined
            }
            aria-selected={isSelected}
            className="mini-app-tab"
            id={miniAppTabId(idPrefix, tab.id)}
            key={tab.id}
            role="tab"
            tabIndex={isSelected ? 0 : -1}
            onClick={() => {
              onSelect(tab.id);
            }}
            onKeyDown={handleTabKeyDown}
          >
            {tab.label}
          </MiniAppButton>
        );
      })}
    </div>
  );
}

/** The panel for whichever tab is active, wired back to its tab for screen readers. */
export function MiniAppTabPanel({
  activeTab,
  children,
  className,
  idPrefix,
}: {
  activeTab: string;
  children: ReactNode;
  className?: string | undefined;
  idPrefix: string;
}) {
  return (
    <div
      aria-labelledby={miniAppTabId(idPrefix, activeTab)}
      className={classNames("mini-app-tab-panel", className)}
      id={miniAppTabPanelId(idPrefix, activeTab)}
      role="tabpanel"
    >
      {children}
    </div>
  );
}
