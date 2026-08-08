import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import type { MouseEvent } from "react";
import { classNames } from "../../shared/classNames";
import { Menu } from "../../shared/Menu";
import { useContextMenuPositionState } from "../../shared/useContextMenuState";
import type { MiniAppColumnVisibility } from "./MiniAppColumnVisibility";
import "./MiniAppColumnMenuButton.css";

export interface MiniAppColumnMenuOption<ColumnId extends string> {
  id: ColumnId;
  label: string;
}

interface MiniAppColumnMenuButtonProps<ColumnId extends string>
  extends MiniAppColumnVisibility<ColumnId> {
  ariaLabel: string;
  className?: string | undefined;
  options: ReadonlyArray<MiniAppColumnMenuOption<ColumnId>>;
  stateLabels: {
    off: string;
    on: string;
  };
}

export function MiniAppColumnMenuButton<ColumnId extends string>({
  ariaLabel,
  className,
  hiddenColumns,
  options,
  stateLabels,
  toggleColumn,
}: MiniAppColumnMenuButtonProps<ColumnId>) {
  const { closeContextMenu, contextMenu, openContextMenuAt } =
    useContextMenuPositionState();

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenuAt({ x: rect.left, y: rect.bottom });
  };

  return (
    <div className={classNames("mini-app-column-menu", className)}>
      <button
        aria-expanded={contextMenu !== null}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className="mini-app-column-menu-button"
        onClick={openMenu}
        title={ariaLabel}
        type="button"
      >
        <GearSixIcon aria-hidden="true" size={16} />
      </button>
      {contextMenu ? (
        <Menu
          direction="down"
          onClose={closeContextMenu}
          position={contextMenu}
        >
          <fieldset className="mini-app-column-menu-list">
            <legend className="mini-app-column-menu-legend">{ariaLabel}</legend>
            {options.map((option) => {
              const isVisible = !hiddenColumns.has(option.id);
              return (
                <label className="mini-app-column-menu-item" key={option.id}>
                  <input
                    checked={isVisible}
                    className="mini-app-column-menu-checkbox"
                    onChange={() => toggleColumn(option.id)}
                    type="checkbox"
                  />
                  <span className="mini-app-column-menu-label">
                    {option.label}
                  </span>
                  <span className="mini-app-column-menu-state">
                    {isVisible ? stateLabels.on : stateLabels.off}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </Menu>
      ) : null}
    </div>
  );
}
