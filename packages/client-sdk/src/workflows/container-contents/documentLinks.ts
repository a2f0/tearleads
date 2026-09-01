import { readLinkedContainerIdsFromDocumentManifest } from "../../data/documents/shared/projection";
import { errorMessage } from "../../data/errorMessage";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { reportAndRethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type DocumentLinkSetFailureHandler,
  type RelinkRemoteDocumentResult,
  relinkRemoteDocument,
  resolveDocumentCreateAuthor,
} from "../documents";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

type ContainerDocumentLinkApi = Parameters<
  typeof relinkRemoteDocument
>[0]["apiClient"];
type ContainerDocumentLinkOperation = Parameters<
  typeof relinkRemoteDocument
>[0]["operation"];
type RemoteDocumentPersistedState =
  RelinkRemoteDocumentResult["persistedState"];

// A cold-cache denial must keep its HTTP status: collapsing a 403 to null
// would leave an access-denied move routinely retriable instead of parking
// it for the access-restored signal (row 7).
async function fetchMoveWriterProjection(input: {
  documentId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  runtime: ContainerDocumentLinkRuntime;
}): Promise<Awaited<
  ReturnType<ContainerDocumentLinkApi["getDocumentWriterProjection"]>
> | null> {
  const { apiClient } = input.runtime;
  if (apiClient.getDocumentWriterProjectionResult) {
    const result = await apiClient.getDocumentWriterProjectionResult(
      input.documentId,
      { reportErrors: false },
    );
    if (result.ok) {
      return result.data;
    }
    result.report();
    input.onFailure?.({ message: result.message, status: result.status });
    return null;
  }
  const writerProjection = await apiClient.getDocumentWriterProjection(
    input.documentId,
  );
  if (writerProjection) {
    return writerProjection;
  }
  input.onFailure?.({
    message: "Document writer projection is unavailable",
    status: null,
  });
  return null;
}

interface ContainerDocumentLinkRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    | "auth"
    | "crypto"
    | "infra"
    | "resolveTrustedUserIdentity"
    | "state"
    | "util"
  > {
  apiClient: ContainerDocumentLinkApi &
    Pick<
      ContainerContentsWorkflowRuntime["apiClient"],
      "getCurrentPrincipalPolicy"
    >;
}

type MoveRemoteContainerDocumentStatus = "complete" | "partial";

interface MoveRemoteContainerDocumentResult {
  accessEpoch: number | null;
  accessStateHash: string | null;
  linkedContainerIds: readonly string[];
  nextContainerId: string;
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
  status: MoveRemoteContainerDocumentStatus;
}): MoveRemoteContainerDocumentResult {
  return {
    accessEpoch: input.document.plan.state.epoch,
    accessStateHash: input.document.response.accessManifest.manifestHash,
    linkedContainerIds: input.document.linkedContainerIds,
    nextContainerId: input.nextContainerId,
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
  isCurrent?: (() => boolean) | undefined;
  noteId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  operation: ContainerDocumentLinkOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rotationSnapshot?: Uint8Array | undefined;
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
  if (input.isCurrent?.() === false) return null;
  if (!author || !targetSecretKey) {
    runtime.util.log(
      "Container contents: document mutation skipped because the local key context is unavailable",
    );
    input.onFailure?.({
      message: "the local key context is unavailable",
      status: null,
    });
    return null;
  }

  try {
    const result = await relinkRemoteDocument({
      apiClient: runtime.apiClient,
      author,
      documentId,
      execSql,
      onFailure: input.onFailure,
      operation,
      resolveProjectionUserKey,
      rotationSnapshot: input.rotationSnapshot,
      stillCurrent: input.isCurrent,
      targetContainerId,
      targetSecretKey,
      warmReferencedPrincipalPolicies:
        createRuntimePrincipalPolicyWarmer(runtime),
    });
    if (!result) {
      runtime.util.log(
        `Container contents: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}`,
      );
      return null;
    }
    if (input.isCurrent?.() === false) return null;

    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      documentId,
      result.linkedContainerIds,
      { stillCurrent: input.isCurrent },
    );

    return result;
  } catch (error) {
    await reportAndRethrowKeyingVerificationError(
      error,
      runtime.util.reportSecurityIncident,
      {
        objectId: documentId,
        objectKind: "document",
        operation: `document.${operation}`,
      },
    );
    const message = errorMessage(error);
    runtime.util.log(
      `Container contents: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}: ${message}`,
    );
    input.onFailure?.({ message, status: null });
    return null;
  }
}

export async function linkRemoteContainerDocument(input: {
  documentId: string;
  isCurrent?: (() => boolean) | undefined;
  noteId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
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
  isCurrent?: (() => boolean) | undefined;
  noteId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rotationSnapshot: Uint8Array;
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
  isCurrent?: (() => boolean) | undefined;
  noteId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  replaceLinkedContainers?: boolean | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rotationSnapshot: Uint8Array;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<MoveRemoteContainerDocumentResult | null> {
  const {
    currentContainerId,
    documentId,
    noteId,
    replaceLinkedContainers,
    resolveProjectionUserKey,
    rotationSnapshot,
    runtime,
    targetContainerId,
  } = input;
  if (input.isCurrent?.() === false) return null;
  const writerProjection = await fetchMoveWriterProjection({
    documentId,
    onFailure: input.onFailure,
    runtime,
  });
  if (!writerProjection || input.isCurrent?.() === false) {
    return null;
  }
  const initialLinkedContainerIds =
    readLinkedContainerIdsFromDocumentManifest(writerProjection);

  let latestLinkedContainerIds: readonly string[] = initialLinkedContainerIds;
  let latestDocument: RelinkRemoteDocumentResult | null = null;
  if (!initialLinkedContainerIds.includes(targetContainerId)) {
    const linkedDocument = await linkRemoteContainerDocument({
      documentId,
      isCurrent: input.isCurrent,
      noteId,
      onFailure: input.onFailure,
      resolveProjectionUserKey,
      runtime,
      targetContainerId,
    });
    if (!linkedDocument || input.isCurrent?.() === false) {
      return null;
    }

    latestDocument = linkedDocument;
    latestLinkedContainerIds = linkedDocument.linkedContainerIds;
  }

  const unlinkContainerIds = resolveContainerDocumentMoveUnlinkIds({
    currentContainerId,
    linkedContainerIds: latestLinkedContainerIds,
    replaceLinkedContainers,
    targetContainerId,
  });

  const failedUnlinkContainerIds: string[] = [];
  for (const unlinkContainerId of unlinkContainerIds) {
    if (input.isCurrent?.() === false) return null;
    const unlinkedDocument = await unlinkRemoteContainerDocument({
      documentId,
      isCurrent: input.isCurrent,
      noteId,
      onFailure: input.onFailure,
      resolveProjectionUserKey,
      rotationSnapshot,
      runtime,
      targetContainerId: unlinkContainerId,
    });
    if (input.isCurrent?.() === false) return null;
    if (!unlinkedDocument) {
      failedUnlinkContainerIds.push(unlinkContainerId);
      runtime.util.log(
        `Container contents: note ${noteId} was linked to ${targetContainerId} but failed to unlink from ${unlinkContainerId}`,
      );
      continue;
    }

    latestDocument = unlinkedDocument;
    latestLinkedContainerIds = unlinkedDocument.linkedContainerIds;
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
        status,
      })
    : containerDocumentAlreadyMovedResult({
        linkedContainerIds: latestLinkedContainerIds,
        nextContainerId,
        status,
      });
}
