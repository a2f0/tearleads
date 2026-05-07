import type { DocumentSummary } from "../../data/documents/shared/documentSummary";
import {
  type ExplorerRemoteDocumentPersistedState,
  linkRemoteExplorerDocument,
  moveRemoteExplorerDocument,
  resolveActiveExplorerDocumentContainerId,
  unlinkRemoteExplorerDocument,
} from "../../workflows/explorer";
import { primeDocumentStore } from "../documents/DocumentsProvider";
import {
  createExplorerDocumentsRuntime,
  type ExplorerDocumentsRuntimeAppData,
} from "./documentRuntime";

export type MergeExplorerDocumentSummary = (
  nextDocument: DocumentSummary,
) => void;
export type SetLinkedContainerIdsForDocument = (
  documentId: string,
  linkedContainerIds: ReadonlyArray<string>,
) => void;

type ExplorerDocumentStore = ReturnType<typeof primeDocumentStore>;

export function canMutateSelectedDocument(
  appData: ExplorerDocumentsRuntimeAppData,
) {
  return (
    appData.dbStatus === "ready" && appData.isAuthenticated && appData.online
  );
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
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  note: DocumentSummary;
  queueBaselineAfterRelink?: boolean;
  requestSync: boolean;
  targetContainerId: string;
  remoteState?: ExplorerRemoteDocumentPersistedState | undefined;
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
    remoteState,
  } = params;
  const documentId = note.documentId;
  if (!documentId) {
    return null;
  }

  const relinkedNote = await currentDocumentStore.relink({
    accessEpoch,
    ...(accessStateHash === undefined ? {} : { accessStateHash }),
    containerId: targetContainerId,
    ...remoteState,
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
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  note: DocumentSummary;
  queueBaselineAfterRelink?: boolean;
  targetContainerId: string;
  remoteState?: ExplorerRemoteDocumentPersistedState | undefined;
}) {
  return relinkExplorerNoteLocally({
    ...params,
    requestSync: true,
  });
}

export async function moveExplorerNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  expandNode: (nodeId: string) => void;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
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
    return { linksChanged: false, note: null };
  }

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      appData,
      note,
    });
  if (!currentDocumentStore) {
    return { linksChanged: false, note: null };
  }

  const movedDocument = await moveRemoteExplorerDocument({
    currentContainerId: note.containerId,
    documentId: note.documentId,
    noteId: note.id,
    resolveProjectionUserKey: appData.resolveProjectionUserKey,
    runtime: appData,
    targetContainerId,
  });
  if (!movedDocument) {
    return { linksChanged: false, note: null };
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
    remoteState: movedDocument.remoteState,
  });
  if (!movedNote) {
    return { linksChanged: true, note: null };
  }

  expandNode(nextContainerId);
  if (movedDocument.status === "partial") {
    appData.log(
      `Explorer: partially moved note ${movedNote.id}; linked to ${nextContainerId} but still linked to ${note.containerId}`,
    );
  } else {
    appData.log(`Explorer: moved note ${movedNote.id} to ${nextContainerId}`);
  }
  return { linksChanged: true, note: movedNote };
}

export async function linkExplorerNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
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

  const linkedDocument = await linkRemoteExplorerDocument({
    documentId: note.documentId,
    noteId: note.id,
    resolveProjectionUserKey: appData.resolveProjectionUserKey,
    runtime: appData,
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
    remoteState: linkedDocument.persistedState,
  });
  if (!linkedNote) {
    return null;
  }

  appData.log(`Explorer: linked note ${linkedNote.id} to ${targetContainerId}`);
  return linkedNote;
}

export async function unlinkExplorerLinkedNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
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

  const unlinkedDocument = await unlinkRemoteExplorerDocument({
    documentId: note.documentId,
    noteId: note.id,
    resolveProjectionUserKey: appData.resolveProjectionUserKey,
    runtime: appData,
    targetContainerId: removedContainerId,
  });
  if (!unlinkedDocument) {
    return null;
  }
  setLinkedContainerIdsForDocument(
    note.documentId,
    unlinkedDocument.linkedContainerIds,
  );

  const nextContainerId = resolveActiveExplorerDocumentContainerId(
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
    remoteState: unlinkedDocument.persistedState,
  });
  if (!unlinkedNote) {
    return null;
  }

  appData.log(
    `Explorer: unlinked note ${unlinkedNote.id} from ${removedContainerId}`,
  );
  return unlinkedNote;
}

export async function activateExplorerLinkedNote(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
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
