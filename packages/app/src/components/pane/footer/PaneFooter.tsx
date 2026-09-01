import { TearleadsLogo } from "@tearleads/ui";
import type { ReactNode } from "react";
import { WorkspaceSwitcher } from "../../layout/workspace/WorkspaceSwitcher";
import { useContextMenuPositionState } from "../../shared/useContextMenuState";
import { useWindowStateData } from "../../window/WindowStateProvider";
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

  return (
    <>
      <div className="pane-footer">
        <button
          type="button"
          className="tearleads-action-button pane-footer-menu-button"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={contextMenu !== null}
          onClick={(event) =>
            openContextMenuAt({ x: event.clientX, y: event.clientY })
          }
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
      {contextMenu && <PaneMenu position={contextMenu} onClose={closeMenu} />}
    </>
  );
}
