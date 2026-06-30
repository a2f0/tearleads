import { encodeVersionVector, importUpdates } from "@tearleads/loro";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/sqlite/documentPersistence";
import { shouldReArmAfterOutgoingSettlement } from "../../data/sync/outgoingUpdateSettlement";
import {
  createDocumentWriterPublicKeyResolver,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../documents";
import {
  createReadOnlyMetadataSyncSaveOptions,
  hasCurrentContainerMetadataReadState,
  persistContainerMetadataStateFromRuntime,
} from "./metadataPersistence";

export {
  persistContainerMetadataStateFromRuntime,
  renameContainerMetadataStateFromRuntime,
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
  Parameters<
    typeof createDocumentWriterPublicKeyResolver
  >[0]["runtime"]["apiClient"];

interface ContainerMetadataSyncRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    "auth" | "crypto" | "infra" | "state" | "util"
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
): boolean {
  return (
    listContainerMetadataDocumentUpdateIds(events, metadataStates).length > 0
  );
}

export function listContainerMetadataDocumentUpdateIds(
  events: ReadonlyArray<unknown>,
  metadataStates: Iterable<{ record: Pick<DocumentRecord, "documentId"> }>,
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
      isDocumentUpdateCreatedEvent(event) &&
      metadataDocumentIds.has(event.documentId)
    ) {
      eventDocumentIds.add(event.documentId);
    }
  }

  return Array.from(eventDocumentIds);
}

function isStaleContainerMetadataSecurityStateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";

  return (
    message.startsWith(
      "Document authorizing container KEK path could not be unwrapped",
    ) ||
    message.startsWith("Document content key could not be unwrapped") ||
    message === "Document sync target hash mismatch" ||
    message === "Document sync content-key targets mismatch"
  );
}

async function syncRemoteContainerMetadata(input: {
  containerId: string;
  documentId: string | null;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  pendingUpdates: readonly PendingUpdateRecord[];
  persistedState?: DocumentRecord | null | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}): Promise<ContainerMetadataSyncAttempt | null> {
  const {
    containerId,
    documentId,
    lastCommitLsn,
    localVersionVector,
    pendingUpdates,
    persistedState,
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

  const synced = await syncRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    documentId,
    execSql,
    localVersionVector,
    minLsn: lastCommitLsn ?? undefined,
    pendingUpdates,
    persistedState,
    resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      includeLocalSigningKey: false,
      logPrefix: "Container contents",
      runtime,
      writerKeyLabel: "metadata writer key",
    }),
    targetSecretKey,
    writerProjection,
  }).catch((error: unknown) => {
    if (isStaleContainerMetadataSecurityStateError(error)) {
      runtime.util.log(
        `Container contents: deferred metadata sync for ${containerId} because its content-key targets are stale.`,
      );
      return null;
    }

    throw error;
  });
  if (!synced) {
    return null;
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

export async function syncContainerMetadataState(input: {
  forceReadSync?: boolean | undefined;
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

  const syncAttempt = await syncRemoteContainerMetadata({
    containerId: metadataState.container.id,
    documentId,
    lastCommitLsn: metadataState.record.lastCommitLsn,
    localVersionVector: encodeVersionVector(metadataState.doc),
    pendingUpdates,
    persistedState: metadataState.record,
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
    shouldRequestFollowupSync: shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount,
      settledUpdateCount: synced.settledPendingUpdateIds.length,
    }),
  };
}
