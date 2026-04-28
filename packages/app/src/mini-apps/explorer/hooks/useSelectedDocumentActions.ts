import { useCallback } from "react";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/containers";
import { primeDocumentStore } from "../../../data/documents/DocumentsProvider";
import type { DocumentSummary } from "../../../data/documents/documentsPersistence";
import { createDocumentV2SignerDeviceId } from "../../../data/documents/documentV2Constants";
import {
  type RelinkRemoteDocumentV2Result,
  relinkRemoteDocumentV2,
} from "../../../data/documents/documentV2Runtime";
import { getDocumentByLocalId } from "../documentSummaries";
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

function getMovedDocumentContainerId(
  linkedContainerIds: ReadonlyArray<string>,
  preferredContainerId: string,
): string | null {
  if (linkedContainerIds.includes(preferredContainerId)) {
    return preferredContainerId;
  }

  return linkedContainerIds[0] ?? null;
}

function resolveExplorerDocumentV2MutationContext(
  appData: ExplorerDocumentsRuntimeAppData,
): {
  author: Parameters<typeof relinkRemoteDocumentV2>[0]["author"];
  targetSecretKey: Uint8Array;
} | null {
  if (
    !appData.encapsulationKeyPair ||
    !appData.organizationId ||
    !appData.signingFingerprint ||
    !appData.signingKeyPair ||
    !appData.userId
  ) {
    appData.log(
      "Explorer: V2 document mutation skipped because the local key context is unavailable",
    );
    return null;
  }

  return {
    author: {
      organizationId: appData.organizationId,
      signerDeviceId: createDocumentV2SignerDeviceId(
        appData.signingFingerprint,
      ),
      signerKeyFingerprint: appData.signingFingerprint,
      signerPrivateKey: appData.signingKeyPair.signingPrivateKey,
      signerUserId: appData.userId,
    },
    targetSecretKey: appData.encapsulationKeyPair.secretKey,
  };
}

async function syncExplorerDocumentLinks(
  appData: ExplorerDocumentsRuntimeAppData,
  documentId: string,
  linkedContainerIds: ReadonlyArray<string>,
) {
  await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
    appData.execSql,
    documentId,
    linkedContainerIds,
  );
}

async function mutateExplorerDocumentLinkSet(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentId: string;
  noteId: string;
  operation: "link" | "unlink";
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentV2Result | null> {
  const { appData, documentId, noteId, operation, targetContainerId } = params;
  const mutationContext = resolveExplorerDocumentV2MutationContext(appData);
  if (!mutationContext) {
    return null;
  }

  let result: RelinkRemoteDocumentV2Result | null;
  try {
    result = await relinkRemoteDocumentV2({
      apiClient: appData.apiClient,
      author: mutationContext.author,
      documentId,
      execSql: appData.execSql,
      operation,
      targetContainerId,
      targetSecretKey: mutationContext.targetSecretKey,
    });
  } catch (error) {
    appData.log(
      `Explorer: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  if (!result) {
    appData.log(
      `Explorer: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}`,
    );
    return null;
  }

  await syncExplorerDocumentLinks(
    appData,
    documentId,
    result.linkedContainerIds,
  );
  return result;
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

  const linkedDocument = await mutateExplorerDocumentLinkSet({
    appData,
    documentId: note.documentId,
    noteId: note.id,
    operation: "link",
    targetContainerId,
  });
  if (!linkedDocument) {
    return null;
  }

  const unlinkedDocument = await mutateExplorerDocumentLinkSet({
    appData,
    documentId: note.documentId,
    noteId: note.id,
    operation: "unlink",
    targetContainerId: note.containerId,
  });
  if (!unlinkedDocument) {
    appData.log(
      `Explorer: note ${note.id} was linked to ${targetContainerId} but failed to unlink from ${note.containerId}`,
    );
    return null;
  }

  const nextContainerId = getMovedDocumentContainerId(
    unlinkedDocument.linkedContainerIds,
    targetContainerId,
  );
  if (!nextContainerId) {
    return null;
  }

  return {
    accessEpoch: unlinkedDocument.plan.state.epoch,
    accessStateHash: unlinkedDocument.response.accessManifest.manifestHash,
    linkedContainerIds: unlinkedDocument.linkedContainerIds,
    nextContainerId,
    queueBaselineAfterRelink:
      linkedDocument.contentKeyRotated || unlinkedDocument.contentKeyRotated,
    v2State: unlinkedDocument.persistedState,
  };
}

async function linkExplorerDocument(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, note, targetContainerId } = params;
  const documentId = note.documentId;
  if (!documentId) {
    return null;
  }

  return mutateExplorerDocumentLinkSet({
    appData,
    documentId,
    noteId: note.id,
    operation: "link",
    targetContainerId,
  });
}

async function unlinkExplorerDocument(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  note: DocumentSummary;
  targetContainerId: string;
}) {
  const { appData, note, targetContainerId } = params;
  const documentId = note.documentId;
  if (!documentId) {
    return null;
  }

  return mutateExplorerDocumentLinkSet({
    appData,
    documentId,
    noteId: note.id,
    operation: "unlink",
    targetContainerId,
  });
}

async function primeExplorerDocumentStoreForStructuralMutation(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  note: DocumentSummary;
}) {
  const { appData, note } = params;
  if (!note.containerId || !note.documentId) {
    return null;
  }

  const documentStore = primeDocumentStore(
    appData.domainScope,
    note.id,
    createExplorerDocumentsRuntime(appData, note.containerId),
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
  accessStateHash?: string | null;
  appData: ExplorerDocumentsRuntimeAppData;
  currentDocumentStore: ExplorerDocumentStore;
  mergeDocumentSummary: MergeDocumentSummary;
  note: DocumentSummary;
  queueBaselineAfterRelink?: boolean;
  requestSync: boolean;
  targetContainerId: string;
  v2State?: RelinkRemoteDocumentV2Result["persistedState"] | undefined;
}) {
  const {
    accessEpoch,
    accessStateHash,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    queueBaselineAfterRelink,
    requestSync,
    targetContainerId,
    v2State,
  } = params;
  const documentId = note.documentId;
  if (!documentId) {
    return null;
  }

  const relinkedNote = await currentDocumentStore.relink({
    accessEpoch,
    ...(accessStateHash === undefined ? {} : { accessStateHash }),
    containerId: targetContainerId,
    ...v2State,
    documentId,
    localId: note.id,
    queueBaselineAfterRelink,
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
  accessStateHash?: string | null;
  appData: ExplorerDocumentsRuntimeAppData;
  currentDocumentStore: ExplorerDocumentStore;
  mergeDocumentSummary: MergeDocumentSummary;
  note: DocumentSummary;
  queueBaselineAfterRelink?: boolean;
  targetContainerId: string;
  v2State?: RelinkRemoteDocumentV2Result["persistedState"] | undefined;
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
  const { accessEpoch, linkedContainerIds, nextContainerId } = movedDocument;
  setLinkedContainerIdsForDocument(note.documentId, linkedContainerIds);

  const movedNote = await relinkExplorerNoteAfterStructuralMutation({
    accessEpoch,
    accessStateHash: movedDocument.accessStateHash,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    queueBaselineAfterRelink: movedDocument.queueBaselineAfterRelink,
    targetContainerId: nextContainerId,
    v2State: movedDocument.v2State,
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
    accessEpoch: linkedDocument.plan.state.epoch,
    accessStateHash: linkedDocument.response.accessManifest.manifestHash,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    queueBaselineAfterRelink: linkedDocument.contentKeyRotated,
    targetContainerId: note.containerId,
    v2State: linkedDocument.persistedState,
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
    unlinkedDocument.linkedContainerIds,
    note.containerId,
  );
  if (!nextContainerId) {
    appData.log(
      `Explorer: note ${note.id} has no remaining linked containers after unlink`,
    );
    return null;
  }

  const unlinkedNote = await relinkExplorerNoteAfterStructuralMutation({
    accessEpoch: unlinkedDocument.plan.state.epoch,
    accessStateHash: unlinkedDocument.response.accessManifest.manifestHash,
    appData,
    currentDocumentStore,
    mergeDocumentSummary,
    note,
    queueBaselineAfterRelink: unlinkedDocument.contentKeyRotated,
    targetContainerId: nextContainerId,
    v2State: unlinkedDocument.persistedState,
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
