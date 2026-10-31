import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  type DocumentContentKeyTarget,
  type DocumentLinkAccessEventBody,
  readKeyingCanonicalJson,
  wrapContentKey,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  BlobAttachmentSummary,
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  deriveDocumentTargetFromProjection,
  unwrapContainerKekPath,
} from "../../../data/documents/shared/projection";
import {
  assertEqualBytes,
  targetKey,
} from "../../../data/documents/shared/readers";
import type {
  DocumentLinkSetMutationApi,
  ProjectionVerificationOptions,
} from "../../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import { requireProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";
import { documentContainerProjections } from "../../../data/keyingProjectionVerification/document/documentContainerProjections";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { createAttachmentProofReader } from "../../blobs/verification/attachmentDecryptor";
import { createAttachmentKeyAuthenticator } from "../../blobs/verification/attachmentKeyAuthenticator";
import { verifyRetainedAttachment } from "../../blobs/verification/retainedAttachmentVerification";

interface BlobRewrap {
  blobId: string;
  contentKeyEpoch: number;
  targets: DocumentLinkAccessEventBody["blobRewraps"][number]["targets"][number][];
}

type BlobRewraps = DocumentLinkAccessEventBody["blobRewraps"];

/**
 * One move or trash workflow lists a document's attachments once. After a leg
 * commits, `committed` holds the document-scoped envelopes it signed, which
 * are exactly what the server now stores for this document; the next leg
 * starts from them instead of listing again.
 */
export interface LinkSetAttachmentReuse {
  committed: BlobRewraps | null;
}

export function createLinkSetAttachmentReuse(): LinkSetAttachmentReuse {
  return { committed: null };
}

/**
 * Re-cite the previous leg's envelopes for this leg's targets. Every envelope
 * was authenticated or wrapped by this device before that leg signed it, so a
 * reuse propagates no key to a new scope; any target the previous leg did not
 * wrap returns null and the leg lists and authenticates as usual. A bind or
 * detach in between, a content-key epoch change, or a re-entered retired
 * target (the API keeps its stored wrap over the fresh one) makes the API
 * refuse with an uncoded 409, and the caller re-lists once.
 */
export function reuseCommittedBlobRewraps(input: {
  committed: BlobRewraps;
  documentId: string;
  targets: readonly DocumentContentKeyTarget[];
}): BlobRewraps | null {
  const rewraps: BlobRewrap[] = [];
  for (const rewrap of input.committed) {
    const bindingIds = [
      ...new Set(rewrap.targets.map((target) => target.bindingId)),
    ];
    const targets: BlobRewrap["targets"] = [];
    for (const bindingId of bindingIds) {
      for (const target of input.targets) {
        const previous = rewrap.targets.find(
          (candidate) =>
            candidate.bindingId === bindingId &&
            candidate.documentId === input.documentId &&
            candidate.containerId === target.containerId &&
            candidate.containerKeyEpochId === target.containerKeyEpochId,
        );
        if (!previous) return null;
        targets.push({
          ...previous,
          ...target,
          wrappingMetadata: readKeyingCanonicalJson(
            previous.wrappingMetadata,
            "Attachment wrap metadata",
          ),
        });
      }
    }
    rewraps.push({
      blobId: rewrap.blobId,
      contentKeyEpoch: rewrap.contentKeyEpoch,
      targets,
    });
  }
  return rewraps.sort(compareBlobIds);
}

/** Authenticate the existing bytes before propagating their DEK to a new scope. */
export async function prepareDocumentLinkBlobRewraps(
  input: {
    apiClient: DocumentLinkSetMutationApi;
    execSql: ExecSql;
    targetContainerProjection: ContainerWriterProjectionResponse;
    targetSecretKey: Uint8Array;
    targets: readonly DocumentContentKeyTarget[];
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<DocumentLinkAccessEventBody["blobRewraps"]> {
  const documentId = input.writerProjection.documentId;
  const bindings = await input.apiClient.listDocumentAttachments(documentId);
  // The API refuses the link unless every active binding is rewrapped, so an
  // unavailable listing (offline, or a 409 while a bind is mid-flight) is a
  // retryable availability failure of this mutation, not integrity evidence.
  if (!bindings)
    throw new ProjectionDependencyUnavailableError(
      "Document attachments are unavailable for relinking",
    );
  assertProjectionVerificationCurrent(input.stillCurrent);
  if (bindings.length === 0) return [];
  const keks = await collectRelinkKeks(input);
  const authenticateKey = createAttachmentKeyAuthenticator(
    input.apiClient,
    documentId,
  );
  const verifyRetained = createAttachmentProofReader(
    input.apiClient,
    documentId,
    verifyRetainedAttachment,
  );
  const rewrapByBlob = new Map<string, BlobRewrap>();
  for (const binding of bindings) {
    const verification = {
      binding,
      expectedDocumentId: documentId,
      expectedSlotId: binding.slotId,
      execSql: input.execSql,
      resolveProjectionUserKey: requireProjectionUserKeyResolver(
        input.resolveProjectionUserKey,
        "Attachment relink",
      ),
      targetSecretKey: input.targetSecretKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      writerProjection: input.writerProjection,
    };
    const needsKey = input.targets.some(
      (target) => !retainedTarget(binding, target, documentId),
    );
    const contentKey = needsKey ? await authenticateKey(verification) : null;
    if (!needsKey) await verifyRetained(verification);
    const targets = await Promise.all(
      input.targets.map(async (target) => {
        const previous = retainedTarget(binding, target, documentId);
        if (previous)
          return {
            ...previous,
            ...target,
            wrappingMetadata: readKeyingCanonicalJson(
              previous.wrappingMetadata,
              "Attachment wrap metadata",
            ),
          };
        const kek = keks.get(targetKey(target));
        if (!kek)
          throw new Error(
            "Attachment destination is not a verified current container head",
          );
        if (!contentKey)
          throw new Error("Attachment content key is unavailable");
        return wrapBlobKeyForTarget({
          binding,
          contentKey,
          documentId,
          kek,
          target,
        });
      }),
    );
    const rewrap = rewrapByBlob.get(binding.blobId) ?? {
      blobId: binding.blobId,
      contentKeyEpoch: binding.contentKeyBundle.contentKeyEpoch,
      targets: [],
    };
    if (rewrap.contentKeyEpoch !== binding.contentKeyBundle.contentKeyEpoch)
      throw new Error("Attachment content epoch changed during relinking");
    rewrap.targets.push(...targets);
    rewrapByBlob.set(binding.blobId, rewrap);
    assertProjectionVerificationCurrent(input.stillCurrent);
  }
  return [...rewrapByBlob.values()].sort(compareBlobIds);
}

async function wrapBlobKeyForTarget(input: {
  binding: BlobAttachmentSummary;
  contentKey: Uint8Array;
  documentId: string;
  kek: Uint8Array;
  target: DocumentContentKeyTarget;
}) {
  const { binding, target } = input;
  const wrapped = await wrapContentKey(input.contentKey, input.kek, {
    kind: "Blob",
    objectId: binding.blobId,
    contentKeyEpoch: binding.contentKeyBundle.contentKeyEpoch,
    containerId: target.containerId,
    containerKeyEpochId: target.containerKeyEpochId,
  });
  return {
    ...target,
    bindingId: binding.bindingId,
    documentId: input.documentId,
    wrappedKey: bytesToBase64(wrapped.ciphertext),
    wrappingMetadata: {
      suite: BLOB_CONTENT_KEY_WRAP_SUITE,
      iv: bytesToBase64(wrapped.iv),
    },
  };
}

function retainedTarget(
  binding: BlobAttachmentSummary,
  target: DocumentContentKeyTarget,
  documentId: string,
) {
  return binding.contentKeyBundle.targets.find(
    (candidate) =>
      candidate.bindingId === binding.bindingId &&
      candidate.documentId === documentId &&
      candidate.containerId === target.containerId &&
      candidate.containerKeyEpochId === target.containerKeyEpochId,
  );
}

async function collectRelinkKeks(
  input: Parameters<typeof prepareDocumentLinkBlobRewraps>[0],
): Promise<Map<string, Uint8Array>> {
  const keks = new Map<string, Uint8Array>();
  for (const projection of [
    ...documentContainerProjections(input.writerProjection),
    input.targetContainerProjection,
  ]) {
    const keys = await unwrapContainerKekPath({
      projection,
      secretKey: input.targetSecretKey,
      execSql: input.execSql,
      ...projectionVerificationOptions(input),
    });
    // Every node of this verified path has a current signed head. Historical
    // keyring entries may open source bytes, but never enter the destination map.
    for (const [index, head] of projection.containerKeks.entries()) {
      const target = deriveDocumentTargetFromProjection({
        ...projection,
        containerId: head.containerId,
        path: projection.path.slice(0, index + 1),
        containerKeks: projection.containerKeks.slice(0, index + 1),
      });
      const key = keys.get(target.containerKeyEpochId);
      // A direct child grantee need not possess any ancestor secret.
      if (!key) continue;
      const id = targetKey(target);
      const previous = keks.get(id);
      if (previous)
        assertEqualBytes(
          previous,
          key,
          "Attachment link projections contain conflicting KEKs",
        );
      keks.set(id, key);
    }
  }
  return keks;
}

function compareBlobIds(a: { blobId: string }, b: { blobId: string }): number {
  return a.blobId < b.blobId ? -1 : a.blobId > b.blobId ? 1 : 0;
}
