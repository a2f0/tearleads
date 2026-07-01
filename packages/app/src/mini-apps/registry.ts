import type { Icon } from "@phosphor-icons/react";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { GaugeIcon } from "@phosphor-icons/react/dist/csr/Gauge";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { NoteIcon } from "@phosphor-icons/react/dist/csr/Note";
import { BackupRestoreApp } from "./backup-restore/BackupRestoreApp";
import { ContactsApp } from "./contacts/ContactsApp";
import { ExplorerApp } from "./explorer/ExplorerApp";
import { IdentityManagerApp } from "./identity-manager/IdentityManagerApp";
import { createNotesWindowComponent } from "./notes/NotesApp";
import { OrgManagerApp } from "./org-manager/OrgManagerApp";
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
    initialShowSidebar: false,
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

// "system-monitor" is intentionally omitted from the windowed pane menu: there
// it is launched from the footer's system tray (SystemMonitorLauncherButton),
// which also handles unpinning, rather than from the generic pane/app menu.
export const MINI_APP_MENU_ITEMS = [
  { appId: "explorer", icon: FolderIcon, label: "Open Explorer" },
  { appId: "contacts", icon: AddressBookIcon, label: "Open Contacts" },
  { appId: "org-manager", icon: BuildingsIcon, label: "Open Org Manager" },
  { appId: "notes", icon: NoteIcon, label: "Open Notes" },
  {
    appId: "identity-manager",
    icon: IdentificationCardIcon,
    label: "Open Identity Manager",
  },
  {
    appId: "backup-restore",
    icon: ArchiveIcon,
    label: "Open Backup / Restore",
  },
] satisfies ReadonlyArray<{
  appId: MiniAppId;
  icon: Icon;
  label: string;
}>;

// The routed (mobile/tablet) layout has no footer tray, so it surfaces the
// System Monitor alongside the other apps in its nav and home launcher. Its
// pin action persists the same pane-level mode and renders the monitor on the
// routed home screen only after the user requests it.
export const ROUTED_MINI_APP_NAV_ITEMS = [
  ...MINI_APP_MENU_ITEMS,
  { appId: "system-monitor", icon: GaugeIcon, label: "Open System Monitor" },
] satisfies ReadonlyArray<{
  appId: MiniAppId;
  icon: Icon;
  label: string;
}>;
