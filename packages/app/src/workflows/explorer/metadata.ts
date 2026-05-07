import { bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates } from "@tearleads/loro";
import {
  type ContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
} from "../../data/containers";
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

type ExplorerMetadataSyncApi = Parameters<
  typeof syncRemoteDocument
>[0]["apiClient"] &
  Parameters<
    typeof createDocumentWriterPublicKeyResolver
  >[0]["runtime"]["apiClient"];

interface ExplorerMetadataSyncRuntime {
  apiClient: ExplorerMetadataSyncApi;
  execSql: ExecSql;
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

type ExplorerMetadataSyncResult = NonNullable<
  Awaited<ReturnType<typeof syncRemoteDocument>>
>;

export interface ExplorerMetadataSyncAttempt {
  outgoingUpdateCount: number;
  synced: ExplorerMetadataSyncResult;
}

interface ExplorerContainerMetadataState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  record: DocumentRecord;
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

export async function persistExplorerContainerMetadataState(input: {
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

export async function syncRemoteExplorerContainerMetadata(input: {
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
    execSql: runtime.execSql,
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
