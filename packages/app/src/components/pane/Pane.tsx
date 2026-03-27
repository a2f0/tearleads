import { useCallback, useState } from "react";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import type { MenuPosition } from "../shared/Menu";
import { Menu } from "../shared/Menu";
import { MenuItem } from "../shared/MenuItem";
import { Window } from "../window/Window";
import {
  useWindowState,
  WindowStateProvider,
} from "../window/WindowStateProvider";
import { useRegisterUserId } from "./DualPaneProvider";
import "./Pane.css";
import { PaneFooter } from "./PaneFooter";
import { PaneLog } from "./PaneLog";
import { PaneStatus } from "./PaneStatus";

function PaneInner({ className }: { className: string }) {
  const { userId } = useCryptoSession();
  useRegisterUserId(userId);
  const { windows, create } = useWindowState();
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openFloatingWindow = useCallback(() => {
    if (contextMenu) {
      create("Window", contextMenu.x, contextMenu.y);
    }
    setContextMenu(null);
  }, [contextMenu, create]);

  return (
    <section
      role="application"
      className={className}
      onContextMenu={handleContextMenu}
    >
      <div className="pane-main">
        <PaneStatus />
        <PaneLog />
        {windows.map((w) => (
          <Window key={w.id} windowId={w.id} />
        ))}
      </div>
      <PaneFooter />
      {contextMenu && (
        <Menu position={contextMenu} onClose={closeContextMenu}>
          <MenuItem label="Open Floating Window" onClick={openFloatingWindow} />
        </Menu>
      )}
    </section>
  );
}

export function Pane({ className }: { className: string }) {
  return (
    <WindowStateProvider>
      <PaneInner className={className} />
    </WindowStateProvider>
  );
}
