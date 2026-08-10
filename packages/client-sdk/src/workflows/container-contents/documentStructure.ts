import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../data/documents/documentConstants";
import type { DocumentSummary } from "../../data/documents/documentSummary";
import {
  linkRemoteContainerDocument,
  resolveActiveDocumentContainerId,
  unlinkRemoteContainerDocument,
} from "./documentLinks";
import { relinkContainerDocumentLocally } from "./documentLocalRelink";
import { moveRemoteDocumentLinkLocally } from "./documentMoveIntent";
import type {
  DocumentStructuralMutationHost,
  DocumentStructuralMutationRuntime,
  SetLinkedContainerIdsForDocument,
} from "./documentStructureTypes";

export type {
  DocumentStructuralMutationHost,
  DocumentStructuralMutationRelinkInput,
  DocumentStructuralMutationRuntime,
  MergeDocumentSummary,
  SetLinkedContainerIdsForDocument,
} from "./documentStructureTypes";

interface DocumentStructuralMutationInput<TRuntime> {
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  requireDocumentId: boolean;
  runtime: DocumentStructuralMutationRuntime;
}

export function canMutateDocumentLink(runtime: {
  readonly auth: Pick<
    DocumentStructuralMutationRuntime["auth"],
    "isAuthenticated"
  >;
  readonly infra: Pick<DocumentStructuralMutationRuntime["infra"], "dbStatus">;
  readonly state: Pick<DocumentStructuralMutationRuntime["state"], "online">;
}): boolean {
  return (
    runtime.infra.dbStatus === "ready" &&
    runtime.auth.isAuthenticated &&
    runtime.state.online
  );
}

export function canMutateLocalDocumentLink(runtime: {
  readonly infra: Pick<DocumentStructuralMutationRuntime["infra"], "dbStatus">;
}): boolean {
  return runtime.infra.dbStatus === "ready";
}

async function openDocumentStoreForStructuralMutation<TRuntime>({
  host,
  note,
  requireDocumentId,
  runtime,
}: DocumentStructuralMutationInput<TRuntime>) {
  if (requireDocumentId && !note.documentId) {
    return null;
  }

  const documentStore = host.openDocumentStore({
    containerId: note.containerId,
    documentId: note.documentId,
    localId: note.id,
  });
  if (!(await documentStore.ensureInitialized())) {
    runtime.util.log(
      `Container contents: note ${note.id} is not ready to mutate locally`,
    );
    return null;
  }

  return documentStore;
}

function relinkDocumentAfterStructuralMutation<TRuntime>(
  params: Omit<
    Parameters<typeof relinkContainerDocumentLocally<TRuntime>>[0],
    "requestSync"
  >,
) {
  return relinkContainerDocumentLocally({
    ...params,
    requestSync: true,
  });
}

export async function moveLocalDocumentLink<TRuntime>(params: {
  expandNode: (nodeId: string) => void;
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  runtime: DocumentStructuralMutationRuntime;
  targetContainerId: string;
}): Promise<DocumentSummary | null> {
  const { expandNode, host, note, runtime, targetContainerId } = params;
  if (note.containerId === targetContainerId) {
    return null;
  }

  const currentDocumentStore = await openDocumentStoreForStructuralMutation({
    host,
    note,
    requireDocumentId: false,
    runtime,
  });
  if (!currentDocumentStore) {
    return null;
  }

  const movedNote = await relinkContainerDocumentLocally({
    accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
    currentDocumentStore,
    host,
    note,
    requestSync: true,
    runtime,
    targetContainerId,
  });
  if (!movedNote) {
    return null;
  }

  expandNode(targetContainerId);
  runtime.util.log(
    `Container contents: moved local note ${movedNote.id} to ${targetContainerId}`,
  );
  return movedNote;
}

export async function moveDocumentLink<TRuntime>(params: {
  expandNode: (nodeId: string) => void;
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  replaceLinkedContainers?: boolean | undefined;
  runtime: DocumentStructuralMutationRuntime;
  scheduleSync?: (() => void) | undefined;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  targetContainerId: string;
}): Promise<{ linksChanged: boolean; note: DocumentSummary | null }> {
  const {
    expandNode,
    host,
    note,
    replaceLinkedContainers,
    runtime,
    scheduleSync,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  } = params;
  if (note.containerId === targetContainerId) {
    return { linksChanged: false, note: null };
  }
  if (!note.documentId) {
    const movedNote = await moveLocalDocumentLink({
      expandNode,
      host,
      note,
      runtime,
      targetContainerId,
    });
    return {
      linksChanged: movedNote !== null,
      note: movedNote,
    };
  }

  const currentDocumentStore = await openDocumentStoreForStructuralMutation({
    host,
    note,
    requireDocumentId: true,
    runtime,
  });
  if (!currentDocumentStore) {
    return { linksChanged: false, note: null };
  }

  const queuedMove = await moveRemoteDocumentLinkLocally({
    currentDocumentStore,
    expandNode,
    host,
    note: {
      ...note,
      documentId: note.documentId,
    },
    replaceLinkedContainers,
    runtime,
    scheduleSync,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  });
  return queuedMove;
}

export async function addDocumentLink<TRuntime>(params: {
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  runtime: DocumentStructuralMutationRuntime;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  targetContainerId: string;
}): Promise<DocumentSummary | null> {
  const {
    host,
    note,
    runtime,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  } = params;
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const currentDocumentStore = await openDocumentStoreForStructuralMutation({
    host,
    note,
    requireDocumentId: true,
    runtime,
  });
  if (!currentDocumentStore) {
    return null;
  }

  const linkedDocument = await linkRemoteContainerDocument({
    documentId: note.documentId,
    noteId: note.id,
    resolveProjectionUserKey: runtime.resolveProjectionUserKey,
    runtime,
    targetContainerId,
  });
  if (!linkedDocument) {
    return null;
  }
  setLinkedContainerIdsForDocument(
    note.documentId,
    linkedDocument.linkedContainerIds,
  );

  const linkedNote = await relinkDocumentAfterStructuralMutation({
    accessEpoch: linkedDocument.plan.state.epoch,
    accessStateHash: linkedDocument.response.accessManifest.manifestHash,
    currentDocumentStore,
    host,
    note,
    runtime,
    targetContainerId: note.containerId,
    remoteState: linkedDocument.persistedState,
  });
  if (!linkedNote) {
    return null;
  }

  runtime.util.log(
    `Container contents: linked note ${linkedNote.id} to ${targetContainerId}`,
  );
  return linkedNote;
}

export async function removeDocumentLink<TRuntime>(params: {
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  removedContainerId: string;
  runtime: DocumentStructuralMutationRuntime;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
}): Promise<DocumentSummary | null> {
  const {
    host,
    note,
    removedContainerId,
    runtime,
    setLinkedContainerIdsForDocument,
  } = params;
  if (!note.documentId || !note.containerId) {
    return null;
  }

  const currentDocumentStore = await openDocumentStoreForStructuralMutation({
    host,
    note,
    requireDocumentId: true,
    runtime,
  });
  if (!currentDocumentStore) {
    return null;
  }

  // Unlink rotates the document content key. Prove locally that a mergeable
  // full-history checkpoint can be emitted before publishing the new epoch,
  // so a failed preflight leaves the remote state untouched.
  const rotationSnapshot =
    await currentDocumentStore.assertCanRotateContentKey();

  const unlinkedDocument = await unlinkRemoteContainerDocument({
    documentId: note.documentId,
    noteId: note.id,
    resolveProjectionUserKey: runtime.resolveProjectionUserKey,
    rotationSnapshot,
    runtime,
    targetContainerId: removedContainerId,
  });
  if (!unlinkedDocument) {
    return null;
  }
  setLinkedContainerIdsForDocument(
    note.documentId,
    unlinkedDocument.linkedContainerIds,
  );

  const nextContainerId = resolveActiveDocumentContainerId(
    unlinkedDocument.linkedContainerIds,
    note.containerId,
  );
  if (!nextContainerId) {
    runtime.util.log(
      `Container contents: note ${note.id} has no remaining linked containers after unlink`,
    );
    return null;
  }

  const unlinkedNote = await relinkDocumentAfterStructuralMutation({
    accessEpoch: unlinkedDocument.plan.state.epoch,
    accessStateHash: unlinkedDocument.response.accessManifest.manifestHash,
    currentDocumentStore,
    host,
    note,
    runtime,
    targetContainerId: nextContainerId,
    remoteState: unlinkedDocument.persistedState,
  });
  if (!unlinkedNote) {
    return null;
  }

  runtime.util.log(
    `Container contents: unlinked note ${unlinkedNote.id} from ${removedContainerId}`,
  );
  return unlinkedNote;
}

export async function activateDocumentLink<TRuntime>(params: {
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  runtime: DocumentStructuralMutationRuntime;
  targetContainerId: string;
}): Promise<DocumentSummary | null> {
  const { host, note, runtime, targetContainerId } = params;
  if (
    !note.documentId ||
    !note.containerId ||
    note.containerId === targetContainerId
  ) {
    return null;
  }

  const currentDocumentStore = await openDocumentStoreForStructuralMutation({
    host,
    note,
    requireDocumentId: true,
    runtime,
  });
  if (!currentDocumentStore) {
    return null;
  }

  const relinkedNote = await relinkContainerDocumentLocally({
    accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
    currentDocumentStore,
    host,
    note,
    requestSync: false,
    runtime,
    targetContainerId,
  });
  if (!relinkedNote) {
    return null;
  }

  runtime.util.log(
    `Container contents: switched active note ${relinkedNote.id} to ${targetContainerId}`,
  );
  return relinkedNote;
}
