import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { type ReactNode, useCallback } from "react";
import { Menu } from "../menu/Menu";
import { MenuItem } from "../menu/MenuItem";
import { useContextMenuPositionState } from "../menu/useContextMenuState";
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
  pressed?: boolean;
}

export function WindowTitleBar({
  title,
  titleId,
  onPointerDown,
  onMinimize,
  onMaximize,
  onClose,
  onMoveForward,
  onMoveBackward,
}: {
  title: string;
  titleId?: string | undefined;
  onPointerDown: (e: React.PointerEvent) => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onMoveForward: () => void;
  onMoveBackward: () => void;
}) {
  const { closeContextMenu, contextMenu, openContextMenuAt } =
    useContextMenuPositionState();

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.target;
      if (e.button !== 0) return;
      // Element, not HTMLElement: an icon inside a button (including the
      // portaled context menu, whose events bubble through React) is SVG.
      if (target instanceof Element && target.closest("button")) return;
      onPointerDown(e);
    },
    [onPointerDown],
  );

  return (
    <div
      role="toolbar"
      aria-label="Window controls"
      className="window-titlebar"
      onPointerDown={handlePointerDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenuAt({ x: event.clientX, y: event.clientY });
      }}
    >
      <span className="window-titlebar-title" id={titleId} title={title}>
        {title}
      </span>
      <div className="window-titlebar-buttons">
        <WindowMinimizeButton onClick={onMinimize} />
        <WindowMaximizeButton onClick={onMaximize} />
        <WindowCloseButton label="Close window" onClick={onClose} />
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
