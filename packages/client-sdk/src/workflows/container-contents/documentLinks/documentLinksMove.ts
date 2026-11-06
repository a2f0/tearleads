import type { VerifiedDocumentLinkSetManifest } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  assertDocumentWriterProjectionConsistent,
  readLinkedContainerIdsFromDocumentManifest,
} from "../../../data/documents/shared/projection";
import { persistedDocumentCreateStateFromWriterProjection } from "../../../data/documents/shared/responses";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import {
  createLinkSetAttachmentReuse,
  type DocumentLinkSetFailureHandler,
  type LinkSetAttachmentReuse,
  type RelinkRemoteDocumentResult,
} from "../../documents";
import {
  createPrincipalPolicyOperation,
  createRuntimePrincipalPolicyWarmer,
  type PrincipalPolicyOperation,
} from "../../principals/runtimePolicyWarmer";
import { resolveContainerDocumentMoveUnlinkIds } from "../documentMove/documentMoveUnlinkIds";
import {
  type ContainerDocumentLinkApi,
  type ContainerDocumentLinkRuntime,
  type RemoteDocumentPersistedState,
  relinkRemoteContainerDocument,
  unlinkRemoteContainerDocument,
} from "./index";

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

type MoveRemoteContainerDocumentStatus = "complete" | "partial";

interface MoveRemoteContainerDocumentResult {
  accessEpoch: number | null;
  accessStateHash: string | null;
  linkedContainerIds: readonly string[];
  nextContainerId: string;
  remoteState: RemoteDocumentPersistedState | null;
  status: MoveRemoteContainerDocumentStatus;
}

function resolveActiveDocumentContainerId(
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
    accessStateHash: input.document.response.manifestHash,
    linkedContainerIds: input.document.linkedContainerIds,
    nextContainerId: input.nextContainerId,
    remoteState: input.document.persistedState,
    status: input.status,
  };
}

async function containerDocumentAlreadyMovedResult(input: {
  writerProjection: DocumentWriterProjectionResponse;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerDocumentLinkRuntime;
  isCurrent?: (() => boolean) | undefined;
  linkedContainerIds: readonly string[];
  nextContainerId: string;
  policyOperation: PrincipalPolicyOperation;
  status: MoveRemoteContainerDocumentStatus;
}): Promise<MoveRemoteContainerDocumentResult> {
  const verified: { head?: VerifiedDocumentLinkSetManifest | undefined } = {};
  await assertDocumentWriterProjectionConsistent(input.writerProjection, {
    execSql: input.runtime.infra.execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    stillCurrent: input.isCurrent,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
      { operation: input.policyOperation },
    ),
    onVerifiedAuthorization: (authorization) => {
      verified.head = authorization.documentManifestByHash.get(
        input.writerProjection.documentManifest.manifestHash,
      );
    },
  });
  if (!verified.head)
    throw new Error("Move replay lacks a verified document head");
  return {
    accessEpoch: verified.head.state.epoch,
    accessStateHash: verified.head.manifestHash,
    linkedContainerIds: input.linkedContainerIds,
    nextContainerId: input.nextContainerId,
    remoteState: persistedDocumentCreateStateFromWriterProjection(
      input.writerProjection,
    ),
    status: input.status,
  };
}

async function linkRemoteContainerDocument(input: {
  attachmentReuse: LinkSetAttachmentReuse;
  documentId: string;
  isCurrent?: (() => boolean) | undefined;
  noteId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  policyOperation: PrincipalPolicyOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentResult | null> {
  return relinkRemoteContainerDocument({
    ...input,
    operation: "link",
  });
}

export async function moveRemoteContainerDocument(input: {
  linkOnly?: boolean | undefined;
  additionalLinkContainerIds?: readonly string[] | undefined;
  removedLinkContainerIds?: readonly string[] | undefined;
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
    documentId,
    noteId,
    resolveProjectionUserKey,
    runtime,
    targetContainerId,
  } = input;
  if (input.isCurrent?.() === false) return null;
  // One move workflow is one policy operation: its link and unlink legs share
  // a directory discovery. Each leg's commit still refuses a stale view. Its
  // legs also list the document's attachments once (see `attachmentReuse`).
  const policyOperation = createPrincipalPolicyOperation();
  const attachmentReuse = createLinkSetAttachmentReuse();
  const writerProjection = await fetchMoveWriterProjection({
    documentId,
    onFailure: input.onFailure,
    runtime,
  });
  if (!writerProjection || input.isCurrent?.() === false) {
    return null;
  }
  if (writerProjection.documentId !== documentId)
    throw new Error("Move replay document id mismatch");
  const initialLinkedContainerIds =
    readLinkedContainerIdsFromDocumentManifest(writerProjection);

  let latestLinkedContainerIds: readonly string[] = initialLinkedContainerIds;
  let latestDocument: RelinkRemoteDocumentResult | null = null;
  for (const linkTarget of new Set([
    ...(input.linkOnly ? [] : [targetContainerId]),
    ...(input.additionalLinkContainerIds ?? []),
  ])) {
    if (latestLinkedContainerIds.includes(linkTarget)) continue;
    const linkedDocument = await linkRemoteContainerDocument({
      attachmentReuse,
      documentId,
      isCurrent: input.isCurrent,
      noteId,
      onFailure: input.onFailure,
      policyOperation,
      resolveProjectionUserKey,
      runtime,
      targetContainerId: linkTarget,
    });
    if (!linkedDocument || input.isCurrent?.() === false) {
      return null;
    }

    latestDocument = linkedDocument;
    latestLinkedContainerIds = linkedDocument.linkedContainerIds;
  }

  const unlinkContainerIds = resolveContainerDocumentMoveUnlinkIds({
    ...input,
    linkedContainerIds: latestLinkedContainerIds,
  });

  const unlinked = await unlinkMovedDocumentSources({
    ...input,
    attachmentReuse,
    latestDocument,
    latestLinkedContainerIds,
    policyOperation,
    unlinkContainerIds,
  });
  if (!unlinked) return null;
  latestDocument = unlinked.latestDocument;
  latestLinkedContainerIds = unlinked.latestLinkedContainerIds;

  const nextContainerId = resolveActiveDocumentContainerId(
    latestLinkedContainerIds,
    targetContainerId,
  );
  if (!nextContainerId) {
    return null;
  }

  const status =
    unlinked.failedUnlinkContainerIds.length > 0 ? "partial" : "complete";
  return latestDocument
    ? containerDocumentMoveResult({
        document: latestDocument,
        nextContainerId,
        status,
      })
    : containerDocumentAlreadyMovedResult({
        writerProjection,
        resolveProjectionUserKey,
        runtime,
        isCurrent: input.isCurrent,
        linkedContainerIds: latestLinkedContainerIds,
        nextContainerId,
        policyOperation,
        status,
      });
}

// The unlink half of a move: every source is attempted even when an earlier
// one fails, so one dead source cannot strand the others; a failed unlink
// leaves the move "partial" for the queue to retry.
async function unlinkMovedDocumentSources(input: {
  attachmentReuse: LinkSetAttachmentReuse;
  documentId: string;
  isCurrent?: (() => boolean) | undefined;
  latestDocument: RelinkRemoteDocumentResult | null;
  latestLinkedContainerIds: readonly string[];
  noteId: string;
  onFailure?: DocumentLinkSetFailureHandler | undefined;
  policyOperation: PrincipalPolicyOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  rotationSnapshot: Uint8Array;
  runtime: ContainerDocumentLinkRuntime;
  targetContainerId: string;
  unlinkContainerIds: readonly string[];
}): Promise<{
  failedUnlinkContainerIds: readonly string[];
  latestDocument: RelinkRemoteDocumentResult | null;
  latestLinkedContainerIds: readonly string[];
} | null> {
  const { noteId, runtime, targetContainerId } = input;
  let { latestDocument, latestLinkedContainerIds } = input;
  const failedUnlinkContainerIds: string[] = [];
  for (const unlinkContainerId of input.unlinkContainerIds) {
    if (input.isCurrent?.() === false) return null;
    const unlinkedDocument = await unlinkRemoteContainerDocument({
      attachmentReuse: input.attachmentReuse,
      documentId: input.documentId,
      isCurrent: input.isCurrent,
      noteId,
      onFailure: input.onFailure,
      policyOperation: input.policyOperation,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      rotationSnapshot: input.rotationSnapshot,
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
  return { failedUnlinkContainerIds, latestDocument, latestLinkedContainerIds };
}
