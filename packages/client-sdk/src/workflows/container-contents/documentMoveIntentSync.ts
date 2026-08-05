import { errorMessage } from "../../data/errorMessage";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import {
  type DocumentMoveIntentRecord,
  sqlDocumentMoveIntentPersistence,
} from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import {
  type DocumentLinkSetFailureHandler,
  type DocumentLinkSetMutationFailure,
  type DocumentRecord,
  defaultDocumentsPersistence,
} from "../documents";
import { moveRemoteContainerDocument } from "./documentLinks";
import type {
  DocumentStructuralMutationLocalStore,
  DocumentStructuralMutationRelinkInput,
} from "./documentStructureTypes";
import type { ContainerContentsProjectionUserKeyResolver } from "./projectionKeys";
import type { ContainerState } from "./remoteHydration";
import { hasRemoteContainerMetadataState } from "./remoteHydration/reconciliation";
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

async function recordPendingDocumentMoveIntentError(input: {
  blocked?: boolean | undefined;
  denied?: boolean | undefined;
  documentId: string;
  expectedUpdatedAt?: string | undefined;
  message: string;
  state: DocumentMoveIntentSyncState;
}) {
  await sqlDocumentMoveIntentPersistence.recordMoveIntentError(
    input.state.runtime.infra.execSql,
    {
      blocked: input.blocked,
      denied: input.denied,
      documentId: input.documentId,
      expectedUpdatedAt: input.expectedUpdatedAt,
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

async function resolveMoveIntentPreflight(input: {
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  intent: DocumentMoveIntentRecord;
  state: DocumentMoveIntentSyncState;
}): Promise<
  | { existingDocument: DocumentRecord; result?: undefined }
  | { existingDocument?: undefined; result: DocumentMoveIntentReplayResult }
> {
  const { intent, state } = input;
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
    return { result: "blocked" };
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
    return { result: "blocked" };
  }
  if (input.isRemoteSyncBlocked(targetState.container.organizationId)) {
    return { result: "blocked" };
  }
  if (!hasRemoteContainerMetadataState(targetState)) {
    await recordPendingDocumentMoveIntentError({
      documentId: intent.documentId,
      message: "Document move destination container is not synced yet",
      state,
    });
    return { result: "failed" };
  }
  return { existingDocument };
}

async function trySyncPendingDocumentMoveIntent<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  intent: DocumentMoveIntentRecord;
  state: DocumentMoveIntentSyncState;
}): Promise<DocumentMoveIntentReplayResult> {
  const { host, intent, state } = input;
  const preflight = await resolveMoveIntentPreflight(input);
  if (preflight.result !== undefined) {
    return preflight.result;
  }
  const { existingDocument } = preflight;

  try {
    const lastFailure: {
      current: DocumentLinkSetMutationFailure | null;
      // Accumulated across every link/unlink failure of the pass: a 403 on
      // ANY leg parks the intent even when a later leg fails differently.
      sawPermissionDenial: boolean;
    } = { current: null, sawPermissionDenial: false };
    const moved = await movePendingDocumentIntent({
      existingContainerId: existingDocument.containerId,
      host,
      intent,
      onFailure: (failure) => {
        lastFailure.current = failure;
        lastFailure.sawPermissionDenial =
          lastFailure.sawPermissionDenial || failure.status === 403;
      },
      state,
    });
    if (!moved) {
      await recordPendingDocumentMoveIntentError({
        // A permission denial parks the intent for the access-restored
        // signal instead of replaying on every structural pass (row 7).
        denied: lastFailure.sawPermissionDenial,
        documentId: intent.documentId,
        expectedUpdatedAt: intent.updatedAt,
        message: describeRejectedDocumentMove(lastFailure.current),
        state,
      });
      return "failed";
    }

    if (!(await persistMovedDocumentReplay({ host, intent, moved, state }))) {
      await recordPendingDocumentMoveIntentError({
        documentId: intent.documentId,
        expectedUpdatedAt: intent.updatedAt,
        message: "Document move replay could not relink the local document",
        state,
      });
      return "failed";
    }
    if (moved.status === "partial") {
      await recordPendingDocumentMoveIntentError({
        // An unlink refused for permissions parks like any other denied
        // move (row 7); other partials keep row 15's replay.
        denied: lastFailure.sawPermissionDenial,
        documentId: intent.documentId,
        expectedUpdatedAt: intent.updatedAt,
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
    const message = errorMessage(error);
    await recordPendingDocumentMoveIntentError({
      documentId: intent.documentId,
      message: `Failed to sync document move: ${message}`,
      state,
    });
    return "failed";
  }
}

// One replay per launch: parked denied intents flip back to pending ahead of
// the first scan of this store lifecycle (row 7) — a restart loses the
// in-memory access-restored edge, and "an app restart re-attempts everything
// retriable". Running inside the scan keeps the ordering trivially correct:
// the replayed intents are attempted by this same pass, not stranded until an
// unrelated trigger. Marked complete only after the reset lands, so a
// transient failure retries on the next pass.
const deniedReplayCompleted = new WeakSet<DocumentMoveIntentSyncState>();

export async function syncPendingDocumentMoveIntents<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  state: DocumentMoveIntentSyncState;
}): Promise<number> {
  const execSql = input.state.runtime.infra.execSql;
  if (!deniedReplayCompleted.has(input.state)) {
    await sqlDocumentMoveIntentPersistence.resetDeniedMoveIntents(execSql);
    deniedReplayCompleted.add(input.state);
  }
  const pendingIntents =
    await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql);
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
