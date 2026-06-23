import { readLinkedContainerIdsFromDocumentManifest } from "../../data/documents/shared/projection";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  type RelinkRemoteDocumentResult,
  relinkRemoteDocument,
  resolveDocumentCreateAuthor,
} from "../documents";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

type ContainerDocumentLinkApi = Parameters<
  typeof relinkRemoteDocument
>[0]["apiClient"];
type ContainerDocumentPurgeApi = Pick<
  ContainerContentsWorkflowRuntime["apiClient"],
  "purgeDocument"
>;
type DocumentPurgeResult = Awaited<
  ReturnType<ContainerDocumentPurgeApi["purgeDocument"]>
>;
type ContainerDocumentLinkOperation = Parameters<
  typeof relinkRemoteDocument
>[0]["operation"];
type RemoteDocumentPersistedState =
  RelinkRemoteDocumentResult["persistedState"];

interface ContainerDocumentLinkRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    "auth" | "crypto" | "infra" | "state" | "util"
  > {
  apiClient: ContainerDocumentLinkApi;
}

type MoveRemoteContainerDocumentStatus = "complete" | "partial";

interface MoveRemoteContainerDocumentResult {
  accessEpoch: number | null;
  accessStateHash: string | null;
  linkedContainerIds: readonly string[];
  nextContainerId: string;
  queueBaselineAfterRelink: boolean;
  remoteState: RemoteDocumentPersistedState | null;
  status: MoveRemoteContainerDocumentStatus;
}

export type { RemoteDocumentPersistedState };

export async function initializeDocumentLinksSchema(
  execSql: ExecSql,
): Promise<void> {
  await sqlDocumentContainerProjectionPersistence.ensureSchema(execSql);
}

export async function listDocumentLinkedContainerIds(
  execSql: ExecSql,
  documentId: string,
): Promise<ReadonlyArray<string>> {
  return sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
    execSql,
    documentId,
  );
}

export async function replaceDocumentLinks(
  execSql: ExecSql,
  documentId: string,
  containerIds: ReadonlyArray<string>,
): Promise<void> {
  await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
    execSql,
    documentId,
    containerIds,
  );
}

export function resolveActiveDocumentContainerId(
  linkedContainerIds: ReadonlyArray<string>,
  preferredContainerId: string,
): string | null {
  if (linkedContainerIds.includes(preferredContainerId)) {
    return preferredContainerId;
  }

  return linkedContainerIds[0] ?? null;
}

function containerDocumentMoveResult(input: {
  document: RelinkRemoteDocumentResult;
  nextContainerId: string;
  queueBaselineAfterRelink?: boolean;
  status: MoveRemoteContainerDocumentStatus;
}): MoveRemoteContainerDocumentResult {
  return {
    accessEpoch: input.document.plan.state.epoch,
    accessStateHash: input.document.response.accessManifest.manifestHash,
    linkedContainerIds: input.document.linkedContainerIds,
    nextContainerId: input.nextContainerId,
    queueBaselineAfterRelink:
      input.queueBaselineAfterRelink ?? input.document.contentKeyRotated,
    remoteState: input.document.persistedState,
    status: input.status,
  };
}

function containerDocumentAlreadyMovedResult(input: {
  linkedContainerIds: readonly string[];
  nextContainerId: string;
  status: MoveRemoteContainerDocumentStatus;
}): MoveRemoteContainerDocumentResult {
  return {
    accessEpoch: null,
    accessStateHash: null,
    linkedContainerIds: input.linkedContainerIds,
    nextContainerId: input.nextContainerId,
    queueBaselineAfterRelink: false,
    remoteState: null,
    status: input.status,
  };
}

function resolveContainerDocumentMoveUnlinkIds(input: {
  currentContainerId: string;
  linkedContainerIds: readonly string[];
  replaceLinkedContainers?: boolean | undefined;
  targetContainerId: string;
}): string[] {
  const unlinkContainerIds = input.replaceLinkedContainers
    ? input.linkedContainerIds.filter(
        (containerId) => containerId !== input.targetContainerId,
      )
    : [input.currentContainerId];

  return Array.from(new Set(unlinkContainerIds)).filter(
    (containerId) => containerId !== input.targetContainerId,
  );
}

export async function relinkRemoteContainerDocument(input: {
  documentId: string;
  noteId: string;
  operation: ContainerDocumentLinkOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentResult | null> {
  const {
    documentId,
    noteId,
    operation,
    resolveProjectionUserKey,
    runtime,
    targetContainerId,
  } = input;
  const author = resolveDocumentCreateAuthor(runtime);
  const targetSecretKey = runtime.crypto.encapsulationKeyPair?.secretKey;
  const execSql = runtime.infra.execSql;
  if (!author || !targetSecretKey) {
    runtime.util.log(
      "Container contents: document mutation skipped because the local key context is unavailable",
    );
    return null;
  }

  try {
    const result = await relinkRemoteDocument({
      apiClient: runtime.apiClient,
      author,
      documentId,
      execSql,
      operation,
      resolveProjectionUserKey,
      targetContainerId,
      targetSecretKey,
    });
    if (!result) {
      runtime.util.log(
        `Container contents: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}`,
      );
      return null;
    }

    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      documentId,
      result.linkedContainerIds,
    );

    return result;
  } catch (error) {
    runtime.util.log(
      `Container contents: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

interface ContainerDocumentPurgeRuntime
  extends Pick<ContainerContentsWorkflowRuntime, "infra" | "util"> {
  apiClient: ContainerDocumentPurgeApi;
}

export async function purgeRemoteContainerDocument(input: {
  documentId: string;
  noteId: string;
  persistence?: DocumentsPersistence | undefined;
  runtime: ContainerDocumentPurgeRuntime;
}): Promise<DocumentPurgeResult> {
  const { documentId, noteId, runtime } = input;
  const persistence = input.persistence ?? defaultDocumentsPersistence;

  try {
    const response = await runtime.apiClient.purgeDocument(documentId);
    if (!response) {
      runtime.util.log(
        `Container contents: failed to purge note ${noteId} (document ${documentId})`,
      );
      return null;
    }

    // Tear down the purged document's local state. `deletePersistedDocument`
    // reuses the same SQLite delete path as a document delete, which removes the
    // document record, its client projection, pending updates, pending/local
    // attachment rows, the attachment blob projection, and the
    // document-container link projection in a single transaction.
    await deletePersistedDocument({
      documentProjectors: runtime.infra.documentProjectors,
      execSql: runtime.infra.execSql,
      localId: noteId,
      persistence,
    });

    runtime.util.log(
      `Container contents: purged note ${noteId} (document ${documentId})`,
    );
    return response;
  } catch (error) {
    runtime.util.log(
      `Container contents: failed to purge note ${noteId} (document ${documentId}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

interface ContainerDocumentLocalPurgeRuntime
  extends Pick<ContainerContentsWorkflowRuntime, "infra" | "util"> {}

// Purge a document that was never synced to the server (no remote document id):
// there is nothing to delete server-side, so we only tear down the local state
// via the same path a server purge uses. Returns a purge result so the caller
// treats it like any other successful purge (and refreshes the listing).
export async function purgeLocalContainerDocument(input: {
  noteId: string;
  persistence?: DocumentsPersistence | undefined;
  runtime: ContainerDocumentLocalPurgeRuntime;
}): Promise<DocumentPurgeResult> {
  const { noteId, runtime } = input;
  const persistence = input.persistence ?? defaultDocumentsPersistence;

  try {
    await deletePersistedDocument({
      documentProjectors: runtime.infra.documentProjectors,
      execSql: runtime.infra.execSql,
      localId: noteId,
      persistence,
    });

    runtime.util.log(`Container contents: purged local-only note ${noteId}`);
    return {
      documentId: noteId,
      purgedAt: new Date().toISOString(),
      reclaimedBlobStorageKeys: [],
    };
  } catch (error) {
    runtime.util.log(
      `Container contents: failed to purge local-only note ${noteId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function linkRemoteContainerDocument(input: {
  documentId: string;
  noteId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentResult | null> {
  return relinkRemoteContainerDocument({
    ...input,
    operation: "link",
  });
}

export async function unlinkRemoteContainerDocument(input: {
  documentId: string;
  noteId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentResult | null> {
  return relinkRemoteContainerDocument({
    ...input,
    operation: "unlink",
  });
}

export async function moveRemoteContainerDocument(input: {
  currentContainerId: string;
  documentId: string;
  noteId: string;
  replaceLinkedContainers?: boolean | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<MoveRemoteContainerDocumentResult | null> {
  const {
    currentContainerId,
    documentId,
    noteId,
    replaceLinkedContainers,
    resolveProjectionUserKey,
    runtime,
    targetContainerId,
  } = input;
  const writerProjection =
    await runtime.apiClient.getDocumentWriterProjection(documentId);
  if (!writerProjection) {
    return null;
  }
  const initialLinkedContainerIds =
    readLinkedContainerIdsFromDocumentManifest(writerProjection);

  let latestLinkedContainerIds: readonly string[] = initialLinkedContainerIds;
  let latestDocument: RelinkRemoteDocumentResult | null = null;
  let queueBaselineAfterRelink = false;
  if (!initialLinkedContainerIds.includes(targetContainerId)) {
    const linkedDocument = await linkRemoteContainerDocument({
      documentId,
      noteId,
      resolveProjectionUserKey,
      runtime,
      targetContainerId,
    });
    if (!linkedDocument) {
      return null;
    }

    latestDocument = linkedDocument;
    latestLinkedContainerIds = linkedDocument.linkedContainerIds;
    queueBaselineAfterRelink = linkedDocument.contentKeyRotated;
  }

  const unlinkContainerIds = resolveContainerDocumentMoveUnlinkIds({
    currentContainerId,
    linkedContainerIds: latestLinkedContainerIds,
    replaceLinkedContainers,
    targetContainerId,
  });

  const failedUnlinkContainerIds: string[] = [];
  for (const unlinkContainerId of unlinkContainerIds) {
    const unlinkedDocument = await unlinkRemoteContainerDocument({
      documentId,
      noteId,
      resolveProjectionUserKey,
      runtime,
      targetContainerId: unlinkContainerId,
    });
    if (!unlinkedDocument) {
      failedUnlinkContainerIds.push(unlinkContainerId);
      runtime.util.log(
        `Container contents: note ${noteId} was linked to ${targetContainerId} but failed to unlink from ${unlinkContainerId}`,
      );
      continue;
    }

    latestDocument = unlinkedDocument;
    latestLinkedContainerIds = unlinkedDocument.linkedContainerIds;
    queueBaselineAfterRelink =
      queueBaselineAfterRelink || unlinkedDocument.contentKeyRotated;
  }

  const nextContainerId = resolveActiveDocumentContainerId(
    latestLinkedContainerIds,
    targetContainerId,
  );
  if (!nextContainerId) {
    return null;
  }

  const status = failedUnlinkContainerIds.length > 0 ? "partial" : "complete";
  return latestDocument
    ? containerDocumentMoveResult({
        document: latestDocument,
        nextContainerId,
        queueBaselineAfterRelink,
        status,
      })
    : containerDocumentAlreadyMovedResult({
        linkedContainerIds: latestLinkedContainerIds,
        nextContainerId,
        status,
      });
}
