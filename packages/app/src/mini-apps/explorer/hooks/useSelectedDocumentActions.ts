import type { ContainerDocumentSummary } from "@tearleads/validators/response";
import { useCallback } from "react";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/containers";
import { primeDocumentStore } from "../../../data/documents/DocumentsProvider";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";
import {
  createExplorerDocumentsRuntime,
  type ExplorerDocumentsRuntimeAppData,
} from "../explorerRuntime";

type MergeDocumentSummary = (nextDocument: DocumentSummary) => void;
type SetLinkedContainerIdsForDocument = (
  documentId: string,
  linkedContainerIds: ReadonlyArray<string>,
) => void;
type ExplorerDocumentStore = ReturnType<typeof primeDocumentStore>;

function canMutateSelectedDocument(appData: ExplorerDocumentsRuntimeAppData) {
  return (
    appData.dbStatus === "ready" && appData.isAuthenticated && appData.online
  );
}

function getDocumentByLocalId(
  documentSummaries: ReadonlyArray<DocumentSummary>,
  noteId: string,
) {
  return documentSummaries.find((note) => note.id === noteId);
}

function getMovedDocumentContainerId(
  document: ContainerDocumentSummary,
  preferredContainerId: string,
): string | null {
  if (document.linkedContainerIds.includes(preferredContainerId)) {
    return preferredContainerId;
  }

  return document.linkedContainerIds[0] ?? null;
}

async function syncExplorerDocumentLinks(
  appData: ExplorerDocumentsRuntimeAppData,
  documentId: string,
  document: ContainerDocumentSummary,
) {
  await appData.cacheReferencedPrincipalPolicies(
    document.referencedPrincipals ?? [],
  );
  await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
    appData.execSql,
    documentId,
    document.linkedContainerIds,
  );
}

async function moveExplorerDocument(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, note, targetContainerId } = params;
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const linkedDocument = await appData.apiClient.linkDocumentToContainer(
    note.documentId,
    targetContainerId,
  );
  if (!linkedDocument) {
    appData.log(
      `Explorer: failed to link note ${note.id} to container ${targetContainerId}`,
    );
    return null;
  }
  await syncExplorerDocumentLinks(appData, note.documentId, linkedDocument);

  const unlinkedDocument = await appData.apiClient.unlinkDocumentFromContainer(
    note.documentId,
    note.containerId,
  );
  if (!unlinkedDocument) {
    appData.log(
      `Explorer: note ${note.id} was linked to ${targetContainerId} but failed to unlink from ${note.containerId}`,
    );
    return null;
  }
  await syncExplorerDocumentLinks(appData, note.documentId, unlinkedDocument);

  const nextContainerId = getMovedDocumentContainerId(
    unlinkedDocument,
    targetContainerId,
  );
  if (!nextContainerId) {
    return null;
  }

  return {
    currentAccessEpoch: unlinkedDocument.currentAccessEpoch,
    linkedContainerIds: unlinkedDocument.linkedContainerIds,
    nextContainerId,
  };
}

async function linkExplorerDocument(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, note, targetContainerId } = params;
  if (!note.documentId) {
    return null;
  }

  const linkedDocument = await appData.apiClient.linkDocumentToContainer(
    note.documentId,
    targetContainerId,
  );
  if (!linkedDocument) {
    appData.log(
      `Explorer: failed to link note ${note.id} to container ${targetContainerId}`,
    );
    return null;
  }

  await syncExplorerDocumentLinks(appData, note.documentId, linkedDocument);
  return linkedDocument;
}

async function unlinkExplorerDocument(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, note, targetContainerId } = params;
  if (!note.documentId) {
    return null;
  }

  const unlinkedDocument = await appData.apiClient.unlinkDocumentFromContainer(
    note.documentId,
    targetContainerId,
  );
  if (!unlinkedDocument) {
    appData.log(
      `Explorer: failed to unlink note ${note.id} from container ${targetContainerId}`,
    );
    return null;
  }

  await syncExplorerDocumentLinks(appData, note.documentId, unlinkedDocument);
  return unlinkedDocument;
}

async function primeExplorerDocumentStoreForStructuralMutation(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  mergeDocumentSummary: MergeDocumentSummary;
  note: DocumentSummary;
}) {
  const { appData, mergeDocumentSummary, note } = params;
  if (!note.containerId || !note.documentId) {
    return null;
  }

  const documentStore = primeDocumentStore(
    appData.domainScope,
    note.id,
    createExplorerDocumentsRuntime(appData, note.containerId),
    mergeDocumentSummary,
    note.documentId,
  );
  if (!(await documentStore.ensureInitialized())) {
    appData.log(`Explorer: note ${note.id} is not ready to mutate locally`);
    return null;
  }

  return documentStore;
}

async function relinkExplorerNoteLocally(params: {
  accessEpoch: number;
  appData: ExplorerDocumentsRuntimeAppData;
  currentDocumentStore: ExplorerDocumentStore;
  mergeDocumentSummary: MergeDocumentSummary;
  note: DocumentSummary;
  requestSync: boolean;
  targetContainerId: string;
}) {
  const {
    accessEpoch,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    requestSync,
    targetContainerId,
  } = params;
  if (!note.documentId) {
    return null;
  }

  const relinkedNote = await currentDocumentStore.relink({
    accessEpoch,
    containerId: targetContainerId,
    documentId: note.documentId,
    localId: note.id,
  });
  if (!relinkedNote) {
    appData.log(
      `Explorer: note ${note.id} could not be relinked after a structural mutation`,
    );
    return null;
  }

  mergeDocumentSummary(relinkedNote);
  currentDocumentStore.updateRuntime(
    createExplorerDocumentsRuntime(appData, targetContainerId),
  );
  if (requestSync) {
    currentDocumentStore.requestSync();
  }
  return relinkedNote;
}

async function relinkExplorerNoteAfterStructuralMutation(params: {
  accessEpoch: number;
  appData: ExplorerDocumentsRuntimeAppData;
  currentDocumentStore: ExplorerDocumentStore;
  mergeDocumentSummary: MergeDocumentSummary;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  return relinkExplorerNoteLocally({
    ...params,
    requestSync: true,
  });
}

async function moveExplorerNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
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
  if (
    !note.documentId ||
    !note.containerId ||
    note.containerId === targetContainerId
  ) {
    return null;
  }

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      appData,
      mergeDocumentSummary,
      note,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const movedDocument = await moveExplorerDocument({
    appData,
    note,
    targetContainerId,
  });
  if (!movedDocument) {
    return null;
  }
  const { currentAccessEpoch, linkedContainerIds, nextContainerId } =
    movedDocument;
  setLinkedContainerIdsForDocument(note.documentId, linkedContainerIds);

  const movedNote = await relinkExplorerNoteAfterStructuralMutation({
    accessEpoch: currentAccessEpoch,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    targetContainerId: nextContainerId,
  });
  if (!movedNote) {
    return null;
  }

  expandNode(nextContainerId);
  appData.log(`Explorer: moved note ${movedNote.id} to ${nextContainerId}`);
  return movedNote;
}

async function linkExplorerNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
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
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      appData,
      mergeDocumentSummary,
      note,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const linkedDocument = await linkExplorerDocument({
    appData,
    note,
    targetContainerId,
  });
  if (!linkedDocument) {
    return null;
  }
  setLinkedContainerIdsForDocument(
    note.documentId,
    linkedDocument.linkedContainerIds,
  );

  const linkedNote = await relinkExplorerNoteAfterStructuralMutation({
    accessEpoch: linkedDocument.currentAccessEpoch,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    targetContainerId: note.containerId,
  });
  if (!linkedNote) {
    return null;
  }

  appData.log(`Explorer: linked note ${linkedNote.id} to ${targetContainerId}`);
  return linkedNote;
}

async function unlinkExplorerLinkedNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
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
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      appData,
      mergeDocumentSummary,
      note,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const unlinkedDocument = await unlinkExplorerDocument({
    appData,
    note,
    targetContainerId: removedContainerId,
  });
  if (!unlinkedDocument) {
    return null;
  }
  setLinkedContainerIdsForDocument(
    note.documentId,
    unlinkedDocument.linkedContainerIds,
  );

  const nextContainerId = getMovedDocumentContainerId(
    unlinkedDocument,
    note.containerId,
  );
  if (!nextContainerId) {
    appData.log(
      `Explorer: note ${note.id} has no remaining linked containers after unlink`,
    );
    return null;
  }

  const unlinkedNote = await relinkExplorerNoteAfterStructuralMutation({
    accessEpoch: unlinkedDocument.currentAccessEpoch,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    targetContainerId: nextContainerId,
  });
  if (!unlinkedNote) {
    return null;
  }

  appData.log(
    `Explorer: unlinked note ${unlinkedNote.id} from ${removedContainerId}`,
  );
  return unlinkedNote;
}

async function activateExplorerLinkedNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  mergeDocumentSummary: MergeDocumentSummary;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, mergeDocumentSummary, note, targetContainerId } = params;
  if (
    !note.documentId ||
    !note.containerId ||
    note.containerId === targetContainerId
  ) {
    return null;
  }

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      appData,
      mergeDocumentSummary,
      note,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const relinkedNote = await relinkExplorerNoteLocally({
    accessEpoch: 1,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    requestSync: false,
    targetContainerId,
  });
  if (!relinkedNote) {
    return null;
  }

  appData.log(
    `Explorer: switched active note ${relinkedNote.id} to ${targetContainerId}`,
  );
  return relinkedNote;
}

function useMoveDocumentAction(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: MergeDocumentSummary;
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

      const movedNote = await moveExplorerNote({
        appData,
        expandNode,
        mergeDocumentSummary,
        note: existingDocument,
        setLinkedContainerIdsForDocument,
        targetContainerId,
      });
      if (movedNote) {
        onDocumentLinksChanged();
      }

      return movedNote;
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
  mergeDocumentSummary: MergeDocumentSummary;
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
  mergeDocumentSummary: MergeDocumentSummary;
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
  mergeDocumentSummary: MergeDocumentSummary;
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
  mergeDocumentSummary: MergeDocumentSummary;
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
