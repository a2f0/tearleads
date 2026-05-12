import { bytesToBase64 } from "@tearleads/encoding";
import { createInitializedContainerMetadataDocument } from "../../../data/containers";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { DocumentRecord } from "../../../data/sqlite/documentPersistence";
import {
  type ExplorerPersistence,
  saveExplorerContainer,
} from "../containerPersistence";
import type { ExplorerContainerState } from "../remoteHydration";
import { getExplorerWorkflowRuntimeExecSql } from "../runtime";
import { createRemoteExplorerContainer } from "./remote";
import type {
  CreatedExplorerChildContainer,
  ExplorerContainerMetadataDocument,
  ExplorerContainerWorkflowRuntime,
} from "./types";

async function buildRemoteExplorerChildContainerState(input: {
  childId: string;
  doc: ExplorerContainerMetadataDocument;
  initialRecord: DocumentRecord;
  parentState: ExplorerContainerState;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
  trimmedName: string;
}): Promise<ExplorerContainerState | null> {
  const {
    childId,
    doc,
    initialRecord,
    parentState,
    resolveProjectionUserKey,
    runtime,
    trimmedName,
  } = input;
  const created = await createRemoteExplorerContainer({
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

function buildLocalExplorerChildContainerState(input: {
  childId: string;
  doc: ExplorerContainerMetadataDocument;
  initialRecord: DocumentRecord;
  parentState: ExplorerContainerState;
  trimmedName: string;
}): ExplorerContainerState {
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

export async function createExplorerChildContainer(input: {
  createRemote: boolean;
  name: string;
  parentState: ExplorerContainerState;
  persistence: ExplorerPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<CreatedExplorerChildContainer | null> {
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
    ? await buildRemoteExplorerChildContainerState({
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
    buildLocalExplorerChildContainerState({
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
  const execSql = getExplorerWorkflowRuntimeExecSql(runtime);

  await saveExplorerContainer(
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
