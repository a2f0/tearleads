import type {
  ContainerDocumentLinkActions,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useCallback, useMemo } from "react";
import {
  createExplorerTargetLookups,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
} from "../targetOptions";
import { useSelectedDocumentActions } from "./useSelectedDocumentActions";

function getSelectedDocumentLinkedContainerIds(params: {
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  selectedDocument: DocumentSummary | undefined;
}) {
  const { linkedContainerIdsByDocumentId, selectedDocument } = params;
  if (!selectedDocument) {
    return [];
  }

  const defaultContainerIds =
    selectedDocument.containerId === null ? [] : [selectedDocument.containerId];
  if (!selectedDocument.documentId) {
    return defaultContainerIds;
  }

  const linkedContainerIds =
    linkedContainerIdsByDocumentId.get(selectedDocument.documentId) ?? [];
  return linkedContainerIds.length > 0
    ? linkedContainerIds
    : defaultContainerIds;
}

function useSelectedDocumentTargetOptions(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocument: DocumentSummary | undefined;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
}) {
  const {
    documentSummaries,
    nodes,
    selectedDocument,
    selectedDocumentLinkedContainerIds,
  } = params;
  const targetLookups = useMemo(
    () => createExplorerTargetLookups(nodes, documentSummaries),
    [documentSummaries, nodes],
  );
  const selectedDocumentMoveTargetOptions = useMemo(
    () =>
      selectedDocument
        ? getDocumentMoveTargetOptions(
            nodes,
            documentSummaries,
            selectedDocument.id,
            targetLookups,
          )
        : [],
    [documentSummaries, nodes, selectedDocument, targetLookups],
  );
  const selectedDocumentLinkTargetOptions = useMemo(
    () =>
      selectedDocument
        ? getDocumentLinkTargetOptions(
            nodes,
            documentSummaries,
            selectedDocument.id,
            selectedDocumentLinkedContainerIds,
            targetLookups,
          )
        : [],
    [
      documentSummaries,
      nodes,
      selectedDocument,
      selectedDocumentLinkedContainerIds,
      targetLookups,
    ],
  );

  return {
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
  };
}

export function useSelectedDocumentStructuralState(params: {
  appData: ContainerDocumentLinkActions;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  onDocumentLinksChanged: () => void;
  selectedDocument: DocumentSummary | undefined;
  setLinkedContainerIdsForDocument: (
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ) => void;
}) {
  const {
    appData,
    documentSummaries,
    expandNode,
    linkedContainerIdsByDocumentId,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    selectedDocument,
    setLinkedContainerIdsForDocument,
  } = params;
  const selectedDocumentLinkedContainerIds =
    getSelectedDocumentLinkedContainerIds({
      linkedContainerIdsByDocumentId,
      selectedDocument,
    });
  const { activateLinkedDocument, linkDocument, moveDocument, unlinkDocument } =
    useSelectedDocumentActions({
      appData,
      documentSummaries,
      expandNode,
      loadDocumentSummary,
      mergeDocumentSummary,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    });
  const {
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
  } = useSelectedDocumentTargetOptions({
    documentSummaries,
    nodes,
    selectedDocument,
    selectedDocumentLinkedContainerIds,
  });

  return {
    activateLinkedDocument,
    linkDocument,
    moveDocument,
    selectedDocumentLinkedContainerIds,
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
    unlinkDocument,
  };
}

export function useSelectDocumentProjection(params: {
  activateLinkedDocument: (
    noteId: string,
    containerId: string,
  ) => Promise<DocumentSummary | null>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  selectDocument: (id: string, containerId: string) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const {
    activateLinkedDocument,
    loadDocumentSummary,
    selectDocument,
    setSelectedId,
  } = params;

  return useCallback(
    (noteId: string, containerId: string) => {
      selectDocument(noteId, containerId);
      void (async () => {
        const existingDocument = await loadDocumentSummary(noteId);
        if (!existingDocument) {
          setSelectedId(containerId);
          return;
        }

        if (existingDocument.containerId !== containerId) {
          const activatedDocument = await activateLinkedDocument(
            noteId,
            containerId,
          );
          if (!activatedDocument) {
            setSelectedId(noteId);
          }
        }
      })();
    },
    [
      activateLinkedDocument,
      loadDocumentSummary,
      selectDocument,
      setSelectedId,
    ],
  );
}
