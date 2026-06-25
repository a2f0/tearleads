import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import type { MenuPosition } from "../../shared/Menu";
import { PaneMenu } from "../../shared/PaneMenu";
import {
  useWindowActions,
  useWindowStateData,
} from "../../window/WindowStateProvider";
import "./PaneFooter.css";

// `tray` is the footer's right-aligned system tray — persistent launchers that
// stay reachable regardless of which windows are open (currently the System
// Monitor; more affordances will dock here over time).
export function PaneFooter({ tray }: { tray?: ReactNode }) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const { windows } = useWindowStateData();
  const { restore } = useWindowActions();
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
            onClick={() => restore(w.id)}
          >
            {w.title}
          </button>
        ))}
        {tray && <div className="pane-footer-tray">{tray}</div>}
      </div>
      {menu && <PaneMenu position={menu} onClose={closeMenu} />}
    </>
  );
}
