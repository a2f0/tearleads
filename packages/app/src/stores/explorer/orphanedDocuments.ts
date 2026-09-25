import type { ContainerNode } from "@tearleads/client-sdk";

export const EXPLORER_ORPHANED_DOCUMENTS_ID = "explorer:orphaned-documents";

export function isExplorerOrphanedDocumentsId(
  containerId: string | null | undefined,
): boolean {
  return containerId === EXPLORER_ORPHANED_DOCUMENTS_ID;
}

export function explorerDocumentQueryContainerId(
  containerId: string | null,
): string | null {
  return isExplorerOrphanedDocumentsId(containerId) ? null : containerId;
}

export function explorerDocumentRouteContainerId(
  containerId: string | null,
): string {
  return containerId ?? EXPLORER_ORPHANED_DOCUMENTS_ID;
}

export function isExplorerDocumentContainerSelection(
  routeContainerId: string,
  documentContainerId: string | null,
): boolean {
  return (
    routeContainerId === explorerDocumentRouteContainerId(documentContainerId)
  );
}

export function createExplorerOrphanedDocumentsNode(
  organizationId: string | null,
  name: string,
): ContainerNode {
  return {
    effectiveAccessLevel: "read",
    id: EXPLORER_ORPHANED_DOCUMENTS_ID,
    kind: "container",
    name,
    organizationId: organizationId ?? "",
    parentId: null,
    syncState: {
      lastError: null,
      pendingAttachmentBytes: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      status: "synced",
    },
  };
}

export function listLocalOrphanFolders(
  nodes: readonly ContainerNode[],
  organizationId: string | null,
): ContainerNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  return nodes.filter(
    (node) =>
      node.organizationId === organizationId &&
      node.metadataDocumentId == null &&
      node.parentId !== null &&
      !ids.has(node.parentId),
  );
}
