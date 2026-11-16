import type { Icon } from "@phosphor-icons/react";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { BuildingOfficeIcon } from "@phosphor-icons/react/dist/csr/BuildingOffice";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { NoteIcon } from "@phosphor-icons/react/dist/csr/Note";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SystemMonitorIcon } from "./system-monitor/icon";
import type { MiniAppId } from "./types";

// Default titles, icons, and launcher order without mini-app implementations.
// registry.ts pairs this metadata with components; launchers read presentation
// from that definition through navigation state, including iconLabel overrides.

export const MINI_APP_TITLES: Readonly<Record<MiniAppId, string>> = {
  "backup-restore": "Backup / Restore",
  contacts: "Contacts",
  "display-properties": "Display Properties",
  explorer: "Explorer",
  "identity-manager": "Identity Manager",
  notes: "Notes",
  "org-manager": "Org Manager",
  organizations: "Organizations",
  root: "Root",
  "system-monitor": "System Monitor",
};

// appId -> icon lookup used by consumers such as the footer taskbar to badge a
// window with its app's glyph. Declared as an exhaustive Record so adding a new
// mini app is a compile error here until its icon is supplied.
export const MINI_APP_ICONS: Readonly<Record<MiniAppId, Icon>> = {
  "backup-restore": ArchiveIcon,
  contacts: AddressBookIcon,
  "display-properties": MonitorIcon,
  explorer: FolderIcon,
  "identity-manager": IdentificationCardIcon,
  notes: NoteIcon,
  "org-manager": BuildingsIcon,
  organizations: BuildingOfficeIcon,
  root: ShieldCheckIcon,
  "system-monitor": SystemMonitorIcon,
};

interface MiniAppMenuItem {
  appId: MiniAppId;
}

// The windowed desktop opens Display Properties from its context menu, so it
// is left out of the menu order.
export const MINI_APP_ORDER = [
  "explorer",
  "contacts",
  "organizations",
  "org-manager",
  "notes",
  "identity-manager",
  "backup-restore",
  "system-monitor",
  "root",
] as const satisfies ReadonlyArray<MiniAppId>;

// The routed shell shows Explorer at the root route.
export const HOME_MINI_APP_ID: MiniAppId = "explorer";

export const MINI_APP_MENU_ITEMS: ReadonlyArray<MiniAppMenuItem> =
  MINI_APP_ORDER.map((appId) => ({
    appId,
  }));

// The routed shell has no desktop menu, so its navigation lists Display
// Properties last: there its theme and tray-app switches stay reachable even
// with every tray app turned off.
export const ROUTED_MINI_APP_NAV_ITEMS: ReadonlyArray<MiniAppMenuItem> = [
  ...MINI_APP_MENU_ITEMS,
  { appId: "display-properties" },
];
