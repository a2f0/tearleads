import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type RelinkRemoteDocumentResult,
  relinkRemoteDocument,
  resolveDocumentCreateAuthor,
} from "../documents";
import type { ContainerContentsWorkflowSqlRuntime } from "./runtime";

type ContainerDocumentLinkApi = Parameters<
  typeof relinkRemoteDocument
>[0]["apiClient"];
type ContainerDocumentLinkOperation = Parameters<
  typeof relinkRemoteDocument
>[0]["operation"];
type RemoteDocumentPersistedState =
  RelinkRemoteDocumentResult["persistedState"];

interface ContainerDocumentLinkRuntime
  extends ContainerContentsWorkflowSqlRuntime {
  apiClient: ContainerDocumentLinkApi;
  encapsulationKeyPair?: { secretKey: Uint8Array } | null | undefined;
  log: (message: string) => void;
  organizationId?: string | null;
  signingFingerprint?: string | null;
  signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
      }
    | null
    | undefined;
  userId?: string | null;
}

type MoveRemoteContainerDocumentStatus = "complete" | "partial";

interface MoveRemoteContainerDocumentResult {
  accessEpoch: number;
  accessStateHash: string;
  linkedContainerIds: readonly string[];
  nextContainerId: string;
  queueBaselineAfterRelink: boolean;
  remoteState: RemoteDocumentPersistedState;
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
  const targetSecretKey = runtime.encapsulationKeyPair?.secretKey;
  const execSql = runtime.execSql;
  if (!author || !targetSecretKey) {
    runtime.log(
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
      runtime.log(
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
    runtime.log(
      `Container contents: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}: ${error instanceof Error ? error.message : String(error)}`,
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
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<MoveRemoteContainerDocumentResult | null> {
  const {
    currentContainerId,
    documentId,
    noteId,
    resolveProjectionUserKey,
    runtime,
    targetContainerId,
  } = input;
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

  const unlinkedDocument = await unlinkRemoteContainerDocument({
    documentId,
    noteId,
    resolveProjectionUserKey,
    runtime,
    targetContainerId: currentContainerId,
  });
  if (!unlinkedDocument) {
    runtime.log(
      `Container contents: note ${noteId} was linked to ${targetContainerId} but failed to unlink from ${currentContainerId}`,
    );
    return containerDocumentMoveResult({
      document: linkedDocument,
      nextContainerId: targetContainerId,
      status: "partial",
    });
  }

  const nextContainerId = resolveActiveDocumentContainerId(
    unlinkedDocument.linkedContainerIds,
    targetContainerId,
  );
  if (!nextContainerId) {
    return null;
  }

  return containerDocumentMoveResult({
    document: unlinkedDocument,
    nextContainerId,
    queueBaselineAfterRelink:
      linkedDocument.contentKeyRotated || unlinkedDocument.contentKeyRotated,
    status: "complete",
  });
}
