import { CloudCheckIcon } from "@phosphor-icons/react/dist/csr/CloudCheck";
import { LayoutIcon } from "@phosphor-icons/react/dist/csr/Layout";
import type { SystemTrayDefinition } from "@tearleads/windowing";
import { ThemeInvertIcon } from "@tearleads/windowing/theme";
import { NavigationModeTrayApp } from "./navigation-mode/NavigationModeTrayApp";
import { SyncStatusTrayApp } from "./sync-status/SyncStatusTrayApp";
import { ThemeTrayApp } from "./theme/ThemeTrayApp";

// The tray's order, start to end: both the windowed footer and the routed
// taskbar show the same tray.
const TRAY_APP_ORDER = ["theme", "navigation-mode", "sync-status"] as const;

type TrayAppId = (typeof TRAY_APP_ORDER)[number];

// Every tray app's definition for the windowing package's system tray: the
// component the tray renders and the title and icon Settings and the
// app's context menu name it with. The app shell mounts this one definition
// above every pane, so each pane's tray and Settings share the
// user's choice of which apps are on.
export const TRAY_APPS: SystemTrayDefinition<TrayAppId> = {
  apps: {
    "navigation-mode": {
      component: NavigationModeTrayApp,
      icon: LayoutIcon,
      title: "Layout Switch",
    },
    "sync-status": {
      component: SyncStatusTrayApp,
      icon: CloudCheckIcon,
      title: "Sync Status",
    },
    theme: {
      component: ThemeTrayApp,
      icon: ThemeInvertIcon,
      title: "Theme Switch",
    },
  },
  order: TRAY_APP_ORDER,
};
