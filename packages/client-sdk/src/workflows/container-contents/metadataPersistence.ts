import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
} from "@tearleads/loro";
import {
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { enqueuePendingContainerUpdate } from "./containerPersistence";
import type {
  ContainerMetadataPatch,
  ContainerMetadataState,
  PersistedContainerMetadataState,
} from "./metadataTypes";
import type { ContainerContentsWorkflowSqlRuntime } from "./runtime";

type ContainerMetadataPersistenceRuntime = ContainerContentsWorkflowSqlRuntime;

type NullableContainerMetadataDocumentField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";
type SaveContainerOptions = Parameters<
  ContainerContentsPersistence["saveContainer"]
>[3];

function resolveContainerSystemSlot(
  patch: Partial<ContainerMetadataPatch>,
  container: ContainerRecord,
): NonNullable<ContainerRecord["systemSlot"]> | null {
  return patch.systemSlot ?? container.systemSlot ?? null;
}

function resolveMetadataDocumentId(
  patch: Partial<ContainerMetadataPatch>,
  container: ContainerRecord,
): ContainerRecord["metadataDocumentId"] {
  return (
    patch.metadataDocumentId ?? patch.documentId ?? container.metadataDocumentId
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

export function createReadOnlyMetadataSyncSaveOptions(): SaveContainerOptions {
  const syncTimestamp = new Date().toISOString();
  return {
    localUpdatedAt: syncTimestamp,
    serverTimestamps: { updatedAt: syncTimestamp },
  };
}

export function hasCurrentContainerMetadataReadState(
  record: Pick<
    DocumentRecord,
    | "contentKeyBundle"
    | "documentKekTargets"
    | "documentManifestBundle"
    | "lastCommitLsn"
  >,
): boolean {
  return (
    typeof record.lastCommitLsn === "string" &&
    record.lastCommitLsn.length > 0 &&
    typeof record.contentKeyBundle === "string" &&
    record.contentKeyBundle.length > 0 &&
    typeof record.documentKekTargets === "string" &&
    record.documentKekTargets.length > 0 &&
    typeof record.documentManifestBundle === "string" &&
    record.documentManifestBundle.length > 0
  );
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
    metadataDocumentId: resolveMetadataDocumentId(
      patch,
      metadataState.container,
    ),
    systemSlot: resolveContainerSystemSlot(patch, metadataState.container),
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
  const execSql = runtime.infra.execSql;
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
  const execSql = runtime.infra.execSql;
  return renameContainerMetadataState({
    ...input,
    execSql,
  });
}
