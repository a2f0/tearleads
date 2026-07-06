import type { ContainerNode } from "@tearleads/client-sdk";

export function resolveExplorerPrimaryOrganizationId(input: {
  currentOrganizationId: string | null | undefined;
  nodes: ReadonlyArray<ContainerNode>;
  personalRootContainerId: string | null | undefined;
}): string | null {
  const personalRoot =
    input.personalRootContainerId != null
      ? (input.nodes.find(
          (node) =>
            node.id === input.personalRootContainerId && node.parentId === null,
        ) ?? null)
      : null;

  return personalRoot?.organizationId || input.currentOrganizationId || null;
}
