import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import { createTestExecSql } from "@symcrypt/test-utils";
import type {
  BlobAttachmentBindResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { parseBlobEncryptedBytes } from "../../data/documents/blob/shared/readers";
import { uploadDocumentAttachment } from "./upload";

type UploadApi = Parameters<typeof uploadDocumentAttachment>[0]["apiClient"];

function createUploadApi(input: {
  readonly mapBindResponse?:
    | ((response: BlobAttachmentBindResponse) => BlobAttachmentBindResponse)
    | undefined;
  readonly writerProjection: DocumentWriterProjectionResponse;
}): {
  readonly apiClient: UploadApi;
  readonly getEncryptedBytes: () => BlobBytes;
} {
  const { getAssembledBytes, ...multipartApi } =
    createMultipartBlobStageFixture();
  return {
    apiClient: {
      ...multipartApi,
      async bindBlobAttachment(blobId, request) {
        const response = await createBlobAttachmentBindResponse({
          blobId,
          documentManifest: input.writerProjection.documentManifest,
          request,
        });
        return input.mapBindResponse?.(response) ?? response;
      },
      getDocumentWriterProjection: async () => input.writerProjection,
    },
    getEncryptedBytes: () => {
      const bytes = getAssembledBytes();
      if (!bytes) {
        throw new Error("Expected assembled multipart blob bytes");
      }
      return bytes;
    },
  };
}

test("uploadDocumentAttachment rejects bind responses with tampered target material", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440551";
  const bindingId = "550e8400-e29b-41d4-a716-446655440552";
  const slotId = "tampered-response-slot";
  const { close, execSql } = await createTestExecSql(
    "blob-upload-tampered-bind-response",
  );

  try {
    await expect(
      uploadDocumentAttachment({
        apiClient: createUploadApi({
          mapBindResponse: (response) => ({
            ...response,
            contentKeyBundle: {
              ...response.contentKeyBundle,
              targets: response.contentKeyBundle.targets.map((target, index) =>
                index === 0
                  ? { ...target, wrappedKey: "tampered-wrapped-key" }
                  : target,
              ),
            },
          }),
          writerProjection,
        }).apiClient,
        author,
        bindingId,
        blobId,
        bytes: new TextEncoder().encode("tampered response bytes") as BlobBytes,
        documentId: writerProjection.documentId,
        execSql,
        expectedBindingId: null,
        resolveProjectionUserKey,
        signedAt: "2026-04-27T00:00:01.000Z",
        slotId,
        targetSecretKey: secretKey,
      }),
    ).rejects.toThrow("content-key bundle mismatch");
  } finally {
    close();
  }
});

test("uploadDocumentAttachment binds a reused nonce seed to the plaintext", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440553";
  const bindingId = "550e8400-e29b-41d4-a716-446655440554";
  const slotId = "fresh-iv-slot";
  const contentKey = new Uint8Array(32).fill(7);
  const nonceSeed = new Uint8Array(12).fill(9);
  const { close, execSql } = await createTestExecSql("blob-upload-fresh-iv");
  const firstApi = createUploadApi({ writerProjection });
  const secondApi = createUploadApi({ writerProjection });

  try {
    const commonInput = {
      author,
      bindingId,
      blobId,
      contentKey,
      documentId: writerProjection.documentId,
      execSql,
      expectedBindingId: null,
      nonceSeed,
      resolveProjectionUserKey,
      slotId,
      targetSecretKey: secretKey,
    };
    const first = await uploadDocumentAttachment({
      ...commonInput,
      apiClient: firstApi.apiClient,
      bytes: new TextEncoder().encode("first blob payload") as BlobBytes,
      signedAt: "2026-04-27T00:00:01.000Z",
    });
    const second = await uploadDocumentAttachment({
      ...commonInput,
      apiClient: secondApi.apiClient,
      bytes: new TextEncoder().encode("other blob payload") as BlobBytes,
      // JavaScript callers can attach extra fields. The public workflow must
      // ignore a forged precomputed snapshot and inspect its source itself.
      sourceSnapshot: {
        byteLength: 0,
        chunkSha256: [],
        chunkSize: 1,
        sha256: "0".repeat(64),
      },
      signedAt: "2026-04-27T00:00:02.000Z",
    } as unknown as Parameters<typeof uploadDocumentAttachment>[0]);
    if (!first || !second) {
      throw new Error("Expected uploaded blob fixtures.");
    }
    const firstRecord = parseBlobEncryptedBytes(firstApi.getEncryptedBytes());
    const secondRecord = parseBlobEncryptedBytes(secondApi.getEncryptedBytes());

    expect(firstRecord.contentRecordId).toBe(blobId);
    expect(secondRecord.contentRecordId).toBe(blobId);
    expect(firstRecord.nonceDomainHash).toBe(secondRecord.nonceDomainHash);
    expect(firstRecord.byteLength).toBe(secondRecord.byteLength);
    expect(bytesToBase64(firstRecord.iv)).not.toBe(
      bytesToBase64(new Uint8Array(12)),
    );
    expect(bytesToBase64(secondRecord.iv)).not.toBe(
      bytesToBase64(new Uint8Array(12)),
    );
    expect(bytesToBase64(firstRecord.iv)).not.toBe(
      bytesToBase64(secondRecord.iv),
    );
    expect(firstRecord.chunks[0]?.ciphertext).not.toEqual(
      secondRecord.chunks[0]?.ciphertext,
    );
  } finally {
    close();
  }
}, 10_000);
