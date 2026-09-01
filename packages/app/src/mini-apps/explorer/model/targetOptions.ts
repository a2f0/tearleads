import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { isExplorerOrphanedDocumentsId } from "../../../stores/explorer/orphanedDocuments";
import {
  canCreateChildContainerByRules,
  canLinkDocumentIntoContainerByRules,
  canLinkDocumentOutByRules,
  canMoveContainerByRules,
  canMoveDocumentToContainerByRules,
  canWriteDocumentSummary,
  type ExplorerContainerRulesContext,
  isPinnedSelfContact,
} from "./containerRules";

export interface MoveTargetOption {
  id: string;
  icon: string | null | undefined;
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

// Resolve the containers a document is currently linked into, falling back to
// its home container when the link projection has nothing for it yet.
export function getDocumentLinkedContainerIds(params: {
  document: DocumentSummary | undefined;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}): ReadonlyArray<string> {
  const { document, linkedContainerIdsByDocumentId } = params;
  if (!document) {
    return [];
  }

  const defaultContainerIds =
    document.containerId === null ? [] : [document.containerId];
  if (!document.documentId) {
    return defaultContainerIds;
  }

  const linkedContainerIds =
    linkedContainerIdsByDocumentId.get(document.documentId) ?? [];
  return linkedContainerIds.length > 0
    ? linkedContainerIds
    : defaultContainerIds;
}

function getSortedTargetOptions(
  candidateNodes: ReadonlyArray<ContainerNode>,
): ReadonlyArray<MoveTargetOption> {
  const options = candidateNodes.map((candidateNode) => ({
    id: candidateNode.id,
    icon: candidateNode.icon,
    label: candidateNode.name,
  }));

  options.sort((left, right) => {
    const labelOrder = left.label.localeCompare(right.label, undefined, {
      sensitivity: "base",
    });
    if (labelOrder !== 0) {
      return labelOrder;
    }

    // Container ids are only a hidden tie-breaker for duplicate visible names;
    // code-point ordering is deterministic without locale collation overhead.
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  return options;
}

export function getMoveTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  movingNodeId: string,
  lookups: Pick<ExplorerTargetLookups, "nodesById">,
  rulesContext: ExplorerContainerRulesContext,
): ReadonlyArray<MoveTargetOption> {
  const { nodesById } = lookups;
  const movingNode = nodesById.get(movingNodeId);
  if (!movingNode || movingNode.parentId === null) {
    return [];
  }

  if (!canMoveContainerByRules(rulesContext, movingNode)) {
    return [];
  }

  return getSortedTargetOptions(
    nodes.filter((candidateNode) => {
      if (
        candidateNode.id === movingNode.id ||
        isExplorerOrphanedDocumentsId(candidateNode.id) ||
        candidateNode.organizationId !== movingNode.organizationId
      ) {
        return false;
      }

      // A destination that forbids child containers (e.g. Trash, Contacts) is
      // not a valid move target — moving a folder into it would otherwise
      // bypass protectFromChildContainerCreation, the same destination gate
      // document moves already enforce via canAddDocumentToContainerByRules.
      if (!canCreateChildContainerByRules(rulesContext, candidateNode)) {
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
  documentLocalId: string,
  lookups: ExplorerTargetLookups,
  rulesContext: ExplorerContainerRulesContext,
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<MoveTargetOption> {
  const { documentSummariesById, nodesById } = lookups;
  const movingDocument = documentSummariesById.get(documentLocalId);
  if (!movingDocument || !canWriteDocumentSummary(movingDocument)) {
    return [];
  }

  // A remote null-container row is movable only after its link query proves
  // there are no surviving links. Unknown link state fails closed.
  const hasConfirmedNoRemoteLinks =
    movingDocument.documentId === null ||
    linkedContainerIdsByDocumentId.get(movingDocument.documentId)?.length === 0;
  if (movingDocument.containerId === null && !hasConfirmedNoRemoteLinks) {
    return [];
  }

  // The pinned self contact is never relocatable, from any container it is
  // viewed in. Without this, a self contact linked into a plain user container
  // could be "moved" to Trash — a delete-equivalent that bypasses the
  // delete-protection guard and re-enables purge.
  if (isPinnedSelfContact(rulesContext, movingDocument)) {
    return [];
  }

  const currentContainer = movingDocument.containerId
    ? nodesById.get(movingDocument.containerId)
    : null;
  if (movingDocument.containerId !== null && !currentContainer) {
    return [];
  }
  const sourceOrganizationId =
    currentContainer?.organizationId ??
    rulesContext.currentOrganizationId ??
    // Empty organization ids are the canonical pre-auth local-only scope.
    "";

  return getSortedTargetOptions(
    nodes.filter(
      (candidateNode) =>
        candidateNode.id !== currentContainer?.id &&
        !isExplorerOrphanedDocumentsId(candidateNode.id) &&
        candidateNode.organizationId === sourceOrganizationId &&
        canMoveDocumentToContainerByRules(
          rulesContext,
          currentContainer,
          candidateNode,
          movingDocument,
        ),
    ),
  );
}

export function getDocumentLinkTargetOptions(
  nodes: ReadonlyArray<ContainerNode>,
  documentLocalId: string,
  linkedContainerIds: ReadonlyArray<string>,
  lookups: ExplorerTargetLookups,
  rulesContext: ExplorerContainerRulesContext,
): ReadonlyArray<MoveTargetOption> {
  const { documentSummariesById, nodesById } = lookups;
  const linkingDocument = documentSummariesById.get(documentLocalId);
  if (
    !linkingDocument?.containerId ||
    !canWriteDocumentSummary(linkingDocument)
  ) {
    return [];
  }

  const currentContainer = nodesById.get(linkingDocument.containerId);
  if (!currentContainer) {
    return [];
  }

  if (!canLinkDocumentOutByRules(rulesContext, currentContainer)) {
    return [];
  }

  const linkedContainerIdSet = new Set(linkedContainerIds);
  return getSortedTargetOptions(
    nodes.filter(
      (candidateNode) =>
        candidateNode.organizationId === currentContainer.organizationId &&
        !isExplorerOrphanedDocumentsId(candidateNode.id) &&
        !linkedContainerIdSet.has(candidateNode.id) &&
        // Link targets use the inbound-link gate, not the move gate, so a
        // move-only system folder such as Trash is excluded: you can move a
        // document to the Trash but never link it there.
        canLinkDocumentIntoContainerByRules(
          rulesContext,
          candidateNode,
          linkingDocument,
        ),
    ),
  );
}
