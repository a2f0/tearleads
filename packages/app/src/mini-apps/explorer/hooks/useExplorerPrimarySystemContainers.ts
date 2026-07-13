import type { ContainerNode } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useMemo } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  getContactsContainerId,
  getContactsTrashContainerId,
} from "../../../stores/contacts/contactsSystemSlot";
import { useExplorerPrimaryOrganizationId } from "./useExplorerPrimaryOrganizationId";

interface PrimarySystemContainerResolutionInput {
  contactsSystemSlot: ContainerSystemSlot | null;
  nodes: ReadonlyArray<ContainerNode>;
  primaryOrganizationId: string | null;
  trashSystemSlot: ContainerSystemSlot | null;
}

export function resolveExplorerPrimarySystemContainerIds(
  input: PrimarySystemContainerResolutionInput,
): { contactsContainerId: string | null; trashContainerId: string | null } {
  if (!input.primaryOrganizationId) {
    return { contactsContainerId: null, trashContainerId: null };
  }

  // Contacts is provisioned only for the personal organization. Keep its
  // projection and matching Trash bound there when Org Manager activates an
  // additional organization that intentionally has no Contacts container.
  const primaryRootContainerId =
    input.nodes.find(
      (node) =>
        node.parentId === null &&
        node.organizationId === input.primaryOrganizationId,
    )?.id ?? null;

  return {
    contactsContainerId: getContactsContainerId(
      input.nodes,
      input.contactsSystemSlot,
      input.primaryOrganizationId,
      primaryRootContainerId,
    ),
    trashContainerId: getContactsTrashContainerId(
      input.nodes,
      input.trashSystemSlot,
      input.primaryOrganizationId,
      primaryRootContainerId,
    ),
  };
}

export function useExplorerPrimarySystemContainers(input: {
  appData: RuntimeSnapshot;
  contactsSystemSlot: ContainerSystemSlot | null;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
  trashSystemSlot: ContainerSystemSlot | null;
}): {
  contactsContainerId: string | null;
  primaryOrganizationId: string | null;
  trashContainerId: string | null;
} {
  const tearleads = useTearleads();
  const primaryOrganizationId = useExplorerPrimaryOrganizationId({
    appData: input.appData,
    nodes: input.nodes,
    ready: input.ready,
    tearleads,
  });
  const systemContainers = useMemo(
    () =>
      resolveExplorerPrimarySystemContainerIds({
        contactsSystemSlot: input.contactsSystemSlot,
        nodes: input.nodes,
        primaryOrganizationId,
        trashSystemSlot: input.trashSystemSlot,
      }),
    [
      input.contactsSystemSlot,
      input.nodes,
      input.trashSystemSlot,
      primaryOrganizationId,
    ],
  );

  return { ...systemContainers, primaryOrganizationId };
}
