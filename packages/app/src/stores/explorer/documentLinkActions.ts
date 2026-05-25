import type {
  TearleadsMergeDocumentSummary,
  TearleadsSetLinkedContainerIdsForDocument,
} from "@tearleads/client-sdk";
import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import type { ExplorerDocumentsRuntimeAppData } from "./documentRuntime";

export type MergeExplorerDocumentSummary = TearleadsMergeDocumentSummary;
export type SetLinkedContainerIdsForDocument =
  TearleadsSetLinkedContainerIdsForDocument;

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

  return appData.moveDocumentToContainer({
    expandNode,
    mergeDocumentSummary,
    note,
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

  return appData.linkDocumentToContainer({
    mergeDocumentSummary,
    note,
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

  return appData.unlinkDocumentFromContainer({
    mergeDocumentSummary,
    note,
    removedContainerId,
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

  return appData.activateDocumentContainer({
    mergeDocumentSummary,
    note,
    targetContainerId,
  });
}
