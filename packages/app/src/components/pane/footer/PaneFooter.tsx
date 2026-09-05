import { TearleadsLogo } from "@tearleads/ui";
import type { ReactNode } from "react";
import { WorkspaceSwitcher } from "../../layout/workspace/WorkspaceSwitcher";
import { useContextMenuPositionState } from "../../shared/useContextMenuState";
import {
  findTopWindow,
  useWindowStateData,
} from "../../window/WindowStateProvider";
import { PaneMenu } from "../shell/PaneMenu";
import "./PaneFooter.css";
import { PaneFooterWindowButton } from "./PaneFooterWindowButton";

// `tray` is the footer's system tray — persistent launchers that stay reachable
// regardless of which windows are open (currently the System Monitor; more
// affordances will dock here over time). It sits in the right-aligned cluster
// alongside the workspace switcher.
export function PaneFooter({ tray }: { tray?: ReactNode }) {
  const {
    closeContextMenu: closeMenu,
    contextMenu,
    openContextMenuAt,
  } = useContextMenuPositionState();
  const { windows } = useWindowStateData();
  const activeWindow = findTopWindow(windows, (entry) => !entry.minimized);

  return (
    <>
      <div className="pane-footer">
        <button
          type="button"
          className="tearleads-action-button pane-footer-menu-button"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={contextMenu !== null}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            openContextMenuAt({ x: bounds.left, y: bounds.top });
          }}
        >
          <TearleadsLogo className="pane-footer-menu-logo" />
        </button>
        {windows.map((w) => (
          <PaneFooterWindowButton
            key={w.id}
            entry={w}
            active={w.id === activeWindow?.id}
          />
        ))}
        <div className="pane-footer-end">
          <WorkspaceSwitcher />
          {tray && <div className="pane-footer-tray">{tray}</div>}
        </div>
      </div>
      {contextMenu && <PaneMenu position={contextMenu} onClose={closeMenu} />}
    </>
  );
}
