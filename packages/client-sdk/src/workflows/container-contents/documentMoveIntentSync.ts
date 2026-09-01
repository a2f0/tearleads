import { errorMessage } from "../../data/errorMessage";
import { reportAndRethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
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
import { settleDocumentMoveIntent } from "./documentMoveIntentSettlement";
import type {
  DocumentStructuralMutationLocalStore,
  DocumentStructuralMutationRelinkInput,
} from "./documentStructureTypes";
import type { ContainerContentsProjectionUserKeyResolver } from "./projectionKeys";
import type { ContainerState } from "./remoteHydration";
import { hasRemoteContainerMetadataState } from "./remoteHydration/reconciliation";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

type DocumentMoveIntentReplayResult =
  | "abandoned"
  | "moved"
  | "partial"
  | "blocked"
  | "failed";

interface DocumentMoveFailureState {
  current: DocumentLinkSetMutationFailure | null;
  sawPermissionDenial: boolean;
}

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
  lifecycleGeneration?: number | undefined;
  resolveProjectionUserKey: ContainerContentsProjectionUserKeyResolver;
  runtime: ContainerContentsWorkflowRuntime;
}

async function recordPendingDocumentMoveIntentError(input: {
  blocked?: boolean | undefined;
  denied?: boolean | undefined;
  documentId: string;
  expectedIntentId?: string | undefined;
  expectedUpdatedAt?: string | undefined;
  isCurrent: () => boolean;
  message: string;
  state: DocumentMoveIntentSyncState;
}): Promise<boolean> {
  if (!input.isCurrent()) return false;
  await sqlDocumentMoveIntentPersistence.recordMoveIntentError(
    input.state.runtime.infra.execSql,
    {
      blocked: input.blocked,
      denied: input.denied,
      documentId: input.documentId,
      expectedIntentId: input.expectedIntentId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      message: input.message,
    },
  );
  return input.isCurrent();
}

async function relinkMovedDocumentStore<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  isCurrent: () => boolean;
  intent: DocumentMoveIntentRecord;
  relinkInput: DocumentStructuralMutationRelinkInput;
  targetContainerId: string;
}): Promise<boolean> {
  if (!input.isCurrent()) return false;
  const documentStore = input.host.openDocumentStore({
    containerId: input.targetContainerId,
    documentId: input.intent.documentId,
    localId: input.intent.localId,
  });
  if (!(await documentStore.ensureInitialized()) || !input.isCurrent()) {
    return false;
  }

  const relinked = await documentStore.relink({
    ...input.relinkInput,
    stillCurrent: input.isCurrent,
  });
  if (!relinked || !input.isCurrent()) {
    return false;
  }

  documentStore.updateRuntime(
    input.host.documentWorkflowRuntime(input.targetContainerId),
  );
  return input.isCurrent();
}

async function persistMovedDocumentReplay<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  intent: DocumentMoveIntentRecord;
  isCurrent: () => boolean;
  moved: NonNullable<Awaited<ReturnType<typeof moveRemoteContainerDocument>>>;
  state: DocumentMoveIntentSyncState;
}): Promise<boolean> {
  const { host, intent, moved, state } = input;
  const existingDocument = await defaultDocumentsPersistence.loadDocument(
    state.runtime.infra.execSql,
    intent.localId,
  );
  if (!input.isCurrent() || !existingDocument) {
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
    ...(moved.status === "partial"
      ? {}
      : {
          commitSideEffect: (transactionExecSql) =>
            settleDocumentMoveIntent({
              execSql: transactionExecSql,
              intent,
              isCurrent: input.isCurrent,
            }),
        }),
  };

  return relinkMovedDocumentStore({
    host,
    isCurrent: input.isCurrent,
    intent,
    relinkInput,
    targetContainerId: moved.nextContainerId,
  });
}

async function assertMoveIntentRotationPreflight<TRuntime>(input: {
  existingContainerId: string | null | undefined;
  host: DocumentMoveIntentSyncHost<TRuntime>;
  isCurrent: () => boolean;
  intent: DocumentMoveIntentRecord;
}): Promise<Uint8Array | null> {
  if (!input.isCurrent()) return null;
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
  if (!input.isCurrent()) return null;
  const rotationSnapshot = await preflightStore.assertCanRotateContentKey();
  return input.isCurrent() ? rotationSnapshot : null;
}

async function movePendingDocumentIntent<TRuntime>(input: {
  existingContainerId: string | null | undefined;
  host: DocumentMoveIntentSyncHost<TRuntime>;
  isCurrent: () => boolean;
  intent: DocumentMoveIntentRecord;
  onFailure: DocumentLinkSetFailureHandler;
  state: DocumentMoveIntentSyncState;
}) {
  const rotationSnapshot = await assertMoveIntentRotationPreflight(input);
  if (!rotationSnapshot || !input.isCurrent()) return "abandoned" as const;
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
  isCurrent: () => boolean;
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
  if (!input.isCurrent()) return { result: "abandoned" };
  if (!existingDocument || existingDocument.documentId !== intent.documentId) {
    await recordPendingDocumentMoveIntentError({
      blocked: true,
      documentId: intent.documentId,
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      isCurrent: input.isCurrent,
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
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      isCurrent: input.isCurrent,
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
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      isCurrent: input.isCurrent,
      message: "Document move destination container is not synced yet",
      state,
    });
    return { result: "failed" };
  }
  return { existingDocument };
}

async function recordRejectedDocumentMove(input: {
  failure: DocumentMoveFailureState;
  intent: DocumentMoveIntentRecord;
  isCurrent: () => boolean;
  state: DocumentMoveIntentSyncState;
}): Promise<void> {
  await recordPendingDocumentMoveIntentError({
    // A permission denial parks the intent for the access-restored signal
    // instead of replaying on every structural pass (row 7).
    denied: input.failure.sawPermissionDenial,
    documentId: input.intent.documentId,
    expectedIntentId: input.intent.id,
    expectedUpdatedAt: input.intent.updatedAt,
    isCurrent: input.isCurrent,
    message: describeRejectedDocumentMove(input.failure.current),
    state: input.state,
  });
}

function logSyncedDocumentMove(
  intent: DocumentMoveIntentRecord,
  state: DocumentMoveIntentSyncState,
): void {
  state.runtime.util.log(
    `Container contents: synced queued document move ${intent.documentId}`,
  );
}

async function trySyncPendingDocumentMoveIntent<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  isCurrent: () => boolean;
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
    const lastFailure: DocumentMoveFailureState = {
      current: null,
      sawPermissionDenial: false,
    };
    const moved = await movePendingDocumentIntent({
      existingContainerId: existingDocument.containerId,
      host,
      isCurrent: input.isCurrent,
      intent,
      onFailure: (failure) => {
        lastFailure.current = failure;
        lastFailure.sawPermissionDenial =
          lastFailure.sawPermissionDenial || failure.status === 403;
      },
      state,
    });
    if (moved === "abandoned" || !input.isCurrent()) return "abandoned";
    if (!moved) {
      await recordRejectedDocumentMove({
        failure: lastFailure,
        intent,
        isCurrent: input.isCurrent,
        state,
      });
      return "failed";
    }

    if (
      !(await persistMovedDocumentReplay({
        host,
        intent,
        isCurrent: input.isCurrent,
        moved,
        state,
      }))
    ) {
      if (!input.isCurrent()) return "abandoned";
      await recordPendingDocumentMoveIntentError({
        documentId: intent.documentId,
        expectedIntentId: intent.id,
        expectedUpdatedAt: intent.updatedAt,
        isCurrent: input.isCurrent,
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
        expectedIntentId: intent.id,
        expectedUpdatedAt: intent.updatedAt,
        isCurrent: input.isCurrent,
        message: "Remote document move partially applied; retry required",
        state,
      });
      return "partial";
    }

    logSyncedDocumentMove(intent, state);
    return "moved";
  } catch (error: unknown) {
    await reportAndRethrowKeyingVerificationError(
      error,
      state.runtime.util.reportSecurityIncident,
      {
        objectId: intent.documentId,
        objectKind: "document",
        operation: "document.move.replay",
      },
    );
    if (!input.isCurrent()) return "abandoned";
    const message = errorMessage(error);
    await recordPendingDocumentMoveIntentError({
      documentId: intent.documentId,
      expectedIntentId: intent.id,
      expectedUpdatedAt: intent.updatedAt,
      isCurrent: input.isCurrent,
      message: `Failed to sync document move: ${message}`,
      state,
    });
    return "failed";
  }
}

// One replay per store/database generation: parked denied intents flip back to
// pending ahead of its first scan (row 7). A restart loses the in-memory
// access-restored edge, and replacing the executor or lifecycle can expose a
// different durable queue. Running inside the scan keeps ordering trivially
// correct: replayed intents are attempted by this same pass, not stranded until
// an unrelated trigger. Marked complete only after the reset lands, so a
// transient failure retries on the next pass.
interface DeniedReplayGeneration {
  execSql: ContainerContentsWorkflowRuntime["infra"]["execSql"];
  lifecycleGeneration: number | undefined;
}

const deniedReplayGenerationByState = new WeakMap<
  DocumentMoveIntentSyncState,
  DeniedReplayGeneration
>();

function deniedReplayMatchesGeneration(
  state: DocumentMoveIntentSyncState,
  execSql: ContainerContentsWorkflowRuntime["infra"]["execSql"],
): boolean {
  const completed = deniedReplayGenerationByState.get(state);
  return (
    completed?.execSql === execSql &&
    completed.lifecycleGeneration === state.lifecycleGeneration
  );
}

export async function syncPendingDocumentMoveIntents<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
  isCurrent: () => boolean;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  state: DocumentMoveIntentSyncState;
}): Promise<number> {
  if (!input.isCurrent()) return 0;
  const lifecycleState = input.state;
  const state = { ...lifecycleState };
  const execSql = state.runtime.infra.execSql;
  if (!deniedReplayMatchesGeneration(lifecycleState, execSql)) {
    await sqlDocumentMoveIntentPersistence.resetDeniedMoveIntents(execSql);
    if (!input.isCurrent()) return 0;
    deniedReplayGenerationByState.set(lifecycleState, {
      execSql,
      lifecycleGeneration: lifecycleState.lifecycleGeneration,
    });
  }
  const pendingIntents =
    await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql);
  if (!input.isCurrent()) return 0;
  let movedCount = 0;

  for (const intent of pendingIntents) {
    if (!input.isCurrent()) return movedCount;
    const result = await trySyncPendingDocumentMoveIntent({
      host: input.host,
      isCurrent: input.isCurrent,
      isRemoteSyncBlocked: input.isRemoteSyncBlocked,
      intent,
      state,
    });
    if (result === "abandoned") return movedCount;
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
