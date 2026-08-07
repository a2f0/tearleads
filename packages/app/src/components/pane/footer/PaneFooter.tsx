import { TearleadsLogo } from "@tearleads/ui";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { WorkspaceSwitcher } from "../../layout/workspace/WorkspaceSwitcher";
import type { MenuPosition } from "../../shared/Menu";
import { useWindowStateData } from "../../window/WindowStateProvider";
import { PaneMenu } from "../shell/PaneMenu";
import "./PaneFooter.css";
import { PaneFooterWindowButton } from "./PaneFooterWindowButton";

// `tray` is the footer's system tray — persistent launchers that stay reachable
// regardless of which windows are open (currently the System Monitor; more
// affordances will dock here over time). It sits in the right-aligned cluster
// alongside the workspace switcher.
export function PaneFooter({ tray }: { tray?: ReactNode }) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const { windows } = useWindowStateData();

  const handleClick = useCallback((e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <>
      <div className="pane-footer">
        <button
          type="button"
          className="tearleads-action-button pane-footer-menu-button"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={handleClick}
        >
          <TearleadsLogo className="pane-footer-menu-logo" />
        </button>
        {windows.map((w) => (
          <PaneFooterWindowButton key={w.id} entry={w} />
        ))}
        <div className="pane-footer-end">
          <WorkspaceSwitcher />
          {tray && <div className="pane-footer-tray">{tray}</div>}
        </div>
      </div>
      {menu && <PaneMenu position={menu} onClose={closeMenu} />}
    </>
  );
}
