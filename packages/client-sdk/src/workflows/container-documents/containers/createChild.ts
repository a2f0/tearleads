import { bytesToBase64 } from "@tearleads/encoding";
import { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { DocumentRecord } from "../../../data/sqlite/documentPersistence";
import {
  type ContainerDocumentsPersistence,
  saveContainer,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { getContainerDocumentsWorkflowRuntimeExecSql } from "../runtime";
import { createRemoteContainer } from "./remote";
import type {
  ContainerMetadataDocumentState,
  ContainerWorkflowRuntime,
  CreatedChildContainerState,
} from "./types";

async function buildRemoteContainerDocumentsChildContainerState(input: {
  childId: string;
  doc: ContainerMetadataDocumentState;
  initialRecord: DocumentRecord;
  parentState: ContainerState;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  trimmedName: string;
}): Promise<ContainerState | null> {
  const {
    childId,
    doc,
    initialRecord,
    parentState,
    resolveProjectionUserKey,
    runtime,
    trimmedName,
  } = input;
  const created = await createRemoteContainer({
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

function buildLocalContainerDocumentsChildContainerState(input: {
  childId: string;
  doc: ContainerMetadataDocumentState;
  initialRecord: DocumentRecord;
  parentState: ContainerState;
  trimmedName: string;
}): ContainerState {
  const { childId, doc, initialRecord, parentState, trimmedName } = input;

  return {
    container: {
      id: childId,
      organizationId: parentState.container.organizationId,
      parentId: parentState.container.id,
      metadataDocumentId: null,
      name: trimmedName,
      icon: null,
    },
    doc,
    record: initialRecord,
  };
}

export async function createChildContainerState(input: {
  createRemote: boolean;
  name: string;
  parentState: ContainerState;
  persistence: ContainerDocumentsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<CreatedChildContainerState | null> {
  const {
    createRemote,
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
    ? await buildRemoteContainerDocumentsChildContainerState({
        childId,
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
    buildLocalContainerDocumentsChildContainerState({
      childId,
      doc,
      initialRecord,
      parentState,
      trimmedName,
    });
  const createIntent =
    !containerState.record.documentId && containerState.container.parentId
      ? { parentContainerId: containerState.container.parentId }
      : undefined;
  const execSql = getContainerDocumentsWorkflowRuntimeExecSql(runtime);

  containerState.container = await saveContainer(
    execSql,
    persistence,
    containerState.container,
    containerState.record,
    createIntent ? { createIntent } : undefined,
  );

  return {
    containerState,
    initialUpdate,
    shouldEnqueueInitialUpdate:
      !containerState.record.documentId ||
      Boolean(containerState.record.contentKeyBundle),
  };
}
