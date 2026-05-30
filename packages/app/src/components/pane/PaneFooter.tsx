import { useCallback, useMemo, useState } from "react";
import type { MenuPosition } from "../shared/Menu";
import { PaneMenu } from "../shared/PaneMenu";
import {
  useWindowActions,
  useWindowStateData,
} from "../window/WindowStateProvider";
import "./PaneFooter.css";

export function PaneFooter() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const { windows } = useWindowStateData();
  const { bringToFront, restore } = useWindowActions();
  const minimizedWindows = useMemo(
    () => windows.filter((w) => w.minimized),
    [windows],
  );

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
            onClick={() => {
              bringToFront(w.id);
              restore(w.id);
            }}
          >
            {w.title}
          </button>
        ))}
      </div>
      {menu && <PaneMenu position={menu} onClose={closeMenu} />}
    </>
  );
}
