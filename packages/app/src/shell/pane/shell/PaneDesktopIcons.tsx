import { DesktopIcons } from "@tearleads/windowing";
import { useMemo } from "react";
import { MINI_APP_LAUNCHER } from "../../../mini-apps/registry";
import { useSystemMonitor } from "../../../mini-apps/system-monitor/SystemMonitorProvider";
import { useVisibleMiniAppItems } from "../../../mini-apps/useVisibleMiniAppItems";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { usePaneDesktopStateStorage } from "./usePaneDesktopStateStorage";

// The launcher's desktop apps, as the items the session's visibility filters.
const DESKTOP_ITEMS = (MINI_APP_LAUNCHER.desktopAppIds ?? []).map((appId) => ({
  appId,
}));

/**
 * The pane desktop's app icons, saved per identity in its encrypted blob
 * store. Like the pane menu's app entries, they appear once the pane has an
 * identity, and only for apps the session may see. A pinned System Monitor
 * fills the desktop with its status and log, so the icons step aside for it.
 */
export function PaneDesktopIcons() {
  const { signingKeyPair } = useIdentity();
  const { isPinned } = useSystemMonitor();
  const storage = usePaneDesktopStateStorage();
  const visibleItems = useVisibleMiniAppItems(DESKTOP_ITEMS);
  const appIds = useMemo(
    () => visibleItems.map(({ appId }) => appId),
    [visibleItems],
  );

  if (signingKeyPair === null || isPinned) {
    return null;
  }
  return <DesktopIcons appIds={appIds} storage={storage} />;
}
