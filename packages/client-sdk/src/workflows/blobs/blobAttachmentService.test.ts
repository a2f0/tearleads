import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import { createBlobAttachmentServiceFixture } from "../../../test/helpers/workflows/blobAttachmentServiceFixture";
import { createMaterializedSyncFixture } from "../../../test/helpers/workflows/materializedSyncFixture";
import { BlobAttachmentService } from "./blobAttachmentService";

// A host can call any method of this root-exported class. An upload that
// trusts a caller-supplied source snapshot must stay off it: a snapshot paired
// with other bytes would reuse AES-GCM nonces. Adding a method here is a
// public contract change, like the root export inventory in src/index.test.ts.
test("the public service offers no upload that trusts a source snapshot", () => {
  expect(
    Object.getOwnPropertyNames(BlobAttachmentService.prototype).sort(),
  ).toEqual([
    "constructor",
    "decryptDocumentAttachmentBlob",
    "detachDocumentAttachment",
    "hydrateDocumentAttachmentBlobs",
    "uploadDocumentAttachment",
  ]);
});

test("detachDocumentAttachment submits a signed detach event", async () => {
  const { author, resolveProjectionUserKey, writerProjection } =
    await createMaterializedSyncFixture();
  const bindingId = "550e8400-e29b-41d4-a716-446655440656";
  const blobId = "550e8400-e29b-41d4-a716-446655440657";
  const slotId = "preview";
  const submittedRequests: BlobAttachmentDetachRequest[] = [];
  const { close, execSql } = await createTestExecSql("attachment-detach");

  const detached = await createBlobAttachmentServiceFixture({
    api: {
      detachBlobAttachment: async (
        requestBlobId,
        requestBindingId,
        request,
      ) => {
        submittedRequests.push(request);
        return {
          bindingId: requestBindingId,
          blobId: requestBlobId,
          documentId: writerProjection.documentId,
          slotId,
        };
      },
      getDocumentWriterProjection: async () => writerProjection,
    },
    execSql,
  }).detachDocumentAttachment({
    author,
    bindingId,
    blobId,
    documentId: writerProjection.documentId,
    eventId: "550e8400-e29b-41d4-a716-446655440658",
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    slotId,
  });
  close();

  expect(detached?.response).toEqual({
    bindingId,
    blobId,
    documentId: writerProjection.documentId,
    slotId,
  });
  const submittedRequest = submittedRequests[0];
  if (!submittedRequest) {
    throw new Error("Expected submitted detach request.");
  }

  expect(submittedRequest.body).toEqual({
    eventType: "attachment.detach",
    bindingId,
    blobId,
    documentId: writerProjection.documentId,
    slotId,
    documentManifestHash: writerProjection.documentManifest.manifestHash,
  });
  expect(submittedRequest.event).toMatchObject({
    eventId: "550e8400-e29b-41d4-a716-446655440658",
    eventType: "attachment.detach",
    objectKind: "blob",
    objectId: blobId,
    signerUserId: author.signerUserId,
    signedAt: "2026-04-27T00:00:00.000Z",
  });
  expect(submittedRequest.authorizingContainerPathRefs).toHaveLength(1);
  const detachEvent = submittedRequest.event as {
    dependencyManifestHashes: readonly string[];
  };
  expect(detachEvent.dependencyManifestHashes).toContain(
    writerProjection.documentManifest.manifestHash,
  );
});
