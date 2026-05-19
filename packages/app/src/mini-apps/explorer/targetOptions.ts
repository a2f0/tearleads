import type { DocumentSummary } from "@tearleads/client-sdk/data/documentSummary";
import type { ContainerNode } from "../../stores/explorer/types";

export interface MoveTargetOption {
  id: string;
  label: string;
}

export interface ExplorerTargetLookups {
  documentSummariesById: ReadonlyMap<string, DocumentSummary>;
  nodesById: ReadonlyMap<string, ContainerNode>;
}

export function createExplorerTargetLookups(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
): ExplorerTargetLookups {
  return {
    documentSummariesById: new Map(
      documentSummaries.map((document) => [document.id, document]),
    ),
    nodesById: new Map(nodes.map((node) => [node.id, node])),
  };
}

function getNodesById(
  nodes: ReadonlyArray<ContainerNode>,
  lookups?: Pick<ExplorerTargetLookups, "nodesById">,
): ReadonlyMap<string, ContainerNode> {
  return lookups?.nodesById ?? new Map(nodes.map((node) => [node.id, node]));
}

function getDocumentSummariesById(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  lookups?: Pick<ExplorerTargetLookups, "documentSummariesById">,
): ReadonlyMap<string, DocumentSummary> {
  return (
    lookups?.documentSummariesById ??
    new Map(documentSummaries.map((document) => [document.id, document]))
  );
}

function getSortedTargetOptions(
  candidateNodes: ReadonlyArray<ContainerNode>,
): ReadonlyArray<MoveTargetOption> {
  const options = candidateNodes.map((candidateNode) => ({
    id: candidateNode.id,
    label: `${candidateNode.name} (${candidateNode.id})`,
  }));

  options.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    }),
  );

  return options;
}

export function getMoveTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  movingNodeId: string,
  lookups?: Pick<ExplorerTargetLookups, "nodesById">,
): ReadonlyArray<MoveTargetOption> {
  const nodesById = getNodesById(nodes, lookups);
  const movingNode = nodesById.get(movingNodeId);
  if (!movingNode || movingNode.parentId === null) {
    return [];
  }

  return getSortedTargetOptions(
    nodes.filter((candidateNode) => {
      if (
        candidateNode.id === movingNode.id ||
        candidateNode.organizationId !== movingNode.organizationId
      ) {
        return false;
      }

      let currentNode: ContainerNode | undefined = candidateNode;
      while (currentNode) {
        if (currentNode.parentId === movingNode.id) {
          return false;
        }

        currentNode = currentNode.parentId
          ? nodesById.get(currentNode.parentId)
          : undefined;
      }

      return true;
    }),
  );
}

export function getDocumentMoveTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  documentLocalId: string,
  lookups?: ExplorerTargetLookups,
): ReadonlyArray<MoveTargetOption> {
  const documentSummariesById = getDocumentSummariesById(
    documentSummaries,
    lookups,
  );
  const nodesById = getNodesById(nodes, lookups);
  const movingDocument = documentSummariesById.get(documentLocalId);
  if (!movingDocument?.containerId) {
    return [];
  }

  const currentContainer = nodesById.get(movingDocument.containerId);
  if (!currentContainer) {
    return [];
  }

  return getSortedTargetOptions(
    nodes.filter(
      (candidateNode) =>
        candidateNode.id !== currentContainer.id &&
        candidateNode.organizationId === currentContainer.organizationId,
    ),
  );
}

export function getDocumentLinkTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
  documentLocalId: string,
  linkedContainerIds: ReadonlyArray<string>,
  lookups?: ExplorerTargetLookups,
): ReadonlyArray<MoveTargetOption> {
  const documentSummariesById = getDocumentSummariesById(
    documentSummaries,
    lookups,
  );
  const nodesById = getNodesById(nodes, lookups);
  const linkingDocument = documentSummariesById.get(documentLocalId);
  if (!linkingDocument?.containerId) {
    return [];
  }

  const currentContainer = nodesById.get(linkingDocument.containerId);
  if (!currentContainer) {
    return [];
  }

  const linkedContainerIdSet = new Set(linkedContainerIds);
  return getSortedTargetOptions(
    nodes.filter(
      (candidateNode) =>
        candidateNode.organizationId === currentContainer.organizationId &&
        !linkedContainerIdSet.has(candidateNode.id),
    ),
  );
}
