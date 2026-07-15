import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  BlobAttachmentBindResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createBlobAttachmentBindResponse } from "../../../test/helpers/blobUploadFixtures";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { uploadDocumentAttachment } from "./upload";

type UploadApi = Parameters<typeof uploadDocumentAttachment>[0]["apiClient"];

interface ContentRecordFields {
  readonly ciphertext?: unknown;
  readonly contentRecordId?: unknown;
  readonly iv?: unknown;
  readonly nonceDomainHash?: unknown;
}

function createUploadApi(input: {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentId: string;
  readonly mapBindResponse?:
    | ((response: BlobAttachmentBindResponse) => BlobAttachmentBindResponse)
    | undefined;
  readonly organizationId: string;
  readonly slotId: string;
  readonly writerProjection: DocumentWriterProjectionResponse;
}): UploadApi {
  return {
    async bindBlobAttachment(blobId, request) {
      const response = await createBlobAttachmentBindResponse({
        blobId,
        documentManifest: input.writerProjection.documentManifest,
        request,
      });
      return input.mapBindResponse?.(response) ?? response;
    },
    getDocumentWriterProjection: async () => input.writerProjection,
    stageBlob: async () => ({
      expiresAt: "2026-04-27T01:00:00.000Z",
      stageId: "stage-upload-integrity",
    }),
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
          bindingId,
          blobId,
          documentId: writerProjection.documentId,
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
          organizationId: author.organizationId,
          slotId,
          writerProjection,
        }),
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

test("uploadDocumentAttachment uses a fresh IV for same-domain blob re-encryption", async () => {
  const { author, resolveProjectionUserKey, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const blobId = "550e8400-e29b-41d4-a716-446655440553";
  const bindingId = "550e8400-e29b-41d4-a716-446655440554";
  const slotId = "fresh-iv-slot";
  const contentKey = new Uint8Array(32).fill(7);
  const { close, execSql } = await createTestExecSql("blob-upload-fresh-iv");
  const apiClient = createUploadApi({
    bindingId,
    blobId,
    documentId: writerProjection.documentId,
    organizationId: author.organizationId,
    slotId,
    writerProjection,
  });

  try {
    const commonInput = {
      apiClient,
      author,
      bindingId,
      blobId,
      contentKey,
      documentId: writerProjection.documentId,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      slotId,
      targetSecretKey: secretKey,
    };
    const first = await uploadDocumentAttachment({
      ...commonInput,
      bytes: new TextEncoder().encode("first blob payload") as BlobBytes,
      signedAt: "2026-04-27T00:00:01.000Z",
    });
    const second = await uploadDocumentAttachment({
      ...commonInput,
      bytes: new TextEncoder().encode("second blob payload") as BlobBytes,
      signedAt: "2026-04-27T00:00:02.000Z",
    });
    if (!first || !second) {
      throw new Error("Expected uploaded blob fixtures.");
    }
    const firstRecord = JSON.parse(first.encryptedBytes) as ContentRecordFields;
    const secondRecord = JSON.parse(
      second.encryptedBytes,
    ) as ContentRecordFields;

    expect(firstRecord.contentRecordId).toBe(blobId);
    expect(secondRecord.contentRecordId).toBe(blobId);
    expect(firstRecord.nonceDomainHash).toBe(secondRecord.nonceDomainHash);
    expect(firstRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
    expect(secondRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
    expect(firstRecord.iv).not.toBe(secondRecord.iv);
    expect(firstRecord.ciphertext).not.toBe(secondRecord.ciphertext);
  } finally {
    close();
  }
}, 10_000);
