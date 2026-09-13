import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  type DocumentContentKeyTarget,
  type DocumentLinkAccessEventBody,
  encryptWithDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { unwrapContainerKekPath } from "../../data/documents/shared/projection";
import { assertEqualBytes } from "../../data/documents/shared/readers";
import type {
  DocumentLinkSetMutationApi,
  ProjectionVerificationOptions,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { readCanonicalJson } from "../../data/keyingCanonicalJson";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createAttachmentProofReader } from "../blobs/attachmentDecryptor";
import { decryptDocumentAttachmentBlobWithKey } from "../blobs/decrypt";

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
  if (!bindings)
    throw new Error("Document attachments are unavailable for relinking");
  assertProjectionVerificationCurrent(input.stillCurrent);
  if (bindings.length === 0) return [];
  const keks = await collectRelinkKeks(input);
  const decrypt = createAttachmentProofReader(
    input.apiClient,
    documentId,
    decryptDocumentAttachmentBlobWithKey,
  );
  const encryptedByBlob = new Map<string, Uint8Array<ArrayBuffer>>();
  const rewrapByBlob = new Map<string, BlobRewrap>();
  for (const binding of bindings) {
    let encryptedBytes = encryptedByBlob.get(binding.blobId);
    if (!encryptedBytes) {
      const blob = await input.apiClient.getBlobBytes(binding.blobId);
      if (!blob)
        throw new Error("Attachment ciphertext is unavailable for relinking");
      encryptedBytes = new Uint8Array(
        await new Response(blob.encryptedBytes).arrayBuffer(),
      );
      encryptedByBlob.set(binding.blobId, encryptedBytes);
    }
    const { contentKey } = await decrypt({
      binding,
      encryptedBytes,
      expectedDocumentId: documentId,
      expectedSlotId: binding.slotId,
      execSql: input.execSql,
      resolveProjectionUserKey: requireProjectionUserKeyResolver(
        input.resolveProjectionUserKey,
        "Attachment relink",
      ),
      targetSecretKey: input.targetSecretKey,
      writerProjection: input.writerProjection,
    });
    const targets = await Promise.all(
      input.targets.map(async (target) => {
        const previous = binding.contentKeyBundle.targets.find(
          (candidate) =>
            candidate.bindingId === binding.bindingId &&
            candidate.documentId === documentId &&
            candidate.containerId === target.containerId &&
            candidate.containerKeyEpochId === target.containerKeyEpochId,
        );
        if (previous)
          return {
            ...previous,
            ...target,
            wrappingMetadata: readCanonicalJson(
              previous.wrappingMetadata,
              "Attachment wrap metadata",
            ),
          };
        const kek = keks.get(target.containerKeyEpochId);
        if (!kek) throw new Error("Attachment destination KEK is unavailable");
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
    for (const [id, key] of keys) {
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
