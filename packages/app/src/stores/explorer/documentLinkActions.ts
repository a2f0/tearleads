import { createDocumentSignerDeviceId } from "../../data/documents/documentConstants";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { DocumentSummary } from "../../data/persistence/documents/documentsPersistence";
import {
  type RelinkRemoteDocumentResult,
  relinkRemoteDocument,
} from "../../workflows/documents";
import { primeDocumentStore } from "../documents/DocumentsProvider";
import { replaceExplorerDocumentLinks } from "./documentReadModel";
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
type MoveExplorerDocumentStatus = "complete" | "partial";

export function canMutateSelectedDocument(
  appData: ExplorerDocumentsRuntimeAppData,
) {
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

function resolveExplorerDocumentMutationContext(
  appData: ExplorerDocumentsRuntimeAppData,
): {
  author: Parameters<typeof relinkRemoteDocument>[0]["author"];
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
      "Explorer: document mutation skipped because the local key context is unavailable",
    );
    return null;
  }

  return {
    author: {
      organizationId: appData.organizationId,
      signerDeviceId: createDocumentSignerDeviceId(appData.signingFingerprint),
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
  await replaceExplorerDocumentLinks(
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
}): Promise<RelinkRemoteDocumentResult | null> {
  const { appData, documentId, noteId, operation, targetContainerId } = params;
  const mutationContext = resolveExplorerDocumentMutationContext(appData);
  if (!mutationContext) {
    return null;
  }

  let result: RelinkRemoteDocumentResult | null;
  try {
    result = await relinkRemoteDocument({
      apiClient: appData.apiClient,
      author: mutationContext.author,
      documentId,
      execSql: appData.execSql,
      operation,
      resolveProjectionUserKey: createProjectionUserKeyResolver(
        appData,
        "Explorer",
      ),
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

function explorerDocumentMoveResult(input: {
  document: RelinkRemoteDocumentResult;
  nextContainerId: string;
  queueBaselineAfterRelink?: boolean;
  status: MoveExplorerDocumentStatus;
}) {
  return {
    accessEpoch: input.document.plan.state.epoch,
    accessStateHash: input.document.response.accessManifest.manifestHash,
    linkedContainerIds: input.document.linkedContainerIds,
    nextContainerId: input.nextContainerId,
    queueBaselineAfterRelink:
      input.queueBaselineAfterRelink ?? input.document.contentKeyRotated,
    status: input.status,
    remoteState: input.document.persistedState,
  };
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
    return explorerDocumentMoveResult({
      document: linkedDocument,
      nextContainerId: targetContainerId,
      status: "partial",
    });
  }

  const nextContainerId = getMovedDocumentContainerId(
    unlinkedDocument.linkedContainerIds,
    targetContainerId,
  );
  if (!nextContainerId) {
    return null;
  }

  return explorerDocumentMoveResult({
    document: unlinkedDocument,
    nextContainerId,
    queueBaselineAfterRelink:
      linkedDocument.contentKeyRotated || unlinkedDocument.contentKeyRotated,
    status: "complete",
  });
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
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  note: DocumentSummary;
  queueBaselineAfterRelink?: boolean;
  requestSync: boolean;
  targetContainerId: string;
  remoteState?: RelinkRemoteDocumentResult["persistedState"] | undefined;
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
  remoteState?: RelinkRemoteDocumentResult["persistedState"] | undefined;
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

  const movedDocument = await moveExplorerDocument({
    appData,
    note,
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
