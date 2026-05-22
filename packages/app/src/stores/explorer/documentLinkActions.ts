import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import {
  activateDocumentLinkState as activateExplorerDocumentLinkState,
  canMutateDocumentLink as canMutateExplorerDocumentLink,
  type DocumentStructuralMutationHost as ExplorerDocumentStructuralMutationHost,
  linkDocumentLinkState as linkExplorerDocumentLinkState,
  type MergeDocumentSummary as MergeExplorerDocumentSummary,
  moveDocumentLinkState as moveExplorerDocumentLinkState,
  type SetLinkedContainerIdsForDocument,
  unlinkDocumentLinkState as unlinkExplorerDocumentLinkState,
} from "@tearleads/client-sdk/workflows/container-contents";
import { primeDocumentStore } from "../documents/DocumentsProvider";
import {
  createExplorerDocumentsRuntime,
  type ExplorerDocumentsRuntimeAppData,
} from "./documentRuntime";

type ExplorerDocumentsRuntime = ReturnType<
  typeof createExplorerDocumentsRuntime
>;

function createExplorerDocumentLinkHost(
  appData: ExplorerDocumentsRuntimeAppData,
  mergeDocumentSummary: MergeExplorerDocumentSummary,
): ExplorerDocumentStructuralMutationHost<ExplorerDocumentsRuntime> {
  return {
    createDocumentRuntime: (containerId) =>
      createExplorerDocumentsRuntime(appData, containerId),
    mergeDocumentSummary,
    primeDocumentStore: ({ containerId, documentId, localId }) =>
      primeDocumentStore(
        appData.domainScope,
        localId,
        createExplorerDocumentsRuntime(appData, containerId),
        documentId,
      ),
  };
}

export type { MergeExplorerDocumentSummary, SetLinkedContainerIdsForDocument };

export function canMutateSelectedDocument(
  appData: ExplorerDocumentsRuntimeAppData,
) {
  return canMutateExplorerDocumentLink(appData);
}

export function moveExplorerNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  note: DocumentSummary;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  targetContainerId: string;
}) {
  const {
    appData,
    expandNode,
    mergeDocumentSummary,
    note,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  } = params;

  return moveExplorerDocumentLinkState({
    expandNode,
    host: createExplorerDocumentLinkHost(appData, mergeDocumentSummary),
    note,
    runtime: appData,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  });
}

export function linkExplorerNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  note: DocumentSummary;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  targetContainerId: string;
}) {
  const {
    appData,
    mergeDocumentSummary,
    note,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  } = params;

  return linkExplorerDocumentLinkState({
    host: createExplorerDocumentLinkHost(appData, mergeDocumentSummary),
    note,
    runtime: appData,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  });
}

export function unlinkExplorerLinkedNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  note: DocumentSummary;
  removedContainerId: string;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    mergeDocumentSummary,
    note,
    removedContainerId,
    setLinkedContainerIdsForDocument,
  } = params;

  return unlinkExplorerDocumentLinkState({
    host: createExplorerDocumentLinkHost(appData, mergeDocumentSummary),
    note,
    removedContainerId,
    runtime: appData,
    setLinkedContainerIdsForDocument,
  });
}

export function activateExplorerLinkedNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, mergeDocumentSummary, note, targetContainerId } = params;

  return activateExplorerDocumentLinkState({
    host: createExplorerDocumentLinkHost(appData, mergeDocumentSummary),
    note,
    runtime: appData,
    targetContainerId,
  });
}
