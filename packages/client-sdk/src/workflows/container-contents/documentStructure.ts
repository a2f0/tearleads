import type { DocumentSummary } from "../../data/documentSummary";
import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../data/documents/documentConstants";
import type { RelinkPersistedDocumentInput } from "../documents";
import {
  linkRemoteContainerDocument,
  moveRemoteContainerDocument,
  type RemoteDocumentPersistedState,
  resolveActiveDocumentContainerId,
  unlinkRemoteContainerDocument,
} from "./documentLinks";

type DocumentStructuralMutationResolver = Parameters<
  typeof linkRemoteContainerDocument
>[0]["resolveProjectionUserKey"];
type DocumentStructuralMutationRemoteRuntime = Parameters<
  typeof linkRemoteContainerDocument
>[0]["runtime"];

export type MergeDocumentSummary = (nextDocument: DocumentSummary) => void;
export type SetLinkedContainerIdsForDocument = (
  documentId: string,
  linkedContainerIds: ReadonlyArray<string>,
) => void;

export type DocumentStructuralMutationRuntime =
  DocumentStructuralMutationRemoteRuntime & {
    resolveProjectionUserKey: DocumentStructuralMutationResolver;
  };

export interface DocumentStructuralMutationRelinkInput
  extends RelinkPersistedDocumentInput {
  contentKeyBundle?: string | null | undefined;
  documentKekTargets?: string | null | undefined;
  documentManifestBundle?: string | null | undefined;
  queueBaselineAfterRelink?: boolean | undefined;
}

export interface DocumentStructuralMutationLocalStore<TRuntime> {
  ensureInitialized: () => Promise<boolean>;
  relink: (
    input: DocumentStructuralMutationRelinkInput,
  ) => Promise<DocumentSummary | null>;
  requestSync: () => void;
  updateRuntime: (runtime: TRuntime) => void;
}

export interface DocumentStructuralMutationHost<TRuntime> {
  documentWorkflowRuntime: (containerId: string) => TRuntime;
  mergeDocumentSummary: MergeDocumentSummary;
  openDocumentStore: (input: {
    containerId: string;
    documentId: string | null;
    localId: string;
  }) => DocumentStructuralMutationLocalStore<TRuntime>;
}

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
  if (!note.containerId || (requireDocumentId && !note.documentId)) {
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

async function relinkContainerDocumentLocally<TRuntime>(params: {
  accessEpoch: number;
  accessStateHash?: string | null | undefined;
  currentDocumentStore: DocumentStructuralMutationLocalStore<TRuntime>;
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  queueBaselineAfterRelink?: boolean | undefined;
  remoteState?: RemoteDocumentPersistedState | undefined;
  requestSync: boolean;
  runtime: DocumentStructuralMutationRuntime;
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
  const relinkedNote = await currentDocumentStore.relink({
    accessEpoch,
    ...(accessStateHash === undefined ? {} : { accessStateHash }),
    containerId: targetContainerId,
    ...remoteState,
    documentId: note.documentId,
    localId: note.id,
    queueBaselineAfterRelink,
  });
  if (!relinkedNote) {
    runtime.util.log(
      `Container contents: note ${note.id} could not be relinked after a structural mutation`,
    );
    return null;
  }

  host.mergeDocumentSummary(relinkedNote);
  currentDocumentStore.updateRuntime(
    host.documentWorkflowRuntime(targetContainerId),
  );
  if (requestSync) {
    currentDocumentStore.requestSync();
  }
  return relinkedNote;
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

export async function moveLocalDocumentLinkState<TRuntime>(params: {
  expandNode: (nodeId: string) => void;
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  runtime: DocumentStructuralMutationRuntime;
  targetContainerId: string;
}): Promise<DocumentSummary | null> {
  const { expandNode, host, note, runtime, targetContainerId } = params;
  if (!note.containerId || note.containerId === targetContainerId) {
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

export async function moveDocumentLinkState<TRuntime>(params: {
  expandNode: (nodeId: string) => void;
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary;
  runtime: DocumentStructuralMutationRuntime;
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
  if (!note.containerId || note.containerId === targetContainerId) {
    return { linksChanged: false, note: null };
  }
  if (!note.documentId) {
    const movedNote = await moveLocalDocumentLinkState({
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

  const movedDocument = await moveRemoteContainerDocument({
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

  const movedNote = await relinkDocumentAfterStructuralMutation({
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
    runtime.util.log(
      `Container contents: partially moved note ${movedNote.id}; linked to ${nextContainerId} but still linked to ${note.containerId}`,
    );
  } else {
    runtime.util.log(
      `Container contents: moved note ${movedNote.id} to ${nextContainerId}`,
    );
  }
  return { linksChanged: true, note: movedNote };
}

export async function linkDocumentLinkState<TRuntime>(params: {
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
    queueBaselineAfterRelink: linkedDocument.contentKeyRotated,
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

export async function unlinkDocumentLinkState<TRuntime>(params: {
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

  const unlinkedDocument = await unlinkRemoteContainerDocument({
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
    queueBaselineAfterRelink: unlinkedDocument.contentKeyRotated,
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

export async function activateDocumentLinkState<TRuntime>(params: {
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

  runtime.util.log(
    `Container contents: switched active note ${relinkedNote.id} to ${targetContainerId}`,
  );
  return relinkedNote;
}
