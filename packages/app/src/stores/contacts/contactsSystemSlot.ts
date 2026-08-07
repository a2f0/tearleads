import type { ContainerNode } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { getExplorerSystemContainerId } from "../explorer/ExplorerSystemContainers";

type ContactsContainerLookupNode = Pick<
  ContainerNode,
  "id" | "organizationId" | "parentId" | "systemSlot"
>;

export function resolveContactsProjectionRootContainerId(input: {
  activeOrganizationId: string | null | undefined;
  activeRootContainerId: string | null | undefined;
  nodes: ReadonlyArray<ContactsContainerLookupNode>;
  projectionOrganizationId: string | null | undefined;
}): string | null {
  const projectedRoot = input.nodes.find(
    (node) =>
      node.parentId === null &&
      node.organizationId === input.projectionOrganizationId,
  );
  if (projectedRoot) {
    return projectedRoot.id;
  }

  return input.projectionOrganizationId &&
    input.activeOrganizationId === input.projectionOrganizationId
    ? (input.activeRootContainerId ?? null)
    : null;
}

// The Contacts container projection resolves the same way as any other system
// container, so delegate to the shared Explorer resolver rather than duplicating
// it. Trash resolution now lives in stores/systemContainerTrash.
export function getContactsContainerId(
  nodes: ReadonlyArray<ContactsContainerLookupNode> | null,
  contactsSystemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): string | null {
  return getExplorerSystemContainerId(
    nodes,
    contactsSystemSlot,
    organizationId,
    rootContainerId,
  );
}
