import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback } from "react";
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

type LoadExplorerDocumentSummary = (
  localId: string,
) => Promise<DocumentSummary | null>;

async function resolveExplorerActionDocument(params: {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  noteId: string;
}): Promise<DocumentSummary | null> {
  return (
    getDocumentByLocalId(params.documentSummaries, params.noteId) ??
    (await params.loadDocumentSummary(params.noteId))
  );
}

function useMoveDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    expandNode,
    loadDocumentSummary,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (!canMutateSelectedDocument(appData)) {
        return null;
      }

      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        noteId,
      });
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
      loadDocumentSummary,
      mergeDocumentSummary,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useLinkDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (!canMutateSelectedDocument(appData)) {
        return null;
      }

      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        noteId,
      });
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
      loadDocumentSummary,
      mergeDocumentSummary,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useUnlinkDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  return useCallback(
    async (noteId: string, removedContainerId: string) => {
      if (!canMutateSelectedDocument(appData)) {
        return null;
      }

      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        noteId,
      });
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
      loadDocumentSummary,
      mergeDocumentSummary,
      onDocumentLinksChanged,
      setLinkedContainerIdsForDocument,
    ],
  );
}

function useActivateLinkedDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
}) {
  const {
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
  } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (appData.dbStatus !== "ready") {
        return null;
      }

      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        noteId,
      });
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
    [appData, documentSummaries, loadDocumentSummary, mergeDocumentSummary],
  );
}

export function useSelectedDocumentActions(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  onDocumentLinksChanged: () => void;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}) {
  const {
    appData,
    documentSummaries,
    expandNode,
    loadDocumentSummary,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  } = params;

  const moveDocument = useMoveDocumentAction({
    appData,
    documentSummaries,
    expandNode,
    loadDocumentSummary,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const activateLinkedDocument = useActivateLinkedDocumentAction({
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
  });
  const linkDocument = useLinkDocumentAction({
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
    onDocumentLinksChanged,
    setLinkedContainerIdsForDocument,
  });
  const unlinkDocument = useUnlinkDocumentAction({
    appData,
    documentSummaries,
    loadDocumentSummary,
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
