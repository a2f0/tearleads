import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import {
  activateDocumentLinkState,
  linkDocumentLinkState,
  moveDocumentLinkState,
  unlinkDocumentLinkState,
} from "@tearleads/client-sdk/workflows/container-contents";
import { primeDocumentStore } from "../documents/DocumentsProvider";
import type { ExplorerDocumentsRuntimeAppData } from "./documentRuntime";

export type MergeExplorerDocumentSummary = (
  nextDocument: DocumentSummary,
) => void;
export type SetLinkedContainerIdsForDocument = (
  documentId: string,
  linkedContainerIds: ReadonlyArray<string>,
) => void;

function createExplorerDocumentLinkHost(
  appData: ExplorerDocumentsRuntimeAppData,
  mergeDocumentSummary: MergeExplorerDocumentSummary,
) {
  return {
    createDocumentRuntime: appData.createDocumentRuntime,
    mergeDocumentSummary,
    primeDocumentStore: (input: {
      containerId: string;
      documentId: string;
      localId: string;
    }) =>
      primeDocumentStore(
        appData.domainScope,
        input.localId,
        appData.createDocumentRuntime(input.containerId),
        input.documentId,
      ),
  };
}

export function canMutateSelectedDocument(
  appData: ExplorerDocumentsRuntimeAppData,
) {
  return appData.canMutateDocumentLinks;
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

  return moveDocumentLinkState({
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

  return linkDocumentLinkState({
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

  return unlinkDocumentLinkState({
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

  return activateDocumentLinkState({
    host: createExplorerDocumentLinkHost(appData, mergeDocumentSummary),
    note,
    runtime: appData,
    targetContainerId,
  });
}
