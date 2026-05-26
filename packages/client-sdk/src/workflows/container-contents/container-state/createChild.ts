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
import { createRemoteContainer } from "./remote";
import type {
  ContainerMetadataDocumentState,
  ContainerWorkflowRuntime,
  CreatedChildContainerState,
} from "./types";

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
  const created = await createRemoteContainer({
    systemSlot,
    containerId: childId,
    parentContainerId: parentState.container.id,
    resolveProjectionUserKey,
    runtime,
  });

  if (!created) {
    return null;
  }

  return {
    container: {
      id: created.containerId,
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

  const childId = crypto.randomUUID();
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
