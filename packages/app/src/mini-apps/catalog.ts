import type { Icon } from "@phosphor-icons/react";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { NoteIcon } from "@phosphor-icons/react/dist/csr/Note";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SystemMonitorIcon } from "./system-monitor/icon";
import type { MiniAppId } from "./types";

// Presentation metadata for every mini-app: titles, icons, and menu order. It
// imports no mini-app implementation, so chrome that only labels or lists apps
// (the footer taskbar, the pane context menu, the routed nav and app bar) does
// not load every mini-app. registry.ts pairs these titles with the components.

export const MINI_APP_TITLES: Readonly<Record<MiniAppId, string>> = {
  "backup-restore": "Backup / Restore",
  contacts: "Contacts",
  explorer: "Explorer",
  "identity-manager": "Identity Manager",
  notes: "Notes",
  "org-manager": "Org Manager",
  root: "Root",
  "system-monitor": "System Monitor",
};

// appId -> icon lookup used by consumers such as the footer taskbar to badge a
// window with its app's glyph. Declared as an exhaustive Record so adding a new
// mini app is a compile error here until its icon is supplied.
export const MINI_APP_ICONS: Readonly<Record<MiniAppId, Icon>> = {
  "backup-restore": ArchiveIcon,
  contacts: AddressBookIcon,
  explorer: FolderIcon,
  "identity-manager": IdentificationCardIcon,
  notes: NoteIcon,
  "org-manager": BuildingsIcon,
  root: ShieldCheckIcon,
  "system-monitor": SystemMonitorIcon,
};

interface MiniAppMenuItem {
  appId: MiniAppId;
  icon: Icon;
  label: string;
}

export const MINI_APP_ORDER = [
  "explorer",
  "contacts",
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
    icon: MINI_APP_ICONS[appId],
    label: MINI_APP_TITLES[appId],
  }));

// Keep a named routed-navigation seam even though it currently shares the Start
// menu's app ordering. System Monitor remains directly reachable from the
// windowed footer tray too.
export const ROUTED_MINI_APP_NAV_ITEMS: ReadonlyArray<MiniAppMenuItem> = [
  ...MINI_APP_MENU_ITEMS,
];
