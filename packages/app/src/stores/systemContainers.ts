import type { ContainerSystemSlotDefinition } from "@tearleads/client-sdk";

export const CONTACTS_CONTAINER_NAME = "Contacts";
export const CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION: ContainerSystemSlotDefinition =
  {
    namespace: "tearleads.contacts",
    projectorId: "contact",
    slotId: "contacts",
    version: 1,
  };

export const EXPLORER_TRASH_CONTAINER_NAME = "Trash";
const EXPLORER_TRASH_CONTAINER_SYSTEM_SLOT_DEFINITION: ContainerSystemSlotDefinition =
  {
    namespace: "tearleads.explorer",
    projectorId: "explorer",
    slotId: "trash",
    version: 1,
  };

export type UserSystemContainerKind = "contacts" | "trash";

interface UserSystemContainerDefinition {
  readonly kind: UserSystemContainerKind;
  readonly name: string;
  readonly slotDefinition: ContainerSystemSlotDefinition;
}

export const USER_SYSTEM_CONTAINER_DEFINITIONS: readonly UserSystemContainerDefinition[] =
  [
    {
      kind: "contacts",
      name: CONTACTS_CONTAINER_NAME,
      slotDefinition: CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION,
    },
    {
      kind: "trash",
      name: EXPLORER_TRASH_CONTAINER_NAME,
      slotDefinition: EXPLORER_TRASH_CONTAINER_SYSTEM_SLOT_DEFINITION,
    },
  ];
