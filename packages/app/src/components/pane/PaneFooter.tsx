import { useCallback, useState } from "react";
import type { MenuPosition } from "../shared/Menu";
import { PaneMenu } from "../shared/PaneMenu";
import { useWindowState } from "../window/WindowStateProvider";
import "./PaneFooter.css";

export function PaneFooter() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const { windows, restore } = useWindowState();
  const minimizedWindows = windows.filter((w) => w.minimized);

  const handleClick = useCallback((e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <>
      <div className="pane-footer">
        <button type="button" onClick={handleClick}>
          Menu
        </button>
        {minimizedWindows.map((w) => (
          <button
            key={w.id}
            type="button"
            className="pane-footer-window"
            onClick={() => restore(w.id)}
          >
            {w.title}
          </button>
        ))}
      </div>
      {menu && <PaneMenu position={menu} onClose={closeMenu} />}
    </>
  );
}
