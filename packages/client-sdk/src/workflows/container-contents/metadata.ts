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
} from "../../data/containers/containerMetadataDocument";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
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
import { enqueuePendingContainerUpdate } from "./containerPersistence";
import type { ContainerContentsWorkflowSqlRuntime } from "./runtime";

type ContainerMetadataSyncApi = Parameters<
  typeof syncRemoteDocument
>[0]["apiClient"] &
  Parameters<
    typeof createDocumentWriterPublicKeyResolver
  >[0]["runtime"]["apiClient"];

interface ContainerMetadataSyncRuntime
  extends ContainerContentsWorkflowSqlRuntime {
  apiClient: ContainerMetadataSyncApi;
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

type ContainerMetadataPersistenceRuntime = ContainerContentsWorkflowSqlRuntime;

type ContainerMetadataSyncResult = NonNullable<
  Awaited<ReturnType<typeof syncRemoteDocument>>
>;

interface ContainerMetadataSyncAttempt {
  outgoingUpdateCount: number;
  synced: ContainerMetadataSyncResult;
}

interface ContainerMetadataState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  record: DocumentRecord;
}

export function hasContainerMetadataDocumentUpdateEvent(
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

export interface ContainerMetadataPatch {
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

interface PersistedContainerMetadataState {
  container: ContainerRecord;
  record: DocumentRecord;
}

interface SyncedContainerMetadataState extends PersistedContainerMetadataState {
  shouldRequestFollowupSync: boolean;
}

type NullableContainerMetadataDocumentField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";
type SaveContainerOptions = Parameters<
  ContainerContentsPersistence["saveContainer"]
>[3];

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

function resolveNullableContainerMetadataDocumentField(
  patch: Partial<ContainerMetadataPatch>,
  key: NullableContainerMetadataDocumentField,
  currentValue: string | null | undefined,
  resetWhenUnpatched = false,
): string | null {
  if (Object.hasOwn(patch, key)) {
    return patch[key] ?? null;
  }

  return resetWhenUnpatched ? null : (currentValue ?? null);
}

function savePersistedContainerMetadataState(input: {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  container: ContainerRecord;
  execSql: ExecSql;
  persistence: ContainerContentsPersistence;
  record: DocumentRecord;
  saveOptions?: SaveContainerOptions;
}): Promise<ContainerRecord> {
  if (input.acceptedPendingUpdateIds?.length) {
    return input.persistence.saveContainerAndDeletePendingUpdates(
      input.execSql,
      input.container,
      input.record,
      input.acceptedPendingUpdateIds,
    );
  }

  return input.persistence.saveContainer(
    input.execSql,
    input.container,
    input.record,
    input.saveOptions,
  );
}

function createReadOnlyMetadataSyncSaveOptions(): SaveContainerOptions {
  const syncTimestamp = new Date().toISOString();
  return {
    localUpdatedAt: syncTimestamp,
    serverTimestamps: { updatedAt: syncTimestamp },
  };
}

async function persistContainerMetadataState(input: {
  acceptedPendingUpdateIds?: readonly string[] | undefined;
  execSql: ExecSql;
  metadataState: ContainerMetadataState;
  patch?: Partial<ContainerMetadataPatch> | undefined;
  persistence: ContainerContentsPersistence;
  saveOptions?: SaveContainerOptions;
}): Promise<PersistedContainerMetadataState> {
  const {
    acceptedPendingUpdateIds,
    execSql,
    metadataState,
    persistence,
    saveOptions,
  } = input;
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
    accessStateHash: resolveNullableContainerMetadataDocumentField(
      patch,
      "accessStateHash",
      metadataState.record.accessStateHash,
      securityContextChanged,
    ),
    lastCommitLsn: resolveNullableContainerMetadataDocumentField(
      patch,
      "lastCommitLsn",
      metadataState.record.lastCommitLsn,
      documentIdChanged,
    ),
    contentKeyBundle: resolveNullableContainerMetadataDocumentField(
      patch,
      "contentKeyBundle",
      metadataState.record.contentKeyBundle,
      securityContextChanged,
    ),
    documentKekTargets: resolveNullableContainerMetadataDocumentField(
      patch,
      "documentKekTargets",
      metadataState.record.documentKekTargets,
      securityContextChanged,
    ),
    documentManifestBundle: resolveNullableContainerMetadataDocumentField(
      patch,
      "documentManifestBundle",
      metadataState.record.documentManifestBundle,
      securityContextChanged,
    ),
  };

  const persistedContainer = await savePersistedContainerMetadataState({
    acceptedPendingUpdateIds,
    container: nextContainer,
    execSql,
    persistence,
    record: nextRecord,
    saveOptions,
  });

  return {
    container: persistedContainer,
    record: nextRecord,
  };
}

export async function persistContainerMetadataStateFromRuntime({
  runtime,
  ...input
}: Omit<Parameters<typeof persistContainerMetadataState>[0], "execSql"> & {
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataPersistenceRuntime;
}): ReturnType<typeof persistContainerMetadataState> {
  const execSql = runtime.execSql;
  return persistContainerMetadataState({
    ...input,
    execSql,
  });
}

async function renameContainerMetadataState(input: {
  execSql: ExecSql;
  metadataState: ContainerMetadataState;
  name: string;
  persistence: ContainerContentsPersistence;
}): Promise<PersistedContainerMetadataState | null> {
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

  await enqueuePendingContainerUpdate(execSql, persistence, {
    containerId: metadataState.container.id,
    update,
  });

  return persistContainerMetadataState({
    execSql,
    metadataState,
    patch: { name: trimmedName },
    persistence,
  });
}

export async function renameContainerMetadataStateFromRuntime({
  runtime,
  ...input
}: Omit<Parameters<typeof renameContainerMetadataState>[0], "execSql"> & {
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataPersistenceRuntime;
}): ReturnType<typeof renameContainerMetadataState> {
  const execSql = runtime.execSql;
  return renameContainerMetadataState({
    ...input,
    execSql,
  });
}

async function syncRemoteContainerMetadata(input: {
  containerId: string;
  documentId: string | null;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  pendingUpdates: readonly PendingUpdateRecord[];
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
}): Promise<ContainerMetadataSyncAttempt | null> {
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
  const execSql = runtime.execSql;

  if (!documentId) {
    return null;
  }

  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.log(
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
    resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      includeLocalSigningKey: false,
      logPrefix: "Container contents",
      runtime,
      writerKeyLabel: "metadata writer key",
    }),
    targetSecretKey,
  }).catch((error: unknown) => {
    if (isStaleContainerMetadataSecurityStateError(error)) {
      runtime.log(
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

export async function syncContainerMetadataState(input: {
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
  const execSql = runtime.execSql;

  const pendingUpdates = await persistence.listPendingUpdates(
    execSql,
    metadataState.container.id,
  );
  const syncAttempt = await syncRemoteContainerMetadata({
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
    shouldRequestFollowupSync:
      outgoingUpdateCount > synced.settledPendingUpdateIds.length,
  };
}
