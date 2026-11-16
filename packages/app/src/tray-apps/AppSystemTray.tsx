import { SystemTray, type SystemTrayMenuItem } from "@tearleads/windowing";
import { useMemo } from "react";
import {
  useAppNavigationActions,
  useAppNavigationState,
} from "../navigation/AppNavigationProvider";

/**
 * The pane's system tray: the tray apps the user left on, for the windowed
 * footer and the routed taskbar alike. Each one's context menu turns it off
 * and opens Display Properties, where its switch turns it back on. Display
 * Properties is named by id through navigation, never imported: tray apps and
 * mini-apps do not import each other.
 */
export function AppSystemTray() {
  const { openMiniApp } = useAppNavigationActions();
  const { definition } = useAppNavigationState();
  const displayProperties = definition.apps["display-properties"];

  const menuItems = useMemo<ReadonlyArray<SystemTrayMenuItem>>(
    () =>
      displayProperties
        ? [
            {
              icon: displayProperties.icon,
              id: "display-properties",
              label: displayProperties.iconLabel ?? displayProperties.title,
              onSelect: () => openMiniApp({ appId: "display-properties" }),
            },
          ]
        : [],
    [displayProperties, openMiniApp],
  );

  return <SystemTray menuItems={menuItems} />;
}
