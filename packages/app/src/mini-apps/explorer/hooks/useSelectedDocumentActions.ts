import { useCallback } from "react";
import type { DocumentSummary } from "../../../data/documents/shared/documentSummary";
import {
  activateExplorerLinkedNote,
  canMutateSelectedDocument,
  linkExplorerNote,
  type MergeExplorerDocumentSummary,
  moveExplorerNote,
  type SetLinkedContainerIdsForDocument,
  unlinkExplorerLinkedNote,
} from "../../../stores/explorer/documentLinkActions";
import type { ExplorerDocumentReadModel } from "../../../stores/explorer/documentReadModel";
import type { ExplorerDocumentsRuntimeAppData } from "../../../stores/explorer/documentRuntime";
import { getDocumentByLocalId } from "../documentSummaries";

function useMoveDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentReadModel: ExplorerDocumentReadModel;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentReadModel,
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
        documentReadModel,
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
      documentReadModel,
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
  documentReadModel: ExplorerDocumentReadModel;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentReadModel,
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
        documentReadModel,
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
      documentReadModel,
      documentSummaries,
      mergeDocumentSummary,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useUnlinkDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentReadModel: ExplorerDocumentReadModel;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentReadModel,
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
        documentReadModel,
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
      documentReadModel,
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
  documentReadModel: ExplorerDocumentReadModel;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentReadModel,
    documentSummaries,
    expandNode,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  const moveDocument = useMoveDocumentAction({
    appData,
    documentReadModel,
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
    documentReadModel,
    documentSummaries,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const unlinkDocument = useUnlinkDocumentAction({
    appData,
    documentReadModel,
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
