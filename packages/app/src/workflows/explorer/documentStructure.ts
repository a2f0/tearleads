import type { DocumentSummary } from "../../data/documents/shared/documentSummary";
import type { RelinkPersistedDocumentInput } from "../documents";
import {
  type ExplorerRemoteDocumentPersistedState,
  linkRemoteExplorerDocument,
  moveRemoteExplorerDocument,
  resolveActiveExplorerDocumentContainerId,
  unlinkRemoteExplorerDocument,
} from "./documentLinks";

type ExplorerDocumentStructuralMutationResolver = Parameters<
  typeof linkRemoteExplorerDocument
>[0]["resolveProjectionUserKey"];
type ExplorerDocumentStructuralMutationRemoteRuntime = Parameters<
  typeof linkRemoteExplorerDocument
>[0]["runtime"];

export type MergeExplorerDocumentSummary = (
  nextDocument: DocumentSummary,
) => void;
export type SetLinkedContainerIdsForDocument = (
  documentId: string,
  linkedContainerIds: ReadonlyArray<string>,
) => void;

export type ExplorerDocumentStructuralMutationRuntime =
  ExplorerDocumentStructuralMutationRemoteRuntime & {
    dbStatus: string;
    isAuthenticated: boolean;
    online: boolean;
    resolveProjectionUserKey: ExplorerDocumentStructuralMutationResolver;
  };

export interface ExplorerDocumentStructuralMutationRelinkInput
  extends RelinkPersistedDocumentInput {
  contentKeyBundle?: string | null | undefined;
  documentKekTargets?: string | null | undefined;
  documentManifestBundle?: string | null | undefined;
  queueBaselineAfterRelink?: boolean | undefined;
}

export interface ExplorerDocumentStructuralMutationLocalStore<TRuntime> {
  ensureInitialized: () => Promise<boolean>;
  relink: (
    input: ExplorerDocumentStructuralMutationRelinkInput,
  ) => Promise<DocumentSummary | null>;
  requestSync: () => void;
  updateRuntime: (runtime: TRuntime) => void;
}

export interface ExplorerDocumentStructuralMutationHost<TRuntime> {
  createDocumentRuntime: (containerId: string) => TRuntime;
  mergeDocumentSummary: MergeExplorerDocumentSummary;
  primeDocumentStore: (input: {
    containerId: string;
    documentId: string;
    localId: string;
  }) => ExplorerDocumentStructuralMutationLocalStore<TRuntime>;
}

interface ExplorerDocumentStructuralMutationInput<TRuntime> {
  host: ExplorerDocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  runtime: ExplorerDocumentStructuralMutationRuntime;
}

export function canMutateExplorerDocumentLink(
  runtime: Pick<
    ExplorerDocumentStructuralMutationRuntime,
    "dbStatus" | "isAuthenticated" | "online"
  >,
): boolean {
  return (
    runtime.dbStatus === "ready" && runtime.isAuthenticated && runtime.online
  );
}

async function primeExplorerDocumentStoreForStructuralMutation<TRuntime>({
  host,
  note,
  runtime,
}: ExplorerDocumentStructuralMutationInput<TRuntime>) {
  if (!note.containerId || !note.documentId) {
    return null;
  }

  const documentStore = host.primeDocumentStore({
    containerId: note.containerId,
    documentId: note.documentId,
    localId: note.id,
  });
  if (!(await documentStore.ensureInitialized())) {
    runtime.log(`Explorer: note ${note.id} is not ready to mutate locally`);
    return null;
  }

  return documentStore;
}

async function relinkExplorerDocumentLocally<TRuntime>(params: {
  accessEpoch: number;
  accessStateHash?: string | null | undefined;
  currentDocumentStore: ExplorerDocumentStructuralMutationLocalStore<TRuntime>;
  host: ExplorerDocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  queueBaselineAfterRelink?: boolean | undefined;
  remoteState?: ExplorerRemoteDocumentPersistedState | undefined;
  requestSync: boolean;
  runtime: ExplorerDocumentStructuralMutationRuntime;
  targetContainerId: string;
}) {
  const {
    accessEpoch,
    accessStateHash,
    currentDocumentStore,
    host,
    note,
    queueBaselineAfterRelink,
    remoteState,
    requestSync,
    runtime,
    targetContainerId,
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
    runtime.log(
      `Explorer: note ${note.id} could not be relinked after a structural mutation`,
    );
    return null;
  }

  host.mergeDocumentSummary(relinkedNote);
  currentDocumentStore.updateRuntime(
    host.createDocumentRuntime(targetContainerId),
  );
  if (requestSync) {
    currentDocumentStore.requestSync();
  }
  return relinkedNote;
}

function relinkExplorerDocumentAfterStructuralMutation<TRuntime>(
  params: Omit<
    Parameters<typeof relinkExplorerDocumentLocally<TRuntime>>[0],
    "requestSync"
  >,
) {
  return relinkExplorerDocumentLocally({
    ...params,
    requestSync: true,
  });
}

export async function moveExplorerDocumentLinkState<TRuntime>(params: {
  expandNode: (nodeId: string) => void;
  host: ExplorerDocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  runtime: ExplorerDocumentStructuralMutationRuntime;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  targetContainerId: string;
}): Promise<{ linksChanged: boolean; note: DocumentSummary | null }> {
  const {
    expandNode,
    host,
    note,
    runtime,
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
      host,
      note,
      runtime,
    });
  if (!currentDocumentStore) {
    return { linksChanged: false, note: null };
  }

  const movedDocument = await moveRemoteExplorerDocument({
    currentContainerId: note.containerId,
    documentId: note.documentId,
    noteId: note.id,
    resolveProjectionUserKey: runtime.resolveProjectionUserKey,
    runtime,
    targetContainerId,
  });
  if (!movedDocument) {
    return { linksChanged: false, note: null };
  }
  const { accessEpoch, linkedContainerIds, nextContainerId } = movedDocument;
  setLinkedContainerIdsForDocument(note.documentId, linkedContainerIds);

  const movedNote = await relinkExplorerDocumentAfterStructuralMutation({
    accessEpoch,
    accessStateHash: movedDocument.accessStateHash,
    currentDocumentStore,
    host,
    note,
    queueBaselineAfterRelink: movedDocument.queueBaselineAfterRelink,
    runtime,
    targetContainerId: nextContainerId,
    remoteState: movedDocument.remoteState,
  });
  if (!movedNote) {
    return { linksChanged: true, note: null };
  }

  expandNode(nextContainerId);
  if (movedDocument.status === "partial") {
    runtime.log(
      `Explorer: partially moved note ${movedNote.id}; linked to ${nextContainerId} but still linked to ${note.containerId}`,
    );
  } else {
    runtime.log(`Explorer: moved note ${movedNote.id} to ${nextContainerId}`);
  }
  return { linksChanged: true, note: movedNote };
}

export async function linkExplorerDocumentLinkState<TRuntime>(params: {
  host: ExplorerDocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  runtime: ExplorerDocumentStructuralMutationRuntime;
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

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      host,
      note,
      runtime,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const linkedDocument = await linkRemoteExplorerDocument({
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

  const linkedNote = await relinkExplorerDocumentAfterStructuralMutation({
    accessEpoch: linkedDocument.plan.state.epoch,
    accessStateHash: linkedDocument.response.accessManifest.manifestHash,
    currentDocumentStore,
    host,
    note,
    queueBaselineAfterRelink: linkedDocument.contentKeyRotated,
    runtime,
    targetContainerId: note.containerId,
    remoteState: linkedDocument.persistedState,
  });
  if (!linkedNote) {
    return null;
  }

  runtime.log(`Explorer: linked note ${linkedNote.id} to ${targetContainerId}`);
  return linkedNote;
}

export async function unlinkExplorerDocumentLinkState<TRuntime>(params: {
  host: ExplorerDocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  removedContainerId: string;
  runtime: ExplorerDocumentStructuralMutationRuntime;
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

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      host,
      note,
      runtime,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const unlinkedDocument = await unlinkRemoteExplorerDocument({
    documentId: note.documentId,
    noteId: note.id,
    resolveProjectionUserKey: runtime.resolveProjectionUserKey,
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

  const nextContainerId = resolveActiveExplorerDocumentContainerId(
    unlinkedDocument.linkedContainerIds,
    note.containerId,
  );
  if (!nextContainerId) {
    runtime.log(
      `Explorer: note ${note.id} has no remaining linked containers after unlink`,
    );
    return null;
  }

  const unlinkedNote = await relinkExplorerDocumentAfterStructuralMutation({
    accessEpoch: unlinkedDocument.plan.state.epoch,
    accessStateHash: unlinkedDocument.response.accessManifest.manifestHash,
    currentDocumentStore,
    host,
    note,
    queueBaselineAfterRelink: unlinkedDocument.contentKeyRotated,
    runtime,
    targetContainerId: nextContainerId,
    remoteState: unlinkedDocument.persistedState,
  });
  if (!unlinkedNote) {
    return null;
  }

  runtime.log(
    `Explorer: unlinked note ${unlinkedNote.id} from ${removedContainerId}`,
  );
  return unlinkedNote;
}

export async function activateExplorerDocumentLinkState<TRuntime>(params: {
  host: ExplorerDocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  runtime: ExplorerDocumentStructuralMutationRuntime;
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

  const currentDocumentStore =
    await primeExplorerDocumentStoreForStructuralMutation({
      host,
      note,
      runtime,
    });
  if (!currentDocumentStore) {
    return null;
  }

  const relinkedNote = await relinkExplorerDocumentLocally({
    accessEpoch: 1,
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

  runtime.log(
    `Explorer: switched active note ${relinkedNote.id} to ${targetContainerId}`,
  );
  return relinkedNote;
}
