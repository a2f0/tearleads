import type {
  ContainerDocumentLinks,
  ContainerNode,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useCallback, useMemo } from "react";
import type { ExplorerContainerRulesContext } from "../containerRules";
import {
  createExplorerTargetLookups,
  getDocumentLinkedContainerIds,
  getDocumentLinkTargetOptions,
  getDocumentMoveTargetOptions,
} from "../targetOptions";
import { useSelectedDocumentActions } from "./useSelectedDocumentActions";

function useSelectedDocumentTargetOptions(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
  selectedDocument: DocumentSummary | undefined;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
}) {
  const {
    documentSummaries,
    nodes,
    rulesContext,
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
            rulesContext,
          )
        : [],
    [documentSummaries, nodes, rulesContext, selectedDocument, targetLookups],
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
            rulesContext,
          )
        : [],
    [
      documentSummaries,
      nodes,
      rulesContext,
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
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  nodes: ReadonlyArray<ContainerNode>;
  onDocumentLinksChanged: () => void;
  rulesContext: ExplorerContainerRulesContext;
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
    rulesContext,
    selectedDocument,
    setLinkedContainerIdsForDocument,
  } = params;
  const selectedDocumentLinkedContainerIds = getDocumentLinkedContainerIds({
    document: selectedDocument,
    linkedContainerIdsByDocumentId,
  });
  const {
    activateLinkedDocument,
    linkDocument,
    moveDocument,
    purgeDocument,
    unlinkDocument,
  } = useSelectedDocumentActions({
    appData,
    documentSummaries,
    expandNode,
    loadDocumentSummary,
    mergeDocumentSummary,
    nodes,
    onDocumentLinksChanged,
    rulesContext,
    setLinkedContainerIdsForDocument,
  });
  const {
    selectedDocumentLinkTargetOptions,
    selectedDocumentMoveTargetOptions,
  } = useSelectedDocumentTargetOptions({
    documentSummaries,
    nodes,
    rulesContext,
    selectedDocument,
    selectedDocumentLinkedContainerIds,
  });

  return {
    activateLinkedDocument,
    linkDocument,
    moveDocument,
    purgeDocument,
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
