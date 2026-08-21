import type { ContainerNode } from "@symcrypt/client-sdk";

export function resolveExplorerPrimaryOrganizationId(input: {
  currentOrganizationId: string | null | undefined;
  primaryLocalOrganizationId?: string | null | undefined;
  nodes: ReadonlyArray<ContainerNode>;
  personalRootContainerId: string | null | undefined;
}): string | null {
  if (input.primaryLocalOrganizationId) {
    return input.primaryLocalOrganizationId;
  }

  const personalRoot =
    input.personalRootContainerId != null
      ? (input.nodes.find(
          (node) =>
            node.id === input.personalRootContainerId && node.parentId === null,
        ) ?? null)
      : null;

  if (personalRoot) {
    return personalRoot.organizationId || null;
  }

  return input.currentOrganizationId || null;
}
