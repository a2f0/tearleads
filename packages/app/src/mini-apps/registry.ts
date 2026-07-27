import type { Icon } from "@phosphor-icons/react";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { NoteIcon } from "@phosphor-icons/react/dist/csr/Note";
import { BackupRestoreApp } from "./backup-restore/BackupRestoreApp";
import { ContactsApp } from "./contacts/ContactsApp";
import { ExplorerApp } from "./explorer/ExplorerApp";
import { IdentityManagerApp } from "./identity-manager/IdentityManagerApp";
import { createNotesWindowComponent } from "./notes/NotesApp";
import { OrgManagerApp } from "./org-manager/OrgManagerApp";
import { SystemMonitorIcon } from "./system-monitor/icon";
import { SystemMonitorApp } from "./system-monitor/SystemMonitorApp";
import type { MiniAppDefinition, MiniAppId } from "./types";

export const MINI_APPS: Readonly<Record<MiniAppId, MiniAppDefinition>> = {
  "backup-restore": {
    createComponent: () => BackupRestoreApp,
    initialShowSidebar: false,
    title: "Backup / Restore",
  },
  contacts: {
    createComponent: () => ContactsApp,
    title: "Contacts",
  },
  explorer: {
    createComponent: () => ExplorerApp,
    title: "Explorer",
  },
  "identity-manager": {
    createComponent: () => IdentityManagerApp,
    title: "Identity Manager",
  },
  notes: {
    createComponent: () => createNotesWindowComponent(),
    title: "Notes",
  },
  "org-manager": {
    createComponent: () => OrgManagerApp,
    title: "Org Manager",
  },
  "system-monitor": {
    createComponent: () => SystemMonitorApp,
    initialShowSidebar: false,
    title: "System Monitor",
  },
};

export const MINI_APP_MENU_ITEMS = [
  { appId: "explorer", icon: FolderIcon, label: "Explorer" },
  { appId: "contacts", icon: AddressBookIcon, label: "Contacts" },
  { appId: "org-manager", icon: BuildingsIcon, label: "Org Manager" },
  { appId: "notes", icon: NoteIcon, label: "Notes" },
  {
    appId: "identity-manager",
    icon: IdentificationCardIcon,
    label: "Identity Manager",
  },
  {
    appId: "backup-restore",
    icon: ArchiveIcon,
    label: "Backup / Restore",
  },
  { appId: "system-monitor", icon: SystemMonitorIcon, label: "System Monitor" },
] satisfies ReadonlyArray<{
  appId: MiniAppId;
  icon: Icon;
  label: string;
}>;

// Keep a named routed-navigation seam even though it currently shares the Start
// menu's app ordering. System Monitor remains directly reachable from the
// windowed footer tray too.
export const ROUTED_MINI_APP_NAV_ITEMS = [
  ...MINI_APP_MENU_ITEMS,
] satisfies ReadonlyArray<{
  appId: MiniAppId;
  icon: Icon;
  label: string;
}>;

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
  "system-monitor": SystemMonitorIcon,
};
