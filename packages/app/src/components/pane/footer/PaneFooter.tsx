import { TearleadsLogo } from "@tearleads/ui";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { MINI_APP_ICONS } from "../../../mini-apps/registry";
import { WorkspaceSwitcher } from "../../layout/workspace/WorkspaceSwitcher";
import type { MenuPosition } from "../../shared/Menu";
import { PaneMenu } from "../../shared/PaneMenu";
import {
  useWindowActions,
  useWindowStateData,
} from "../../window/WindowStateProvider";
import "./PaneFooter.css";

// `tray` is the footer's system tray — persistent launchers that stay reachable
// regardless of which windows are open (currently the System Monitor; more
// affordances will dock here over time). It sits in the right-aligned cluster
// alongside the workspace switcher.
export function PaneFooter({ tray }: { tray?: ReactNode }) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const { windows } = useWindowStateData();
  const { restore } = useWindowActions();

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
        {windows.map((w) => {
          const AppIcon = w.appId ? MINI_APP_ICONS[w.appId] : undefined;
          return (
            <button
              key={w.id}
              type="button"
              className="tearleads-action-button pane-footer-window"
              aria-label={`Activate ${w.title} window`}
              title={w.title}
              onClick={() => restore(w.id)}
            >
              {AppIcon && (
                <AppIcon
                  aria-hidden="true"
                  className="pane-footer-window-icon"
                  focusable="false"
                  size={16}
                  weight="regular"
                />
              )}
              {(w.minimized || !AppIcon) && (
                <span className="pane-footer-window-label">{w.title}</span>
              )}
            </button>
          );
        })}
        <div className="pane-footer-end">
          <WorkspaceSwitcher />
          {tray && <div className="pane-footer-tray">{tray}</div>}
        </div>
      </div>
      {menu && <PaneMenu position={menu} onClose={closeMenu} />}
    </>
  );
}
