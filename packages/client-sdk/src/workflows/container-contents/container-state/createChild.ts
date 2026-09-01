import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlSchema";
import { deriveStableUuidV4Shaped } from "../../../data/stableUuid";
import type {
  ContainerContentsPersistence,
  ContainerDocumentRecord as DocumentRecord,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { CONTAINER_ALREADY_COMMITTED } from "./createWithMetadata";
import { loadContainerWriterProjectionForState } from "./projectionCache";
import { createRemoteContainer } from "./remote";
import type {
  ContainerMetadataDocumentState,
  ContainerWorkflowRuntime,
  CreatedChildContainerState,
} from "./types";

const SYSTEM_CONTAINER_ID_NAMESPACE_BYTES = new Uint8Array([
  0xc5, 0x5e, 0x8f, 0x2e, 0x3d, 0x82, 0x4b, 0x4d, 0x8d, 0xbd, 0x0d, 0xd2, 0xd3,
  0x60, 0xb3, 0x6d,
]);

/**
 * Derives a stable, UUID-shaped container id for a built-in system slot.
 *
 * The namespace digest makes each slot idempotent across stale store snapshots.
 * The UUID version and variant bits are normalized to a v4 shape because remote
 * container APIs currently validate container ids with the same v4 UUID contract
 * they use for random user-created containers.
 */
function deriveSystemContainerId(input: {
  parentContainerId: string;
  systemSlot: ContainerSystemSlot;
}): Promise<string> {
  return deriveStableUuidV4Shaped(
    SYSTEM_CONTAINER_ID_NAMESPACE_BYTES,
    `${input.parentContainerId}\u0000${input.systemSlot}`,
  );
}

async function createChildContainerId(
  parentContainerId: string,
  systemSlot: ContainerSystemSlot | null | undefined,
): Promise<string> {
  return systemSlot
    ? deriveSystemContainerId({ parentContainerId, systemSlot })
    : crypto.randomUUID();
}

async function buildRemoteContainerContentsChildContainerState(input: {
  childId: string;
  icon: string | null;
  systemSlot?: ContainerSystemSlot | null | undefined;
  doc: ContainerMetadataDocumentState;
  initialRecord: DocumentRecord;
  parentState: ContainerState;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
  trimmedName: string;
}): Promise<ContainerState | null> {
  const {
    childId,
    icon,
    systemSlot,
    doc,
    initialRecord,
    parentState,
    resolveProjectionUserKey,
    runtime,
    stillCurrent,
    trimmedName,
  } = input;
  const parentProjection = await loadContainerWriterProjectionForState({
    containerState: parentState,
    runtime,
  });
  if (!parentProjection) {
    return null;
  }

  const created = await createRemoteContainer({
    systemSlot,
    containerId: childId,
    parentContainerId: parentState.container.id,
    parentProjection,
    resolveProjectionUserKey,
    runtime,
    stillCurrent,
  });

  if (!created || created === CONTAINER_ALREADY_COMMITTED) {
    // A benign manifest-exists conflict means the container is already committed
    // remotely (a lost create response). This eager path cannot rebuild its
    // committed metadata state, so leave the create intent to reconcile it via
    // hydration rather than fabricating a local record from a missing response.
    return null;
  }

  return {
    container: {
      id: created.containerId,
      // The creator owns a newly-created container until the server reconciles.
      effectiveAccessLevel: "admin",
      organizationId: created.organizationId,
      parentId: created.parentId,
      metadataDocumentId: created.metadataDocumentId,
      systemSlot: created.systemSlot ?? systemSlot ?? null,
      name: trimmedName,
      icon,
      createdAt: created.createdAt,
      serverCreatedAt: created.createdAt,
      serverUpdatedAt: created.updatedAt,
      updatedAt: created.updatedAt,
    },
    doc,
    record: {
      ...initialRecord,
      accessEpoch: 1,
      accessStateHash: created.accessManifestHash,
      ...created.persistedMetadataState,
    },
  };
}

function buildLocalContainerContentsChildContainerState(input: {
  childId: string;
  icon: string | null;
  systemSlot?: ContainerSystemSlot | null | undefined;
  doc: ContainerMetadataDocumentState;
  initialRecord: DocumentRecord;
  parentState: ContainerState;
  trimmedName: string;
}): ContainerState {
  const {
    systemSlot,
    childId,
    doc,
    icon,
    initialRecord,
    parentState,
    trimmedName,
  } = input;

  return {
    container: {
      id: childId,
      effectiveAccessLevel: "admin",
      organizationId: parentState.container.organizationId,
      parentId: parentState.container.id,
      metadataDocumentId: null,
      systemSlot: systemSlot ?? null,
      name: trimmedName,
      icon,
    },
    doc,
    record: initialRecord,
  };
}

function createInitialChildContainerDocumentRecord(input: {
  childId: string;
  initialUpdate: Uint8Array;
}): DocumentRecord {
  return {
    accessEpoch: 1,
    accessStateHash: null,
    contentKeyBundle: null,
    documentId: null,
    documentKekTargets: null,
    documentManifestBundle: null,
    id: input.childId,
    lastCommitLsn: null,
    metadataUpdates: bytesToBase64(input.initialUpdate),
    snapshotEndVersion: "",
  };
}

async function persistCreatedChildContainer(input: {
  containerState: ContainerState;
  initialUpdate: Uint8Array;
  persistence: ContainerContentsPersistence;
  queueRemoteSync: boolean;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<boolean | null> {
  const { containerState, persistence, queueRemoteSync, runtime } = input;
  const createIntent =
    queueRemoteSync &&
    !containerState.record.documentId &&
    containerState.container.parentId
      ? { parentContainerId: containerState.container.parentId }
      : undefined;
  const shouldRequestSync =
    queueRemoteSync &&
    (!containerState.record.documentId ||
      Boolean(containerState.record.contentKeyBundle));
  const saveOptions =
    createIntent || input.stillCurrent
      ? {
          ...(createIntent ? { createIntent } : {}),
          stillCurrent: input.stillCurrent,
        }
      : undefined;
  const pendingUpdate = shouldRequestSync
    ? createPendingUpdateFields(input.initialUpdate)
    : null;
  if (pendingUpdate && persistence.saveContainerWithPendingUpdate) {
    containerState.container = await persistence.saveContainerWithPendingUpdate(
      runtime.infra.execSql,
      containerState.container,
      containerState.record,
      { ...saveOptions, pendingUpdate },
    );
  } else if (pendingUpdate) {
    const outcome = await runSerializedSqlMutation(
      runtime.infra.execSql,
      (lockedExecSql) =>
        getClientSQLitePersistenceRuntime(lockedExecSql).guardedTransaction(
          async () => {
            if (input.stillCurrent?.() === false) {
              return containerState.container;
            }
            const { stillCurrent: _outerGuard, ...legacySaveOptions } =
              saveOptions ?? {};
            const savedContainer = await persistence.saveContainer(
              lockedExecSql,
              containerState.container,
              containerState.record,
              legacySaveOptions,
            );
            if (input.stillCurrent?.() === false) return savedContainer;
            await persistence.enqueuePendingUpdate(lockedExecSql, {
              containerId: savedContainer.id,
              ...pendingUpdate,
            });
            return savedContainer;
          },
          () => input.stillCurrent?.() !== false,
          { behavior: "immediate" },
        ),
    );
    if (!outcome.committed || !outcome.result) return null;
    containerState.container = outcome.result;
  } else {
    containerState.container = await persistence.saveContainer(
      runtime.infra.execSql,
      containerState.container,
      containerState.record,
      saveOptions,
    );
  }
  return input.stillCurrent?.() === false ? null : shouldRequestSync;
}

export async function createChildContainerState(input: {
  systemSlot?: ContainerSystemSlot | null | undefined;
  createRemote: boolean;
  icon?: string | null | undefined;
  name: string;
  parentState: ContainerState;
  persistence: ContainerContentsPersistence;
  queueRemoteSync?: boolean | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<CreatedChildContainerState | null> {
  const {
    createRemote,
    systemSlot,
    name,
    parentState,
    persistence,
    queueRemoteSync = true,
    resolveProjectionUserKey,
    runtime,
  } = input;
  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }

  const icon = input.icon?.trim() || null;
  const childId = await createChildContainerId(
    parentState.container.id,
    systemSlot,
  );
  const { doc, initialUpdate } =
    await createInitializedContainerMetadataDocument(childId, {
      icon,
      name: trimmedName,
    });
  const initialRecord = createInitialChildContainerDocumentRecord({
    childId,
    initialUpdate,
  });
  if (input.stillCurrent?.() === false) return null;

  const remoteChildState = createRemote
    ? await buildRemoteContainerContentsChildContainerState({
        childId,
        icon,
        systemSlot,
        doc,
        initialRecord,
        parentState,
        resolveProjectionUserKey,
        runtime,
        stillCurrent: input.stillCurrent,
        trimmedName,
      })
    : null;
  const containerState =
    remoteChildState ??
    buildLocalContainerContentsChildContainerState({
      childId,
      icon,
      systemSlot,
      doc,
      initialRecord,
      parentState,
      trimmedName,
    });
  const shouldRequestSync = await persistCreatedChildContainer({
    containerState,
    initialUpdate,
    persistence,
    queueRemoteSync,
    runtime,
    stillCurrent: input.stillCurrent,
  });
  if (shouldRequestSync === null) return null;

  return {
    containerState,
    initialUpdate,
    shouldRequestSync,
  };
}
