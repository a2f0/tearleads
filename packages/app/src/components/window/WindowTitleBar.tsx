import { useCallback, useState } from "react";
import type { MenuPosition } from "../shared/Menu";
import { Menu } from "../shared/Menu";
import { MenuItem } from "../shared/MenuItem";
import "./WindowTitleBar.css";
import { WindowCloseButton } from "./WindowCloseButton";
import { WindowMaximizeButton } from "./WindowMaximizeButton";
import { WindowMinimizeButton } from "./WindowMinimizeButton";

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
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    <div
      role="toolbar"
      className="window-titlebar"
      onMouseDown={onMouseDown}
      onContextMenu={handleContextMenu}
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
            label="Move Forward"
            onClick={() => {
              onMoveForward();
              closeContextMenu();
            }}
          />
          <MenuItem
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
