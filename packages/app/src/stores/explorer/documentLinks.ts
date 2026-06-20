import type {
  ContainerDocumentLinks,
  DocumentSummary,
  MergeDocumentSummary,
  SetLinkedContainerIdsForDocument,
} from "@tearleads/client-sdk";

export function canMutateSelectedDocument(appData: ContainerDocumentLinks) {
  return appData.canMutateDocumentLinks;
}

export function canMutateUnsyncedSelectedDocument(
  appData: ContainerDocumentLinks,
) {
  return appData.canMutateUnsyncedDocumentLinks;
}

export function moveExplorerNote(params: {
  appData: ContainerDocumentLinks;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: MergeDocumentSummary;
  note: DocumentSummary;
  replaceLinkedContainers?: boolean | undefined;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  sourceContainerId?: string | null | undefined;
  targetContainerId: string;
}) {
  const {
    appData,
    expandNode,
    mergeDocumentSummary,
    note,
    replaceLinkedContainers,
    setLinkedContainerIdsForDocument,
    sourceContainerId,
    targetContainerId,
  } = params;

  return appData.moveDocumentToContainer({
    expandNode,
    mergeDocumentSummary,
    note,
    replaceLinkedContainers,
    setLinkedContainerIdsForDocument,
    sourceContainerId,
    targetContainerId,
  });
}

export function purgeExplorerNote(params: {
  appData: ContainerDocumentLinks;
  note: DocumentSummary;
}) {
  const { appData, note } = params;

  return appData.purgeDocument({ note });
}

export function linkExplorerNote(params: {
  appData: ContainerDocumentLinks;
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
  appData: ContainerDocumentLinks;
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
  appData: ContainerDocumentLinks;
  mergeDocumentSummary: MergeDocumentSummary;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, mergeDocumentSummary, note, targetContainerId } = params;

  return appData.setActiveDocumentContainer({
    mergeDocumentSummary,
    note,
    targetContainerId,
  });
}
