import { useCallback } from "react";
import type { DocumentSummary } from "../../../data/persistence/documents/documentsPersistence";
import {
  activateExplorerLinkedNote,
  canMutateSelectedDocument,
  linkExplorerNote,
  type MergeExplorerDocumentSummary,
  moveExplorerNote,
  type SetLinkedContainerIdsForDocument,
  unlinkExplorerLinkedNote,
} from "../../../stores/explorer/documentLinkActions";
import type { ExplorerDocumentsRuntimeAppData } from "../../../stores/explorer/documentRuntime";
import { getDocumentByLocalId } from "../documentSummaries";

function useMoveDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    expandNode,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (!canMutateSelectedDocument(appData)) {
        return null;
      }

      const existingDocument = getDocumentByLocalId(documentSummaries, noteId);
      if (!existingDocument) {
        return null;
      }

      const moveResult = await moveExplorerNote({
        appData,
        expandNode,
        mergeDocumentSummary,
        note: existingDocument,
        setLinkedContainerIdsForDocument,
        targetContainerId,
      });
      if (moveResult.linksChanged) {
        onDocumentLinksChanged();
      }

      return moveResult.note;
    },
    [
      appData,
      documentSummaries,
      expandNode,
      mergeDocumentSummary,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useLinkDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (!canMutateSelectedDocument(appData)) {
        return null;
      }

      const existingDocument = getDocumentByLocalId(documentSummaries, noteId);
      if (!existingDocument) {
        return null;
      }

      const linkedNote = await linkExplorerNote({
        appData,
        mergeDocumentSummary,
        note: existingDocument,
        setLinkedContainerIdsForDocument,
        targetContainerId,
      });
      if (linkedNote) {
        onDocumentLinksChanged();
      }

      return linkedNote;
    },
    [
      appData,
      documentSummaries,
      mergeDocumentSummary,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useUnlinkDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (noteId: string, removedContainerId: string) => {
      if (!canMutateSelectedDocument(appData)) {
        return null;
      }

      const existingDocument = getDocumentByLocalId(documentSummaries, noteId);
      if (!existingDocument) {
        return null;
      }

      const unlinkedNote = await unlinkExplorerLinkedNote({
        appData,
        mergeDocumentSummary,
        note: existingDocument,
        removedContainerId,
        setLinkedContainerIdsForDocument,
      });
      if (unlinkedNote) {
        onDocumentLinksChanged();
      }

      return unlinkedNote;
    },
    [
      appData,
      documentSummaries,
      mergeDocumentSummary,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useActivateLinkedDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
}) {
  const { appData, documentSummaries, mergeDocumentSummary } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (appData.dbStatus !== "ready") {
        return null;
      }

      const existingDocument = getDocumentByLocalId(documentSummaries, noteId);
      if (!existingDocument) {
        return null;
      }

      return activateExplorerLinkedNote({
        appData,
        mergeDocumentSummary,
        note: existingDocument,
        targetContainerId,
      });
    },
    [appData, documentSummaries, mergeDocumentSummary],
  );
}

export function useSelectedDocumentActions(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    expandNode,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  const moveDocument = useMoveDocumentAction({
    appData,
    documentSummaries,
    expandNode,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const activateLinkedDocument = useActivateLinkedDocumentAction({
    appData,
    documentSummaries,
    mergeDocumentSummary,
  });
  const linkDocument = useLinkDocumentAction({
    appData,
    documentSummaries,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const unlinkDocument = useUnlinkDocumentAction({
    appData,
    documentSummaries,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });

  return {
    activateLinkedDocument,
    linkDocument,
    moveDocument,
    unlinkDocument,
  };
}
