import { expect, mock, test } from "bun:test";
import {
  BLOB_CHUNK_SIZE_BYTES,
  BLOB_ENVELOPE_PREFIX_BYTES,
  blobContentMetadataHash,
  computeBlobChunkCount,
  computeBlobEncryptedByteLength,
  MAX_BLOB_ENVELOPE_HEADER_BYTES,
} from "@tearleads/crypto";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createFixtureBinding,
  createSingleAttachmentHydrationApi,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydration";

test("a fixture reader refuses a differently sized binding before downloading", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const getBytes = mock(async () => null);
  const documentId = fixture.writerProjection.documentId;
  const length = fixture.attachment.byteLength - 1;
  const service = createBlobAttachmentServiceFixture({
    api: createSingleAttachmentHydrationApi(fixture, getBytes),
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).withExpectedDownloads(
    documentId,
    new Map([[fixture.attachment.slotId, length]]),
  );
  await expect(
    service.hydrateDocumentAttachmentBlobs({
      attachments: [{ ...fixture.attachment, byteLength: length }],
      documentId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    }),
  ).rejects.toThrow("Unexpected bound attachment size");
  expect(getBytes).not.toHaveBeenCalled();
});

test("an oversized ciphertext declaration cancels the body before the first read", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const documentId = fixture.writerProjection.documentId;
  const cancel = mock(() => {});
  const pull = mock(() => {});
  let requestedLimit: number | undefined;
  const service = createBlobAttachmentServiceFixture({
    api: createSingleAttachmentHydrationApi(
      fixture,
      async (blobId, options) => {
        requestedLimit = options?.maxEncryptedByteLength;
        return {
          blobId,
          byteLength: 1_000_000_000,
          sha256: fixture.stagedBlob.sha256,
          encryptedBytes: new ReadableStream<Uint8Array>(
            {
              cancel,
              pull(controller) {
                pull();
                controller.close();
              },
            },
            { highWaterMark: 0 },
          ),
        };
      },
    ),
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).withExpectedDownloads(
    documentId,
    new Map([[fixture.attachment.slotId, fixture.attachment.byteLength]]),
  );
  expect(
    await service.hydrateDocumentAttachmentBlobs({
      attachments: [fixture.attachment],
      documentId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    }),
  ).toEqual([]);
  expect(requestedLimit).toBe(
    computeBlobEncryptedByteLength({
      plaintextByteLength: fixture.bytes.length,
      chunkCount: computeBlobChunkCount(
        fixture.bytes.length,
        BLOB_CHUNK_SIZE_BYTES,
      ),
      headerByteLength:
        BLOB_ENVELOPE_PREFIX_BYTES + MAX_BLOB_ENVELOPE_HEADER_BYTES,
    }),
  );
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(pull).not.toHaveBeenCalled();
});

test("one blob cannot have different trusted lengths in two slots", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const first = fixture.attachment;
  const second = {
    ...first,
    slotId: "second",
    byteLength: first.byteLength + 1,
  };
  const binding = createFixtureBinding(fixture);
  const metadataHash = await blobContentMetadataHash({
    blobId: binding.blobId,
    byteLength: second.byteLength,
    chunkCount: computeBlobChunkCount(second.byteLength, BLOB_CHUNK_SIZE_BYTES),
    chunkSize: BLOB_CHUNK_SIZE_BYTES,
    contentKeyEpoch: binding.contentKeyBundle.contentKeyEpoch,
  });
  const bytes = mock(async () => null);
  const api = createSingleAttachmentHydrationApi(fixture, bytes);
  const documentId = fixture.writerProjection.documentId;
  const service = createBlobAttachmentServiceFixture({
    api: {
      ...api,
      listDocumentAttachments: async () => [
        binding,
        {
          ...binding,
          slotId: second.slotId,
          writeHeader: { ...binding.writeHeader, metadataHash },
        },
      ],
    },
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).withExpectedDownloads(
    documentId,
    new Map([
      [first.slotId, first.byteLength],
      [second.slotId, second.byteLength],
    ]),
  );
  await expect(
    service.hydrateDocumentAttachmentBlobs({
      attachments: [first, second],
      documentId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    }),
  ).rejects.toThrow("Conflicting attachment sizes");
  expect(bytes).not.toHaveBeenCalled();
});
