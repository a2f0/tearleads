import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type RelinkRemoteDocumentResult,
  relinkRemoteDocument,
  resolveDocumentCreateAuthor,
} from "../documents";

type ExplorerDocumentLinkApi = Parameters<
  typeof relinkRemoteDocument
>[0]["apiClient"];
type ExplorerDocumentLinkOperation = Parameters<
  typeof relinkRemoteDocument
>[0]["operation"];
type ExplorerRemoteDocumentPersistedState =
  RelinkRemoteDocumentResult["persistedState"];

interface ExplorerDocumentLinkRuntime {
  apiClient: ExplorerDocumentLinkApi;
  encapsulationKeyPair?: { secretKey: Uint8Array } | null;
  execSql: ExecSql;
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

type MoveRemoteExplorerDocumentStatus = "complete" | "partial";

interface MoveRemoteExplorerDocumentResult {
  accessEpoch: number;
  accessStateHash: string;
  linkedContainerIds: readonly string[];
  nextContainerId: string;
  queueBaselineAfterRelink: boolean;
  remoteState: ExplorerRemoteDocumentPersistedState;
  status: MoveRemoteExplorerDocumentStatus;
}

export type { ExplorerRemoteDocumentPersistedState };

export function resolveActiveExplorerDocumentContainerId(
  linkedContainerIds: ReadonlyArray<string>,
  preferredContainerId: string,
): string | null {
  if (linkedContainerIds.includes(preferredContainerId)) {
    return preferredContainerId;
  }

  return linkedContainerIds[0] ?? null;
}

function explorerDocumentMoveResult(input: {
  document: RelinkRemoteDocumentResult;
  nextContainerId: string;
  queueBaselineAfterRelink?: boolean;
  status: MoveRemoteExplorerDocumentStatus;
}): MoveRemoteExplorerDocumentResult {
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

export async function relinkRemoteExplorerDocument(input: {
  documentId: string;
  noteId: string;
  operation: ExplorerDocumentLinkOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerDocumentLinkRuntime;
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
  if (!author || !targetSecretKey) {
    runtime.log(
      "Explorer: document mutation skipped because the local key context is unavailable",
    );
    return null;
  }

  try {
    const result = await relinkRemoteDocument({
      apiClient: runtime.apiClient,
      author,
      documentId,
      execSql: runtime.execSql,
      operation,
      resolveProjectionUserKey,
      targetContainerId,
      targetSecretKey,
    });
    if (!result) {
      runtime.log(
        `Explorer: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}`,
      );
      return null;
    }

    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      runtime.execSql,
      documentId,
      result.linkedContainerIds,
    );

    return result;
  } catch (error) {
    runtime.log(
      `Explorer: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function linkRemoteExplorerDocument(input: {
  documentId: string;
  noteId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentResult | null> {
  return relinkRemoteExplorerDocument({
    ...input,
    operation: "link",
  });
}

export async function unlinkRemoteExplorerDocument(input: {
  documentId: string;
  noteId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentResult | null> {
  return relinkRemoteExplorerDocument({
    ...input,
    operation: "unlink",
  });
}

export async function moveRemoteExplorerDocument(input: {
  currentContainerId: string;
  documentId: string;
  noteId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<MoveRemoteExplorerDocumentResult | null> {
  const {
    currentContainerId,
    documentId,
    noteId,
    resolveProjectionUserKey,
    runtime,
    targetContainerId,
  } = input;
  const linkedDocument = await linkRemoteExplorerDocument({
    documentId,
    noteId,
    resolveProjectionUserKey,
    runtime,
    targetContainerId,
  });
  if (!linkedDocument) {
    return null;
  }

  const unlinkedDocument = await unlinkRemoteExplorerDocument({
    documentId,
    noteId,
    resolveProjectionUserKey,
    runtime,
    targetContainerId: currentContainerId,
  });
  if (!unlinkedDocument) {
    runtime.log(
      `Explorer: note ${noteId} was linked to ${targetContainerId} but failed to unlink from ${currentContainerId}`,
    );
    return explorerDocumentMoveResult({
      document: linkedDocument,
      nextContainerId: targetContainerId,
      status: "partial",
    });
  }

  const nextContainerId = resolveActiveExplorerDocumentContainerId(
    unlinkedDocument.linkedContainerIds,
    targetContainerId,
  );
  if (!nextContainerId) {
    return null;
  }

  return explorerDocumentMoveResult({
    document: unlinkedDocument,
    nextContainerId,
    queueBaselineAfterRelink:
      linkedDocument.contentKeyRotated || unlinkedDocument.contentKeyRotated,
    status: "complete",
  });
}
