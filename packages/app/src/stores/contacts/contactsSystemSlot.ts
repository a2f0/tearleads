import type { ContainerNode } from "@symcrypt/client-sdk";

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
