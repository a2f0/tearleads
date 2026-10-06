import { TearleadsLogo } from "@tearleads/ui";
import {
  findTopWindow,
  StartMenu,
  useWindowStateData,
} from "@tearleads/windowing";
import type { ReactNode } from "react";
import { WorkspaceSwitcher } from "../../layout/workspace/WorkspaceSwitcher";
import { PaneMenu } from "../shell/PaneMenu";
import "./PaneFooter.css";
import { PaneFooterWindowButton } from "./PaneFooterWindowButton";

// `tray` is the footer's system tray — persistent launchers that stay reachable
// regardless of which windows are open (currently the System Monitor; more
// affordances will dock here over time). It sits in the right-aligned cluster
// alongside the workspace switcher.
export function PaneFooter({ tray }: { tray?: ReactNode }) {
  const { windows } = useWindowStateData();
  const activeWindow = findTopWindow(windows, (entry) => !entry.minimized);

  return (
    <div className="pane-footer">
      <StartMenu
        className="tearleads-action-button pane-footer-menu-button"
        icon={<TearleadsLogo className="pane-footer-menu-logo" />}
        renderMenu={({ close, position }) => (
          <PaneMenu position={position} onClose={close} />
        )}
      />
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
  );
}
