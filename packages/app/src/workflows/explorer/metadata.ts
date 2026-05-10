import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
} from "@tearleads/loro";
import {
  type ContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { ExplorerPersistence } from "../../data/persistence/explorer/explorerPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createDocumentWriterPublicKeyResolver,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../documents";
import {
  enqueuePendingExplorerContainerUpdate,
  listPendingExplorerContainerUpdates,
} from "./containerPersistence";
import {
  type ExplorerWorkflowSqlRuntime,
  getExplorerWorkflowRuntimeExecSql,
} from "./runtime";

type ExplorerMetadataSyncApi = Parameters<
  typeof syncRemoteDocument
>[0]["apiClient"] &
  Parameters<
    typeof createDocumentWriterPublicKeyResolver
  >[0]["runtime"]["apiClient"];

interface ExplorerMetadataSyncRuntime extends ExplorerWorkflowSqlRuntime {
  apiClient: ExplorerMetadataSyncApi;
  log: (message: string) => void;
  organizationId?: string | null;
  signingFingerprint?: string | null;
  signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
        signingPublicKey: Uint8Array;
      }
    | null
    | undefined;
  userId?: string | null;
}

type ExplorerMetadataPersistenceRuntime = ExplorerWorkflowSqlRuntime;

type ExplorerMetadataSyncResult = NonNullable<
  Awaited<ReturnType<typeof syncRemoteDocument>>
>;

interface ExplorerMetadataSyncAttempt {
  outgoingUpdateCount: number;
  synced: ExplorerMetadataSyncResult;
}

interface ExplorerContainerMetadataState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  record: DocumentRecord;
}

export function hasExplorerMetadataDocumentUpdateEvent(
  events: ReadonlyArray<unknown>,
  metadataStates: Iterable<{ record: Pick<DocumentRecord, "documentId"> }>,
): boolean {
  const eventDocumentIds = new Set<string>();
  for (const event of events) {
    if (isDocumentUpdateCreatedEvent(event)) {
      eventDocumentIds.add(event.documentId);
    }
  }

  if (eventDocumentIds.size === 0) {
    return false;
  }

  for (const metadataState of metadataStates) {
    if (
      typeof metadataState.record.documentId === "string" &&
      eventDocumentIds.has(metadataState.record.documentId)
    ) {
      return true;
    }
  }

  return false;
}

export interface ExplorerContainerMetadataPatch {
  accessEpoch: number;
  accessStateHash: string | null;
  documentId: string | null;
  icon: string | null;
  lastCommitLsn: string | null;
  metadataDocumentId: string | null;
  loroSnapshot: string;
  name: string;
  organizationId: string;
  parentId: string | null;
  contentKeyBundle: string | null;
  documentKekTargets: string | null;
  documentManifestBundle: string | null;
}

interface PersistedExplorerContainerMetadataState {
  container: ContainerRecord;
  record: DocumentRecord;
}

interface SyncedExplorerContainerMetadataState
  extends PersistedExplorerContainerMetadataState {
  shouldRequestFollowupSync: boolean;
}

type NullableExplorerDocumentField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";

function isStaleExplorerMetadataSecurityStateError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "Document content key could not be unwrapped" ||
      error.message === "Document sync target hash mismatch" ||
      error.message === "Document sync content-key targets mismatch")
  );
}

function resolveNullableExplorerDocumentField(
  patch: Partial<ExplorerContainerMetadataPatch>,
  key: NullableExplorerDocumentField,
  currentValue: string | null | undefined,
  resetWhenUnpatched = false,
): string | null {
  if (Object.hasOwn(patch, key)) {
    return patch[key] ?? null;
  }

  return resetWhenUnpatched ? null : (currentValue ?? null);
}

async function persistExplorerContainerMetadataState(input: {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  execSql: ExecSql;
  metadataState: ExplorerContainerMetadataState;
  patch?: Partial<ExplorerContainerMetadataPatch> | undefined;
  persistence: ExplorerPersistence;
}): Promise<PersistedExplorerContainerMetadataState> {
  const { acceptedPendingUpdateIds, execSql, metadataState, persistence } =
    input;
  const patch = input.patch ?? {};
  const currentDocumentId = metadataState.record.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const documentIdChanged = nextDocumentId !== currentDocumentId;
  const nextAccessEpoch = patch.accessEpoch ?? metadataState.record.accessEpoch;
  const securityContextChanged =
    documentIdChanged || nextAccessEpoch !== metadataState.record.accessEpoch;
  const metadata = readContainerMetadataValue(
    metadataState.doc,
    getDefaultContainerName(metadataState.container.parentId),
  );
  const nextContainer: ContainerRecord = {
    ...metadataState.container,
    organizationId:
      patch.organizationId ?? metadataState.container.organizationId,
    parentId: patch.parentId ?? metadataState.container.parentId,
    metadataDocumentId:
      patch.metadataDocumentId ??
      patch.documentId ??
      metadataState.container.metadataDocumentId,
    name: patch.name ?? metadata.name,
    icon: patch.icon ?? metadata.icon,
  };
  const nextRecord: DocumentRecord = {
    id: metadataState.container.id,
    documentId: nextDocumentId,
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(metadataState.doc)),
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolveNullableExplorerDocumentField(
      patch,
      "accessStateHash",
      metadataState.record.accessStateHash,
      securityContextChanged,
    ),
    lastCommitLsn: resolveNullableExplorerDocumentField(
      patch,
      "lastCommitLsn",
      metadataState.record.lastCommitLsn,
      documentIdChanged,
    ),
    contentKeyBundle: resolveNullableExplorerDocumentField(
      patch,
      "contentKeyBundle",
      metadataState.record.contentKeyBundle,
      securityContextChanged,
    ),
    documentKekTargets: resolveNullableExplorerDocumentField(
      patch,
      "documentKekTargets",
      metadataState.record.documentKekTargets,
      securityContextChanged,
    ),
    documentManifestBundle: resolveNullableExplorerDocumentField(
      patch,
      "documentManifestBundle",
      metadataState.record.documentManifestBundle,
      securityContextChanged,
    ),
  };

  if (acceptedPendingUpdateIds && acceptedPendingUpdateIds.length > 0) {
    await persistence.saveContainerAndDeletePendingUpdates(
      execSql,
      nextContainer,
      nextRecord,
      acceptedPendingUpdateIds,
    );
  } else {
    await persistence.saveContainer(execSql, nextContainer, nextRecord);
  }

  return {
    container: nextContainer,
    record: nextRecord,
  };
}

export async function persistExplorerContainerMetadataStateFromRuntime({
  runtime,
  ...input
}: Omit<
  Parameters<typeof persistExplorerContainerMetadataState>[0],
  "execSql"
> & {
  persistence: ExplorerPersistence;
  runtime: ExplorerMetadataPersistenceRuntime;
}): ReturnType<typeof persistExplorerContainerMetadataState> {
  const execSql = getExplorerWorkflowRuntimeExecSql(runtime);
  return persistExplorerContainerMetadataState({
    ...input,
    execSql,
  });
}

async function renameExplorerContainerMetadataState(input: {
  execSql: ExecSql;
  metadataState: ExplorerContainerMetadataState;
  name: string;
  persistence: ExplorerPersistence;
}): Promise<PersistedExplorerContainerMetadataState | null> {
  const { execSql, metadataState, persistence } = input;
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return null;
  }

  const metadata = readContainerMetadataValue(
    metadataState.doc,
    getDefaultContainerName(metadataState.container.parentId),
  );
  const previousVersion = encodeVersionVector(metadataState.doc);
  writeContainerMetadataValue(metadataState.doc, {
    ...metadata,
    name: trimmedName,
  });
  const update = exportUpdatesSince(metadataState.doc, previousVersion);

  await enqueuePendingExplorerContainerUpdate(execSql, persistence, {
    containerId: metadataState.container.id,
    update,
  });

  return persistExplorerContainerMetadataState({
    execSql,
    metadataState,
    patch: { name: trimmedName },
    persistence,
  });
}

export async function renameExplorerContainerMetadataStateFromRuntime({
  runtime,
  ...input
}: Omit<
  Parameters<typeof renameExplorerContainerMetadataState>[0],
  "execSql"
> & {
  persistence: ExplorerPersistence;
  runtime: ExplorerMetadataPersistenceRuntime;
}): ReturnType<typeof renameExplorerContainerMetadataState> {
  const execSql = getExplorerWorkflowRuntimeExecSql(runtime);
  return renameExplorerContainerMetadataState({
    ...input,
    execSql,
  });
}

async function syncRemoteExplorerContainerMetadata(input: {
  containerId: string;
  documentId: string | null;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  pendingUpdates: readonly PendingUpdateRecord[];
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<ExplorerMetadataSyncAttempt | null> {
  const {
    containerId,
    documentId,
    lastCommitLsn,
    localVersionVector,
    pendingUpdates,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  } = input;
  const execSql = getExplorerWorkflowRuntimeExecSql(runtime);

  if (!documentId) {
    return null;
  }

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.log(
      "Explorer: skipped metadata sync because the writer context is unavailable.",
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
    resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      includeLocalSigningKey: false,
      logPrefix: "Explorer",
      runtime,
      writerKeyLabel: "metadata writer key",
    }),
    targetSecretKey,
  }).catch((error: unknown) => {
    if (isStaleExplorerMetadataSecurityStateError(error)) {
      runtime.log(
        `Explorer: deferred metadata sync for ${containerId} because its content-key targets are stale.`,
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

export async function syncExplorerContainerMetadataState(input: {
  metadataState: ExplorerContainerMetadataState;
  persistence: ExplorerPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<SyncedExplorerContainerMetadataState | null> {
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
  const execSql = getExplorerWorkflowRuntimeExecSql(runtime);

  const pendingUpdates = await listPendingExplorerContainerUpdates(
    execSql,
    persistence,
    metadataState.container.id,
  );
  const syncAttempt = await syncRemoteExplorerContainerMetadata({
    containerId: metadataState.container.id,
    documentId,
    lastCommitLsn: metadataState.record.lastCommitLsn,
    localVersionVector: encodeVersionVector(metadataState.doc),
    pendingUpdates,
    resolveProjectionUserKey,
    runtime,
    targetSecretKey,
  });
  if (!syncAttempt) {
    return null;
  }

  const { outgoingUpdateCount, synced } = syncAttempt;
  if (synced.decryptedUpdates.length > 0) {
    importUpdates(
      metadataState.doc,
      synced.decryptedUpdates.map((update) => update.updateData),
    );
  }

  const persisted = await persistExplorerContainerMetadataStateFromRuntime({
    acceptedPendingUpdateIds: synced.response.acceptedOutgoingUpdateIds,
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
  });

  return {
    ...persisted,
    shouldRequestFollowupSync:
      outgoingUpdateCount > synced.response.acceptedOutgoingUpdateIds.length,
  };
}
