import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { type ReactNode, useCallback } from "react";
import { Menu } from "../shared/Menu";
import { MenuItem } from "../shared/MenuItem";
import { useContextMenuPositionState } from "../shared/useContextMenuState";
import "./WindowTitleBar.css";
import { WindowCloseButton } from "./WindowCloseButton";
import { WindowMaximizeButton } from "./WindowMaximizeButton";
import { WindowMinimizeButton } from "./WindowMinimizeButton";

export interface WindowTitleBarAction {
  disabled?: boolean;
  icon: ReactNode;
  id: string;
  label: string;
  onClick: () => void;
}

export function WindowTitleBar({
  title,
  onMouseDown,
  onMinimize,
  onMaximize,
  onClose,
  onMoveForward,
  onMoveBackward,
}: {
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onMoveForward: () => void;
  onMoveBackward: () => void;
}) {
  const { closeContextMenu, contextMenu, openContextMenuAt } =
    useContextMenuPositionState();

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target;
      if (e.button !== 0) return;
      if (target instanceof HTMLElement && target.closest("button")) return;
      onMouseDown(e);
    },
    [onMouseDown],
  );

  return (
    <div
      role="toolbar"
      aria-label="Window controls"
      className="window-titlebar"
      onMouseDown={handleMouseDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenuAt({ x: event.clientX, y: event.clientY });
      }}
    >
      <span>{title}</span>
      <div className="window-titlebar-buttons">
        <WindowMinimizeButton onClick={onMinimize} />
        <WindowMaximizeButton onClick={onMaximize} />
        <WindowCloseButton onClick={onClose} />
      </div>
      {contextMenu && (
        <Menu
          position={contextMenu}
          onClose={closeContextMenu}
          direction="down"
        >
          <MenuItem
            icon={ArrowUpIcon}
            label="Move Forward"
            onClick={() => {
              onMoveForward();
              closeContextMenu();
            }}
          />
          <MenuItem
            icon={ArrowDownIcon}
            label="Move Backward"
            onClick={() => {
              onMoveBackward();
              closeContextMenu();
            }}
          />
        </Menu>
      )}
    </div>
  );
}
