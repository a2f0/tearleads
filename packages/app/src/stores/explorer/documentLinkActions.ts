import type {
  ContainerDocumentLinksRuntime,
  DocumentSummary,
  MergeDocumentSummary,
  SetLinkedContainerIdsForDocument,
} from "@tearleads/client-sdk";

export function canMutateSelectedDocument(
  appData: ContainerDocumentLinksRuntime,
) {
  return appData.canMutateDocumentLinks;
}

export function canMutateLocalSelectedDocument(
  appData: ContainerDocumentLinksRuntime,
) {
  return appData.canMutateLocalDocumentLinks;
}

export function moveExplorerNote(params: {
  appData: ContainerDocumentLinksRuntime;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: MergeDocumentSummary;
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
  appData: ContainerDocumentLinksRuntime;
  mergeDocumentSummary: MergeDocumentSummary;
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
  appData: ContainerDocumentLinksRuntime;
  mergeDocumentSummary: MergeDocumentSummary;
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
  appData: ContainerDocumentLinksRuntime;
  mergeDocumentSummary: MergeDocumentSummary;
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
