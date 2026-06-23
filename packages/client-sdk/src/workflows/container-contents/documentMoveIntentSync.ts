import {
  type DocumentMoveIntentRecord,
  sqlDocumentMoveIntentPersistence,
} from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { defaultDocumentsPersistence } from "../documents";
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
  documentId: string;
  message: string;
  state: DocumentMoveIntentSyncState;
}) {
  await sqlDocumentMoveIntentPersistence.recordMoveIntentError(
    input.state.runtime.infra.execSql,
    {
      blocked: input.blocked,
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
    queueBaselineAfterRelink: moved.queueBaselineAfterRelink,
    ...(moved.remoteState ?? {}),
  };

  return relinkMovedDocumentStore({
    host,
    intent,
    relinkInput,
    targetContainerId: moved.nextContainerId,
  });
}

async function trySyncPendingDocumentMoveIntent<TRuntime>(input: {
  host: DocumentMoveIntentSyncHost<TRuntime>;
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
  if (!hasRemoteContainerMetadataState(targetState)) {
    await recordPendingDocumentMoveIntentError({
      documentId: intent.documentId,
      message: "Document move destination container is not synced yet",
      state,
    });
    return "failed";
  }

  try {
    // Rebuild the remote link/unlink requests from fresh writer projections on
    // every retry. The local intent stores only the desired placement so a
    // crash after "link target" but before "unlink source" can resume cleanly.
    const moved = await moveRemoteContainerDocument({
      currentContainerId:
        intent.sourceContainerId ??
        existingDocument.containerId ??
        intent.targetContainerId,
      documentId: intent.documentId,
      noteId: intent.localId,
      replaceLinkedContainers: intent.replaceLinkedContainers,
      resolveProjectionUserKey: state.resolveProjectionUserKey,
      runtime: state.runtime,
      targetContainerId: intent.targetContainerId,
    });
    if (!moved) {
      await recordPendingDocumentMoveIntentError({
        documentId: intent.documentId,
        message: "Remote document move was rejected or unavailable",
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
      intent,
      state: input.state,
    });
    if (result === "moved" || result === "partial") {
      movedCount += 1;
    }
  }

  return movedCount;
}
