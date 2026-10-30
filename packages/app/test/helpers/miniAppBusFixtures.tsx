import type { ComponentType } from "react";
import type { MiniAppDefinition, MiniAppId } from "../../src/mini-apps/types";

export function EmptyMiniApp() {
  return null;
}

export function createMiniApps(
  orgManagerComponent: ComponentType,
  contactsComponent: ComponentType = EmptyMiniApp,
): Readonly<Record<MiniAppId, MiniAppDefinition>> {
  return {
    "backup-restore": {
      createComponent: () => EmptyMiniApp,
      title: "Backup / Restore",
    },
    contacts: {
      createComponent: () => contactsComponent,
      title: "Contacts",
    },
    "display-properties": {
      createComponent: () => EmptyMiniApp,
      title: "Display Properties",
    },
    explorer: {
      createComponent: () => EmptyMiniApp,
      title: "Explorer",
    },
    "identity-manager": {
      createComponent: () => EmptyMiniApp,
      title: "Identity Manager",
    },
    notes: {
      createComponent: () => EmptyMiniApp,
      title: "Notes",
    },
    "org-manager": {
      createComponent: () => orgManagerComponent,
      title: "Org Manager",
    },
    organizations: {
      createComponent: () => EmptyMiniApp,
      title: "Organizations",
    },
    root: { createComponent: () => () => null, title: "Root" },
    "system-monitor": {
      createComponent: () => EmptyMiniApp,
      title: "System Monitor",
    },
  };
}
