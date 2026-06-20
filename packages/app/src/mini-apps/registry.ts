import { BackupRestoreApp } from "./backup-restore/BackupRestoreApp";
import { ContactsApp } from "./contacts/ContactsApp";
import { ExplorerApp } from "./explorer/ExplorerApp";
import { IdentityManagerApp } from "./identity-manager/IdentityManagerApp";
import { createNotesWindowComponent } from "./notes/NotesApp";
import { OrgManagerApp } from "./org-manager/OrgManagerApp";
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
};

export const MINI_APP_MENU_ITEMS = [
  { appId: "backup-restore", label: "Open Backup / Restore" },
  { appId: "notes", label: "Open Notes" },
  { appId: "contacts", label: "Open Contacts" },
  { appId: "explorer", label: "Open Explorer" },
  { appId: "identity-manager", label: "Open Identity Manager" },
  { appId: "org-manager", label: "Open Org Manager" },
] satisfies ReadonlyArray<{
  appId: MiniAppId;
  label: string;
}>;
