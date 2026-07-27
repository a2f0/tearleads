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
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { ContainerDocumentRecord as DocumentRecord } from "./containerPersistence";
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

function invalidateMetadataWriterProjection(
  metadataState: ContainerMetadataState,
  securityContextChanged: boolean,
): void {
  if (securityContextChanged) {
    metadataState.metadataWriterProjection = null;
  }
}

function resolveMetadataSecurityContext(
  metadataState: ContainerMetadataState,
  patch: Partial<ContainerMetadataPatch>,
) {
  const currentDocumentId = metadataState.record.documentId ?? null;
  const documentId =
    patch.documentId !== undefined ? patch.documentId : currentDocumentId;
  const accessEpoch = patch.accessEpoch ?? metadataState.record.accessEpoch;
  const documentIdChanged = documentId !== currentDocumentId;

  return {
    accessEpoch,
    changed:
      documentIdChanged || accessEpoch !== metadataState.record.accessEpoch,
    documentId,
    documentIdChanged,
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
  const securityContext = resolveMetadataSecurityContext(metadataState, patch);
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
    // Distinguish "clear the icon" (patch.icon === null) from "icon not
    // patched" (undefined): `??` would collapse both to metadata.icon, so an
    // explicit null in a patch could never clear a previously set icon.
    icon: patch.icon !== undefined ? patch.icon : metadata.icon,
  };
  const nextRecord: DocumentRecord = {
    id: metadataState.container.id,
    documentId: securityContext.documentId,
    metadataUpdates:
      patch.metadataUpdates ??
      bytesToBase64(exportAllUpdates(metadataState.doc)),
    snapshotEndVersion: "",
    accessEpoch: securityContext.accessEpoch,
    accessStateHash: resolveNullableContainerMetadataDocumentField(
      patch,
      "accessStateHash",
      metadataState.record.accessStateHash,
      securityContext.changed,
    ),
    lastCommitLsn: resolveNullableContainerMetadataDocumentField(
      patch,
      "lastCommitLsn",
      metadataState.record.lastCommitLsn,
      securityContext.documentIdChanged,
    ),
    contentKeyBundle: resolveNullableContainerMetadataDocumentField(
      patch,
      "contentKeyBundle",
      metadataState.record.contentKeyBundle,
      securityContext.changed,
    ),
    documentKekTargets: resolveNullableContainerMetadataDocumentField(
      patch,
      "documentKekTargets",
      metadataState.record.documentKekTargets,
      securityContext.changed,
    ),
    documentManifestBundle: resolveNullableContainerMetadataDocumentField(
      patch,
      "documentManifestBundle",
      metadataState.record.documentManifestBundle,
      securityContext.changed,
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

  invalidateMetadataWriterProjection(metadataState, securityContext.changed);
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

async function setContainerIconMetadataState(input: {
  execSql: ExecSql;
  icon: string | null;
  metadataState: ContainerMetadataState;
  persistence: ContainerContentsPersistence;
}): Promise<PersistedContainerMetadataState> {
  const { execSql, icon, metadataState, persistence } = input;
  // Normalize to the same shape the metadata document stores: a trimmed,
  // non-empty slug or null (the default folder). writeContainerMetadataValue
  // deletes the icon key when null so it matches an unset legacy container.
  const normalizedIcon = icon?.trim() || null;

  const metadata = readContainerMetadataValue(
    metadataState.doc,
    getDefaultContainerName(metadataState.container.parentId),
  );
  const previousVersion = encodeVersionVector(metadataState.doc);
  writeContainerMetadataValue(metadataState.doc, {
    ...metadata,
    icon: normalizedIcon,
  });
  const update = exportUpdatesSince(metadataState.doc, previousVersion);

  await enqueuePendingContainerUpdate(execSql, persistence, {
    containerId: metadataState.container.id,
    update,
  });

  return persistContainerMetadataState({
    execSql,
    metadataState,
    patch: { icon: normalizedIcon },
    persistence,
  });
}

export async function setContainerIconMetadataStateFromRuntime({
  runtime,
  ...input
}: Omit<Parameters<typeof setContainerIconMetadataState>[0], "execSql"> & {
  persistence: ContainerContentsPersistence;
  runtime: ContainerMetadataPersistenceRuntime;
}): ReturnType<typeof setContainerIconMetadataState> {
  const execSql = runtime.infra.execSql;
  return setContainerIconMetadataState({
    ...input,
    execSql,
  });
}
