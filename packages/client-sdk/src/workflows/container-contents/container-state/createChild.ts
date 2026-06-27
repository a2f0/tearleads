import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { DocumentRecord } from "../../../data/sqlite/documentPersistence";
import {
  type ContainerContentsPersistence,
  enqueuePendingContainerUpdate,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
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
const TEXT_ENCODER = new TextEncoder();

function concatenateBytes(left: Uint8Array, right: Uint8Array) {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(left, 0);
  bytes.set(right, left.byteLength);
  return bytes;
}

function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, byteToHex).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toUuidV4ShapedBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice(0, 16).map((byte, index) => {
    if (index === 6) {
      return (byte & 0x0f) | 0x40;
    }

    if (index === 8) {
      return (byte & 0x3f) | 0x80;
    }

    return byte;
  });
}

/**
 * Derives a stable, UUID-shaped container id for a built-in system slot.
 *
 * The namespace digest makes each slot idempotent across stale store snapshots.
 * The UUID version and variant bits are normalized to a v4 shape because remote
 * container APIs currently validate container ids with the same v4 UUID contract
 * they use for random user-created containers.
 */
async function deriveSystemContainerId(
  systemSlot: ContainerSystemSlot,
): Promise<string> {
  const slotBytes = TEXT_ENCODER.encode(systemSlot);
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-1",
      concatenateBytes(SYSTEM_CONTAINER_ID_NAMESPACE_BYTES, slotBytes),
    ),
  );
  return formatUuid(toUuidV4ShapedBytes(digest));
}

async function createChildContainerId(
  systemSlot: ContainerSystemSlot | null | undefined,
): Promise<string> {
  return systemSlot ? deriveSystemContainerId(systemSlot) : crypto.randomUUID();
}

async function buildRemoteContainerContentsChildContainerState(input: {
  childId: string;
  systemSlot?: ContainerSystemSlot | null | undefined;
  doc: ContainerMetadataDocumentState;
  initialRecord: DocumentRecord;
  parentState: ContainerState;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  trimmedName: string;
}): Promise<ContainerState | null> {
  const {
    childId,
    systemSlot,
    doc,
    initialRecord,
    parentState,
    resolveProjectionUserKey,
    runtime,
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
  });

  if (!created) {
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
      icon: null,
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
  systemSlot?: ContainerSystemSlot | null | undefined;
  doc: ContainerMetadataDocumentState;
  initialRecord: DocumentRecord;
  parentState: ContainerState;
  trimmedName: string;
}): ContainerState {
  const { systemSlot, childId, doc, initialRecord, parentState, trimmedName } =
    input;

  return {
    container: {
      id: childId,
      effectiveAccessLevel: "admin",
      organizationId: parentState.container.organizationId,
      parentId: parentState.container.id,
      metadataDocumentId: null,
      systemSlot: systemSlot ?? null,
      name: trimmedName,
      icon: null,
    },
    doc,
    record: initialRecord,
  };
}

export async function createChildContainerState(input: {
  systemSlot?: ContainerSystemSlot | null | undefined;
  createRemote: boolean;
  name: string;
  parentState: ContainerState;
  persistence: ContainerContentsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<CreatedChildContainerState | null> {
  const {
    createRemote,
    systemSlot,
    name,
    parentState,
    persistence,
    resolveProjectionUserKey,
    runtime,
  } = input;
  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }

  const childId = await createChildContainerId(systemSlot);
  const { doc, initialUpdate } =
    await createInitializedContainerMetadataDocument(childId, {
      icon: null,
      name: trimmedName,
    });
  const initialRecord: DocumentRecord = {
    accessEpoch: 1,
    accessStateHash: null,
    contentKeyBundle: null,
    documentId: null,
    documentKekTargets: null,
    documentManifestBundle: null,
    id: childId,
    lastCommitLsn: null,
    loroSnapshot: bytesToBase64(initialUpdate),
  };

  const remoteChildState = createRemote
    ? await buildRemoteContainerContentsChildContainerState({
        childId,
        systemSlot,
        doc,
        initialRecord,
        parentState,
        resolveProjectionUserKey,
        runtime,
        trimmedName,
      })
    : null;
  const containerState =
    remoteChildState ??
    buildLocalContainerContentsChildContainerState({
      childId,
      systemSlot,
      doc,
      initialRecord,
      parentState,
      trimmedName,
    });
  const createIntent =
    !containerState.record.documentId && containerState.container.parentId
      ? { parentContainerId: containerState.container.parentId }
      : undefined;
  const execSql = runtime.infra.execSql;

  containerState.container = await persistence.saveContainer(
    execSql,
    containerState.container,
    containerState.record,
    createIntent ? { createIntent } : undefined,
  );

  const shouldRequestSync =
    !containerState.record.documentId ||
    Boolean(containerState.record.contentKeyBundle);
  if (shouldRequestSync) {
    await enqueuePendingContainerUpdate(execSql, persistence, {
      containerId: containerState.container.id,
      update: initialUpdate,
    });
  }

  return {
    containerState,
    initialUpdate,
    shouldRequestSync,
  };
}
