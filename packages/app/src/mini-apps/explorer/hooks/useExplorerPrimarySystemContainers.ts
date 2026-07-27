import type { ContainerNode } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useMemo } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { getContactsContainerId } from "../../../stores/contacts/contactsSystemSlot";
import { useExplorerPrimaryOrganizationId } from "./useExplorerPrimaryOrganizationId";

interface PrimarySystemContainerResolutionInput {
  contactsSystemSlot: ContainerSystemSlot | null;
  nodes: ReadonlyArray<ContainerNode>;
  primaryOrganizationId: string | null;
}

export function resolveExplorerPrimarySystemContainerIds(
  input: PrimarySystemContainerResolutionInput,
): { contactsContainerId: string | null } {
  if (!input.primaryOrganizationId) {
    return { contactsContainerId: null };
  }

  // Contacts is provisioned only for the personal organization. Keep its
  // projection bound there when Org Manager activates an additional organization
  // that intentionally has no Contacts container.
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
  };
}

export function useExplorerPrimarySystemContainers(input: {
  appData: RuntimeSnapshot;
  contactsSystemSlot: ContainerSystemSlot | null;
  nodes: ReadonlyArray<ContainerNode>;
}): {
  contactsContainerId: string | null;
  primaryOrganizationId: string | null;
} {
  const primaryOrganizationId = useExplorerPrimaryOrganizationId({
    appData: input.appData,
    nodes: input.nodes,
  });
  const systemContainers = useMemo(
    () =>
      resolveExplorerPrimarySystemContainerIds({
        contactsSystemSlot: input.contactsSystemSlot,
        nodes: input.nodes,
        primaryOrganizationId,
      }),
    [input.contactsSystemSlot, input.nodes, primaryOrganizationId],
  );

  return { ...systemContainers, primaryOrganizationId };
}
