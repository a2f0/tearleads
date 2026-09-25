import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  type DocumentContentKeyTarget,
  type DocumentLinkAccessEventBody,
  encryptWithDek,
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
} from "../../data/documents/shared/projection";
import {
  assertEqualBytes,
  targetKey,
} from "../../data/documents/shared/readers";
import type {
  DocumentLinkSetMutationApi,
  ProjectionVerificationOptions,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { readCanonicalJson } from "../../data/keyingCanonicalJson";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createAttachmentProofReader } from "../blobs/attachmentDecryptor";
import { createAttachmentKeyAuthenticator } from "../blobs/attachmentKeyAuthenticator";
import { verifyRetainedAttachment } from "../blobs/retainedAttachmentVerification";

interface BlobRewrap {
  blobId: string;
  contentKeyEpoch: number;
  targets: DocumentLinkAccessEventBody["blobRewraps"][number]["targets"][number][];
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
            wrappingMetadata: readCanonicalJson(
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
        const wrapped = await encryptWithDek(contentKey, kek);
        return {
          ...target,
          bindingId: binding.bindingId,
          documentId,
          wrappedKey: bytesToBase64(wrapped.ciphertext),
          wrappingMetadata: {
            suite: BLOB_CONTENT_KEY_WRAP_SUITE,
            iv: bytesToBase64(wrapped.iv),
          },
        };
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
    ...input.writerProjection.authorizingContainerPaths,
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
      if (!key) throw new Error("Attachment destination KEK is unavailable");
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
