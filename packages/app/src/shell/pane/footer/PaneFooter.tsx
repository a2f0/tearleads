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

// `tray` holds persistent theme, layout, and sync controls in the right-aligned
// cluster alongside the workspace switcher. `label` names the pane there (the
// demo's "Peer 1"/"Peer 2"), so it never sits under the windows.
export function PaneFooter({
  label,
  tray,
}: {
  label?: string | undefined;
  tray?: ReactNode;
}) {
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
        {label && <span className="pane-footer-label">{label}</span>}
        <WorkspaceSwitcher />
        {tray && <div className="pane-footer-tray">{tray}</div>}
      </div>
    </div>
  );
}
