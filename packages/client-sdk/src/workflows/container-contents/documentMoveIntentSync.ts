import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import {
  type DocumentMoveIntentRecord,
  sqlDocumentMoveIntentPersistence,
} from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import {
  type DocumentLinkSetFailureHandler,
  type DocumentLinkSetMutationFailure,
  defaultDocumentsPersistence,
} from "../documents";
import { moveRemoteContainerDocument } from "./documentLinks";
import type {
  DocumentStructuralMutationLocalStore,
  DocumentStructuralMutationRelinkInput,
} from "./documentStructureTypes";
import type { ContainerContentsProjectionUserKeyResolver } from "./projectionKeys";
import type { ContainerState } from "./remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

type DocumentMoveIntentReplayResult =
  | "moved"
  | "partial"
  | "blocked"
  | "failed";

export interface DocumentMoveIntentSyncHost<TRuntime> {
  documentWorkflowRuntime: (containerId: string) => TRuntime;
  openDocumentStore: (input: {
    containerId: string;
    documentId: string | null;
    localId: string;
  }) => DocumentStructuralMutationLocalStore<TRuntime>;
}

interface DocumentMoveIntentSyncState {
  containersById: ReadonlyMap<string, ContainerState>;
  resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
  runtime: ContainerContentsWorkflowRuntime;
}

function hasRemoteContainerMetadataState(
  containerState: ContainerState,
): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0 &&
    typeof containerState.container.metadataDocumentId === "string" &&
    containerState.container.metadataDocumentId.length > 0
  );
}

async function recordPendingDocumentMoveIntentError(input: {
  blocked?: boolean | undefined;
  denied?: boolean | undefined;
  documentId: string;
  message: string;
  state: DocumentMoveIntentSyncState;
}) {
  await sqlDocumentMoveIntentPersistence.recordMoveIntentError(
    input.state.runtime.infra.execSql,
    {
      blocked: input.blocked,
      denied: input.denied,
      documentId: input.documentId,
      message: input.message,
    },
  );
}

async function markDocumentMoveIntentSynced(input: {
  documentId: string;
  expectedUpdatedAt: string;
  state: DocumentMoveIntentSyncState;
}) {
  await sqlDocumentMoveIntentPersistence.markMoveIntentSynced(
    input.state.runtime.infra.execSql,
    {
      documentId: input.documentId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    },
  );
}

async function relinkMovedDocumentStore<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  intent: DocumentMoveIntentRecord;
  relinkInput: DocumentStructuralMutationRelinkInput;
  targetContainerId: string;
}): Promise<boolean> {
  const documentStore = input.host.openDocumentStore({
    containerId: input.targetContainerId,
    documentId: input.intent.documentId,
    localId: input.intent.localId,
  });
  if (!(await documentStore.ensureInitialized())) {
    return false;
  }

  const relinked = await documentStore.relink(input.relinkInput);
  if (!relinked) {
    return false;
  }

  documentStore.updateRuntime(
    input.host.documentWorkflowRuntime(input.targetContainerId),
  );
  return true;
}

async function persistMovedDocumentReplay<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  intent: DocumentMoveIntentRecord;
  moved: NonNullable<Awaited<ReturnType<typeof moveRemoteContainerDocument>>>;
  state: DocumentMoveIntentSyncState;
}): Promise<boolean> {
  const { host, intent, moved, state } = input;
  const existingDocument = await defaultDocumentsPersistence.loadDocument(
    state.runtime.infra.execSql,
    intent.localId,
  );
  if (!existingDocument) {
    return false;
  }

  const relinkInput: DocumentStructuralMutationRelinkInput = {
    accessEpoch: moved.accessEpoch ?? existingDocument.accessEpoch,
    ...(moved.accessStateHash === null
      ? {}
      : { accessStateHash: moved.accessStateHash }),
    containerId: moved.nextContainerId,
    documentId: intent.documentId,
    localId: intent.localId,
    ...(moved.remoteState ?? {}),
  };

  return relinkMovedDocumentStore({
    host,
    intent,
    relinkInput,
    targetContainerId: moved.nextContainerId,
  });
}

async function assertMoveIntentRotationPreflight<TRuntime>(input: {
  existingContainerId: string | null | undefined;
  host: DocumentMoveIntentSyncHost<TRuntime>;
  intent: DocumentMoveIntentRecord;
}): Promise<Uint8Array> {
  const preflightStore = input.host.openDocumentStore({
    containerId:
      input.intent.sourceContainerId ??
      input.existingContainerId ??
      input.intent.targetContainerId,
    documentId: input.intent.documentId,
    localId: input.intent.localId,
  });
  if (!(await preflightStore.ensureInitialized())) {
    throw new Error("Document rotation preflight could not load the document");
  }
  return preflightStore.assertCanRotateContentKey();
}

async function movePendingDocumentIntent<TRuntime>(input: {
  existingContainerId: string | null | undefined;
  host: DocumentMoveIntentSyncHost<TRuntime>;
  intent: DocumentMoveIntentRecord;
  onFailure: DocumentLinkSetFailureHandler;
  state: DocumentMoveIntentSyncState;
}) {
  const rotationSnapshot = await assertMoveIntentRotationPreflight(input);
  return moveRemoteContainerDocument({
    currentContainerId:
      input.intent.sourceContainerId ??
      input.existingContainerId ??
      input.intent.targetContainerId,
    documentId: input.intent.documentId,
    noteId: input.intent.localId,
    onFailure: input.onFailure,
    replaceLinkedContainers: input.intent.replaceLinkedContainers,
    resolveProjectionUserKey: input.state.resolveProjectionUserKey,
    rotationSnapshot,
    runtime: input.state.runtime,
    targetContainerId: input.intent.targetContainerId,
  });
}

/**
 * The queue-facing description of a failed remote move. The stable prefix is
 * kept so existing consumers keep matching; the captured detail appends the
 * HTTP status when one was seen, so a revoked permission (403) reads
 * differently from an offline blip.
 */
function describeRejectedDocumentMove(
  failure: DocumentLinkSetMutationFailure | null,
): string {
  const prefix = "Remote document move was rejected or unavailable";
  if (!failure) {
    return prefix;
  }
  const detail =
    failure.status === null
      ? failure.message
      : `${failure.message} (${failure.status})`;
  return `${prefix}: ${detail}`;
}

async function trySyncPendingDocumentMoveIntent<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  intent: DocumentMoveIntentRecord;
  state: DocumentMoveIntentSyncState;
}): Promise<DocumentMoveIntentReplayResult> {
  const { host, intent, state } = input;
  const execSql = state.runtime.infra.execSql;
  const existingDocument = await defaultDocumentsPersistence.loadDocument(
    execSql,
    intent.localId,
  );
  if (!existingDocument || existingDocument.documentId !== intent.documentId) {
    await recordPendingDocumentMoveIntentError({
      blocked: true,
      documentId: intent.documentId,
      message: "Document move intent references a missing local document",
      state,
    });
    return "blocked";
  }

  const targetState = state.containersById.get(intent.targetContainerId);
  if (!targetState) {
    await recordPendingDocumentMoveIntentError({
      blocked: true,
      documentId: intent.documentId,
      message:
        "Document move intent references a missing destination container",
      state,
    });
    return "blocked";
  }
  if (input.isRemoteSyncBlocked(targetState.container.organizationId)) {
    return "blocked";
  }
  if (!hasRemoteContainerMetadataState(targetState)) {
    await recordPendingDocumentMoveIntentError({
      documentId: intent.documentId,
      message: "Document move destination container is not synced yet",
      state,
    });
    return "failed";
  }

  try {
    const lastFailure: { current: DocumentLinkSetMutationFailure | null } = {
      current: null,
    };
    const moved = await movePendingDocumentIntent({
      existingContainerId: existingDocument.containerId,
      host,
      intent,
      onFailure: (failure) => {
        lastFailure.current = failure;
      },
      state,
    });
    if (!moved) {
      await recordPendingDocumentMoveIntentError({
        // A permission denial parks the intent for the access-restored
        // signal instead of replaying on every structural pass (row 7).
        denied: lastFailure.current?.status === 403,
        documentId: intent.documentId,
        message: describeRejectedDocumentMove(lastFailure.current),
        state,
      });
      return "failed";
    }

    if (!(await persistMovedDocumentReplay({ host, intent, moved, state }))) {
      await recordPendingDocumentMoveIntentError({
        documentId: intent.documentId,
        message: "Document move replay could not relink the local document",
        state,
      });
      return "failed";
    }
    if (moved.status === "partial") {
      await recordPendingDocumentMoveIntentError({
        documentId: intent.documentId,
        message: "Remote document move partially applied; retry required",
        state,
      });
      return "partial";
    }

    await markDocumentMoveIntentSynced({
      documentId: intent.documentId,
      expectedUpdatedAt: intent.updatedAt,
      state,
    });
    state.runtime.util.log(
      `Container contents: synced queued document move ${intent.documentId}`,
    );
    return "moved";
  } catch (error: unknown) {
    rethrowKeyingVerificationError(error);
    const message = error instanceof Error ? error.message : String(error);
    await recordPendingDocumentMoveIntentError({
      documentId: intent.documentId,
      message: `Failed to sync document move: ${message}`,
      state,
    });
    return "failed";
  }
}

export async function syncPendingDocumentMoveIntents<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  state: DocumentMoveIntentSyncState;
}): Promise<number> {
  const pendingIntents =
    await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(
      input.state.runtime.infra.execSql,
    );
  let movedCount = 0;

  for (const intent of pendingIntents) {
    const result = await trySyncPendingDocumentMoveIntent({
      host: input.host,
      isRemoteSyncBlocked: input.isRemoteSyncBlocked,
      intent,
      state: input.state,
    });
    // A "partial" result (link applied, unlink still pending) must not count:
    // the caller re-arms this same structural lane whenever the count is
    // positive, so a deterministically failing unlink hot-looped the pump
    // (issue #1744). The intent row stays pending; event-driven, manual, and
    // startup lane requests retry it.
    if (result === "moved") {
      movedCount += 1;
    }
  }

  return movedCount;
}
