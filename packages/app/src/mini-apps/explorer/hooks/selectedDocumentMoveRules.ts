import type {
  ContainerDocumentLinks,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { canMutateUnsyncedSelectedDocument } from "../../../stores/explorer/documentLinks";
import {
  canMoveDocumentToContainerByRules,
  type ExplorerContainerRulesContext,
} from "../model/containerRules";

export function canRecoverNullContainerDocument(
  document: DocumentSummary,
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>,
): boolean {
  // Local-only documents have no remote link projection to confirm.
  if (document.containerId !== null || document.documentId === null) {
    return true;
  }

  // Recovery moves are reserved for documents whose entire surviving link
  // projection is known to be empty. Missing projection state fails closed so
  // a stale/forged selection cannot unlink a valid document.
  return linkedContainerIdsByDocumentId.get(document.documentId)?.length === 0;
}

export function canMoveExplorerActionDocument(params: {
  appData: ContainerDocumentLinks;
  document: DocumentSummary;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
  targetContainerId: string;
}): boolean {
  const { appData, document, nodes, rulesContext, targetContainerId } = params;
  const currentContainer =
    document.containerId === null
      ? null
      : nodes.find((node) => node.id === document.containerId);
  const canMoveDocument =
    document.documentId === null
      ? canMutateUnsyncedSelectedDocument(appData)
      : appData.infra.dbStatus === "ready";
  const targetContainer = nodes.find((node) => node.id === targetContainerId);

  // Refuse to relocate the pinned self contact (a Move to Trash would delete
  // it), then honor the source/destination move rules. Contacts pins its
  // contents for ordinary moves while still allowing the Trash destination.
  return Boolean(
    canMoveDocument &&
      targetContainer &&
      canMoveDocumentToContainerByRules(
        rulesContext,
        currentContainer,
        targetContainer,
        document,
      ),
  );
}
