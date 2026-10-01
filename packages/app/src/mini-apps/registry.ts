import { BackupRestoreApp } from "./backup-restore/BackupRestoreApp";
import { MINI_APP_TITLES } from "./catalog";
import { ContactsApp } from "./contacts/ContactsApp";
import { ExplorerApp } from "./explorer/ExplorerApp";
import { IdentityManagerApp } from "./identity-manager/IdentityManagerApp";
import { createNotesWindowComponent } from "./notes/NotesApp";
import { OrgManagerApp } from "./org-manager/OrgManagerApp";
import { RootApp } from "./root/RootApp";
import { SystemMonitorApp } from "./system-monitor/SystemMonitorApp";
import type { MiniAppDefinition, MiniAppId } from "./types";

// The mini-app components. Importing this module loads every mini-app, so only
// the shells that render apps use it; titles, icons, and menu order live in
// catalog.ts for chrome that only labels or lists them.
export const MINI_APPS: Readonly<Record<MiniAppId, MiniAppDefinition>> = {
  "backup-restore": {
    createComponent: () => BackupRestoreApp,
    initialShowSidebar: false,
    title: MINI_APP_TITLES["backup-restore"],
  },
  contacts: {
    createComponent: () => ContactsApp,
    title: MINI_APP_TITLES.contacts,
  },
  explorer: {
    createComponent: () => ExplorerApp,
    title: MINI_APP_TITLES.explorer,
  },
  "identity-manager": {
    createComponent: () => IdentityManagerApp,
    title: MINI_APP_TITLES["identity-manager"],
  },
  notes: {
    createComponent: () => createNotesWindowComponent(),
    title: MINI_APP_TITLES.notes,
  },
  "org-manager": {
    createComponent: () => OrgManagerApp,
    title: MINI_APP_TITLES["org-manager"],
  },
  root: {
    createComponent: () => RootApp,
    title: MINI_APP_TITLES.root,
  },
  "system-monitor": {
    createComponent: () => SystemMonitorApp,
    initialShowSidebar: false,
    title: MINI_APP_TITLES["system-monitor"],
  },
};
