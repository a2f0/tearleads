import { type MouseEvent, useState } from "react";
import { Menu, type MenuPosition } from "../../../components/shared/Menu";
import { useRoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import { EXPLORER_LABELS } from "../labels";
import {
  type ExplorerItemColumnId,
  TOGGLEABLE_COLUMN_IDS,
} from "./explorerItemColumnIds";
import type { ExplorerColumnVisibility } from "./useExplorerColumnVisibility";

function getExplorerColumnLabel(id: ExplorerItemColumnId): string {
  switch (id) {
    case "name":
      return EXPLORER_LABELS.itemNameColumn;
    case "type":
      return EXPLORER_LABELS.itemTypeColumn;
    case "created":
      return EXPLORER_LABELS.dateCreatedColumn;
    case "modified":
      return EXPLORER_LABELS.dateModifiedColumn;
    case "sync":
      return EXPLORER_LABELS.itemSyncColumn;
  }
}

// Lets the user show/hide the wide-layout item-table columns. Hidden on the
// phone tier, which renders a fixed, trimmed column set.
export function ExplorerColumnsMenuButton(params: ExplorerColumnVisibility) {
  const { hiddenColumns, toggleColumn } = params;
  const compact = useRoutedLayoutTier() === "mobile";
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  if (compact) {
    return null;
  }

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.left, y: rect.bottom });
  };

  return (
    <div className="explorer-columns-menu">
      <button
        aria-expanded={menuPosition !== null}
        aria-haspopup="menu"
        className="explorer-columns-menu-button"
        onClick={openMenu}
        type="button"
      >
        {EXPLORER_LABELS.columnsMenuButton}
      </button>
      {menuPosition ? (
        <Menu
          direction="down"
          onClose={() => setMenuPosition(null)}
          position={menuPosition}
        >
          <fieldset className="explorer-columns-menu-list">
            <legend className="explorer-columns-menu-legend">
              {EXPLORER_LABELS.columnsMenuButton}
            </legend>
            {TOGGLEABLE_COLUMN_IDS.map((id) => (
              <label className="explorer-columns-menu-item" key={id}>
                <input
                  checked={!hiddenColumns.has(id)}
                  onChange={() => toggleColumn(id)}
                  type="checkbox"
                />
                {getExplorerColumnLabel(id)}
              </label>
            ))}
          </fieldset>
        </Menu>
      ) : null}
    </div>
  );
}
