import { expect, mock, test } from "bun:test";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
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
  const service = createBlobAttachmentServiceFixture({
    api: createSingleAttachmentHydrationApi(fixture, async (blobId) => ({
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
    })),
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
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(pull).not.toHaveBeenCalled();
});
