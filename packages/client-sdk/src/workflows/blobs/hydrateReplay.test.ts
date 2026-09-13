import { expect, test } from "bun:test";
import {
  createBlobBytesResponse,
  createSingleAttachmentHydrationApi,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydration";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../test/helpers/blobUploadFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { attachmentContentSha256 } from "../../data/documents/attachmentContentIdentity";
import { decryptDocumentAttachmentBlob } from "./decrypt";
import { hydrateDocumentAttachmentBlobs } from "./hydrate";
import { uploadDocumentAttachment } from "./upload";

test("hydration does not replace newer local bytes with a valid older binding", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const bytes = new TextEncoder().encode(
    "newer attachment payload",
  ) as BlobBytes;
  const multipart = createMultipartBlobStageFixture();
  const newer = await uploadDocumentAttachment({
    apiClient: {
      ...multipart,
      bindBlobAttachment: async (_id, request) =>
        createBlobAttachmentBindResponse({
          blobId,
          documentManifest: fixture.writerProjection.documentManifest,
          request,
        }),
      getDocumentWriterProjection: async () => fixture.writerProjection,
    },
    author: fixture.author,
    bindingId,
    blobId,
    bytes,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    expectedBindingId: fixture.bindingId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    signedAt: "2026-04-27T00:01:00.000Z",
    slotId: fixture.attachment.slotId,
    targetSecretKey: fixture.secretKey,
  });
  expect(newer?.response.previousBindingId).toBe(fixture.bindingId);
  const encrypted = multipart.getAssembledBytes();
  if (!newer || !encrypted) throw new Error("Expected newer signed upload");
  const decrypted = await decryptDocumentAttachmentBlob({
    binding: {
      ...newer.response,
      blobId,
      bindingId,
      slotId: fixture.attachment.slotId,
    },
    encryptedBytes: encrypted,
    expectedDocumentId: fixture.writerProjection.documentId,
    expectedSlotId: fixture.attachment.slotId,
    execSql: fixture.execSql,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
    writerProjection: fixture.writerProjection,
  });
  expect(decrypted).toEqual(bytes);
  const stale = await hydrateDocumentAttachmentBlobs({
    apiClient: createSingleAttachmentHydrationApi(fixture, async () =>
      createBlobBytesResponse({
        blobId: fixture.blobId,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        sha256: fixture.stagedBlob.sha256,
      }),
    ),
    attachments: [
      {
        ...fixture.attachment,
        contentSha256: await attachmentContentSha256(bytes),
      },
    ],
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    localBlobIdBySlotId: { [fixture.attachment.slotId]: blobId },
    localStorageKeyBySlotId: { [fixture.attachment.slotId]: `blob-${blobId}` },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });
  expect(stale).toEqual([]);
});
