import type { LauncherDefinition } from "@tearleads/windowing";
import { BackupRestoreApp } from "./backup-restore/BackupRestoreApp";
import {
  HOME_MINI_APP_ID,
  MINI_APP_ICONS,
  MINI_APP_ORDER,
  MINI_APP_TITLES,
} from "./catalog";
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
// catalog.ts for chrome that only labels or lists them. Both the regular app
// and the demo launch this one set.
export const MINI_APPS: Readonly<Record<MiniAppId, MiniAppDefinition>> = {
  "backup-restore": {
    createComponent: () => BackupRestoreApp,
    icon: MINI_APP_ICONS["backup-restore"],
    initialShowSidebar: false,
    title: MINI_APP_TITLES["backup-restore"],
  },
  contacts: {
    createComponent: () => ContactsApp,
    icon: MINI_APP_ICONS.contacts,
    title: MINI_APP_TITLES.contacts,
  },
  explorer: {
    createComponent: () => ExplorerApp,
    icon: MINI_APP_ICONS.explorer,
    title: MINI_APP_TITLES.explorer,
  },
  "identity-manager": {
    createComponent: () => IdentityManagerApp,
    icon: MINI_APP_ICONS["identity-manager"],
    title: MINI_APP_TITLES["identity-manager"],
  },
  notes: {
    createComponent: () => createNotesWindowComponent(),
    icon: MINI_APP_ICONS.notes,
    title: MINI_APP_TITLES.notes,
  },
  "org-manager": {
    createComponent: () => OrgManagerApp,
    icon: MINI_APP_ICONS["org-manager"],
    title: MINI_APP_TITLES["org-manager"],
  },
  root: {
    createComponent: () => RootApp,
    icon: MINI_APP_ICONS.root,
    title: MINI_APP_TITLES.root,
  },
  "system-monitor": {
    createComponent: () => SystemMonitorApp,
    icon: MINI_APP_ICONS["system-monitor"],
    initialShowSidebar: false,
    title: MINI_APP_TITLES["system-monitor"],
  },
};

// The launcher the panes run: every mini-app, in menu order, with Explorer at
// the routed shell's root route.
export const MINI_APP_LAUNCHER: LauncherDefinition<MiniAppId> = {
  apps: MINI_APPS,
  homeAppId: HOME_MINI_APP_ID,
  order: MINI_APP_ORDER,
};
