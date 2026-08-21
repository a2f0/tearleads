import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  importUpdates,
} from "@symcrypt/loro";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import { isDocumentUpdateCreatedEvent } from "../../data/documents/documentSync";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { isKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { isPrincipalPolicyNotCachedError } from "../../data/keyingProjectionVerification/principalPolicyVerification";
import {
  CONTAINER_METADATA_APP_KIND,
  type ContainerContentsPersistence,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  clearDocumentSyncFailure,
  type DocumentRecord,
  type PendingUpdateRecord,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import { settleOutgoingPassAndDecideReArm } from "../../data/sync/outgoingUpdateSettlement";
import {
  createDocumentWriterPublicKeyResolver,
  describeDocumentSyncSubmitFailure,
  type RekeyPendingUpdate,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../documents";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import {
  createReadOnlyMetadataSyncSaveOptions,
  hasCurrentContainerMetadataReadState,
  persistContainerMetadataStateFromRuntime,
} from "./metadataPersistence";

export {
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
  setContainerIconMetadataStateFromRuntime,
} from "./metadataPersistence";

import type {
  ContainerMetadataState,
  SyncedContainerMetadataState,
} from "./metadataTypes";

export type { ContainerMetadataPatch } from "./metadataTypes";

import type { ContainerContentsWorkflowRuntime } from "./runtime";

type ContainerMetadataSyncApi = Parameters<
  typeof syncRemoteDocument
>[0]["apiClient"] &
  Pick<
    ContainerContentsWorkflowRuntime["apiClient"],
    "getCurrentPrincipalPolicy"
  >;

interface ContainerMetadataSyncRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    | "auth"
    | "crypto"
    | "infra"
    | "resolveTrustedUserIdentity"
    | "state"
    | "util"
  > {
  apiClient: ContainerMetadataSyncApi;
}

type ContainerMetadataSyncResult = NonNullable<
  Awaited<ReturnType<typeof syncRemoteDocument>>
>;

interface ContainerMetadataSyncAttempt {
  outgoingUpdateCount: number;
  synced: ContainerMetadataSyncResult;
}

export function hasContainerMetadataDocumentUpdateEvent(
  events: ReadonlyArray<unknown>,
  metadataStates: Iterable<{ record: Pick<DocumentRecord, "documentId"> }>,
  locallyAcceptedUpdateIds?: Set<string>,
): boolean {
  // Pass a copy: listContainerMetadataDocumentUpdateIds consumes (deletes)
  // matched ids from the set, and a boolean predicate must not mutate the
  // caller's registry — otherwise a `has` check before the real list pass would
  // prematurely consume the self-echo ids, so the later list would miss them
  // and arm a redundant sync.
  return (
    listContainerMetadataDocumentUpdateIds(
      events,
      metadataStates,
      locallyAcceptedUpdateIds ? new Set(locallyAcceptedUpdateIds) : undefined,
    ).length > 0
  );
}

/**
 * Consume this client's own metadata update ids from a `document_update_created`
 * event and report whether any UNKNOWN (peer-authored) update id remains.
 * Mirrors the document store's self-echo suppression: a fully self-authored echo
 * returns false so it does not arm a redundant forced read-sync; an event with
 * an unknown id — or one carrying no updateIds at all — returns true and stays a
 * lossy hint that forces the sync.
 */
function metadataEventHasRemoteUpdate(
  event: { updateIds?: readonly string[] | undefined },
  locallyAcceptedUpdateIds: Set<string> | undefined,
): boolean {
  if (
    !locallyAcceptedUpdateIds ||
    !event.updateIds ||
    event.updateIds.length === 0
  ) {
    return true;
  }

  let remoteUpdateFound = false;
  for (const updateId of event.updateIds) {
    if (locallyAcceptedUpdateIds.has(updateId)) {
      locallyAcceptedUpdateIds.delete(updateId);
    } else {
      remoteUpdateFound = true;
    }
  }
  return remoteUpdateFound;
}

export function listContainerMetadataDocumentUpdateIds(
  events: ReadonlyArray<unknown>,
  metadataStates: Iterable<{ record: Pick<DocumentRecord, "documentId"> }>,
  locallyAcceptedUpdateIds?: Set<string>,
): string[] {
  const metadataDocumentIds = new Set<string>();
  for (const metadataState of metadataStates) {
    if (typeof metadataState.record.documentId === "string") {
      metadataDocumentIds.add(metadataState.record.documentId);
    }
  }
  if (metadataDocumentIds.size === 0) {
    return [];
  }

  const eventDocumentIds = new Set<string>();
  for (const event of events) {
    if (
      !isDocumentUpdateCreatedEvent(event) ||
      !metadataDocumentIds.has(event.documentId)
    ) {
      continue;
    }

    if (!metadataEventHasRemoteUpdate(event, locallyAcceptedUpdateIds)) {
      continue;
    }

    eventDocumentIds.add(event.documentId);
  }

  return Array.from(eventDocumentIds);
}

function isStaleContainerMetadataSecurityStateError(error: unknown): boolean {
  // Signed-state verification failures are terminal integrity incidents, even
  // when their diagnostic message resembles an ordinary stale-key condition.
  if (isKeyingVerificationError(error)) return false;
  const message = error instanceof Error ? error.message : "";

  return (
    message.startsWith(
      "Document authorizing container KEK path could not be unwrapped",
    ) ||
    message.startsWith("Document content key could not be unwrapped") ||
    message.startsWith("Document content-key bundle is stale") ||
    message.startsWith("Document content-key re-wrap KEK is unavailable") ||
    message.startsWith("Document stale-bundle recovery") ||
    message === "Document sync target hash mismatch" ||
    message === "Document sync content-key targets mismatch"
  );
}

async function syncRemoteContainerMetadata(input: {
  buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
  containerId: string;
  documentId: string | null;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  pendingUpdates: readonly PendingUpdateRecord[];
  persistedState?: DocumentRecord | null | undefined;
  rekeyPendingUpdate: RekeyPendingUpdate;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}): Promise<ContainerMetadataSyncAttempt | null> {
  const {
    buildRotationSnapshot,
    containerId,
    documentId,
    lastCommitLsn,
    localVersionVector,
    pendingUpdates,
    persistedState,
    rekeyPendingUpdate,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
    writerProjection,
  } = input;
  const execSql = runtime.infra.execSql;

  if (!documentId) {
    return null;
  }

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.util.log(
      "Container contents: skipped metadata sync because the writer context is unavailable.",
    );
    return null;
  }

  const metadataScope = {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
  };
  const synced = await syncRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    buildRotationSnapshot,
    documentId,
    execSql,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
    localVersionVector,
    minLsn: lastCommitLsn ?? undefined,
    onSyncTrace: (line) => runtime.util.log(`Container contents: ${line}`),
    onTerminalSubmitFailure: (failure) =>
      recordDocumentSyncFailure(execSql, metadataScope, {
        attemptedAt: new Date().toISOString(),
        message: describeDocumentSyncSubmitFailure(failure),
        status: failure.status,
      }),
    pendingUpdates,
    persistedState,
    rekeyPendingUpdate,
    resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Container contents",
      runtime,
      writerKeyLabel: "metadata writer key",
    }),
    targetSecretKey,
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
    writerProjection,
  }).catch((error: unknown) => {
    if (isStaleContainerMetadataSecurityStateError(error)) {
      runtime.util.log(
        `Container contents: deferred metadata sync for ${containerId} because its content-key targets are stale.`,
      );
      return null;
    }

    // A cold principal-policy cache is transient: warming already ran and
    // failed within this attempt, and a null return leaves the container's
    // needing-sync/read state unsettled, so the next lane trigger retries it.
    // Deferring per container keeps one cold policy from failing the whole
    // structural pass (and from counting as a lane failure).
    if (isPrincipalPolicyNotCachedError(error)) {
      runtime.util.log(
        `Container contents: deferred metadata sync for ${containerId} because a referenced principal policy is not cached yet.`,
      );
      return null;
    }

    throw error;
  });
  if (!synced) {
    return null;
  }

  // The pass submitted successfully, so any recorded terminal failure for this
  // container's metadata document no longer describes reality — unless the
  // pass itself just recorded one for re-key-exhausted updates.
  if (synced.exhaustedPendingUpdateCount === 0) {
    await clearDocumentSyncFailure(execSql, metadataScope);
  }

  return {
    outgoingUpdateCount: pendingUpdates.length,
    synced,
  };
}

function documentWriterProjectionMatchesMetadataSyncResponse(
  writerProjection: DocumentWriterProjectionResponse,
  synced: ContainerMetadataSyncAttempt["synced"],
): boolean {
  return (
    writerProjection.contentKeyBundle.contentKeyEpoch ===
      synced.response.contentKeyBundle.contentKeyEpoch &&
    writerProjection.contentKeyBundle.linkSetManifestHash ===
      synced.response.contentKeyBundle.linkSetManifestHash &&
    writerProjection.contentKeyBundle.targetHash ===
      synced.response.contentKeyBundle.targetHash &&
    writerProjection.documentKekTargets.linkSetManifestHash ===
      synced.response.documentKekTargets.linkSetManifestHash &&
    writerProjection.documentKekTargets.documentKeyTargetHash ===
      synced.response.documentKekTargets.documentKeyTargetHash
  );
}

function resolveSyncedContainerMetadataWriterProjection(
  metadataState: ContainerMetadataState,
  synced: ContainerMetadataSyncAttempt["synced"],
): DocumentWriterProjectionResponse | null {
  const writerProjection =
    synced.writerProjection ??
    (metadataState.metadataWriterProjection?.documentId ===
    synced.plan.documentId
      ? metadataState.metadataWriterProjection
      : null);
  return writerProjection &&
    documentWriterProjectionMatchesMetadataSyncResponse(
      writerProjection,
      synced,
    )
    ? writerProjection
    : null;
}

/**
 * Heals a stale metadata content-key bundle by rotating to a fresh content
 * key anchored by this full-history snapshot.
 */
function metadataRotationSnapshotProvider(
  metadataState: ContainerMetadataState,
): () => Promise<Uint8Array | null> {
  return async () => exportFullHistorySnapshot(metadataState.doc);
}

export async function syncContainerMetadataState(input: {
  forceReadSync?: boolean | undefined;
  /**
   * Self-echo registry shared with {@link listContainerMetadataDocumentUpdateIds}:
   * update ids this pass is about to send are registered BEFORE the network
   * await so the author's own `document_update_created` echo — which can land
   * before the response is processed — is classified as self-authored and never
   * arms a redundant forced read-sync.
   */
  locallyAcceptedUpdateIds?: Set<string> | undefined;
  metadataState: ContainerMetadataState;
  persistence: ContainerContentsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<SyncedContainerMetadataState | null> {
  const {
    metadataState,
    persistence,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  } = input;
  const { documentId } = metadataState.record;
  if (!documentId) {
    return null;
  }
  const execSql = runtime.infra.execSql;

  const pendingUpdates = await persistence.listPendingUpdates(
    execSql,
    metadataState.container.id,
  );
  if (
    pendingUpdates.length === 0 &&
    !input.forceReadSync &&
    hasCurrentContainerMetadataReadState(metadataState.record)
  ) {
    return null;
  }

  // Pre-register the ids we are about to send so the author's own echo is
  // classified as self-authored even when it beats the response processing.
  // Mirrors the document store lane (stores/documents/documentStore/sync.ts).
  const sentUpdateIds = pendingUpdates.map((pendingUpdate) => pendingUpdate.id);
  for (const sentUpdateId of sentUpdateIds) {
    input.locallyAcceptedUpdateIds?.add(sentUpdateId);
  }

  const syncAttempt = await syncRemoteContainerMetadata({
    buildRotationSnapshot: metadataRotationSnapshotProvider(metadataState),
    containerId: metadataState.container.id,
    documentId,
    lastCommitLsn: metadataState.record.lastCommitLsn,
    localVersionVector: encodeVersionVector(metadataState.doc),
    pendingUpdates,
    persistedState: metadataState.record,
    rekeyPendingUpdate: persistence.rekeyPendingUpdate,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
    writerProjection:
      metadataState.metadataWriterProjection?.documentId === documentId
        ? metadataState.metadataWriterProjection
        : undefined,
  });
  if (!syncAttempt) {
    return null;
  }

  const { outgoingUpdateCount, synced } = syncAttempt;
  // Reconcile the pre-registered ids against what the server actually accepted:
  // an id we sent but the server did not accept will never be echoed, so drop
  // it to keep the registry from leaking. Accepted ids stay registered until
  // their echo consumes them.
  if (input.locallyAcceptedUpdateIds) {
    const acceptedOutgoing = new Set(synced.response.acceptedOutgoingUpdateIds);
    for (const sentUpdateId of sentUpdateIds) {
      if (!acceptedOutgoing.has(sentUpdateId)) {
        input.locallyAcceptedUpdateIds.delete(sentUpdateId);
      }
    }
  }
  metadataState.metadataWriterProjection =
    resolveSyncedContainerMetadataWriterProjection(metadataState, synced);
  if (synced.decryptedUpdates.length > 0) {
    importUpdates(
      metadataState.doc,
      synced.decryptedUpdates.map((update) => update.updateData),
    );
  }

  const persisted = await persistContainerMetadataStateFromRuntime({
    acceptedPendingUpdateIds: synced.settledPendingUpdateIds,
    metadataState,
    patch: {
      ...synced.persistedState,
      documentId,
      lastCommitLsn:
        synced.response.commitLsn ?? metadataState.record.lastCommitLsn ?? null,
      metadataDocumentId: documentId,
    },
    persistence,
    runtime,
    saveOptions:
      outgoingUpdateCount === 0
        ? createReadOnlyMetadataSyncSaveOptions()
        : undefined,
  });

  return {
    ...persisted,
    shouldRequestFollowupSync: settleOutgoingPassAndDecideReArm(metadataState, {
      outgoingUpdateCount,
      rekeyedUpdateCount: synced.rekeyedPendingUpdateIds.length,
      settledUpdateCount: synced.settledPendingUpdateIds.length,
    }),
  };
}
