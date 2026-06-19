import type {
  ContainerDocumentLinks,
  DocumentSummary,
  MergeDocumentSummary,
  SetLinkedContainerIdsForDocument,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  activateExplorerLinkedNote,
  canMutateSelectedDocument,
  canMutateUnsyncedSelectedDocument,
  linkExplorerNote,
  moveExplorerNote,
  purgeExplorerNote,
  unlinkExplorerLinkedNote,
} from "../../../stores/explorer/documentLinks";
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
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
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
      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        noteId,
      });
      if (!existingDocument) {
        return null;
      }
      const canMoveDocument =
        existingDocument.documentId === null
          ? canMutateUnsyncedSelectedDocument(appData)
          : canMutateSelectedDocument(appData);
      if (!canMoveDocument) {
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

function usePurgeDocumentAction(params: {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
}) {
  const { appData, documentSummaries, loadDocumentSummary } = params;

  return useCallback(
    async (noteId: string) => {
      const existingDocument = await resolveExplorerActionDocument({
        documentSummaries,
        loadDocumentSummary,
        noteId,
      });
      if (!existingDocument) {
        return null;
      }

      // A never-synced document purges locally; a synced one needs an
      // authenticated, online session for the server delete — mirror the move
      // action's branching so the action matches the menu-enable gate.
      const canPurgeDocument =
        existingDocument.documentId === null
          ? canMutateUnsyncedSelectedDocument(appData)
          : canMutateSelectedDocument(appData);
      if (!canPurgeDocument) {
        return null;
      }

      return purgeExplorerNote({ appData, note: existingDocument });
    },
    [appData, documentSummaries, loadDocumentSummary],
  );
}

function useLinkDocumentAction(params: {
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
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
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
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
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
}) {
  const {
    appData,
    documentSummaries,
    loadDocumentSummary,
    mergeDocumentSummary,
  } = params;

  return useCallback(
    async (noteId: string, targetContainerId: string) => {
      if (appData.infra.dbStatus !== "ready") {
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
  appData: ContainerDocumentLinks;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  loadDocumentSummary: LoadExplorerDocumentSummary;
  mergeDocumentSummary: MergeDocumentSummary;
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
  const purgeDocument = usePurgeDocumentAction({
    appData,
    documentSummaries,
    loadDocumentSummary,
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
    purgeDocument,
    unlinkDocument,
  };
}
